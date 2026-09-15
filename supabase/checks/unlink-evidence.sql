-- ============================================================================
-- DEJAR UNA INSTANCIA PROPIA DE VINCULO · F10/ADR-001 §2, §4–§10, §12
-- ============================================================================
--
-- Migracion 20260916120000. Contra las funciones REALES —api.unlink_participant,
-- el wrapper api.unclaim_participant, redeem, gastos, liquidaciones,
-- anulaciones, associate, leave— con identidad simulada, fixtures propias y
-- ROLLBACK. Cada caso economico corre sobre un grupo propio.
--
--   A · catalogo: owners, definers, grants, policies, kind oculto, sin cadenas
--   B · la regla economica, deudor y acreedor (ADR §2.5): 19 casos
--   C · fusiones: previa en S0, durante con y sin atribucion, cadena A→B→P
--   D · create / new: con atribucion bloquea; sin ella pasa; el escape falla
--   E · efecto de la baja: presencia, hechos, disponible, rejoin, claim ajeno
--   F · LINK_SUPERSEDED uniforme y sin escritura; quien salio con vinculo: NOT_AUTHORIZED
--   G · replay: mismo comando, misma respuesta, un solo hecho, un solo aviso
--   H · identity_released: en core, a los que quedan, oculto al cliente vigente
--   I · wrapper legado: clave del cliente, retry sin comando extra, origen ≠ comando de baja
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
grant execute on function pg_temp.actor(uuid), pg_temp.super() to authenticated, nomey_provisioner, nomey_writer;

-- api.<fn>(payload) como <who>: json, o 'ERR <code>' (details en last_details).
create temp table last (details text);
insert into last values (null);
grant select, update on last to authenticated;
create function pg_temp.call(p_fn text, p_payload jsonb, p_who uuid) returns text
language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.actor(p_who);
  execute format('select api.%I($1)', p_fn) into v using p_payload;
  perform pg_temp.super();
  update last set details = null;
  return v::text;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  update last set details = sqlerrm::json ->> 'details';
  return 'ERR ' || (sqlerrm::json ->> 'code');
end $$;
grant execute on function pg_temp.call(text, jsonb, uuid) to authenticated;
create function pg_temp.try(p_sql text, p_role text, p_who uuid) returns text
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_who::text)::text, true);
  perform set_config('role', p_role, true);
  execute p_sql;
  perform pg_temp.super();
  return 'OK';
exception when others then
  perform pg_temp.super();
  return sqlstate;
end $$;

create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  (select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null) as cat,
  'f4000000-0000-4000-8000-0000000000a1'::uuid as edu,   -- creador
  'f4000000-0000-4000-8000-0000000000a2'::uuid as ana,   -- entra como nueva
  'f4000000-0000-4000-8000-0000000000a3'::uuid as bea,   -- reclama a Luis
  'f4000000-0000-4000-8000-0000000000a4'::uuid as zoe,   -- reclama despues
  'f4000000-0000-4000-8000-0000000000f1'::uuid as s_edu,
  'f4000000-0000-4000-8000-0000000000f2'::uuid as s_ana,
  'f4000000-0000-4000-8000-0000000000f3'::uuid as s_bea,
  'f4000000-0000-4000-8000-0000000000f4'::uuid as s_zoe;
grant select on fx to authenticated;

do $f$
declare r fx%rowtype;
begin
  select * into r from fx;
  perform pg_temp.super();
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (r.s_edu, 'personal', r.eur, r.edu), (r.s_ana, 'personal', r.eur, r.ana),
    (r.s_bea, 'personal', r.eur, r.bea), (r.s_zoe, 'personal', r.eur, r.zoe);
  insert into core.membership (scope_id, user_id) values (r.s_edu, r.edu), (r.s_ana, r.ana), (r.s_bea, r.bea), (r.s_zoe, r.zoe);
end $f$;

-- ─── helpers de fixture: grupo nuevo (Edu creador; fantasmas Luis y Gus), token ─
create function pg_temp.grupo_nuevo(p_g uuid, p_e uuid, p_luis uuid, p_gus uuid) returns text language plpgsql as $$
declare r fx%rowtype; v text;
begin
  select * into r from fx;
  v := pg_temp.call('create_group', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
    'client_group_id', p_g, 'display_name', 'U', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', p_e, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(jsonb_build_object('client_participant_id', p_luis, 'display_name', 'Luis'),
                                      jsonb_build_object('client_participant_id', p_gus, 'display_name', 'Gus'))), r.edu);
  if v like 'ERR%' then raise exception 'grupo_nuevo: %', v; end if;
  v := pg_temp.call('create_group_invitation', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', p_g), r.edu);
  return v::jsonb ->> 'token';
end $$;
create function pg_temp.gasto(p_g uuid, p_payer uuid, p_parts uuid[], p_total text, p_concept text, p_who uuid,
                              p_op uuid default null) returns uuid language plpgsql as $$
declare r fx%rowtype; v text; pl jsonb;
begin
  select * into r from fx;
  pl := jsonb_build_object('client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
    'scope_id', p_g, 'currency_definition_id', r.eur, 'total', p_total, 'effective_date', current_date::text,
    'concept', p_concept, 'category_id', r.cat, 'payer_participant_id', p_payer,
    'participants', to_jsonb(p_parts), 'split_method', jsonb_build_object('kind', 'equal'));
  if p_op is not null then
    pl := pl || jsonb_build_object('operation_id', p_op, 'expected_version_id', (select current_version_id from core.operation where id = p_op));
  end if;
  v := pg_temp.call('record_group_expense', pl, p_who);
  if v like 'ERR%' then raise exception 'gasto %: %', p_concept, v; end if;
  return (v::jsonb ->> 'operation_id')::uuid;
end $$;
create function pg_temp.liq(p_g uuid, p_debtor uuid, p_creditor uuid, p_amount text, p_who uuid,
                            p_op uuid default null) returns uuid language plpgsql as $$
declare r fx%rowtype; v text; pl jsonb;
begin
  select * into r from fx;
  pl := jsonb_build_object('client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
    'scope_id', p_g, 'currency_definition_id', r.eur, 'amount', p_amount, 'effective_date', current_date::text,
    'debtor_participant_id', p_debtor, 'creditor_participant_id', p_creditor);
  if p_op is not null then
    pl := pl || jsonb_build_object('operation_id', p_op, 'expected_version_id', (select current_version_id from core.operation where id = p_op));
  end if;
  v := pg_temp.call('record_debt_settlement', pl, p_who);
  if v like 'ERR%' then raise exception 'liq: %', v; end if;
  return (v::jsonb ->> 'operation_id')::uuid;
end $$;
create function pg_temp.anula(p_op uuid, p_who uuid) returns void language plpgsql as $$
declare v text;
begin
  v := pg_temp.call('annul_operation', jsonb_build_object('client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
    'operation_id', p_op, 'expected_version_id', (select current_version_id from core.operation where id = p_op)), p_who);
  if v like 'ERR%' then raise exception 'anula: %', v; end if;
end $$;
create function pg_temp.reclama(p_tok text, p_p uuid, p_who uuid) returns void language plpgsql as $$
declare v text;
begin
  v := pg_temp.call('redeem_invitation', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
    'token', p_tok, 'choice', 'claim', 'participant_id', p_p), p_who);
  if v like 'ERR%' then raise exception 'reclama: %', v; end if;
end $$;
create function pg_temp.link_de(p_p uuid) returns uuid language sql as $$
  select link_id from core.participant_user_link where participant_id = p_p;
