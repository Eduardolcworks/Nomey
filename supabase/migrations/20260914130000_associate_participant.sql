-- ============================================================================
-- ASOCIAR UN FANTASMA A MI CUENTA: FUSION DE LECTURA + CAJA (ADR-040) — BORRADOR
-- ============================================================================
--
-- Decision de producto (2026-09-14): quien entro con «Soy nuevo» puede asociar
-- a su cuenta un participante sin cuenta del mismo grupo, y asume su historial
-- economico completo: cuota y deuda por LECTURA (identidad canonica), caja por
-- ESCRITURA una sola vez, completando las versiones vigentes en las que el
-- fantasma pago o cobro. Ningun reparto, efecto ni pago cambia de id.
--
--   §1  core.participant_merge (el hecho) y sec.canonical_participant
--   §2  core.current_effect resuelve la identidad canonica: TODA lectura y
--       guarda que agrega por persona la atraviesa sin cambiar
--   §3  sec.participant_personal_scope por canonico (la caja de correcciones
--       futuras se deriva del destino)
--   §4  elegibilidad: un origen fusionado no se nombra en altas nuevas
--       (PARTICIPANT_MERGED); quien ya constaba sigue valiendo
--   §5  api.group_participant (merged_into_participant_id) y api.group_balance
--       (sin filas de origen)
--   §6  lecturas y guardas por identidad canonica (cuerpos vivos, cambio minimo)
--   §7  sec.incorporate_participant_cash (writer) y sus policies
--   §8  api.associate_participant (provisioner)
--
-- Evidencia: supabase/checks/associate-participant.sql (aislado).

-- ═══════════════════════ §1 · el hecho ════════════════════════════════════════
create table core.participant_merge (
  source_participant_id uuid primary key,
  target_participant_id uuid not null,
  scope_id              uuid not null references core.scope (id),
  merged_by             uuid not null,
  client_command_id     uuid not null,
  merged_at             timestamptz not null default now(),
  constraint participant_merge_origen_del_ambito  foreign key (source_participant_id, scope_id) references core.participant (id, scope_id),
  constraint participant_merge_destino_del_ambito foreign key (target_participant_id, scope_id) references core.participant (id, scope_id),
  constraint participant_merge_distintos check (source_participant_id <> target_participant_id)
);
comment on table core.participant_merge is
  'ADR-040: el participante origen (sin cuenta) se lee como el destino (mi identidad vinculada) en todo lo que agrega por persona. Insert-only; un solo salto: un destino nunca es origen y un origen nunca es destino (invariante de api.associate_participant bajo el cerrojo de identidad).';
create index participant_merge_target_idx on core.participant_merge (target_participant_id);
alter table core.participant_merge enable row level security;
grant select on core.participant_merge to authenticated, nomey_writer, nomey_provisioner;
grant insert on core.participant_merge to nomey_provisioner;
create policy participant_merge_client_select on core.participant_merge
  for select to authenticated using (sec.is_member(scope_id));
create policy participant_merge_writer_select on core.participant_merge
  for select to nomey_writer using (true);
create policy participant_merge_provisioner_select on core.participant_merge
  for select to nomey_provisioner using (true);
create policy participant_merge_provisioner_insert on core.participant_merge
  for insert to nomey_provisioner with check (merged_by = sec.request_actor_id());

create function sec.canonical_participant(p_participant uuid)
returns uuid
language sql
stable
set search_path = ''
as $fn$
  select coalesce((select m.target_participant_id from core.participant_merge m where m.source_participant_id = p_participant), p_participant);
$fn$;
revoke execute on function sec.canonical_participant(uuid) from public;
grant execute on function sec.canonical_participant(uuid) to authenticated, nomey_writer, nomey_provisioner;

-- ═══════════════════════ §2 · la proyeccion canonica resuelve la identidad ═══
-- Misma lista de columnas (las vistas dependientes siguen validas). Los ids
-- persistidos en core.effect no cambian: la resolucion vive en la proyeccion,
-- que es la unica relacion que lee core.effect (ADR-013 §9). Los efectos de
-- caja no nombran participantes: los joins quedan nulos.
create or replace view core.current_effect with (security_invoker = true) as
select e.id,
       e.operation_version_id,
       e.scope_id,
       e.accounting_class,
       e.currency_definition_id,
       e.balance_amount,
       e.economic_amount,
       coalesce(me.target_participant_id, e.economic_participant_id)    as economic_participant_id,
       e.debt_amount,
       coalesce(md.target_participant_id, e.debt_debtor_participant_id)   as debt_debtor_participant_id,
       coalesce(mc.target_participant_id, e.debt_creditor_participant_id) as debt_creditor_participant_id
  from core.effect e
  join core.operation o on o.current_version_id = e.operation_version_id
  left join core.participant_merge me on me.source_participant_id = e.economic_participant_id
  left join core.participant_merge md on md.source_participant_id = e.debt_debtor_participant_id
  left join core.participant_merge mc on mc.source_participant_id = e.debt_creditor_participant_id;

-- ═══════════════════════ §3 · la caja se deriva del destino ══════════════════
create or replace function sec.participant_personal_scope(p_participant uuid)
returns uuid
language sql
stable
set search_path = ''
as $fn$
  select s.id
    from core.participant_user_link l
    join core.scope s on s.owner_user_id = l.user_id and s.kind = 'personal'
   where l.participant_id = sec.canonical_participant(p_participant);
