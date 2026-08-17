# Riesgos conocidos en dependencias

**Estado: abierto, pendiente de seguimiento.**
Última revisión: 2026-08-17 (Fase 0).

## Situación

`npm audit` reporta **22 entradas** (8 moderate, 14 high) en el árbol de
dependencias. Todas son **anteriores a la Fase 0**: aparecieron al instalar
ESLint, pero `npm audit --omit=dev` las sitúa en el árbol de producción, es
decir provienen de las dependencias de Expo y React Native, no del tooling de
linting.

## Origen real

Solo **2 paquetes** tienen un aviso propio. Los otros 20 figuran únicamente por
depender de una versión vulnerable de alguno de ellos.

### Avisos raíz

| Paquete      | Severidad | Aviso                                                              |
| ------------ | --------- | ------------------------------------------------------------------ |
| `image-size` | high      | DoS por bucle infinito en los parsers ICNS, y en los de JXL y HEIF |
| `uuid`       | moderate  | Falta comprobación de límites de buffer en v3/v5/v6 al pasar `buf` |

### Por arrastre (20)

`@expo/cli`, `@expo/config`, `@expo/config-plugins`, `@expo/inline-modules`,
`@expo/local-build-cache-provider`, `@expo/metro`, `@expo/metro-config`,
`@expo/prebuild-config`, `@react-native/community-cli-plugin`,
`@react-native/metro-config`, `@react-native/virtualized-lists`, `expo`,
`expo-splash-screen`, `metro`, `metro-config`, `metro-transform-worker`,
`react-native`, `react-native-reanimated`, `react-native-worklets`, `xcode`.

## Evaluación de exposición — NO CONCLUIDA

Muchos de los paquetes afectados son herramientas de build (Metro,
`prebuild-config`, `xcode`, la CLI), que en principio se ejecutan en la máquina
de desarrollo o en el builder y no en el dispositivo.

**Pero eso no se ha verificado paquete por paquete, y no debe afirmarse.** En
la lista de arrastre figuran `react-native`, `react-native-reanimated` y
`react-native-worklets`, que **sí** forman parte del binario distribuido. Que
aparezcan por arrastre no determina por sí solo si el código vulnerable
concreto (`image-size`, `uuid`) llega o no al bundle: eso depende de qué rutas
de import alcanza Metro desde el punto de entrada.

Por tanto, hasta hacer esa comprobación, esto queda registrado como
**riesgo transitivo pendiente de evaluación**, no como riesgo descartado.

## Decisión tomada

**No se ha ejecutado `npm audit fix --force`**, y no debe ejecutarse.

Forzaría cambios de versión sobre paquetes de Expo y React Native fijados por
el SDK 57, con alta probabilidad de romper la instalación. La corrección
legítima llega cuando Expo publique versiones con las dependencias
actualizadas.

## Trabajo pendiente

- [ ] Determinar, para `image-size` y `uuid`, si el código vulnerable es
      alcanzable desde el bundle de la app o solo desde el tooling de build.
- [ ] Revisar si `uuid` acaba en el bundle a través de `react-native-worklets`
      o `react-native-reanimated`.
- [ ] Reevaluar tras cada actualización del SDK de Expo.
- [ ] Considerar `overrides` en `package.json` solo si la evaluación confirma
      exposición real y Expo aún no ha publicado corrección. Es un parche
      arriesgado: puede desalinear versiones respecto a lo que el SDK espera.

## Cómo reproducir el análisis

```bash
npm audit
```

```bash
npm audit --omit=dev
```
