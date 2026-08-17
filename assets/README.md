# Assets

```
assets/
├── icons/        # app icon + Android adaptive icon layers
├── splash/       # splash screen artwork
└── nomey.icon/   # iOS 26 .icon bundle (INACTIVE - see below)
```

## Estado actual

**Todo el arte de esta carpeta sigue siendo el del template de Expo.** Se
conserva únicamente para que la app compile y arranque. Debe sustituirse por la
identidad visual de Nomey (negro y amarillo) antes de cualquier build de tienda.

Pendiente de recibir:

- icono de app (`icons/icon.png`)
- capas del icono adaptativo de Android (foreground / background / monochrome)
- arte del splash (`splash/splash-icon.png`)
- contenido del bundle `nomey.icon`

## Sobre `nomey.icon/`

Es el formato de icono de iOS 26. La carpeta conserva la estructura y el
`icon.json` del template como andamiaje, pero **sus capas (`Assets/`) se
eliminaron por ser marca de Expo**, de modo que el bundle está incompleto.

Por eso `app.config.ts` **no** lo referencia todavía: usa `icons/icon.png`. Al
incorporar el icono de Nomey, hay que añadir las capas a `nomey.icon/Assets/`,
actualizar `icon.json` y entonces apuntar `ios.icon` a `./assets/nomey.icon`.

## Presupuesto de peso

El `icon.png` del template pesa ~800 KB, desproporcionado. Al sustituirlo,
mantener los assets por debajo de ~150 KB salvo justificación.
