-- ============================================================================
-- ADR-035 · INVITACIONES: emitir, previsualizar, canjear
-- ============================================================================
--
-- Todo en una transaccion que termina en ROLLBACK, con actores y grupo de
-- fixture. Las carreras reales de dos sesiones no caben en un check: aqui se
-- mide la segunda reclamacion SECUENCIAL, que recorre exactamente el mismo
-- camino que la que pierde la carrera (la clave primaria del vinculo).
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
grant execute on function pg_temp.actor(uuid), pg_temp.super(), pg_temp.code(text) to authenticated;

create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  'a3500000-0000-4000-8000-0000000000a1'::uuid as edu,    -- crea e invita
  'a3500000-0000-4000-8000-0000000000b1'::uuid as ana,    -- reclama a «Ana»
  'a3500000-0000-4000-8000-0000000000c1'::uuid as bea,    -- intenta reclamar a «Ana» despues
  'a3500000-0000-4000-8000-0000000000d1'::uuid as nuevo,  -- entra como nuevo
  'a3500000-0000-4000-8000-000000000010'::uuid as g,
  'a3500000-0000-4000-8000-000000000031'::uuid as p_edu,
  'a3500000-0000-4000-8000-000000000032'::uuid as p_ana,
  'a3500000-0000-4000-8000-000000000033'::uuid as p_luis,
  null::text as token, null::uuid as inv, null::uuid as e1, null::uuid as cat;
grant select, update on fx to authenticated;

-- ============================ A · catalogo ===================================
do $a$
declare fallos text[] := '{}'; v_n int; v_t text;
begin
  select string_agg(p.proname || '=' || pg_get_userbyid(p.proowner), ',' order by p.proname) into v_t
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname in ('create_group_invitation','revoke_group_invitation','preview_invitation','redeem_invitation');
  if v_t <> 'create_group_invitation=nomey_provisioner,preview_invitation=postgres,redeem_invitation=nomey_provisioner,revoke_group_invitation=nomey_provisioner' then
    fallos := array_append(fallos, 'A1 propietarios: ' || coalesce(v_t,'ausentes'));
  end if;
  if has_function_privilege('anon', 'api.preview_invitation(text)', 'EXECUTE') then fallos := array_append(fallos, 'A1b anon previsualiza'); end if;
  -- A2 · el cliente no alcanza la tabla de invitaciones ni la de intentos.
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'core' and table_name in ('group_invitation','invitation_attempt') and grantee in ('authenticated','anon');
  if v_n <> 0 then fallos := array_append(fallos, 'A2 el cliente alcanza las invitaciones'); end if;
  -- A3 · solo el hash: ninguna columna guarda el token.
  select count(*) into v_n from information_schema.columns where table_schema = 'core' and table_name = 'group_invitation' and column_name like '%token%' and column_name <> 'token_hash';
  if v_n <> 0 then fallos := array_append(fallos, 'A3 hay una columna con el token'); end if;
  if array_length(fallos, 1) is not null then raise exception E'A · catalogo:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'A · catalogo y privilegios: OK';
end
$a$;

-- ============================ fixtures ======================================
do $f$
declare r fx%rowtype; v_out jsonb; v_cat uuid;
begin
  select * into r from fx;
  perform pg_temp.super();
  select id into v_cat from core.category where message_key = 'category.expense.dining' and owner_user_id is null;
  update fx set cat = v_cat;
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    ('a3500000-0000-4000-8000-0000000000f1', 'personal', r.eur, r.edu),
    ('a3500000-0000-4000-8000-0000000000f2', 'personal', r.eur, r.ana),
    ('a3500000-0000-4000-8000-0000000000f3', 'personal', r.eur, r.bea),
    ('a3500000-0000-4000-8000-0000000000f4', 'personal', r.eur, r.nuevo);
  insert into core.membership (scope_id, user_id) values
    ('a3500000-0000-4000-8000-0000000000f1', r.edu), ('a3500000-0000-4000-8000-0000000000f2', r.ana),
    ('a3500000-0000-4000-8000-0000000000f3', r.bea), ('a3500000-0000-4000-8000-0000000000f4', r.nuevo);
  perform pg_temp.actor(r.edu);
  v_out := api.create_group(jsonb_build_object(
    'client_command_id', 'a3500000-0000-4000-8000-000000000020'::uuid, 'command_contract_version', 1,
    'client_group_id', r.g, 'display_name', 'ADR-035', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', r.p_edu, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(
      jsonb_build_object('client_participant_id', r.p_ana,  'display_name', 'Ana'),
      jsonb_build_object('client_participant_id', r.p_luis, 'display_name', 'Luis'))));
  -- E1: Edu paga 900 entre los tres, ANTES de que nadie entre.
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'a3500000-0000-4000-8000-000000000041'::uuid, 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '900',
    'effective_date', current_date::text, 'concept', 'Cena E1', 'category_id', v_cat,
    'payer_participant_id', r.p_edu, 'participants', jsonb_build_array(r.p_edu, r.p_ana, r.p_luis),
    'split_method', jsonb_build_object('kind', 'equal')));
  update fx set e1 = (v_out ->> 'operation_id')::uuid;
  perform pg_temp.super();
