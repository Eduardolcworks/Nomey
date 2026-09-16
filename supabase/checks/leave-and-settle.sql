-- ============================================================================
-- ADR-034 · SALIR DE UN GRUPO Y DAR POR SALDADO A QUIEN SALIO
-- (con ADR-038 C5: ya NO se sale con pendientes; y ADR-039 sobre el salido)
-- ============================================================================
--
-- Todo en una transaccion que termina en ROLLBACK, con actores, grupo y gastos
-- de fixture. Ningun dato real se toca. Las secciones siguen el ADR:
--
--   A · catalogo, privilegios y guardias
--   B · Ana NO puede salir DEBIENDO (LEAVE_BLOCKED_DEBT, nada escrito); su
--       salida con pendientes se siembra como ESTADO HEREDADO de ADR-034 (el
--       que tienen los grupos locales anteriores a ADR-038), y sus lecturas
--   C · Luis tampoco sale COBRANDO; heredado igual: Personal conservado con
--       contexto, deuda excluida
--   D · crear y salir el MISMO DIA: periodo vacio, sin inventar ni borrar
--   F · barreras sobre el inactivo, en servidor (alta retro-fechada que lo
--       nombra: DEPARTED_OBLIGATION_CHANGED, ADR-039)
--   G · «Saldado» sobre el heredado: pares, CAS, atomicidad, idempotencia
--   H · barreras sobre el RETIRADO: alta, correccion, anulacion
--   I · retirada SIN operacion cuando no hay pendientes
--   J · el ultimo miembro retira a Marta (sin cuenta, ADR-036) y sale a cero;
--       el grupo desaparece y todo se conserva
\pset pager off
\set ON_ERROR_STOP on
begin;

create function pg_temp.actor(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.super() returns void language sql as $$
  select set_config('role', 'postgres', true);
$$;
create function pg_temp.code(p_msg text) returns text language sql immutable as $$
  select coalesce(substring(p_msg from '[A-Z_]{8,}'), p_msg);
$$;
-- La salida CON pendientes que ADR-034 escribia y que ADR-038 C5 ya rehusa:
-- se siembra como postgres, con las mismas filas que dejaba api.leave_group
-- (presencia cerrada hoy, hecho, avisos a los que se quedan, membresia
-- fuera), porque es el estado que conservan los grupos locales anteriores y
-- sobre el que «Saldado» (api.settle_participant, sin UI) sigue teniendo que
-- funcionar. No es una simulacion de nada nuevo: es el legado.
create function pg_temp.salida_heredada(p_user uuid, p_participant uuid, p_scope uuid, p_command uuid) returns void
language plpgsql as $$
declare v_departure uuid;
begin
  perform pg_temp.super();
  update core.participant_period set valid_until = current_date where participant_id = p_participant and valid_until is null;
  insert into core.group_departure (scope_id, participant_id, user_id, client_command_id)
  values (p_scope, p_participant, p_user, p_command) returning id into v_departure;
  insert into core.group_notice (recipient_user_id, scope_id, kind, subject_id, actor_user_id)
  select m.user_id, p_scope, 'departure', v_departure, p_user from core.membership m where m.scope_id = p_scope and m.user_id <> p_user;
  delete from core.membership where scope_id = p_scope and user_id = p_user;
end $$;
-- Los privilegios por defecto del esquema no dejan ejecutar nada a nadie: las
-- ayudas del check se conceden a mano, igual que la tabla de fixtures.
grant execute on function pg_temp.actor(uuid), pg_temp.super(), pg_temp.code(text), pg_temp.salida_heredada(uuid, uuid, uuid, uuid) to authenticated;

-- ============================ A · catalogo ===================================
do $a$
declare
  fallos text[] := '{}';
  v_n int; v_t text;
begin
  select pg_get_userbyid(p.proowner) into v_t from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname = 'leave_group';
  if v_t is distinct from 'nomey_provisioner' then fallos := array_append(fallos, 'A1 leave_group no es del provisioner: ' || coalesce(v_t,'ausente')); end if;
  select pg_get_userbyid(p.proowner) into v_t from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname = 'settle_participant';
  if v_t is distinct from 'nomey_writer' then fallos := array_append(fallos, 'A1b settle_participant no es del writer: ' || coalesce(v_t,'ausente')); end if;
  if has_function_privilege('anon', 'api.leave_group(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'api.settle_participant(jsonb)', 'EXECUTE') then
    fallos := array_append(fallos, 'A1c anon puede ejecutar salir o saldar');
  end if;

  -- A2 · el provisioner NO BORRA el vinculo (la identidad es permanente,
  -- F10/ADR-002; el borrado de ADR-037 se retiro) y solo lo TERMINA o REACTIVA
  -- el propio (F10/ADR-003, 20260918120000: columnas ended_at y departure_id,
  -- policy self_end); nadie actualiza ni borra una retirada; el writer no borra
  -- membresias.
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'core' and table_name = 'participant_user_link'
     and grantee = 'nomey_provisioner' and privilege_type in ('UPDATE', 'DELETE');
  if v_n <> 0 then fallos := array_append(fallos, 'A2 el provisioner puede actualizar o borrar el vinculo entero'); end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'participant_user_link' and cmd = 'DELETE') then
    fallos := array_append(fallos, 'A2c queda una policy de borrado del vinculo');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'participant_user_link'
                  and policyname = 'participant_user_link_provisioner_self_end' and cmd = 'UPDATE'
                  and qual = '(user_id = sec.request_actor_id())' and with_check = '(user_id = sec.request_actor_id())') then
    fallos := array_append(fallos, 'A2d terminar o reactivar el vinculo por el provisioner no esta acotado al propio');
  end if;
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'core' and table_name = 'participant_retirement'
     and grantee <> 'postgres' and privilege_type in ('UPDATE','DELETE');
  if v_n <> 0 then fallos := array_append(fallos, 'A2b alguien puede deshacer una retirada'); end if;
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'core' and table_name = 'membership'
     and grantee in ('nomey_writer','authenticated') and privilege_type = 'DELETE';
  if v_n <> 0 then fallos := array_append(fallos, 'A2c el writer o el cliente borran membresias'); end if;

  -- A3 · los avisos: una relacion, politica por sec.is_me Y sec.is_member.
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'core' and c.relname in ('group_edit_notice','group_profile_notice');
  if v_n <> 0 then fallos := array_append(fallos, 'A3 siguen existiendo las tablas de aviso por clase'); end if;
  select count(*) into v_n from pg_policy where polrelid = 'core.group_notice'::regclass
     and polname like '%client%'
     and pg_get_expr(polqual, polrelid) like '%sec.is_me(%' and pg_get_expr(polqual, polrelid) like '%sec.is_member(%';
  if v_n <> 2 then fallos := array_append(fallos, format('A3b %s politicas de cliente pasan por is_me e is_member, y son 2', v_n)); end if;
  if pg_get_expr((select polqual from pg_policy where polrelid = 'core.group_notice'::regclass and polname = 'group_notice_client_select'), 'core.group_notice'::regclass)
     like '%sec.request_actor_id()%' then
    fallos := array_append(fallos, 'A3c la politica llama a request_actor_id, que el cliente no puede ejecutar (E23)');
  end if;

  -- A4 · claimed_dimension: membresia en las DOS ramas de deuda, no en la economica.
  select pg_get_functiondef('api.claimed_dimension()'::regprocedure) into v_t;
  select count(*) into v_n from regexp_matches(v_t, 'sec\.is_member\(e\.scope_id\)', 'g');
  if v_n <> 2 then fallos := array_append(fallos, format('A4 claimed_dimension tiene %s condiciones de membresia y son 2', v_n)); end if;
  if split_part(lower(v_t), 'union all', 1) like '%is_member%' then
    fallos := array_append(fallos, 'A4b la rama economica filtra por membresia');
  end if;

  -- A5 · el definer de contexto: sin parametros, cuatro columnas, postgres.
  select pg_get_function_identity_arguments(p.oid) || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text
    into v_t from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'sec' and p.proname = 'my_group_expense_context';
  if v_t is distinct from '|postgres|true' then fallos := array_append(fallos, 'A5 my_group_expense_context mal configurada: ' || coalesce(v_t,'ausente')); end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
       unnest(p.proargnames) with ordinality a(nm, i)
   where n.nspname = 'sec' and p.proname = 'my_group_expense_context' and a.i > 0;
  if v_n <> 4 then fallos := array_append(fallos, format('A5b el definer devuelve %s columnas y son 4', v_n)); end if;

  -- A6 · el periodo vacio es admisible, el negativo no.
  select pg_get_constraintdef(oid) into v_t from pg_constraint where conname = 'participant_period_rango_valido';
  if v_t not like '%>=%' then fallos := array_append(fallos, 'A6 el rango no admite el periodo vacio del mismo dia'); end if;

  if array_length(fallos, 1) is not null then
    raise exception E'A · catalogo:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'A · catalogo, privilegios y guardias: OK';
