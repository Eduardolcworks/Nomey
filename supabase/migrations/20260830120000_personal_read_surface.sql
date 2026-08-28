-- =========================================================================
-- F6.D · Superficie de lectura del Modo Personal
--
-- ADR-025. Cuatro objetos y ni uno mas:
--
--   api.personal_operation          lista y version vigente. UNA FILA POR
--                                   OPERACION, que es la unidad de lectura
--   api.personal_operation_version  historial: toda version de una operacion
--                                   visible, para el «Editado» y para el
--                                   detalle completo
--   api.personal_balance            el Disponible, DERIVADO de la proyeccion
--                                   canonica. Sin materializar
--   api.observed_balance(uuid[])    la observacion historica de ADR-023. UNICA
--                                   funcion de `api` que depende de ella, y
--                                   NINGUNA vista lo hace
--
-- LAS TRES GUARDAS QUE ESTA MIGRACION NO TOCA, y que hay que releer antes de
-- anadir cualquier cosa aqui:
--
--   ADR-013 §9 · la unica relacion que puede depender directamente de
--     `core.effect` es `core.current_effect`. Vale para VISTAS y para
--     FUNCIONES: los checks A3 y A3c de canonical-attribution.sql cuentan las
--     dos cosas. Nada de aqui lee `core.effect`.
--
--   ADR-023 §3.4 · NINGUNA vista de `api` puede depender de
--     `core.balance_observation`. El check A5 de balance-and-annulment.sql
--     sigue exigiendo CERO, sin una coma de relajacion. Por eso la observacion
--     sale por una FUNCION y no por una vista, y por eso este bloque anade una
--     guarda NUEVA en vez de debilitar la existente: exactamente una funcion de
--     `api` puede depender de la observacion, y es `api.observed_balance`.
--
--   ADR-008 §1 · ningun valor monetario cruza `api` como numero JSON. Todos
--     salen como TEXTO, y el check A9 cuenta cero columnas `bigint` en `api`.
--
-- `security_invoker` en las tres vistas NO es un detalle de estilo: E19 midio
-- que en una cadena de vistas decide el eslabon mas cercano a las tablas. La
-- cadena de dos vistas de este bloque —`personal_operation_version` sobre
-- `personal_operation`— es exactamente ese caso, y las dos lo llevan.
--
-- DONDE ESTA LA BARRERA DE VERDAD, medido sobre esta superficie y no supuesto.
-- Se retiraron las protecciones una a una con una fila de U1 y leyendo como U2:
--
--   predicado de propiedad fuera, invoker puesto ................. 0 filas
--   ademas invoker fuera EN LA VISTA DE `api` .................... 0 filas
--   ademas invoker fuera EN `core.current_effect` ................ SE FILTRA
--
-- Es literalmente el hallazgo de E19: con el eslabon interno `security_invoker`,
-- una vista externa ejecutada como propietario NO reintroduce el bypass. La
-- proyeccion canonica es el limite de privilegio (ADR-013 §9), y quien lo
-- vigila es el check A2 de `canonical-attribution.sql`. El `security_invoker`
-- de estas tres vistas es una capa mas, no la que aguanta sola.
--
-- NINGUN GRANT NUEVO SOBRE `core`, y no es casualidad: `authenticated` ya tiene
-- SELECT sobre las siete relaciones que esta superficie recorre, cada una con su
-- policy. Si hiciera falta un grant nuevo, seria la senal de que la superficie
-- esta preguntando algo que la RLS no habia previsto.
-- =========================================================================

