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

Actualizado el **2026-08-27**, al abrir la Fase 4.

---

## Dónde estamos

|                         |                                                                     |
| ----------------------- | ------------------------------------------------------------------- |
| **Fase actual**         | **Fase 4 — Arquitectura UX e internacionalización**, en F4.B        |
| **Última fase cerrada** | **Fase 3 — Persistencia y frontera de datos** (3.A · 3.B · 3.C)     |
| **ADR aceptados**       | ADR-001 … ADR-016                                                   |
| **Backend**             | Migrado y reconstruible desde cero, con CI verificándolo en cada PR |
| **App visible**         | Tema dark-only y pantalla de espera. Todavía sin navegación         |

**F4 no toca el backend** ni depende de la Fase 3 —el roadmap lo dice
expresamente—: navegación, wireframes, tokens de tema, estados de carga, vacío y
error, e infraestructura de i18n.

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

Ninguna bloquea la Fase 4. El detalle completo, con motivo y destino de cada una,
está en [`model-coverage.md`](architecture/model-coverage.md).

| Aplazado                                        | Dónde queda             |
| ----------------------------------------------- | ----------------------- |
| **Resolución autoritativa del FX**              | Decisión de producto    |
| **Provisioning**: crear ámbitos y participantes | Fases de producto       |
| **Modo Pareja** completo, con su `Cierre`       | Su fase                 |
| Mecanismo de claim, revocación y fusión         | **F10**                 |
| Notificación                                    | Abierto                 |
| Acceso residual                                 | Abierto                 |
| Anulación, distinta de la corrección            | Abierto                 |
| Idempotencia de recurrencias e importaciones    | Abierto                 |
| Preflight de `btree_gist` en producción         | Antes del primer deploy |

> **Consecuencia práctica del provisioning aplazado:** hoy nada crea un Grupo ni
> un participante, así que `record_group_expense` y las dos liquidaciones no son
> alcanzables de extremo a extremo por un cliente real. Los checks siembran ese
> estado como `postgres`, que es exactamente lo que hará el provisioning.

---

## Fase en curso

**Fase 4 — Arquitectura UX e internacionalización**, abierta el 2026-08-27, en
cuatro bloques: **F4.A** fundación visual y marca · **F4.B** i18n y formateo ·
**F4.C** app shell y navegación · **F4.D** primitives, estados y wireframes. El
plan aprobado y sus criterios de cierre están en
[`ux/phase-4-plan.md`](ux/phase-4-plan.md).

**Lo visual ya vigente.** Nomey es **dark-only**: `app.config.ts` fija
`userInterfaceStyle: 'dark'` y la paleta se resuelve en un único sitio,
`src/ui/theme/use-theme.ts`. El amarillo de marca es `#FDC506`, acento
minoritario. **Ningún color, rol tipográfico ni token de profundidad vive fuera
de `src/ui/theme/`**, y el contraste de la paleta está medido y anotado allí.

**Idioma e importe se resuelven por separado.** El catálogo lo elige una
preferencia de tres estados —Automático, Español, English—; el formato de
números, moneda y fechas sigue **siempre la región del dispositivo**, aunque el
idioma se fuerce, y ese formato se **compone** con el `regionCode` del
dispositivo —no con `languageTag`, que lleva la región del idioma—. Los dos
locales están marcados como tipos distintos para que
confundirlos no compile. La persistencia de la preferencia llegará con Ajustes.

**La navegación NO está cerrada.** Se decide viéndola en un iPhone real durante
F4.C, no razonándola antes.

**Antes de tocar UI, leer
[`design-direction.md`](product/design-direction.md)**: es la fuente de verdad de
la estética y su regla de accesibilidad es vinculante. F4 la convierte en
tokens; **no la redefine**.

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
| Bloques y decisiones de la fase en curso     | [`ux/phase-4-plan.md`](ux/phase-4-plan.md)                                         |
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