end
$a$;

-- ============================ fixtures ======================================
-- Edu crea; Ana y Luis reclamados y miembros; Marta sin cuenta; Dani miembro
-- sin gastos (para la retirada sin operacion). E1: Edu paga 1000 entre cuatro
-- (Ana, Luis, Marta deben 250). E2: Luis paga 900 entre Edu, Ana y Luis (300).
-- Posiciones: Edu +450, Ana -550, Luis +350, Marta -250, Dani 0.
create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  'a3400000-0000-4000-8000-0000000000a1'::uuid as edu,
  'a3400000-0000-4000-8000-0000000000b1'::uuid as ana,
  'a3400000-0000-4000-8000-0000000000c1'::uuid as luis,
  'a3400000-0000-4000-8000-0000000000d1'::uuid as dani,
  'a3400000-0000-4000-8000-0000000000e1'::uuid as ajeno,
  'a3400000-0000-4000-8000-000000000010'::uuid as g,
  'a3400000-0000-4000-8000-000000000031'::uuid as p_edu,
  'a3400000-0000-4000-8000-000000000032'::uuid as p_ana,
  'a3400000-0000-4000-8000-000000000033'::uuid as p_luis,
  'a3400000-0000-4000-8000-000000000034'::uuid as p_marta,
  'a3400000-0000-4000-8000-000000000035'::uuid as p_dani,
  null::uuid as e1, null::uuid as e2, null::uuid as cat;
grant select, update on fx to authenticated;

do $f$
declare r fx%rowtype; v_out jsonb; v_cat uuid;
begin
  select * into r from fx;
  perform pg_temp.super();
  select id into v_cat from core.category where message_key = 'category.expense.dining' and owner_user_id is null;
  update fx set cat = v_cat;
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    ('a3400000-0000-4000-8000-0000000000f1', 'personal', r.eur, r.edu),
    ('a3400000-0000-4000-8000-0000000000f2', 'personal', r.eur, r.ana),
    ('a3400000-0000-4000-8000-0000000000f3', 'personal', r.eur, r.luis),
    ('a3400000-0000-4000-8000-0000000000f4', 'personal', r.eur, r.dani),
    ('a3400000-0000-4000-8000-0000000000f5', 'personal', r.eur, r.ajeno);
  insert into core.membership (scope_id, user_id) values
    ('a3400000-0000-4000-8000-0000000000f1', r.edu), ('a3400000-0000-4000-8000-0000000000f2', r.ana),
    ('a3400000-0000-4000-8000-0000000000f3', r.luis), ('a3400000-0000-4000-8000-0000000000f4', r.dani),
    ('a3400000-0000-4000-8000-0000000000f5', r.ajeno);

  perform pg_temp.actor(r.edu);
  v_out := api.create_group(jsonb_build_object(
    'client_command_id', 'a3400000-0000-4000-8000-000000000020'::uuid, 'command_contract_version', 1,
    'client_group_id', r.g, 'display_name', 'ADR-034', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', r.p_edu, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(
      jsonb_build_object('client_participant_id', r.p_ana,   'display_name', 'Ana'),
      jsonb_build_object('client_participant_id', r.p_luis,  'display_name', 'Luis'),
      jsonb_build_object('client_participant_id', r.p_marta, 'display_name', 'Marta'),
      jsonb_build_object('client_participant_id', r.p_dani,  'display_name', 'Dani'))));

  perform pg_temp.super();
  insert into core.participant_user_link (participant_id, scope_id, user_id) values
    (r.p_ana, r.g, r.ana), (r.p_luis, r.g, r.luis), (r.p_dani, r.g, r.dani);
  insert into core.membership (scope_id, user_id) values (r.g, r.ana), (r.g, r.luis), (r.g, r.dani);
  update core.participant_period pp set valid_from = current_date - 10
    from core.participant p where p.id = pp.participant_id and p.scope_id = r.g;

  perform pg_temp.actor(r.edu);
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3400000-0000-4000-8000-000000000041'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '1000',
    'effective_date', (current_date - 3)::text, 'concept', 'Cena E1', 'category_id', v_cat,
    'payer_participant_id', r.p_edu, 'participants', jsonb_build_array(r.p_edu, r.p_ana, r.p_luis, r.p_marta),
    'split_method', jsonb_build_object('kind', 'equal')));
  update fx set e1 = (v_out ->> 'operation_id')::uuid;

  perform pg_temp.actor(r.luis);
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3400000-0000-4000-8000-000000000042'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '900',
    'effective_date', (current_date - 2)::text, 'concept', 'Cena E2', 'category_id', v_cat,
    'payer_participant_id', r.p_luis, 'participants', jsonb_build_array(r.p_edu, r.p_ana, r.p_luis),
    'split_method', jsonb_build_object('kind', 'equal')));
  update fx set e2 = (v_out ->> 'operation_id')::uuid;
  perform pg_temp.super();
end
$f$;

-- ============================ B · Ana no sale debiendo =======================
do $b$
declare
  fallos text[] := '{}';
  r fx%rowtype; v_out jsonb; v_n int; v_t text; v_d date; v_b boolean; v_msg text;
