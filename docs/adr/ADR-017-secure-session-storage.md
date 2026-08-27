# ADR-017 — Persistencia segura de la sesión en el dispositivo

- **Estado:** Aceptado
- **Fecha:** 2026-08-27

## Contexto

La Fase 5 necesita que la sesión sobreviva al reinicio de la app —criterio 2 de
su cierre en el [roadmap](../product/roadmap.md)—. Eso obliga a escribir en el
dispositivo dos credenciales de larga vida:

- el **access token**, un JWT que `sec.request_actor_id()` convierte en la
  identidad autoritativa de toda escritura contable;
- el **refresh token**, que **no caduca** y con el que cualquiera que lo tenga
  puede obtener access tokens nuevos indefinidamente.

Quien obtenga el segundo es el usuario, a todos los efectos que le importan a
Nomey. No hay segunda barrera: la RLS decide **qué filas** ve una identidad, no
**si** la identidad es legítima.

El [punto de entrada de la fase](../architecture/phase-5-handoff.md) §6 marca
esto explícitamente como decisión de arquitectura y no de implementación, y
`src/lib/README.md` ya anticipaba «adaptador de sesión sobre SecureStore» como
intención — pero una intención anotada en un README no es una decisión tomada,
y en particular no había respondido a la pregunta que resultó ser la difícil,
que no es _dónde_ se guarda sino _qué pasa cuando no cabe_.

### La restricción que condiciona el diseño

La documentación de `expo-secure-store` para SDK 57 dice, sobre el tamaño de los
valores:

> Large payloads can be rejected by the underlying platform. Historically, some
> iOS releases refused values above roughly 2048 bytes.

Nótese la forma del enunciado: **«pueden ser rechazados»** y **«históricamente,
algunas versiones»**. No es un límite documentado y estable contra el que se
pueda diseñar; es una advertencia sobre un comportamiento que depende de la
plataforma y de la versión.

Una sesión de Supabase serializada es un access JWT, un refresh token y el
objeto `user` completo, que incluye la metadata de presentación. Su tamaño **no
es constante**: crece con lo que se guarde en `user_metadata`.

De ahí se sigue la restricción de diseño, que es lo que este ADR resuelve:

> **No se admite un diseño cuya seguridad dependa de que la sesión medida hoy
> quepa.** Una arquitectura que solo es correcta por debajo de un tamaño que ni
> controlamos ni podemos fijar no es una arquitectura, es una apuesta con
> plazo.

## Decisión

> **La sesión se persiste en `expo-secure-store` —llavero de iOS y keystore de
> Android—, a través de un adaptador propio que trocea todo valor y lo confirma
> con un manifiesto.**

Cinco puntos, todos normativos:

### 1 · El medio: SecureStore, nunca AsyncStorage

Los tokens no se escriben en almacenamiento en claro. Ni `AsyncStorage`, ni
ficheros, ni `expo-file-system`.

### 2 · La accesibilidad: `WHEN_UNLOCKED_THIS_DEVICE_ONLY`

**Comprobado contra la API instalada**, `expo-secure-store@57.0.2`, cuyo
`build/SecureStore.d.ts` exporta la constante y la documenta así:

> Similar to `WHEN_UNLOCKED`, except the entry is not migrated to a new device
> when restoring from a backup.

Son dos mitades de la misma decisión:

- **`WHEN_UNLOCKED`** — la sesión solo se lee con el dispositivo desbloqueado.
- **`THIS_DEVICE_ONLY`** — el refresh token no viaja en un backup cifrado a otro
  dispositivo.

**`keychainAccessible` es `@platform ios`.** No existe equivalente en Android, y
esto importa: la mitad Android de «solo este dispositivo» **no es una constante
sino la exclusión de Android Auto Backup** que escribe el config plugin de
`expo-secure-store` en `android:fullBackupContent` y
`android:dataExtractionRules`. Está declarada en `app.config.ts` con
`configureAndroidBackup: true`. **Las dos hacen falta y ninguna cubre la otra
plataforma.**

No se usa `requireAuthentication`, y por tanto el plugin va con
`faceIDPermission: false`.

### 3 · Los valores grandes: troceado con manifiesto, siempre

Cada valor lógico ocupa:

```
<clave>          el manifiesto:  {"v":1,"n":<número de chunks>}
<clave>.0 … .n-1 los chunks, de 512 unidades UTF-16 como máximo
```

**Se trocea siempre, también un valor corto.** Un camino, sin rama por tamaño:
una rama que solo se ejecuta cuando el valor crece es una rama que se estrena en
producción.

**512 unidades UTF-16, no bytes.** SecureStore almacena UTF-8, donde una unidad
fuera de ASCII cuesta hasta tres bytes —un par suplente cuesta cuatro bytes por
dos unidades, así que tres por unidad es el peor caso real—. 512 unidades son
como mucho 1536 bytes incluso para texto íntegramente no latino, con margen bajo
la cifra de 2048; y un JWT ASCII, que es lo que se guarda casi siempre, llena
los 512 bytes.