$$;
-- La baja REAL, con el link_id vigente del participante (o el que se indique).
create function pg_temp.deja(p_g uuid, p_p uuid, p_who uuid, p_link uuid default null, p_key uuid default null) returns text language plpgsql as $$
begin
  return pg_temp.call('unlink_participant', jsonb_build_object('client_command_id', coalesce(p_key, gen_random_uuid()), 'command_contract_version', 1,
    'scope_id', p_g, 'participant_id', p_p, 'link_id', coalesce(p_link, pg_temp.link_de(p_p))), p_who);
end $$;
grant execute on function pg_temp.deja(uuid, uuid, uuid, uuid, uuid) to authenticated;

-- Un caso economico de la matriz: grupo propio, "pre" antes de reclamar, "durante"
-- despues, y la baja. Devuelve el codigo ('OK' si paso). p_dir = 'debtor' (Edu paga y
-- Luis debe) o 'creditor' (Luis paga y Edu debe). k identifica el caso 1..8.
create function pg_temp.caso(p_k integer, p_dir text, p_seq integer) returns text language plpgsql as $$
declare r fx%rowtype; g uuid; p_e uuid; p_l uuid; p_q uuid; tok text; e1 uuid; s1 uuid; v text;
        payer uuid; other uuid; deb uuid; cred uuid;
begin
  select * into r from fx;
  g   := ('f4000000-0000-4000-8000-0000000001' || lpad(p_seq::text, 2, '0'))::uuid;
  p_e := ('f4000000-0000-4000-8000-0000000002' || lpad(p_seq::text, 2, '0'))::uuid;
  p_l := ('f4000000-0000-4000-8000-0000000003' || lpad(p_seq::text, 2, '0'))::uuid;
  p_q := ('f4000000-0000-4000-8000-0000000004' || lpad(p_seq::text, 2, '0'))::uuid;
  tok := pg_temp.grupo_nuevo(g, p_e, p_l, p_q);
  if p_dir = 'debtor' then payer := p_e; other := p_l; deb := p_l; cred := p_e;
  else payer := p_l; other := p_e; deb := p_e; cred := p_l; end if;
  -- PRE: deuda +100 (E1: el pagador paga 200 a medias con el otro)
  e1 := pg_temp.gasto(g, payer, array[payer, other], '200', 'E1', r.edu);
  if p_k in (4, 5, 7) then s1 := pg_temp.liq(g, deb, cred, '100', r.edu); end if;   -- settlement previo -100
  if p_k = 9 then perform pg_temp.liq(g, deb, cred, '40', r.edu); end if;                   -- owed/owes previo parcial
  -- LA INSTANCIA: Bea reclama a Luis (linea base = lo anterior)
  perform pg_temp.reclama(tok, p_l, r.bea);
  -- DURANTE
  case p_k
    when 1 then null;                                                                             -- intacta
    when 2 then perform pg_temp.gasto(g, payer, array[payer, other], '100', 'E1', r.edu, e1);      -- +100 -> +50
    when 3 then perform pg_temp.gasto(g, payer, array[payer, other], '300', 'E1', r.edu, e1);      -- +100 -> +150
    when 4 then perform pg_temp.liq(g, deb, cred, '50', r.edu, s1);                                -- settlement -100 -> -50
    when 5 then perform pg_temp.anula(s1, r.edu);                                                  -- settlement -100 -> 0
    when 6 then perform pg_temp.liq(g, deb, cred, '50', r.edu);                                    -- settlement nuevo -50
    when 7 then perform pg_temp.anula(s1, r.edu);                                                  -- (=5) +100 y -100 previos, se anula el settlement
    when 8 then perform pg_temp.liq(g, deb, cred, '50', r.edu);                                    -- (=6) +100 previa; settlement nuevo -50
    when 9 then perform pg_temp.gasto(g, payer, array[payer, other], '200', 'E1', r.edu, e1);      -- correccion sin cambio de atribucion
    when 10 then perform pg_temp.gasto(g, p_e, array[p_e, p_q], '80', 'X', r.edu);                 -- operacion nueva SIN Luis
    when 11 then perform pg_temp.gasto(g, payer, array[payer, other, p_q], '300', 'Y', r.edu);     -- operacion nueva CON Luis
    when 12 then perform pg_temp.anula(e1, r.edu);                                                 -- la unica obligacion desaparece
    when 13 then perform pg_temp.gasto(g, p_e, array[p_e, p_q], '200', 'E1', r.edu, e1);           -- Luis deja de figurar (Edu paga a Gus)
    when 14 then perform pg_temp.gasto(g, payer, array[payer, other], '300', 'E1', r.edu, e1);     -- sube...
                 perform pg_temp.gasto(g, payer, array[payer, other], '200', 'E1', r.edu, e1);     -- ...y vuelve EXACTAMENTE
    when 15 then if p_dir = 'debtor' then perform pg_temp.gasto(g, p_q, array[p_q, p_l], '200', 'E1', r.edu, e1);   -- Luis pasa a deber a Gus (owes nueva)
                 else perform pg_temp.gasto(g, p_l, array[p_l, p_q], '200', 'E1', r.edu, e1); end if;             -- a Luis pasa a deberle Gus (owed nueva)
  end case;
  v := pg_temp.deja(g, p_l, r.bea);
  return case when v like 'ERR%' then v || coalesce(' [' || (select string_agg(x ->> 'reason', ',') from jsonb_array_elements(((select details from last))::jsonb -> 'operations') x) || ']', '') else 'OK' end;
end $$;
grant execute on function pg_temp.caso(integer, text, integer) to authenticated;

