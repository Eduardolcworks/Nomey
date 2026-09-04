# ADR-031 — Contrato de entornos, variantes y separación de configuración

- **Estado:** Aceptado
- **Fecha:** 2026-09-04
- **Alcance:** cuántos entornos tiene Nomey, qué identidad instalable
  corresponde a cada uno, cómo se selecciona uno, qué configuración puede viajar
  en el bundle y cuál no, y por qué canal se actualiza cada entorno.
- **No reemplaza a ningún ADR.** Complementa a
  [ADR-030](ADR-030-native-code-model.md), que fija **cómo** se produce el
  binario; este fija **cuántos binarios distintos hay y qué configuración
  lleva cada uno**.
- **No decide** ni el proveedor de compilación en la nube, ni la creación de un
  proyecto Supabase alojado, ni la publicación en ninguna tienda. Lo que queda
  fuera está enumerado al final, con su destino.

## Contexto

Hasta hoy Nomey tiene **un entorno y medio**. `app.config.ts` distingue dos
variantes por `APP_VARIANT` —producción y `development`, con identificador y
esquema propios— y el `.env` de cada máquina apunta al stack Supabase local. Eso
ha bastado durante seis fases porque nunca hubo un binario propio: en Expo Go, el
«entorno» es el `.env` que Metro inlinea en ese momento.

La Fase 8 rompe ese equilibrio en tres sitios a la vez.

**Aparece un binario que no depende de Metro.** Un APK instalado sigue
funcionando cuando el servidor de desarrollo no está, y por tanto lleva su
configuración **dentro**. Cuál sea esa configuración deja de ser una propiedad
de la sesión de trabajo y pasa a ser una propiedad del artefacto.

**Aparece la posibilidad de tener varias identidades a la vez en un aparato.**
Con dos variantes ya se resolvió el caso obvio —una build de desarrollo
conviviendo con producción— y el propio fichero documenta por qué el esquema de
enlace profundo se parte igual que el identificador: con un `nomey://`
compartido, el sistema elige ganador y un enlace de desarrollo puede abrir
producción. Ese razonamiento no cambia; lo que cambia es que hacen falta **tres**
identidades, no dos.

**Y aparece la pregunta de las credenciales en CI.** La cabecera de
[`scripts/bundle-secrets-check.sh`](../../scripts/bundle-secrets-check.sh) dice
literalmente que no corre en CI porque exportar exige las dos `EXPO_PUBLIC_`,
que tendrían que existir como secretos del repositorio, y que **decidir eso es
modelo de build, o sea Fase 8**. La deuda apunta aquí por su nombre.

La restricción que ordena todo lo demás es de `AGENTS.md` §7 y no admite
matices: **una credencial de backend con privilegios elevados nunca está en el
bundle del cliente.** Toda variable con prefijo `EXPO_PUBLIC_` se inlinea en el
artefacto y es legible por cualquiera que descargue el binario.

## Decisión

### 1 · Tres entornos, tres identidades instalables a la vez

| Uso            | Nombre visible  | `bundleIdentifier` / `package` | Scheme          |
| -------------- | --------------- | ------------------------------ | --------------- |
| Desarrollo     | `Nomey Dev`     | `es.lcworks.nomey.dev`         | `nomey-dev`     |
| **Staging**    | `Nomey Staging` | `es.lcworks.nomey.staging`     | `nomey-staging` |
| **Producción** | `Nomey`         | `es.lcworks.nomey`             | `nomey`         |

Las tres conviven en un mismo aparato, que es el motivo entero de partir el
identificador y el esquema. El nombre visible se parte con ellos: dos iconos
idénticos llamados igual en la pantalla de inicio es un error de operación
esperando a ocurrir.

**El identificador de producción es definitivo.** `es.lcworks.nomey` es DNS
inverso del dominio **`lcworks.es`, que el propietario de Nomey controla**. Ese
hecho se registra aquí porque es el fundamento del espacio de nombres y porque
será la base de los enlaces universales, del dominio de correo de
autenticación, del soporte y de las páginas legales cuando existan. **No se
configura hoy ningún DNS ni ningún servicio web**: se registra la propiedad, no
se despliega nada.