end
$f$;

-- ============================ B · emitir =====================================
do $b$
declare fallos text[] := '{}'; r fx%rowtype; v_out jsonb; v_n int; v_t text;
begin
  select * into r from fx;
  -- B1 · un no miembro no emite.
  perform pg_temp.actor(r.ana);
  begin
    perform api.create_group_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', r.g));
    fallos := array_append(fallos, 'B1 un no miembro emitio');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'NOT_AUTHORIZED' then fallos := array_append(fallos, 'B1b: ' || pg_temp.code(sqlerrm)); end if;
  end;
  -- B2 · Edu emite: token base64url, 7 dias por defecto, y solo el hash en la tabla.
  perform pg_temp.actor(r.edu);
  v_out := api.create_group_invitation(jsonb_build_object('client_command_id', 'a3500000-0000-4000-8000-000000000051'::uuid, 'command_contract_version', 1, 'scope_id', r.g));
  update fx set token = v_out ->> 'token', inv = (v_out ->> 'invitation_id')::uuid;
  select * into r from fx;
  if r.token !~ '^[A-Za-z0-9_-]{40,64}$' then fallos := array_append(fallos, 'B2 el token no es base64url: ' || coalesce(r.token,'nulo')); end if;
  perform pg_temp.super();
  select count(*) into v_n from core.group_invitation i where i.id = r.inv and i.token_hash = sec.invitation_hash(r.token)
     and i.expires_at between now() + interval '6 days' and now() + interval '8 days' and i.revoked_at is null;
  if v_n <> 1 then fallos := array_append(fallos, 'B2b la invitacion no esta como se espera'); end if;
  select count(*) into v_n from core.provisioning_command pc where pc.canonical_intent::text like '%' || r.token || '%';
  if v_n <> 0 then fallos := array_append(fallos, 'B2c el token quedo escrito en la intencion canonica'); end if;
  -- B3 · reintento: replay SIN volver a enseñar el token.
  perform pg_temp.actor(r.edu);
  v_out := api.create_group_invitation(jsonb_build_object('client_command_id', 'a3500000-0000-4000-8000-000000000051'::uuid, 'command_contract_version', 1, 'scope_id', r.g));
  if (v_out ->> 'already_processed') <> 'true' or (v_out ->> 'token') is not null then fallos := array_append(fallos, 'B3 el reintento devolvio el token o no fue replay'); end if;
  -- B4 · caducidad acotada.
  begin
    perform api.create_group_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', r.g, 'expires_in_days', 90));
    fallos := array_append(fallos, 'B4 se acepto una invitacion de 90 dias');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'PAYLOAD_INVALID' then fallos := array_append(fallos, 'B4b: ' || pg_temp.code(sqlerrm)); end if;
  end;
  if array_length(fallos, 1) is not null then raise exception E'B · emitir:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'B · emitir: token una vez, solo el hash, 7 dias, replay sin token: OK';
end
$b$;

