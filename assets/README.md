# Assets

```
assets/
├── icons/    # app icon + Android adaptive icon layers
└── splash/   # splash screen artwork
```

## Estado actual

**Todo el arte de esta carpeta sigue siendo el del template de Expo.** Se
conserva únicamente para que la app compile y arranque. Debe sustituirse por la
identidad visual de Nomey (negro y amarillo) antes de cualquier build de tienda.

Pendiente de recibir:

- icono de app (`icons/icon.png`)
- capas del icono adaptativo de Android (foreground / background / monochrome)
- arte del splash (`splash/splash-icon.png`)

## Sobre el icono de iOS 26 (`.icon`)

El template traía un bundle `expo.icon/` con un `icon.json` que referenciaba
capas de marca de Expo. Al eliminar esas capas, el `icon.json` quedó apuntando
a archivos inexistentes, así que **se ha eliminado**: un manifiesto roto no es
andamiaje útil, es una trampa para quien lo encuentre.

`app.config.ts` usa `icons/icon.png` y **no declara `ios.icon`**.

Cuando llegue la identidad visual de Nomey, si se quiere el formato `.icon` de
iOS 26 hay que crear `assets/nomey.icon/` con sus capas y su `icon.json`, y
entonces apuntar `ios.icon` a `./assets/nomey.icon`. Lo genera Icon Composer
(Xcode); no debe escribirse a mano.

## Presupuesto de peso

El `icon.png` del template pesa ~800 KB, desproporcionado. Al sustituirlo,
mantener los assets por debajo de ~150 KB salvo justificación.
