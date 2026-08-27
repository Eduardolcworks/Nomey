# Estado del proyecto

> **Memoria comprimida para una sesión nueva.** Describe **dónde está Nomey
> ahora**, no cómo llegó. No decide nada: si contradice un ADR,
> [`data-model.md`](architecture/data-model.md) o el
> [roadmap](product/roadmap.md), mandan ellos.
>
> **Léelo después de [`AGENTS.md`](../AGENTS.md).** Con esos dos, y la
> documentación específica de la fase en curso cuando exista, basta para empezar;
> el resto se consulta **bajo demanda**.
>
> **Cómo se mantiene:** [`runbooks/project-context.md`](runbooks/project-context.md).
> En una línea: **lo que deja de ser vigente se sustituye o se borra, nunca se
> apila debajo de lo nuevo.**

Actualizado el **2026-08-27**, al cerrar F5.A.

---

## Dónde estamos

|                         |                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------- |
| **Fase en curso**       | **Fase 5 — Identidad y sesión.** F5.A cerrado · **F5.B es el siguiente bloque**   |
| **Última fase cerrada** | **Fase 4 — Arquitectura UX e internacionalización** (4.A · 4.B · 4.C · 4.D)       |
| **ADR aceptados**       | ADR-001 … ADR-017                                                                 |
| **Backend**             | Migrado y reconstruible desde cero, con CI verificándolo en cada PR               |
| **App visible**         | Shell navegable con primitives y estados comunes. **Sin funcionalidad económica** |
| **Sesión**              | Existe la frontera técnica. **No hay registro, ni login, ni rutas protegidas**    |

**La Fase 5 NO está completa.** F5.A dejó la frontera con el backend —cliente,
entorno validado y almacenamiento seguro de sesión— **sin una sola pantalla de
autenticación**. Nadie puede entrar todavía.

Los bloques que faltan: **F5.B** estado de sesión y guardas de ruta · **F5.C**
registro e inicio de sesión · **F5.D** cierre de sesión y Perfil · **F5.E**
recuperación de acceso · **F5.F** cierre de fase.

---

## Arquitectura vigente

```
Expo SDK 57 (iOS + Android; web NO es objetivo)

src/app/  ->  src/features/  ->  src/domain/ + src/lib/ + src/ui/
                                  (dominio puro, sin React ni red)

cliente -> Kong -> GoTrue (JWT) -> PostgREST
                                     |
                        lectura      |      escritura
              api.<vista security_invoker>  api.record_*  (SECURITY DEFINER,
                        |                        |         owner nomey_writer)
                  core.current_effect            |
                        |                        v
                     core.*  <----- RLS, que tambien se aplica al writer
```

**Tres schemas.** `core` persiste · `api` es **la única** superficie expuesta ·
`sec` guarda los helpers internos. `public`, `core` y `sec` **no** están en
`api.schemas`; responden `406 PGRST106`.

**Dos owners opuestos, a propósito.** El writer es `nomey_writer` —`NOLOGIN`,
`NOBYPASSRLS`, no propietario de tablas— de modo que la RLS **sigue aplicándose
a la escritura**: es la segunda barrera, no un adorno. `api.claimed_dimension()`
es `postgres` porque debe **atravesar** la RLS para recuperar lo reclamado.
**Nunca unificar los dos.**

---

## Superficie `api` disponible

**Escritura — siete funciones, y ninguna más.** Una por clase de operación,
payload `jsonb` único, `GRANT EXECUTE` solo a `authenticated`:

```
record_adjustment          record_group_expense
record_personal_expense    record_debt_settlement
record_external_transfer   record_settlement_by_transfer
record_internal_transfer
```

Alta y corrección **comparten función**: las distingue `operation_id` +
`expected_version_id` en el payload.

**Lectura:**

| Objeto                    | Qué da                                                   |
| ------------------------- | -------------------------------------------------------- |
| `api.personal_effect`     | Saldo y económica **sin participante** del Modo Personal |
| `api.claimed_dimension()` | Económica **con participante** y deuda, por vínculo      |

**Errores.** Código propio en el cuerpo y estado HTTP, medidos por la ruta real:
`PAYLOAD_INVALID` 400 · `NOT_AUTHORIZED` 403 · `IDEMPOTENCY_KEY_REUSED` 409 ·
`VERSION_CONFLICT` 409 · `CURRENCY_CONVERSION_UNSUPPORTED` 422 · y los códigos de
dominio de `src/domain/errors.ts`, también 422.