-- ============================ C · previsualizar ==============================
do $c$
declare fallos text[] := '{}'; r fx%rowtype; v_out jsonb; v_n int; v_t text; v_i int;
begin
  select * into r from fx;
  perform pg_temp.actor(r.ana);
  -- C1 · valida: grupo, estado join, y SOLO los participantes disponibles (sin Edu, vinculado).
  v_out := api.preview_invitation(r.token);
  if (v_out ->> 'state') <> 'join' or (v_out ->> 'display_name') <> 'ADR-035' then fallos := array_append(fallos, 'C1 previsualizacion: ' || v_out::text); end if;
  select string_agg(p ->> 'display_name', ',' order by p ->> 'display_name') into v_t from jsonb_array_elements(v_out -> 'participants') p;
  if v_t <> 'Ana,Luis' then fallos := array_append(fallos, 'C1b disponibles: ' || coalesce(v_t,'ninguno')); end if;
  if (v_out ->> 'scope_id') is not null then fallos := array_append(fallos, 'C1c publica scope_id a un no miembro'); end if;
  if v_out::text ~* 'amount|debt|balance|total' then fallos := array_append(fallos, 'C1d la previsualizacion lleva datos economicos'); end if;
  -- C2 · nada economico antes de entrar: las vistas del grupo estan vacias.
  select count(*) into v_n from api.group_profile where scope_id = r.g;
  select count(*) + v_n into v_n from api.group_operation where scope_id = r.g;
  if v_n <> 0 then fallos := array_append(fallos, 'C2 un invitado sin entrar ve el grupo'); end if;
  -- C3 · invalida, y frenada a los 20 fallos.
  -- Los estados de invitacion viajan como ESTADO y no como excepcion: solo asi
  -- queda apuntado el intento fallido que alimenta el freno.
  if (api.preview_invitation('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') ->> 'state') <> 'invalid' then fallos := array_append(fallos, 'C3 una invitacion inventada no es invalid'); end if;
  if (api.preview_invitation('https://example.com/x') ->> 'state') <> 'invalid' then fallos := array_append(fallos, 'C3c una URL ajena no es invalid'); end if;
  for v_i in 1 .. 18 loop
    perform api.preview_invitation('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' || chr(64 + v_i));
  end loop;
  -- la buena, tras 20 fallos: frenada, tambien al canjear
  if (api.preview_invitation(r.token) ->> 'state') <> 'throttled' then fallos := array_append(fallos, 'C3e tras 20 fallos no se frena'); end if;
  if (api.redeem_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
        'token', r.token, 'choice', 'claim', 'participant_id', r.p_ana)) ->> 'state') <> 'throttled' then
    fallos := array_append(fallos, 'C3f canjear no se frena');
  end if;
  perform pg_temp.super();
  select count(*) into v_n from core.invitation_attempt where user_id = r.ana;
  if v_n <> 20 then fallos := array_append(fallos, format('C3g %s intentos registrados y son 20', v_n)); end if;
  delete from core.invitation_attempt where user_id = r.ana;   -- se limpia para seguir
  if array_length(fallos, 1) is not null then raise exception E'C · previsualizar:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'C · previsualizar: solo identidad, nada economico, invalida y frenada: OK';
end
$c$;

