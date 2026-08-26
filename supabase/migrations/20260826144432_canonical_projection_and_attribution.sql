-- Proyeccion canonica de efectos vigentes y atribucion economica al usuario.
--
-- Sexta migracion real. Cierra el gate que ADR-012 delego en D11 y que ADR-013
-- no llego a recoger —«que efectos son mios»— y materializa la PRIMERA
-- SUPERFICIE `api` REALMENTE UTIL PARA EL CLIENTE.
--
-- Trae cuatro cosas, en este orden de dependencia:
--
--   1. propiedad durable del Modo Personal          core.scope.owner_user_id
--   2. proyeccion canonica de efectos vigentes      core.current_effect
--   3. atribucion por AMBITO, ruta normal           api.personal_effect
--   4. atribucion por PARTICIPANTE, claim acotado   api.claimed_dimension()
--
-- La regla que las une esta en ADR-016 y es POR DIMENSION:
--
--   balance                   -> del dueno del Modo Personal
--   economica SIN participante -> del dueno del Modo Personal
--   economica CON participante -> del usuario vinculado a ese participante
--   deuda, lado deudor         -> del usuario vinculado al deudor, en NEGATIVO
--   deuda, lado acreedor       -> del usuario vinculado al acreedor, en POSITIVO
--
-- NO intervienen: `participant_period` al leer · `linked_at` ·
-- `operation.created_by` · `operation_version.created_by` · la membresia como
-- sustituto de la propiedad.
--
-- Fuentes:
--   ADR-002 §2  · un usuario tiene un unico ambito financiero personal
--   ADR-006 §3, §5 · grants minimos y lectura por vistas `security_invoker`
--   ADR-007 §4  · la membresia no se lee directamente desde el cliente
--   ADR-008 §1  · los valores exactos salen como TEXTO
--   ADR-012 §3, §8 · los efectos apuntan al participante; el claim no da acceso
--   ADR-013 §8, §9 · dimensiones del efecto y proyeccion canonica
--   ADR-016     · atribucion economica de efectos a un usuario

-- ============================ 1 · propiedad durable del Modo Personal =======
-- ADR-016. `core.membership` significa AUTORIZACION ACTUAL y no propiedad
-- economica: es un dato de presente, y si se usara como propiedad, perder la
-- membresia borraria de las finanzas personales toda la historia anterior.
--
-- La propiedad es un HECHO PRIMARIO que faltaba. No es una tabla derivada de
-- las que ADR-007 §6 y ADR-013 §10 rechazan: su contenido no es derivable de
-- ninguna otra relacion.
--
-- Va como columna de `core.scope` y no como relacion aparte porque asi las tres
-- cardinalidades son ESTRUCTURALES. Una relacion separada no puede exigir que
-- la fila exista, igual que no puede exigirse que un reparto tenga
-- participantes.
--
-- Sin FK a `auth.users`, igual que `membership.user_id` y `operation.created_by`:
-- la retencion y la purga de cuentas siguen expresamente abiertas.

alter table core.scope add column owner_user_id uuid;

-- `kind = 'personal'` <=> tiene dueno. Las dos direcciones a la vez:
-- ningun personal sin dueno, y ningun `group` o `couple` con el.
alter table core.scope
  add constraint scope_dueno_solo_en_personal
  check ((kind = 'personal') = (owner_user_id is not null));

-- Un usuario, como maximo un Modo Personal (ADR-002 §2). Los NULL no colisionan
-- entre si, de modo que los ambitos compartidos conviven sin restriccion.
create unique index scope_un_personal_por_usuario
  on core.scope (owner_user_id);

comment on column core.scope.owner_user_id is
  'Propietario economico durable del Modo Personal. NO es membresia: sobrevive a perderla (ADR-016). Nulo en group y couple, por constraint.';

-- > INVARIANTES QUE QUEDAN EN LA FRONTERA AUTORITATIVA, y ninguna constraint
-- > puede sustituir:
-- >
-- >  · el dueno de un Modo Personal es TAMBIEN miembro de el;
-- >  · y es su UNICO miembro;
-- >  · propiedad y membresia se crean en la MISMA transaccion;
-- >  · ningun `balance_amount` en un ambito `group` (data-model.md §2);
-- >  · un Modo Pareja tiene exactamente dos miembros;
-- >  · elegibilidad del participante contra `operation_version.effective_date`.
-- >
-- > La primera importa mas que antes: propiedad y membresia han dejado de ser
-- > el mismo dato y PUEDEN DIVERGIR. Es justo lo que se busca —perder la
-- > membresia no borra la historia— y por eso el writer debe crearlas juntas.