begin
  select * into r from fx;

  perform pg_temp.actor(r.ana);
  select coalesce(string_agg(dimension || ':' || amount, ' ' order by amount), '∅') into v_t
    from api.claimed_dimension() where dimension = 'debt';
  if v_t <> 'debt:-250 debt:-300' then fallos := array_append(fallos, 'B0 la deuda de Ana antes de salir no es -250 -300: ' || v_t); end if;

  -- B1 · salir debiendo 550: REHUSADO (ADR-038 C5), con los pares en details,
  --      y sin escribir nada: ni membresia, ni presencia, ni hecho, ni aviso.
  begin
    perform api.leave_group(jsonb_build_object(
      'client_command_id', 'a3400000-0000-4000-8000-000000000051'::uuid, 'command_contract_version', 1, 'scope_id', r.g));
    fallos := array_append(fallos, 'B1 salir debiendo se acepto');
  exception when others then
    v_msg := sqlerrm;
    if pg_temp.code(v_msg) <> 'LEAVE_BLOCKED_DEBT' then fallos := array_append(fallos, 'B1b salir debiendo: ' || pg_temp.code(v_msg)); end if;
    if jsonb_array_length(((v_msg::json ->> 'details')::jsonb) -> 'pairs') <> 2 then fallos := array_append(fallos, 'B1c details.pairs no trae los 2 pares: ' || v_msg); end if;
  end;
  -- ni el reintento con la misma clave es un replay: la clave no quedo.
  begin
    perform api.leave_group(jsonb_build_object(
      'client_command_id', 'a3400000-0000-4000-8000-000000000051'::uuid, 'command_contract_version', 1, 'scope_id', r.g));
    fallos := array_append(fallos, 'B1d el reintento de una salida rehusada se acepto');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'LEAVE_BLOCKED_DEBT' then fallos := array_append(fallos, 'B1e reintento: ' || pg_temp.code(sqlerrm)); end if;
  end;
  perform pg_temp.super();
  select count(*) into v_n from core.membership where scope_id = r.g and user_id = r.ana;
  if v_n <> 1 then fallos := array_append(fallos, 'B1f la salida rehusada borro la membresia'); end if;
  select count(*) into v_n from core.group_departure where scope_id = r.g;
  if v_n <> 0 then fallos := array_append(fallos, 'B1g la salida rehusada dejo un hecho de salida'); end if;
  select count(*) into v_n from core.group_notice where scope_id = r.g;
  if v_n <> 0 then fallos := array_append(fallos, 'B1h la salida rehusada dejo avisos'); end if;
  select count(*) into v_n from core.provisioning_command where created_by = r.ana and client_command_id = 'a3400000-0000-4000-8000-000000000051';
  if v_n <> 0 then fallos := array_append(fallos, 'B1i la salida rehusada dejo su clave'); end if;

  -- B2 · el estado HEREDADO de ADR-034: Ana salio debiendo antes de ADR-038.
  perform pg_temp.salida_heredada(r.ana, r.p_ana, r.g, 'a3400000-0000-4000-8000-000000000051');

  -- B3 · lo que ese estado tiene: una fila de membresia menos, presencia
  --      cerrada HOY (excluido), el hecho, y el vinculo intacto.
  perform pg_temp.super();
  select count(*) into v_n from core.membership where scope_id = r.g and user_id = r.ana;
  if v_n <> 0 then fallos := array_append(fallos, 'B3 la membresia sigue'); end if;
  select valid_until into v_d from core.participant_period where participant_id = r.p_ana;
  if v_d is distinct from current_date then fallos := array_append(fallos, 'B3b valid_until no es hoy: ' || coalesce(v_d::text,'nulo')); end if;
  select count(*) into v_n from core.group_departure where scope_id = r.g and user_id = r.ana and participant_id = r.p_ana and left_at::date = current_date;
  if v_n <> 1 then fallos := array_append(fallos, 'B3c no hay hecho de salida'); end if;
  select count(*) into v_n from core.participant_user_link where participant_id = r.p_ana;
  if v_n <> 1 then fallos := array_append(fallos, 'B3d el vinculo se toco'); end if;
  select count(*) into v_n from core.participant where id = r.p_ana;
  if v_n <> 1 then fallos := array_append(fallos, 'B3e el participante desaparecio'); end if;
  -- ni un efecto ni una operacion nuevos
  select count(*) into v_n from core.operation o join core.operation_version ov on ov.operation_id = o.id where o.created_at >= now() - interval '1 minute';
  if v_n <> 2 then fallos := array_append(fallos, format('B3f salir dejo %s operaciones y habia 2', v_n)); end if;

  -- B4 · avisos: a Edu, Luis y Dani; NO a Ana.
  select count(*) into v_n from core.group_notice where scope_id = r.g and kind = 'departure';
  if v_n <> 3 then fallos := array_append(fallos, format('B4 %s avisos de salida y son 3', v_n)); end if;
  select count(*) into v_n from core.group_notice where scope_id = r.g and kind = 'departure' and recipient_user_id = r.ana;
  if v_n <> 0 then fallos := array_append(fallos, 'B4b quien sale recibe su propio aviso'); end if;

  -- B5 · lo que Ana ve: nada del grupo, ninguna deuda; sus cuotas siguen.
  perform pg_temp.actor(r.ana);
  select count(*) into v_n from api.group_profile where scope_id = r.g;
  if v_n <> 0 then fallos := array_append(fallos, 'B5 Ana sigue viendo el grupo'); end if;
  select count(*) into v_n from api.group_summary where scope_id = r.g;
  if v_n <> 0 then fallos := array_append(fallos, 'B5b Ana sigue viendo el resumen (Deudas de Inicio)'); end if;
  select count(*) into v_n from api.claimed_dimension() where dimension = 'debt';
  if v_n <> 0 then fallos := array_append(fallos, format('B5c claimed_dimension sigue publicando %s deudas', v_n)); end if;
  select count(*) into v_n from api.claimed_dimension() where dimension = 'economic';
  if v_n <> 2 then fallos := array_append(fallos, format('B5d las cuotas economicas son %s y eran 2', v_n)); end if;
  select api.personal_statistics(current_date - 30, current_date) ->> 'expense_total' into v_t;
  if v_t <> '550' then fallos := array_append(fallos, 'B5e las estadisticas de Ana cambiaron: ' || v_t); end if;
  select count(*) into v_n from api.group_notice where scope_id = r.g;
  if v_n <> 0 then fallos := array_append(fallos, 'B5f Ana sigue viendo avisos del grupo'); end if;

  -- B6 · lo que Edu ve: Ana inactiva, con sus pendientes, y su nombre.
  perform pg_temp.actor(r.edu);
  select is_active, eligible_until, is_retired into v_b, v_d, v_t from api.group_participant where participant_id = r.p_ana;
  if v_b or v_d is distinct from current_date or v_t <> 'false' then
    fallos := array_append(fallos, format('B6 Ana en group_participant: active=%s until=%s retired=%s', v_b, v_d, v_t));
  end if;
  select net_position into v_t from api.group_balance where participant_id = r.p_ana;
  if v_t <> '-550' then fallos := array_append(fallos, 'B6b la deuda de Ana cambio para los demas: ' || coalesce(v_t,'ausente')); end if;
  select count(*) into v_n from api.group_notice where scope_id = r.g and kind = 'departure' and participant_display_name = 'Ana' and not by_me;
  if v_n <> 1 then fallos := array_append(fallos, 'B6c Edu no ve el aviso «Ana ha salido» como authenticated'); end if;
  select participant_count into v_n from api.group_profile where scope_id = r.g;
  if v_n <> 5 then fallos := array_append(fallos, format('B6d participant_count=%s (integer, sin retirados aun)', v_n)); end if;

  if array_length(fallos, 1) is not null then
    raise exception E'B · Ana no sale debiendo (heredado):\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'B · Ana no sale debiendo; estado heredado de ADR-034 y sus lecturas: OK';
end
$b$;

-- ============================ C · Luis sale cobrando =========================
do $c$
declare
  fallos text[] := '{}';
  r fx%rowtype; v_out jsonb; v_n int; v_t text;
