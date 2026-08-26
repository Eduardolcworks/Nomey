-- Frontera autoritativa de escritura · 7b.
--
-- Octava migracion real y SEGUNDA MITAD del writer. Trae las tres clases que
-- CREAN O CONSUMEN DEUDA, y con ellas el protocolo de serializacion de
-- ADR-013 §11:
--
--   api.record_group_expense          group_expense
--   api.record_debt_settlement        debt_settlement
--   api.record_settlement_by_transfer settlement_by_transfer
--
-- La costura con 7a no es de tamano: ADR-013 §11 decide quien participa en el
-- protocolo «por que efectos produce, no por el nombre de la clase». Ninguna de
-- las cuatro clases de 7a toca deuda; las tres de aqui la tocan todas, y por eso
-- este bloque —y solo este— ensancha el privilegio del writer sobre
-- `core.scope`.
--
-- Fuentes:
--   ADR-002 §3, §5, §7  · clases contables, reparto por mayor resto, derivacion
--   ADR-003 §1, T11     · importes exactos, reparto sobre magnitud no negativa
--   ADR-008 §1, §3      · valores exactos como texto, tipo JSON original observable
--   ADR-009             · forma, seguridad y atomicidad de la frontera
--   ADR-010, ADR-011    · idempotencia, comando, canonicalizacion, CAS y orden
--   ADR-012 §3, §7, §8  · participante contextual, elegibilidad, identidad
--   ADR-013 §5, §9, §11 · reparto contextual, proyeccion canonica, serializacion
--   ADR-016             · propiedad durable del Modo Personal

-- ================================ 0 · privilegios que vuelven =============
-- 7a los retiro porque NINGUNA funcion los ejercia, aplicando hacia atras el
-- principio «cada privilegio corresponde a una ruta concreta». Vuelven ahora
-- porque `api.record_group_expense` los ejerce.
--
-- `core.frozen_conversion` NO vuelve: el FX cross-currency sigue sin regla de
-- resolucion (ADR-009 §8) y ninguna funcion de este bloque escribe una
-- conversion. Volvera cuando exista su ruta.

grant insert on core.split             to nomey_writer;
grant insert on core.split_participant to nomey_writer;

-- La proyeccion canonica es la UNICA via por la que el writer deriva deuda
-- vigente. Nunca `core.effect` a pelo: ADR-013 §9 pone la regla de vigencia en
-- la proyeccion y prohibe replicarla en ningun consumidor, y el modo de fallo
-- que evita —olvidar el filtro y seguir devolviendo cifras creibles— es el mas
-- probable del modelo.
grant select on core.current_effect to nomey_writer;

-- =========================== 1 · el lock del protocolo de deuda ============
-- ADR-013 §11, paso 2: bloquear la FILA ESTABLE del ambito. Es el unico
-- ensanchamiento de privilegio del writer que queda en 3.C, y va aislado para
-- que se revise solo.
--
-- MEDIDO antes de escribirlo, en una transaccion desechable contra este mismo
-- stack, y los cuatro resultados condicionan la forma que tiene aqui:
--
--   1. SIN el privilegio de UPDATE —con policy o sin ella— `SELECT ... FOR
--      UPDATE` falla con `42501 permission denied for table scope`. Es un error
--      RUIDOSO, y precisa lo que E20 midio: el fallo silencioso es el de la
--      POLICY ausente, no el del privilegio ausente.
--   2. CON el privilegio por columna y SIN policy de UPDATE, el mismo bloqueo
--      devuelve CERO FILAS SIN ERROR. Es exactamente el sobrepago de E15 con la
--      causa una capa mas abajo, y por eso hacen falta LAS DOS COSAS.
--   3. Con ambas, el bloqueo funciona sobre cualquier ambito, incluido uno cuyo
--      dueno no es el actor. Es imprescindible: la deuda de un Grupo no es de
--      quien la escribio.
--   4. El `WITH CHECK (false)` impide la modificacion REAL: un `UPDATE` de
--      `base_currency_definition_id`, incluso AL MISMO VALOR, falla con «new row
--      violates row-level security policy». Y el `GRANT` por columna deja fuera
--      todo lo demas: `kind`, `owner_user_id`, `DELETE` e `INSERT` responden
--      `42501`.
--
-- Es decir: la capacidad concedida es exactamente «poder bloquear», y ninguna
-- otra. Se elige esta columna y no otra porque es la unica capacidad de
-- escritura que el writer podria llegar a tener legitimamente sobre un ambito
-- —cambiar la moneda base antes de la primera operacion— y la FK compuesta de
-- `core.effect` ya impide ejercerla en cuanto existan efectos.
grant update (base_currency_definition_id) on core.scope to nomey_writer;

-- `USING (true)` es lo que hace visible la fila al bloqueo; `WITH CHECK (false)`
-- es lo que impide que el bloqueo se convierta en una escritura. Las dos
-- clausulas hacen cosas distintas y ninguna sobra.
create policy scope_writer_lock on core.scope
  for update to nomey_writer
  using (true)
  with check (false);

comment on policy scope_writer_lock on core.scope is
  'Permite SELECT ... FOR UPDATE del protocolo de deuda (ADR-013 §11) sin permitir ninguna modificacion real: WITH CHECK (false).';

-- Pasos 2 y 3 del protocolo: bloquear, y EN ORDEN DETERMINISTA ASCENDENTE si
-- son varios, que es lo que impide el deadlock entre dos operaciones que
-- alcanzan los mismos ambitos nombrandolos al reves.
--
-- Se bloquea de una en una y en orden explicito, y no con un solo
-- `ORDER BY ... FOR UPDATE`: el orden de adquisicion dentro de una sentencia
-- depende del plan, y confiarle el determinismo a un plan es confiarselo al
-- planificador.
create function sec.lock_debt_scopes(p_scopes uuid[])
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_scope  uuid;
  v_locked uuid;
begin
  for v_scope in
    select distinct s from unnest(p_scopes) as s where s is not null order by 1
  loop
    select sc.id into v_locked from core.scope sc where sc.id = v_scope for update;
    -- Cero filas aqui NO significa «el ambito no existe»: su existencia ya se
    -- comprobo antes. Significa que falta la policy o el privilegio de UPDATE,
    -- que es el fallo que E20 midio que NO da error. Se convierte en ruidoso a
    -- proposito: continuar seria validar y escribir sobre datos que la
    -- transaccion cree haber protegido.
    if v_locked is null then
      raise exception
        'no se pudo bloquear el ambito % para serializar la deuda (ADR-013 §11): falta la policy o el privilegio de UPDATE del writer',
        v_scope;
    end if;
  end loop;
end
$fn$;

comment on function sec.lock_debt_scopes(uuid[]) is
  'Pasos 2-3 de ADR-013 §11: bloquea las filas estables de los ambitos cuya deuda puede cambiar, en orden ascendente por identificador.';

revoke execute on function sec.lock_debt_scopes(uuid[]) from public;