**El corte nunca parte un par suplente.** Si el límite cae entre una unidad alta
y su baja, retrocede una posición.

**Techo de 128 chunks** —65 536 unidades—. Un valor mayor **se rechaza con
error**, no se trunca.

### 4 · La regla de la que depende todo

> **El manifiesto se escribe el último y se borra el primero.**

Es el registro de commit. Su ausencia significa «aquí no hay nada»; su presencia
significa que todos los chunks que cuenta se escribieron antes que él.

El orden de escritura es, por tanto: **borrar el manifiesto** → escribir los
chunks → **escribir el manifiesto** → barrer los chunks sobrantes del valor
anterior.

**Consecuencia:** una escritura interrumpida degrada a **sin sesión** —el
usuario vuelve a entrar—, nunca a **media sesión**.

### 5 · Ante lo ilegible, ausente; nunca a medias

Si el manifiesto no parsea, es de una versión desconocida, tiene un recuento
imposible, o falta cualquiera de los chunks que cuenta:

- `getItem` devuelve **`null`**, jamás el prefijo que sobrevivió;
- y el adaptador **purga** la clave entera.

Devolver lo que sobrevivió entregaría a `@supabase/auth-js` un JSON truncado,
que no falla al leerlo sino tres capas más allá, en una llamada sin relación
aparente. **Ausente es la única respuesta admisible.**

**La purga borra incondicionalmente hasta el techo**, y no barriendo hasta el
primer hueco. La diferencia la descubrió un test y no el razonamiento: un valor
roto puede tener un **agujero** —el chunk 2 ausente y el 3 presente—, y un
barrido que para en el primer hueco se marcha dejando la cola. No es un fallo de
corrección, porque sin manifiesto esos restos son inalcanzables, pero «basura
inalcanzable acumulándose en el llavero» tampoco es un estado de reposo
aceptable.

### 6 · Separación de responsabilidades

```
@supabase/auth-js       ve getItem / setItem / removeItem, y nada más
  └ chunked-storage.ts  troceado, manifiesto, purga.  PURO, inyectable
      └ session-storage.ts   la ÚNICA que nombra expo-secure-store
```

`chunked-storage.ts` no importa `expo-secure-store`: recibe el backend. Por eso
sus estados rotos —manifiesto corrupto, chunk ausente, escritura interrumpida—
se prueban en Vitest sin dispositivo y sin módulo nativo.

**El ciclo de vida de la sesión no vive aquí.** `client.ts` construye un cliente
y no decide _cuándo_: restaurar al arranque y refrescar al volver a primer plano
son de F5.B. Esta separación es parte de la decisión, no una casualidad de la
implementación.

### 7 · La compatibilidad de `URL`, que esta frontera tiene que resolver

**React Native 0.86 no cumple el contrato de `URL` que exige la versión
instalada de `supabase-js`, y por eso la frontera lleva un polyfill.**

`SupabaseClient`, en su constructor y **antes de leer ninguna opción**, asigna a
`realtimeUrl.protocol` para pasar de `http` a `ws`. El `URL` que React Native
instala como global —incondicionalmente, en `Libraries/Core/setUpXHR.js`—
declara **un solo setter en todo el fichero, `set search`**: `protocol` es un
getter puro. El cuerpo de una clase es siempre strict mode, así que la
asignación lanza `TypeError` y **el cliente no llega a existir**. No tiene que
ver con realtime, que Nomey no usa: la línea corre antes que las opciones.

**Se adopta `react-native-url-polyfill`**, que es la vía estándar y la que la
propia documentación de Supabase prescribe para React Native. Se aplica en un
único punto —`src/lib/supabase/bootstrap.ts`, importado por `client.ts`— porque
repartirlo por rutas o features haría que «¿está aplicado?» dejara de tener
respuesta.

**Se rechaza el shim local**: definir a mano un setter de `protocol` sobre el
`URL.prototype` de React Native evitaría la dependencia, pero dependería del
campo privado `_url` de esa clase, y arreglaría solo el miembro con el que se
tropezó dejando debajo un `URL` aproximado bajo una librería que lo sigue
usando. Cambiar una dependencia auditable por un parche sobre internals ajenos
no es un ahorro.

## Alternativas consideradas

**`AsyncStorage`, que es lo que usa el propio quickstart de Supabase para React
Native.** Rechazada. Guarda el refresh token en claro en el contenedor de la
app. Es más simple y es estrictamente peor: en un dispositivo con root o
jailbreak, y en cualquier extracción del contenedor, el token está a la vista.
El handoff pide almacenamiento **seguro**, y aquí lo simple y lo correcto no
coinciden.