-- ═══════════════ A · catalogo ════════════════════════════════════════════════
do $a$
declare fallos text[] := '{}'; v text; v_n int;
begin
  perform pg_temp.super();
  -- A1 · la implementacion unica es del provisioner; la API tambien; el wrapper sigue siendolo.
  for v in select unnest(array['sec.unlink_instance(uuid, uuid, integer, uuid, uuid, uuid, boolean)', 'api.unlink_participant(jsonb)', 'api.unclaim_participant(jsonb)']) loop
    if not exists (select 1 from pg_proc p join pg_roles o on o.oid = p.proowner where p.oid = v::regprocedure and p.prosecdef and o.rolname = 'nomey_provisioner'
                    and array_to_string(p.proconfig, ',') like '%search_path=%') then
      fallos := array_append(fallos, 'A1 ' || v || ' no es definer del provisioner con search_path fijado');
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'api.unlink_participant(jsonb)', 'execute')
     or has_function_privilege('anon', 'api.unlink_participant(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'sec.unlink_instance(uuid, uuid, integer, uuid, uuid, uuid, boolean)', 'execute') then
    fallos := array_append(fallos, 'A1 execute de unlink_participant / unlink_instance');
  end if;
  -- A2 · lectores de postgres, solo el provisioner.
  for v in select unnest(array['sec.unlink_blocking_attribution(uuid)', 'sec.instance_subjects(uuid)']) loop
    if has_function_privilege('authenticated', v, 'execute') or not has_function_privilege('nomey_provisioner', v, 'execute') then
      fallos := array_append(fallos, 'A2 execute de ' || v);
    end if;
  end loop;
  if not exists (select 1 from pg_proc p join pg_roles o on o.oid = p.proowner where p.oid = 'sec.unlink_blocking_attribution(uuid)'::regprocedure and p.prosecdef and o.rolname = 'postgres') then
    fallos := array_append(fallos, 'A2 el evaluador no es definer de postgres');
  end if;
  if pg_get_functiondef('sec.unlink_blocking_attribution(uuid)'::regprocedure) ~* 'canonical_participant|abs\(|created_at|linked_at' then
    fallos := array_append(fallos, 'A2 el evaluador usa canonico, abs o el reloj');
  end if;
  -- A3 · participant_unlink: grants exactos y policies por actor / membresia; sin update/delete.
  if (select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
       where table_schema = 'core' and table_name = 'participant_unlink' and grantee = 'nomey_provisioner') is distinct from 'INSERT,SELECT' then
    fallos := array_append(fallos, 'A3 grants del provisioner en participant_unlink');
  end if;
  if (select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges
       where table_schema = 'core' and table_name = 'participant_unlink' and grantee = 'authenticated' and privilege_type = 'SELECT') is distinct from 'id,participant_id,scope_id' then
    fallos := array_append(fallos, 'A3 authenticated lee mas columnas de participant_unlink que id, participant_id, scope_id');
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'core' and table_name = 'participant_unlink'
              and grantee <> 'postgres' and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')) then
    fallos := array_append(fallos, 'A3 update/delete sobre participant_unlink');
  end if;
  for v in select polname || '|' || coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), '')
             from pg_policy where polrelid in ('core.participant_unlink'::regclass, 'core.participant_user_link'::regclass, 'core.membership'::regclass,
                                               'core.link_baseline'::regclass, 'core.link_baseline_subject'::regclass) loop
    if v not like '%sec.request_actor_id()%' and v not like '%sec.is_member(%' and v not like '%using (true)%' and split_part(v, '|', 1) not like '%writer%' then
      fallos := array_append(fallos, 'A3 policy sin actor ni membresia: ' || split_part(v, '|', 1));
    end if;
  end loop;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'core' and table_name = 'participant_user_link' and grantee <> 'postgres' and privilege_type = 'UPDATE') then
    fallos := array_append(fallos, 'A3 alguien tiene UPDATE sobre el vinculo');
  end if;
  -- A4 · identity_released existe en core y esta OCULTO en api.group_notice y en «visto».
  if not exists (select 1 from pg_constraint where conrelid = 'core.group_notice'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%identity_released%') then
    fallos := array_append(fallos, 'A4 el kind identity_released no esta en el CHECK');
  end if;
  if pg_get_viewdef('api.group_notice'::regclass) not like '%<> ''identity_released''%' then
    fallos := array_append(fallos, 'A4 api.group_notice no filtra identity_released (el cliente vigente no lo representa)');
  end if;
  if pg_get_functiondef('api.mark_group_notices_seen(uuid)'::regprocedure) not like '%<> ''identity_released''%' then
    fallos := array_append(fallos, 'A4 mark_group_notices_seen daria por visto lo que el cliente no ve');
  end if;
  -- A5 · participant_unclaim se retiro; group_participant publica link_id.
  if to_regclass('core.participant_unclaim') is not null then fallos := array_append(fallos, 'A5 core.participant_unclaim sigue existiendo'); end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'api' and table_name = 'group_participant' and column_name = 'link_id') then
    fallos := array_append(fallos, 'A5 api.group_participant no publica link_id');
  end if;
  -- A6 · sin cadenas de fusion en los datos (associate lo impide; S se calcula por cierre igualmente).
  select count(*) into v_n from core.participant_merge a join core.participant_merge b on a.target_participant_id = b.source_participant_id;
  if v_n <> 0 then fallos := array_append(fallos, 'A6 hay cadenas de fusion: ' || v_n); end if;
  if cardinality(fallos) > 0 then raise exception 'A · catalogo: %', array_to_string(fallos, ' | '); end if;
  raise notice 'A · catalogo: una implementacion del provisioner, lectores de postgres, grants y policies por actor, kind oculto, sin cadenas: OK';
end
$a$;

-- ═══════════════ B · la regla economica (ADR §2.5) ═══════════════════════════
do $b$
declare fallos text[] := '{}'; v text; dir text; k int; seq int := 0; esperado text[];
        -- P deudor: la matriz literal de ADR-001 §2.5.
        deudor text[]   := array['OK','OK','BLOQ','BLOQ','BLOQ','POL','BLOQ','POL','OK','OK','BLOQ','OK','OK','OK','BLOQ'];
        -- P acreedor (Luis PAGO E1 como fantasma): owed no es capa necesaria, asi que las
        -- reducciones de lo que le deben pasan (4, 5, 7) y un settlement recibido nuevo es
        -- solo politica (6, 8); el aumento (3) lo bloquea la cuota (eco). Las correcciones
        -- de E1 mientras Luis esta vinculado (2, 9, 14) le escriben CAJA en el Personal de
        -- Bea (el writer deriva el Personal del pagador por vinculo): la atribucion pasa y
        -- la guarda de caja, separada, es la que decide.
        acreedor text[] := array['OK','CASH','BLOQ','OK','OK','POL','OK','POL','CASH','OK','BLOQ','OK','OK','CASH','POL'];
        nombre text[] := array['+100 intacta','+100 -> +50','+100 -> +150','settlement -100 -> -50','settlement -100 -> 0','settlement nuevo -50',
                               '+100 y -100 previos, anular el settlement','+100 previa, settlement nuevo -50','correccion sin cambio de atribucion',
                               'operacion nueva sin P','operacion nueva con P','la unica obligacion desaparece','P deja de figurar',
                               'sube y vuelve exactamente a la base','cambio de acreedor/deudor con el mismo importe'];
begin
  foreach dir in array array['debtor', 'creditor'] loop
    for k in 1..15 loop
      seq := seq + 1;
      v := pg_temp.caso(k, dir, seq);
      esperado := case when dir = 'debtor' then deudor else acreedor end;
      if esperado[k] = 'CASH' and v <> 'ERR UNLINK_BLOCKED_CASH' then
        fallos := array_append(fallos, format('B %s/%s (%s): esperado caja, medido %s', dir, k, nombre[k], v));
      elsif esperado[k] = 'OK' and v <> 'OK' then
        fallos := array_append(fallos, format('B %s/%s (%s): esperado OK, medido %s', dir, k, nombre[k], v));
      elsif esperado[k] = 'BLOQ' and v not like 'ERR UNLINK_BLOCKED_ATTRIBUTION [%attribution%' then
        fallos := array_append(fallos, format('B %s/%s (%s): esperado bloqueo por atribucion, medido %s', dir, k, nombre[k], v));
      elsif esperado[k] = 'POL' and v not like 'ERR UNLINK_BLOCKED_ATTRIBUTION [policy]' then
        fallos := array_append(fallos, format('B %s/%s (%s): esperado bloqueo solo por politica, medido %s', dir, k, nombre[k], v));
      end if;
    end loop;
  end loop;
  if cardinality(fallos) > 0 then raise exception E'B · regla economica:\n  %', array_to_string(fallos, E'\n  '); end if;
  raise notice 'B · 30 casos (15 x deudor/acreedor): aumentos y reducciones deshechas bloquean por atribucion, settlements nuevos por politica, reducciones y vuelta a la base pasan, cambio de contraparte bloquea: OK';
end
$b$;

-- ═══════════════ C · fusiones ════════════════════════════════════════════════
do $c$
declare r fx%rowtype; fallos text[] := '{}'; v text; tok text; tok2 text; e uuid; e3 uuid;
  g uuid := 'f4000000-0000-4000-8000-000000000501'; p_e uuid := 'f4000000-0000-4000-8000-000000000502';
  p_l uuid := 'f4000000-0000-4000-8000-000000000503'; p_q uuid := 'f4000000-0000-4000-8000-000000000504';
  p_a uuid := 'f4000000-0000-4000-8000-000000000505'; p_b uuid := 'f4000000-0000-4000-8000-000000000506';
  g2 uuid := 'f4000000-0000-4000-8000-000000000511'; p_e2 uuid := 'f4000000-0000-4000-8000-000000000512';
  p_l2 uuid := 'f4000000-0000-4000-8000-000000000513'; p_q2 uuid := 'f4000000-0000-4000-8000-000000000514';