-- Los ambitos en los que la version indicada dejo dimension de deuda. Es la
-- mitad del conjunto a bloquear en una CORRECCION: sin ella, sacar un ambito de
-- la intencion lo dejaria fuera del lock justo cuando su deuda cambia, que es
-- la «serializacion parcial» que ADR-013 §11 declara equivalente a no
-- serializar nada.
--
-- Lee la PROYECCION CANONICA, nunca `core.effect`.
create function sec.debt_scopes_of_version(p_version uuid)
returns uuid[]
language sql
stable
set search_path = ''
begin atomic
  select coalesce(array_agg(distinct e.scope_id), '{}'::uuid[])
    from core.current_effect e
   where e.operation_version_id = p_version
     and e.debt_amount is not null;
end;

comment on function sec.debt_scopes_of_version(uuid) is
  'Ambitos con dimension de deuda en una version. Entra en el conjunto bloqueado de una correccion (ADR-013 §11).';

revoke execute on function sec.debt_scopes_of_version(uuid) from public;

-- Paso 4: leer la deuda DESPUES del lock. La direccion se netea igual que
-- `deriveDebts` de `src/domain/effects/debt.ts`: los dos sentidos del par se
-- suman con signo y el resultado se acota a cero, de modo que liquidar en la
-- direccion contraria a la deuda existente devuelva 0 —y no un negativo— igual
-- que hace `pendingDebt` cuando no encuentra el par en esa direccion.
--
-- `p_exclude_version` es la version que una correccion SUPERSEDE. Sin ella,
-- corregir una liquidacion de 3000 a 4000 se validaria contra una deuda que
-- todavia incluye los 3000 que esa misma correccion esta a punto de retirar.
-- El neteo es UNO SOLO, y vive aqui. `pending_debt` lo acota a cero para
-- validar una liquidacion; la validacion de las correcciones necesita el signo
-- REAL, porque un pendiente negativo es exactamente lo que tiene que detectar.
-- Dos implementaciones del mismo neteo serian dos sitios donde equivocarse.
create function sec.net_debt(
  p_scope           uuid,
  p_debtor          uuid,
  p_creditor        uuid,
  p_exclude_version uuid
)
returns bigint
language sql
stable
set search_path = ''
begin atomic
  select coalesce(sum(
           case
             when e.debt_debtor_participant_id   = p_debtor
              and e.debt_creditor_participant_id = p_creditor then  e.debt_amount
             when e.debt_debtor_participant_id   = p_creditor
              and e.debt_creditor_participant_id = p_debtor   then -e.debt_amount
             else 0
           end), 0)
    from core.current_effect e
   where e.scope_id = p_scope
     and e.debt_amount is not null
     and (p_exclude_version is null or e.operation_version_id <> p_exclude_version);
end;

comment on function sec.net_debt(uuid, uuid, uuid, uuid) is
  'Neteo con signo del par en un ambito, sobre la proyeccion canonica. Negativo = se liquido mas de lo debido (ADR-013 §9).';

revoke execute on function sec.net_debt(uuid, uuid, uuid, uuid) from public;

create function sec.pending_debt(
  p_scope           uuid,
  p_debtor          uuid,
  p_creditor        uuid,
  p_exclude_version uuid
)
returns bigint
language sql
stable
set search_path = ''
begin atomic
  select greatest(sec.net_debt(p_scope, p_debtor, p_creditor, p_exclude_version), 0);
end;

comment on function sec.pending_debt(uuid, uuid, uuid, uuid) is
  'Deuda pendiente del par, acotada a cero, de modo que liquidar en la direccion contraria devuelva 0 igual que pendingDebt del dominio.';

revoke execute on function sec.pending_debt(uuid, uuid, uuid, uuid) from public;

-- ============ 1 bis · la correccion no puede dejar deuda sobreliquidada =====
-- `data-model.md` §3 fija que **una liquidacion nunca supera el importe
-- pendiente de esa deuda**. `record_debt_settlement` lo comprueba al liquidar,
-- pero una CORRECCION que reduce el gasto puede violar el mismo invariante
-- desde el otro lado, sin que ninguna liquidacion nueva ocurra:
--
--   deuda original 5000 · ya liquidado 4000 · nueva deuda 3000  ->  -1000
--
-- Es el MISMO invariante en otro momento, asi que reutiliza su codigo de
-- dominio —`SETTLEMENT_EXCEEDS_DEBT`— y no inventa uno nuevo. En producto las
-- liquidaciones se hacen al cerrar el grupo, con los gastos ya revisados, de
-- modo que este rechazo es el caso raro y no el camino normal.
--
-- Se comprueban los pares del reparto NUEVO **y** los que llevaban deuda en la
-- version vigente: si la correccion saca a alguien del gasto, su aportacion
-- pasa a cero y lo ya liquidado se queda sin nada que respaldar. Por eso los
-- viejos entran con delta 0 y con SU PROPIO ambito, que puede no ser el nuevo
-- si la correccion cambia de ambito.
--
-- No introduce deuda inversa, ni compensacion, ni reapertura, ni ningun estado
-- de cierre: solo rechaza.
create function sec.assert_correction_leaves_no_oversettled_debt(
  p_scope            uuid,
  p_expected_version uuid,
  p_participants     uuid[],
  p_resolved         bigint[],
  p_payer            uuid
)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
declare
  r record;
begin
  for r in
    with nuevos as (
      select p_scope           as scope_id,
             u.participante    as debtor,
             p_payer           as creditor,
             u.importe         as delta
        from unnest(p_participants, p_resolved) as u(participante, importe)
       where u.participante <> p_payer
         and u.importe > 0
    ),
    viejos as (
      select distinct
             e.scope_id,
             e.debt_debtor_participant_id   as debtor,
             e.debt_creditor_participant_id as creditor,
             0::bigint                      as delta
        from core.current_effect e
       where e.operation_version_id = p_expected_version
         and e.debt_amount is not null
    ),
    pares as (
      select scope_id, debtor, creditor, max(delta) as delta
        from (select * from nuevos union all select * from viejos) t
       group by 1, 2, 3
    )
    select pares.scope_id, pares.debtor, pares.creditor, pares.delta,
           sec.net_debt(pares.scope_id, pares.debtor, pares.creditor, p_expected_version) as ya
      from pares
  loop
    if r.ya + r.delta < 0 then
      perform sec.raise_boundary('SETTLEMENT_EXCEEDS_DEBT',
        format('la correccion dejaria la deuda de %s hacia %s con un pendiente de %s: ya se liquidaron %s y la version corregida solo sostiene %s (data-model.md §3)',
               r.debtor, r.creditor, r.ya + r.delta, - r.ya, r.delta), 422);
    end if;
  end loop;
end
$fn$;

comment on function sec.assert_correction_leaves_no_oversettled_debt(uuid, uuid, uuid[], bigint[], uuid) is
  'Una correccion no puede dejar una deuda con pendiente negativo por liquidaciones ya realizadas. Mismo invariante que data-model.md §3, en otro momento.';

