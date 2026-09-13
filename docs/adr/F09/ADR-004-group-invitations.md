# F09/ADR-004 — Invitaciones a un Grupo y unión directa

- **Estado:** Aceptado (2026-09-10) para la política de unión; **§3 —emisión,
  caducidad y revocación— implementado con los valores recomendados y
  pendiente de confirmación por producto.**
- **Fecha:** 2026-09-10
- **Identificador anterior:** ADR-035 (numeración única, anterior a la organización por fases del 2026-09-14)
- **Alcance:** cómo se entra en un Grupo que ya existe: qué autoriza, qué se
  enseña antes de entrar, cómo se elige identidad, y qué contrato mínimo de
  invitación lo sostiene. **Compartir la invitación desde la app queda fuera**
  (siguiente bloque); aquí sólo existe el mecanismo real de emisión, sin
  interfaz.
- **Cierra lo que [F03/ADR-009](../F03/ADR-009-participant-identity.md) §9 delegaba a
  F10**: la prueba de autorización para reclamar un participante. **No
  reemplaza** ninguna otra decisión de F03/ADR-009: el participante sigue siendo
  contextual, el vínculo sigue en su relación, los efectos siguen referenciando
  participantes, y reclamar sigue sin crear periodos retroactivos.
- **Se apoya en** [F03/ADR-004](../F03/ADR-004-membership-rls.md), [F06/ADR-001](../F06/ADR-001-personal-provisioning.md)
  y [F09/ADR-002](../F09/ADR-002-client-provisioning-idempotency.md) (provisioning por
  clave), [F09/ADR-001](../F09/ADR-001-group-model-and-permissions.md) §2 (sin roles) y
  [F09/ADR-003](../F09/ADR-003-leaving-a-group.md) (quien salió con vínculo).

## Contexto

Un grupo se crea con participantes por nombre y sin cuenta (F03/ADR-009). Para
que esas personas entren hacía falta decidir **qué prueba** que quien se une es
quien dice ser. F03/ADR-009 §9 lo dejó abierto y enumeró opciones: enlace de un
solo uso, correo verificado, aprobación de un miembro, o una combinación.

## Decisión

### 1. Poseer una invitación válida autoriza

> **Tener una invitación válida autoriza a entrar en el grupo y a reclamar
> cualquier participante disponible. Sin aprobación de otro miembro, sin
> coincidencia de nombre como prueba adicional.**

Consecuencia deliberada y **documentada expresamente**: **una invitación
reenviada concede el mismo acceso** a quien la reciba, mientras no caduque ni
se revoque. Es el nivel de confianza de un grupo de amigos que se pasa un
enlace; quien quiera cerrar el grupo revoca la invitación.

### 2. El token es opaco y sólo el servidor lo verifica

- 32 bytes aleatorios en base64url, generados en servidor. **Sólo se guarda su
  SHA-256** (`core.group_invitation.token_hash`): ni la base, ni la intención
  canónica del comando, ni ningún log conocen el token.
- El enlace es `<esquema-de-la-app>://join?t=<token>` y **el QR lleva la misma
  cadena**: transportan la misma autorización. No existe web de invitación ni
  Universal/App Links configurados, y no se declara lo contrario; el enlace no
  depende de la IP de Metro ni de ningún host.
- **Se verifica en cada operación**, no sólo al previsualizar: `redeem` resuelve
  el token de nuevo, y el ámbito **sale de la invitación**. Ningún `scope_id`
  del payload autoriza nada (la forma lo rechaza).
- Un token inválido, revocado, caducado o frenado **viaja como estado y no
  como excepción**: el intento fallido se apunta en `core.invitation_attempt`
  (cuenta y momento, nunca el token) y una excepción revertiría ese apunte.
  **Freno**: a partir de 20 fallos en 10 minutos por cuenta, `throttled`.

### 3. Emisión, caducidad y revocación — implementado, pendiente de confirmar

| Decisión           | Valor implementado                                                    | Recomendación                                                                                |
| ------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Quién emite        | cualquier miembro (`api.create_group_invitation`)                     | mantener                                                                                     |
| Usos               | **multiuso** hasta caducar o revocarse                                | mantener: un enlace por grupo que se reenvía; un solo uso obligaría a emitir uno por persona |
| Caducidad          | **7 días por defecto, máximo 30**; nunca eterna                       | mantener                                                                                     |
| Revocación         | cualquier miembro (`api.revoke_group_invitation`), idempotente        | mantener                                                                                     |
| El token se enseña | **una sola vez**, al emitir; un reintento responde `replay` sin token | mantener                                                                                     |