`src/types/database.ts` se **genera** sobre `api` y nunca se escribe a mano.

---

## Frontera de sesión en el cliente

**Lo que existe (F5.A), y nada más:** un cliente Supabase, el entorno público
validado y la sesión persistida en el llavero. **No hay pantallas de
autenticación, ni proveedor de sesión, ni rutas protegidas.**

```
lib/env/          las dos EXPO_PUBLIC_, validadas al arrancar
lib/supabase/
├── bootstrap        el polyfill de URL, ANTES de createClient
├── client           db.schema 'api' · persistSession · autoRefreshToken
├── client-options   puro, para poder afirmarlo en un test
├── chunked-storage  troceado y manifiesto. PURO, inyectable
└── session-storage  la ÚNICA que nombra expo-secure-store
```

Cuatro cosas que conviene no re-descubrir:

- **La identidad interna de Nomey es el `sub` del JWT.** No hay tabla de
  usuario, ni perfil, ni segunda identidad. El nombre de presentación vivirá en
  la metadata de Auth y **nunca** participa en RLS ni en autorización.
- **El almacenamiento trocea siempre**, y su seguridad es una sola regla: el
  manifiesto se escribe el último y se borra el primero. Una escritura
  interrumpida degrada a _sin sesión_, jamás a media sesión.
  [ADR-017](adr/ADR-017-secure-session-storage.md).
- **React Native 0.86 no cumple el contrato `URL.protocol`** que exige
  `supabase-js`: su `URL` global no tiene setter de `protocol` y el constructor
  del cliente asigna a uno. Lo resuelve `react-native-url-polyfill` en un único
  punto de arranque. Quitarlo rompe la creación del cliente, no solo realtime.
- **El cliente no gestiona el ciclo de vida.** No restaura al arrancar ni
  refresca al volver a primer plano; eso es F5.B.

**Validado en iPhone físico**, con `app/session-probe.tsx` bajo `__DEV__` —no es
una feature y no se expone al usuario—: SecureStore disponible · un payload de
nueve chunks va y vuelve idéntico · el borrado deja `null` · el cliente se crea
bajo Hermes · `getSession()` sin sesión responde `null`.

**Lo que aún no se ha medido:** el tamaño real de una sesión de Nomey
serializada, porque todavía no existe ninguna auténtica. ADR-017 lo exige
documentado **antes de cerrar la Fase 5**, y no puede cambiar el diseño: se
trocea siempre por decisión.

---

## Invariantes que una fase futura no debe romper

1. **El cliente no escribe efectos.** Envía intención; el servidor deriva. Las
   siete funciones son la única entrada de escritura.
2. **Los importes son enteros exactos en unidad mínima y nunca cruzan JSON como
   número.** Entran como string, salen como texto.
3. **Todo importe lleva su definición monetaria**, cuya identidad es un `UUID`,
   no el código ISO. Dos importes solo se suman si la comparten.
4. **Caja, económica y deuda son tres dimensiones distintas** y no se sustituyen.
   Una liquidación no mueve saldo; un gasto de grupo no es una transferencia.
5. **Los hechos son inmutables.** Corregir crea una versión nueva; solo cuenta la
   vigente, y eso se consulta en `core.current_effect` — **nunca** se
   reimplementa el filtro de vigencia.
6. **Saldos, deudas, estadísticas y disponibles son derivados**, sin caché en v1.
7. **Toda escritura que pueda alterar deuda vigente bloquea los ámbitos
   afectados**, en orden ascendente, **antes** de leer la deuda. Una
   serialización parcial no serializa nada.
8. **Idempotencia por comando**: el UUID lo genera el cliente, la comparación es
   solo del servidor, y el replay se resuelve **antes** de autorizar y del CAS.
9. **Los efectos referencian al participante contextual, nunca al usuario.**
10. **Ninguna tabla de `core` sin RLS**, y ninguna policy aplicable a `PUBLIC`.
11. **Ownership ≠ membresía.** `scope.owner_user_id` es atribución económica
    durable; `core.membership` es autorización actual y es lo que resuelve la
    RLS. Un Modo Personal necesita **las dos** filas.
12. **`core.membership` es presencia, no historial**, y `participant_period` es
    elegibilidad para figurar en una operación, **nunca** autorización.

---

## Limitaciones técnicas vigentes