-- ============================ D · canjear ====================================
do $d$
declare fallos text[] := '{}'; r fx%rowtype; v_out jsonb; v_n int; v_t text; v_new uuid;
begin
  select * into r from fx;
  -- D1 · Ana reclama a «Ana»: membresia + vinculo, sin participante nuevo, historial intacto.
  perform pg_temp.actor(r.ana);
  v_out := api.redeem_invitation(jsonb_build_object('client_command_id', 'a3500000-0000-4000-8000-000000000061'::uuid, 'command_contract_version', 1,
    'token', r.token, 'choice', 'claim', 'participant_id', r.p_ana));
  if (v_out ->> 'scope_id')::uuid <> r.g or (v_out ->> 'already_processed') <> 'false' then fallos := array_append(fallos, 'D1 respuesta: ' || v_out::text); end if;
  select count(*) into v_n from api.group_participant where scope_id = r.g and participant_id = r.p_ana and is_self;
  if v_n <> 1 then fallos := array_append(fallos, 'D1b Ana no se reconoce como «Ana»'); end if;
  select your_share into v_t from api.group_operation where operation_id = r.e1;
  if v_t <> '300' then fallos := array_append(fallos, 'D1c la cuota historica de Ana no llega: ' || coalesce(v_t,'nula')); end if;
  select api.personal_statistics(current_date, current_date) ->> 'expense_total' into v_t;
  if v_t <> '300' then fallos := array_append(fallos, 'D1d la cuota no entro en su Personal: ' || v_t); end if;
  perform pg_temp.super();
  select count(*) into v_n from core.participant where scope_id = r.g;
  if v_n <> 3 then fallos := array_append(fallos, format('D1e reclamar creo participante: %s', v_n)); end if;
  -- D2 · reintento: replay, sin duplicar nada.
  perform pg_temp.actor(r.ana);
  v_out := api.redeem_invitation(jsonb_build_object('client_command_id', 'a3500000-0000-4000-8000-000000000061'::uuid, 'command_contract_version', 1,
    'token', r.token, 'choice', 'claim', 'participant_id', r.p_ana));
  if (v_out ->> 'already_processed') <> 'true' then fallos := array_append(fallos, 'D2 el reintento no fue replay'); end if;
  perform pg_temp.super();
  select count(*) into v_n from core.membership where scope_id = r.g;
  if v_n <> 2 then fallos := array_append(fallos, format('D2b membresias: %s', v_n)); end if;
  -- D3 · Ana, ya miembro, vuelve a canjear con otra clave: abre el grupo, no duplica.
  perform pg_temp.actor(r.ana);
  v_out := api.redeem_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
    'token', r.token, 'choice', 'new', 'display_name', 'Ana otra vez'));
  if (v_out ->> 'already_member') <> 'true' then fallos := array_append(fallos, 'D3 ya miembro: ' || v_out::text); end if;
  v_out := api.preview_invitation(r.token);
  if (v_out ->> 'state') <> 'member' or (v_out ->> 'scope_id')::uuid <> r.g then fallos := array_append(fallos, 'D3b previsualizar siendo miembro: ' || v_out::text); end if;
  perform pg_temp.super();
  select count(*) into v_n from core.participant where scope_id = r.g;
  if v_n <> 3 then fallos := array_append(fallos, format('D3c ya miembro creo participante: %s', v_n)); end if;
  -- D4 · Bea intenta reclamar a «Ana», ya vinculada: conflicto recuperable y NADA escrito.
  perform pg_temp.actor(r.bea);
  v_out := api.preview_invitation(r.token);
  select string_agg(p ->> 'display_name', ',') into v_t from jsonb_array_elements(v_out -> 'participants') p;
  if v_t <> 'Luis' then fallos := array_append(fallos, 'D4 Bea ve disponibles: ' || coalesce(v_t,'ninguno')); end if;
  begin
    perform api.redeem_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
      'token', r.token, 'choice', 'claim', 'participant_id', r.p_ana));
    fallos := array_append(fallos, 'D4b Bea reclamo a una participante vinculada');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'PARTICIPANT_ALREADY_CLAIMED' then fallos := array_append(fallos, 'D4c: ' || pg_temp.code(sqlerrm)); end if;
  end;
  perform pg_temp.super();
  select count(*) into v_n from core.membership where scope_id = r.g and user_id = r.bea;
  if v_n <> 0 then fallos := array_append(fallos, 'D4d el conflicto dejo membresia a Bea'); end if;
  -- D5 · participante de OTRO ambito, o retirado: rechazado.
  perform pg_temp.actor(r.bea);
  begin
    perform api.redeem_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
      'token', r.token, 'choice', 'claim', 'participant_id', 'a3500000-0000-4000-8000-000000000099'::uuid));
    fallos := array_append(fallos, 'D5 un participante ajeno se reclamo');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'PARTICIPANT_NOT_IN_SCOPE' then fallos := array_append(fallos, 'D5b: ' || pg_temp.code(sqlerrm)); end if;
  end;
  -- D6 · «Soy nuevo»: participante con el nombre dado, presencia desde hoy, y E1 sin tocar.
  perform pg_temp.actor(r.nuevo);
  v_out := api.redeem_invitation(jsonb_build_object('client_command_id', 'a3500000-0000-4000-8000-000000000062'::uuid, 'command_contract_version', 1,
    'token', r.token, 'choice', 'new', 'display_name', '  Dani  '));
  v_new := (v_out ->> 'participant_id')::uuid;
  if v_new is null then fallos := array_append(fallos, 'D6 sin participante: ' || v_out::text); end if;
  select count(*) into v_n from api.group_participant where scope_id = r.g and participant_id = v_new and display_name = 'Dani' and is_self and is_active;
  if v_n <> 1 then fallos := array_append(fallos, 'D6b el nuevo no esta como se espera'); end if;
  select your_share into v_t from api.group_operation where operation_id = r.e1;
  if v_t is not null then fallos := array_append(fallos, 'D6c el nuevo entro retroactivamente en E1: ' || v_t); end if;
  select count(*) into v_n from api.group_split_participant sp join api.group_operation go on go.version_id = sp.version_id where go.operation_id = r.e1;
  if v_n <> 3 then fallos := array_append(fallos, format('D6d E1 tiene %s cuotas y tenia 3', v_n)); end if;
  perform pg_temp.super();
  select count(*) into v_n from core.participant_period pp where pp.participant_id = v_new and pp.valid_from = current_date and pp.valid_until is null;
  if v_n <> 1 then fallos := array_append(fallos, 'D6e la presencia del nuevo no empieza hoy'); end if;
  -- D6f · sin nombre no se entra como nuevo.
  perform pg_temp.actor(r.bea);
  begin
    perform api.redeem_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
      'token', r.token, 'choice', 'new', 'display_name', '   '));
    fallos := array_append(fallos, 'D6f se entro como nuevo sin nombre');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'PAYLOAD_INVALID' then fallos := array_append(fallos, 'D6g: ' || pg_temp.code(sqlerrm)); end if;
  end;
  -- D7 · ningun scope_id del payload vale: la forma lo rechaza.
  begin
    perform api.redeem_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
      'token', r.token, 'choice', 'claim', 'participant_id', r.p_luis, 'scope_id', r.g));
    fallos := array_append(fallos, 'D7 se acepto scope_id en el payload');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'PAYLOAD_INVALID' then fallos := array_append(fallos, 'D7b: ' || pg_temp.code(sqlerrm)); end if;
  end;
  if array_length(fallos, 1) is not null then raise exception E'D · canjear:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'D · reclamar, nuevo, ya miembro, conflicto, reintento: OK';