-- ================================= 2 · proyeccion canonica =================
-- ADR-013 §9. Es la UNICA relacion autorizada a depender directamente de
-- `core.effect`, y el sexto check comprueba esa guarda contra el catalogo.
--
-- Responsabilidad, y solo esa: QUE EFECTOS CUENTAN ECONOMICAMENTE AHORA, es
-- decir los de la version que `operation.current_version_id` selecciona. Los
-- efectos historicos permanecen en la tabla y NO aparecen aqui.
--
-- Lo que NO hace, deliberadamente: no dice que es mio, ni quien puede verlo, ni
-- como se presenta. No lleva ninguna columna que dependa de `auth.uid()`,
-- porque eso la haria depender de quien pregunta y balances, estadisticas y
-- deudas heredarian un filtro por usuario que ninguna de las tres quiere.
--
-- `security_invoker` NO es un detalle: E19 midio que en una cadena de vistas
-- decide el eslabon mas cercano a las tablas, y que sin el se filtran filas de
-- otro ambito INCLUSO SIN SESION, devolviendo cifras creibles.
--
-- Nombre: `current_effect`, sustantivo en singular como el resto de `core`
-- —`operation`, `effect`, `split`, `scope`— con el calificador que nombra
-- exactamente su unica responsabilidad.

create view core.current_effect
with (security_invoker = true) as
select e.*
from core.effect e
join core.operation o on o.current_version_id = e.operation_version_id;

comment on view core.current_effect is
  'Proyeccion canonica de ADR-013 §9: efectos de la version vigente. Unica relacion que puede depender directamente de core.effect. No atribuye ni presenta.';

-- E19 midio que una cadena `security_invoker` exige privilegio del invocante
-- sobre CADA eslabon, tambien el intermedio. Sin este grant, la superficie de
-- `api` falla con 42501 en vez de devolver filas.
grant select on core.current_effect to authenticated;

-- ======================= 3 · atribucion por ambito · ruta normal ============
-- Las dos dimensiones que NO nombran participante: el saldo, que por ADR-013 §8
-- no tiene ningun campo de identidad propio, y la economica sin participante,
-- que es la que produce el Modo Personal.
--
-- Ambas viven SIEMPRE en el Modo Personal de su dueno, donde el usuario es
-- miembro, asi que esta ruta no necesita ninguna frontera privilegiada:
-- `security_invoker` basta y la RLS de `core.effect` sigue mordiendo.
--
-- El Modo Pareja queda fuera por el `kind`, y no por omision: el glosario fija
-- que su saldo NO entra en `Disponible tras saldar` porque «al no existir
-- porcentajes de propiedad, ningun miembro tiene una parte determinable de el»
-- (invariante 16).
--
-- La propiedad se comprueba contra `owner_user_id`, NUNCA contra la membresia.
-- `owner_user_id` no se proyecta: es un dato de identidad que el cliente no
-- necesita para leer lo suyo.
--
-- ADR-008 §1: los importes salen como TEXTO. Un `bigint` que cruza como numero
-- JSON se degrada al parsearse, y E11 lo midio.

create view api.personal_effect
with (security_invoker = true) as
select
  e.id,
  e.scope_id,
  e.accounting_class,
  e.currency_definition_id,
  ov.effective_date,
  e.balance_amount::text as balance_amount,
  -- Si la economica nombra participante, NO es de esta ruta: pertenece al
  -- claim por participante. Anularla aqui es lo que mantiene las dos rutas
  -- DISJUNTAS y hace imposible la doble contabilizacion.
  (case when e.economic_participant_id is null then e.economic_amount end)::text
    as economic_amount
from core.current_effect e
join core.scope s on s.id = e.scope_id
join core.operation_version ov on ov.id = e.operation_version_id
where s.kind = 'personal'
  and s.owner_user_id = (select auth.uid())
  and (e.balance_amount is not null
       or (e.economic_amount is not null and e.economic_participant_id is null));

comment on view api.personal_effect is
  'Dimensiones atribuibles por PROPIEDAD del Modo Personal: saldo y economica sin participante. security_invoker, importes como texto (ADR-008 §1).';

grant select on api.personal_effect to authenticated;