-- ================== 1 · la lista y la version vigente ======================
--
-- LA UNIDAD ES LA OPERACION, no el efecto. `api.personal_effect` se conserva
-- intacta para su proposito tecnico —la atribucion por dimension, que es de lo
-- que salen las estadisticas de ADR-002 §4— y NO se convierte en lista de
-- movimientos.
--
-- ARRANCA DE `core.current_effect`, de modo que la vigencia la decide
-- `current_version_id` a traves de la proyeccion canonica y no se reimplementa
-- ningun filtro (PROJECT_STATE, invariante 5).
--
-- ============================ LAS ANULADAS =================================
--
-- Quedan fuera por DOS vias, y conviene decir exactamente cual sostiene el peso
-- porque NO son equivalentes:
--
--   1. LA QUE HOY EXCLUYE, medida: una anulacion no tiene efectos, asi que la
--      proyeccion canonica no le aporta ni una fila. Sale excluida por
--      construccion, sin ayuda de nadie.
--   2. `ov.version_kind = 'record'`, que DECLARA el criterio y que hoy es
--      REDUNDANTE. Se falsifico: quitandolo, el check pasa igual.
--
-- Y se conserva a proposito, con el motivo dicho en vez de disimulado. Es lo que
-- ADR-024 §2 pide —«las anuladas se excluyen por `version_kind`, no por ausencia
-- de efectos»— y su valor es impedir que el criterio quede implicito: quien
-- mañana cambie la relacion base de esta vista y descubra que las anuladas
-- reaparecen ira a buscar un `NOT EXISTS` sobre `core.effect`, que es lo que la
-- guarda A3 rechaza y lo que ya ocurrio en F6.A con `is_currency_locked`. El
-- check §A10 afirma que la clausula sigue aqui, para que nadie la retire por
-- «codigo muerto» sin leer esto.
--
-- En las dos vias se LEE un atributo descriptivo de la version que
-- `current_version_id` ya selecciono. No se decide la vigencia en ningun sitio.
--
-- ===================== LAS CLASES QUE ESTA SUPERFICIE SABE =================
--
-- Lista BLANCA explicita de las tres clases que el Modo Personal de F6 sabe
-- representar. NO es una restriccion tecnica: `record_internal_transfer`,
-- `record_group_expense` y `record_settlement_by_transfer` tambien producen
-- dimension de saldo en un Modo Personal, y sin esta clausula apareceran en la
-- lista EN CUANTO F9 o F12 las hagan alcanzables, antes de que la superficie de
-- producto tenga semantica para ellas. Ampliar el contrato es deliberado, y le
-- toca a la fase que traiga la clase.
--
-- ======================= LOS DOS IMPORTES, Y POR QUE SON DOS ================
--
--   `balance_amount`   FIRMADO. Lo que la operacion mueve en el saldo, sumado
--                      sobre la proyeccion canonica. Es la cifra que reconcilia
--                      con `api.personal_balance`
--   `original_amount`  El importe AUTORITATIVO DECLARADO de la version
--                      (ADR-013 §3). Un gasto lo declara en positivo y su
--                      efecto de saldo es negativo
--
-- No es redundancia: ADR-002 §2 existe precisamente para que el movimiento de
-- caja y el hecho declarado no se sustituyan el uno al otro. Y hay una razon
-- operativa ademas — `api.personal_operation_version` NO puede publicar un
-- importe firmado, porque los efectos de una version superada estan en
-- `core.effect` y ninguna vista puede leerla. Publicando aqui tambien
-- `original_amount`, la linea vigente y la tachada del «Editado» hablan la
-- MISMA unidad, y la UI aplica una sola convencion de signo por operacion. Que
-- eso sea seguro lo garantiza la guarda `OPERATION_CLASS_MISMATCH` de
-- ADR-020: todas las versiones de una operacion son de la misma clase.
--
-- ============================== EL AJUSTE ==================================
--
-- Sin concepto y sin categoria, como decidio ADR-020, y no se le inventa
-- ninguno: `concept` y `category_id` salen NULOS. Sus dos formas se distinguen
-- por `target_balance`, que es como ADR-022 §1 las define:
--
--   target_balance NO NULO  ajuste POR OBJETIVO. La linea la compone el
--                           producto —«Saldo ajustado a X»— con el objetivo
--                           declarado y, si la quiere, con el «antes» que
--                           devuelve `api.observed_balance`
--   target_balance NULO     ajuste POR DELTA. `original_amount` ES el delta
--                           declarado, CON SU SIGNO —`core.operation_version`
--                           no tiene restriccion de positividad— y basta para
--                           representar un ajuste manual por importe
--
-- ======================== EL ORDEN, Y SU DESEMPATE =========================
--
-- Una vista no puede imponer el orden a PostgREST, asi que el orden canonico es
-- CONTRATO DEL CLIENTE y las columnas para expresarlo estan aqui:
--
--   effective_date desc, effective_time desc nulls last,
--   operation_created_at desc, operation_id desc
--
-- `effective_time` es ANULABLE en la columna —nulo significa «sin hora
-- registrada», NUNCA medianoche—, aunque las tres clases de F6 la exigen. El
-- `nulls last` esta por las clases que no la piden.
--
-- El desempate es `operation.created_at` y NO el de la version: el instante de
-- registro de la OPERACION es estable frente a las correcciones, asi que
-- corregir un movimiento no lo reordena entre sus pares del mismo dia y hora.
-- `operation_id` cierra el orden total.

