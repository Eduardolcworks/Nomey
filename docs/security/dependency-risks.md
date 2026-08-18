# Riesgos conocidos en dependencias

**Estado: abierto, con seguimiento periódico.**

> **El número de advisories no es una propiedad del lockfile.** `npm audit`
> consulta la base de datos de avisos **en el momento de ejecutarse**, y esa
> base cambia: se publican avisos nuevos, se reclasifican severidades y se
> retiran entradas. Dos ejecuciones sobre el mismo `package-lock.json` pueden
> dar cifras distintas sin que el proyecto haya cambiado.
>
> Por eso toda cifra de este documento va **fechada y atada a un entorno**, y
> debe releerse como una observación puntual, no como un atributo del
> repositorio.

## Observación de referencia

| Campo             | Valor                                         |
| ----------------- | --------------------------------------------- |
| Fecha de consulta | 2026-08-17, ~16:58 UTC                        |
| Node              | 22.23.2                                       |
| npm               | 10.9.8                                        |
| Comando           | `npm audit` y `npm ci`                        |
| Resultado         | **22 vulnerabilidades — 8 moderate, 14 high** |

### Discrepancia registrada

Una auditoría del repositorio realizada poco antes, con el mismo entorno
declarado, observó **42 vulnerabilidades (7 moderate, 35 high)** al ejecutar
`npm ci`. **No se ha conseguido reproducir esa cifra**: en la consulta de
referencia de arriba, tanto `npm audit` como `npm ci` devuelven 22 (8/14).

No se ha determinado la causa. Las hipótesis razonables son un cambio en la
base de avisos entre ambas ejecuciones, o una diferencia en el estado del árbol
instalado. **No se descarta que la observación de 42 fuera correcta en su
momento.**

Esa discrepancia es la mejor ilustración del aviso de arriba: la cifra depende
del instante de consulta, así que este documento no la presenta como un hecho
estable del proyecto.

## Origen, en la observación de referencia

Solo **2 paquetes** tenían un aviso propio. Los otros 20 figuraban únicamente
por depender de una versión vulnerable de alguno de ellos.

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

**Eso no se ha verificado paquete por paquete y no debe afirmarse.** En la
lista de arrastre figuran `react-native`, `react-native-reanimated` y
`react-native-worklets`, que **sí** forman parte del binario distribuido. Que
aparezcan por arrastre no determina si el código vulnerable concreto
(`image-size`, `uuid`) llega al bundle: eso depende de qué rutas de import
alcanza Metro desde el punto de entrada.

Queda registrado como **riesgo transitivo pendiente de evaluación**, no como
riesgo descartado.

## Decisión tomada

**No se ejecuta `npm audit fix --force`.** Forzaría cambios de versión sobre
paquetes de Expo y React Native fijados por el SDK 57, con alta probabilidad de
romper la instalación. La corrección legítima llega cuando Expo publique
versiones con las dependencias actualizadas.

## Trabajo pendiente

- [ ] Determinar, para los avisos raíz vigentes, si el código vulnerable es
      alcanzable desde el bundle de la app o solo desde el tooling de build.
- [ ] Reevaluar tras cada actualización del SDK de Expo, y **volver a fechar
      este documento** en cada revisión.
- [ ] Considerar `overrides` en `package.json` solo si la evaluación confirma
      exposición real y Expo aún no ha publicado corrección. Es un parche
      arriesgado: puede desalinear versiones respecto a lo que el SDK espera.

## Cómo reproducir

Con el Node y npm declarados en `.nvmrc` y `engines`:

```bash
npm audit --json
```

```bash
npm audit --omit=dev --json
```

Anota **fecha, versión de Node y de npm** junto al resultado. Sin esos tres
datos, la cifra no significa nada.
