-- ============================================================================
-- ADR-034 · SALIR DE UN GRUPO, Y DAR POR SALDADO A QUIEN SALIO
-- ============================================================================
--
-- Lo que esta migracion escribe, en el orden en que lo necesita el ADR:
--
--   §1  api.leave_group            salida: membresia, presencia, hecho, aviso
--   §2  core.group_departure       el hecho de la salida (insert-only)
--       core.participant_retirement  el estado que retira de las listas
--   §3  api.claimed_dimension       la deuda se atribuye por vinculo Y membresia
--   §4  api.settle_participant      «Saldado»: todos los pares, atomico, CAS
--   §5  participant_period          el periodo vacio del mismo dia
--   §6  barreras en los writers     inactivo / retirado
--   §7  core.group_notice           una relacion de avisos, y se migran los que hay
--   §8  sec.my_group_expense_context  el contexto de Personal sin RLS del grupo
--
-- Evidencia previa: supabase/e23. Nada de aqui borra hechos: la salida borra
-- UNA fila de membresia (autorizacion actual, ADR-007 §4) y nada mas.

-- ═══════════════════════ §5 · el periodo vacio del mismo dia ══════════════════
--
-- Crear y salir el mismo dia deja `[hoy, hoy)`: un periodo VACIO. No se inventa
-- un dia de presencia, no se borra la fila —es historia: estuvo y se fue— y la
-- salida no falla. La exclusion GiST ya trata el rango vacio como no solapado
-- con nada; la comprobacion de rango pasa de `>` a `>=`. ADR-034 §5.
alter table core.participant_period
  drop constraint participant_period_rango_valido,
  add constraint participant_period_rango_valido
    check (valid_until is null or valid_until >= valid_from);

-- ═══════════════════════ §2 · los dos hechos nuevos ═══════════════════════════

create table core.group_departure (
  id                uuid primary key default gen_random_uuid(),
  scope_id          uuid not null references core.scope (id),
  -- Nulo solo si la cuenta no tenia identidad contextual en el grupo: hoy no
  -- ocurre (el creador siempre se vincula) y F10 vinculara al unirse.
  participant_id    uuid references core.participant (id),
  user_id           uuid not null,
  left_at           timestamptz not null default now(),
  client_command_id uuid not null unique
);
comment on table core.group_departure is
  'Quien salio de un grupo y cuando. Insert-only: la membresia se borra (ADR-007 §4) y este es el hecho que queda (ADR-034 §1).';
create index group_departure_scope_idx on core.group_departure (scope_id, left_at desc);
alter table core.group_departure enable row level security;
grant select, insert on core.group_departure to nomey_provisioner;
create policy group_departure_provisioner_insert on core.group_departure
  for insert to nomey_provisioner
  with check (user_id = sec.request_actor_id());
create policy group_departure_provisioner_select on core.group_departure
  for select to nomey_provisioner
  using (user_id = sec.request_actor_id());
grant select on core.group_departure to authenticated;
create policy group_departure_client_select on core.group_departure
  for select to authenticated
  using (sec.is_member(scope_id));

create table core.participant_retirement (
  participant_id    uuid primary key references core.participant (id),
  scope_id          uuid not null references core.scope (id),
  operation_id      uuid references core.operation (id),
  retired_by        uuid not null,
  retired_at        timestamptz not null default now(),
  client_command_id uuid not null unique
);
comment on table core.participant_retirement is
  'Los miembros dieron por resueltos los pendientes de este participante y lo retiraron de las listas. Insert-only, sin deshacer (ADR-034 §4). operation_id nulo = no habia pares: ninguna operacion de importe cero.';
alter table core.participant_retirement enable row level security;
grant select, insert on core.participant_retirement to nomey_writer;
create policy participant_retirement_writer_insert on core.participant_retirement
  for insert to nomey_writer
  with check (retired_by = sec.request_actor_id());
create policy participant_retirement_writer_select on core.participant_retirement
  for select to nomey_writer
  using (true);
grant select on core.participant_retirement to authenticated;
create policy participant_retirement_client_select on core.participant_retirement
  for select to authenticated
  using (sec.is_member(scope_id));

-- ═══════════════════════ §7 · una sola relacion de avisos ═════════════════════
--
-- Cuatro clases ya no caben en una tabla por clase. Las dos que habia se
-- REEMPLAZAN, y sus filas —con su estado de lectura— se traen aqui antes de
-- soltarlas: habia avisos reales (4 de edicion, 13 de perfil al escribir esto).
--
-- Y se corrige lo que E23 midio: las politicas llamaban a sec.request_actor_id()
-- directamente, que authenticated no puede ejecutar, asi que NINGUN cliente
-- podia leer sus avisos. Ahora pasan por sec.is_me() Y sec.is_member(): un
-- aviso es de la membresia (ADR-034 §7); sin ella no se ve, y no se borra.
create table core.group_notice (
  id                uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null,
  scope_id          uuid not null references core.scope (id),
  kind              text not null check (kind in ('edit', 'profile', 'departure', 'settlement')),
  subject_id        uuid not null,
  actor_user_id     uuid not null,
  occurred_at       timestamptz not null default now(),
  read_at           timestamptz,
  unique (recipient_user_id, kind, subject_id)
);
comment on table core.group_notice is
  'Un aviso interno por destinatario. kind=edit: subject es la version corregida; profile: el cambio de perfil; departure: la salida; settlement: la retirada (ADR-034 §7).';
create index group_notice_recipient_idx on core.group_notice (recipient_user_id, occurred_at desc);
alter table core.group_notice enable row level security;

insert into core.group_notice (recipient_user_id, scope_id, kind, subject_id, actor_user_id, occurred_at, read_at)
select recipient_user_id, scope_id, 'edit', operation_version_id, editor_user_id, edited_at, read_at
  from core.group_edit_notice;
insert into core.group_notice (recipient_user_id, scope_id, kind, subject_id, actor_user_id, occurred_at, read_at)
select recipient_user_id, scope_id, 'profile', change_id, editor_user_id, edited_at, read_at
  from core.group_profile_notice;

drop view api.group_edit_notice;
drop view api.group_profile_notice;
-- notify_group_edit es un cuerpo SQL estandar (BEGIN ATOMIC) y depende de la
-- tabla: se suelta y se vuelve a crear mas abajo sobre group_notice.
drop function sec.notify_group_edit(uuid, uuid, uuid, uuid);
drop table core.group_edit_notice;
drop table core.group_profile_notice;

grant select (id, scope_id, kind, subject_id, actor_user_id, occurred_at, read_at)
  on core.group_notice to authenticated;