create view api.personal_operation
with (security_invoker = true) as
select
  o.id                        as operation_id,
  o.operation_class,
  e.scope_id,
  e.currency_definition_id,
  sum(e.balance_amount)::text as balance_amount,
  ov.original_amount::text    as original_amount,
  ov.effective_date,
  ov.effective_time,
  md.concept,
  md.category_id,
  ad.target_balance::text     as target_balance,
  o.current_version_id,
  -- El predecesor de la version vigente. NULO si nunca se corrigio, que es
  -- exactamente el discriminante de «Editado».
  --
  -- Se publica el IDENTIFICADOR y no `version_no - 1`: ADR-011 §11 reservo a la
  -- frontera autoritativa el invariante «el predecesor es la version vigente
  -- anterior» y NO lo hizo estructural, asi que restar uno seria una suposicion.
  -- `supersedes_version_id` es el dato, y ademas es la clave con la que el
  -- cliente trae la fila anterior de `api.personal_operation_version` en UNA
  -- consulta por pagina.
  ov.supersedes_version_id    as previous_version_id,
  ov.version_no,
  o.created_at                as operation_created_at
from core.current_effect e
join core.operation_version ov   on ov.id = e.operation_version_id
join core.operation o            on o.id  = ov.operation_id
join core.scope s                on s.id  = e.scope_id
left join core.movement_detail md   on md.operation_version_id = ov.id
left join core.adjustment_detail ad on ad.operation_version_id = ov.id
where s.kind = 'personal'
  -- PROPIEDAD, no membresia. ADR-016: el saldo y la economica sin participante
  -- son del DUENO del Modo Personal, y `owner_user_id` no se proyecta nunca.
  and s.owner_user_id = (select auth.uid())
  and o.operation_class in ('personal_expense', 'personal_income', 'adjustment')
  and ov.version_kind = 'record'
  and e.balance_amount is not null
group by o.id, o.operation_class, e.scope_id, e.currency_definition_id,
         ov.original_amount, ov.effective_date, ov.effective_time,
         md.concept, md.category_id, ad.target_balance,
         o.current_version_id, ov.supersedes_version_id, ov.version_no,
         o.created_at;

comment on view api.personal_operation is
  'Lista y version vigente del Modo Personal, UNA FILA POR OPERACION. Excluye anuladas por version_kind y acota a las tres clases de F6 (ADR-025).';
comment on column api.personal_operation.balance_amount is
  'FIRMADO: lo que la operacion mueve en el saldo, sobre la proyeccion canonica. Reconcilia con api.personal_balance.';
comment on column api.personal_operation.original_amount is
  'Importe DECLARADO de la version vigente (ADR-013 §3). Un gasto lo declara en positivo. En un ajuste por delta ES el delta, con su signo.';
comment on column api.personal_operation.target_balance is
  'Objetivo declarado si el ajuste fue POR OBJETIVO; nulo si fue por delta y en toda clase que no sea ajuste (ADR-022 §1).';
comment on column api.personal_operation.previous_version_id is
  'Predecesor de la version vigente, o nulo si nunca se corrigio. Es el discriminante de «Editado» y la clave para traer la fila anterior en una consulta.';

grant select on api.personal_operation to authenticated;