-- ================= 4 · atribucion por participante · claim acotado =========
-- Las dos dimensiones que SI nombran participante: la economica con
-- participante y la deuda. Pueden vivir en cualquier ambito, incluido uno del
-- que el usuario NO es miembro — que es exactamente el caso de la reclamacion
-- retroactiva de `data-model.md` §6: «al vincular un participante con un
-- usuario, todo su historial se incorpora a sus finanzas personales EN LAS
-- FECHAS ORIGINALES».
--
-- Medido antes de escribir esto: con la RLS actual, un usuario vinculado a un
-- participante de un grupo del que no es miembro alcanza CERO efectos. Sin esta
-- frontera, reclamar no recupera nada.
--
-- POR QUE NO SE AMPLIA LA RLS DE `core.effect`, que seria lo obvio: la RLS
-- concede FILAS, no columnas, y ADR-013 §8 permite expresamente que una misma
-- fila lleve varias dimensiones. Se midio la fuga: con una policy de
-- pertenencia por dimension, quien es SOLO el deudor de una fila mixta obtiene
-- ademas el importe economico de un participante ajeno, la identidad del
-- acreedor y el `scope_id` del ambito. No es un defecto de la policy: es lo que
-- E20 ya habia medido al decir que la RLS no acota columnas.
--
-- ESTA FUNCION NO PUEDE CONFIAR EN LA RLS NI EN LA PROYECCION CANONICA.
-- Se midio: dentro de un `SECURITY DEFINER` cuyo owner es el propietario de las
-- tablas, la proyeccion canonica devuelve TODAS las filas —no es frontera de
-- privacidad ahi dentro—. Por eso el filtrado por vinculo esta en el `WHERE`
-- del propio cuerpo, ANTES de proyectar nada.
--
-- SIN PARAMETROS, y es una decision de seguridad: no acepta `user_id`,
-- `participant_id`, `scope_id` ni `operation_id`. No hay identidad ajena que
-- pasarle ni nada que enumerar. El actor sale siempre de `auth.uid()`.
--
-- Cuerpo `BEGIN ATOMIC` porque ADR-013 §9 lo exige para las funciones de
-- lectura economicas: es la unica forma que deja dependencias analizables en el
-- catalogo, de modo que la guarda estructural tambien la cubre.

create function api.claimed_dimension()
returns table (
  accounting_class       text,
  currency_definition_id uuid,
  effective_date         date,
  dimension              text,
  amount                 text
)
language sql
stable
security definer
set search_path = ''
begin atomic
  select e.accounting_class,
         e.currency_definition_id,
         ov.effective_date,
         'economic'::text,
         e.economic_amount::text
  from core.current_effect e
  join core.operation_version ov on ov.id = e.operation_version_id
  join core.participant_user_link l on l.participant_id = e.economic_participant_id
  where l.user_id = (select auth.uid())
    and e.economic_amount is not null

  union all

  -- Lado DEUDOR: lo que el usuario debe, en negativo.
  select e.accounting_class,
         e.currency_definition_id,
         ov.effective_date,
         'debt'::text,
         (- e.debt_amount)::text
  from core.current_effect e
  join core.operation_version ov on ov.id = e.operation_version_id
  join core.participant_user_link l on l.participant_id = e.debt_debtor_participant_id
  where l.user_id = (select auth.uid())
    and e.debt_amount is not null

  union all

  -- Lado ACREEDOR: lo que le deben al usuario, en positivo.
  select e.accounting_class,
         e.currency_definition_id,
         ov.effective_date,
         'debt'::text,
         e.debt_amount::text
  from core.current_effect e
  join core.operation_version ov on ov.id = e.operation_version_id
  join core.participant_user_link l on l.participant_id = e.debt_creditor_participant_id
  where l.user_id = (select auth.uid())
    and e.debt_amount is not null;
end;

comment on function api.claimed_dimension() is
  'Dimensiones atribuibles por VINCULO de participante, incluidas las de ambitos no legibles. Frontera privilegiada: su lista de columnas ES la frontera de privacidad (ADR-016).';

-- > LA LISTA DE COLUMNAS ES LA FRONTERA DE PRIVACIDAD, y ampliarla es una
-- > decision de privacidad, no una mejora de UX.
-- >
-- > NO devuelve: `scope_id` · ningun identificador de participante · el id del
-- > efecto, de la operacion ni de la version · las demas dimensiones de la
-- > misma fila · el nombre o los miembros del ambito · el saldo compartido.
-- >
-- > El usuario obtiene el importe que le corresponde y su fecha economica
-- > original, que es lo que `data-model.md` §6 promete, y NADA del ambito.
--
-- > ESTO NO ES EL «ACCESO RESIDUAL» de ADR-012 §12, que sigue abierto: aqui hay
-- > lectura acotada de lo propio y NINGUNA capacidad de liquidar.
--
-- `linked_at` NO aparece en el cuerpo. Filtrar por el haria desaparecer
-- exactamente el historial que la reclamacion existe para recuperar.
--
-- `participant_period` tampoco: valida elegibilidad AL ESCRIBIR contra
-- `operation_version.effective_date`, y cerrar un periodo no puede borrar
-- historia ya persistida (ADR-012 §12).

-- ADR-006 §4, las dos capas.
revoke execute on function api.claimed_dimension() from public;
-- Solo el rol autenticado. `anon` no recibe nada: no hay superficie anonima.
grant execute on function api.claimed_dimension() to authenticated;

-- No se concede al cliente ningun acceso nuevo sobre `core.participant_user_link`:
-- la frontera lo lee con los privilegios de su owner y el cliente sigue sin
-- poder saber que cuenta hay detras de una identidad contextual (ADR-012 §1).
--
-- Tampoco se anade ninguna policy a `core.effect`. Su RLS sigue siendo
-- exactamente la de ADR-013 §10: membresia del ambito.