grant update (read_at) on core.group_notice to authenticated;
create policy group_notice_client_select on core.group_notice
  for select to authenticated
  using (sec.is_me(recipient_user_id) and sec.is_member(scope_id));
create policy group_notice_client_update on core.group_notice
  for update to authenticated
  using (sec.is_me(recipient_user_id) and sec.is_member(scope_id))
  with check (sec.is_me(recipient_user_id) and sec.is_member(scope_id));
grant select, insert on core.group_notice to nomey_writer, nomey_provisioner;
create policy group_notice_writer_insert on core.group_notice
  for insert to nomey_writer with check (actor_user_id = sec.request_actor_id());
create policy group_notice_writer_select on core.group_notice
  for select to nomey_writer using (true);
create policy group_notice_provisioner_insert on core.group_notice
  for insert to nomey_provisioner with check (actor_user_id = sec.request_actor_id());
create policy group_notice_provisioner_select on core.group_notice
  for select to nomey_provisioner using (actor_user_id = sec.request_actor_id());

-- A todos los miembros ACTUALES del ambito, el actor incluido: `by_me` lo
-- distingue en la lectura. Quien ya no es miembro no recibe nada.
create or replace function sec.notify_members(p_scope uuid, p_kind text, p_subject uuid, p_actor uuid)
returns void
language sql
set search_path = ''
as $fn$
  insert into core.group_notice (recipient_user_id, scope_id, kind, subject_id, actor_user_id)
  select m.user_id, p_scope, p_kind, p_subject, p_actor
    from core.membership m
   where m.scope_id = p_scope
  on conflict (recipient_user_id, kind, subject_id) do nothing;
$fn$;
revoke execute on function sec.notify_members(uuid, text, uuid, uuid) from public;
grant execute on function sec.notify_members(uuid, text, uuid, uuid) to nomey_writer, nomey_provisioner;

create function sec.notify_group_edit(p_scope uuid, p_operation uuid, p_version uuid, p_editor uuid)
returns void
language sql
set search_path = ''
as $fn$
  select sec.notify_members(p_scope, 'edit', p_version, p_editor);
$fn$;
revoke execute on function sec.notify_group_edit(uuid, uuid, uuid, uuid) from public;
grant execute on function sec.notify_group_edit(uuid, uuid, uuid, uuid) to nomey_writer;

-- La lectura: sin actor_user_id —seria publicar que cuenta hay detras de un
-- nombre, ADR-032 §5—; con `by_me`, y con lo que la campana necesita resuelto
-- aqui: el nombre del grupo, el participante del que trata la salida o la
-- retirada, y la operacion de una edicion o una resolucion.
create view api.group_notice
with (security_invoker = true) as
select n.id,
       n.scope_id,
       gp.display_name                         as group_display_name,
       n.kind,
       n.subject_id,
       sec.is_me(n.actor_user_id)              as by_me,
       n.occurred_at,
       n.read_at,
       case n.kind
         when 'edit'       then (select ov.operation_id from core.operation_version ov where ov.id = n.subject_id)
         when 'settlement' then (select r.operation_id  from core.participant_retirement r where r.client_command_id = n.subject_id)
       end                                     as operation_id,
       case n.kind
         when 'departure'  then (select d.participant_id from core.group_departure d where d.id = n.subject_id)
         when 'settlement' then (select r.participant_id from core.participant_retirement r where r.client_command_id = n.subject_id)
       end                                     as participant_id,
       case n.kind
         when 'departure'  then (select p.display_name from core.group_departure d join core.participant p on p.id = d.participant_id where d.id = n.subject_id)
         when 'settlement' then (select p.display_name from core.participant_retirement r join core.participant p on p.id = r.participant_id where r.client_command_id = n.subject_id)
       end                                     as participant_display_name
  from core.group_notice n
  join core.group_profile gp on gp.scope_id = n.scope_id;
grant select on api.group_notice to authenticated;

