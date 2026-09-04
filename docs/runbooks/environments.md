# Entornos de Nomey

> **Cómo se arranca, se resuelve y se verifica cada entorno.** La decisión que
> hay detrás es [ADR-031](../adr/ADR-031-environments-and-variants.md); si este
> documento la contradice, manda el ADR.
>
> Para levantar Supabase en local, [`local-setup.md`](local-setup.md).

---

## Las tres variantes

| `APP_VARIANT` | Nombre visible  | Identificador              | Scheme          | Canal        |
| ------------- | --------------- | -------------------------- | --------------- | ------------ |
| `development` | `Nomey Dev`     | `es.lcworks.nomey.dev`     | `nomey-dev`     | ninguno      |
| `staging`     | `Nomey Staging` | `es.lcworks.nomey.staging` | `nomey-staging` | `staging`    |
| `production`  | `Nomey`         | `es.lcworks.nomey`         | `nomey`         | `production` |

Las tres pueden convivir en el mismo aparato. Difieren **sólo** en esa
identidad y en el canal de actualización: mismo código, mismos plugins, mismo
`runtimeVersion`, mismo proyecto de EAS.

**`APP_VARIANT` no se pone en `.env`.** Pertenece al comando. Si no se define,
resuelve `development`; si se define con un valor que no está en la tabla, falla
diciendo cuáles son los válidos. **Producción no se selecciona nunca sola.**

---

## Development — el bucle de trabajo

```bash
npm start
```

Eso es `node scripts/with-variant.mjs development start`: selecciona la variante
en voz alta y arranca Metro. Después, `a` para Android o `i` para iOS.

Necesita un `.env` con las dos variables públicas apuntando al stack Supabase
local. La plantilla es [`.env.example`](../../.env.example); los valores no se
commitean nunca, porque la URL es la dirección de esta máquina en su red.

- **Emulador de Android** — `localhost` del host se alcanza en `10.0.2.2`.
- **Aparato físico** — la IP de la máquina en la LAN, y el aparato en la misma
  red.

`updates` está **apagado** en development: un binario de desarrollo que
escuchase un canal se reemplazaría el código bajo prueba por lo último
publicado.

---

## Staging — resolver y verificar

Hoy Staging se puede **resolver y verificar**; construirlo es F8.A2/F8.A3, que
son las que traen la cadena nativa de Android.

```bash
npm run config:staging
```

Imprime la configuración pública resuelta. Lo que hay que ver ahí:

```
name:     Nomey Staging
scheme:   nomey-staging
ios/android:  es.lcworks.nomey.staging
updates:  enabled true · expo-channel-name: staging
```

Y la comprobación completa, que es la que corre CI:

```bash
node scripts/variant-matrix-check.mjs
```

Resuelve las tres, comprueba que tienen su identidad, que **no difieren en nada
más**, que una `APP_VARIANT` ausente da `development` y que una desconocida
falla.

Para revisar que ninguna de las tres mete credenciales en el bundle:

```bash
./scripts/bundle-secrets-matrix.sh
```

Exporta las tres con valores públicos ficticios y, además, siembra un secreto a
propósito para comprobar que la guarda **falla**. Tarda unos minutos: son cuatro
exportaciones con la caché limpia.

---

## El entorno EAS `preview` — de dónde saca Staging su configuración

Un APK de Staging no tiene Metro ni el `.env` de esta máquina, así que su
configuración tiene que venir de otro sitio. Ese sitio es el entorno **estándar**
de EAS llamado `preview`, que es el que lee
`eas update --environment preview`.

> **Ojo con los tres nombres, porque no coinciden y es deliberado.** El
> **entorno de EAS** se llama `preview` porque es uno de los tres estándar y no
> se paga por uno personalizado. La **variante de Nomey** se llama `staging`, el
> **canal de actualización** se llama `staging`, y la app en pantalla se llama
> `Nomey Staging`.

Contiene exactamente tres variables, todas **configuración pública de cliente**
con visibilidad `plaintext`:

```
APP_VARIANT                            staging
EXPO_PUBLIC_SUPABASE_URL               la URL LAN del stack local
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY   la publishable key local
```

Se ponen y se refrescan con un solo comando, que **valida antes de enviar** —a
través de `src/lib/env/supabase-env.ts`, la misma frontera que usa la app al
arrancar— y **no imprime ningún valor completo**:

```bash
node scripts/eas-preview-sync.mjs --dry-run   # valida y no envía nada
node scripts/eas-preview-sync.mjs             # valida y escribe en preview
```