**SecureStore en una sola entrada, sin trocear.** Rechazada, y es la alternativa
que más había que argumentar porque es la que parece obvia. Apuesta a que la
sesión cabe. El fallo no sería un error claro sino «a veces no recuerda la
sesión», dependiente de plataforma, de versión de iOS y de cuánta metadata tenga
el usuario — es decir, irreproducible en el dispositivo de quien lo depure.

**Medir primero y trocear solo si la medición lo exige.** Rechazada
explícitamente. Deja el diseño dependiendo de una cifra que ni fijamos ni
controlamos, y que cambia cuando cambie la metadata del usuario o una versión de
iOS. La medición sigue siendo obligatoria — pero como **validación** de esta
arquitectura, no como condición de que sea segura.

**Guardar solo el refresh token en SecureStore y el access token en memoria.**
Rechazada. Pelea con el contrato de `SupportedStorage`, que espera guardar y
recuperar la sesión entera, y obligaría a reconstruirla a mano en cada arranque.
Además el access token también es sensible: durante su hora de vida es identidad
válida ante `api.record_*`.

**`requireAuthentication: true`, biometría en cada acceso.** Rechazada. Pediría
Face ID en cada arranque y en cada refresco de token, para una app de finanzas
personales donde eso no es proporcionado. Y tiene un modo de fallo desagradable
documentado por Expo: cambiar la huella o el perfil facial **invalida la clave**
y el valor pasa a ser irrecuperable — la sesión desaparecería sin explicación
por un cambio en los ajustes del teléfono. Si algún día se quiere un bloqueo
biométrico, es una decisión de producto sobre **la app**, no sobre el
almacenamiento.

**MMKV cifrado u otro almacén de terceros.** Rechazada. Dependencia nueva fuera
del ecosistema Expo, con su propio ciclo de compatibilidad con SDK 57, para
resolver algo que `expo-secure-store` ya resuelve.

**Un `keychainService` propio por variante.** Rechazada por innecesaria. Las
variantes `nomey` y `nomey-dev` llevan **bundle identifiers distintos**
—`app.config.ts`— y SecureStore está acotado por app en ambas plataformas, así
que los dos builds no pueden verse las entradas. Sería una copia más débil de
una separación que ya existe, y una que además hay que pasar idénticamente en
cada lectura posterior o el valor se vuelve inalcanzable.

## Consecuencias

### Lo que se gana

- El refresh token está en el llavero, no en claro, y no se migra a otro
  dispositivo por backup.
- El tamaño de la sesión **deja de ser un riesgo**: crecer la metadata añade
  chunks y no rompe nada.
- Una escritura interrumpida no puede dejar una sesión corrupta.
- Los estados rotos se prueban en CI, sin dispositivo.
- La librería de auth no sabe nada de todo esto.

### Lo que cuesta

- **El troceado es código nuestro.** Es superficie de bug propia donde antes
  había una llamada a la plataforma. Se compensa con tests, no con confianza.
- **Un refresco con el teléfono bloqueado no puede persistir.**
  `WHEN_UNLOCKED` es exactamente eso. La sesión refrescada queda en memoria y no
  se escribe. Supabase documenta la mitigación por el lado del servidor: si se
  usa el **padre** del refresh token activo, devuelve el activo, que es justo
  este caso. Es una consecuencia asumida de no diseñar para acceso en segundo
  plano — y **si algún día hay widget o Action Button, esta constante es lo
  primero que habrá que revisar**, con su propio ADR.
- **Cada lectura son n+1 llamadas a SecureStore**, y cada purga hasta 128
  borrados de claves que casi siempre no existen. Ambas rutas son raras —
  arranque y cierre de sesión— y ninguna está en un camino donde alguien espere.
- **En Android, SecureStore no sobrevive a desinstalar la app; en iOS sí.**
  Asimetría de la plataforma, no del diseño. Conviene saberla antes de depurar
  por qué un Android pide login otra vez.
- **La clave de almacenamiento es fija** (`nomey-auth-token`) en vez de derivada
  de la URL. Apuntar la app a un proyecto Supabase distinto encontrará la sesión
  guardada, fallará al refrescarla y cerrará sesión. Es el resultado correcto
  —una sesión no es transferible entre proyectos— pero es un borde áspero que
  aparecerá al montar entornos.

### Lo que queda pendiente de medición real

Esta arquitectura no depende de la cifra, pero la cifra hay que conocerla:

1. **El tamaño real de una sesión de Nomey serializada**, en iPhone físico, con
   su `display_name`. Se obtiene en cuanto F5.C produzca una sesión auténtica.
2. **Que SecureStore escribe y lee un payload grande en dispositivo**, no solo
   en Vitest — el `Intl` de Hermes ya enseñó que pasar en V8 no dice nada del
   teléfono.

**Ambas deben quedar documentadas antes de cerrar la Fase 5.** La primera dirá
cuántos chunks usa una sesión de verdad; si resultara ser uno solo, la decisión
**no cambia**, por el motivo de la sección 3.