-- Marcar leido. Definer REDUCIDO, dueño postgres, porque authenticated no
-- tiene USAGE sobre core y la vista no es actualizable (tiene joins). El
-- filtro va en el cuerpo y es el mismo que la politica: solo lo mio, y solo
-- mientras sea miembro. No acepta cambiar de dueño ni de fila ajena.
create function api.mark_group_notice_read(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $fn$
  update core.group_notice n
     set read_at = coalesce(n.read_at, now())
   where n.id = p_id
     and n.recipient_user_id = (select auth.uid())
     and sec.is_member(n.scope_id);
$fn$;
revoke execute on function api.mark_group_notice_read(uuid) from public;
grant execute on function api.mark_group_notice_read(uuid) to authenticated;

-- ═══════════════════════ §2 · lo que publica el grupo ═════════════════════════

-- La presencia, resumida, por un definer REDUCIDO: el cliente sigue sin alcanzar
-- core.participant_period (guardia A2 de group-expense-flow), y solo responde
-- sobre participantes de ambitos de los que el actor es miembro.
--   is_active       = existe periodo abierto
--   eligible_until  = limite EXCLUSIVO del ultimo periodo; nulo si activo. El
--                     cliente aplica la misma desigualdad que la frontera:
--                     fecha < eligible_until.
create function sec.participant_presence(p_participant uuid)
returns table (is_active boolean, eligible_until date)
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (select 1 from core.participant_period pp
                  where pp.participant_id = p.id and pp.valid_until is null),
         case when exists (select 1 from core.participant_period pp
                            where pp.participant_id = p.id and pp.valid_until is null)
              then null
              else (select max(pp.valid_until) from core.participant_period pp where pp.participant_id = p.id)
         end
    from core.participant p
   where p.id = p_participant
     and sec.is_member(p.scope_id);
$fn$;
revoke execute on function sec.participant_presence(uuid) from public;
grant execute on function sec.participant_presence(uuid) to authenticated;

create or replace view api.group_participant
with (security_invoker = true) as
select p.id            as participant_id,
       p.scope_id,
       p.display_name,
       p.created_at,
       sec.is_my_participant(p.id) as is_self,
       -- ADR-034 §2: tres datos que no se colapsan.
       coalesce(pr.is_active, false) as is_active,
       pr.eligible_until,
       exists (select 1 from core.participant_retirement r where r.participant_id = p.id) as is_retired
  from core.participant p
  join core.scope s on s.id = p.scope_id
  left join lateral sec.participant_presence(p.id) pr on true
 where s.kind = 'group';

-- Saldos no lista a los retirados: su posicion es cero por construccion y los
-- miembros los retiraron de las listas. Su nombre sigue en group_participant.
create or replace view api.group_balance
with (security_invoker = true) as
select p.scope_id,
       p.id as participant_id,
       p.display_name,
       s.base_currency_definition_id as currency_definition_id,
       sec.is_my_participant(p.id) as is_self,
       (coalesce((select sum(e.debt_amount) from core.current_effect e
                   where e.scope_id = p.scope_id and e.debt_amount is not null
                     and e.debt_creditor_participant_id = p.id), 0)
        - coalesce((select sum(e.debt_amount) from core.current_effect e
                   where e.scope_id = p.scope_id and e.debt_amount is not null
                     and e.debt_debtor_participant_id = p.id), 0))::text as net_position
  from core.participant p
  join core.scope s on s.id = p.scope_id
 where s.kind = 'group'
   and not exists (select 1 from core.participant_retirement r where r.participant_id = p.id);

-- Los PARES pendientes, neteados por par en las dos direcciones, como hace
-- sec.net_debt. Es lo que la confirmacion de «Saldado» ensena y lo que el
-- comando vuelve a calcular bajo bloqueo para compararlo.
create view api.group_pending_pair
with (security_invoker = true) as
with ordered as (
  select e.scope_id, e.debt_debtor_participant_id as debtor, e.debt_creditor_participant_id as creditor,
         sum(e.debt_amount) as amount
    from core.current_effect e
    join core.scope s on s.id = e.scope_id and s.kind = 'group'
   where e.debt_amount is not null
   group by e.scope_id, e.debt_debtor_participant_id, e.debt_creditor_participant_id
), net as (
  select a.scope_id, a.debtor, a.creditor,
         a.amount - coalesce((select b.amount from ordered b
                               where b.scope_id = a.scope_id and b.debtor = a.creditor and b.creditor = a.debtor), 0) as amount
    from ordered a
)
select scope_id, debtor as debtor_participant_id, creditor as creditor_participant_id, amount::text as amount
  from net
 where amount > 0;
grant select on api.group_pending_pair to authenticated;

-- ═══════════════════════ §3 · la deuda, por vinculo Y membresia ═══════════════
--
-- E23 midio que las dos ramas de deuda seguian publicando la deuda de un grupo
-- del que ya no se es miembro. La economica no cambia: la parte de una cena es
-- un hecho de gasto, no una deuda (ADR-034 §3, precision de ADR-016 §1).
create or replace function api.claimed_dimension()
returns table (accounting_class text, currency_definition_id uuid, effective_date date, dimension text, amount text)
language sql
stable
security definer
set search_path = ''
begin atomic
  select e.accounting_class, e.currency_definition_id, ov.effective_date, 'economic', e.economic_amount::text
    from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
    join core.participant_user_link l on l.participant_id = e.economic_participant_id
   where l.user_id = (select auth.uid()) and e.economic_amount is not null
  union all
  select e.accounting_class, e.currency_definition_id, ov.effective_date, 'debt', (- e.debt_amount)::text
    from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
    join core.participant_user_link l on l.participant_id = e.debt_debtor_participant_id
   where l.user_id = (select auth.uid()) and e.debt_amount is not null
     and sec.is_member(e.scope_id)
  union all
  select e.accounting_class, e.currency_definition_id, ov.effective_date, 'debt', e.debt_amount::text
    from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
    join core.participant_user_link l on l.participant_id = e.debt_creditor_participant_id
   where l.user_id = (select auth.uid()) and e.debt_amount is not null
     and sec.is_member(e.scope_id);
end;

-- participant_count era bigint (count(*)) y ADR-008 §1 no deja cruzar bigint por
-- api; un recuento de participantes cabe en integer. Mismo orden de columnas.
-- Va DESPUES de crear participant_retirement, porque la cuenta lo consulta.
-- create or replace no cambia el tipo de una columna: se suelta y se recrea
-- (nada depende de ella en el catalogo) y se devuelve el grant.
drop view api.group_profile;
create view api.group_profile
with (security_invoker = true) as
select g.scope_id, g.display_name, g.emoji, s.base_currency_definition_id,
       c.code as currency_code, c.scale as currency_scale,
       -- Los que se listan: los retirados conservan el nombre y nada mas (ADR-034 §2).
       (select count(*) from core.participant p
         where p.scope_id = g.scope_id
           and not exists (select 1 from core.participant_retirement r where r.participant_id = p.id))::integer as participant_count,
       g.created_at, g.updated_at, g.default_category_id,
       (select max(o.created_at)
          from core.current_effect e
          join core.operation_version ov on ov.id = e.operation_version_id
          join core.operation o on o.id = ov.operation_id
         where e.scope_id = g.scope_id) as last_activity_at
  from core.group_profile g
  join core.scope s on s.id = g.scope_id
  join core.currency_definition c on c.id = s.base_currency_definition_id;
grant select on api.group_profile to authenticated;

-- ═══════════════════════ §8 · el contexto de Personal, sin la RLS del grupo ═══
--
-- SIN PARAMETROS: no hay UUID que sondear. Para el actor, una fila por
-- operacion group_expense cuya version VIGENTE deja saldo en un ambito personal
-- suyo (pago) o tiene un efecto economico de un participante vinculado a el
-- (figura en el reparto). Cuatro columnas exactas: ampliarlas es una decision
-- de privacidad (ADR-016 §10). Sustituye a las tres subconsultas bajo RLS que
-- E23 vio quedarse en NULL al salir del grupo.
create function sec.my_group_expense_context()
returns table (operation_id uuid, group_scope_id uuid, group_display_name text, your_share text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select o.id,
         g.id,
         gp.display_name,
         (select sum(ge.economic_amount)
            from core.current_effect ge
            join core.participant_user_link l on l.participant_id = ge.economic_participant_id
           where ge.operation_version_id = o.current_version_id
             and ge.economic_amount is not null
             and l.user_id = (select auth.uid()))::text
    from core.operation o
    join core.current_effect ce on ce.operation_version_id = o.current_version_id
    join core.scope g on g.id = ce.scope_id and g.kind = 'group'
    join core.group_profile gp on gp.scope_id = g.id
   where o.operation_class = 'group_expense'
     and (
       exists (select 1 from core.current_effect b
                 join core.scope ps on ps.id = b.scope_id
                where b.operation_version_id = o.current_version_id
                  and b.balance_amount is not null
                  and ps.kind = 'personal' and ps.owner_user_id = (select auth.uid()))
       or exists (select 1 from core.current_effect x
                    join core.participant_user_link l on l.participant_id = x.economic_participant_id
                   where x.operation_version_id = o.current_version_id
                     and l.user_id = (select auth.uid()))
     )
   group by o.id, g.id, gp.display_name, o.current_version_id;
$fn$;
revoke execute on function sec.my_group_expense_context() from public;
grant execute on function sec.my_group_expense_context() to authenticated;

create or replace view api.personal_operation
with (security_invoker = true) as
select o.id                                as operation_id,
       o.operation_class,
       e.scope_id,
       e.currency_definition_id,
       sum(e.balance_amount)::text         as balance_amount,
       ov.original_amount::text            as original_amount,
       ov.effective_date,
       ov.effective_time,
       md.concept,
       xc.category_id,
       ad.target_balance::text             as target_balance,
       o.current_version_id,
       ov.supersedes_version_id            as previous_version_id,
       ov.version_no,
       o.created_at                        as operation_created_at,
       ctx.group_scope_id,
       ctx.group_display_name,
       ctx.your_share
  from core.current_effect e
  join core.operation_version ov on ov.id = e.operation_version_id
  join core.operation o on o.id = ov.operation_id
  join core.scope s on s.id = e.scope_id
  left join core.movement_detail md on md.operation_version_id = ov.id
  left join core.expense_category xc on xc.operation_version_id = ov.id
  left join core.adjustment_detail ad on ad.operation_version_id = ov.id
  left join sec.my_group_expense_context() ctx on ctx.operation_id = o.id
 where s.kind = 'personal'
   and s.owner_user_id = (select auth.uid())
   and o.operation_class = any (array['personal_expense',
                                      'personal_income',
                                      'adjustment',
                                      'group_expense'])
   and ov.version_kind = 'record'
   and e.balance_amount is not null
 group by o.id, o.operation_class, e.scope_id, e.currency_definition_id,
          ov.original_amount, ov.effective_date, ov.effective_time,
          md.concept, xc.category_id, ad.target_balance,
          o.current_version_id, ov.supersedes_version_id, ov.version_no,
          o.created_at, ctx.group_scope_id, ctx.group_display_name, ctx.your_share;

-- ═══════════════════════ §6 · las barreras ════════════════════════════════════

create function sec.assert_participant_active(p_participant uuid, p_scope uuid)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
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

create function sec.assert_participant_not_retired(p_participant uuid, p_scope uuid)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if exists (select 1 from core.participant_retirement r
              where r.participant_id = p_participant and r.scope_id = p_scope) then
    perform sec.raise_boundary('PARTICIPANT_RETIRED',
      'los miembros dieron por saldado a este participante: no puede volver a adquirir deuda (ADR-034 §6)', 422);
  end if;
end
$fn$;

-- Los efectos de deuda de una version que nombran a algun retirado, en forma
-- comparable: (deudor, acreedor, importe), ordenados.
create function sec.retired_debt_of_version(p_version uuid)
returns text[]
language sql
stable
set search_path = ''
as $fn$
  select coalesce(array_agg(e.debt_debtor_participant_id::text || '>' || e.debt_creditor_participant_id::text || ':' || e.debt_amount::text
                            order by e.debt_debtor_participant_id, e.debt_creditor_participant_id, e.debt_amount), '{}')
    from core.effect e
   where e.operation_version_id = p_version
     and e.debt_amount is not null
     and exists (select 1 from core.participant_retirement r
                  where r.participant_id in (e.debt_debtor_participant_id, e.debt_creditor_participant_id));
$fn$;

create function sec.assert_retired_debt_unchanged(p_new_version uuid, p_old_version uuid)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if sec.retired_debt_of_version(p_new_version) <> sec.retired_debt_of_version(p_old_version) then
    perform sec.raise_boundary('PARTICIPANT_RETIRED',
      'la correccion alteraria la deuda de un participante dado por saldado; concepto, categoria y hora si se pueden cambiar (ADR-034 §6)', 422);
  end if;
end
$fn$;

create function sec.assert_no_retired_debt(p_version uuid)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if sec.retired_debt_of_version(p_version) <> '{}'::text[] then
    perform sec.raise_boundary('PARTICIPANT_RETIRED',
      'anular esta operacion alteraria la deuda de un participante dado por saldado (ADR-034 §6)', 422);
  end if;
end
$fn$;

revoke execute on function sec.assert_participant_active(uuid, uuid), sec.assert_participant_not_retired(uuid, uuid),
  sec.retired_debt_of_version(uuid), sec.assert_retired_debt_unchanged(uuid, uuid), sec.assert_no_retired_debt(uuid)
  from public;
grant execute on function sec.assert_participant_active(uuid, uuid), sec.assert_participant_not_retired(uuid, uuid),
  sec.retired_debt_of_version(uuid), sec.assert_retired_debt_unchanged(uuid, uuid), sec.assert_no_retired_debt(uuid)
  to nomey_writer;

CREATE OR REPLACE FUNCTION api.record_group_expense(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_obs uuid[] := '{}'::uuid[]; v_before bigint[];
  c_allowed constant text[] := array[
    'client_operation_id','command_contract_version','effective_date','effective_time',
    'operation_id','expected_version_id',
    'scope_id','currency_definition_id','total',
    'payer_participant_id','participants','split_method',
    'concept','category_id'];
  v_scope uuid; v_currency uuid; v_total bigint; v_date date; v_time time; v_payer uuid;
  v_participants uuid[]; v_method jsonb; v_kind text; v_resolved bigint[];
  v_concept text; v_category uuid;
  v_payer_scope uuid; v_canonical jsonb; v_lock uuid[];
  v_replay boolean; v_actor uuid; v_operation uuid; v_version uuid;
  v_correction boolean; v_expected uuid;
  v_version_no integer; v_supersedes uuid;
  v_i integer;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_scope    := sec.payload_uuid(payload, 'scope_id', true);
  v_currency := sec.payload_uuid(payload, 'currency_definition_id', true);
  v_total    := sec.payload_amount(payload, 'total');
  v_date     := sec.payload_date(payload, 'effective_date');
  -- OPCIONAL, a diferencia del personal: un gasto historico sin hora se corrige
  -- conservando su ausencia, y nadie le inventa una (ADR-020 §3).
  v_time     := sec.payload_time(payload, 'effective_time', false);
  v_payer    := sec.payload_uuid(payload, 'payer_participant_id', true);
  v_participants := sec.jsonb_uuid_array(payload -> 'participants', 'participants');
  v_concept  := sec.canonical_concept(sec.payload_text(payload, 'concept', true));
  v_category := sec.payload_uuid(payload, 'category_id', true);

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
  if (select count(*) from jsonb_object_keys(v_method) k
       where k not in ('kind', case v_kind when 'shares' then 'weights'
                                           when 'exact_amounts' then 'amounts'
                                           else 'kind' end)) > 0 then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      format('split_method lleva campos que el metodo %s no declara', v_kind), 400);
  end if;

  v_resolved := sec.resolve_split(v_total, v_participants, v_payer, v_method);

  v_canonical := jsonb_build_object(
    'operation_id',           (sec.payload_uuid(payload,'operation_id',false))::text,
    'scope_id',               v_scope::text,
    'currency_definition_id', v_currency::text,
    'total',                  payload ->> 'total',
    'effective_date',         v_date::text,
    'effective_time',         v_time::text,
    'payer_participant_id',   v_payer::text,
    'participants',           (select coalesce(jsonb_agg(p::text order by ord), '[]'::jsonb)
                                 from unnest(v_participants) with ordinality as u(p, ord)),
    'split_method',           v_method,
    'concept',                v_concept,
    'category_id',            v_category::text);

  select * into v_replay, v_actor, v_operation, v_version, v_correction, v_expected
    from sec.begin_command(payload, 'group_expense', v_canonical);
  if v_replay then
    return sec.envelope(v_operation, true);
  end if;

  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);
  perform sec.assert_no_conversion(v_scope, v_currency);
  perform sec.assert_shared_category_usable(v_category, v_expected);

  foreach v_payer_scope in array v_participants loop
    perform sec.assert_participant_eligible(v_payer_scope, v_scope, v_date);
    -- ADR-034 §6: un ALTA no puede nombrar a un retirado, ni siquiera
    -- retro-fechada dentro de su periodo: crearia deuda sobre un pendiente
    -- que los miembros declararon resuelto. En una correccion se compara
    -- despues, efecto a efecto.
    if not v_correction then
      perform sec.assert_participant_not_retired(v_payer_scope, v_scope);
    end if;
  end loop;
  v_payer_scope := null;

  v_payer_scope := sec.participant_personal_scope(v_payer);
  if v_payer_scope is not null then
    perform sec.assert_no_conversion(v_payer_scope, v_currency);
  end if;

  v_lock := array[v_scope];
  v_obs := case when v_payer_scope is not null then array[v_payer_scope] else '{}'::uuid[] end;
  if v_correction then
    v_obs := v_obs || sec.balance_scopes_of_version(v_expected);
  end if;
  v_lock := v_lock || v_obs;
  if v_correction then
    v_lock := v_lock || sec.debt_scopes_of_version(v_expected);
  end if;
  perform sec.lock_scopes(v_lock);

  if v_correction then
    select * into v_version_no, v_supersedes from sec.lock_and_cas(v_operation, v_expected);
    perform sec.assert_correction_leaves_no_oversettled_debt(
      v_scope, v_expected, v_participants, v_resolved, v_payer);
  else
    v_version_no := 1; v_supersedes := null;
  end if;

  v_before := sec.balances_before(v_obs);

  perform sec.persist_version(v_actor, v_operation, v_version, v_version_no,
                              v_supersedes, 'group_expense', v_date, v_total, v_currency,
                              v_time);

  perform sec.persist_split(v_version, v_scope, v_method, v_participants, v_payer, v_resolved);
  perform sec.persist_movement_detail(v_version, v_concept);
  perform sec.persist_expense_category(v_version, v_category);

  for v_i in 1 .. array_length(v_participants, 1) loop
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       economic_amount, economic_participant_id)
    values (gen_random_uuid(), v_version, v_scope, 'expense', v_currency,
            v_resolved[v_i], v_participants[v_i]);
  end loop;

  for v_i in 1 .. array_length(v_participants, 1) loop
    if v_participants[v_i] <> v_payer and v_resolved[v_i] > 0 then
      insert into core.effect
        (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
         debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
      values (gen_random_uuid(), v_version, v_scope, 'expense', v_currency,
              v_resolved[v_i], v_participants[v_i], v_payer);
    end if;
  end loop;

  if v_payer_scope is not null then
    insert into core.effect
      (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
       balance_amount)
    values (gen_random_uuid(), v_version, v_payer_scope, 'expense', v_currency, - v_total);
  end if;

  perform sec.observe_balances(v_version, v_obs, v_before);

  -- ADR-034 §6: corregir un gasto de un retirado es posible solo si NINGUN
  -- efecto de deuda que lo nombre cambia. Se compara con los efectos ya
  -- escritos, y un rechazo aqui revierte la version entera.
  if v_correction then
    perform sec.assert_retired_debt_unchanged(v_version, v_expected);
  end if;

  -- ═══ Y SOLO SI FUE UNA CORRECCION, el aviso interno ═══
  --
  -- Aqui, y no antes: la version ya esta escrita y sus efectos asentados, asi
  -- que ninguna notificacion puede sobrevivir a un rechazo posterior. Un alta no
  -- notifica nada — no es una edicion de nada.
  if v_correction then
    perform sec.notify_group_edit(v_scope, v_operation, v_version, v_actor);
  end if;

  return sec.envelope(v_operation, false);
end
$function$

;
alter function api.record_group_expense(jsonb) owner to nomey_writer;

CREATE OR REPLACE FUNCTION api.record_debt_settlement(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- ADR-034 §6: ademas de la fecha, los DOS extremos activos AHORA. A quien
  -- salio se le resuelve con settle_participant, nunca con una liquidacion
  -- —retro-fechada o no—.
  perform sec.assert_participant_active(v_debtor,   v_scope);
  perform sec.assert_participant_active(v_creditor, v_scope);

  -- 6 · LOCK, y 8 · leer la deuda DESPUES. Invertirlos reintroduce la carrera
  -- que E15 midio: dos liquidaciones de 2000 sobre una deuda de 3000 pasan las
  -- dos y dejan un pendiente de -1000.
  v_lock := array[v_scope];
  if v_correction then
    v_lock := v_lock || sec.debt_scopes_of_version(v_expected);
  end if;
  perform sec.lock_scopes(v_lock);

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
$function$

;
alter function api.record_debt_settlement(jsonb) owner to nomey_writer;

CREATE OR REPLACE FUNCTION api.record_settlement_by_transfer(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_obs uuid[] := '{}'::uuid[]; v_before bigint[];
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
  -- ADR-034 §6: es la barrera que impide mover la CAJA del Modo Personal de
  -- quien salio con una transferencia retro-fechada (medido en E23). Ambos
  -- extremos activos ahora, sea cual sea la fecha.
  perform sec.assert_participant_active(v_debtor,   v_scope);
  perform sec.assert_participant_active(v_creditor, v_scope);

  -- Solo el ambito de la DEUDA entra en el protocolo: los dos Modos Personales
  -- reciben saldo, y el saldo no es deuda. ADR-013 §11 decide la pertenencia
  -- «por que efectos produce», y ninguno de esos dos efectos toca la dimension
  -- de deuda.
  v_lock := array[v_scope];
  v_obs := array[v_from, v_to];
  if v_correction then
    v_obs := v_obs || sec.balance_scopes_of_version(v_expected);
  end if;
  v_lock := v_lock || v_obs;
  if v_correction then
    v_lock := v_lock || sec.debt_scopes_of_version(v_expected);
  end if;
  perform sec.lock_scopes(v_lock);

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

  v_before := sec.balances_before(v_obs);

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

  perform sec.observe_balances(v_version, v_obs, v_before);

  return sec.envelope(v_operation, false);
end
$function$

;
alter function api.record_settlement_by_transfer(jsonb) owner to nomey_writer;

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
  v_scope uuid;
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

  -- AUTORIZACION: la misma que corregir. `data-model.md` §7 la fija como
  -- membresia ACTUAL del ambito, sin mirar quien creo la operacion ni cuando
  -- entro. Se comprueba sobre cada ambito que la version vigente alcanza.
  foreach v_scope in array sec.normalize_scopes(
      sec.balance_scopes_of_version(v_expected) || sec.debt_scopes_of_version(v_expected))
  loop
    perform sec.assert_member(v_scope, v_actor);
  end loop;

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
  perform sec.assert_no_retired_debt(v_expected);
  perform sec.assert_annulment_leaves_no_oversettled_debt(v_expected);

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

  return sec.envelope(v_operation, false);
end
$function$

;
alter function api.annul_operation(jsonb) owner to nomey_writer;

CREATE OR REPLACE FUNCTION api.update_group_profile(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_allowed constant text[] := array[
    'client_command_id', 'command_contract_version', 'scope_id',
    'display_name', 'emoji', 'default_category_id', 'expected_updated_at', 'participants'];
  c_participant_fields constant text[] := array['client_participant_id', 'display_name'];

  v_actor     uuid;
  v_command   uuid;
  v_version   integer;
  v_scope     uuid;
  v_name      text;
  v_emoji     text;
  v_default   uuid;
  v_expected  timestamptz;
  v_parts     jsonb;
  v_intent    jsonb;
  v_stored    jsonb;
  v_replay    boolean := false;
  v_before    core.group_profile%rowtype;
  v_change    uuid;
  v_item      jsonb;
  v_ids       uuid[];
begin
  perform sec.assert_payload_shape(payload, c_allowed);

  v_actor   := sec.request_actor_id();
  v_command := (payload ->> 'client_command_id')::uuid;
  v_version := (payload ->> 'command_contract_version')::integer;
  v_scope   := (payload ->> 'scope_id')::uuid;

  if v_command is null or v_version is null or v_scope is null then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'client_command_id, command_contract_version y scope_id son obligatorios', 400);
  end if;
  if v_version <> 1 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'command_contract_version desconocida', 400);
  end if;

  v_name  := sec.canonical_display_name(payload ->> 'display_name');
  v_emoji := btrim(coalesce(payload ->> 'emoji', ''));
  if v_emoji = '' then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'emoji no puede quedar vacio', 400);
  end if;

  -- La categoria preestablecida: nula es «Todas». Misma regla que el gasto.
  v_default := sec.payload_uuid(payload, 'default_category_id', false);
  if v_default is not null then
    perform sec.assert_shared_category_usable(v_default, null);
  end if;

  v_expected := (payload ->> 'expected_updated_at')::timestamptz;
  if v_expected is null then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'expected_updated_at es obligatorio: declara el perfil que leiste', 400);
  end if;

  v_parts := coalesce(payload -> 'participants', '[]'::jsonb);
  if jsonb_typeof(v_parts) <> 'array' then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'participants debe ser una lista', 400);
  end if;
  for v_item in select value from jsonb_array_elements(v_parts) loop
    perform sec.assert_payload_shape(v_item, c_participant_fields);
    if (v_item ->> 'client_participant_id') is null then
      perform sec.raise_boundary('PAYLOAD_INVALID',
        'cada participante nuevo lleva su client_participant_id', 400);
    end if;
  end loop;

  -- ---------- la autorizacion: ser miembro, y nada mas (ADR-032 §2) ----------
  if not sec.is_member(v_scope) then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no eres miembro de este grupo', 403);
  end if;

  -- ---------- la intencion canonica ----------
  v_intent := jsonb_build_object(
    'scope_id',            v_scope,
    'display_name',        v_name,
    'emoji',               v_emoji,
    'default_category_id', v_default::text,
    'expected_updated_at', v_expected,
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'client_participant_id', p ->> 'client_participant_id',
               'display_name',          sec.canonical_display_name(p ->> 'display_name'))
               order by ord)
        from jsonb_array_elements(v_parts) with ordinality as e(p, ord)
    ), '[]'::jsonb));

  -- ---------- el reclamo de la clave, antes de escribir nada (ADR-033) ----------
  begin
    insert into core.provisioning_command (
      created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'group.update', v_version, v_intent, v_scope);
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
    return sec.group_envelope(v_scope, true);
  end if;

  -- ---------- el CAS, bajo bloqueo de la fila ----------
  select * into v_before from core.group_profile g
   where g.scope_id = v_scope for update;
  if v_before.scope_id is null then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no eres miembro de este grupo', 403);
  end if;
  if v_before.updated_at <> v_expected then
    perform sec.raise_boundary('PROFILE_CONFLICT',
      'otro miembro ha guardado cambios desde que leiste el grupo; recarga', 409);
  end if;

  -- ---------- el historial, ANTES del cambio: si esto falla, nada cambia ----------
  insert into core.group_profile_change (
    scope_id, changed_by, client_command_id, before_profile, after_profile, added_participants)
  values (
    v_scope, v_actor, v_command,
    jsonb_build_object('display_name', v_before.display_name, 'emoji', v_before.emoji,
                       'default_category_id', v_before.default_category_id),
    jsonb_build_object('display_name', v_name,                'emoji', v_emoji,
                       'default_category_id', v_default),
    v_intent -> 'participants')
  returning id into v_change;

  -- ---------- el perfil ----------
  -- `clock_timestamp()` y no `now()`: el testigo del CAS tiene que ser un
  -- instante DISTINTO en cada guardado, y `now()` es el mismo durante toda
  -- una transaccion. Medido con la fixture: dos guardados en una transaccion
  -- daban el mismo `updated_at` y el segundo pisaba al primero sin conflicto.
  update core.group_profile
     set display_name        = v_name,
         emoji               = v_emoji,
         default_category_id = v_default,
         updated_at          = clock_timestamp()
   where scope_id = v_scope;

  -- ---------- las altas: identidad contextual + presencia desde hoy ----------
  for v_item in select value from jsonb_array_elements(v_intent -> 'participants') loop
    begin
      insert into core.participant (id, scope_id, display_name)
      values ((v_item ->> 'client_participant_id')::uuid, v_scope, v_item ->> 'display_name');
    exception when unique_violation then
      perform sec.raise_boundary('PAYLOAD_INVALID',
        'ese client_participant_id ya existe', 409);
    end;
    insert into core.participant_period (participant_id, valid_from, valid_until)
    values ((v_item ->> 'client_participant_id')::uuid, current_date, null);
  end loop;

  -- ---------- el aviso, a todos los miembros, el editor incluido ----------
  perform sec.notify_members(v_scope, 'profile', v_change, v_actor);

  return sec.group_envelope(v_scope, false);