> **VUELVE A EJECUTARLO CUANDO CAMBIE LA URL LAN.** Staging apunta
> provisionalmente al stack local por la red local, así que esa URL es la
> dirección de **esta** máquina en **esta** red. Cambiar de red, de router o de
> ordenador deja el valor de EAS caducado, y publicar una actualización sin
> refrescarlo entregaría un Staging que no alcanza ningún backend. **No falla al
> publicar: falla en el aparato**, que es la peor forma de enterarse.

Y se comprueba sin dejar `.env` ni ningún artefacto:

```bash
npx eas-cli@latest env:exec preview "node scripts/staging-env-verify.mjs"
```

Inyecta las variables que EAS guarda para `preview` y afirma que resuelven
`staging`, la identidad `es.lcworks.nomey.staging`, el canal `staging`, una URL
bien formada, una clave que **la frontera real acepta**, y ninguna credencial de
servidor. **No usa `env:pull`**, que escribiría un `.env.local` en el árbol de
trabajo: una verificación que deja credenciales en disco es peor trato que la
comodidad que compra.

**`production` y `development` no tienen ninguna variable en EAS**, y así deben
seguir hasta que exista una razón.

---

## Publicar una actualización al canal `staging` — todavía no

**No se ha publicado ninguna, y es deliberado: no existe aún la build de Staging
que pudiera recibirla.** Publicar antes dejaría una actualización en un canal sin
destinatario, y la primera vez que algo así se prueba conviene que haya un
aparato delante.

Cuando exista el APK de Staging (F8.A3/F8.A5), el comando será:

```bash
npx eas-cli@latest update --channel staging --environment preview --message "..."
```

Y **antes de la primera vez hay que crear el canal**, que hoy no existe —
comprobado: `eas channel:list` y `eas branch:list` están vacíos—. Sin EAS Build
nadie lo crea por su cuenta:

```bash
npx eas-cli@latest channel:create staging
```

Tres cosas más que hay que tener claras antes de escribirlo:

- **El canal viaja en el binario, no en el comando.** Lo lleva la cabecera
  `expo-channel-name` que fija `app.config.ts`, porque Nomey no usa EAS Build y
  no hay perfil de compilación donde declararlo.
- **`runtimeVersion` usa la política `appVersion`**, así que una actualización
  sólo llega a un binario cuya `version` coincida. Cualquier cambio nativo del
  que dependa el JavaScript —un módulo nuevo, un permiso nuevo, una subida de
  SDK— exige **subir `version` y compilar un binario nuevo**; publicarlo al
  runtime antiguo entregaría JavaScript que llama a código nativo que ese
  binario no tiene.
- **Cada binario posterior incrementa su contador**: `android.versionCode` y
  `ios.buildNumber`. Hoy los dos valen 1.

---

## Lo que Staging todavía NO es

**Staging depende de este ordenador.** Apunta provisionalmente al mismo stack
Supabase local, alcanzado por la red local: si la máquina está apagada, o el
aparato está en otra red, Staging no tiene backend. Lo que separa a Staging de
Development hoy es la identidad, el artefacto sin Metro y el canal de
actualización — **no el backend**.

> **Esto NO cumple el criterio 2 de cierre de la Fase 8**, que pide «al menos un
> entorno distinto del local». Un stack local alcanzado por otra ruta sigue
> siendo el mismo entorno. El criterio queda **pendiente**, escrito como
> pendiente, hasta que exista un backend alojado —
> [ADR-031](../adr/ADR-031-environments-and-variants.md) §4.

**Production no tiene nada más que identidad.** Ni proyecto de backend, ni
credenciales, ni actualización publicada, ni build. Se puede resolver su
configuración, y eso es todo lo que hay.

---

## Variables, y cuál es cuál

| Variable                               | Qué es                    | Development                  | Staging               |
| -------------------------------------- | ------------------------- | ---------------------------- | --------------------- |
| `APP_VARIANT`                          | Selección de build        | **El comando.** Nunca `.env` | Entorno EAS `preview` |
| `EXPO_PUBLIC_SUPABASE_URL`             | Configuración **pública** | `.env`, sin versionar        | Entorno EAS `preview` |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Configuración **pública** | `.env`, sin versionar        | Entorno EAS `preview` |

Las dos `EXPO_PUBLIC_` **viajan dentro del binario**, y es correcto: están
diseñadas para eso. **No son secretos**, y llamarlas así sería la clase de
imprecisión que acaba con alguien tratando un secreto de verdad como si fuera
una de ellas.

Lo que no puede entrar en ninguna de las dos, ni en `.env.example`, ni en
GitHub Actions, ni en la configuración de EAS del cliente: una clave
`sb_secret_`, cualquier JWT heredado, una contraseña, un token personal o una
clave privada. Lo comprueban tres capas independientes, descritas en
[`.env.example`](../../.env.example) y en
[`AGENTS.md`](../../AGENTS.md) §7.