**El `Intl` de Hermes no es el de Node.** Hermes no empaqueta ICU: toma el
formateador de cada plataforma, así que **iOS no tiene
`Intl.NumberFormat.prototype.formatToParts` y descarta `signDisplay`**. Lo
primero revienta; lo segundo se ignora en silencio, que es peor. `src/lib/format`
solo usa `format()` y deriva la forma del locale con sondas, en una única vía
para todos los runtimes. **Nada que se ejecute en el dispositivo se da por
verificado porque pase en Vitest**, que corre sobre V8.

---

## Decisiones aplazadas relevantes

Ninguna bloquea a F5.B. El detalle completo, con motivo y destino de cada una,
está en [`model-coverage.md`](architecture/model-coverage.md).

| Aplazado                                                       | Dónde queda                                |
| -------------------------------------------------------------- | ------------------------------------------ |
| **Confirmación obligatoria de email**, y adaptar el check HTTP | **F5.C**                                   |
| **Medición del payload real de sesión**                        | **F5.C**                                   |
| Persistencia de la preferencia de idioma                       | Con la UI de Ajustes                       |
| **Resolución autoritativa del FX**                             | Decisión de producto                       |
| **Provisioning**: crear ámbitos y participantes                | Fases de producto — **fuera de la Fase 5** |
| **Modo Pareja** completo, con su `Cierre`                      | Su fase                                    |
| Mecanismo de claim, revocación y fusión                        | **F10**                                    |
| Notificación                                                   | Abierto                                    |
| Acceso residual                                                | Abierto                                    |
| Anulación, distinta de la corrección                           | Abierto                                    |
| Idempotencia de recurrencias e importaciones                   | Abierto                                    |
| Preflight de `btree_gist` en producción                        | Antes del primer deploy                    |

> **Consecuencia práctica del provisioning aplazado:** hoy nada crea un Grupo ni
> un participante, así que `record_group_expense` y las dos liquidaciones no son
> alcanzables de extremo a extremo por un cliente real. Los checks siembran ese
> estado como `postgres`, que es exactamente lo que hará el provisioning.
>
> **Y una que aparece al terminar la Fase 5:** una cuenta recién creada no
> tendrá ámbito Personal, porque **provisioning está fuera de la Fase 5**. Sin
> `scope` con `owner_user_id` **y** su fila de `membership` —hacen falta las
> dos, invariante 11— el dueño no ve ni sus propios efectos. **F6 no puede
> abrir sin resolverlo.** Dirección fijada, sin implementar: una función `api.*`
> autenticada e idempotente que derive el actor del JWT; ni trigger sobre
> `auth.users` ni Edge Function salvo razón material.

---

## Fundación de interfaz

**La Fase 4 cerró en cuatro bloques**, todos validados en iPhone físico:
**F4.A** fundación visual y marca · **F4.B** i18n y formateo · **F4.C** app
shell y navegación · **F4.D** primitives y estados comunes. El detalle está en
[`ux/phase-4-plan.md`](ux/phase-4-plan.md).

**Lo visual.** Nomey es **dark-only**: `app.config.ts` fija
`userInterfaceStyle: 'dark'` y la paleta se resuelve en un único sitio,
`src/ui/theme/use-theme.ts`. El amarillo de marca es `#FDC506`, acento
minoritario. **Ningún color, rol tipográfico ni token de profundidad vive fuera
de `src/ui/theme/`**, y el contraste de la paleta está medido y anotado allí.
Los tokens de **glass y de profundidad táctil tienen consumidores reales** —la
barra, el botón de acción, el pulsador de ámbito, las cards y las sheets— y su
render **está validado en iPhone físico**. El suelo de opacidad del glass lo
comprueba un test.

**Idioma y formato se resuelven por separado, y son tipos distintos** —
`MessageLocale` y `FormatLocale`— para que confundirlos no compile.

- **Catálogo:** `es-ES` y `en`. Cualquier `es-*` va al español, cualquier `en-*`
  al inglés, y un idioma no soportado cae a `es-ES`.
- **Preferencia**, con tres estados —**Automático** (por defecto), Español,
  English—. Existe la API; **no está persistida ni expuesta en UI**, y ambas
  cosas llegan con Ajustes.
- **Formato regional:** sigue **siempre la Region real del dispositivo**, aunque
  el idioma se fuerce. Se **compone** desde `languageCode`, el script cuando
  exista y `regionCode` — nunca desde `languageTag`, que lleva la región del
  idioma y no la del ajuste Region.
- **La Region no toca el dinero.** Un `Money` en EUR sigue siendo EUR en México:
  la definición monetaria manda sobre código, escala y valor; la región solo
  sobre separadores, agrupación, posición del símbolo y convenciones de fecha.