### 4. Previsualizar enseña sólo lo necesario para elegir identidad

`api.preview_invitation(token)` devuelve el nombre y el emoji del grupo, si ya
se es miembro (`member`, con el `scope_id` para abrirlo), si se salió con
vínculo (`rejoin_pending`, F09/ADR-003) o si se puede entrar (`join`), y los
**participantes disponibles** —sin cuenta vinculada, no retirados, con
presencia abierta— **sólo por nombre**. Ni deudas, ni importes, ni historial,
ni quién hay detrás de cada nombre, ni `scope_id` a quien no es miembro. Las
vistas del grupo siguen cerradas hasta entrar (medido).

### 5. Entrar: reclamar o ser nuevo, en una transacción

`api.redeem_invitation` (provisioner, idempotente por `core.provisioning_command`
con `command_type = 'invitation.redeem'`):

- **Ya miembro** → devuelve el ámbito sin escribir membresía, participante ni
  vínculo.
- **Salió con vínculo** → `REJOIN_NOT_AVAILABLE`: no se fabrica otro
  participante para eludir F09/ADR-003. Reincorporarse sigue en F10.
- **Reclamar** → membresía + vínculo. El participante ha de ser del ámbito de
  la invitación, sin vínculo, no retirado y presente. **La clave primaria del
  vínculo decide la carrera**: si dos cuentas reclaman al mismo, la segunda
  recibe `PARTICIPANT_ALREADY_CLAIMED · 409`, toda su transacción vuelve atrás
  (membresía incluida) y el cliente relee las opciones. La identidad, los
  gastos, las cuotas y el historial del participante quedan como estaban:
  reclamar es vincular, no crear.
- **Nuevo** → membresía + participante con el **nombre real del perfil** (o el
  escrito si falta; nunca el correo) + presencia desde **hoy** + vínculo. Sin
  reparto retroactivo: los gastos anteriores no lo nombran.

### 6. El cliente

La hoja del `+` de Grupos cambia de contenido —mismo tamaño y material— a
«Escanear QR» y «Introducir enlace» con el avión; la previsualización espera
450 ms y lleva número de serie, así que no hay una petición por carácter ni una
respuesta antigua valida un enlace que ya cambió. El QR lo lee `expo-camera`
(única API en Expo Go SDK 57): sólo QR, sin audio, permiso al abrir el
escáner, una lectura por apertura, y un QR ajeno no abre nada. Denegar el
permiso o cancelar devuelve a la ventana con el enlace.

## Alternativas consideradas

**Aprobación de un miembro.** Descartada por producto: convierte cada entrada
en una espera y crea un rol de facto (F09/ADR-001 §2).

**Coincidencia de nombre como prueba.** Descartada: un nombre no prueba nada
(F03/ADR-009 §9), y sólo serviría para acertar a veces.

**Invitación de un solo uso.** Descartada en §3 (revisable): obliga a emitir
una por persona y rompe el reenvío entre amigos, que es el caso corriente.

**Excepciones para los estados de invitación.** Descartadas: revertirían el
apunte del intento fallido y con él el freno.

**Guardar el token.** Descartado: sólo el hash.

## Consecuencias

- Quien tenga el enlace entra. La protección es la caducidad, la revocación y
  la aleatoriedad del token, no un control de identidad.
- Un participante disponible puede ser reclamado por quien no es esa persona
  si tiene el enlace. Es la consecuencia aceptada de §1; deshacer un vínculo
  erróneo sigue siendo de F10 (F03/ADR-009 §11).
- Compartir la invitación desde la app no existe todavía: el token sólo se
  obtiene por el mecanismo real desde fuera de la interfaz.

## Fuera de alcance

| Tema                                               | Destino                |
| -------------------------------------------------- | ---------------------- |
| Compartir la invitación (enlace y QR) desde la app | siguiente bloque de F9 |
| Abrir el enlace desde fuera de la app (deep link)  | con compartir          |
| Reincorporación de quien salió                     | F10 (F09/ADR-003 §10)  |
| Deshacer un vínculo, revocar un claim, fusionar    | F10 (F03/ADR-009 §11)  |