end
$d$;

-- ============================ E · reincorporacion, revocada, caducada ========
do $e$
declare fallos text[] := '{}'; r fx%rowtype; v_out jsonb; v_n int; v_t text;
begin
  select * into r from fx;
  -- E1 · Ana sale (ADR-034; con ADR-038 C5 antes paga sus 300 a Edu, porque
  --      con pendientes no se sale) y vuelve a la invitacion: 'rejoin' con su
  --      identidad (ADR-041); entrar como nuevo se rehusa (REJOIN_REQUIRED).
  perform pg_temp.actor(r.ana);
  begin
    perform api.leave_group(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', r.g));
    fallos := array_append(fallos, 'E0 Ana salio debiendo 300');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'LEAVE_BLOCKED_DEBT' then fallos := array_append(fallos, 'E0b salir debiendo: ' || pg_temp.code(sqlerrm)); end if;
  end;
  v_out := api.record_group_payment(jsonb_build_object('client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'amount', '300', 'effective_date', current_date::text,
    'payer_participant_id', r.p_ana, 'receiver_participant_id', r.p_edu,
    'expected_positions', (select jsonb_agg(jsonb_build_object('participant_id', participant_id, 'net', net_position)) from api.group_balance where scope_id = r.g)));
  v_out := api.leave_group(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', r.g));
  v_out := api.preview_invitation(r.token);
  if (v_out ->> 'state') <> 'rejoin' or (v_out -> 'previous_participant' ->> 'participant_id') <> r.p_ana::text then fallos := array_append(fallos, 'E1 tras salir: ' || v_out::text); end if;
  begin
    perform api.redeem_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
      'token', r.token, 'choice', 'new', 'display_name', 'Ana bis'));
    fallos := array_append(fallos, 'E1b quien salio entro como nuevo (eludiendo ADR-034)');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'REJOIN_REQUIRED' then fallos := array_append(fallos, 'E1c: ' || pg_temp.code(sqlerrm)); end if;
  end;
  perform pg_temp.super();
  select count(*) into v_n from core.participant where scope_id = r.g;
  if v_n <> 4 then fallos := array_append(fallos, format('E1d participantes: %s', v_n)); end if;
  -- E2 · revocada: Edu la revoca; Bea ya no puede ni previsualizar ni canjear.
  perform pg_temp.actor(r.edu);
  v_out := api.revoke_group_invitation(jsonb_build_object('client_command_id', 'a3500000-0000-4000-8000-000000000071'::uuid, 'command_contract_version', 1, 'invitation_id', r.inv));
  perform pg_temp.actor(r.bea);
  if (api.preview_invitation(r.token) ->> 'state') <> 'revoked' then fallos := array_append(fallos, 'E2 una revocada no es revoked'); end if;
  if (api.redeem_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
        'token', r.token, 'choice', 'claim', 'participant_id', r.p_luis)) ->> 'state') <> 'revoked' then
    fallos := array_append(fallos, 'E2c una revocada se canjea');
  end if;
  perform pg_temp.super();
  select count(*) into v_n from core.membership where scope_id = r.g and user_id = r.bea;
  if v_n <> 0 then fallos := array_append(fallos, 'E2e canjear una revocada escribio membresia'); end if;
  perform pg_temp.actor(r.bea);
  -- E3 · caducada: se emite otra y se caduca como postgres.
  perform pg_temp.actor(r.edu);
  v_out := api.create_group_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', r.g, 'expires_in_days', 1));
  perform pg_temp.super();
  -- caducar hacia atras: la restriccion exige expires_at > created_at, asi que se mueven las dos
  update core.group_invitation set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where id = (v_out ->> 'invitation_id')::uuid;
  perform pg_temp.actor(r.bea);
  if (api.preview_invitation(v_out ->> 'token') ->> 'state') <> 'expired' then fallos := array_append(fallos, 'E3 una caducada no es expired'); end if;
  -- E4 · un no miembro no revoca; un miembro revoca la suya idempotentemente.
  begin
    perform api.revoke_group_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'invitation_id', r.inv));
    fallos := array_append(fallos, 'E4 un no miembro revoco');
  exception when others then
    if pg_temp.code(sqlerrm) <> 'NOT_AUTHORIZED' then fallos := array_append(fallos, 'E4b: ' || pg_temp.code(sqlerrm)); end if;
  end;
  perform pg_temp.actor(r.edu);
  v_out := api.revoke_group_invitation(jsonb_build_object('client_command_id', 'a3500000-0000-4000-8000-000000000071'::uuid, 'command_contract_version', 1, 'invitation_id', r.inv));
  if (v_out ->> 'already_processed') <> 'true' then fallos := array_append(fallos, 'E4c revocar dos veces no fue replay'); end if;
  if array_length(fallos, 1) is not null then raise exception E'E · reincorporacion, revocada, caducada:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'E · quien salio no elude ADR-034; revocada y caducada cerradas; revocar idempotente: OK';