- **La exactitud se conserva.** Los dígitos salen del `bigint`; `Intl` solo
  recibe sondas de magnitud fija.

**El shell vigente.** Dos destinos raíz y nada más: **Inicio** y **Grupos**.

- **`+` es una acción contextual, no navegación**: flota sobre los destinos,
  fuera de la barra, y añade al sitio donde estás — en Inicio al ámbito activo,
  en Grupos a un grupo, sin preseleccionar ninguno.
- **Personal y Pareja son contextos dentro de Inicio**, con un pulsador único y
  el estado por encima de las tabs, así que sobrevive a cambiar de destino.
  Visualmente son equivalentes; lo que falta de Pareja es funcionalidad, y se
  dice donde faltaría.
- **Perfil y Notificaciones cuelgan de la cabecera**, no de la barra, y ambos
  destinos raíz comparten ese grupo de acciones.
- **Crear un grupo no es el `+`**: vive en el contenido de Grupos.

**Glass y profundidad táctil ya tienen consumidores reales** —barra, botón de
acción, pulsador de ámbito, cards y sheets— y se validaron en iPhone físico.
El suelo de opacidad del glass lo comprueba un test.

**Las primitives son pocas y todas tienen consumidor**: `Icon`, `IconButton`,
`ActionButton`, `Section`, `GlassSurface`, `ThemedText` y `ThemedView`, más los
tres estados comunes —**carga, vacío y error**— reutilizables y ya consumidos
por Inicio, Grupos y Notificaciones. Un test falla si alguna deja de tener quien
la use.

**Dos pantallas viven fuera del producto**, alcanzables solo desde Perfil bajo
`__DEV__`: el diagnóstico de `Intl` de F4.B y la vista de estados comunes.
Ninguna es una feature.

**Antes de tocar UI, leer
[`design-direction.md`](product/design-direction.md)**: es la fuente de verdad de
la estética y su regla de accesibilidad es vinculante. F4 la convierte en
tokens; **no la redefine**.

**Pendiente de validar en dispositivo**, sin bloquear a nadie: el icono y el
splash **nativos**, que Expo Go sustituye por los suyos y esperan a la primera
build iOS propia; y la tabla diagnóstica de `Intl`, cuya **validación funcional
sí se hizo** en iPhone —arranque, EUR, JPY, fecha e importe de 21 dígitos— pero
**no fila a fila**.

Fuera de alcance de F4: biblioteca de componentes completa, design system
consolidado y el flujo detallado de entrada rápida, que se diseña en F7 contra
una feature escribible real.

---

## Qué consultar, y cuándo

| Necesitas…                                   | Lee                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| Reglas del repositorio y del agente          | [`AGENTS.md`](../AGENTS.md)                                                        |
| Semántica contable y escenarios              | [`architecture/data-model.md`](architecture/data-model.md)                         |
| Dónde vive cada concepto del modelo          | [`architecture/model-coverage.md`](architecture/model-coverage.md)                 |
| Una decisión y su porqué                     | [`adr/README.md`](adr/README.md) — ADR-001 … ADR-016                               |
| Secuencia de fases y criterios de cierre     | [`product/roadmap.md`](product/roadmap.md)                                         |
| Vocabulario                                  | [`product/glossary.md`](product/glossary.md)                                       |
| Estética, antes de cualquier UI              | [`product/design-direction.md`](product/design-direction.md)                       |
| **Continuar la Fase 5 — empezar F5.B**       | [`architecture/phase-5-handoff.md`](architecture/phase-5-handoff.md)               |
| Cómo quedó la Fase 4, ya cerrada             | [`ux/phase-4-plan.md`](ux/phase-4-plan.md)                                         |
| Cómo se usan i18n y el formateo              | [`src/lib/README.md`](../src/lib/README.md)                                        |
| Levantar el entorno, migrar, ejecutar checks | [`runbooks/local-setup.md`](runbooks/local-setup.md)                               |
| **Por qué** la Fase 3 quedó como quedó       | [`architecture/phase-3c-handoff.md`](architecture/phase-3c-handoff.md) — histórico |

**Evidencia empírica:** `supabase/e11/` … `supabase/e20/`. Son sondas
desechables sobre maquetas y **nunca deben convertirse en migración**.

---

## Comandos

```bash
npm ci
npm test
npm run verify
```

La Supabase CLI se ejecuta **desde Ubuntu (WSL2)** con
`./scripts/supabase-cli.sh`, nunca desde Windows, y **nunca** se instalan
dependencias npm desde WSL sobre este checkout. El motivo está en el runbook.