Cambiar el identificador de `dev` o de `staging` más adelante es una
reinstalación. **Cambiar el de producción después de publicar es imposible**:
obliga a una ficha nueva y se pierden reseñas, posición e instalaciones. Por eso
se fija ahora, mucho antes de necesitarlo.

### 2 · El entorno se selecciona por configuración, nunca por código

La variable de build `APP_VARIANT` selecciona la identidad, y **ninguna rama del
código fuente pregunta en qué entorno se ejecuta** para decidir comportamiento
de producto. Un `if (entorno === 'staging')` dentro de una feature convierte el
entorno en una segunda dimensión del producto, y a partir de ahí staging deja de
probar lo que producción va a hacer.

Esto es lo que el criterio 2 de cierre de la Fase 8 exige —«el cambio entre
entornos es configuración, no código»— **en su mitad de configuración**. Su otra
mitad, la existencia de un entorno realmente distinto del local, no se cumple
todavía; ver §4.

### 3 · Público y secreto: una sola clasificación, tres capas

**Sólo las variables `EXPO_PUBLIC_*` llegan al bundle, y sólo pueden contener
valores públicos por diseño.** Hoy son exactamente dos: la URL de Supabase y la
clave publicable. Las dos **deben** estar ahí; están diseñadas para eso.

**La clasificación no se reinventa en cada sitio.** La fuente canónica es
`src/lib/env/supabase-env.ts`: acepta `sb_publishable_`, rechaza por nombre
`sb_secret_`, y rechaza **cualquier** JWT, incluida la `anon` heredada. Las
otras dos capas aplican esa misma clasificación en momentos distintos —
`tests/infra/no-backend-secrets.test.ts` sobre el fuente versionado y
`scripts/bundle-secrets-check.sh` sobre el artefacto exportado — y **ninguna
sustituye a las otras dos**: la primera no ve el `.env` de cada máquina, la
segunda no protege a quien publica el binario, y la tercera no protege a quien
sólo arranca la app.

**Ninguna credencial de servidor participa en la construcción del cliente**, en
ninguna de las tres variantes y en ninguna máquina, CI incluida. Una clave
`sb_secret_` pertenece a los secretos del repositorio y a los secretos de
Supabase, y no tiene ningún papel en un build de Nomey.

### 4 · Cómo funciona hoy cada entorno, y qué falta

**Development.** Build propia de Android, servida por Metro, contra el stack
Supabase local. Es el bucle de trabajo.

**Staging.** APK independiente, **sin Metro**, que se actualiza por el canal
`staging` de **EAS Update**. Provisionalmente apunta al **mismo stack Supabase
local**, alcanzado por la red local.

> **Staging local NO cumple el criterio 2 de cierre de la Fase 8**, que pide «al
> menos un entorno distinto del local». Un stack local alcanzado por otra ruta
> sigue siendo el mismo entorno. **Ese criterio queda expresamente pendiente**,
> no cumplido y no reinterpretado, hasta que exista un backend alojado. Lo que
> staging sí demuestra desde ya es la otra mitad: que una identidad distinta,
> con su propia configuración y su propio canal de actualización, se construye e
> instala sin tocar una línea de código.

**Producción.** Identidad y contrato **declarados**; sin proyecto de backend,
sin credenciales y sin publicación. Un proyecto de producción sin usuarios es
superficie de ataque, coste de mantenimiento y una tentación de apuntar el
`.env` donde no debe.

### 5 · EAS Update sí; EAS Build no, todavía

**Android se compila localmente** con la cadena nativa de la máquina. No se
adopta EAS Build en esta fase: la compilación local no requiere cuenta, no tiene
cola, y la Fase 8 es precisamente donde el proyecto tiene que aprender a
compilarse a sí mismo.

**EAS Update sí se adopta, como servicio independiente de EAS Build**, y su
único propósito hoy es actualizar el JavaScript de Staging sin reinstalar el
APK. Esto exige una cuenta gratuita de Expo, que **se autoriza** para cuando
haga falta.

De aquí se sigue una regla que conviene no olvidar nunca, porque su modo de
fallo es tardío: **EAS Update no puede añadir ni cambiar recursos nativos.** Un
icono, un permiso, un plugin o un módulo nativo nuevo exigen un binario nuevo. Es
la razón por la que los dos iconos de F14 tienen que estar dentro del binario
antes de publicar ([ADR-030](ADR-030-native-code-model.md) §5).