begin
  select * into r from fx;
  tok := pg_temp.grupo_nuevo(g, p_e, p_l, p_q);
  perform pg_temp.super();
  insert into core.participant (id, scope_id, display_name) values (p_a, g, 'Ada'), (p_b, g, 'Bel');
  insert into core.participant_period (participant_id, valid_from, valid_until) values (p_a, current_date, null), (p_b, current_date, null);
  e := pg_temp.gasto(g, p_e, array[p_e, p_l, p_q], '300', 'E', r.edu);      -- Luis>Edu 100, Gus>Edu 100
  perform pg_temp.gasto(g, p_e, array[p_e, p_b], '80', 'SoloBel', r.edu);   -- Bel>Edu 40 (para la cadena)
  perform pg_temp.reclama(tok, p_l, r.bea);
  -- C2 · fusion DURANTE de un origen SIN atribucion (Ada): la fila de fusion no bloquea por si misma.
  v := pg_temp.call('associate_participant', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', g, 'participant_id', p_a), r.bea);
  if v like 'ERR%' then raise exception 'C2 associate Ada: %', v; end if;
  v := pg_temp.deja(g, p_l, r.bea);
  if v like 'ERR%' then fallos := array_append(fallos, 'C2 la mera fusion bloqueo: ' || v); end if;
  -- C1 · Zoe reclama (S0 = {Luis, Ada}); fusion DURANTE con atribucion absorbida (Gus): bloquea. Gus figura en la
  --      MISMA operacion E que Luis, asi que eco(E) sube 100 -> 200 (capa necesaria); una operacion solo de Gus
  --      seria identidad nueva (politica). En los dos casos lo absorbido cuenta.
  perform pg_temp.reclama(tok, p_l, r.zoe);
  perform pg_temp.super();
  if (select count(*) from core.link_baseline_subject where link_id = pg_temp.link_de(p_l)) <> 2 then fallos := array_append(fallos, 'C1 S0 de Zoe no incluye a Ada (fusion previa)'); end if;
  v := pg_temp.call('associate_participant', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', g, 'participant_id', p_q), r.zoe);
  if v like 'ERR%' then raise exception 'C1 associate Gus: %', v; end if;
  v := pg_temp.deja(g, p_l, r.zoe);
  if v <> 'ERR UNLINK_BLOCKED_ATTRIBUTION' or (select details from last) not like '%"reason": "attribution"%' then
    fallos := array_append(fallos, 'C1 fusion durante con atribucion absorbida: ' || v || ' ' || coalesce((select details from last), ''));
  end if;
  -- C4 · CADENA Bel -> Gus -> Luis (simulada como postgres: la via autoritativa la rehusa): la atribucion de Bel cuenta.
  perform pg_temp.super();
  begin
    insert into core.participant_merge (source_participant_id, target_participant_id, scope_id, merged_by, client_command_id)
    values (p_b, p_q, g, r.zoe, gen_random_uuid());
    if not (p_b = any (sec.instance_subjects(p_l))) then fallos := array_append(fallos, 'C4 el cierre transitivo no incluye a Bel'); end if;
    -- Sin Gus en E (corregido) sigue bloqueando: lo que queda es SoloBel, absorbido por la cadena.
    perform pg_temp.gasto(g, p_e, array[p_e, p_l], '200', 'E', r.edu, e);
    v := pg_temp.deja(g, p_l, r.zoe);
    if v <> 'ERR UNLINK_BLOCKED_ATTRIBUTION' or (select details from last) not like '%SoloBel%' then
      fallos := array_append(fallos, 'C4 la atribucion de Bel (cadena) no bloqueo: ' || v);
    end if;
    perform pg_temp.super();
    raise exception using errcode = 'P0001', message = 'SIM';
  exception when others then if sqlerrm <> 'SIM' then raise; end if; end;
  perform pg_temp.super();
  -- C3 · fusion PREVIA a la instancia (g2): lo absorbido esta en S0 y en la base; anular una de sus
  --      operaciones es una reduccion y pasa. La instancia anterior termina como postgres (simulado),
  --      porque con caja o atribucion absorbida la baja real no procede, y es la unica via que deja
  --      un fantasma con fusiones.
  tok2 := pg_temp.grupo_nuevo(g2, p_e2, p_l2, p_q2);
  e  := pg_temp.gasto(g2, p_e2, array[p_e2, p_l2, p_q2], '300', 'E', r.edu);
  e3 := pg_temp.gasto(g2, p_e2, array[p_e2, p_q2], '80', 'SoloGus', r.edu);
  perform pg_temp.reclama(tok2, p_l2, r.bea);
  v := pg_temp.call('associate_participant', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', g2, 'participant_id', p_q2), r.bea);
  if v like 'ERR%' then raise exception 'C3 associate: %', v; end if;
  perform pg_temp.super();
  delete from core.participant_user_link where participant_id = p_l2; delete from core.membership where scope_id = g2 and user_id = r.bea;
  perform pg_temp.reclama(tok2, p_l2, r.zoe);
  perform pg_temp.super();
  if (select count(*) from core.link_baseline_subject where link_id = pg_temp.link_de(p_l2)) <> 2
     or not exists (select 1 from core.link_baseline where link_id = pg_temp.link_de(p_l2) and operation_id = e3) then
    fallos := array_append(fallos, 'C3 S0 o base sin lo absorbido por la fusion previa');
  end if;
  perform pg_temp.anula(e3, r.edu);                                             -- lo absorbido se reduce: pasa
  v := pg_temp.deja(g2, p_l2, r.zoe);
  if v like 'ERR%' then fallos := array_append(fallos, 'C3 fusion previa, reduccion de lo absorbido: ' || v); end if;
  if cardinality(fallos) > 0 then raise exception 'C · fusiones: %', array_to_string(fallos, ' | '); end if;
  raise notice 'C · fusion durante: sin atribucion no bloquea, con atribucion absorbida bloquea (eco sube); cadena por cierre; fusion previa en S0 y base, su reduccion pasa: OK';
end
$c$;

-- ═══════════════ D · create / new ═══════════════════════════════════════════
do $d$
declare r fx%rowtype; fallos text[] := '{}'; v text; tok text; p_ana uuid; e uuid;
  g uuid := 'f4000000-0000-4000-8000-000000000601'; p_e uuid := 'f4000000-0000-4000-8000-000000000602';
  p_l uuid := 'f4000000-0000-4000-8000-000000000603'; p_q uuid := 'f4000000-0000-4000-8000-000000000604';
begin
  select * into r from fx;
  tok := pg_temp.grupo_nuevo(g, p_e, p_l, p_q);
  v := pg_temp.call('redeem_invitation', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'token', tok, 'choice', 'new', 'display_name', 'Ana'), r.ana);
  p_ana := (v::jsonb ->> 'participant_id')::uuid;
  -- D1 · Ana (new) participa en un gasto: cualquier atribucion vigente bloquea (base vacia).
  e := pg_temp.gasto(g, p_e, array[p_e, p_ana], '100', 'D1', r.edu);
  v := pg_temp.deja(g, p_ana, r.ana);
  if v <> 'ERR UNLINK_BLOCKED_ATTRIBUTION' then fallos := array_append(fallos, 'D1 «Soy nuevo» con deuda pudo dejar la identidad: ' || v); end if;
  -- D2 · ...y el escape «genero -> dejo -> vuelvo como nuevo» no existe: sigue bloqueado tras pagar? No: pagar es caja.
  --      Anulado el gasto, ya no atribuye nada: pasa.
  perform pg_temp.anula(e, r.edu);
  v := pg_temp.deja(g, p_ana, r.ana);
  if v like 'ERR%' then fallos := array_append(fallos, 'D2 sin atribucion vigente no pudo dejar la identidad: ' || v); end if;
  -- D3 · el creador con caja (pago el gasto de arriba): caja bloquea aunque el gasto este anulado? No: anulado no tiene caja vigente.
  --      Edu paga otro gasto vigente con Luis: caja Y atribucion.
  perform pg_temp.gasto(g, p_e, array[p_e, p_l], '100', 'D3', r.edu);
  v := pg_temp.deja(g, p_e, r.edu);
  if v <> 'ERR UNLINK_BLOCKED_ATTRIBUTION' then fallos := array_append(fallos, 'D3 el creador con cuota vigente pudo dejar la identidad: ' || v); end if;
  -- D4 · claim con historia previa: Bea reclama a Luis (que ya debe 50 por D3): la historia anterior no bloquea.
  perform pg_temp.reclama(tok, p_l, r.bea);
  v := pg_temp.deja(g, p_l, r.bea);
  if v like 'ERR%' then fallos := array_append(fallos, 'D4 reclamar a quien ya debia no pudo rectificarse: ' || v); end if;
  perform pg_temp.super();
  if (select count(*) from core.participant_user_link where participant_id = p_l) <> 0 then fallos := array_append(fallos, 'D4 el vinculo sigue'); end if;
  if cardinality(fallos) > 0 then raise exception 'D · create/new: %', array_to_string(fallos, ' | '); end if;
  raise notice 'D · new y create con atribucion vigente bloquean; sin ella pasan; reclamar a quien ya debia sigue siendo rectificable: OK';
end
$d$;

-- ═══════════════ E · efecto de la baja ════════════════════════════════════════
do $e$
declare r fx%rowtype; fallos text[] := '{}'; v text; tok text; v_link uuid; v_fact core.participant_unlink%rowtype;
  n_eff int; n_ver int; n_per int; n_merge int; n_base int; n_subj int; e uuid; v_debt bigint;
  g uuid := 'f4000000-0000-4000-8000-000000000701'; p_e uuid := 'f4000000-0000-4000-8000-000000000702';
  p_l uuid := 'f4000000-0000-4000-8000-000000000703'; p_q uuid := 'f4000000-0000-4000-8000-000000000704';
begin
  select * into r from fx;
  tok := pg_temp.grupo_nuevo(g, p_e, p_l, p_q);
  e := pg_temp.gasto(g, p_e, array[p_e, p_l], '200', 'E1', r.edu);          -- historia previa de Luis
  perform pg_temp.reclama(tok, p_l, r.bea);
  perform pg_temp.super();
  v_link := pg_temp.link_de(p_l);
  select count(*) into n_eff from core.effect; select count(*) into n_ver from core.operation_version;
  select count(*) into n_per from core.participant_period where participant_id = p_l;
  select count(*) into n_merge from core.participant_merge;
  select count(*) into n_base from core.link_baseline where link_id = v_link;
  select count(*) into n_subj from core.link_baseline_subject where link_id = v_link;
  -- Bea ve la deuda de Luis: en Saldos del grupo (-100) y en su Personal (atribucion por vinculo, que
  -- acumula lo de otros grupos de esta fixture: se mide el salto).
  perform pg_temp.actor(r.bea);
  if (select net_position::bigint from api.group_balance where scope_id = g and is_self) <> -100 then fallos := array_append(fallos, 'E0 Bea no ve la deuda de Luis en Saldos'); end if;
  v_debt := coalesce((select sum(amount::bigint) from api.claimed_dimension() where dimension = 'debt'), 0);
  perform pg_temp.super();
  v := pg_temp.deja(g, p_l, r.bea);
  if v like 'ERR%' then raise exception 'E baja: %', v; end if;
  perform pg_temp.super();
  -- E1 · vinculo y membresia propios fuera; nada mas.
  if exists (select 1 from core.participant_user_link where participant_id = p_l) then fallos := array_append(fallos, 'E1 el vinculo sigue'); end if;
  if exists (select 1 from core.membership where scope_id = g and user_id = r.bea) then fallos := array_append(fallos, 'E1 la membresia sigue'); end if;
  if exists (select 1 from core.membership where scope_id = g and user_id = r.edu) is not true then fallos := array_append(fallos, 'E1 la membresia de Edu se fue'); end if;
  if (select count(*) from core.effect) <> n_eff or (select count(*) from core.operation_version) <> n_ver then fallos := array_append(fallos, 'E1 la baja toco efectos o versiones'); end if;
  if (select count(*) from core.participant_period where participant_id = p_l) <> n_per
     or not exists (select 1 from core.participant_period where participant_id = p_l and valid_until is null) then fallos := array_append(fallos, 'E1 la presencia cambio o se cerro'); end if;
  if (select count(*) from core.participant_merge) <> n_merge then fallos := array_append(fallos, 'E1 fusiones tocadas'); end if;
  if (select count(*) from core.link_baseline where link_id = v_link) <> n_base or (select count(*) from core.link_baseline_subject where link_id = v_link) <> n_subj then
    fallos := array_append(fallos, 'E1 la linea base o S0 no sobrevivieron');
  end if;
  if not exists (select 1 from core.group_invitation where scope_id = g and revoked_at is null) then fallos := array_append(fallos, 'E1 la invitacion cambio'); end if;
  -- E2 · el hecho.
  select * into v_fact from core.participant_unlink where link_id = v_link;
  if v_fact.id is null or v_fact.participant_id <> p_l or v_fact.scope_id <> g or v_fact.user_id <> r.bea or v_fact.unlinked_by <> r.bea
     or v_fact.reason <> 'self' or v_fact.origin_command_id is null or v_fact.client_command_id = v_fact.origin_command_id then
    fallos := array_append(fallos, 'E2 el hecho no describe la instancia (titular, actor, origen, comando distinto del origen)');
  end if;
  if not exists (select 1 from core.provisioning_command pc where pc.created_by = r.bea and pc.client_command_id = v_fact.client_command_id and pc.command_type = 'participant.unlink') then
    fallos := array_append(fallos, 'E2 el comando de baja no es un participant.unlink del titular');
  end if;
  -- E3 · Personal de Bea: la deuda deja de atribuirse; el participante queda disponible.
  perform pg_temp.actor(r.bea);
  if coalesce((select sum(amount::bigint) from api.claimed_dimension() where dimension = 'debt'), 0) <> v_debt + 100 then fallos := array_append(fallos, 'E3 Bea sigue viendo la deuda de Luis en su Personal'); end if;
  if (select count(*) from api.group_profile where scope_id = g) <> 0 then fallos := array_append(fallos, 'E3 Bea sigue viendo el grupo'); end if;
  perform pg_temp.super();
  if not sec.participant_available(p_l, g) then fallos := array_append(fallos, 'E3 Luis no volvio a estar disponible'); end if;
  -- E4 · volver: rejoin NO; claim si, con instancia NUEVA; la anterior sigue en su hecho.
  v := pg_temp.call('redeem_invitation', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'token', tok, 'choice', 'rejoin'), r.bea);
  if v <> 'ERR REJOIN_NOT_AVAILABLE' then fallos := array_append(fallos, 'E4 rejoin tras la baja: ' || v); end if;
  perform pg_temp.reclama(tok, p_l, r.zoe);
  perform pg_temp.super();
  if pg_temp.link_de(p_l) = v_link then fallos := array_append(fallos, 'E4 la nueva instancia reutilizo el link_id'); end if;
  if (select count(*) from core.participant_unlink where link_id = v_link) <> 1 then fallos := array_append(fallos, 'E4 el hecho anterior cambio'); end if;
  if cardinality(fallos) > 0 then raise exception 'E · efecto: %', array_to_string(fallos, ' | '); end if;
  raise notice 'E · solo vinculo y membresia propios; presencia, hechos, fusiones, base e invitaciones intactos; hecho completo; Personal por lectura; disponible; rejoin no, claim si con instancia nueva: OK';
end
$e$;

-- ═══════════════ F · LINK_SUPERSEDED uniforme; quien salio ═══════════════════
do $f2$
declare r fx%rowtype; fallos text[] := '{}'; v text; tok text; n_fact int; n_not int; n_cmd int; l_zoe uuid; l_edu uuid;
  g uuid := 'f4000000-0000-4000-8000-000000000701'; p_e uuid := 'f4000000-0000-4000-8000-000000000702';
  p_l uuid := 'f4000000-0000-4000-8000-000000000703'; p_q uuid := 'f4000000-0000-4000-8000-000000000704';
  g2 uuid := 'f4000000-0000-4000-8000-000000000801'; p_e2 uuid := 'f4000000-0000-4000-8000-000000000802';
  p_l2 uuid := 'f4000000-0000-4000-8000-000000000803'; p_q2 uuid := 'f4000000-0000-4000-8000-000000000804';
begin
  select * into r from fx;
  perform pg_temp.super();
  l_zoe := pg_temp.link_de(p_l); l_edu := pg_temp.link_de(p_e);
  select count(*) into n_fact from core.participant_unlink; select count(*) into n_not from core.group_notice;
  select count(*) into n_cmd from core.provisioning_command where command_type = 'participant.unlink';
  -- F1 · inexistente / ajeno / antiguo (el de Bea, ya terminado): el MISMO codigo.
  v := pg_temp.deja(g, p_l, r.zoe, gen_random_uuid());
  if v <> 'ERR LINK_SUPERSEDED' then fallos := array_append(fallos, 'F1 inexistente: ' || v); end if;
  v := pg_temp.deja(g, p_e, r.zoe, l_edu);                                        -- el de Edu, con su participante
  if v <> 'ERR LINK_SUPERSEDED' then fallos := array_append(fallos, 'F1 ajeno: ' || v); end if;
  v := pg_temp.deja(g, p_l, r.zoe, (select link_id from core.participant_unlink where participant_id = p_l));  -- el antiguo de Bea sobre el mismo participante
  if v <> 'ERR LINK_SUPERSEDED' then fallos := array_append(fallos, 'F1 antiguo: ' || v); end if;
  v := pg_temp.deja(g, p_l, r.edu, l_zoe);                                        -- Edu con el link_id de Zoe
  if v <> 'ERR LINK_SUPERSEDED' then fallos := array_append(fallos, 'F1 de otro, correcto pero ajeno: ' || v); end if;
  perform pg_temp.super();
  if (select count(*) from core.participant_unlink) <> n_fact or (select count(*) from core.group_notice) <> n_not
     or (select count(*) from core.provisioning_command where command_type = 'participant.unlink') <> n_cmd then
    fallos := array_append(fallos, 'F1 un rechazo escribio algo (hecho, aviso o clave)');
  end if;
  if exists (select 1 from core.participant_user_link where link_id in (l_zoe, l_edu)) is not true then fallos := array_append(fallos, 'F1 un rechazo borro un vinculo'); end if;
  -- F2 · quien salio (sin membresia) no puede dejar su instancia: NOT_AUTHORIZED, vinculo intacto.
  perform pg_temp.grupo_nuevo(g2, p_e2, p_l2, p_q2);
  v := pg_temp.call('leave_group', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', g2), r.edu);
  if v like 'ERR%' then raise exception 'F2 leave: %', v; end if;
  v := pg_temp.deja(g2, p_e2, r.edu);
  if v <> 'ERR NOT_AUTHORIZED' then fallos := array_append(fallos, 'F2 quien salio: ' || v); end if;
  perform pg_temp.super();
  if not exists (select 1 from core.participant_user_link where participant_id = p_e2) then fallos := array_append(fallos, 'F2 el vinculo de quien salio se fue'); end if;
  if cardinality(fallos) > 0 then raise exception 'F · uniformidad: %', array_to_string(fallos, ' | '); end if;
  raise notice 'F · inexistente, ajeno y antiguo responden LINK_SUPERSEDED sin escribir nada; quien salio, NOT_AUTHORIZED: OK';
end
$f2$;

-- ═══════════════ G · replay ═══════════════════════════════════════════════════
do $g$
declare r fx%rowtype; fallos text[] := '{}'; v1 text; v2 text; tok text; k uuid := gen_random_uuid(); n_fact int; n_not int;
  g uuid := 'f4000000-0000-4000-8000-000000000901'; p_e uuid := 'f4000000-0000-4000-8000-000000000902';
  p_l uuid := 'f4000000-0000-4000-8000-000000000903'; p_q uuid := 'f4000000-0000-4000-8000-000000000904'; l uuid;
begin
  select * into r from fx;
  tok := pg_temp.grupo_nuevo(g, p_e, p_l, p_q);
  perform pg_temp.reclama(tok, p_l, r.bea);
  perform pg_temp.super(); l := pg_temp.link_de(p_l);
  v1 := pg_temp.deja(g, p_l, r.bea, l, k);
  if v1 like 'ERR%' then raise exception 'G baja: %', v1; end if;
  perform pg_temp.super();
  select count(*) into n_fact from core.participant_unlink; select count(*) into n_not from core.group_notice where kind = 'identity_released';
  -- G1 · misma clave: misma respuesta (unlink_id), already_processed, nada nuevo.
  v2 := pg_temp.deja(g, p_l, r.bea, l, k);
  perform pg_temp.super();
  if (v2::jsonb ->> 'already_processed') <> 'true' or (v2::jsonb ->> 'unlink_id') <> (v1::jsonb ->> 'unlink_id') then fallos := array_append(fallos, 'G1 replay: ' || v2); end if;
  if (select count(*) from core.participant_unlink) <> n_fact or (select count(*) from core.group_notice where kind = 'identity_released') <> n_not then
    fallos := array_append(fallos, 'G1 el replay duplico hecho o aviso');
  end if;
  -- G2 · misma clave con otra intencion: IDEMPOTENCY_KEY_REUSED.
  v2 := pg_temp.deja(g, p_l, r.bea, gen_random_uuid(), k);
  if v2 <> 'ERR IDEMPOTENCY_KEY_REUSED' then fallos := array_append(fallos, 'G2: ' || v2); end if;
  -- G3 · Zoe reclama a Luis (instancia nueva); el replay de Bea sigue devolviendo su resultado y NO toca la de Zoe.
  perform pg_temp.reclama(tok, p_l, r.zoe);
  v2 := pg_temp.deja(g, p_l, r.bea, l, k);
  perform pg_temp.super();
  if (v2::jsonb ->> 'already_processed') <> 'true' then fallos := array_append(fallos, 'G3 replay tras instancia posterior: ' || v2); end if;
  if pg_temp.link_de(p_l) is null then fallos := array_append(fallos, 'G3 el replay toco la instancia de Zoe'); end if;
  -- G4 · clave nueva de Bea contra su instancia ya terminada: ya no es miembro NI tiene vinculo en el
  --      grupo: la respuesta uniforme de §8/§9, LINK_SUPERSEDED, sin distinguir nada del link_id.
  v2 := pg_temp.deja(g, p_l, r.bea, l);
  if v2 <> 'ERR LINK_SUPERSEDED' then fallos := array_append(fallos, 'G4: ' || v2); end if;
  if cardinality(fallos) > 0 then raise exception 'G · replay: %', array_to_string(fallos, ' | '); end if;
  raise notice 'G · replay devuelve el resultado original sin duplicar hecho ni aviso, tambien tras una instancia posterior; intencion distinta rehusada: OK';
end
$g$;

-- ═══════════════ H · identity_released ════════════════════════════════════════
do $h$
declare r fx%rowtype; fallos text[] := '{}'; v text; tok text; n int; v_fact uuid; v_newest uuid;
  g uuid := 'f4000000-0000-4000-8000-000000000a01'; p_e uuid := 'f4000000-0000-4000-8000-000000000a02';
  p_l uuid := 'f4000000-0000-4000-8000-000000000a03'; p_q uuid := 'f4000000-0000-4000-8000-000000000a04'; p_ana uuid;
begin
  select * into r from fx;
  tok := pg_temp.grupo_nuevo(g, p_e, p_l, p_q);
  v := pg_temp.call('redeem_invitation', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'token', tok, 'choice', 'new', 'display_name', 'Ana'), r.ana);
  p_ana := (v::jsonb ->> 'participant_id')::uuid;
  perform pg_temp.reclama(tok, p_l, r.bea);
  perform pg_temp.super();
  select count(*) into n from core.group_notice where scope_id = g;
  -- H0 · un rechazo (Bea con link ajeno) no crea aviso.
  v := pg_temp.deja(g, p_e, r.bea, pg_temp.link_de(p_e));
  perform pg_temp.super();
  if (select count(*) from core.group_notice where scope_id = g) <> n then fallos := array_append(fallos, 'H0 un rechazo creo aviso'); end if;
  v := pg_temp.deja(g, p_l, r.bea);
  if v like 'ERR%' then raise exception 'H baja: %', v; end if;
  v_fact := (v::jsonb ->> 'unlink_id')::uuid;
  perform pg_temp.super();
  -- H1 · en core: uno por miembro que queda (Edu, Ana), ninguno para Bea, ligado al hecho.
  if (select count(*) from core.group_notice where scope_id = g and kind = 'identity_released' and subject_id = v_fact) <> 2
     or exists (select 1 from core.group_notice where kind = 'identity_released' and subject_id = v_fact and recipient_user_id = r.bea)
     or not exists (select 1 from core.group_notice where kind = 'identity_released' and subject_id = v_fact and recipient_user_id = r.ana) then
    fallos := array_append(fallos, 'H1 destinatarios');
  end if;
  -- H2 · OCULTO al cliente vigente: ni en la vista ni marcado por «visto».
  select id into v_newest from core.group_notice where recipient_user_id = r.ana order by occurred_at desc limit 1;
  perform pg_temp.actor(r.ana);
  if exists (select 1 from api.group_notice where kind = 'identity_released') then fallos := array_append(fallos, 'H2 la vista publica el kind'); end if;
  perform api.mark_group_notices_seen(v_newest);
  perform pg_temp.super();
  if exists (select 1 from core.group_notice where kind = 'identity_released' and subject_id = v_fact and read_at is not null) then
    fallos := array_append(fallos, 'H2 «visto» marco un aviso que el cliente no ve');
  end if;
  -- H3 · lo que la vista publicara en A3 ya resuelve al participante sin datos de la cuenta; y ninguna cuenta lee user_id.
  if (select p.display_name from core.participant_unlink u join core.participant p on p.id = u.participant_id where u.id = v_fact) <> 'Luis' then
    fallos := array_append(fallos, 'H3 el hecho no resuelve al participante');
  end if;
  -- (authenticated no tiene USAGE sobre core: solo llega por las vistas security_invoker de api, que
  --  resuelven por oid; el privilegio se mide por columna, que es lo que esas vistas comprueban.)
  if has_column_privilege('authenticated', 'core.participant_unlink', 'user_id', 'select')
     or has_column_privilege('authenticated', 'core.participant_unlink', 'unlinked_by', 'select')
     or has_column_privilege('authenticated', 'core.participant_unlink', 'origin_command_id', 'select')
     or has_column_privilege('authenticated', 'core.participant_unlink', 'client_command_id', 'select') then
    fallos := array_append(fallos, 'H3 authenticated puede leer columnas de la cuenta en el hecho');
  end if;
  if not (has_column_privilege('authenticated', 'core.participant_unlink', 'id', 'select')
          and has_column_privilege('authenticated', 'core.participant_unlink', 'participant_id', 'select')
          and has_column_privilege('authenticated', 'core.participant_unlink', 'scope_id', 'select')) then
    fallos := array_append(fallos, 'H3 authenticated no puede leer las tres columnas del aviso');
  end if;
  if cardinality(fallos) > 0 then raise exception 'H · aviso: %', array_to_string(fallos, ' | '); end if;
  raise notice 'H · identity_released en core a los que quedan y no al actor, ligado al hecho, sin aviso en rechazo, oculto a la vista y a «visto» del cliente vigente, sin datos de la cuenta: OK';
end
$h$;

-- ═══════════════ I · el wrapper legado ═══════════════════════════════════════
do $i$
declare r fx%rowtype; fallos text[] := '{}'; v text; v2 text; tok text; k uuid; kb uuid; v_fact core.participant_unlink%rowtype; p_ana uuid; e uuid; n_cmd int;
  g uuid := 'f4000000-0000-4000-8000-000000000b01'; p_e uuid := 'f4000000-0000-4000-8000-000000000b02';
  p_l uuid := 'f4000000-0000-4000-8000-000000000b03'; p_q uuid := 'f4000000-0000-4000-8000-000000000b04';
begin
  select * into r from fx;
  tok := pg_temp.grupo_nuevo(g, p_e, p_l, p_q);
  k := gen_random_uuid();
  v := pg_temp.call('redeem_invitation', jsonb_build_object('client_command_id', k, 'command_contract_version', 1, 'token', tok, 'choice', 'claim', 'participant_id', p_l), r.bea);
  if v like 'ERR%' then raise exception 'I claim: %', v; end if;
  v := pg_temp.call('redeem_invitation', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'token', tok, 'choice', 'new', 'display_name', 'Ana'), r.ana);
  p_ana := (v::jsonb ->> 'participant_id')::uuid;
  perform pg_temp.super();
  select count(*) into n_cmd from core.provisioning_command where created_by = r.bea;
  -- I0 · el origen NUNCA vale como clave de baja: citar k como client_command_id es la clave de la
  --      reclamacion con otra intencion: IDEMPOTENCY_KEY_REUSED, y el vinculo sigue.
  v2 := pg_temp.call('unclaim_participant', jsonb_build_object('client_command_id', k, 'command_contract_version', 1,
         'scope_id', g, 'participant_id', p_l, 'claim_command_id', k), r.bea);
  perform pg_temp.super();
  if v2 <> 'ERR IDEMPOTENCY_KEY_REUSED' or pg_temp.link_de(p_l) is null then fallos := array_append(fallos, 'I0 el origen como clave de baja: ' || v2); end if;
  -- I1 · la firma vieja: {client_command_id, scope_id, participant_id, claim_command_id}. El origen es k;
  --      la clave de la baja es kb, la que el cliente conserva entre reintentos. Un comando
  --      participant.unlink con ESA clave y un hecho que cita ambos, distintos.
  kb := gen_random_uuid();
  v := pg_temp.call('unclaim_participant', jsonb_build_object('client_command_id', kb, 'command_contract_version', 1,
         'scope_id', g, 'participant_id', p_l, 'claim_command_id', k), r.bea);
  if v like 'ERR%' or (v::jsonb ->> 'already_processed') <> 'false' then fallos := array_append(fallos, 'I1 wrapper: ' || v); end if;
  perform pg_temp.super();
  select * into v_fact from core.participant_unlink where participant_id = p_l;
  if v_fact.origin_command_id <> k or v_fact.client_command_id <> kb then fallos := array_append(fallos, 'I1 el hecho no cita origen = k y comando de baja = kb'); end if;
  if not exists (select 1 from core.provisioning_command where created_by = r.bea and client_command_id = kb and command_type = 'participant.unlink')
     or not exists (select 1 from core.provisioning_command where created_by = r.bea and client_command_id = k and command_type = 'invitation.redeem') then
    fallos := array_append(fallos, 'I1 origen y comando de baja no apuntan a comandos distintos de tipos distintos');
  end if;
  if (select count(*) from core.provisioning_command where created_by = r.bea) <> n_cmd + 1 then fallos := array_append(fallos, 'I1 la baja reclamo mas de un comando'); end if;
  -- I2 · retry con la MISMA clave (respuesta perdida): mismo hecho, ningun comando adicional.
  v2 := pg_temp.call('unclaim_participant', jsonb_build_object('client_command_id', kb, 'command_contract_version', 1,
         'scope_id', g, 'participant_id', p_l, 'claim_command_id', k), r.bea);
  if (v2::jsonb ->> 'already_processed') <> 'true' then fallos := array_append(fallos, 'I2 retry: ' || v2); end if;
  perform pg_temp.super();
  if (select count(*) from core.participant_unlink where participant_id = p_l) <> 1 then fallos := array_append(fallos, 'I2 segundo hecho'); end if;
  if (select count(*) from core.provisioning_command where created_by = r.bea) <> n_cmd + 1 then fallos := array_append(fallos, 'I2 el retry dejo un comando adicional'); end if;
  -- I3 · la misma clave con otra intencion (otro participante, u otro origen): IDEMPOTENCY_KEY_REUSED, nada nuevo.
  v2 := pg_temp.call('unclaim_participant', jsonb_build_object('client_command_id', kb, 'command_contract_version', 1,
         'scope_id', g, 'participant_id', p_q, 'claim_command_id', k), r.bea);
  if v2 <> 'ERR IDEMPOTENCY_KEY_REUSED' then fallos := array_append(fallos, 'I3 otra intencion, misma clave: ' || v2); end if;
  v2 := pg_temp.call('unclaim_participant', jsonb_build_object('client_command_id', kb, 'command_contract_version', 1,
         'scope_id', g, 'participant_id', p_l, 'claim_command_id', gen_random_uuid()), r.bea);
  if v2 <> 'ERR IDEMPOTENCY_KEY_REUSED' then fallos := array_append(fallos, 'I3 otro origen, misma clave: ' || v2); end if;
  perform pg_temp.super();
  if (select count(*) from core.provisioning_command where created_by = r.bea) <> n_cmd + 1 then fallos := array_append(fallos, 'I3 un rechazo dejo un comando'); end if;
  -- Luis, fantasma, paga un gasto (sin caja: no tiene cuenta) ANTES de que Zoe lo reclame.
  e := pg_temp.gasto(g, p_l, array[p_l, p_e], '60', 'Cash', r.edu);
  -- I4 · Zoe reclama a Luis y Bea reintenta con su clave: sigue siendo replay de SU hecho; Zoe intacta.
  perform pg_temp.reclama(tok, p_l, r.zoe);
  v2 := pg_temp.call('unclaim_participant', jsonb_build_object('client_command_id', kb, 'command_contract_version', 1,
         'scope_id', g, 'participant_id', p_l, 'claim_command_id', k), r.bea);
  perform pg_temp.super();
  if (v2::jsonb ->> 'already_processed') <> 'true' or pg_temp.link_de(p_l) is null then fallos := array_append(fallos, 'I4: ' || v2); end if;
  -- I4b · Bea con una clave NUEVA tras su baja: ya no tiene vinculo ni membresia; el wrapper no encuentra
  --       vinculo con ese origen: CLAIM_SUPERSEDED (§11), sin tocar la instancia de Zoe ni dejar clave.
  v2 := pg_temp.call('unclaim_participant', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
         'scope_id', g, 'participant_id', p_l, 'claim_command_id', k), r.bea);
  perform pg_temp.super();
  if v2 <> 'ERR CLAIM_SUPERSEDED' or pg_temp.link_de(p_l) is null then fallos := array_append(fallos, 'I4b clave nueva tras la baja: ' || v2); end if;
  if (select count(*) from core.provisioning_command where created_by = r.bea) <> n_cmd + 1 then fallos := array_append(fallos, 'I4b dejo un comando'); end if;
  -- I5 · codigos del cliente vigente: origen que no es el vigente -> CLAIM_SUPERSEDED; «Soy nuevo» -> UNCLAIM_NOT_AVAILABLE.
  v2 := pg_temp.call('unclaim_participant', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
         'scope_id', g, 'participant_id', p_l, 'claim_command_id', gen_random_uuid()), r.zoe);
  if v2 <> 'ERR CLAIM_SUPERSEDED' then fallos := array_append(fallos, 'I5 origen equivocado: ' || v2); end if;
  v2 := pg_temp.call('unclaim_participant', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
         'scope_id', g, 'participant_id', p_ana, 'claim_command_id', (select origin_command_id from core.participant_user_link where participant_id = p_ana)), r.ana);
  if v2 <> 'ERR UNCLAIM_NOT_AVAILABLE' then fallos := array_append(fallos, 'I5 «Soy nuevo» por el wrapper: ' || v2); end if;
  -- I6 · caja por el wrapper: una correccion SOLO de concepto del gasto que Luis pago como fantasma deja la
  --      atribucion identica a la base (pasa) y escribe la caja del pagador, ahora vinculado, en el Personal de
  --      Zoe (F09/ADR-006 E1): UNCLAIM_BLOCKED_CASH con las operaciones, nombrado por §5 (p_legacy), sin handler.
  perform pg_temp.gasto(g, p_l, array[p_l, p_e], '60', 'Cash bis', r.edu, e);
  v2 := pg_temp.call('unclaim_participant', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
         'scope_id', g, 'participant_id', p_l, 'claim_command_id', (select origin_command_id from core.participant_user_link where participant_id = p_l)), r.zoe);
  if v2 <> 'ERR UNCLAIM_BLOCKED_CASH' or (select details from last) not like '%"operations"%' then fallos := array_append(fallos, 'I6 caja por el wrapper: ' || v2); end if;
  -- I7 · y por la API nueva, el mismo bloqueo con su codigo propio.
  v2 := pg_temp.deja(g, p_l, r.zoe);
  if v2 <> 'ERR UNLINK_BLOCKED_CASH' then fallos := array_append(fallos, 'I7: ' || v2); end if;
  if cardinality(fallos) > 0 then raise exception 'I · wrapper: %', array_to_string(fallos, ' | '); end if;
  raise notice 'I · el wrapper delega en la misma implementacion con la clave del cliente: origen = claim, comando de baja = client_command_id, retry sin comando adicional, otra intencion rehusada, replay tras instancia posterior, codigos legados sin handler, caja: OK';
end
$i$;

rollback;