-- ===================== 2 · el historial de correcciones ====================
--
-- Una fila por VERSION de cada operacion visible en `api.personal_operation`.
-- Cubre los dos casos que el producto pide con una sola relacion:
--
--   «Editado»          ?operation_version_id=in.(<los previous_version_id
--                      de la pagina>)  — UNA consulta, no una por fila
--   detalle completo   ?operation_id=eq.X&order=version_no.desc
--
-- SE ANCLA EN `api.personal_operation`, y no repite ni el filtro de propiedad
-- ni la lista blanca de clases ni la exclusion de anuladas. Es lo que mantiene
-- las dos superficies imposibles de desincronizar: ampliar el contrato se hace
-- en UN sitio.
--
-- CONSECUENCIA QUE CONVIENE VER DE FRENTE: una operacion ANULADA no aparece
-- aqui tampoco, porque su version vigente no deja efectos y desaparece del
-- ancla. Es lo decidido — ADR-024 dice que la trazabilidad de una anulada «solo
-- es alcanzable por VIA INTERNA», y convertirla en historial de `api` la
-- devolveria a la superficie normal por la puerta de atras. La via interna
-- existe, esta bajo RLS y la comprueba `supabase/checks/read-surface.sql` §E.
--
-- NO LEE `core.effect`, y no podria: la guarda A3 lo prohibe. Por eso el
-- importe de una version superada es `original_amount` —el hecho DECLARADO, que
-- vive en la propia version (ADR-013 §3)— y no un importe firmado derivado de
-- sus efectos historicos. No se fabrica el signo con un `case` sobre la clase:
-- seria aritmetica paralela a la que ya hizo el escritor, exactamente lo que
-- ADR-023 rechazo para el saldo.
--
-- QUE CAMBIO ENTRE DOS VERSIONES lo responde la fila entera, no una columna de
-- diff: importe, moneda, fecha, hora, concepto, categoria y objetivo de ajuste
-- estan todos aqui, cada uno tal como la version lo declaro. Cuanto de eso se
-- muestra lo decide la UI.
--
-- LA RLS QUE LO HACE POSIBLE ya existia, y es deliberada:
-- `operation_version_client_select` deriva de los efectos HISTORICOS, no solo
-- de los vigentes, porque la RLS de `core.effect` filtra por ambito y no por
-- vigencia. Es literalmente lo que ADR-013 §10 queria decir con «el historial es
-- consultable sin estructuras adicionales». `core.movement_detail` y
-- `core.adjustment_detail` llevan la misma regla.
--
-- `version_kind` NO se proyecta: en esta superficie seria constante `record`
-- —las anuladas no llegan— y una columna constante invita a creer que las
-- anulaciones se ven aqui.

create view api.personal_operation_version
with (security_invoker = true) as
select
  po.operation_id,
  ov.id                              as operation_version_id,
  po.operation_class,
  ov.version_no,
  ov.supersedes_version_id,
  (ov.id = po.current_version_id)    as is_current,
  ov.original_amount::text           as original_amount,
  ov.original_currency_definition_id as currency_definition_id,
  ov.effective_date,
  ov.effective_time,
  md.concept,
  md.category_id,
  ad.target_balance::text            as target_balance,
  ov.created_at                      as version_created_at
from api.personal_operation po
join core.operation_version ov      on ov.operation_id = po.operation_id
left join core.movement_detail md   on md.operation_version_id = ov.id
left join core.adjustment_detail ad on ad.operation_version_id = ov.id;

comment on view api.personal_operation_version is
  'Historial: toda version de una operacion visible en api.personal_operation. Sirve el «Editado» y el detalle completo. Anuladas fuera, por el ancla (ADR-025).';
comment on column api.personal_operation_version.original_amount is
  'Importe DECLARADO de ESA version (ADR-013 §3), no un importe firmado: los efectos historicos viven en core.effect y ninguna vista puede leerla.';
comment on column api.personal_operation_version.is_current is
  'Verdadero en la version que current_version_id selecciona. La vigencia la decide el puntero; esta columna solo la refleja.';

grant select on api.personal_operation_version to authenticated;

-- ============================ 3 · el saldo =================================
--
-- DERIVADO de la proyeccion canonica, sin materializar y sin cache
-- (ADR-013 §1 y §9). La agregacion la hace el servidor: el cliente no tiene que
-- descargarse los movimientos para sumarlos.
--
-- ES UNA VISTA Y NO UNA RPC a proposito: no tiene parametros, no necesita
-- control de flujo, y como vista conserva el filtrado y la composicion de
-- PostgREST sin ganar nada a cambio.
--
-- `LEFT JOIN LATERAL` Y NO UN `GROUP BY`, y la diferencia importa: un ambito
-- SIN efectos devuelve UNA FILA CON 0, no cero filas. Con la agregacion directa,
-- «todavia no hay movimientos» y «no hay Modo Personal» se leerian igual —cero
-- filas— y son dos estados que el cliente pinta distinto. Es el mismo fallo
-- silencioso contra el que avisa el punto 4 de las obligaciones de F6.E.
--
-- NO lleva `Disponible tras saldar`: esa cifra necesita deuda, que llega con F9.
-- Por eso el objeto se llama `personal_balance` y no `available`.

create view api.personal_balance
with (security_invoker = true) as
select
  s.id                          as scope_id,
  s.base_currency_definition_id as currency_definition_id,
  coalesce(b.total, 0)::text    as balance_amount
from core.scope s
left join lateral (
  select sum(e.balance_amount) as total
  from core.current_effect e
  where e.scope_id = s.id
    and e.balance_amount is not null
) b on true
where s.kind = 'personal'
  and s.owner_user_id = (select auth.uid());

comment on view api.personal_balance is
  'El Disponible del Modo Personal, DERIVADO de la proyeccion canonica. Sin materializar y sin cache. Un ambito sin efectos devuelve una fila con 0 (ADR-013 §1, ADR-025).';