end
$function$

;
alter function api.update_group_profile(jsonb) owner to nomey_provisioner;

-- ═══════════════════════ §1 · salir ═══════════════════════════════════════════

grant delete on core.membership to nomey_provisioner;
create policy membership_provisioner_self_delete on core.membership
  for delete to nomey_provisioner
  using (user_id = sec.request_actor_id());

grant update (valid_until) on core.participant_period to nomey_provisioner;
-- Y leer lo justo para encontrar el periodo abierto: sin SELECT sobre esas
-- columnas el UPDATE con WHERE no puede evaluarse.
grant select (participant_id, valid_from, valid_until) on core.participant_period to nomey_provisioner;
create policy participant_period_provisioner_self_select on core.participant_period
  for select to nomey_provisioner
  using (exists (select 1 from core.participant_user_link l
                  where l.participant_id = participant_period.participant_id
                    and l.user_id = sec.request_actor_id()));
-- Solo el periodo ABIERTO del participante vinculado al propio actor.
create policy participant_period_provisioner_self_close on core.participant_period
  for update to nomey_provisioner
  using (exists (select 1 from core.participant_user_link l
                  where l.participant_id = participant_period.participant_id
                    and l.user_id = sec.request_actor_id()))
  with check (exists (select 1 from core.participant_user_link l
                       where l.participant_id = participant_period.participant_id
                         and l.user_id = sec.request_actor_id()));
