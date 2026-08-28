# ADR-018 — La sesión de recuperación es efímera y no se promociona

- **Estado:** Aceptado
- **Fecha:** 2026-08-28

## Contexto

Recuperar la contraseña exige canjear la prueba que llega en el correo.
`supabase.auth.verifyOtp({ token_hash, type: 'recovery' })` la canjea y
**devuelve una sesión completa**: access token, refresh token y usuario, en todo
indistinguibles de los de un login ordinario.

Esa sesión llegó por tener acceso a un buzón, no por conocer la contraseña. Y la
contraseña **todavía no ha cambiado** cuando aparece.

La primera implementación la canjeaba con el cliente principal y distinguía el
momento con un estado `recovering` en el `SessionProvider`, encendido por el
evento `PASSWORD_RECOVERY`. **Se midió que eso no aguanta un reinicio:**

1. se canjea el enlace y la sesión queda persistida en el llavero;
2. el proceso muere antes de guardar la contraseña nueva;
3. al reabrir, `auth-js` restaura esa sesión y emite `INITIAL_SESSION`;
4. el `PASSWORD_RECOVERY` que la hacía especial **sólo existía en el proceso
   muerto**;
5. la app aterriza en `signed-in`, en Inicio, con la contraseña sin cambiar.

Es decir: matar la app convertía un enlace de correo en un **login permanente y
auto-renovable**, sin que el titular legítimo se enterase, porque su contraseña
seguía funcionando.

También se midió que **no existe señal fiable** para reconocer la procedencia
tras el reinicio:

- `auth-js` **no reemite** `PASSWORD_RECOVERY` al restaurar; sus tres emisiones
  son `verifyOtp` y las dos rutas web de `detectSessionInUrl`, que está en
  `false`.
- `auth.sessions` no guarda marcador alguno: `tag` vacío y `aal1` en ambos casos.
- El claim `amr` **parecía** servir —`otp` en recovery frente a `password` en un
  login, y sobrevive al refresh— pero **no es específico**: la confirmación de
  alta produce exactamente el mismo `amr: [{method:"otp"}]`. Significa
  «verificado por token de un solo uso», no «recuperación».

## Decisión

**Una sesión nacida de un enlace de recuperación no es una sesión ordinaria de
Nomey, no se persiste, y nunca se promociona a sesión ordinaria.**

Se canjea con un **cliente Auth propio y efímero**, configurado con
`persistSession: false`, `autoRefreshToken: false` y `detectSessionInUrl: false`.
Vive en memoria mientras dura la operación y muere con el proceso.

El `SessionProvider` principal **no la ve nunca** y sigue representando sólo
sesiones ordinarias. Durante una recuperación su estado es `signed-out`, y eso
es literalmente cierto: el cliente principal no tiene ninguna sesión. La
superficie de recuperación la gobierna un controlador acotado a la transacción,
sin usuario, sin token y sin persistencia.

Al terminar: `updateUser({ password })` y después `signOut({ scope: 'local' })`
sobre ese mismo cliente efímero. El usuario vuelve a Entrar y accede con la
contraseña nueva.

**Un recovery interrumpido no se reanuda.** No hay estado que restaurar y no se
guarda ninguno: al reabrir, la app está en Entrar y se pide otro enlace. Ese
fail-closed es la decisión, no una limitación.

## Consecuencias

**Lo que garantiza, y por qué es estructural y no una convención.** Leído del
código de `@supabase/auth-js@2.112.4`:

- Con `persistSession: false` el constructor toma la rama que asigna
  `this.storage = memoryLocalStorageAdapter({})`, y **`settings.storage` sólo se
  consulta dentro de la rama `persistSession`**. Pasarle un adaptador no sería
  sólo incorrecto: sería ignorado. Ninguna configuración de ese cliente alcanza
  el llavero.
- El `BroadcastChannel` que compartiría eventos entre instancias se crea sólo
  `if (isBrowser() && globalThis.BroadcastChannel && this.persistSession &&
this.storageKey)`. Dos de esas condiciones son falsas. Y los suscriptores viven
  en el `stateChangeEmitters` de cada instancia, así que los eventos del cliente
  efímero no pueden alcanzar al provider principal.

**ADR-017 no cambia ni se amplía.** Sigue siendo la política de persistencia de
la sesión ordinaria. Esto no es una excepción a ella: no se persiste nada, así
que no hay nada sobre lo que una política de persistencia tenga opinión.

**Coste aceptado:** una segunda instancia de cliente Auth. Se crea de forma
perezosa, se descarta al terminar la transacción, y sólo se le piden tres
llamadas.

**Sesión remota huérfana.** Si el proceso muere entre el canje y el `signOut`, el
refresh token de esa sesión efímera **sigue existiendo en GoTrue** aunque el
dispositivo ya no lo conserve. No se construye limpieza remota para un proceso
que ya murió. Es aceptable porque el token **nunca se escribió** en el
dispositivo, no queda copia tras morir el proceso, el enlace original es de un
solo uso —reutilizarlo responde `403 otp_expired`, medido— y desde Nomey no hay
forma de recuperar esa sesión. Caduca con `jwt_expiry` para el access token; el
refresh token queda hasta que el usuario cambie la contraseña o se revoque la
sesión por otra vía.

**Alternativa descartada:** persistir una marca de recovery junto a la sesión.
Habría rastreado el peligro en vez de eliminarlo: dos artefactos que pueden
desincronizarse, un marcador de «estás a media recuperación» que sobrevive a un
cierre inesperado, y la necesidad de diseñar una salida de emergencia para
quien quedase atrapado en esa pantalla. Si la marca se pierde o se corrompe, se
vuelve al agujero original **en silencio**; con la sesión efímera, cualquier
fallo acaba en «no hay sesión», que es el lado seguro.
