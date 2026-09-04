# Cadena nativa de Android

> **Cómo dejar una máquina Windows capaz de generar el proyecto Android de
> Nomey con CNG.** La decisión que hay detrás es
> [ADR-030](../adr/ADR-030-native-code-model.md); los entornos y las variantes,
> [ADR-031](../adr/ADR-031-environments-and-variants.md) y
> [`environments.md`](environments.md).
>
> **Este documento no compila la app.** Llega hasta el proyecto nativo generado
> y verificado. La primera development build es de F8.A3.

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

> **Sobre las licencias.** `sdkmanager --licenses` abre un cuestionario
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

## 6 · Qué es artefacto y qué es fuente

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

## 7 · Cuándo hay que repetir `prebuild --clean`

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

## 8 · Diagnóstico de lo que suele fallar

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

## 9 · Lo que este runbook NO cubre

Compilar, instalar y mirar. La development build, el emulador, el aparato
físico y la validación visual del icono, la máscara adaptativa, el icono
monocromo y el splash son **F8.A3**. Aquí sólo se llega a un proyecto generado
y verificado por inspección.