grant select on core.participant_user_link to nomey_provisioner;
create policy participant_user_link_provisioner_self_select on core.participant_user_link
  for select to nomey_provisioner
  using (user_id = sec.request_actor_id());

create function api.leave_group(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array['client_command_id', 'command_contract_version', 'scope_id'];
  v_actor       uuid;
  v_command     uuid;
  v_version     integer;
  v_scope       uuid;
  v_intent      jsonb;
  v_stored      jsonb;
  v_replay      boolean := false;
  v_participant uuid;
  v_departure   uuid;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor   := sec.request_actor_id();
  v_command := (payload ->> 'client_command_id')::uuid;
  v_version := (payload ->> 'command_contract_version')::integer;
  v_scope   := (payload ->> 'scope_id')::uuid;
  if v_command is null or v_version is null or v_scope is null then
    perform sec.raise_boundary('PAYLOAD_INVALID',
      'client_command_id, command_contract_version y scope_id son obligatorios', 400);
  end if;
  if v_version <> 1 then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'command_contract_version desconocida', 400);
  end if;

  v_intent := jsonb_build_object('scope_id', v_scope);

  -- El reclamo de la clave ANTES de autorizar (ADR-033, ADR-010 §5): un
  -- reintento tras salir responde replay, no NOT_AUTHORIZED.
  begin
    insert into core.provisioning_command (
      created_by, client_command_id, command_type,
      command_contract_version, canonical_intent, result_scope_id)
    values (v_actor, v_command, 'group.leave', v_version, v_intent, v_scope);
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
    return jsonb_build_object('scope_id', v_scope, 'already_processed', true);
  end if;

  -- La autorizacion: ser miembro, y nada mas (ADR-032 §2). Salir no se aprueba.
  if not sec.is_member(v_scope) then
    perform sec.raise_boundary('NOT_AUTHORIZED', 'no eres miembro de este grupo', 403);
  end if;
  perform sec.assert_scope_kind(v_scope, 'group');

  -- ORDEN, y no es estilo: todo lo que pasa por sec.is_member va ANTES de
  -- borrar la membresia, porque es la del propio actor la que se evalua.

  -- 1 · el participante vinculado al actor en este grupo, si lo hay.
  select l.participant_id into v_participant
    from core.participant_user_link l
    join core.participant p on p.id = l.participant_id
   where l.user_id = v_actor and p.scope_id = v_scope
   limit 1;

  -- 2 · su presencia se cierra HOY, excluido (ADR-034 §5). Creado y salido el
  --     mismo dia deja un periodo vacio, que la restriccion admite.
  if v_participant is not null then
    update core.participant_period
       set valid_until = current_date
     where participant_id = v_participant and valid_until is null;
  end if;

  -- 3 · el hecho, y el aviso a los que se quedan (el actor aun es miembro:
  --     se excluye a si mismo, porque deja de serlo en esta transaccion).
  insert into core.group_departure (scope_id, participant_id, user_id, client_command_id)
  values (v_scope, v_participant, v_actor, v_command)
  returning id into v_departure;
  insert into core.group_notice (recipient_user_id, scope_id, kind, subject_id, actor_user_id)
  select m.user_id, v_scope, 'departure', v_departure, v_actor
    from core.membership m
   where m.scope_id = v_scope and m.user_id <> v_actor
  on conflict (recipient_user_id, kind, subject_id) do nothing;

  -- 4 · y AL FINAL, la membresia. Ni un efecto, ni una operacion, ni un bloqueo.
  delete from core.membership where scope_id = v_scope and user_id = v_actor;

  return jsonb_build_object('scope_id', v_scope, 'already_processed', false);