revoke execute on function sec.assert_correction_leaves_no_oversettled_debt(uuid, uuid, uuid[], bigint[], uuid) from public;

-- ======================= 2 · autorizacion e identidad contextual ===========
-- La membresia ACTUAL del ambito. `core.membership` es presencia pura, no
-- historial, asi que responde exactamente a «que puede hacer AHORA esta cuenta»
-- y a nada mas.
--
-- El writer NO puede usar `sec.is_member`: E16 midio que `auth.uid()` no es
-- invocable por el, y el helper de ADR-007 §2 lo lleva dentro. Aqui el actor
-- llega ya resuelto desde `sec.request_actor_id()`.
create function sec.assert_member(p_scope uuid, p_actor uuid)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if not exists (
    select 1 from core.membership m
     where m.scope_id = p_scope and m.user_id = p_actor
  ) then
    -- El mismo error para «no existe» y «no eres miembro», igual que en 7a:
    -- distinguirlos convertiria la funcion en un oraculo de existencia de
    -- ambitos.
    perform sec.raise_boundary('NOT_AUTHORIZED',
      'el actor no es miembro del ambito de la operacion', 403);
  end if;
end
$fn$;

revoke execute on function sec.assert_member(uuid, uuid) from public;

create function sec.assert_scope_kind(p_scope uuid, p_kind text)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_kind text;
begin
  select s.kind into v_kind from core.scope s where s.id = p_scope;
  if v_kind is distinct from p_kind then
    perform sec.raise_boundary('NOT_AUTHORIZED',
      'el ambito no es de la clase que esta operacion requiere', 403);
  end if;
end
$fn$;

revoke execute on function sec.assert_scope_kind(uuid, text) from public;

-- El Modo Personal del participante, si lo tiene.
--
-- La cadena es participante -> cuenta -> Modo Personal, y cada eslabon existe
-- por una decision anterior: ADR-012 §2 pone el vinculo en su propia relacion, y
-- ADR-016 hace de `owner_user_id` propiedad durable, con
-- `kind = 'personal' <=> owner_user_id IS NOT NULL` y un indice unico, de modo
-- que una cuenta tiene COMO MUCHO un Modo Personal.
--
-- Devolver NULL es un resultado LEGITIMO y no un fallo: `data-model.md` §4.7 y
-- §6 describen exactamente el caso —quien pago no tiene cuenta en Nomey— y el
-- dominio lo modela con `payerCashMovement` OPCIONAL. A quien no tiene Modo
-- Personal no se le inventa uno.
--
-- Por que se DERIVA y no se acepta del payload: sin el vinculo, ningun dato del
-- cliente permitiria comprobar que un ambito personal es el del pagador, y
-- aceptarlo a ciegas dejaria a cualquier miembro colocar un cargo de caja falso
-- en el Modo Personal de otro. Derivarlo no concede nada: ADR-012 §8 fija que el
-- vinculo establece IDENTIDAD, y esto es exactamente una pregunta de identidad.
create function sec.participant_personal_scope(p_participant uuid)
returns uuid
language sql
stable
set search_path = ''
begin atomic
  select s.id
    from core.participant_user_link l
    join core.scope s on s.owner_user_id = l.user_id and s.kind = 'personal'
   where l.participant_id = p_participant;
end;

comment on function sec.participant_personal_scope(uuid) is
  'Modo Personal de la cuenta vinculada a un participante, o NULL si no la hay. Identidad, no autorizacion (ADR-012 §8, ADR-016).';

revoke execute on function sec.participant_personal_scope(uuid) from public;

-- ADR-012 §7: «un participante solo puede figurar en una operacion cuando sea
-- elegible segun uno de sus periodos validos».
--
-- Dos lecturas quedan fijadas aqui, y ninguna se inventa:
--
--   · la fecha contra la que se evalua es la FECHA EFECTIVA DE LA VERSION que
--     se escribe, no el instante de escritura. `data-model.md` §7 lo dice para
--     las correcciones —«los validos en la fecha efectiva original»— y el
--     contraste que traza es con el momento de corregir;
--   · un participante SIN NINGUN periodo no es elegible en ninguna fecha. La
--     ausencia de periodos no es un comodin: es no haber estado nunca.
--
-- La comprobacion es `[valid_from, valid_until)`, la misma semantica que la
-- restriccion de exclusion de `core.participant_period`.
create function sec.assert_participant_eligible(
  p_participant uuid,
  p_scope       uuid,
  p_date        date
)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if not exists (
    select 1 from core.participant p
     where p.id = p_participant and p.scope_id = p_scope
  ) then
    perform sec.raise_boundary('PARTICIPANT_NOT_IN_SCOPE',
      'la operacion nombra un participante que no pertenece a su ambito', 422);
  end if;

  if not exists (
    select 1 from core.participant_period pp
     where pp.participant_id = p_participant
       and pp.valid_from <= p_date
       and (pp.valid_until is null or p_date < pp.valid_until)
  ) then
    perform sec.raise_boundary('PARTICIPANT_NOT_ELIGIBLE',
      'el participante no era elegible en la fecha efectiva de la operacion (ADR-012 §7)', 422);
  end if;
end
$fn$;

revoke execute on function sec.assert_participant_eligible(uuid, uuid, date) from public;

-- ======================= 3 · lectura estricta de listas del payload ========
-- ADR-008 §3 alcanza a cada elemento y no solo al escalar: un peso o un importe
-- dentro de un array sigue siendo un valor exacto y sigue teniendo que llegar
-- como string JSON.

create function sec.jsonb_uuid_array(p_node jsonb, p_label text)
returns uuid[]
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_out uuid[] := '{}';
  v_el  jsonb;
