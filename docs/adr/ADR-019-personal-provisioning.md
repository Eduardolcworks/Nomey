# ADR-019 — Provisioning del Modo Personal y siembra del catálogo monetario

- **Estado:** Aceptado
- **Fecha:** 2026-08-28

## Contexto

La Fase 5 cerró con **cuentas que no tienen ámbito Personal**. Nada en Nomey
crea hoy un ámbito, una membresía o un participante: la frontera autoritativa
los **asume** y solo tiene `SELECT` sobre ellos. Y `core.currency_definition`
está **vacía**, porque sembrar monedas desde una migración era _«inventar
producto»_ mientras no existiera la fase que las usa.

Las dos cosas juntas producen el estado con el que termina F5: **una cuenta
recién confirmada no puede registrar nada, y no puede ver nada**. Sin `scope`
con `owner_user_id` **y** su fila de `core.membership` —hacen falta las dos,
invariante 11— el dueño no ve ni sus propios efectos, porque la RLS de lectura
se resuelve por membresía y la propiedad no es membresía.

La migración de la proyección canónica ya dejó escrito lo que esta decisión debe
cumplir, como invariantes reservados a la frontera:

> - el dueño de un Modo Personal es **también** miembro de él;
> - y es su **único** miembro;
> - propiedad y membresía se crean en la **misma transacción**.

**Lo que ya estaba decidido y esta decisión no reabre:** la identidad interna es
el `sub` del JWT y no hay tabla de usuario (F5) · `owner_user_id` es atribución
económica durable y `core.membership` es autorización actual
([ADR-016](ADR-016-economic-attribution.md), [ADR-007](ADR-007-membership-rls.md))
· la identidad monetaria es el `UUID` y no el código ISO
([ADR-004](ADR-004-currency-definition-identity.md)) · las monedas admitidas son
_«las fiat activas de ISO 4217 para las que Nomey disponga de una definición
monetaria válida y controlada»_, con la escala **bajo control de Nomey y no de
una API externa** ([ADR-003](ADR-003-money-representation.md) §3) · el cliente
envía intención y el servidor deriva ([ADR-002](ADR-002-accounting-model.md) §7)
· una función pública por clase de **operación**
([ADR-009](ADR-009-authoritative-write-boundary.md) §1) · la moneda base de un
ámbito es **inmutable tras su primera operación** (invariante 12).

## Decisión

### 1. Dos funciones `api`, autenticadas, con el actor derivado del JWT

```
api.ensure_personal_scope(payload jsonb)       crea el ámbito y su membresía
api.set_personal_base_currency(payload jsonb)  cambia la moneda si nunca hubo efecto
```

**Ni trigger sobre `auth.users`, ni Edge Function.** Un trigger acoplaría el
dominio económico a una tabla de Auth y no sería corregible desde la aplicación;
una Edge Function sería una segunda superficie de escritura fuera de la frontera
que ADR-009 fija.

**Son dos y no una, y el motivo es una carrera real.** `ensure_personal_scope`
se invocará en **cada arranque autenticado** para tolerar un provisioning
fallido. Si además fijara la moneda, ese arranque devolvería a la moneda de la
Region el ámbito de quien acaba de elegir otra. Un provisioning idempotente
**tiene que ignorar la moneda cuando el ámbito ya existe**, y entonces ya no
sirve para cambiarla.

**ADR-009 §1 no las alcanza**: ninguna es una clase de operación contable. No
crean operación, ni versión, ni efecto.

### 2. Las dos filas, en la misma transacción, y ningún participante

`core.scope` con `kind = 'personal'` y `owner_user_id`, **y** `core.membership`
del mismo actor. Nunca una sin la otra.

**No se crea `core.participant`, y no es un olvido.** Los efectos personales
llevan participante **legítimamente nulo** (ADR-013 §8) y `api.personal_effect`
atribuye por **propiedad**, no por vínculo. Crear un participante especulativo
inventaría una identidad contextual que nadie ha reclamado, que es exactamente
lo que [ADR-012](ADR-012-participant-identity.md) §1 evita. Si F10 lo necesita,
añadirlo es aditivo y no reinterpreta ningún efecto.

### 3. Un tercer rol: `nomey_provisioner`

`NOLOGIN`, `NOBYPASSRLS`, **no propietario de tablas**, dueño de estas dos
funciones y de nada más.

**Los dos owners que ya existen están ocupados, y por razones opuestas:**

