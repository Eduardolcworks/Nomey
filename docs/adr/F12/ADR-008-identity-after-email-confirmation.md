# F12/ADR-008 — La identidad pública se completa después de confirmar el correo

- **Estado:** Aceptado
- **Fecha:** 2026-09-25
- **Fase:** F12 (bloque A, corrección del flujo de alta)
- **Supersede:** [F12/ADR-001](ADR-001-username-public-account-identity.md)
  **en el paso 4 de su §5** —«`provider = 'email'` sin `requested_username` →
  rechazo `USERNAME_REQUIRED · 400`»— y en la frase de §5 que fija el
  formulario de alta como **Nombre · Username · Email · Contraseña**. Todo lo
  demás de ADR-001 sigue vigente sin cambios: §1–§4, §6–§14, el gate, el
  claim, la reserva provisional, la sintaxis, los reservados y el resolver.

---

## Contexto

F12/ADR-001 §5 decidió que el username se reserva **dentro de la misma
transacción en que GoTrue crea la cuenta**, y que un alta por correo sin
`requested_username` se rechaza: así ninguna cuenta nacía sin identidad
pública. El formulario de alta pedía, por tanto, cuatro campos: nombre,
username, correo y contraseña.

Al validar el alta a mano apareció lo que esa forma cuesta:

> El formulario pide **Nombre · Nombre de usuario · Correo · Contraseña**. Se
> confirma el correo, se vuelve a la app, y la app **vuelve a pedir nombre y
> nombre de usuario**.

Esa repetición concreta tenía una causa ambiental —el contenedor de GoTrue de
la máquina de desarrollo se había creado antes de que existiera el hook, así
que no lo ejecutaba y el gate recogía lo que el alta no había guardado— y está
medida aparte. **No es el argumento de este ADR**, y conviene decirlo para que
nadie lo lea como tal: con el hook en marcha no hay repetición.

El argumento es otro, y es de producto: **crear una cuenta y elegir una
identidad pública son dos decisiones distintas, y ponerlas en el mismo
formulario cobra la segunda antes de que la primera exista.** Quien se está
registrando todavía no sabe si va a usar Nomey; pedirle que invente un
`@username` único —y que lo reintente si está cogido— antes de haber
confirmado siquiera su correo es el punto del embudo donde más se abandona.

Hay además una consecuencia menor pero real del orden actual: entre el alta y
la confirmación, una reserva de siete días retiene un handle de una cuenta que
quizá nunca se confirme.

## Decisión

### §1 · El alta por correo pide tres campos

**Correo · Contraseña · Confirmar contraseña.** Nada más. El cliente no manda
`display_name` ni `requested_username` en `options.data`.

La confirmación de contraseña no es una regla nueva sobre contraseñas —GoTrue
sigue siendo el dueño de la política, F12/ADR-001 no la tocaba y este tampoco—:
es el único error que el servidor **no puede** detectar, porque nunca ve el
segundo campo. Existe para cazar una errata en un valor que quien lo escribe
no puede releer.

### §2 · El hook deja pasar un alta sin username

`sec.before_user_created` cambia **una sola rama**:

| Evento                                            | Antes                     | Ahora                      |
| ------------------------------------------------- | ------------------------- | -------------------------- |
| anónimo                                           | `{}`                      | `{}` (igual)               |
| `provider ≠ 'email'`                              | `{}`                      | `{}` (igual)               |
| `provider = 'email'` **sin** `requested_username` | `USERNAME_REQUIRED · 400` | **`{}`**                   |
| `provider = 'email'` **con** `requested_username` | valida, crea y reserva    | igual, palabra por palabra |

No se escribe ninguna fila en el caso nuevo: ni `core.account_identity`, ni
`core.account_handle`, ni su diario. GoTrue crea la cuenta y envía el correo.

**La rama con username se conserva** aunque ningún formulario de Nomey la
ejerza hoy. El invitado reserva por `api.reserve_username` antes de
`updateUser` (§8 de ADR-001) y no pasa por el hook; pero el contrato del hook
sigue siendo válido para cualquier alta que sí traiga username, y retirarlo
convertiría en silencio un alta con username en una cuenta sin él.

### §3 · El gate deja de ser la excepción y pasa a ser el camino

El gate de §7 de ADR-001 **no cambia ni una línea**: sigue pidiendo nombre
público y username, sigue llamando a `reserve_username` —que para una cuenta
normal reserva y reclama en el mismo acto— y sigue montándose **en lugar de**
las pestañas.

Lo que cambia es quién llega a él. Antes: una cuenta anterior a F12, o una
cuya reserva provisional caducó. Ahora, además y sobre todo: **toda cuenta
recién creada por correo**, la primera vez que entra con el correo confirmado.

### §4 · El invariante que sustituye al de §5

Deja de ser cierto que **«ninguna cuenta se CREA sin username»**.

Pasa a ser: **ninguna cuenta ENTRA en la aplicación sin nombre y username.**

Quien lo hace cumplir es el cliente, con las dos piezas que ya existían:
`needsUsernameGate` monta el gate en lugar de las pestañas, y `canEnterApp`
niega el acceso mientras el servidor responda `USERNAME_REQUIRED` a
`claim_username`.