begin
  select * into r from fx;
  perform pg_temp.actor(r.luis);
  select group_display_name || '|' || your_share || '|' || balance_amount into v_t
    from api.personal_operation where operation_id = r.e2;
  if v_t <> 'ADR-034|300|-900' then fallos := array_append(fallos, 'C0 la fila de Luis antes de salir: ' || coalesce(v_t,'ausente')); end if;

  -- C0b · cobrando tampoco se sale (ADR-038 C5: por pagar o por cobrar).
  begin
    perform api.leave_group(jsonb_build_object(
      'client_command_id', 'a3400000-0000-4000-8000-000000000053'::uuid, 'command_contract_version', 1, 'scope_id', r.g));
    fallos := array_append(fallos, 'C0b salir cobrando se acepto');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'LEAVE_BLOCKED_DEBT' then fallos := array_append(fallos, 'C0c salir cobrando: ' || pg_temp.code(sqlerrm)); end if;
  end;
  -- y el estado heredado: Luis salio cobrando antes de ADR-038.
  perform pg_temp.salida_heredada(r.luis, r.p_luis, r.g, 'a3400000-0000-4000-8000-000000000053');
  perform pg_temp.actor(r.luis);

  -- C1 · Personal conservado CON contexto: el definer, no la RLS del grupo.
  select group_display_name || '|' || your_share || '|' || balance_amount into v_t
    from api.personal_operation where operation_id = r.e2;
  if v_t is distinct from 'ADR-034|300|-900' then fallos := array_append(fallos, 'C1 la fila de Luis tras salir: ' || coalesce(v_t,'ausente')); end if;
  select balance_amount into v_t from api.personal_balance;
  if v_t <> '-900' then fallos := array_append(fallos, 'C1b el Disponible de Luis cambio: ' || v_t); end if;
  select concept || '|' || category_id::text into v_t from api.personal_operation_version where operation_id = r.e2 and is_current;
  if v_t is distinct from 'Cena E2|' || r.cat::text then fallos := array_append(fallos, 'C1c el historial perdio concepto o categoria'); end if;
  select api.personal_statistics(current_date - 30, current_date) ->> 'expense_total' into v_t;
  if v_t <> '550' then fallos := array_append(fallos, 'C1d las cuotas de Luis cambiaron: ' || v_t); end if;

  -- C2 · la deuda POSITIVA tambien sale del seguimiento.
  select count(*) into v_n from api.claimed_dimension() where dimension = 'debt';
  if v_n <> 0 then fallos := array_append(fallos, format('C2 Luis sigue con %s deudas atribuidas', v_n)); end if;
  select count(*) into v_n from api.group_summary;
  if v_n <> 0 then fallos := array_append(fallos, 'C2b Luis sigue viendo algun resumen de grupo'); end if;

  -- C3 · el contexto solo llega con la fila que ya era mia: Luis tiene UNA fila
  --      de grupo en Personal (E2, que pago) y llega con su contexto; E1 no es
  --      fila suya (no la pago) aunque su cuota cuente en estadisticas. Y el
  --      definer no es alcanzable directamente por el cliente (sin USAGE en sec).
  select count(*) into v_n from api.personal_operation where operation_class = 'group_expense' and group_display_name is not null;
  if v_n <> 1 then fallos := array_append(fallos, format('C3 Luis tiene %s filas de grupo con contexto y es 1', v_n)); end if;
  begin
    perform count(*) from sec.my_group_expense_context();
    fallos := array_append(fallos, 'C3a el cliente llama al definer directamente');
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.actor(r.ajeno);
  select count(*) into v_n from api.personal_operation where operation_class = 'group_expense';
  if v_n <> 0 then fallos := array_append(fallos, 'C3c un ajeno ve gastos de grupo en su Personal'); end if;

  -- C4 · para Edu, las posiciones no se han movido.
  perform pg_temp.actor(r.edu);
  select string_agg(display_name || '=' || net_position, ' ' order by display_name) into v_t from api.group_balance where scope_id = r.g;
  if v_t <> 'Ana=-550 Dani=0 Edu=450 Luis=350 Marta=-250' then fallos := array_append(fallos, 'C4 posiciones: ' || v_t); end if;

  if array_length(fallos, 1) is not null then
    raise exception E'C · Luis sale cobrando:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'C · Luis no sale cobrando; heredado, Personal conservado con contexto: OK';
end
$c$;

-- ============================ D · crear y salir el mismo dia =================
do $d$
declare
  fallos text[] := '{}';
  r fx%rowtype; v_out jsonb; v_n int; v_t text;
  v_g2 uuid := 'a3400000-0000-4000-8000-000000000060';
  v_pz uuid := 'a3400000-0000-4000-8000-000000000061';
  v_pw uuid := 'a3400000-0000-4000-8000-000000000062';
begin
  select * into r from fx;
  perform pg_temp.actor(r.dani);
  v_out := api.create_group(jsonb_build_object(
    'client_command_id', 'a3400000-0000-4000-8000-000000000063'::uuid, 'command_contract_version', 1,
    'client_group_id', v_g2, 'display_name', 'Efimero', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', v_pz, 'creator_display_name', 'Dani',
    'participants', jsonb_build_array(jsonb_build_object('client_participant_id', v_pw, 'display_name', 'Wenceslao'))));
  -- D1 · sale hoy mismo: no falla, no inventa un dia, no borra la presencia.
  begin
    v_out := api.leave_group(jsonb_build_object(
      'client_command_id', 'a3400000-0000-4000-8000-000000000064'::uuid, 'command_contract_version', 1, 'scope_id', v_g2));
  exception when others then
    fallos := array_append(fallos, 'D1 salir el mismo dia fallo: ' || pg_temp.code(sqlerrm));
  end;
  perform pg_temp.super();
  select valid_from::text || '..' || coalesce(valid_until::text, 'abierto') into v_t from core.participant_period where participant_id = v_pz;
  if v_t is distinct from current_date::text || '..' || current_date::text then fallos := array_append(fallos, 'D1b el periodo del creador: ' || coalesce(v_t,'BORRADO')); end if;
  select count(*) into v_n from core.membership where scope_id = v_g2;
  if v_n <> 0 then fallos := array_append(fallos, 'D1c queda membresia'); end if;
  select count(*) into v_n from core.group_profile where scope_id = v_g2;
  if v_n <> 1 then fallos := array_append(fallos, 'D1d el perfil desaparecio'); end if;
  -- D2 · nadie es elegible en ese periodo vacio: la regla de siempre lo dice.
  select count(*) into v_n from core.participant_period pp where pp.participant_id = v_pz
     and pp.valid_from <= current_date and (pp.valid_until is null or current_date < pp.valid_until);
  if v_n <> 0 then fallos := array_append(fallos, 'D2 el periodo vacio hace elegible hoy'); end if;
  -- D3 · y el grupo, sin miembros, no lo ve nadie: ni su creador.
  perform pg_temp.actor(r.dani);
  select count(*) into v_n from api.group_profile where scope_id = v_g2;
  if v_n <> 0 then fallos := array_append(fallos, 'D3 el creador sigue viendo el grupo que abandono'); end if;

  if array_length(fallos, 1) is not null then
    raise exception E'D · mismo dia:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'D · crear y salir el mismo dia, periodo vacio sin inventar ni borrar: OK';
end
$d$;

-- ============================ F · barreras sobre el inactivo =================
do $g$
declare
  fallos text[] := '{}';
  r fx%rowtype; v_out jsonb; v_n int; v_t text; v_v1 uuid;
