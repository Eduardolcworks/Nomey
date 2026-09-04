# Cadena nativa de Android

> **Cómo dejar una máquina Windows capaz de generar el proyecto Android de
> Nomey con CNG.** La decisión que hay detrás es
> [ADR-030](../adr/ADR-030-native-code-model.md); los entornos y las variantes,
> [ADR-031](../adr/ADR-031-environments-and-variants.md) y
> [`environments.md`](environments.md).
>
> **Cubre hasta la development build de Development instalada en un aparato.**
> La validación funcional completa —alta, sesión, cola, sincronización— es de
> F8.A4, y Staging es de F8.A5.

Todas las rutas se escriben con marcadores. Sustituye `<LOCALAPPDATA>` por lo
que valga en tu máquina; ninguna ruta concreta se versiona aquí a propósito.

---

## 1 · JDK 17

Expo SDK 57 y React Native 0.86 se compilan con **JDK 17**. Es la versión que
pide la [documentación de Expo](https://docs.expo.dev/get-started/set-up-your-environment/),
y no es negociable por conveniencia.

> **El JBR que trae Android Studio no sirve.** Android Studio incluye su propio
> runtime —hoy un OpenJDK 25— para ejecutarse a sí mismo. Usarlo como JDK del
> proyecto pone a Gradle y al plugin de Android en una versión de Java que no
> soportan, y el error que sale no dice «JDK equivocado»: dice cualquier otra
> cosa.

Dos vías, las dos oficiales:

```bash
# Con el gestor de paquetes de Windows
winget install Microsoft.OpenJDK.17

# O el zip oficial de Microsoft, sin elevación de permisos
#   https://aka.ms/download-jdk/microsoft-jdk-17-windows-x64.zip
# descomprimido en <LOCALAPPDATA>\Programs\Microsoft\
```

El zip es el que se usó aquí, porque no necesita permisos de administrador y
deja todo dentro del perfil del usuario.

---

## 2 · SDK de Android y command-line tools

Se parte de un Android Studio ya instalado, que trae el SDK en
`<LOCALAPPDATA>\Android\Sdk`. Faltan dos cosas.

**Platform 36.** Es la que exige la cadena: el plugin de Gradle de Expo
—`expo-modules-core`, `ProjectConfiguration.kt`— usa `compileSdkVersion 36` y
`targetSdkVersion 36` por defecto. Tener instalada la 35 o la 37 **no** vale.

**Command-line tools.** Sin ellas no hay `sdkmanager`, y sin `sdkmanager` no se
puede instalar nada desde un terminal.

```bash
# Descarga el zip "Command line tools only" de
#   https://developer.android.com/studio
# y comprueba su SHA-256 contra el que publica esa misma página.
```

Se descomprime de forma que quede exactamente así — el zip trae una carpeta
`cmdline-tools` que hay que **renombrar a `latest`**:

```
<LOCALAPPDATA>\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat
```

Con eso ya se puede instalar la plataforma:

```bash
sdkmanager "platforms;android-36"
```

> **Gradle instala componentes por su cuenta, y F8.A2 se equivocó al decir que
> no harían falta.** Con `newArchEnabled=true`, `expo-updates`,
> `react-native-worklets`, `react-native-screens` y `react-native-reanimated`
> compilan C++, así que la primera compilación descarga e instala **CMake 3.22.1
> y el NDK** sin que nadie se lo pida, aceptando sus licencias bajo el
> `android-sdk-license` ya aceptado. Aparece en el log como
> `License for package CMake 3.22.1 accepted`. **No hay que instalarlos a mano**;
> conviene saberlo porque explica buena parte de los 35 minutos de la primera vez.

> **Sobre las licencias que Gradle NO resuelve.** `sdkmanager --licenses` abre un cuestionario
> interactivo que **no acepta entrada por tubería**: hay que ejecutarlo en un
> terminal de verdad y pulsar `y` en cada pregunta. En esta máquina no hizo
> falta: la licencia que cubre las plataformas, las build-tools y las
> platform-tools —`android-sdk-license`— ya estaba aceptada, y la prueba es que
> `platforms;android-36` se instaló sin protestar. Las que quedan sin aceptar
> son de paquetes que Nomey no instala. **Si algún día Gradle se queja de una
> licencia, ése es el momento de abrir un terminal y pulsar `y`**, no antes.

---

## 3 · Variables de entorno

Se definen **en el ámbito de usuario**, no en el de máquina: no hacen falta
permisos de administrador y no afectan a nadie más.

| Variable       | Valor                        |
| -------------- | ---------------------------- |
| `JAVA_HOME`    | la carpeta del JDK 17        |
| `ANDROID_HOME` | `<LOCALAPPDATA>\Android\Sdk` |

Y al `PATH` del usuario, **añadiendo sin borrar nada de lo que ya hubiera**:

```
<JAVA_HOME>\bin
<ANDROID_HOME>\platform-tools
<ANDROID_HOME>\cmdline-tools\latest\bin
```

> **`ANDROID_SDK_ROOT` se deja sin definir, a propósito.** Está obsoleta, y
> tener las dos es una invitación a que apunten a sitios distintos y a que cada
> herramienta elija una. Si ya existe en tu máquina, **haz que valga
> exactamente lo mismo que `ANDROID_HOME`** o bórrala; nunca dos rutas.

---

## 4 · Verificación, desde un terminal NUEVO

Es el paso que importa. Un terminal que ya estaba abierto conserva el entorno
que tenía al arrancar, así que comprobar ahí sólo demuestra que las variables
existen **en esa sesión**, no que hayan quedado guardadas.

**Abre un terminal nuevo** y ejecuta:

```bash
java -version        # openjdk 17.x
javac -version       # javac 17.x
adb version          # Android Debug Bridge 1.0.x
sdkmanager --list_installed
```

Lo que tiene que aparecer en `--list_installed`:

```
build-tools;36.0.0
platform-tools
platforms;android-36
```

Si `java -version` dice 25, el `PATH` está resolviendo el JBR de Android Studio
antes que el JDK 17: revisa el orden de las entradas.

---

## 5 · Generar el proyecto Android

```bash
node scripts/with-variant.mjs development prebuild --platform android --clean
```

Nunca un `expo prebuild` a secas: la variante se nombra en voz alta, y sin
nombrarla se resolvería `development` por defecto —que hoy es lo mismo, pero
deja la identidad implícita, que es justo lo que ADR-031 evita—.

Y a continuación, siempre:

```bash
node scripts/android-project-check.mjs
```

Comprueba sobre el proyecto generado lo que no se ve de un vistazo: que la
identidad es `es.lcworks.nomey.dev`, que **no hay rastro de Staging ni de
Producción**, que las actualizaciones están apagadas y sin canal, que los
plugins se aplicaron —`expo-secure-store` con sus reglas de backup incluidas—,
que el splash y los fondos llevan los colores del tema, y que no hay ninguna
credencial dentro.

---

## 6 · Compilar e instalar la development build

**Qué es y en qué se diferencia de Expo Go.** Expo Go es una aplicación ajena
que carga el JavaScript de Nomey dentro de **su** binario, con **sus** módulos
nativos y **su** identidad: por eso sustituye el icono y el splash por los
suyos, y por eso no puede ejecutar un módulo nativo que no lleve dentro. La
**development build** es lo contrario: es **Nomey**, con su paquete, su icono y
sus módulos, y `expo-dev-client` es lo único que le añade la capacidad de cargar
el JavaScript desde Metro en vez de empotrado. Desde F8.A3, **el camino de
Android es la development build**; Expo Go sigue siendo la vía de iOS hasta
F8.B, y allí se sabe lo que se pierde.

El cliente se instala con la versión que elige el SDK, nunca a mano:

```bash
npx expo install expo-dev-client
node scripts/with-variant.mjs development prebuild --platform android --clean
```

Arrancar el emulador y esperar a que termine de arrancar de verdad:

```bash
emulator -avd Pixel_7 -no-boot-anim
adb wait-for-device
adb shell getprop sys.boot_completed    # 1 cuando ya se puede instalar
```

Y compilar:

```bash
node scripts/with-variant.mjs development run:android --device Pixel_7 --variant debug
```

> **`--device` toma el NOMBRE DEL AVD, no el serial de `adb`.** Medido:
> `--device emulator-5554` falla con `Could not find device with name`. El
> nombre que Expo espera es el que devuelve
> `adb -s emulator-5554 emu avd name`, que para este emulador es `Pixel_7`.
> Para un aparato físico, el nombre es su modelo tal y como lo lista
> `adb devices -l`.

**Dónde queda el APK:**

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Es un artefacto dentro de un artefacto: no se versiona, no se comparte y se
regenera. El APK que se entrega a alguien es otra cosa y llega en F8.A5.

**Metro.** `run:android` deja el servidor arrancado al terminar. Si se cierra,
se vuelve a levantar con `npm start`, que ya nombra la variante. En el emulador
la conexión es automática; en un aparato físico por USB se necesita
`adb reverse tcp:8081 tcp:8081`, y por LAN basta con estar en la misma red.

---

## 7 · Lo que falló de verdad, y cuánto tardó

**Tiempos medidos**, con el estado de la caché en cada momento:

| Compilación             | Tiempo          | Tareas                                      |
| ----------------------- | --------------- | ------------------------------------------- |
| Primera, desde cero     | **35 min 42 s** | 542: 438 ejecutadas, 92 de caché, 12 al día |
| Cambio de ABI a arm64   | **2 min 45 s**  | 542: 44 ejecutadas, 498 al día              |
| Cambio de asset, x86_64 | **2 min 14 s**  | 542: 39 ejecutadas, 503 al día              |
| Cambio de asset, arm64  | **3 min 25 s**  | 542: 506 ejecutadas, 36 al día              |

La primera se va casi entera en descargar: la distribución de Gradle, el árbol
de AGP y Kotlin, y el CMake y el NDK que la nueva arquitectura necesita.

**El plugin de Kotlin no se resolvió a la primera.** La primera pasada murió a
los 10 min 11 s con:

```
Build file 'node_modulesexpo-updatesexpo-updates-gradle-pluginuild.gradle.kts' line: 4
Plugin [id: 'org.jetbrains.kotlin.jvm', version: '2.2.0'] was not found
  Searched in: Gradle Central Plugin Repository
```

Ese `build.gradle.kts` declara `kotlin("jvm") version("2.2.0")` y su
`settings.gradle.kts` está vacío, así que sólo mira el Gradle Plugin Portal —
donde ese artefacto **sí existe**. Fue un fallo **transitorio de red** con
media cadena descargándose en paralelo: **el reintento, sin cambiar una sola
versión ni línea de configuración, lo resolvió**. Si vuelve a pasar, reintentar
antes que tocar nada.

**Y un bloqueo de fichero de Windows**, en una recompilación posterior:

```
Execution failed for task ':expo-modules-core:bundleLibCompileToJarDebug'.
> Unable to delete file '...expo-modules-coreandroiduild...classes.jar'
```

Un daemon de Gradle anterior retenía el `.jar`. Se arregla con
`./gradlew --stop` desde `android/` y repetir. Tampoco exige cambiar nada.

**Los `.webp` que llevan bytes PNG no son un problema.** `prebuild` genera
`mipmap-*/ic_launcher*.webp` cuyo contenido es PNG —magic `89 50 4E 47`—, y
**AAPT2 los acepta**: `mergeDebugResources`, `processDebugResources` y
`packageDebug` completan sin un error y `aapt2 dump badging` lee el APK
resultante. **No se renombran.** Queda registrado porque llama la atención al
mirar la carpeta generada.

---

## 8 · Un aparato físico, y lo que MIUI no deja hacer

Medido en un POCO X4 Pro 5G con **MIUI V816**. Nada de esto es un defecto de
Nomey; es el aparato.

- **`adb install` de un paquete NUEVO se rechaza** con
  `INSTALL_FAILED_USER_RESTRICTED: Install canceled by user`, sin que aparezca
  ningún diálogo. Lo gobierna «Instalar vía USB» de Opciones de desarrollador,
  que Xiaomi condiciona a una cuenta Mi. **La primera instalación se hace a
  mano**: `adb push` del APK a `Download` y tocarlo desde el gestor de archivos.
- **Pero ACTUALIZAR un paquete ya instalado sí funciona por ADB.** Comprobado:
  `firstInstallTime` se queda en la instalación manual y `lastUpdateTime` avanza
  con cada `run:android`. Es decir: **el paso manual es sólo el primero**.
- **`adb shell input` está bloqueado**:
  `SecurityException: Injecting input events requires INJECT_EVENTS permission`.
  Depende de «Depuración USB (Ajustes de seguridad)», también con cuenta Mi. En
  la práctica: **no se puede pilotar la interfaz del móvil por ADB**, así que
  elegir el servidor en el Development Client lo tiene que hacer una persona.
  `screencap`, `screenrecord`, `am start` y `logcat` sí funcionan.
- **MIUI no ofrece «Iconos temáticos».** El icono monocromo no se puede validar
  visualmente ahí; se valida en el emulador, cuyo lanzador sí lo expone.
- **La LAN no sirve para Metro desde el móvil**: `192.168.x.x:8081` responde
  `HTTP 000` porque el cortafuegos de Windows bloquea el puerto entrante. **Por
  USB sí**, con `adb reverse tcp:8081 tcp:8081`, y entonces
  `curl http://localhost:8081/status` desde el aparato devuelve
  `HTTP 200 · packager-status:running`. **Ésa es la vía buena**, y además no
  depende de en qué red esté el teléfono.

---

## 9 · Qué es artefacto y qué es fuente

**`/android` y `/ios` son artefactos.** Están en `.gitignore`, se regeneran sin
pérdida y **no se editan a mano jamás** — ADR-030 §1.

Una edición manual sobrevive exactamente hasta el siguiente `prebuild --clean`,
que la borra sin avisar. Peor: mientras dura, funciona, así que se convierte en
conocimiento que vive en una sola máquina. Si algo del proyecto nativo tiene que
cambiar, se cambia **`app.config.ts` o un config plugin local** y se vuelve a
generar.

La fuente es:

```
app.config.ts          identidad, plugins, splash, updates
assets/                los originales de marca y sus derivados
scripts/               los comandos que generan y comprueban
```

---

## 10 · Cuándo hay que repetir `prebuild --clean`

Siempre que cambie algo que el proyecto nativo haya copiado dentro:

- cualquier cosa de `app.config.ts` — identidad, esquema, plugins, `updates`,
  `runtimeVersion`, colores del splash;
- un asset de icono o de splash;
- añadir, quitar o actualizar un módulo nativo;
- subir el SDK de Expo o React Native;
- cambiar de variante — el proyecto generado lleva **una** identidad dentro, y
  la que hay es la de la última generación.

Sin `--clean` puede quedar mezcla de la generación anterior. Con `--clean` no
se pierde nada, porque no hay nada que perder: es un artefacto.

---

## 11 · Diagnóstico de lo que suele fallar

| Síntoma                                                    | Causa casi segura                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `Unsupported class file major version` · errores de Gradle | `JAVA_HOME` apunta al JBR 25 de Android Studio, o el `PATH` lo resuelve antes que el JDK 17        |
| `SDK location not found`                                   | `ANDROID_HOME` sin definir, o definido sólo en la sesión y no de forma persistente                 |
| `Failed to find target with hash string 'android-36'`      | Falta `platforms;android-36`: instalada la 35 o la 37 no sirve                                     |
| `sdkmanager` no se encuentra                               | Faltan las command-line tools, o no están en `cmdline-tools\latest\bin`                            |
| `You have not accepted the license agreements`             | Abre un terminal **interactivo**, ejecuta `sdkmanager --licenses` y pulsa `y`. Por tubería no vale |
| `adb` no se encuentra                                      | `platform-tools` no está en el `PATH`                                                              |
| El proyecto sale con otra identidad                        | Se generó sin nombrar la variante, o con otra. Repite el `prebuild --clean` con la correcta        |
| Los cambios de `app.config.ts` no aparecen                 | Falta regenerar: el proyecto nativo es una copia, no una vista                                     |

---

## 12 · La validación funcional dentro de la build · F8.A4

Reproduce dentro del binario propio la matriz que la Fase 7 validó en Expo Go
—[`phase-7-handoff.md`](../architecture/phase-7-handoff.md) §4— sobre el
emulador `Pixel_7` y el stack local, con **dos actores desechables**,
`f8a4-alpha@nomey.test` y `f8a4-beta@nomey.test`, retirados al terminar.

| Qué                                        | Resultado                                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Alta, acceso y cierre en frío              | La sesión sobrevive por **SecureStore**; sin servidor sigue identificada                     |
| Cierre de sesión                           | Vuelve a `Entrar`; la sesión siguiente no ve nada de la anterior                             |
| Gasto e ingreso conectados                 | Cifras, filas, orden, categoría y donut, persistidos                                         |
| Registro sin conexión                      | Proyección inmediata y sin marca de pendiente; sobrevive a `force-stop`                      |
| Sincronización al volver el servidor       | Silenciosa y sin recargar nada; **ninguna cifra saltó**                                      |
| Servidor, tras sincronizar                 | **3 operaciones, 3 claves.** Cero claves con más de una operación, cero conceptos duplicados |
| Aislamiento entre actores                  | Ámbitos disjuntos; **cero ámbitos con efectos de dos actores**; cero fugas en pantalla       |
| Incidencia ordinaria de ADR-029, `Sí`/`No` | Texto literal del ADR; `Sí` recreó la intención, `No` la resolvió sin llamar al servidor     |

Tres cosas que conviene no volver a descubrir:

- **Un rechazo terminal no quema la clave.** Medido: con la categoría dada de
  baja en el servidor, la frontera respondió `CATEGORY_NOT_USABLE` y el censo se
  quedó igual —mismas operaciones y **mismas claves**—, porque la reclamación de
  ADR-011 §13 vive dentro de la misma transacción que el rechazo aborta. Pulsar
  `Sí` tampoco creó ninguna: la intención nueva volvió a ser rechazada.
- **El cliente retira la categoría al pasar de Gasto a Ingreso**, y no sólo la
  oculta. Comprobado de extremo a extremo: el ingreso llegó al servidor con
  **cero** filas de categoría, así que ADR-027 no depende de que la frontera lo
  rechace.
- **El globo «Tools» del dev-client se solapa con el botón de Perfil** —
  `937–1005 × 213–281` sobre `903–1017 × 136–252`— y se lleva el toque. Es un
  overlay del cliente de desarrollo, **no de Nomey**: no existe en una build de
  Staging o de producción. Al pilotar por `adb`, toca la mitad libre del botón.

### Un defecto de Nomey, encontrado aquí

**Sin servidor, `Deudas` afirma `0,00 €` mientras todo lo demás degrada a `—`.**
En el arranque en frío sin frontera, `Disponible`, `Ingresos` y `Gastos` se
muestran como no disponibles y el donut dice «Reparto no disponible»; `Deudas`,
en cambio, publica una cifra que no puede conocer. Es una cifra contable
presentada como cierta cuando no lo es, justo lo que
[`design-direction.md`](../product/design-direction.md) pide que nunca sea
ambiguo. **No se arregla en F8.A4**: este bloque valida, no cambia producto.

---

## 13 · Lo que este runbook NO cubre

Staging, su canal de EAS Update y el APK que se entrega a alguien son de
**F8.A5**. Y todo lo de iOS, de **F8.B**.