end
$fn$;

-- ═══════════════════════ §4 · «Saldado» ═══════════════════════════════════════

create function api.settle_participant(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  c_allowed constant text[] := array[
    'client_operation_id', 'command_contract_version', 'scope_id', 'participant_id', 'expected_pairs'];
  c_pair_fields constant text[] := array['debtor_participant_id', 'creditor_participant_id', 'amount'];
  v_actor      uuid;
  v_key        uuid;
  v_contract   integer;
  v_scope      uuid;
  v_target     uuid;
  v_currency   uuid;
  v_expected   text[];
  v_actual     text[];
  v_item       jsonb;
  v_canonical  jsonb;
  v_existing   core.participant_retirement%rowtype;
  v_replay     boolean := false;
  v_operation  uuid;
  v_version    uuid;
  v_correction boolean;
  v_unused     uuid;
  v_total      bigint := 0;
  v_pair       record;
  v_amount     bigint;
begin
  perform sec.assert_payload_shape(payload, c_allowed);
  v_actor    := sec.request_actor_id();
  v_key      := sec.payload_uuid(payload, 'client_operation_id', true);
  v_contract := sec.payload_contract_version(payload);
  v_scope    := sec.payload_uuid(payload, 'scope_id', true);
  v_target   := sec.payload_uuid(payload, 'participant_id', true);

  if jsonb_typeof(payload -> 'expected_pairs') is distinct from 'array' then
    perform sec.raise_boundary('PAYLOAD_INVALID', 'expected_pairs debe ser una lista, aunque este vacia', 400);
  end if;
  v_expected := '{}';
  for v_item in select value from jsonb_array_elements(payload -> 'expected_pairs') loop
    perform sec.assert_payload_shape(v_item, c_pair_fields);
    v_amount := sec.payload_amount(v_item, 'amount');
    if v_amount <= 0 then
      perform sec.raise_boundary('PAYLOAD_INVALID', 'cada par pendiente lleva un importe positivo', 400);
    end if;
    if (sec.payload_uuid(v_item, 'debtor_participant_id', true) <> v_target
        and sec.payload_uuid(v_item, 'creditor_participant_id', true) <> v_target) then
      perform sec.raise_boundary('PAYLOAD_INVALID', 'cada par nombra al participante que se salda', 400);
    end if;
    v_expected := v_expected || (
      (v_item ->> 'debtor_participant_id') || '>' || (v_item ->> 'creditor_participant_id') || ':' || v_amount::text);
    v_total := v_total + v_amount;
  end loop;
  select coalesce(array_agg(x order by x), '{}') into v_expected from unnest(v_expected) x;

  v_canonical := jsonb_build_object(
    'scope_id', v_scope::text, 'participant_id', v_target::text, 'expected_pairs', to_jsonb(v_expected));

  -- La autorizacion: un miembro actual, cualquiera (ADR-032 §2).
  perform sec.assert_scope_kind(v_scope, 'group');
  perform sec.assert_member(v_scope, v_actor);
  if not exists (select 1 from core.participant p where p.id = v_target and p.scope_id = v_scope) then
    perform sec.raise_boundary('PARTICIPANT_NOT_IN_SCOPE', 'el participante no pertenece a este grupo', 422);
  end if;

  -- El bloqueo ANTES de leer la deuda (ADR-013 §11), y antes de mirar el
  -- estado: dos «Saldado» simultaneos se serializan aqui.
  perform sec.lock_scopes(array[v_scope]);

  -- ¿Ya retirado? Con la misma clave es un reintento; con otra, conflicto.
  select * into v_existing from core.participant_retirement r where r.participant_id = v_target;
  if v_existing.participant_id is not null then
    if v_existing.client_command_id = v_key and v_existing.retired_by = v_actor then
      return jsonb_build_object('participant_id', v_target, 'operation_id', v_existing.operation_id,
                                'already_processed', true);
    end if;
    perform sec.raise_boundary('PARTICIPANT_RETIRED', 'este participante ya fue dado por saldado', 409);
  end if;

  -- A un activo no se le salda asi: se le liquida por las vias normales.
  if exists (select 1 from core.participant_period pp where pp.participant_id = v_target and pp.valid_until is null) then
    perform sec.raise_boundary('PARTICIPANT_ACTIVE',
      'el participante sigue en el grupo; «Saldado» es solo para quien salio', 422);
  end if;

  -- Los pares REALES, bajo bloqueo, neteados por par como sec.net_debt.
  v_actual := '{}';
  for v_pair in
    select q.id as other,
           sec.pending_debt(v_scope, v_target, q.id, null) as owes,
           sec.pending_debt(v_scope, q.id, v_target, null) as owed
      from core.participant q
     where q.scope_id = v_scope and q.id <> v_target
  loop
    if v_pair.owes > 0 then
      v_actual := v_actual || (v_target::text || '>' || v_pair.other::text || ':' || v_pair.owes::text);
    end if;
    if v_pair.owed > 0 then
      v_actual := v_actual || (v_pair.other::text || '>' || v_target::text || ':' || v_pair.owed::text);
    end if;
  end loop;
  select coalesce(array_agg(x order by x), '{}') into v_actual from unnest(v_actual) x;

  -- Lo que se confirma es EXACTAMENTE lo que se enseno. Si cambio, no se salda
  -- nada que nadie haya revisado: el cliente relee y vuelve a ensenar.
  if v_actual <> v_expected then
    perform sec.raise_boundary('SETTLEMENT_STALE',
      'los pendientes han cambiado desde que se mostraron; vuelve a revisarlos', 409);
  end if;

  if array_length(v_actual, 1) is not null then
    -- Hay pares: UNA operacion, un efecto de deuda por par. La clave se reclama
    -- en client_command como cualquier clase del writer (ADR-010, ADR-011 §13).
    select s.base_currency_definition_id into v_currency from core.scope s where s.id = v_scope;
    select * into v_replay, v_actor, v_operation, v_version, v_correction, v_unused
      from sec.begin_command(payload, 'participant_settlement', v_canonical);
    if v_replay then
      return jsonb_build_object('participant_id', v_target, 'operation_id', v_operation, 'already_processed', true);
    end if;
    perform sec.persist_version(v_actor, v_operation, v_version, 1, null,
                                'participant_settlement', current_date, v_total, v_currency);
    for v_item in select value from jsonb_array_elements(payload -> 'expected_pairs') loop
      insert into core.effect
        (id, operation_version_id, scope_id, accounting_class, currency_definition_id,
         debt_amount, debt_debtor_participant_id, debt_creditor_participant_id)
      values (gen_random_uuid(), v_version, v_scope, 'settlement', v_currency,
              - sec.payload_amount(v_item, 'amount'),
              (v_item ->> 'debtor_participant_id')::uuid, (v_item ->> 'creditor_participant_id')::uuid);
    end loop;
  end if;

  -- El estado, con o sin operacion: cero pendiente no es una liquidacion de cero.
  insert into core.participant_retirement (participant_id, scope_id, operation_id, retired_by, client_command_id)
  values (v_target, v_scope, v_operation, v_actor, v_key);

  perform sec.notify_members(v_scope, 'settlement', v_key, v_actor);

  return jsonb_build_object('participant_id', v_target, 'operation_id', v_operation, 'already_processed', false);
end
$fn$;

-- ═══════════════════════ propiedad y ejecucion ════════════════════════════════
grant create on schema api to nomey_provisioner, nomey_writer;
alter function api.leave_group(jsonb) owner to nomey_provisioner;
alter function api.settle_participant(jsonb) owner to nomey_writer;
revoke create on schema api from nomey_provisioner, nomey_writer;
revoke execute on function api.leave_group(jsonb), api.settle_participant(jsonb) from public;
grant execute on function api.leave_group(jsonb), api.settle_participant(jsonb) to authenticated;
grant execute on function sec.assert_scope_kind(uuid, text) to nomey_provisioner;
grant execute on function sec.notify_members(uuid, text, uuid, uuid) to nomey_writer, nomey_provisioner;