begin
  select * into r from fx;
  perform pg_temp.actor(r.edu);

  -- F1 · gasto nuevo con Ana: ayer, dentro de su presencia, lo rehusa ADR-039
  --      (le atribuiria deuda nueva a quien salio); hoy y manana, no elegible.
  foreach v_t in array array[(current_date - 1)::text, current_date::text, (current_date + 1)::text] loop
    begin
      perform api.record_group_expense(jsonb_build_object(
        'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
        'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '300', 'effective_date', v_t,
        'concept', 'Sonda', 'category_id', r.cat, 'payer_participant_id', r.p_edu,
        'participants', jsonb_build_array(r.p_edu, r.p_ana), 'split_method', jsonb_build_object('kind', 'equal')));
      fallos := array_append(fallos, 'F1 gasto con Ana fechado ' || v_t || ' aceptado');
    exception when others then
      if pg_temp.code(sqlerrm) <> (case when v_t = (current_date - 1)::text then 'DEPARTED_OBLIGATION_CHANGED' else 'PARTICIPANT_NOT_ELIGIBLE' end) then
        fallos := array_append(fallos, 'F1b gasto con Ana fechado ' || v_t || ': ' || pg_temp.code(sqlerrm));
      end if;
    end;
  end loop;
  perform pg_temp.super();
  select count(*) into v_n from core.operation o where o.operation_class = 'group_expense'
    and exists (select 1 from core.movement_detail md join core.operation_version ov on ov.id = md.operation_version_id where ov.operation_id = o.id and md.concept = 'Sonda');
  if v_n <> 0 then fallos := array_append(fallos, 'F1c un alta rehusada dejo operacion'); end if;
  perform pg_temp.actor(r.edu);

  -- F2 · liquidaciones con un inactivo: NUNCA, ni retro-fechadas. Es la
  --      barrera que impide mover la caja de quien salio (E23).
  foreach v_t in array array['record_debt_settlement', 'record_settlement_by_transfer'] loop
    begin
      -- La sin caja: Edu cobra a Ana (inactiva). La de transferencia exige que
      -- el actor sea quien paga: Edu (debe 50 a Luis) paga a Luis (inactivo);
      -- sin la barrera entraria caja en el Personal de Luis, que ya salio.
      execute format('select api.%I($1)', v_t) using jsonb_build_object(
        'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
        case when v_t = 'record_debt_settlement' then 'scope_id' else 'debt_scope_id' end, r.g,
        'currency_definition_id', r.eur, 'amount', '50',
        'effective_date', (current_date - 5)::text,
        'debtor_participant_id',   case when v_t = 'record_debt_settlement' then r.p_ana else r.p_edu end,
        'creditor_participant_id', case when v_t = 'record_debt_settlement' then r.p_edu else r.p_luis end);
      fallos := array_append(fallos, 'F2 ' || v_t || ' con Ana retro-fechada se acepto');
    exception when others then
      if pg_temp.code(sqlerrm) <> 'PARTICIPANT_INACTIVE' then fallos := array_append(fallos, 'F2b ' || v_t || ': ' || pg_temp.code(sqlerrm)); end if;
    end;
  end loop;
  perform pg_temp.super();
  select count(*) into v_n from core.current_effect e where e.scope_id = 'a3400000-0000-4000-8000-0000000000f3' and e.balance_amount is not null;
  if v_n <> 1 then fallos := array_append(fallos, format('F2c el Personal de Luis tiene %s efectos de caja y era 1 (E2)', v_n)); end if;

  -- F3 · corregir E1 sin mover fechas: permitido (Ana inactiva, no retirada).
  select current_version_id into v_v1 from core.operation where id = r.e1;
  perform pg_temp.actor(r.edu);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', 'a3400000-0000-4000-8000-000000000071'::uuid, 'command_contract_version', 1,
      'operation_id', r.e1, 'expected_version_id', v_v1,
      'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '1000', 'effective_date', (current_date - 3)::text,
      'concept', 'Cena E1 (concepto)', 'category_id', r.cat, 'payer_participant_id', r.p_edu,
      'participants', jsonb_build_array(r.p_edu, r.p_ana, r.p_luis, r.p_marta), 'split_method', jsonb_build_object('kind', 'equal')));
  exception when others then
    fallos := array_append(fallos, 'F3 corregir el concepto de E1 con Ana inactiva: ' || pg_temp.code(sqlerrm));
  end;
  -- F3b · moverlo al dia de salida la saca del periodo: rechazado, y nada borrado.
  perform pg_temp.super();
  select current_version_id into v_v1 from core.operation where id = r.e1;
  perform pg_temp.actor(r.edu);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'operation_id', r.e1, 'expected_version_id', v_v1,
      'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '1000', 'effective_date', current_date::text,
      'concept', 'Cena E1', 'category_id', r.cat, 'payer_participant_id', r.p_edu,
      'participants', jsonb_build_array(r.p_edu, r.p_ana, r.p_luis, r.p_marta), 'split_method', jsonb_build_object('kind', 'equal')));
    fallos := array_append(fallos, 'F3b mover E1 al dia de salida se acepto');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'PARTICIPANT_NOT_ELIGIBLE' then fallos := array_append(fallos, 'F3c: ' || pg_temp.code(sqlerrm)); end if;
  end;

  -- F4 · Luis, sin membresia, no toca nada: ni su propio gasto.
  perform pg_temp.actor(r.luis);
  begin
    perform api.settle_participant(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'scope_id', r.g, 'participant_id', r.p_ana, 'expected_pairs', '[]'::jsonb));
    fallos := array_append(fallos, 'F4 quien salio puede saldar');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'NOT_AUTHORIZED' then fallos := array_append(fallos, 'F4b: ' || pg_temp.code(sqlerrm)); end if;
  end;

  if array_length(fallos, 1) is not null then
    raise exception E'F · barreras sobre el inactivo:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'F · barreras sobre el inactivo, en servidor: OK';
end
$g$;

-- ============================ G · «Saldado» sobre Ana ========================
do $h$
declare
  fallos text[] := '{}';
  r fx%rowtype; v_out jsonb; v_n int; v_t text; v_pairs jsonb; v_op uuid;
  v_ops_antes int; v_eff_antes int;