**Una cuenta con el correo confirmado y sin `core.account_identity` es un
estado válido y transitorio.** No puede escribir nada de F12: cada comando que
necesita identidad pública —amistades, propuestas de transferencia— ya exige
un handle definitivo y responde `USERNAME_REQUIRED` por su cuenta. Este ADR no
relaja ninguna de esas comprobaciones, y no añade ninguna: se apoya en las que
ADR-001 §7 ya dejó escritas.

### §5 · La reserva de siete días, para un alta por correo, deja de existir

No porque se retire el mecanismo —§6 de ADR-001 sigue entero— sino porque **ya
no hay nada que reservar en el alta**: el username se elige después. La reserva
provisional sigue siendo la del invitado (§8) y la de cualquier alta que traiga
username.

Consecuencias, las dos ciertas y ninguna grave:

- Entre el alta y el gate **nadie retiene ningún handle**, porque nadie ha
  elegido ninguno. Un handle deja de quedar bloqueado siete días por una cuenta
  que quizá no se confirme.
- **«Ya está en uso» se dice más tarde**: en el gate, después de confirmar el
  correo, y no al pulsar «Crear cuenta». A cambio, quien lo oye ya tiene cuenta
  y sólo tiene que elegir otro, en vez de repetir el alta entera.

## Alternativas consideradas

**Dejar el formulario como estaba y arreglar sólo el entorno.** Es la opción
que el diagnóstico permitía, y se descarta por lo dicho en Contexto: la
repetición era ambiental, pero el coste de pedir una identidad pública antes de
la cuenta no lo es.

**Pedir el username en el alta y hacerlo opcional.** Un campo opcional en el
formulario de alta es la peor de las tres: quien lo rellena paga el coste de
elegirlo antes de tiempo, quien no lo rellena pasa igualmente por el gate, y
hay dos caminos que mantener en vez de uno.

**Rechazar en el hook y que el cliente mande un username fabricado** (del
correo, o aleatorio). Descartada sin dudar: un `@username` es identidad
pública, se muestra a otras personas y se usa para dirigirse a esta cuenta.
Fabricarlo es elegir por alguien algo que verá el resto.

**Mover también el alta del invitado** (`convertGuest`). Queda fuera: su
contrato es distinto —reserva con la sesión todavía anónima, antes de
`updateUser`— y mezclarlo aquí sería cambiar dos cosas a la vez. Consecuencia
asumida: durante un tiempo hay dos formularios de alta con campos distintos.

## Consecuencias

### A favor

- El alta por correo son tres campos y ninguna decisión que no sea sobre la
  propia cuenta.
- Nombre y username se piden **una vez**, y en el momento en que la cuenta ya
  existe y su dueño ha demostrado que controla el correo.
- Un handle deja de quedar retenido por una cuenta sin confirmar.
- Ningún mecanismo nuevo: el gate, el claim y la reserva son los de ADR-001.

### En contra

- **El invariante se debilita.** «No se crea sin username» era estructural —lo
  hacía cumplir una transacción de la base de datos—; «no entra sin username»
  lo hace cumplir el cliente. Un cliente modificado podría llamar a la API con
  una cuenta sin identidad; lo que encontraría es que cada comando de F12 que
  necesita identidad la exige por su cuenta, pero la barrera de **navegación**
  ya no es del servidor.
- **Existe un estado intermedio observable**: cuenta con correo confirmado y
  sin fila en `core.account_identity`. Nada lo rompía antes porque no podía
  darse en un alta por correo.
- «Ya está en uso» llega después de confirmar el correo.
- Dos formularios de alta con campos distintos mientras el del invitado no se
  toque.

### Evidencia que exige este ADR al implementarse

1. Un alta por correo **sin** `requested_username` crea la cuenta y **no
   escribe ninguna fila** en `core.account_identity`, `core.account_handle` ni
   `core.account_handle_event`.
2. Un alta por correo **con** `requested_username` sigue comportándose
   exactamente como en A2: crea, reserva siete días y rechaza con los mismos
   códigos.
3. Una cuenta en ese estado **no entra**: `needsUsernameGate` es cierto y
   `canEnterApp` es falso, y lo sigue siendo tras cerrar y reabrir la app.
4. Completar nombre y username en el gate deja la cuenta `ready` y abre las
   pestañas.
5. El alta del invitado sigue reservando por `api.reserve_username` antes de
   `updateUser`.
6. `supabase_auth_admin` sigue pudiendo ejecutar **exactamente una** función de
   `sec` y ninguna de `api`.

## Documentación que este ADR obliga a reconciliar

- [F12/ADR-001](ADR-001-username-public-account-identity.md) **no se edita**:
  queda como está, y esta sucesión se lee desde aquí y desde el índice.
- [`docs/adr/F12/README.md`](README.md): la fila de este ADR y la nota de
  sucesión en la de ADR-001.
- [`docs/PROJECT_STATE.md`](../../PROJECT_STATE.md), donde el alta por correo
  se describe con los cuatro campos y con el hook exigiendo username.