$fn$;

-- ═══════════════════════ §4 · elegibilidad ═══════════════════════════════════
create or replace function sec.assert_participant_eligible(p_participant uuid, p_scope uuid, p_date date)
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

  -- ADR-040: un origen fusionado no se nombra en altas nuevas; su identidad
  -- vigente es el destino. Quien ya constaba en una version sigue valiendo
  -- (sec.participant_kept_in_version, comprobado antes por el writer).
  if exists (select 1 from core.participant_merge m where m.source_participant_id = p_participant) then
    perform sec.raise_boundary('PARTICIPANT_MERGED',
      'ese participante se asocio a una cuenta: usa su identidad vigente', 422);
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

create or replace function sec.assert_participant_active(p_participant uuid, p_scope uuid)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if exists (select 1 from core.participant_merge m where m.source_participant_id = p_participant) then
    perform sec.raise_boundary('PARTICIPANT_MERGED',
      'ese participante se asocio a una cuenta: usa su identidad vigente', 422);
  end if;
  if not exists (
    select 1 from core.participant p
      join core.participant_period pp on pp.participant_id = p.id
     where p.id = p_participant and p.scope_id = p_scope and pp.valid_until is null
  ) then
    perform sec.raise_boundary('PARTICIPANT_INACTIVE',
      'el participante ya no esta en el grupo: a quien salio se le resuelve con settle_participant (ADR-034 §6)', 422);
  end if;
end
$fn$;

-- Un origen fusionado ya no esta disponible para reclamar ni retirar.
create or replace function sec.participant_available(p_participant uuid, p_scope uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from core.participant p
     where p.id = p_participant and p.scope_id = p_scope
       and not exists (select 1 from core.participant_user_link l where l.participant_id = p.id)
       and not exists (select 1 from core.participant_retirement r where r.participant_id = p.id)
       and not exists (select 1 from core.participant_merge m where m.source_participant_id = p.id)
       and exists (select 1 from core.participant_period pp where pp.participant_id = p.id and pp.valid_until is null));
$fn$;

-- ═══════════════════════ §5 · vistas de grupo ════════════════════════════════
-- group_participant: una columna mas, al final. El cliente deja de listar al
-- origen y muestra el nombre del destino en saldos/propuestas; en el historico
-- (repartos, pagos) sigue el nombre con el que figuraba (decision visual
-- abierta, ADR-040).
create or replace view api.group_participant with (security_invoker = true) as
select p.id as participant_id,
       p.scope_id,
       p.display_name,
       p.created_at,
       sec.is_my_participant(p.id) as is_self,
       coalesce(pr.is_active, false) as is_active,
       pr.eligible_until,
       exists (select 1 from core.participant_retirement r where r.participant_id = p.id) as is_retired,
       sec.participant_is_linked(p.id) as is_linked,
       sec.participant_has_history(p.id) as has_history,
       sec.my_claim_command_id(p.id) as claim_command_id,
       (select m.target_participant_id from core.participant_merge m where m.source_participant_id = p.id) as merged_into_participant_id
  from core.participant p
  join core.scope s on s.id = p.scope_id
  left join lateral sec.participant_presence(p.id) pr(is_active, eligible_until) on true
 where s.kind = 'group';

-- group_balance: el origen no tiene fila (su neto ya es el del destino, por
-- la proyeccion canonica); la suma de netos sigue siendo cero.
create or replace view api.group_balance with (security_invoker = true) as
select p.scope_id,
       p.id as participant_id,
       p.display_name,
       s.base_currency_definition_id as currency_definition_id,
       sec.is_my_participant(p.id) as is_self,
       (coalesce((select sum(e.debt_amount) from core.current_effect e
                   where e.scope_id = p.scope_id and e.debt_amount is not null and e.debt_creditor_participant_id = p.id), 0)
        - coalesce((select sum(e.debt_amount) from core.current_effect e
                     where e.scope_id = p.scope_id and e.debt_amount is not null and e.debt_debtor_participant_id = p.id), 0))::text as net_position
  from core.participant p
  join core.scope s on s.id = p.scope_id
 where s.kind = 'group'
   and not exists (select 1 from core.participant_retirement r where r.participant_id = p.id)
   and not exists (select 1 from core.participant_merge m where m.source_participant_id = p.id);


-- ═══════════════════════ §6 · lecturas y guardas por identidad canonica ═════

-- Recreadas desde el cuerpo vivo con el cambio minimo (ADR-040): donde se

-- comparaba un id de participante con el vinculo de una cuenta, ahora se

-- compara su canonico. La autoria y los ids persistidos no cambian.