begin
  select * into r from fx;
  perform pg_temp.actor(r.edu);

  -- G1 · lo que la confirmacion ensena: los pares de Ana, neteados por par.
  select jsonb_agg(jsonb_build_object('debtor_participant_id', debtor_participant_id,
                                      'creditor_participant_id', creditor_participant_id, 'amount', amount)
                   order by amount) into v_pairs
    from api.group_pending_pair where scope_id = r.g and (debtor_participant_id = r.p_ana or creditor_participant_id = r.p_ana);
  if jsonb_array_length(v_pairs) <> 2 then fallos := array_append(fallos, 'G1 Ana tiene ' || jsonb_array_length(v_pairs) || ' pares y son 2: ' || v_pairs::text); end if;
  select string_agg(amount, ' ' order by amount) into v_t from api.group_pending_pair where scope_id = r.g and debtor_participant_id = r.p_ana;
  if v_t <> '250 300' then fallos := array_append(fallos, 'G1b los importes de los pares de Ana: ' || v_t); end if;

  perform pg_temp.super();
  select count(*) into v_ops_antes from core.operation;
  select count(*) into v_eff_antes from core.effect;
  perform pg_temp.actor(r.edu);

  -- G2 · CADUCADA: si lo confirmado no es lo que hay, nada se escribe.
  begin
    perform api.settle_participant(jsonb_build_object(
      'client_operation_id', 'a3400000-0000-4000-8000-000000000081'::uuid, 'command_contract_version', 1,
      'scope_id', r.g, 'participant_id', r.p_ana,
      'expected_pairs', jsonb_build_array(jsonb_build_object('debtor_participant_id', r.p_ana, 'creditor_participant_id', r.p_edu, 'amount', '250'))));
    fallos := array_append(fallos, 'G2 una confirmacion con un par de menos se acepto');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'SETTLEMENT_STALE' then fallos := array_append(fallos, 'G2b: ' || pg_temp.code(sqlerrm)); end if;
  end;
  perform pg_temp.super();
  select count(*) - v_ops_antes into v_n from core.operation;
  if v_n <> 0 then fallos := array_append(fallos, 'G2c la confirmacion caducada dejo una operacion'); end if;
  select count(*) into v_n from core.participant_retirement where participant_id = r.p_ana;
  if v_n <> 0 then fallos := array_append(fallos, 'G2d la confirmacion caducada retiro a Ana'); end if;

  -- G3 · actor AJENO: rechazado antes de tocar nada. Y un miembro ACTIVO no se salda asi.
  perform pg_temp.actor(r.ajeno);
  begin
    perform api.settle_participant(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'scope_id', r.g, 'participant_id', r.p_ana, 'expected_pairs', v_pairs));
    fallos := array_append(fallos, 'G3 un ajeno salda');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'NOT_AUTHORIZED' then fallos := array_append(fallos, 'G3b: ' || pg_temp.code(sqlerrm)); end if;
  end;
  perform pg_temp.actor(r.edu);
  begin
    perform api.settle_participant(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'scope_id', r.g, 'participant_id', r.p_dani, 'expected_pairs', '[]'::jsonb));
    fallos := array_append(fallos, 'G3c se saldo a un miembro activo');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'PARTICIPANT_ACTIVE' then fallos := array_append(fallos, 'G3d: ' || pg_temp.code(sqlerrm)); end if;
  end;

  -- G4 · la buena: los dos pares, en UNA operacion.
  v_out := api.settle_participant(jsonb_build_object(
    'client_operation_id', 'a3400000-0000-4000-8000-000000000082'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'participant_id', r.p_ana, 'expected_pairs', v_pairs));
  v_op := (v_out ->> 'operation_id')::uuid;
  if v_op is null or (v_out ->> 'already_processed') <> 'false' then fallos := array_append(fallos, 'G4 respuesta: ' || v_out::text); end if;

  perform pg_temp.super();
  select count(*) - v_ops_antes into v_n from core.operation;
  if v_n <> 1 then fallos := array_append(fallos, format('G4b %s operaciones nuevas y es 1', v_n)); end if;
  select operation_class into v_t from core.operation where id = v_op;
  if v_t <> 'participant_settlement' then fallos := array_append(fallos, 'G4c clase: ' || v_t); end if;
  -- solo dimension de deuda: ni caja ni gasto economico, un efecto por par
  select count(*) into v_n from core.effect e join core.operation_version ov on ov.id = e.operation_version_id
   where ov.operation_id = v_op and (e.balance_amount is not null or e.economic_amount is not null);
  if v_n <> 0 then fallos := array_append(fallos, 'G4d «Saldado» escribio caja o gasto'); end if;
  select count(*) into v_n from core.effect e join core.operation_version ov on ov.id = e.operation_version_id
   where ov.operation_id = v_op and e.debt_amount is not null and e.accounting_class = 'settlement';
  if v_n <> 2 then fallos := array_append(fallos, format('G4e %s efectos de deuda y son 2', v_n)); end if;
  select count(*) into v_n from core.participant_retirement where participant_id = r.p_ana and operation_id = v_op and retired_by = r.edu;
  if v_n <> 1 then fallos := array_append(fallos, 'G4f falta la retirada con su operacion y su autor'); end if;
  -- el importe declarado de la version es la suma de los pares
  select original_amount::text into v_t from core.operation_version where operation_id = v_op;
  if v_t <> '550' then fallos := array_append(fallos, 'G4g importe de la resolucion: ' || v_t); end if;

  -- G5 · posiciones: Edu +200, Luis +50, Marta -250, Dani 0; Ana fuera; suma 0.
  perform pg_temp.actor(r.edu);
  select string_agg(display_name || '=' || net_position, ' ' order by display_name) into v_t from api.group_balance where scope_id = r.g;
  if v_t <> 'Dani=0 Edu=200 Luis=50 Marta=-250' then fallos := array_append(fallos, 'G5 posiciones: ' || v_t); end if;
  select sum(net_position::bigint) into v_n from api.group_balance where scope_id = r.g;
  if v_n <> 0 then fallos := array_append(fallos, format('G5b la suma de posiciones es %s', v_n)); end if;
  perform pg_temp.super();
  select count(*) into v_n from api.group_pending_pair where scope_id = r.g and (debtor_participant_id = r.p_ana or creditor_participant_id = r.p_ana);
  if v_n <> 0 then fallos := array_append(fallos, 'G5d Ana conserva pares pendientes'); end if;
  perform pg_temp.actor(r.edu);
  select is_retired::text || '|' || display_name into v_t from api.group_participant where participant_id = r.p_ana;
  if v_t <> 'true|Ana' then fallos := array_append(fallos, 'G5e Ana en group_participant: ' || v_t); end if;
  -- el nombre sigue en los movimientos: E1 la lleva en su reparto
  select count(*) into v_n from api.group_split_participant sp join api.group_operation go on go.version_id = sp.version_id
   where go.operation_id = r.e1 and sp.participant_id = r.p_ana;
  if v_n <> 1 then fallos := array_append(fallos, 'G5f Ana desaparecio del reparto historico de E1'); end if;
  select count(*) into v_n from api.group_notice where scope_id = r.g and kind = 'settlement' and participant_display_name = 'Ana' and by_me;
  if v_n <> 1 then fallos := array_append(fallos, 'G5g Edu no ve el aviso de «Saldado»'); end if;
  perform pg_temp.super();
  select count(*) into v_n from core.group_notice where scope_id = r.g and kind = 'settlement';
  if v_n <> 2 then fallos := array_append(fallos, format('G5h %s avisos de saldado y son 2 (Edu y Dani)', v_n)); end if;

  -- G6 · nada en el Personal de Ana: ni caja, ni fila, ni deuda, ni cuota nueva.
  perform pg_temp.actor(r.ana);
  select balance_amount into v_t from api.personal_balance;
  if v_t <> '0' then fallos := array_append(fallos, 'G6 el Disponible de Ana se movio: ' || v_t); end if;
  select count(*) into v_n from api.personal_operation;
  if v_n <> 0 then fallos := array_append(fallos, format('G6b Ana tiene %s filas en Personal', v_n)); end if;
  select count(*) into v_n from api.claimed_dimension() where dimension = 'debt';
  if v_n <> 0 then fallos := array_append(fallos, 'G6c la deuda de Ana reaparecio'); end if;
  select api.personal_statistics(current_date - 30, current_date) ->> 'expense_total' into v_t;
  if v_t <> '550' then fallos := array_append(fallos, 'G6d las cuotas de Ana cambiaron: ' || v_t); end if;

  -- G7 · idempotencia: misma clave → replay sin segunda operacion; otra clave → ya retirada.
  perform pg_temp.actor(r.edu);
  v_out := api.settle_participant(jsonb_build_object(
    'client_operation_id', 'a3400000-0000-4000-8000-000000000082'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'participant_id', r.p_ana, 'expected_pairs', v_pairs));
  if (v_out ->> 'already_processed') <> 'true' or (v_out ->> 'operation_id')::uuid <> v_op then fallos := array_append(fallos, 'G7 el reintento no fue replay: ' || v_out::text); end if;
  begin
    perform api.settle_participant(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'scope_id', r.g, 'participant_id', r.p_ana, 'expected_pairs', '[]'::jsonb));
    fallos := array_append(fallos, 'G7b se saldo dos veces');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'PARTICIPANT_RETIRED' then fallos := array_append(fallos, 'G7c: ' || pg_temp.code(sqlerrm)); end if;
  end;
  perform pg_temp.super();
  select count(*) - v_ops_antes into v_n from core.operation;
  if v_n <> 1 then fallos := array_append(fallos, format('G7d tras los reintentos hay %s operaciones nuevas', v_n)); end if;

  if array_length(fallos, 1) is not null then
    raise exception E'G · Saldado:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'G · «Saldado» sobre Ana: pares, CAS, atomicidad, idempotencia, actor ajeno: OK';