begin
  if p_node is null or jsonb_typeof(p_node) <> 'array' then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      format('%s debe ser un array JSON', p_label), 400);
  end if;
  for v_el in select e from jsonb_array_elements(p_node) as e loop
    if jsonb_typeof(v_el) <> 'string' then
      perform sec.raise_boundary('PAYLOAD_INVALID',
        format('cada elemento de %s debe ser un string JSON', p_label), 400);
    end if;
    begin
      v_out := v_out || (v_el #>> '{}')::uuid;
    exception when others then
      perform sec.raise_boundary('PAYLOAD_INVALID',
        format('%s contiene un valor que no es un UUID', p_label), 400);
    end;
  end loop;
  return v_out;
end
$fn$;

revoke execute on function sec.jsonb_uuid_array(jsonb, text) from public;

create function sec.jsonb_amount_array(p_node jsonb, p_label text)
returns bigint[]
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_out bigint[] := '{}';
  v_el  jsonb;
begin
  if p_node is null or jsonb_typeof(p_node) <> 'array' then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      format('%s debe ser un array JSON', p_label), 400);
  end if;
  for v_el in select e from jsonb_array_elements(p_node) as e loop
    if jsonb_typeof(v_el) <> 'string' then
      perform sec.raise_boundary('PAYLOAD_INVALID',
        format('cada elemento de %s debe llegar como string JSON y no como number: un entero grande se degrada al parsearse (ADR-008 §1)', p_label), 400);
    end if;
    begin
      v_out := v_out || (v_el #>> '{}')::bigint;
    exception when others then
      perform sec.raise_boundary('PAYLOAD_INVALID',
        format('%s contiene un valor que no es un entero en unidad minima', p_label), 400);
    end;
  end loop;
  return v_out;
end
$fn$;

revoke execute on function sec.jsonb_amount_array(jsonb, text) from public;

-- ============================ 4 · el reparto, por segunda vez ==============
-- ADR-009 §1 asume expresamente que este calculo SE ESCRIBE POR SEGUNDA VEZ y
-- que «la paridad se garantiza con los vectores, no compartiendo codigo». Lo
-- que sigue es la traduccion literal de `src/domain/split/`, INCLUIDO EL ORDEN
-- de las comprobaciones: un vector con dos infracciones debe fallar con el mismo
-- codigo en las dos implementaciones.
--
-- ADR-002 §5 fija el algoritmo:
--   1. cuotas matematicas
--   2. truncar a unidades minimas completas
--   3. repartir las restantes por mayor fraccion descartada
--   4. empate -> prioridad al pagador
--   5. si persiste -> orden estable guardado con la operacion
--
-- La «fraccion descartada» NO se calcula dividiendo: es el resto entero
-- `(total x peso) mod suma(pesos)`, de modo que compararlas ordena por mayor
-- fraccion sin salir de los enteros. El producto se hace en `numeric` —exacto
-- para enteros de cualquier magnitud— para no depender de que `bigint` no
-- desborde con un peso grande. `numeric` aqui no es «coma flotante»: es la
-- aritmetica exacta de PostgreSQL, y el resultado vuelve a `bigint`.

create function sec.allocate_by_largest_remainder(
  p_total    bigint,
  p_weights  bigint[],
  p_priority integer[]
)
returns bigint[]
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_n         integer := coalesce(array_length(p_weights, 1), 0);
  v_sum       numeric := 0;
  v_alloc     bigint[] := '{}';
  v_rem       numeric[] := '{}';
  v_assigned  bigint := 0;
  v_remaining bigint;
  v_i         integer;
  v_scaled    numeric;
  v_base      bigint;
  v_idx       integer;
begin
  -- ADR-003 T11: opera sobre magnitud NO NEGATIVA. El signo financiero
  -- pertenece al efecto que usa el reparto, no a la asignacion.
  if p_total < 0 then
    perform sec.raise_boundary('ALLOCATION_NEGATIVE_TOTAL',
      format('El reparto opera sobre magnitud no negativa, recibido: %s', p_total), 422);
  end if;
  if v_n = 0 then
    perform sec.raise_boundary('ALLOCATION_NO_WEIGHTS', 'No hay pesos que repartir', 422);
  end if;
  if coalesce(array_length(p_priority, 1), 0) <> v_n then
    perform sec.raise_boundary('ALLOCATION_PRIORITY_LENGTH_MISMATCH',
      'Los pesos y las prioridades deben tener la misma longitud', 422);
  end if;

  for v_i in 1 .. v_n loop
    if p_weights[v_i] <= 0 then
      perform sec.raise_boundary('ALLOCATION_WEIGHT_NOT_POSITIVE',
        format('Los pesos deben ser estrictamente positivos, recibido: %s', p_weights[v_i]), 422);
    end if;
    v_sum := v_sum + p_weights[v_i]::numeric;
  end loop;

  -- Pasos 1 y 2: cuota truncada, y el resto entero como fraccion descartada.
  for v_i in 1 .. v_n loop
    v_scaled   := p_total::numeric * p_weights[v_i]::numeric;
    v_base     := floor(v_scaled / v_sum)::bigint;
    v_alloc    := v_alloc || v_base;
    v_rem      := v_rem || (v_scaled - v_base::numeric * v_sum);
    v_assigned := v_assigned + v_base;
  end loop;

  -- Paso 3: las unidades que faltan van por mayor fraccion descartada.
  -- Pasos 4 y 5: al empatar gana la prioridad mas baja. Las prioridades son
  -- UNICAS —el pagador con -1 y el resto con su posicion—, de modo que el orden
  -- es total y no queda ninguna decision a la estabilidad del sort.
  v_remaining := p_total - v_assigned;
  if v_remaining = 0 then
    return v_alloc;
  end if;

  for v_idx in
    select r.i
      from unnest(v_rem) with ordinality as r(resto, i)
     order by r.resto desc, p_priority[r.i] asc
     limit v_remaining
  loop
    v_alloc[v_idx] := v_alloc[v_idx] + 1;
  end loop;

  return v_alloc;
end
$fn$;

comment on function sec.allocate_by_largest_remainder(bigint, bigint[], integer[]) is
  'Reparto por mayor resto de ADR-002 §5 en enteros exactos. Segunda escritura del calculo de src/domain/split/largest-remainder.ts (ADR-009 §1).';

revoke execute on function sec.allocate_by_largest_remainder(bigint, bigint[], integer[]) from public;

-- Traduccion de `splitExpense`. Devuelve los importes RESUELTOS alineados con el
-- orden estable de los participantes.
--
-- El orden de las comprobaciones es el del dominio y no es cosmetico: el vector
-- `sin-participantes` nombra ademas un pagador que no figura, y debe fallar con
-- `SPLIT_NO_PARTICIPANTS` en las dos implementaciones.
create function sec.resolve_split(
  p_total        bigint,
  p_participants uuid[],
  p_payer        uuid,
  p_method       jsonb
)
returns bigint[]
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_n        integer := coalesce(array_length(p_participants, 1), 0);
  v_kind     text;
  v_payer_ix integer := null;
  v_priority integer[] := '{}';
  v_weights  bigint[] := '{}';
  v_amounts  bigint[];
  v_declared bigint := 0;
  v_i        integer;
begin
  if v_n = 0 then
    perform sec.raise_boundary('SPLIT_NO_PARTICIPANTS',
      'Un reparto necesita al menos un participante', 422);
  end if;

  if (select count(distinct p) from unnest(p_participants) as p) <> v_n then
    perform sec.raise_boundary('SPLIT_DUPLICATE_PARTICIPANT',
      'Un participante no puede figurar dos veces en la misma operacion', 422);
  end if;

  for v_i in 1 .. v_n loop
    if p_participants[v_i] = p_payer then
      v_payer_ix := v_i;
    end if;
  end loop;
  if v_payer_ix is null then
    perform sec.raise_boundary('SPLIT_PAYER_NOT_PARTICIPANT',
      'El pagador debe figurar siempre entre los participantes', 422);
  end if;

  if p_total < 0 then
    perform sec.raise_boundary('SPLIT_NEGATIVE_TOTAL',
      format('El total de un reparto no puede ser negativo: %s', p_total), 422);
  end if;

  -- Prioridad de desempate: el pagador primero (-1) y despues el orden estable
  -- guardado con la operacion, en base 0 como en el dominio.
  for v_i in 1 .. v_n loop
    v_priority := v_priority || case when v_i = v_payer_ix then -1 else v_i - 1 end;
  end loop;

  v_kind := p_method ->> 'kind';

  if v_kind = 'equal' then
    for v_i in 1 .. v_n loop
      v_weights := v_weights || 1::bigint;
    end loop;
    return sec.allocate_by_largest_remainder(p_total, v_weights, v_priority);

  elsif v_kind = 'shares' then
    v_weights := sec.jsonb_amount_array(p_method -> 'weights', 'split_method.weights');
    if coalesce(array_length(v_weights, 1), 0) <> v_n then
      perform sec.raise_boundary('SPLIT_WEIGHTS_LENGTH_MISMATCH',
        format('Hay %s participantes y %s pesos', v_n, coalesce(array_length(v_weights, 1), 0)), 422);
    end if;
    for v_i in 1 .. v_n loop
      if v_weights[v_i] <= 0 then
        perform sec.raise_boundary('SPLIT_SHARE_NOT_POSITIVE',
          format('Los pesos declarados deben ser enteros > 0, recibido: %s', v_weights[v_i]), 422);
      end if;
    end loop;
    return sec.allocate_by_largest_remainder(p_total, v_weights, v_priority);

  elsif v_kind = 'exact_amounts' then
    v_amounts := sec.jsonb_amount_array(p_method -> 'amounts', 'split_method.amounts');
    if coalesce(array_length(v_amounts, 1), 0) <> v_n then
      perform sec.raise_boundary('SPLIT_AMOUNTS_LENGTH_MISMATCH',
        format('Hay %s participantes y %s importes', v_n, coalesce(array_length(v_amounts, 1), 0)), 422);
    end if;
    for v_i in 1 .. v_n loop
      -- Participante de una operacion = persona con participacion economica
      -- DECLARADA en ella. Quien declara 0 no participa.
      if v_amounts[v_i] <= 0 then
        perform sec.raise_boundary('SPLIT_EXACT_AMOUNT_NOT_POSITIVE',
          format('Todo participante de un reparto exacto declara un importe > 0, recibido: %s', v_amounts[v_i]), 422);
      end if;
      v_declared := v_declared + v_amounts[v_i];
    end loop;
    if v_declared <> p_total then
      -- Sin correccion silenciosa (ADR-002 §5).
      perform sec.raise_boundary('SPLIT_EXACT_AMOUNTS_MISMATCH',
        format('Los importes declarados suman %s y el total es %s', v_declared, p_total), 422);
    end if;
    return v_amounts;
  end if;

  perform sec.raise_boundary('PAYLOAD_INVALID',
    'split_method.kind debe ser equal, shares o exact_amounts', 400);
  return null;
end
$fn$;

comment on function sec.resolve_split(bigint, uuid[], uuid, jsonb) is
  'Traduccion de src/domain/split/split.ts: mismo orden de comprobaciones y mismos codigos. La deriva la detectan los vectores (ADR-002 §7).';

revoke execute on function sec.resolve_split(bigint, uuid[], uuid, jsonb) from public;

-- Persistencia del reparto contextual de ADR-013 §5: cabecera por (version,
-- ambito) con metodo y pagador, y una fila por participante con ORDINAL,
-- intencion declarada y resultado resuelto, CEROS INCLUIDOS.
--
-- El ordinal lo asigna el SERVIDOR a partir del orden estable que el cliente
-- declaro con la lista; el cliente no lo envia resuelto. Es la entrada del paso
-- 5 del desempate: sin el, un replay podria dar el centimo sobrante a otra
-- persona y la suma seguiria cuadrando.
create function sec.persist_split(
  p_version      uuid,
  p_scope        uuid,
  p_method       jsonb,
  p_participants uuid[],
  p_payer        uuid,
  p_resolved     bigint[]
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_kind    text := p_method ->> 'kind';
  v_weights bigint[];
  v_amounts bigint[];
  v_i       integer;
begin
  insert into core.split (operation_version_id, scope_id, split_method, payer_participant_id)
  values (p_version, p_scope, v_kind, p_payer);

  if v_kind = 'shares' then
    v_weights := sec.jsonb_amount_array(p_method -> 'weights', 'split_method.weights');
  elsif v_kind = 'exact_amounts' then
    v_amounts := sec.jsonb_amount_array(p_method -> 'amounts', 'split_method.amounts');
  end if;

  for v_i in 1 .. array_length(p_participants, 1) loop
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method,
       declared_weight, declared_amount, resolved_amount)
    values (p_version, p_scope, p_participants[v_i], v_i - 1, v_kind,
            case when v_kind = 'shares'        then v_weights[v_i] end,
            case when v_kind = 'exact_amounts' then v_amounts[v_i] end,
            p_resolved[v_i]);
  end loop;
end
$fn$;

revoke execute on function sec.persist_split(uuid, uuid, jsonb, uuid[], uuid, bigint[]) from public;

-- El writer invoca estos helpers directamente, asi que necesita EXECUTE.
grant execute on function sec.lock_debt_scopes(uuid[])                                   to nomey_writer;
grant execute on function sec.debt_scopes_of_version(uuid)                               to nomey_writer;
grant execute on function sec.net_debt(uuid, uuid, uuid, uuid)                           to nomey_writer;
grant execute on function sec.pending_debt(uuid, uuid, uuid, uuid)                       to nomey_writer;
grant execute on function sec.assert_correction_leaves_no_oversettled_debt(uuid, uuid, uuid[], bigint[], uuid) to nomey_writer;
grant execute on function sec.assert_member(uuid, uuid)                                  to nomey_writer;
grant execute on function sec.assert_scope_kind(uuid, text)                              to nomey_writer;
grant execute on function sec.participant_personal_scope(uuid)                           to nomey_writer;
grant execute on function sec.assert_participant_eligible(uuid, uuid, date)              to nomey_writer;
grant execute on function sec.jsonb_uuid_array(jsonb, text)                              to nomey_writer;
grant execute on function sec.jsonb_amount_array(jsonb, text)                            to nomey_writer;
grant execute on function sec.allocate_by_largest_remainder(bigint, bigint[], integer[]) to nomey_writer;
grant execute on function sec.resolve_split(bigint, uuid[], uuid, jsonb)                 to nomey_writer;
grant execute on function sec.persist_split(uuid, uuid, jsonb, uuid[], uuid, bigint[])   to nomey_writer;

-- ============================ 5 · las tres clases con deuda ================
-- Una funcion publica POR CLASE DE OPERACION (ADR-009 §1), y alta y correccion
-- comparten funcion: son la misma clase y las distingue el `command_type`, de
-- modo que reutilizar la clave de un alta para corregir sea CONFLICTO y no
-- replay (ADR-010 §3).
--
-- Los valores de `operation_class` van en snake_case y se corresponden uno a uno
-- con los `kind` en camelCase de `tests/vectors/scenarios.json`:
--
--   group_expense          <-> groupExpense
--   debt_settlement        <-> debtSettlement
--   settlement_by_transfer <-> settlementByTransfer
--
-- EL ORDEN DEL PROTOCOLO, y por que no es negociable:
--
--   1 forma y reparto (solo payload)   4 replay o conflicto
--   2 actor                            5 autorizacion actual
--   3 RECLAMO de la clave              6 LOCK de los ambitos de deuda
--   7 lock de la operacion y CAS       8 leer la deuda
--   9 validar   10 derivar   11 escribir   12 puntero   13 retorno
--
-- Los pasos 1-5 y 7 son los de 7a y ADR-011 §13, intactos. Lo nuevo son 6 y 8,
-- que son ADR-013 §11: los ambitos se bloquean ANTES de leer la deuda —«los
-- pasos 2 y 4 no se pueden invertir: leer antes de bloquear reintroduce
-- exactamente la carrera»— y ANTES de bloquear la operacion, para que el orden
-- global de adquisicion sea el mismo en las tres clases y no haya ciclo posible.
--
-- El conjunto bloqueado de una CORRECCION es la union de los ambitos de la
-- intencion nueva y los que llevaban deuda en la version vigente. Sin la segunda
-- mitad, sacar un ambito de una correccion lo dejaria fuera del lock justo
-- cuando su deuda cambia.
--
-- Que el conjunto se calcule desde `expected_version_id` y no desde una lectura
-- de `current_version_id` es lo que hace que no exista lectura obsoleta: si la
-- vigente ya no es esa, el CAS del paso 7 rechaza con `VERSION_CONFLICT` y no se
-- escribe nada.

-- --------------------------------------------------------- group expense --
-- `deriveGroupExpense`: participacion economica de TODOS los participantes con
-- independencia de quien pago (invariante 9), deudas del resto frente al pagador
-- —sin inventar deuda de cero—, y UN UNICO movimiento de caja por el total en el
-- Modo Personal del pagador, si lo tiene (invariante 4).
--
-- El ambito del movimiento de caja se DERIVA del participante pagador; no viaja
-- en el payload. El motivo esta en `sec.participant_personal_scope`.
create function api.record_group_expense(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date',
    'operation_id','expected_version_id',
    'scope_id','currency_definition_id','total',
    'payer_participant_id','participants','split_method'];
  v_scope uuid; v_currency uuid; v_total bigint; v_date date; v_payer uuid;
  v_participants uuid[]; v_method jsonb; v_kind text; v_resolved bigint[];
  v_payer_scope uuid; v_canonical jsonb; v_lock uuid[];
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
  v_i integer;
begin
  -- 1 · forma
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope    := sec.payload_uuid(payload, 'scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_total    := sec.payload_amount(payload, 'total');
  v_date     := sec.payload_date(payload, 'effective_date');
  v_payer    := sec.payload_uuid(payload, 'payer_participant_id', true);
  v_participants := sec.jsonb_uuid_array(payload -> 'participants', 'participants');

  v_method := payload -> 'split_method';
  if v_method is null or jsonb_typeof(v_method) <> 'object' then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'split_method debe ser un objeto JSON', 400);
  end if;
  v_kind := v_method ->> 'kind';
  if v_kind is null or not (v_kind = any(array['equal','shares','exact_amounts'])) then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'split_method.kind debe ser equal, shares o exact_amounts', 400);
  end if;
  -- Vocabulario cerrado tambien en las CLAVES: `equal` no declara nada, y
  -- aceptar `weights` junto a `exact_amounts` dejaria creer que se tuvo en
  -- cuenta. Mismo criterio que `created_by` en `sec.assert_payload_shape`.
  if (select count(*) from jsonb_object_keys(v_method) k
       where k not in ('kind', case v_kind when 'shares' then 'weights'
                                           when 'exact_amounts' then 'amounts'
                                           else 'kind' end)) > 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      format('split_method lleva campos que el metodo %s no declara', v_kind), 400);
  end if;

  -- El cliente NO envia ordinales ni efectos: el orden estable es el de la
  -- lista y el ordinal lo asigna el servidor (ADR-002 §7, ADR-013 §5).
  v_resolved := sec.resolve_split(v_total, v_participants, v_payer, v_method);

  -- Canonicalizacion: SOLO el servidor (ADR-011 §8). Los valores exactos entran
  -- VERBATIM —«00100» no es «100»— y las identidades y la fecha materializan su
  -- representacion canonica. El orden de `participants` se conserva porque ES
  -- intencion: es el desempate del paso 5 de ADR-002 §5.
  v_canonical := jsonb_build_object(
    'operation_id',           (sec.payload_uuid(payload,'operation_id',false))::text,
    'scope_id',               v_scope::text,
    'currency_definition_id', v_currency::text,
    'total',                  payload ->> 'total',
    'effective_date',         v_date::text,
    'payer_participant_id',   v_payer::text,
    'participants',           (select coalesce(jsonb_agg(p::text order by ord), '[]'::jsonb)
                                 from unnest(v_participants) with ordinality as u(p, ord)),
    'split_method',           v_method);

  -- 2, 3 y 4 · actor, reclamo y replay o conflicto, SIEMPRE antes del CAS.
  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'group_expense', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  -- 5 · autorizacion actual. Un gasto de Grupo lo registra CUALQUIER INTEGRANTE
  -- —`data-model.md` §8 lo marca «inmediata»— y la autoria original no concede
  -- exclusividad sobre la correccion (`data-model.md` §7). Por eso aqui no se
  -- mira `created_by` de la operacion: se mira la membresia actual del ambito.
  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);
  perform sec.assert_no_conversion(v_scope, v_currency);

  -- Elegibilidad de cada participante en la FECHA EFECTIVA (ADR-012 §7).
  foreach v_payer_scope in array v_participants loop
    perform sec.assert_participant_eligible(v_payer_scope, v_scope, v_date);
  end loop;
  v_payer_scope := null;

  -- El extremo de caja: derivado, opcional, y en la moneda base de su ambito.
  v_payer_scope := sec.participant_personal_scope(v_payer);
  if v_payer_scope is not null then
    perform sec.assert_no_conversion(v_payer_scope, v_currency);
  end if;

  -- 6 · LOCK de los ambitos cuya deuda puede cambiar (ADR-013 §11).
  v_lock := array[v_scope];
  if v_correction then
    v_lock := v_lock || sec.debt_scopes_of_version(v_expected);
  end if;
  perform sec.lock_debt_scopes(v_lock);

  -- 7 · lock de la operacion y CAS.
  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);

    -- 8 y 9 · leer la deuda autoritativa DESPUES de los locks, y validar. Un
    -- alta no necesita esta comprobacion: solo suma deuda. Una correccion puede
    -- restarla por debajo de lo ya liquidado, y eso viola el mismo invariante
    -- que `record_debt_settlement` protege al liquidar.
    perform sec.assert_correction_leaves_no_oversettled_debt(
      v_scope, v_expected, v_participants, v_resolved, v_payer);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'group_expense', v_date, v_total, v_currency);

  perform sec.persist_split(v_version, v_scope, v_method, v_participants, v_payer, v_resolved);

  -- Gasto economico de cada participante, sin cambio de saldo. LOS CEROS SE
  -- CONSERVAN: una participacion calculada en cero por indivisibilidad sigue
  -- siendo una participacion (ADR-013 §8).
  for v_i in 1 .. array_length(v_participants, 1) loop
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       economic_amount, economic_participant_id)
    values (gen_random_uuid(), v_version, v_scope, 'expense', v_currency,
            v_resolved[v_i], v_participants[v_i]);
  end loop;

  -- Derechos del pagador frente al resto. Una participacion calculada en cero NO
  -- genera deuda: no hay obligacion que registrar, y ADR-013 §8 prohibe
  -- inventar deuda de cero donde el dominio la omite.
  for v_i in 1 .. array_length(v_participants, 1) loop
    if v_participants[v_i] <> v_payer and v_resolved[v_i] > 0 then
      insert into core.effect
        (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
         debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
      values (gen_random_uuid(), v_version, v_scope, 'expense', v_currency,
              v_resolved[v_i], v_participants[v_i], v_payer);
    end if;
  end loop;

  -- El movimiento de caja: UNO SOLO y por el total (invariante 4). No se
  -- descompone en gasto mas transferencia. Si el pagador no tiene Modo Personal
  -- no hay extremo interno que registrar, igual que en una transferencia
  -- externa (`data-model.md` §4.7).
  if v_payer_scope is not null then
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       balance_amount)
    values (gen_random_uuid(), v_version, v_payer_scope, 'expense', v_currency, - v_total);
  end if;

  return sec.envelope(v_operation, false);