### 6 · Qué NO decide este ADR, y dónde se decide

| Abierto                                                    | Destino                        |
| ---------------------------------------------------------- | ------------------------------ |
| Proyecto Supabase alojado para staging o producción        | Cuando se aborde el criterio 2 |
| Adopción de EAS Build                                      | F8.B, con la firma de iOS      |
| Política de `runtimeVersion` y canales de EAS Update       | **F8.A1**                      |
| Si CI ejecuta `bundle-secrets-check.sh`, y con qué valores | **F8.A1**                      |
| `versionCode` de Android y `buildNumber` de iOS            | **F8.A1**                      |
| Publicación en cualquier tienda                            | F8.B (Apple) · F8.C (Google)   |

## Alternativas consideradas

**Dos entornos: desarrollo y producción.** Es lo que hay hoy y funcionaría un
tiempo más. Se descarta porque obliga a probar los cambios en la misma identidad
que se usa a diario para desarrollar, o directamente en producción. El coste de
la tercera identidad es una entrada en una tabla; el coste de no tenerla es
descubrir en producción algo que sólo se manifiesta en un binario sin Metro.

**Un entorno por rama o por desarrollador.** Se descarta por desproporción: un
proyecto de una persona no tiene el problema que eso resuelve, y sí tendría el
coste de mantener N configuraciones que nadie verifica.

**Seleccionar el entorno en ejecución, desde una pantalla oculta**, en lugar de
por variante de build. Es cómodo y se descarta por dos razones. La primera es
que el binario tendría que llevar **todas** las configuraciones dentro,
incluidas las de producción, en un artefacto de desarrollo. La segunda es que
convierte «en qué entorno estoy» en estado de ejecución, y a partir de ahí un
informe de error deja de ser interpretable sin preguntar.

**Crear ya el proyecto Supabase alojado para cumplir el criterio 2 en F8.A.**
Era la recomendación técnica inicial, y tenía a favor un beneficio real: aplicar
las 18 migraciones a un proyecto alojado saldaría de paso el _preflight_ de
`btree_gist` que sigue abierto desde la Fase 3. Se descarta **por decisión de
producto**, para no incorporar un recurso externo, con su clave secreta y su
mantenimiento, antes de que haya algo que alojar. La consecuencia se acepta
explícitamente: el criterio 2 queda pendiente y el _preflight_ sigue abierto.

**Adoptar EAS Build junto con EAS Update.** Se descarta para Android por lo
dicho en §5. Para iOS no se descarta: se aplaza a F8.B, donde la firma lo hará
probablemente inevitable desde Windows.

## Consecuencias

**Lo que se vuelve más fácil.**

- Hay un artefacto instalable que no depende del portátil de nadie, y que se
  puede actualizar sin reinstalar.
- El identificador de producción queda fijado antes de que sea irreversible, en
  lugar de decidirse la semana de la publicación.
- La pregunta «¿esto es público o secreto?» tiene una única respuesta canónica y
  tres sitios que la aplican, en vez de tres criterios que puedan divergir.
- Las tres identidades conviven, así que probar staging no obliga a desinstalar
  el entorno de trabajo.

**Lo que se vuelve más difícil, y lo que empeora.**

- **Tres configuraciones que mantener alineadas.** Un cambio en `app.config.ts`
  que sólo se piense para una variante se manifiesta en las otras dos, y hoy no
  hay nada que lo compruebe. Cerrar ese hueco es trabajo de F8.A1.
- **Staging miente a medias mientras apunte al stack local.** Prueba el
  artefacto y el canal de actualización, no la latencia, ni la configuración
  real del backend, ni el TLS. Está escrito arriba para que nadie lo lea como
  más de lo que es.
- **Aparece una dependencia externa nueva —una cuenta de Expo— con una
  superficie que Nomey no controla.** EAS Update introduce un canal por el que
  el JavaScript de una app instalada puede cambiar sin pasar por una tienda. Es
  exactamente la capacidad que se quiere, y también un vector: quien controle esa
  cuenta puede publicar código en Staging.
- **Un criterio normativo de la fase queda abierto a propósito.** Es incómodo y
  es correcto: la alternativa era darlo por cumplido con un stack local
  renombrado, que es peor que tenerlo pendiente.