end
$h$;

-- ============================ H · barreras sobre el retirado =================
do $i$
declare
  fallos text[] := '{}';
  r fx%rowtype; v_out jsonb; v_n int; v_t text; v_v1 uuid; v_ops int;
begin
  select * into r from fx;
  perform pg_temp.super();
  select count(*) into v_ops from core.operation;
  select current_version_id into v_v1 from core.operation where id = r.e1;
  perform pg_temp.actor(r.edu);

  -- H1 · alta retro-fechada que la nombra: rechazada.
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '300', 'effective_date', (current_date - 4)::text,
      'concept', 'Retro', 'category_id', r.cat, 'payer_participant_id', r.p_edu,
      'participants', jsonb_build_array(r.p_edu, r.p_ana), 'split_method', jsonb_build_object('kind', 'equal')));
    fallos := array_append(fallos, 'H1 un alta con la retirada se acepto');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'PARTICIPANT_RETIRED' then fallos := array_append(fallos, 'H1b: ' || pg_temp.code(sqlerrm)); end if;
  end;

  -- H2 · corregir E1 cambiando el importe (su deuda cambiaria): rechazada.
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'operation_id', r.e1, 'expected_version_id', v_v1,
      'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '1200', 'effective_date', (current_date - 3)::text,
      'concept', 'Cena E1', 'category_id', r.cat, 'payer_participant_id', r.p_edu,
      'participants', jsonb_build_array(r.p_edu, r.p_ana, r.p_luis, r.p_marta), 'split_method', jsonb_build_object('kind', 'equal')));
    fallos := array_append(fallos, 'H2 cambiar el importe de E1 con Ana retirada se acepto');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'PARTICIPANT_RETIRED' then fallos := array_append(fallos, 'H2b: ' || pg_temp.code(sqlerrm)); end if;
  end;
  -- H2c · quitarla del reparto tambien: su deuda pasaria de 250 a nada.
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'operation_id', r.e1, 'expected_version_id', v_v1,
      'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '1000', 'effective_date', (current_date - 3)::text,
      'concept', 'Cena E1', 'category_id', r.cat, 'payer_participant_id', r.p_edu,
      'participants', jsonb_build_array(r.p_edu, r.p_luis, r.p_marta), 'split_method', jsonb_build_object('kind', 'equal')));
    fallos := array_append(fallos, 'H2c quitar a Ana del reparto se acepto');
  exception when others then
    -- quitarla del reparto deja su par con Edu sobreliquidado: el invariante
    -- de ADR-013 lo refusa antes; las dos puertas estan cerradas.
    if pg_temp.code(sqlerrm) not in ('PARTICIPANT_RETIRED','SETTLEMENT_EXCEEDS_DEBT') then fallos := array_append(fallos, 'H2d: ' || pg_temp.code(sqlerrm)); end if;
  end;
  perform pg_temp.super();
  select count(*) into v_n from core.operation_version where operation_id = r.e1;
  if v_n <> 2 then fallos := array_append(fallos, format('H2e un rechazo dejo version: E1 tiene %s', v_n)); end if;
  perform pg_temp.actor(r.edu);

  -- H3 · lo NO financiero sigue permitido: concepto, categoria, hora.
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'operation_id', r.e1, 'expected_version_id', v_v1,
      'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '1000', 'effective_date', (current_date - 3)::text,
      'effective_time', '21:30', 'concept', 'Cena E1, la de la playa', 'category_id', r.cat, 'payer_participant_id', r.p_edu,
      'participants', jsonb_build_array(r.p_edu, r.p_ana, r.p_luis, r.p_marta), 'split_method', jsonb_build_object('kind', 'equal')));
  exception when others then
    fallos := array_append(fallos, 'H3 cambiar concepto y hora de E1 con Ana retirada: ' || pg_temp.code(sqlerrm));
  end;

  -- H4 · anular E1 (deja deuda con Ana, retirada; y cambia lo de Luis, que
  --      salio): rechazada por la guarda del retirado, que va primero.
  perform pg_temp.super();
  select current_version_id into v_v1 from core.operation where id = r.e1;
  perform pg_temp.actor(r.edu);
  begin
    perform api.annul_operation(jsonb_build_object('client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'operation_id', r.e1, 'expected_version_id', v_v1));
    fallos := array_append(fallos, 'H4 anular E1 con Ana retirada se acepto');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'PARTICIPANT_RETIRED' then fallos := array_append(fallos, 'H4b: ' || pg_temp.code(sqlerrm)); end if;
  end;

  -- H5 · las posiciones no se han movido con nada de esto.
  select string_agg(display_name || '=' || net_position, ' ' order by display_name) into v_t from api.group_balance where scope_id = r.g;
  if v_t <> 'Dani=0 Edu=200 Luis=50 Marta=-250' then fallos := array_append(fallos, 'H5 posiciones: ' || v_t); end if;

  if array_length(fallos, 1) is not null then
    raise exception E'H · barreras sobre el retirado:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'H · el retirado no vuelve a adquirir deuda; lo no financiero sigue: OK';
end
$i$;

-- ============================ I · retirada sin operacion =====================
do $j$
declare
  fallos text[] := '{}';
  r fx%rowtype; v_out jsonb; v_n int; v_t text; v_ops int; v_pairs jsonb;
begin
  select * into r from fx;
  -- Luis salio cobrando: sus pares ahora son solo Edu→Luis 50 (Ana ya retirada).
  perform pg_temp.actor(r.edu);
  select jsonb_agg(jsonb_build_object('debtor_participant_id', debtor_participant_id,
                                      'creditor_participant_id', creditor_participant_id, 'amount', amount)) into v_pairs
    from api.group_pending_pair where scope_id = r.g and (debtor_participant_id = r.p_luis or creditor_participant_id = r.p_luis);
  if jsonb_array_length(v_pairs) <> 1 or (v_pairs -> 0 ->> 'amount') <> '50' then fallos := array_append(fallos, 'I0 los pares de Luis: ' || v_pairs::text); end if;
  v_out := api.settle_participant(jsonb_build_object(
    'client_operation_id', 'a3400000-0000-4000-8000-000000000091'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'participant_id', r.p_luis, 'expected_pairs', v_pairs));
  select string_agg(display_name || '=' || net_position, ' ' order by display_name) into v_t from api.group_balance where scope_id = r.g;
  if v_t <> 'Dani=0 Edu=250 Marta=-250' then fallos := array_append(fallos, 'I0b posiciones tras saldar a Luis: ' || v_t); end if;
  -- y en el Personal de Luis, nada: E2 sigue, su Disponible sigue.
  perform pg_temp.actor(r.luis);
  select group_display_name || '|' || your_share || '|' || balance_amount into v_t from api.personal_operation where operation_id = r.e2;
  if v_t is distinct from 'ADR-034|300|-900' then fallos := array_append(fallos, 'I0c la fila de Luis tras saldarlo: ' || coalesce(v_t,'ausente')); end if;
  select balance_amount into v_t from api.personal_balance;
  if v_t <> '-900' then fallos := array_append(fallos, 'I0d el Disponible de Luis se movio: ' || v_t); end if;

  -- I1 · Dani sale a cero, y se le retira SIN operacion.
  perform pg_temp.actor(r.dani);
  v_out := api.leave_group(jsonb_build_object(
    'client_command_id', 'a3400000-0000-4000-8000-000000000092'::uuid, 'command_contract_version', 1, 'scope_id', r.g));
  perform pg_temp.super();
  select count(*) into v_ops from core.operation;
  perform pg_temp.actor(r.edu);
  v_out := api.settle_participant(jsonb_build_object(
    'client_operation_id', 'a3400000-0000-4000-8000-000000000093'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'participant_id', r.p_dani, 'expected_pairs', '[]'::jsonb));
  if (v_out ->> 'operation_id') is not null or (v_out ->> 'already_processed') <> 'false' then fallos := array_append(fallos, 'I1 respuesta: ' || v_out::text); end if;
  perform pg_temp.super();
  select count(*) - v_ops into v_n from core.operation;
  if v_n <> 0 then fallos := array_append(fallos, 'I1b la retirada a cero fabrico una operacion'); end if;
  select count(*) into v_n from core.participant_retirement where participant_id = r.p_dani and operation_id is null and retired_by = r.edu;
  if v_n <> 1 then fallos := array_append(fallos, 'I1c falta la retirada sin operacion'); end if;
  -- I2 · idempotente tambien por ese camino.
  perform pg_temp.actor(r.edu);
  v_out := api.settle_participant(jsonb_build_object(
    'client_operation_id', 'a3400000-0000-4000-8000-000000000093'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'participant_id', r.p_dani, 'expected_pairs', '[]'::jsonb));
  if (v_out ->> 'already_processed') <> 'true' then fallos := array_append(fallos, 'I2 el reintento a cero no fue replay'); end if;
  begin
    perform api.settle_participant(jsonb_build_object(
      'client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
      'scope_id', r.g, 'participant_id', r.p_dani, 'expected_pairs', '[]'::jsonb));
    fallos := array_append(fallos, 'I2b se retiro dos veces');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'PARTICIPANT_RETIRED' then fallos := array_append(fallos, 'I2c: ' || pg_temp.code(sqlerrm)); end if;
  end;
  select count(*) into v_n from api.group_balance where scope_id = r.g;
  if v_n <> 2 then fallos := array_append(fallos, format('I3 Saldos lista %s y son 2 (Edu, Marta)', v_n)); end if;
  select count(*) into v_n from api.group_participant where scope_id = r.g;
  if v_n <> 5 then fallos := array_append(fallos, format('I3b group_participant publica %s y son 5: los retirados siguen con nombre', v_n)); end if;
  select participant_count into v_n from api.group_profile where scope_id = r.g;
  if v_n <> 2 then fallos := array_append(fallos, format('I3c participant_count=%s y son 2 (Edu, Marta): los retirados no cuentan', v_n)); end if;

  if array_length(fallos, 1) is not null then
    raise exception E'I · retirada sin operacion:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'I · Luis saldado con un par; Dani retirado a cero sin operacion, idempotente: OK';
end
$j$;

-- ============================ J · el ultimo miembro ==========================
do $k$
declare
  fallos text[] := '{}';
  r fx%rowtype; v_out jsonb; v_n int; v_ops int; v_eff int; v_parts int;
begin
  select * into r from fx;
  perform pg_temp.super();
  select count(*) into v_ops from core.operation o join core.operation_version ov on ov.operation_id = o.id
    join core.effect e on e.operation_version_id = ov.id where e.scope_id = r.g;
  select count(*) into v_eff from core.effect where scope_id = r.g;
  select count(*) into v_parts from core.participant where scope_id = r.g;

  -- Edu es el ultimo con membresia, pero Marta (sin cuenta) le debe 250: no
  -- sale con ese par (ADR-038 C5 / C7); la retira (ADR-036) y entonces sale.
  perform pg_temp.actor(r.edu);
  begin
    perform api.leave_group(jsonb_build_object(
      'client_command_id', 'a3400000-0000-4000-8000-0000000000a0'::uuid, 'command_contract_version', 1, 'scope_id', r.g));
    fallos := array_append(fallos, 'J0 el ultimo salio con un par pendiente con Marta');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'LEAVE_BLOCKED_DEBT' then fallos := array_append(fallos, 'J0b: ' || pg_temp.code(sqlerrm)); end if;
  end;
  v_out := api.retire_participant(jsonb_build_object(
    'client_operation_id', 'a3400000-0000-4000-8000-0000000000a2'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'participant_id', r.p_marta,
    'expected_pairs', (select coalesce(jsonb_agg(jsonb_build_object('debtor_participant_id', debtor_participant_id,
                         'creditor_participant_id', creditor_participant_id, 'amount', amount)), '[]'::jsonb)
                         from api.group_pending_pair where scope_id = r.g and (debtor_participant_id = r.p_marta or creditor_participant_id = r.p_marta))));
  perform pg_temp.super();
  select count(*) into v_ops from core.operation o join core.operation_version ov on ov.operation_id = o.id
    join core.effect e on e.operation_version_id = ov.id where e.scope_id = r.g;
  select count(*) into v_eff from core.effect where scope_id = r.g;
  perform pg_temp.actor(r.edu);
  v_out := api.leave_group(jsonb_build_object(
    'client_command_id', 'a3400000-0000-4000-8000-0000000000a1'::uuid, 'command_contract_version', 1, 'scope_id', r.g));
  select count(*) into v_n from api.group_profile where scope_id = r.g;
  if v_n <> 0 then fallos := array_append(fallos, 'J1 el ultimo en salir sigue viendo el grupo'); end if;

  perform pg_temp.super();
  select count(*) into v_n from core.membership where scope_id = r.g;
  if v_n <> 0 then fallos := array_append(fallos, 'J1b queda membresia'); end if;
  if (select count(*) from core.participant where scope_id = r.g) <> v_parts
     or (select count(*) from core.effect where scope_id = r.g) <> v_eff
     or (select count(*) from core.group_profile where scope_id = r.g) <> 1
     or (select count(*) from core.scope where id = r.g) <> 1
     or (select count(*) from core.participant_user_link where scope_id = r.g) <> 4
     or (select count(*) from core.participant_period pp join core.participant p on p.id = pp.participant_id where p.scope_id = r.g) <> 5 then
    fallos := array_append(fallos, 'J2 algo se borro al salir el ultimo');
  end if;
  select count(*) into v_n from core.group_departure where scope_id = r.g;
  if v_n <> 4 then fallos := array_append(fallos, format('J2b %s salidas registradas y son 4', v_n)); end if;
  -- el ultimo no avisa a nadie: no queda nadie
  select count(*) into v_n from core.group_notice where scope_id = r.g and kind = 'departure' and subject_id = (select id from core.group_departure where user_id = r.edu and scope_id = r.g);
  if v_n <> 0 then fallos := array_append(fallos, 'J2c la ultima salida genero avisos'); end if;

  -- J3 · y cada antiguo miembro conserva su Personal con contexto.
  perform pg_temp.actor(r.luis);
  select count(*) into v_n from api.personal_operation where operation_id = r.e2 and group_display_name = 'ADR-034';
  if v_n <> 1 then fallos := array_append(fallos, 'J3 Luis perdio el contexto de E2 al vaciarse el grupo'); end if;
  perform pg_temp.actor(r.edu);
  select count(*) into v_n from api.personal_operation where operation_id = r.e1 and group_display_name = 'ADR-034' and your_share = '250';
  if v_n <> 1 then fallos := array_append(fallos, 'J3b Edu perdio el contexto de E1'); end if;
  select count(*) into v_n from api.claimed_dimension() where dimension = 'debt';
  if v_n <> 0 then fallos := array_append(fallos, 'J3c Edu conserva deuda atribuida sin membresia'); end if;

  if array_length(fallos, 1) is not null then
    raise exception E'J · el ultimo miembro:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'J · el ultimo miembro: el grupo desaparece y todo se conserva: OK';
end
$k$;

rollback;