end
$fn$;

-- ------------------------------------------------------- debt settlement --
-- `deriveDebtSettlement`: UN SOLO efecto, de deuda, con delta negativo. NO MUEVE
-- SALDO en ningun Modo Personal (invariante 6), y por eso el `Disponible tras
-- saldar` de ambas partes queda desfasado hasta que cada uno anote su propio
-- movimiento — que es correcto: Nomey es un registro manual.
--
-- La deuda es un SALDO CONTINUO y no una maquina de estados, asi que los pagos
-- parciales salen gratis. Lo unico que hay que impedir es el sobrepago, y esa
-- comprobacion exige derivar la deuda pendiente DENTRO de la misma transaccion y
-- DESPUES del lock.
create function api.record_debt_settlement(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date',
    'operation_id','expected_version_id',
    'scope_id','currency_definition_id','amount',
    'debtor_participant_id','creditor_participant_id'];
  v_scope uuid; v_currency uuid; v_amount bigint; v_date date;
  v_debtor uuid; v_creditor uuid;
  v_canonical jsonb; v_lock uuid[]; v_pending bigint;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope     := sec.payload_uuid(payload, 'scope_id', true);
  v_currency  := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_amount    := sec.payload_amount(payload, 'amount');
  v_date      := sec.payload_date(payload, 'effective_date');
  v_debtor    := sec.payload_uuid(payload, 'debtor_participant_id', true);
  v_creditor  := sec.payload_uuid(payload, 'creditor_participant_id', true);

  if v_amount <= 0 then
    perform sec.raise_boundary('SETTLEMENT_AMOUNT_NOT_POSITIVE',
      format('Una liquidacion salda un importe positivo, recibido: %s', v_amount), 422);
  end if;
  if v_debtor = v_creditor then
    perform sec.raise_boundary('DEBT_SELF_REFERENCE',
      'Una deuda no puede tener el mismo deudor y acreedor', 422);
  end if;

  v_canonical := jsonb_build_object(
    'operation_id',            (sec.payload_uuid(payload,'operation_id',false))::text,
    'scope_id',                v_scope::text,
    'currency_definition_id',  v_currency::text,
    'amount',                  payload ->> 'amount',
    'effective_date',          v_date::text,
    'debtor_participant_id',   v_debtor::text,
    'creditor_participant_id', v_creditor::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'debt_settlement', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  -- `data-model.md` §8 marca «marcar deuda saldada» como inmediata y no la
  -- restringe a las partes: es una AFIRMACION SOBRE UNA OBLIGACION YA
  -- DETERMINADA, y quien la hace responde por atribucion, historial,
  -- notificacion y correccion. La autorizacion es la membresia del ambito.
  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);
  perform sec.assert_no_conversion(v_scope, v_currency);
  perform sec.assert_participant_eligible(v_debtor,   v_scope, v_date);
  perform sec.assert_participant_eligible(v_creditor, v_scope, v_date);

  -- 6 · LOCK, y 8 · leer la deuda DESPUES. Invertirlos reintroduce la carrera
  -- que E15 midio: dos liquidaciones de 2000 sobre una deuda de 3000 pasan las
  -- dos y dejan un pendiente de -1000.
  v_lock := array[v_scope];
  if v_correction then
    v_lock := v_lock || sec.debt_scopes_of_version(v_expected);
  end if;
  perform sec.lock_debt_scopes(v_lock);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  -- La version que se supersede se excluye: corregir una liquidacion de 3000 a
  -- 4000 no puede validarse contra una deuda que todavia incluye esos 3000.
  v_pending := sec.pending_debt(v_scope, v_debtor, v_creditor,
                                case when v_correction then v_expected end);

  -- Una liquidacion nunca supera el pendiente. De ahi salen los tres rechazos
  -- de `data-model.md` §3: sobrepago, liquidar sin deuda, y liquidar en la
  -- direccion contraria —donde el neteo del par devuelve cero—.
  if v_amount > v_pending then
    perform sec.raise_boundary('SETTLEMENT_EXCEEDS_DEBT',
      format('Se intenta liquidar %s sobre una deuda pendiente de %s', v_amount, v_pending), 422);
  end if;

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'debt_settlement', v_date, v_amount, v_currency);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
     debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
  values (gen_random_uuid(), v_version, v_scope, 'settlement', v_currency,
          - v_amount, v_debtor, v_creditor);

  return sec.envelope(v_operation, false);