grant select on api.personal_balance to authenticated;

-- ====================== 4 · la observacion historica =======================
--
-- ADR-023: `balance_before` y `balance_after` son FOTOGRAFIAS, escritas una vez
-- bajo lock y nunca releidas para responder la pregunta actual. Salen por `api`
-- con el nombre que el ADR §3.5 fija —`observed_balance_before` y
-- `observed_balance_after`—, para que en los dos lados diga lo que es.
--
-- ======================= POR QUE UNA FUNCION Y NO UNA VISTA ================
--
-- El check A5 de `balance-and-annulment.sql` cuenta las vistas de `api` que
-- dependen de `core.balance_observation` y exige CERO. Convertir ese cero en
-- «exactamente una, y es esta» funcionaria, pero DEBILITA el invariante literal
-- justo donde `AGENTS.md` §4 avisa de que relajar una guarda para arreglar algo
-- es peor que el bug. Una funcion consigue lo mismo sin tocar A5, que sigue
-- diciendo cero, y ADR-013 §9 ya establecio que las funciones de lectura
-- economicas se escriben con `BEGIN ATOMIC` PRECISAMENTE para que el catalogo
-- las cubra. Lo que se anade es una guarda NUEVA —exactamente una funcion de
-- `api` depende de la observacion, y es esta—, no una guarda debilitada.
--
-- ======================= POR QUE UN ARRAY, Y NO UN ID ======================
--
-- Con un solo identificador, pintar una pagina de N operaciones costaria N
-- llamadas. El array resuelve la pagina entera en UNA, y el detalle reutiliza la
-- MISMA superficie con un array de un elemento. Nulo devuelve las del actor.
--
-- ============================ SECURITY INVOKER =============================
--
-- Y es lo contrario de `api.claimed_dimension()`, deliberadamente:
--
--   una lectura de RECLAMACION debe ATRAVESAR la RLS, y por eso aquella es
--   `SECURITY DEFINER` de `postgres`;
--   esta NO debe atravesarla, asi que corre como el invocante y la policy
--   `balance_observation_client_select` sigue mordiendo.
--
-- Consecuencia medible, y es la que evita el oraculo: un `operation_id` ajeno
-- devuelve CERO FILAS SIN ERROR. No hay identidad que enumerar ni canal de
-- error del que deducir existencia.
--
-- SE ANCLA EN `api.personal_operation`, con lo que hereda la propiedad, la
-- lista blanca de clases y la exclusion de anuladas: la observacion de una
-- anulacion —que ADR-023 §4 escribe a proposito, porque «el borrado es el
-- momento donde peor sienta un hueco de auditoria»— NO sale por aqui. Sigue en
-- `core`, bajo RLS, alcanzable por la via interna.
--
-- DEVUELVE TODAS LAS VERSIONES, no solo la vigente, y `is_current` las separa:
-- la linea de la lista usa la vigente, y el detalle puede acompanar cada version
-- del historial con la suya. Cada observacion es del INSTANTE EN QUE SU VERSION
-- SE ESCRIBIO (ADR-023 §5): corregir hoy un movimiento de hace tres meses
-- observa el saldo DE HOY, y la UI debe presentarlo como observacion del
-- sistema, nunca como «el saldo que tenias aquel dia».

create function api.observed_balance(p_operation_ids uuid[] default null)
returns table (
  operation_id            uuid,
  operation_version_id    uuid,
  is_current              boolean,
  scope_id                uuid,
  observed_balance_before text,
  observed_balance_after  text
)
language sql
stable
set search_path = ''
begin atomic
  select po.operation_id,
         bo.operation_version_id,
         (bo.operation_version_id = po.current_version_id),
         bo.scope_id,
         bo.balance_before::text,
         bo.balance_after::text
  from core.balance_observation bo
  join core.operation_version ov on ov.id = bo.operation_version_id
  join api.personal_operation po on po.operation_id = ov.operation_id
                                and po.scope_id     = bo.scope_id
  where p_operation_ids is null
     or po.operation_id = any(p_operation_ids);
end;

comment on function api.observed_balance(uuid[]) is
  'Observacion historica de saldo de ADR-023, por lote. ILUSTRATIVA: el Disponible sale de api.personal_balance y NUNCA de aqui. SECURITY INVOKER (ADR-025).';

revoke execute on function api.observed_balance(uuid[]) from public;
grant  execute on function api.observed_balance(uuid[]) to authenticated;