CREATE OR REPLACE FUNCTION sec.assert_correction_leaves_no_oversettled_debt(p_scope uuid, p_expected_version uuid, p_participants uuid[], p_resolved bigint[], p_payer uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  r record;
begin
  for r in
    with nuevos as (
      -- ADR-040: los pares se comparan por identidad CANONICA; quien ya
      -- constaba puede seguir constando con su id de origen.
      select p_scope                                   as scope_id,
             sec.canonical_participant(u.participante) as debtor,
             sec.canonical_participant(p_payer)        as creditor,
             sum(u.importe)                            as delta
        from unnest(p_participants, p_resolved) as u(participante, importe)
       where sec.canonical_participant(u.participante) <> sec.canonical_participant(p_payer)
         and u.importe > 0
       group by 1, 2, 3
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
           sec.net_debt(pares.scope_id, pares.debtor, pares.creditor, p_expected_version) as ya,
           sec.settled_between(pares.scope_id, pares.debtor, pares.creditor, p_expected_version) as liquidado
      from pares
  loop
    -- SOLO donde hay algo liquidado. Sin liquidaciones el invariante de §3 es
    -- vacio, y un neto negativo solo dice que quien debe es el otro.
    if r.liquidado > 0 and r.ya + r.delta < 0 then
      perform sec.raise_boundary('SETTLEMENT_EXCEEDS_DEBT',
        format('la correccion dejaria la deuda de %s hacia %s con un pendiente de %s: ya se liquidaron %s y la version corregida solo sostiene %s (data-model.md §3)',
               r.debtor, r.creditor, r.ya + r.delta, r.liquidado, r.delta), 422);
    end if;
  end loop;
end
$function$;

CREATE OR REPLACE FUNCTION sec.my_reopened_debt()
 RETURNS TABLE(currency_definition_id uuid, effective_date date, amount bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with me as (select (select auth.uid()) as uid),
  mine as (
    select l.participant_id, l.scope_id
      from core.participant_user_link l, me
     where l.user_id = me.uid
       and not exists (select 1 from core.membership m where m.scope_id = l.scope_id and m.user_id = me.uid)),
  reduced as (
    select m.participant_id as me_p, m.scope_id, sec.canonical_participant(e.debt_debtor_participant_id) d, sec.canonical_participant(e.debt_creditor_participant_id) c,
           sum(- e.debt_amount) amt, s.base_currency_definition_id as cur, max(cur_v.effective_date) as annulled_on
      from mine m
      join core.scope s on s.id = m.scope_id
      join core.operation o on o.operation_class = 'group_payment'
      join core.operation_version cur_v on cur_v.id = o.current_version_id and cur_v.version_kind = 'annulment'
      join lateral (select ov.id from core.operation_version ov where ov.operation_id = o.id and ov.version_kind = 'record' order by ov.version_no desc limit 1) rec on true
      join core.payment_detail pd on pd.operation_version_id = rec.id and pd.scope_id = m.scope_id
                                  and m.participant_id in (sec.canonical_participant(pd.payer_participant_id), sec.canonical_participant(pd.receiver_participant_id))
      join core.effect e on e.operation_version_id = rec.id and e.scope_id = m.scope_id and e.debt_amount < 0
     where m.participant_id in (sec.canonical_participant(e.debt_debtor_participant_id), sec.canonical_participant(e.debt_creditor_participant_id))
     group by 1, 2, 3, 4, 6),
  capped as (
    select r.me_p, r.d, r.c, r.cur, r.annulled_on,
           least(r.amt, coalesce((select p.amount from sec.pending_pairs(r.scope_id) p where p.debtor = r.d and p.creditor = r.c), 0)) amt
      from reduced r)
  select cur, annulled_on, (case when d = me_p then - amt else amt end)::bigint
    from capped
   where amt > 0;
$function$;

CREATE OR REPLACE FUNCTION sec.reopened_pair_cap(p_scope uuid, p_debtor uuid, p_creditor uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with reduced as (
    select coalesce(sum(- e.debt_amount), 0)::bigint as amt
      from core.operation o
      join core.operation_version cur on cur.id = o.current_version_id and cur.version_kind = 'annulment'
      join lateral (select ov.id from core.operation_version ov
                     where ov.operation_id = o.id and ov.version_kind = 'record'
                     order by ov.version_no desc limit 1) rec on true
      join core.payment_detail pd on pd.operation_version_id = rec.id and pd.scope_id = p_scope
      join core.effect e on e.operation_version_id = rec.id and e.scope_id = p_scope
                        and e.debt_amount < 0
                        and sec.canonical_participant(e.debt_debtor_participant_id) = p_debtor
                        and sec.canonical_participant(e.debt_creditor_participant_id) = p_creditor
     where o.operation_class = 'group_payment'
       and (sec.canonical_participant(pd.payer_participant_id) in (p_debtor, p_creditor)
            and sec.canonical_participant(pd.receiver_participant_id) in (p_debtor, p_creditor))),
  pending as (
    select coalesce((select pp.amount from sec.pending_pairs(p_scope) pp
                      where pp.debtor = p_debtor and pp.creditor = p_creditor), 0)::bigint as amt)
  select least(reduced.amt, pending.amt) from reduced, pending;
$function$;

CREATE OR REPLACE FUNCTION sec.my_group_payment_context()
 RETURNS TABLE(operation_id uuid, group_scope_id uuid, group_display_name text, counterpart_display_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select o.id, pd.scope_id, gp.display_name,
         case when l.participant_id = sec.canonical_participant(pd.payer_participant_id) then pr.display_name else pp.display_name end
    from core.operation o
    join core.operation_version ov on ov.id = o.current_version_id
    join core.payment_detail pd on pd.operation_version_id = ov.id
    join core.group_profile gp on gp.scope_id = pd.scope_id
    join core.participant pp on pp.id = pd.payer_participant_id
    join core.participant pr on pr.id = pd.receiver_participant_id
    join core.participant_user_link l on l.scope_id = pd.scope_id and l.user_id = (select auth.uid())
                                      and l.participant_id in (sec.canonical_participant(pd.payer_participant_id), sec.canonical_participant(pd.receiver_participant_id))
   where o.operation_class = 'group_payment';
$function$;

CREATE OR REPLACE FUNCTION sec.payment_counterpart_name(p_operation uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when l.participant_id = sec.canonical_participant(pd.payer_participant_id) then pr.display_name else pp.display_name end
    from core.operation_version ov
    join core.payment_detail pd on pd.operation_version_id = ov.id
    join core.participant pp on pp.id = pd.payer_participant_id
    join core.participant pr on pr.id = pd.receiver_participant_id
    join core.participant_user_link l on l.scope_id = pd.scope_id and l.user_id = sec.request_actor_id()
                                      and l.participant_id in (sec.canonical_participant(pd.payer_participant_id), sec.canonical_participant(pd.receiver_participant_id))
   where ov.operation_id = p_operation and ov.version_kind = 'record'
   order by ov.version_no desc
   limit 1;
$function$;

CREATE OR REPLACE FUNCTION api.annul_operation(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version',
    'operation_id','expected_version_id'];
  v_canonical jsonb;
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
  v_clase text; v_date date; v_time time; v_amount bigint; v_currency uuid;
  v_obs uuid[] := '{}'::uuid[]; v_lock uuid[] := '{}'::uuid[]; v_before bigint[];
  v_scope uuid; v_group uuid; v_pd core.payment_detail%rowtype; v_other uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);

  -- Anular es SIEMPRE sobre una operacion existente: no hay alta que valga.
  if not (payload ? 'operation_id') or not (payload ? 'expected_version_id') then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'anular exige operation_id y expected_version_id', 400);
  end if;

  v_canonical := jsonb_build_object(
    'operation_id',        (sec.payload_uuid(payload,'operation_id',true))::text,
    'expected_version_id', (sec.payload_uuid(payload,'expected_version_id',true))::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'annulment', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  -- La clase sale de la operacion, no del payload: anular no la elige.
  select o.operation_class into v_clase from core.operation o where o.id = v_operation;
  if v_clase is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'la operacion no existe o no es alcanzable', 403);
  end if;

  -- RANGO 1 (protocolo de identidad, 20260912150000): antes de leer
  -- membresia, vinculo o salida. El ambito de grupo de la version, si lo hay.
  select g.id into v_group
    from core.current_effect ce join core.scope g on g.id = ce.scope_id and g.kind = 'group'
   where ce.operation_version_id = v_expected
   limit 1;
  if v_group is not null then
    perform sec.lock_participant_claims(v_group);
  end if;

  if v_clase = 'group_payment' then
    -- ADR-038 C4: pagador o receptor DE ESE PAGO (core.payment_detail), con o
    -- sin membresia; nadie mas. Las partes salen del hecho persistido, no de
    -- los efectos vigentes.
    select * into v_pd from core.payment_detail pd
     where pd.operation_version_id = (select ov.id from core.operation_version ov
                                        where ov.operation_id = v_operation and ov.version_kind = 'record'
                                        order by ov.version_no desc limit 1);
    if v_pd.operation_version_id is null
       or not exists (select 1 from core.participant_user_link l
                       where l.scope_id = v_pd.scope_id and l.user_id = v_actor
                         and l.participant_id in (sec.canonical_participant(v_pd.payer_participant_id),
                                                  sec.canonical_participant(v_pd.receiver_participant_id))) then
      perform sec.raise_boundary('NOT_AUTHORIZED',
        'solo quien pago o quien cobro puede anular este pago', 403);
    end if;
  else
    -- AUTORIZACION: la misma que corregir. `data-model.md` §7 la fija como
    -- membresia ACTUAL del ambito, sin mirar quien creo la operacion ni cuando
    -- entro. Se comprueba sobre cada ambito que la version vigente alcanza:
    -- un gasto con caja de OTRO pagador solo lo anula ese pagador (documentado
    -- en ADR-039; no se amplia aqui).
    foreach v_scope in array sec.normalize_scopes(
        sec.balance_scopes_of_version(v_expected) || sec.debt_scopes_of_version(v_expected))
    loop
      perform sec.assert_member(v_scope, v_actor);
    end loop;
  end if;

  -- LOCK sobre esos mismos ambitos, antes del CAS y en el orden global.
  v_obs  := sec.normalize_scopes(sec.balance_scopes_of_version(v_expected));
  v_lock := sec.normalize_scopes(v_obs || sec.debt_scopes_of_version(v_expected));
  perform sec.lock_scopes(v_lock);

  select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);

  -- Ninguna deuda puede quedar con pendiente negativo al desaparecer la que la
  -- originaba. Mismo invariante que protege la correccion, en otro momento.
  -- ADR-034 §6: anular un gasto cuya version vigente deja deuda con un
  -- retirado alteraria un pendiente declarado resuelto. Antes que el
  -- sobrepago, para que el motivo que llega sea el de fondo.
  if v_clase = 'group_payment' then
    -- ADR-038 C4: un pago del que dependen pagos posteriores SI se anula (el
    -- par consumido queda invertido: un credito de quien pago de mas), y un
    -- retirado en su camino no lo bloquea si queda en equilibrio. La guarda
    -- de sobreliquidacion y la de retirados de los GASTOS no se aplican aqui.
    perform sec.assert_payment_annulment_leaves_retired_balanced(v_expected);
  else
    perform sec.assert_no_retired_debt(v_expected);
    perform sec.assert_annulment_leaves_no_oversettled_debt(v_expected);
    -- ADR-039: anular un gasto que atribuye algo a quien salio se rehusa.
    perform sec.assert_departed_unchanged(null, v_expected);
  end if;

  -- La version anulada define el hecho que se declara sin vigencia.
  select ov.effective_date, ov.effective_time, ov.original_amount,
         ov.original_currency_definition_id
    into v_date, v_time, v_amount, v_currency
    from core.operation_version ov where ov.id = v_expected;

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, v_clase, v_date, v_amount, v_currency,
                              v_time, 'annulment');

  -- Y NINGUN efecto. Es lo que la hace no contar.

  perform sec.observe_balances(v_version, v_obs, v_before);

  -- ADR-038 C6: la contraparte del pago recibe el aviso aunque ya no sea
  -- miembro; el sujeto es la operacion.
  if v_clase = 'group_payment' then
    select l.user_id into v_other
      from core.participant_user_link l
     where l.scope_id = v_pd.scope_id
       and l.participant_id = sec.canonical_participant(
             case when exists (select 1 from core.participant_user_link x
                                where x.participant_id = sec.canonical_participant(v_pd.payer_participant_id) and x.user_id = v_actor)
                  then v_pd.receiver_participant_id else v_pd.payer_participant_id end);
    if v_other is not null and v_other <> v_actor then
      insert into core.group_notice (recipient_user_id, scope_id, kind, subject_id, actor_user_id)
      values (v_other, v_pd.scope_id, 'payment_annulled', v_operation, v_actor)
      on conflict (recipient_user_id, kind, subject_id) do nothing;
    end if;
  end if;

  return sec.envelope(v_operation, false);
end
$function$;

CREATE OR REPLACE FUNCTION api.unclaim_participant(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_allowed constant text[] := array[
    'client_command_id', 'command_contract_version', 'scope_id', 'participant_id', 'claim_command_id'];
  v_actor    uuid;
  v_command  uuid;
  v_version  integer;
  v_scope    uuid;
  v_target   uuid;
  v_claim    uuid;
  v_intent   jsonb;
  v_stored   jsonb;
  v_replay   boolean := false;
  v_link     record;
  v_blocking jsonb;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor   := sec.request_actor_id();
  v_command := (payload ->> 'client_command_id')::uuid;
  v_version := (payload ->> 'command_contract_version')::integer;
  v_scope   := (payload ->> 'scope_id')::uuid;
  v_target  := (payload ->> 'participant_id')::uuid;
  v_claim   := (payload ->> 'claim_command_id')::uuid;
  if v_command is null or v_version is null or v_scope is null or v_target is null or v_claim is null then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'client_command_id, command_contract_version, scope_id, participant_id y claim_command_id son obligatorios', 400);
  end if;
  if v_version <> 1 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'command_contract_version desconocida', 400);
  end if;

  v_intent := jsonb_build_object('scope_id', v_scope, 'participant_id', v_target, 'claim_command_id', v_claim);

  -- 0 · LA CLAVE, antes de autorizar y antes del cerrojo (ADR-033, ADR-010 §5).
  --     Un reintento de una rectificacion ya hecha responde su resultado
  --     original y NO llega a mirar el vinculo actual: si alguien —esta cuenta
  --     u otra— reclamo al participante despues, esa reclamacion no se toca.
  begin
    insert into core.provisioning_command (
      created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'participant.unclaim', v_version, v_intent, v_scope);
  exception when unique_violation then
    v_replay := true;
  end;
  if v_replay then
    select pc.canonical_intent into v_stored
      from core.provisioning_command pc
     where pc.created_by = v_actor and pc.client_command_id = v_command;
    if v_stored is null then
      perform sec.raise_boundary('COMMAND_IN_FLIGHT',
        'esa clave se esta resolviendo en otra sesion; reintenta', 409);
    end if;
    if v_stored <> v_intent then
      perform sec.raise_boundary('IDEMPOTENCY_KEY_REUSED',
        'esa clave ya se uso con una intencion distinta', 409);
    end if;
    return jsonb_build_object('scope_id', v_scope, 'participant_id', v_target, 'already_processed', true);
  end if;

  -- 1 · EL CERROJO DE IDENTIDAD DEL GRUPO, y solo el cerrojo: el provisioner
  --     no toma filas de ambito (E6). Todo lo que sigue se lee bajo el.
  perform sec.lock_participant_claims(v_scope);

  -- Membresia VIGENTE, leida aqui y no antes: una salida concurrente ya se
  -- serializo y se ve.
  if not sec.is_member(v_scope) then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no eres miembro de este grupo', 403);
  end if;
  perform sec.assert_scope_kind(v_scope, 'group');

  -- 2 · EL VINCULO PROPIO, y la reclamacion que lo creo. Solo se deshace la
  --     reclamacion que creo el vinculo VIGENTE: una posterior —de esta cuenta
  --     o de otra— no es la que se pide deshacer.
  select l.participant_id, l.claim_command_id into v_link
    from core.participant_user_link l
   where l.participant_id = v_target and l.scope_id = v_scope and l.user_id = v_actor;
  if v_link.participant_id is null then
    perform sec.raise_boundary('CLAIM_SUPERSEDED',
      'ese participante ya no esta vinculado a tu cuenta en este grupo', 409);
  end if;
  if v_link.claim_command_id is null then
    perform sec.raise_boundary('UNCLAIM_NOT_AVAILABLE',
      'este vinculo no procede de una reclamacion rectificable', 409);
  end if;
  if v_link.claim_command_id <> v_claim then
    perform sec.raise_boundary('CLAIM_SUPERSEDED',
      'la reclamacion que se pide deshacer no es la que creo el vinculo actual', 409);
  end if;

  -- 2b · ADR-040: un destino con fantasmas asociados no se desvincula; la
  --      fusion es irreversible en este bloque, como retirar.
  if exists (select 1 from core.participant_merge m where m.target_participant_id = v_target) then
    perform sec.raise_boundary('UNCLAIM_BLOCKED_MERGE',
      'has asociado a otro participante a esta identidad; no se puede deshacer', 409);
  end if;

  -- 3 · LA CAJA. Ninguna caja vigente en tu Personal por operaciones de este
  --     grupo: si la hay, se rehusa con las operaciones, y nada cambia. No se
  --     borra ni se reasigna ningun efecto para hacerlo posible.
  select jsonb_agg(jsonb_build_object(
           'operation_id', b.operation_id, 'operation_class', b.operation_class,
           'concept', b.concept, 'amount', b.amount, 'effective_date', b.effective_date::text)
         order by b.effective_date desc, b.operation_id)
    into v_blocking
    from sec.unclaim_blocking_operations(v_scope) b;
  if v_blocking is not null then
    perform sec.raise_boundary('UNCLAIM_BLOCKED_CASH',
      'hay dinero registrado en tu Personal como este participante en este grupo', 409,
      jsonb_build_object('operations', v_blocking));
  end if;

  -- 4 · EL HECHO, y despues lo que la reclamacion creo: el vinculo y la
  --     membresia, ambos del actor. Ni presencia, ni efectos, ni versiones,
  --     ni aviso: el participante sigue en el grupo, ahora sin cuenta.
  insert into core.participant_unclaim (participant_id, scope_id, user_id, claim_command_id, client_command_id)
  values (v_target, v_scope, v_actor, v_claim, v_command);
  delete from core.participant_user_link where participant_id = v_target and user_id = v_actor;
  delete from core.membership where scope_id = v_scope and user_id = v_actor;

  return jsonb_build_object('scope_id', v_scope, 'participant_id', v_target, 'already_processed', false);
end
$function$;

-- ═══════════════════════ §7 · la caja historica, una vez ═════════════════════
--
-- Del writer (definer de nomey_writer), invocable por el provisioner desde
-- api.associate_participant, que ya tiene el cerrojo de identidad del grupo y
-- ya escribio la fusion. Toma el rango 2 del grupo y del Personal del actor y
-- COMPLETA la version vigente de cada operacion del grupo en la que el origen
-- pago un gasto (split.payer) o fue parte de un pago (payment_detail) con el
-- efecto de caja que le falto en ese Personal: -total del gasto; -importe si
-- pago, +importe si cobro. Misma version, misma fecha, misma autoria. Nada se
-- cambia: solo se anade lo que no existe (idempotente por construccion). Las
-- versiones anuladas o sustituidas no se tocan (no son vigentes). Cada version
-- completada se observa (ADR-023) si ese Personal aun no tenia observacion de
-- ella.
create function sec.incorporate_participant_cash(p_scope uuid, p_source uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid := sec.request_actor_id();
  v_personal uuid;
  v_currency uuid;
  v_group_currency uuid;
  v_n        integer := 0;
  r          record;
begin
  select s.id, s.base_currency_definition_id into v_personal, v_currency
    from core.scope s where s.kind = 'personal' and s.owner_user_id = v_actor;
  if v_personal is null then
    perform sec.raise_boundary('PERSONAL_SCOPE_MISSING', 'la cuenta no tiene Modo Personal', 409);
  end if;
  select s.base_currency_definition_id into v_group_currency from core.scope s where s.id = p_scope;
  if v_group_currency <> v_currency then
    perform sec.raise_boundary('CURRENCY_CONVERSION_UNSUPPORTED',
      'la caja del grupo esta en otra moneda que tu Personal: la conversion no esta soportada', 422);
  end if;

  perform sec.lock_scopes(array[p_scope, v_personal]);

  for r in
    with vigentes as (
      select distinct ov.id as version_id, ov.effective_date, ov.version_no, ov.original_amount
        from core.operation o
        join core.operation_version ov on ov.id = o.current_version_id
        join core.effect e on e.operation_version_id = ov.id and e.scope_id = p_scope
       where ov.version_kind = 'record'),
    hechos as (
      select v.version_id, v.effective_date, v.version_no, - v.original_amount as amount, 'expense'::text as accounting_class
        from vigentes v
        join core.split sp on sp.operation_version_id = v.version_id and sp.scope_id = p_scope
       where sp.payer_participant_id = p_source
      union all
      select v.version_id, v.effective_date, v.version_no,
             case when pd.payer_participant_id = p_source then - v.original_amount else v.original_amount end,
             'transfer'
        from vigentes v
        join core.payment_detail pd on pd.operation_version_id = v.version_id and pd.scope_id = p_scope
       where p_source in (pd.payer_participant_id, pd.receiver_participant_id))
    select h.* from hechos h
     where not exists (select 1 from core.effect x
                        where x.operation_version_id = h.version_id and x.scope_id = v_personal
                          and x.balance_amount = h.amount and x.accounting_class = h.accounting_class)
     order by h.effective_date, h.version_id
  loop
    if exists (select 1 from core.balance_observation bo where bo.operation_version_id = r.version_id and bo.scope_id = v_personal) then
      -- La version ya movio este Personal (un pago entre mis dos identidades):
      -- se completa el otro lado; la observacion de esa version ya existe.
      insert into core.effect (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
      values (gen_random_uuid(), r.version_id, v_personal, r.accounting_class, v_currency, r.amount);
    else
      declare v_before bigint[];
      begin
        v_before := sec.balances_before(array[v_personal]);
        insert into core.effect (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
        values (gen_random_uuid(), r.version_id, v_personal, r.accounting_class, v_currency, r.amount);
        perform sec.observe_balances(r.version_id, array[v_personal], v_before);
      end;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$fn$;
grant create on schema sec to nomey_writer;
alter function sec.incorporate_participant_cash(uuid, uuid) owner to nomey_writer;
revoke create on schema sec from nomey_writer;
revoke execute on function sec.incorporate_participant_cash(uuid, uuid) from public;
grant execute on function sec.incorporate_participant_cash(uuid, uuid) to nomey_provisioner;

-- La segunda barrera (E16): el writer solo puede completar caja en el Personal
-- del actor, en una version vigente, y solo si un origen fusionado POR ESE
-- ACTOR pago ese gasto o fue parte de ese pago. Ninguna otra escritura.
create policy effect_writer_incorporate_insert on core.effect
  for insert to nomey_writer
  with check (
    balance_amount is not null and economic_amount is null and debt_amount is null
    and exists (select 1 from core.scope s where s.id = effect.scope_id and s.kind = 'personal' and s.owner_user_id = sec.request_actor_id())
    and exists (select 1 from core.operation o where o.current_version_id = effect.operation_version_id)
    and exists (
      select 1 from core.participant_merge m
       where m.merged_by = sec.request_actor_id()
         and (exists (select 1 from core.split sp where sp.operation_version_id = effect.operation_version_id and sp.payer_participant_id = m.source_participant_id)
           or exists (select 1 from core.payment_detail pd where pd.operation_version_id = effect.operation_version_id
                                                              and m.source_participant_id in (pd.payer_participant_id, pd.receiver_participant_id)))));
create policy balance_observation_writer_incorporate_insert on core.balance_observation
  for insert to nomey_writer
  with check (
    exists (select 1 from core.scope s where s.id = balance_observation.scope_id and s.kind = 'personal' and s.owner_user_id = sec.request_actor_id())
    and exists (select 1 from core.participant_merge m where m.merged_by = sec.request_actor_id()));

-- ═══════════════════════ §8 · api.associate_participant ══════════════════════
create function api.associate_participant(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array['client_command_id', 'command_contract_version', 'scope_id', 'participant_id'];
  v_actor   uuid;
  v_command uuid;
  v_version integer;
  v_scope   uuid;
  v_source  uuid;
  v_target  uuid;
  v_intent  jsonb;
  v_stored  jsonb;
  v_replay  boolean := false;
  v_cash    integer;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor   := sec.request_actor_id();
  v_command := (payload ->> 'client_command_id')::uuid;
  v_version := (payload ->> 'command_contract_version')::integer;
  v_scope   := (payload ->> 'scope_id')::uuid;
  v_source  := (payload ->> 'participant_id')::uuid;
  if v_command is null or v_version is null or v_scope is null or v_source is null then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'client_command_id, command_contract_version, scope_id y participant_id son obligatorios', 400);
  end if;
  if v_version <> 1 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'command_contract_version desconocida', 400);
  end if;
  v_intent := jsonb_build_object('scope_id', v_scope, 'participant_id', v_source);

  -- 0 · LA CLAVE, antes de autorizar y antes del cerrojo (ADR-033, ADR-010 §5).
  begin
    insert into core.provisioning_command (
      created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'group.associate', v_version, v_intent, v_scope);
  exception when unique_violation then
    v_replay := true;
  end;
  if v_replay then
    select pc.canonical_intent into v_stored
      from core.provisioning_command pc
     where pc.created_by = v_actor and pc.client_command_id = v_command;
    if v_stored is null then
      perform sec.raise_boundary('COMMAND_IN_FLIGHT', 'esa clave se esta resolviendo en otra sesion; reintenta', 409);
    end if;
    if v_stored <> v_intent then
      perform sec.raise_boundary('IDEMPOTENCY_KEY_REUSED', 'esa clave ya se uso con una intencion distinta', 409);
    end if;
    select m.target_participant_id into v_target from core.participant_merge m where m.source_participant_id = v_source;
    return jsonb_build_object('scope_id', v_scope, 'participant_id', v_source, 'target_participant_id', v_target, 'already_processed', true);
  end if;

  -- 1 · EL CERROJO DE IDENTIDAD DEL GRUPO (rango 1). Todo lo que sigue se lee
  --     bajo el: otra asociacion, una reclamacion, una retirada o una salida
  --     concurrentes ya se serializaron.
  perform sec.lock_participant_claims(v_scope);
  if not sec.is_member(v_scope) then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no eres miembro de este grupo', 403);
  end if;
  perform sec.assert_scope_kind(v_scope, 'group');

  -- 2 · EL DESTINO es mi identidad vinculada en el grupo; sin ella no hay a
  --     que asociar.
  select l.participant_id into v_target
    from core.participant_user_link l
   where l.scope_id = v_scope and l.user_id = v_actor;
  if v_target is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no tienes identidad en este grupo', 403);
  end if;
  if v_source = v_target then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'ese participante ya es tu identidad', 400);
  end if;

  -- 3 · EL ORIGEN: del grupo, sin cuenta, no retirado, no fusionado, no salido.
  if not exists (select 1 from core.participant p where p.id = v_source and p.scope_id = v_scope) then
    perform sec.raise_boundary('PARTICIPANT_NOT_IN_SCOPE', 'ese participante no es de este grupo', 422);
  end if;
  -- El vinculo de OTRA cuenta no lo lee el provisioner (su policy es la
  -- propia): lo resuelve la ayuda definer, como en las vistas.
  if sec.participant_is_linked(v_source) then
    perform sec.raise_boundary('PARTICIPANT_LINKED', 'ese participante ya tiene cuenta', 409);
  end if;
  if exists (select 1 from core.participant_merge m where m.source_participant_id = v_source or m.target_participant_id = v_source) then
    perform sec.raise_boundary('PARTICIPANT_MERGED', 'ese participante ya esta asociado a una cuenta', 409);
  end if;
  -- Sin vinculo ni fusion, lo unico que cierra el periodo de un participante
  -- es la retirada (nadie sin cuenta sale): la ayuda definer de siempre lo
  -- resuelve (el provisioner no lee core.participant_retirement).
  if not sec.participant_available(v_source, v_scope) then
    perform sec.raise_boundary('PARTICIPANT_RETIRED', 'ese participante esta retirado', 409);
  end if;

  -- 4 · EL HECHO, y despues la caja historica (writer, rango 2), atomica con el.
  insert into core.participant_merge (source_participant_id, target_participant_id, scope_id, merged_by, client_command_id)
  values (v_source, v_target, v_scope, v_actor, v_command);
  v_cash := sec.incorporate_participant_cash(v_scope, v_source);

  return jsonb_build_object('scope_id', v_scope, 'participant_id', v_source, 'target_participant_id', v_target,
                            'incorporated_versions', v_cash, 'already_processed', false);
end
$fn$;
grant create on schema api to nomey_provisioner;
alter function api.associate_participant(jsonb) owner to nomey_provisioner;
revoke create on schema api from nomey_provisioner;
revoke execute on function api.associate_participant(jsonb) from public;
grant execute on function api.associate_participant(jsonb) to authenticated;
grant execute on function sec.participant_is_linked(uuid) to nomey_provisioner;
grant execute on function sec.participant_available(uuid, uuid) to nomey_provisioner;

-- ═══════════════════════ §9 · tu cuota en Movimientos del grupo ══════════════
-- Con la proyeccion canonica, un gasto donde figuraban mis dos identidades
-- tiene DOS efectos economicos mios: «tu parte» es la suma, no la primera.
-- Misma lista de columnas.
create or replace view api.group_operation with (security_invoker = true) as
select o.id as operation_id,
       ov.id as version_id,
       e.scope_id,
       e.currency_definition_id,
       ov.original_amount::text as total_amount,
       ov.original_amount as total_order,
       ov.effective_date,
       md.concept,
       ec.category_id,
       sp.payer_participant_id,
       sp.split_method,
       (select sum(ee.economic_amount)::text
          from core.current_effect ee
         where ee.operation_version_id = ov.id and ee.economic_amount is not null
           and ee.economic_participant_id is not null and sec.is_my_participant(ee.economic_participant_id)) as your_share,
       ov.supersedes_version_id as previous_version_id,
       (select prev.original_amount::text from core.operation_version prev where prev.id = ov.supersedes_version_id) as previous_amount,
       ov.version_no,
       o.created_at as operation_created_at,
       ov.effective_time
  from core.current_effect e
  join core.operation_version ov on ov.id = e.operation_version_id
  join core.operation o on o.id = ov.operation_id
  join core.scope s on s.id = e.scope_id
  join core.split sp on sp.operation_version_id = ov.id and sp.scope_id = e.scope_id
  left join core.movement_detail md on md.operation_version_id = ov.id
  left join core.expense_category ec on ec.operation_version_id = ov.id
 where s.kind = 'group' and o.operation_class = 'group_expense' and ov.version_kind = 'record'
 group by o.id, ov.id, e.scope_id, e.currency_definition_id, ov.original_amount, ov.effective_date, ov.effective_time,
          md.concept, ec.category_id, sp.payer_participant_id, sp.split_method, ov.supersedes_version_id, ov.version_no, o.created_at;