- **`nomey_writer`** escribe contabilidad **debajo** de la RLS. Su única
  relación con `core.scope` es `GRANT UPDATE (base_currency_definition_id)` con
  policy `USING (true) WITH CHECK (false)`: puede **bloquear** la fila para el
  protocolo de deuda de ADR-013 §11, y no puede escribirla. Ensancharlo
  degradaría una barrera medida para las **siete** funciones contables.
- **`postgres`** es owner de `api.claimed_dimension()` porque una lectura de
  reclamación debe **atravesar** la RLS. Poner ahí una **escritura** sería lo
  contrario de lo que hace el writer, y los dos no se unifican.

`nomey_provisioner` es el mismo modelo aplicado a una tercera frontera. **El
escritor contable sigue sin poder crear un ámbito, y el provisioner no puede
escribir ni un solo hecho contable.**

### 4. La barrera RLS va acotada al actor, no solo al tipo de ámbito

**E21 lo midió y por eso es posible.** `sec.request_actor_id()` funciona dentro
de un `SECURITY DEFINER` de un rol así —lo que impedía a `nomey_writer` usar
`auth.uid()` era **privilegio, no semántica**— y también **dentro de una policy**
evaluada durante esa función.

Por eso las policies no se quedan en `kind = 'personal'`:

```sql
using      (kind = 'personal' and owner_user_id = sec.request_actor_id())
with check (kind = 'personal' and owner_user_id = sec.request_actor_id())
```

y la de `core.membership` exige **las dos mitades** —el usuario es el actor, y el
ámbito es un ámbito personal del actor—. Medido: crear la membresía de otro
usuario, y crear una membresía en un ámbito ajeno, se rechazan las dos con
`42501`.

**Un fallo del definer no puede alcanzar el Modo Personal de otra persona, y lo
impide la base de datos, no el código.**

### 5. Las policies de `SELECT` son parte de la corrección, no una comodidad

E21 midió **tres veces** el mismo modo de fallo: con `GRANT` concedido y sin
policy aplicable, la lectura **devuelve cero filas sin error**.

| Tabla                      | Qué rompe su ausencia                                                        |
| -------------------------- | ---------------------------------------------------------------------------- |
| `core.effect`              | Declara **vacío** un ámbito ocupado y deja pasar el cambio de moneda         |
| `core.scope`               | El `WITH CHECK` de la membresía no ve la fila y **rechaza el alta legítima** |
| `core.currency_definition` | Ninguna moneda es resoluble                                                  |

La segunda es la menos evidente y la más instructiva: **el `WITH CHECK` de una
policy consulta otra tabla, y esa subconsulta está sujeta a la RLS del rol que
la evalúa.** Falla cerrado, que es la dirección segura, pero hace imposible el
provisioning con un error que no nombra la causa. **Las policies de lectura y de
escritura del provisioner se diseñan juntas**; quitar la de lectura no endurece
nada.

### 6. Idempotencia por estado, y fuera de `core.client_command`

`core.client_command` es la unidad de idempotencia del **comando contable de
origen cliente** ([ADR-011](ADR-011-operation-version-model.md) §5). Ninguna de
estas dos funciones crea una operación, así que **no la usan**: meterlas allí
contaminaría la relación contable y obligaría a inventarles un `command_type`
para algo que no lo es.

Son idempotentes por estado, que aquí es más fuerte porque no necesita clave:

| Llamada                                       | Resultado                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ensure` con el ámbito ya creado              | Lo devuelve. `created = false`                                                                                                             |
| `ensure` **simultáneo** consigo mismo         | El índice único `scope_un_personal_por_usuario` hace fallar al segundo; se captura `unique_violation`, se relee y se devuelve el existente |
| `ensure` con otra moneda, ámbito existente    | **No cambia la moneda**                                                                                                                    |
| `set_currency` con la moneda que ya tiene     | Éxito **sin escritura**                                                                                                                    |
| `set_currency` con otra, ámbito vacío         | Cambia                                                                                                                                     |
| `set_currency` con cualquier efecto histórico | `BASE_CURRENCY_LOCKED · 409`                                                                                                               |

`unique_violation` es la **única** excepción capturada, igual que en
`sec.begin_command`: cualquier otra convertiría un fallo en escritura parcial.

### 7. La moneda: recomendación por Region, fallback EUR, identidad por UUID

La Region del dispositivo produce un **código ISO**, y el código **no es la
identidad**. `sec.resolve_recommended_currency(text)` lo resuelve:

```
1 coincidencia    ->  esa definición
0 coincidencias   ->  EUR, como fallback inicial
>1 coincidencias  ->  CURRENCY_CODE_AMBIGUOUS · 422
```

El tercer caso no puede ocurrir hoy —el catálogo sembrado tiene códigos únicos y
un check lo comprueba— y existe porque **ADR-004 dice expresamente que dos
definiciones pueden compartir código**. Quien introduzca la segunda deberá
decidir la regla de selección, no heredar una elección silenciosa.

**El fallback no convierte a EUR en nada.** No es moneda universal del producto
ni regla contable: es el valor inicial cuando la moneda regional todavía no forma
parte del catálogo soportado, y es cambiable mientras el ámbito esté vacío. Se
resuelve **por código contra el catálogo**, no como UUID literal, de modo que si
EUR desapareciera esto fallaría a gritos en vez de apuntar a una fila
inexistente.

El cambio, en cambio, se pide **por `currency_definition_id`**: ahí no hay
recomendación que interpretar y la identidad es lo único correcto.

### 8. El cambio de moneda solo antes del primer efecto — tres barreras, una autoridad

El invariante 12 dice _«inmutable **tras su primera operación**»_ y es agnóstico
del tipo de ámbito; `data-model.md` §10 ya lo ilustraba con el creador de un
Grupo. Esto lo **extiende al Modo Personal** y **no relaja nada**.

```
1  bloquear     SELECT ... FOR UPDATE del ámbito del actor
2  comprobar    NOT EXISTS sobre core.effect  ->  BASE_CURRENCY_LOCKED · 409
3  actualizar   y verificar row_count = 1
```

- **La autoridad es la FK compuesta `effect_moneda_del_ambito`.** E21/D3 lo
  midió: con un efecto existente, PostgreSQL rechaza el `UPDATE` con `23503`
  ejecute el código lo que ejecute. **La comprobación del paso 2 existe para
  fallar bien** —código propio y 409—, no para hacer cumplir la regla. Quien la
  relaje descubrirá que la base sigue negándose.
- **Se mira `core.effect`, nunca `core.current_effect`.** Un movimiento creado y
  luego anulado deja la proyección vigente vacía y la tabla no, y sus efectos
  históricos siguen en la moneda vieja.
- **`row_count` se comprueba.** E21/D2 midió que un `UPDATE` cuya `USING` no casa
  devuelve **cero filas sin error**: sin esa comprobación, un cambio que no
  ocurrió se reportaría como éxito.

### 9. El catálogo se siembra por migración, con identidades fijas

Veinte definiciones, con **UUID literales** calculados como **UUID v5** sobre el
namespace DNS de RFC 4122 y el nombre `currency.nomey.app/<CÓDIGO>`. Cualquier
implementación estándar los reproduce, así que son auditables sin confiar en el
fichero.

**Nunca se regeneran.** `core.currency_definition.id` **es** la identidad
monetaria: si local, CI y producción tuvieran UUID distintos para EUR, los
importes seguirían cuadrando **dentro** de cada entorno y dejarían de ser
comparables **entre** ellos, sin que nada fallara.

```
EUR 2 · USD 2 · GBP 2 · CHF 2 · JPY 0 · CAD 2 · AUD 2 · NZD 2 · SEK 2 · NOK 2
DKK 2 · PLN 2 · CZK 2 · HUF 2 · RON 2 · MXN 2 · BRL 2 · ARS 2 · COP 2 · CLP 0
```

Escalas verificadas contra los minor units de ISO 4217, que es la fuente que
ADR-003 §3 designa. **JPY y CLP están a propósito**: son las que hacen fallar
cualquier código que dé por hechos dos decimales. HUF, COP y ARS llevan 2 en ISO
4217 aunque su unidad menor no circule en la práctica.

Ampliar la lista es aditivo y no toca ninguna identidad existente.

### 10. Lectura mínima: dos vistas, y ninguna columna de más

```
api.currency_definition   id · code · scale
api.personal_scope        id · base_currency_definition_id · currency_code · currency_scale
```

Las dos `security_invoker`, porque E19 midió que sin él la cadena pierde la RLS
y **sigue devolviendo filas creíbles**. `owner_user_id` **no se proyecta**.
`scale` sale como número y es correcto: es metadato de la definición, no un
importe; ADR-008 §1 alcanza a los valores monetarios.

**`api.personal_scope` no lleva una columna que diga si la moneda sigue siendo
cambiable.** La primera versión la tenía, resuelta con un `EXISTS` sobre
`core.effect`, y **la guarda de catálogo de ADR-013 §9 la rechazó**: la única
relación autorizada a depender directamente de `core.effect` es la proyección
canónica. Y no se arregla leyendo `core.current_effect`, porque sería
**incorrecto**: lo que bloquea la moneda es haber tenido algún efecto **alguna
vez**. Exponer esa pregunta es una decisión propia —una excepción nombrada a la
guarda, o una función con su justificación— y pertenece a la superficie de
lectura de F6.D. La autoridad, mientras tanto, es el 409.

## Consecuencias

**Aceptadas.**

- Una **tercera frontera de privilegio** que mantener y revisar.
- El cliente debe invocar el provisioning y **tener camino de reintento**: si
  falla, la cuenta se queda sin Modo Personal. La idempotencia hace el reintento
  seguro; hace falta que exista.
- La moneda queda **bloqueada desde el primer movimiento** y hasta F11. El
  producto final sí permitirá cambiarla con historia —conservando los
  movimientos en su moneda original y convirtiendo el Disponible—; **está
  diferido, no descartado**.
- `ensure_personal_scope` crea el ámbito **y** su membresía, así que es la única
  función de `api` que escribe autorización. Se revisa como límite de privilegio.

**Resueltas.** Cuatro entradas aplazadas de
[`model-coverage.md`](../architecture/model-coverage.md): siembra del catálogo
monetario · provisioning de ámbitos · la membresía del propio Modo Personal ·
y la mitad personal de «nada crea un ámbito».

**No abre F11.** No hay conversión —cero efectos, cero saldo, cero histórico—,
no se resuelve ningún tipo de cambio, `core.frozen_conversion` sigue sin ruta de
escritura y `sec.assert_no_conversion` no se toca: una operación en moneda
distinta de la base sigue devolviendo `CURRENCY_CONVERSION_UNSUPPORTED · 422`.
**F6 implementa _elegir_; F11 implementará _cambiar_**, que es otro problema
porque tiene historia.

## Alternativas descartadas

| Alternativa                                                | Por qué no                                                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Trigger sobre `auth.users`**                             | Acopla el dominio económico a una tabla de Auth y no es corregible desde la app                          |
| **Edge Function**                                          | Segunda superficie de escritura fuera de la frontera de ADR-009                                          |
| **Crear el ámbito perezosamente, en el primer movimiento** | La primera escritura contable dejaría de ser solo contable, y el ajuste inicial crearía su propio ámbito |
| **Ampliar `nomey_writer`**                                 | Degrada el `WITH CHECK (false)` medido, y para las siete funciones a la vez                              |
| **Owner `postgres`**                                       | Pone una escritura por encima de la RLS, que es lo contrario del writer                                  |
| **Una sola función que cree y fije la moneda**             | El arranque idempotente desharía la elección del usuario                                                 |
| **Policy solo por `kind = 'personal'`**                    | E21 demostró que se puede acotar al actor; conformarse sería dejar alcanzable el ámbito de otro          |
| **Codificar «ámbito vacío» también en la policy**          | Dos sitios para la misma regla, y la FK ya la posee                                                      |
| **Resolver la moneda por código en el cambio**             | La identidad es el UUID; el código puede repetirse (ADR-004)                                             |
| **Sembrar la moneda por región en el servidor**            | La Region la conoce el dispositivo, no el servidor                                                       |
| **UUID generados en ejecución**                            | Divide los entornos en silencio: los importes cuadran dentro de cada uno y no entre ellos                |

## Verificación

`supabase/checks/personal-provisioning.sql`, con **dos regresiones
deliberadas**: sin la policy de `SELECT` sobre `core.effect`, el cambio de moneda
debe seguir rechazándose **por la FK** y no por el 409 —el fallo cambia de forma,
nunca de resultado—; y sin la de `core.scope`, el provisioning legítimo debe
romperse.

`scripts/provisioning-concurrency.sh` abre **sesiones simultáneas de verdad**, y
se comprobó capaz de fallar quitando el índice único: reproduce exactamente el
ámbito duplicado y la membresía duplicada.

`scripts/http-boundary-check.sh` §8 recorre el camino entero **por HTTP con JWT
real**: cuenta nueva sin ámbito, provisioning, idempotencia, catálogo, cambio de
moneda con el ámbito vacío, primer gasto por el writer, y `409` al intentar
cambiarla después.

Evidencia de las mediciones: [`supabase/e21/`](../../supabase/e21/README.md).