end
$e$;

-- ============================ F · sin nadie que reclamar ====================
-- Un grupo cuyo unico participante es el creador (ya vinculado): la
-- previsualizacion trae CERO reclamables y «Soy nuevo» sigue entrando.
do $g$
declare fallos text[] := '{}'; r fx%rowtype; v_out jsonb; v_n int; v_t text;
  v_g2 uuid := 'a3500000-0000-4000-8000-000000000080';
  v_pz uuid := 'a3500000-0000-4000-8000-000000000081';
begin
  select * into r from fx;
  perform pg_temp.actor(r.edu);
  v_out := api.create_group(jsonb_build_object(
    'client_command_id', 'a3500000-0000-4000-8000-000000000082'::uuid, 'command_contract_version', 1,
    'client_group_id', v_g2, 'display_name', 'Solo Edu', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', v_pz, 'creator_display_name', 'Edu', 'participants', '[]'::jsonb));
  v_out := api.create_group_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', v_g2));
  v_t := v_out ->> 'token';
  perform pg_temp.actor(r.bea);
  v_out := api.preview_invitation(v_t);
  if (v_out ->> 'state') <> 'join' or jsonb_array_length(v_out -> 'participants') <> 0 then
    fallos := array_append(fallos, 'F1 sin reclamables: ' || v_out::text);
  end if;
  v_out := api.redeem_invitation(jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
    'token', v_t, 'choice', 'new', 'display_name', 'Bea'));
  if (v_out ->> 'state') <> 'ok' or (v_out ->> 'participant_id') is null then fallos := array_append(fallos, 'F2 entrar como nuevo sin reclamables: ' || v_out::text); end if;
  select count(*) into v_n from api.group_participant where scope_id = v_g2;
  if v_n <> 2 then fallos := array_append(fallos, format('F2b el grupo tiene %s participantes y son 2', v_n)); end if;
  if array_length(fallos, 1) is not null then raise exception E'F · sin nadie que reclamar:
%', array_to_string(fallos, E'
'); end if;
  raise notice 'F · sin reclamables, «Soy nuevo» entra igual: OK';
end
$g$;

-- ============================ G · quien tiene cuenta ========================
-- `is_linked`: el hecho de que haya una cuenta detras, nunca cual. Creador,
-- reclamado, nuevo con cuenta, declarado por su nombre, y quien salio.
do $h$
declare fallos text[] := '{}'; r fx%rowtype; v_t text; v_n int;
begin
  select * into r from fx;
  perform pg_temp.actor(r.edu);
  -- G1 · el creador: con cuenta y activo
  select is_linked::text || '/' || is_active::text into v_t from api.group_participant where participant_id = r.p_edu;
  if v_t <> 'true/true' then fallos := array_append(fallos, 'G1 el creador: ' || coalesce(v_t, 'ausente')); end if;
  -- G2 · «Luis», declarado por su nombre y nunca reclamado: activo para el reparto y SIN cuenta
  select is_linked::text || '/' || is_active::text into v_t from api.group_participant where participant_id = r.p_luis;
  if v_t <> 'false/true' then fallos := array_append(fallos, 'G2 sin cuenta y activo: ' || coalesce(v_t, 'ausente')); end if;
  -- G3 · «Ana», reclamada y luego salio: con cuenta e inactiva (el vinculo se conserva, ADR-034)
  select is_linked::text || '/' || is_active::text into v_t from api.group_participant where participant_id = r.p_ana;
  if v_t <> 'true/false' then fallos := array_append(fallos, 'G3 reclamada que salio: ' || coalesce(v_t, 'ausente')); end if;
  -- G4 · quien entro como nuevo («Dani»): con cuenta y activo
  select is_linked::text || '/' || is_active::text into v_t from api.group_participant where scope_id = r.g and display_name = 'Dani';
  if v_t <> 'true/true' then fallos := array_append(fallos, 'G4 nuevo con cuenta: ' || coalesce(v_t, 'ausente')); end if;
  -- G5 · no es is_self: Edu ve a Dani con cuenta sin que sea el
  select count(*) into v_n from api.group_participant where scope_id = r.g and display_name = 'Dani' and is_linked and not is_self;
  if v_n <> 1 then fallos := array_append(fallos, 'G5 is_linked se confunde con is_self'); end if;
  -- G6 · la vista sigue sin publicar ninguna columna de usuario. El vinculo se publica
  --      SOLO como link_id de la fila propia (F10/ADR-001 §1, 20260916120000): la de
  --      Dani, con cuenta, llega a Edu sin link_id; la propia de Edu lo lleva.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'api' and table_name = 'group_participant'
     and (column_name like '%user%' or (column_name like '%link%' and column_name <> 'link_id' and column_name <> 'is_linked'));
  if v_n <> 0 then fallos := array_append(fallos, 'G6 la vista publica una columna de usuario o del vinculo ajeno'); end if;
  select count(*) into v_n from api.group_participant where scope_id = r.g and not is_self and link_id is not null;
  if v_n <> 0 then fallos := array_append(fallos, 'G6 link_id de una fila ajena publicado'); end if;
  select count(*) into v_n from api.group_participant where scope_id = r.g and is_self and link_id is not null;
  if v_n <> 1 then fallos := array_append(fallos, 'G6 la fila propia no lleva su link_id'); end if;
  -- G7 · fuera del grupo no se responde: un ajeno no ve is_linked de nadie
  perform pg_temp.actor(r.bea);
  select count(*) into v_n from api.group_participant where scope_id = r.g;
  if v_n <> 0 then fallos := array_append(fallos, 'G7 un ajeno lee participantes del grupo'); end if;
  perform pg_temp.super();
  if array_length(fallos, 1) is not null then raise exception E'G · con cuenta:
%', array_to_string(fallos, E'
'); end if;
  raise notice 'G · con cuenta: creador y nuevo si; declarado no; quien salio si pero inactivo; sin usuario ni is_self: OK';
end
$h$;

rollback;
