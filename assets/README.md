# Assets

```
assets/
├── icons/    # originales de marca + icono de app y capas de Android
└── splash/   # arte del splash
```

## Identidad

La marca de Nomey tiene **dos variantes reales**, y ninguna sustituye a la otra:

| Original                   | Variante                     | Uso                                            |
| -------------------------- | ---------------------------- | ---------------------------------------------- |
| `nomey-logo-on-yellow.png` | Símbolo negro sobre amarillo | **Principal.** App icon en iOS y Android       |
| `nomey-logo-on-black.png`  | Símbolo amarillo sobre negro | **Secundaria.** Splash y usos sobre fondo dark |

**Que el icono sea amarillo no cambia la dirección de la app.** El interior
sigue siendo dark-first, con negro dominante y el amarillo como acento
minoritario. Un icono tiene que encontrarse en una pantalla de inicio llena; una
interfaz financiera tiene que leerse.

El amarillo **funcional** es `#FDC506`, y su fuente es
`src/ui/theme/colors.ts`. Los dos originales son renders con degradado, bisel y
brillo: eso pertenece al asset, **no** a la interfaz, y no se extrapola a los
componentes.

## Qué es original y qué es derivado

**Los dos `nomey-logo-*.png` son la fuente de verdad y no se editan.** Todo lo
demás lo genera `scripts/derive-brand-assets.ps1` a partir de ellos —recorte,
clave de color, escalado y margen—, de modo que **la geometría del símbolo nunca
se redibuja ni se aproxima**. Si cambia un original, se vuelve a ejecutar:

```bash
powershell -ExecutionPolicy Bypass -File scripts/derive-brand-assets.ps1
```

| Derivado                            | De         | Qué es                                            |
| ----------------------------------- | ---------- | ------------------------------------------------- |
| `icons/icon.png`                    | Principal  | 1024×1024, **sin alfa**, fondo amarillo a sangre  |
| `icons/android-icon-foreground.png` | Principal  | Símbolo solo, dentro de la zona segura de Android |
| `icons/android-icon-monochrome.png` | Principal  | Silueta para el icono temático de Android 13+     |
| `splash/splash-icon.png`            | Secundaria | Símbolo amarillo sobre transparente               |

**El icono de app se compone, no se recorta del render.** El original tiene las
esquinas redondeadas a un tercio de su anchura, bastante más que la máscara de
iOS, así que a sangre se verían sus propios recortes dentro de la máscara del
sistema; y repintar esas esquinas solo dispone del bisel oscurecido, que
extendido da estrías o esquinas sucias. Recortar por dentro del bisel evita
inventar píxeles pero amplía el símbolo hasta el 90 % del marco, donde la
máscara sí lo corta. Así que el icono lleva **el fondo plano de marca y el
símbolo extraído por clave de color**, a la misma proporción —72,8 %— que tiene
en el original. El brillo se queda en el original, que es para lo que está.

`app.config.ts` fija el fondo del splash y de la vista raíz al **negro** del
tema, y el del icono adaptativo al **amarillo** de marca.
`tests/infra/brand-chrome.test.ts` falla si cualquiera de los dos deja de
coincidir con su token, o si aparece un hex suelto.

**No hay capa `background` de Android.** Con un `backgroundColor` plano sobra, y
el archivo que había era del template.

## Sobre el icono de iOS 26 (`.icon`)

`app.config.ts` usa `icons/icon.png` y **no declara `ios.icon`**.

Si se quiere el formato `.icon` de iOS 26 —con sus capas y su composición
propia— hay que crear `assets/nomey.icon/` y apuntar `ios.icon` a él. Lo genera
Icon Composer (Xcode) a partir de los originales; no debe escribirse a mano.

## Presupuesto de peso

**El presupuesto de ~150 KB es para assets que entran en el bundle de
JavaScript**, donde cada KB es descarga y memoria en el arranque.

Los originales de marca y el icono de app no están en ese bundle: los originales
no los referencia nadie en código, y el icono y el splash los consume la
**cadena nativa**, que los recodifica en el binario. Por eso pesan lo que pesan
—los originales rondan 1,2 MB cada uno y `icon.png` unos 337 KB— y por eso no
incumplen nada. Un asset que sí se cargue en tiempo de ejecución sigue sujeto al
presupuesto.