end
$fn$;

-- -------------------------------------------------- settlement by transfer --
-- `deriveSettlementByTransfer`: una transferencia interna MAS una liquidacion.
-- Son dos hechos distintos y ADR-002 §3 prohibe fusionarlos, aunque viajen en la
-- misma operacion: tres efectos, y el de deuda no toca saldo.
--
-- AUTORIZACION: la origina el DEUDOR y solo el (`data-model.md` §4.6 y §8). Se
-- comprueba por el vinculo: la cuenta del actor debe ser la vinculada al
-- participante deudor. Sin eso, quien recibe podria registrar «me han pagado» y
-- provocar una salida en el Modo Personal de un tercero, que es la primitiva de
-- apropiacion que el invariante 14 existe para impedir.
--
-- Los dos extremos de saldo se DERIVAN de los participantes, no viajan en el
-- payload: el de salida es el Modo Personal del deudor —que por la comprobacion
-- anterior es el del actor— y el de entrada el del acreedor.
--
-- Si el acreedor NO tiene Modo Personal no hay segundo extremo interno, y esta
-- clase no es la que corresponde: ese caso es `data-model.md` §4.7 —una
-- transferencia EXTERNA mas una liquidacion— y son dos operaciones.
--
-- UN SOLO IMPORTE, que es a la vez lo transferido y lo liquidado. Transferir mas
-- de lo debido no es una liquidacion mayor: el exceso es una transferencia entre
-- usuarios, que es otro hecho y se registra aparte (`data-model.md` §3). Y
-- `operation_version` tiene EXACTAMENTE UN importe original (ADR-013 §3), de
-- modo que dos importes distintos no serian representables en una sola version.
create function api.record_settlement_by_transfer(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date',
    'operation_id','expected_version_id',
    'debt_scope_id','currency_definition_id','amount',
    'debtor_participant_id','creditor_participant_id'];
  v_scope uuid; v_currency uuid; v_amount bigint; v_date date;
  v_debtor uuid; v_creditor uuid; v_from uuid; v_to uuid; v_owner uuid;
  v_canonical jsonb; v_lock uuid[]; v_pending bigint;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope    := sec.payload_uuid(payload, 'debt_scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_amount   := sec.payload_amount(payload, 'amount');
  v_date     := sec.payload_date(payload, 'effective_date');
  v_debtor   := sec.payload_uuid(payload, 'debtor_participant_id', true);
  v_creditor := sec.payload_uuid(payload, 'creditor_participant_id', true);

  if v_amount <= 0 then
    perform sec.raise_boundary('SETTLEMENT_AMOUNT_NOT_POSITIVE',
      format('Una liquidacion salda un importe positivo, recibido: %s', v_amount), 422);
  end if;
  if v_debtor = v_creditor then
    perform sec.raise_boundary('DEBT_SELF_REFERENCE',
      'Una deuda no puede tener el mismo deudor y acreedor', 422);
  end if;

  v_canonical := jsonb_build_object(
    'operation_id',            (sec.payload_uuid(payload,'operation_id',false))::text,
    'debt_scope_id',           v_scope::text,
    'currency_definition_id',  v_currency::text,
    'amount',                  payload ->> 'amount',
    'effective_date',          v_date::text,
    'debtor_participant_id',   v_debtor::text,
    'creditor_participant_id', v_creditor::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'settlement_by_transfer', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);

  v_from := sec.participant_personal_scope(v_debtor);
  if v_from is null then
    perform sec.raise_boundary('NOT_AUTHORIZED',
      'solo el deudor origina el pago de su deuda mediante transferencia', 403);
  end if;
  select s.owner_user_id into v_owner from core.scope s where s.id = v_from;
  if v_owner is distinct from v_actor then
    perform sec.raise_boundary('NOT_AUTHORIZED',
      'solo el deudor origina el pago de su deuda mediante transferencia', 403);
  end if;

  v_to := sec.participant_personal_scope(v_creditor);
  if v_to is null then
    perform sec.raise_boundary('CREDITOR_WITHOUT_PERSONAL_SCOPE',
      'el acreedor no tiene Modo Personal: ese pago es una transferencia externa mas una liquidacion, y son dos operaciones', 422);
  end if;
  if v_from = v_to then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'origen y destino no pueden ser el mismo ambito', 400);
  end if;

  perform sec.assert_no_conversion(v_scope, v_currency);
  perform sec.assert_no_conversion(v_from,  v_currency);
  perform sec.assert_no_conversion(v_to,    v_currency);
  perform sec.assert_participant_eligible(v_debtor,   v_scope, v_date);
  perform sec.assert_participant_eligible(v_creditor, v_scope, v_date);

  -- Solo el ambito de la DEUDA entra en el protocolo: los dos Modos Personales
  -- reciben saldo, y el saldo no es deuda. ADR-013 §11 decide la pertenencia
  -- «por que efectos produce», y ninguno de esos dos efectos toca la dimension
  -- de deuda.
  v_lock := array[v_scope];
  if v_correction then
    v_lock := v_lock || sec.debt_scopes_of_version(v_expected);
  end if;
  perform sec.lock_debt_scopes(v_lock);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  v_pending := sec.pending_debt(v_scope, v_debtor, v_creditor,
                                case when v_correction then v_expected end);
  if v_amount > v_pending then
    perform sec.raise_boundary('SETTLEMENT_EXCEEDS_DEBT',
      format('Se intenta liquidar %s sobre una deuda pendiente de %s', v_amount, v_pending), 422);
  end if;

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'settlement_by_transfer', v_date, v_amount, v_currency);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
  values
    (gen_random_uuid(), v_version, v_from, 'transfer', v_currency, - v_amount),
    (gen_random_uuid(), v_version, v_to,   'transfer', v_currency,   v_amount);

  insert into core.effect
    (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
     debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
  values (gen_random_uuid(), v_version, v_scope, 'settlement', v_currency,
          - v_amount, v_debtor, v_creditor);

  return sec.envelope(v_operation, false);
end
$fn$;

-- ============================== 6 · propiedad y privilegios ================
-- ADR-009 §5, exactamente como en 7a: propiedad del WRITER DEDICADO, no de
-- `postgres`, que es lo que las mantiene DEBAJO de la RLS. Es lo contrario que
-- `api.claimed_dimension()`, y es deliberado.
--
-- Ceder la propiedad PIERDE LOS GRANT EXPLICITOS, asi que los grants van
-- despues, y el nuevo owner necesita CREATE sobre el schema mientras dura.

grant create on schema api to nomey_writer;

alter function api.record_group_expense(jsonb)          owner to nomey_writer;
alter function api.record_debt_settlement(jsonb)        owner to nomey_writer;
alter function api.record_settlement_by_transfer(jsonb) owner to nomey_writer;

revoke create on schema api from nomey_writer;

revoke execute on function api.record_group_expense(jsonb)          from public;
revoke execute on function api.record_debt_settlement(jsonb)        from public;
revoke execute on function api.record_settlement_by_transfer(jsonb) from public;

grant execute on function api.record_group_expense(jsonb)          to authenticated;
grant execute on function api.record_debt_settlement(jsonb)        to authenticated;
grant execute on function api.record_settlement_by_transfer(jsonb) to authenticated;

comment on function api.record_group_expense(jsonb) is
  'Gasto de Grupo: participacion economica de todos, deudas frente al pagador y un unico movimiento de caja del pagador si tiene Modo Personal.';
comment on function api.record_debt_settlement(jsonb) is
  'Marca deuda como saldada. Solo deuda, sin efecto de saldo (invariante 6). Nunca supera el pendiente derivado tras el lock.';
comment on function api.record_settlement_by_transfer(jsonb) is
  'Paga una deuda mediante transferencia: dos efectos de saldo y uno de liquidacion. Solo la origina el deudor (data-model.md §4.6).';

-- Ningun privilegio nuevo del cliente sobre `core`. La superficie de escritura
-- pasa a ser exactamente SIETE funciones de `api`, y ninguna otra.
