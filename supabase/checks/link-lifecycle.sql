-- ============================================================================
-- VINCULO ACTIVO Y VINCULO HISTORICO (F10/ADR-003) · contra las funciones
-- reales, aislado
-- ============================================================================
--
-- api.leave_group / api.preview_invitation / api.redeem_invitation /
-- api.associate_participant / api.retire_participant (migracion
-- 20260918120000) llamadas como cada cuenta, con invitaciones reales, y las
-- vistas leidas como un miembro. Las ayudas de lib/group-payment-helpers.sql
-- solo leen y envuelven. Todo en rollback.
--
--   { cat supabase/checks/lib/group-payment-helpers.sql; cat supabase/checks/link-lifecycle.sql; } | docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1
--
--   A · estructura: columnas, CHECK, indice parcial, una salida termina un
--       vinculo, ningun borrado para el provisioner
--   B · salir: el vinculo TERMINA con la salida que lo termino; quien salio
--       desaparece de Saldos, del recuento y de la foto de netos; sigue en
--       group_participant como is_departed; su nombre sigue en los gastos;
--       su Personal y su is_self siguen atribuidos; NO es reclamable ni
--       retirable ni asociable por otros; no es un participante disponible
--   C · volver como X: el MISMO vinculo se reactiva (link_id, procedencia),
--       vuelve a Saldos y al recuento; huella del grupo identica
--   D · elegir un fantasma: quien ya estuvo reclama a Ana; Aitor queda como
--       historia (sigue irreclamable); UNA sola identidad activa por cuenta y
--       grupo (indice parcial); la atribucion suma las dos historias
--   E · «nuevo» con identidad anterior: REJOIN_REQUIRED sin escribir; quien
--       nunca estuvo: participantes + nuevo, y rejoin REJOIN_NOT_AVAILABLE
--   F · la economia de F9 no cambia: salir con neto distinto de cero sigue
--       bloqueado; la novacion de salida sigue; la obligacion de quien salio
--       sigue intocable
\pset pager off
\set ON_ERROR_STOP on
begin;

create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  'a9d00000-0000-4000-8000-0000000000e1'::uuid as edu,   'a9d00000-0000-4000-8000-0000000000f1'::uuid as s_edu,
  'a9d00000-0000-4000-8000-0000000000a1'::uuid as aitor, 'a9d00000-0000-4000-8000-0000000000f2'::uuid as s_aitor,
  'a9d00000-0000-4000-8000-0000000000b1'::uuid as bea,   'a9d00000-0000-4000-8000-0000000000f3'::uuid as s_bea,
  'a9d00000-0000-4000-8000-0000000000c1'::uuid as nadie, 'a9d00000-0000-4000-8000-0000000000f4'::uuid as s_nadie,
  'a9d00000-0000-4000-8000-000000000010'::uuid as g1,
  'a9d00000-0000-4000-8000-000000000311'::uuid as a1,   -- Aitor (cuenta aitor)
  'a9d00000-0000-4000-8000-000000000321'::uuid as an1,  -- Ana (fantasma)
  'a9d00000-0000-4000-8000-000000000331'::uuid as l1,   -- Luis (fantasma)
  'a9d00000-0000-4000-8000-000000000341'::uuid as e1,   -- Edu
  'a9d00000-0000-4000-8000-000000000351'::uuid as b1,   -- Bea (cuenta bea)
  null::uuid as cat, null::uuid as x1, null::text as token;
grant select, update on fx to authenticated;

create function pg_temp.gasto(p_who uuid, p_key uuid, p_scope uuid, p_payer uuid, p_parts uuid[], p_total bigint,
                              p_concept text default 'Gasto', p_op uuid default null, p_date date default current_date - 1) returns text language plpgsql as $$
declare r fx%rowtype; v jsonb; v_payload jsonb;
begin
  select * into r from fx;
  v_payload := jsonb_build_object(
    'client_operation_id', p_key, 'command_contract_version', 1,
    'scope_id', p_scope, 'currency_definition_id', r.eur, 'total', p_total::text, 'effective_date', p_date::text,
    'concept', p_concept, 'category_id', r.cat, 'payer_participant_id', p_payer,
    'participants', to_jsonb(p_parts), 'split_method', jsonb_build_object('kind', 'equal'));
  if p_op is not null then
    v_payload := v_payload || jsonb_build_object('operation_id', p_op,
      'expected_version_id', (select current_version_id from core.operation where id = p_op));
  end if;
  perform pg_temp.gp_actor(p_who);
  v := api.record_group_expense(v_payload);
  perform pg_temp.gp_super();
  return 'OK ' || (v ->> 'operation_id');
exception when sqlstate 'PGRST' then
  perform pg_temp.gp_super();
  return sqlerrm::json ->> 'code';
end $$;
-- PREVISUALIZAR como p_who: 'estado[:identidad anterior][ · nombres disponibles]'.
create function pg_temp.preview(p_who uuid, p_token text) returns text language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.gp_actor(p_who);
  v := api.preview_invitation(p_token);
  perform pg_temp.gp_super();
  return (v ->> 'state')
      || coalesce(':' || pg_temp.gp_name((v -> 'previous_participant' ->> 'participant_id')::uuid), '')
      || coalesce(' · ' || (select string_agg(x ->> 'display_name', ',' order by x ->> 'display_name') from jsonb_array_elements(v -> 'participants') x), '');
end $$;
-- CANJEAR como p_who: 'OK[ rejoined][ already_member]' / 'REPLAY' / estado / codigo.
create function pg_temp.canjear(p_who uuid, p_key uuid, p_token text, p_choice text, p_participant uuid default null, p_name text default null) returns text language plpgsql as $$
declare v jsonb; v_payload jsonb;
begin
  v_payload := jsonb_build_object('client_command_id', p_key, 'command_contract_version', 1, 'token', p_token, 'choice', p_choice);
  if p_participant is not null then v_payload := v_payload || jsonb_build_object('participant_id', p_participant); end if;
  if p_name is not null then v_payload := v_payload || jsonb_build_object('display_name', p_name); end if;
  perform pg_temp.gp_actor(p_who);
  v := api.redeem_invitation(v_payload);
  perform pg_temp.gp_super();
  if (v ->> 'state') <> 'ok' then return v ->> 'state'; end if;
  return case when (v ->> 'already_processed')::boolean then 'REPLAY' else 'OK' end
      || case when (v ->> 'rejoined')::boolean then ' rejoined' else '' end
      || case when (v ->> 'already_member')::boolean then ' already_member' else '' end;
exception when sqlstate 'PGRST' then
  perform pg_temp.gp_super();
  return sqlerrm::json ->> 'code';
end $$;
-- ASOCIAR / RETIRAR como p_who: 'OK' / codigo.
create function pg_temp.asociar(p_who uuid, p_key uuid, p_scope uuid, p_source uuid) returns text language plpgsql as $$
begin
  perform pg_temp.gp_actor(p_who);
  perform api.associate_participant(jsonb_build_object('client_command_id', p_key, 'command_contract_version', 1, 'scope_id', p_scope, 'participant_id', p_source));
  perform pg_temp.gp_super();
  return 'OK';
exception when sqlstate 'PGRST' then
  perform pg_temp.gp_super();
  return sqlerrm::json ->> 'code';
end $$;
create function pg_temp.retirar(p_who uuid, p_key uuid, p_scope uuid, p_target uuid) returns text language plpgsql as $$
begin
  perform pg_temp.gp_actor(p_who);
  perform api.retire_participant(jsonb_build_object('client_operation_id', p_key, 'command_contract_version', 1, 'scope_id', p_scope, 'participant_id', p_target, 'expected_pairs', '[]'::jsonb));
  perform pg_temp.gp_super();
  return 'OK';
exception when sqlstate 'PGRST' then
  perform pg_temp.gp_super();
  return sqlerrm::json ->> 'code';
end $$;
-- LAS VISTAS DEL PRESENTE, como p_who: 'saldos=<nombres> recuento=<n> foto=<n filas>'.
create function pg_temp.presente(p_who uuid, p_scope uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.gp_actor(p_who);
  v := 'saldos=' || coalesce((select string_agg(display_name, ',' order by display_name) from api.group_balance where scope_id = p_scope), '-')
    || ' recuento=' || (select participant_count from api.group_profile where scope_id = p_scope)
    || ' foto=' || (select count(*) from jsonb_array_elements(pg_temp.gp_expected(p_scope)));
  perform pg_temp.gp_super();
  return v;
end $$;
-- Un participante en api.group_participant, como p_who: 'is_self/is_active/is_linked/is_departed' o 'ausente'.
create function pg_temp.fila(p_who uuid, p_participant uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.gp_actor(p_who);
  select is_self::text || '/' || is_active::text || '/' || is_linked::text || '/' || is_departed::text into v
    from api.group_participant where participant_id = p_participant;
  perform pg_temp.gp_super();
  return coalesce(v, 'ausente');
end $$;
-- El vinculo de un participante: 'activo' / 'historico:<salida coincide>' / '-'.
create function pg_temp.vinculo(p_participant uuid) returns text language sql stable as $$
  select coalesce((select case when l.ended_at is null then 'activo'
                               else 'historico:' || exists (select 1 from core.group_departure d where d.id = l.departure_id and d.participant_id = l.participant_id and d.left_at = l.ended_at)::text
                          end
                     from core.participant_user_link l where l.participant_id = p_participant), '-');
$$;
create function pg_temp.huella(p_scope uuid) returns text language sql stable as $$
  select 'participantes=' || (select count(*) from core.participant where scope_id = p_scope)
      || ' vinculos=' || (select count(*) from core.participant_user_link where scope_id = p_scope)
      || ' operaciones=' || (select count(*) from core.operation o join core.operation_version ov on ov.id = o.current_version_id join core.effect e on e.operation_version_id = ov.id where e.scope_id = p_scope)
      || ' efectos=' || (select count(*) from core.effect where scope_id = p_scope)
      || ' fusiones=' || (select count(*) from core.participant_merge where scope_id = p_scope)
      || ' salidas=' || (select count(*) from core.group_departure where scope_id = p_scope);
$$;
create function pg_temp.grupo(p_key uuid, p_g uuid, p_name text, p_edu uuid, p_parts jsonb, p_links jsonb) returns void language plpgsql as $$
declare r fx%rowtype; x jsonb;
begin
  select * into r from fx;
  perform pg_temp.gp_actor(r.edu);
  perform api.create_group(jsonb_build_object(
    'client_command_id', p_key, 'command_contract_version', 1,
    'client_group_id', p_g, 'display_name', p_name, 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', p_edu, 'creator_display_name', 'Edu', 'participants', p_parts));
  perform pg_temp.gp_super();
  for x in select * from jsonb_array_elements(p_links) loop
    insert into core.membership (scope_id, user_id) values (p_g, (x ->> 'user')::uuid);
    insert into core.participant_user_link (participant_id, scope_id, user_id) values ((x ->> 'participant')::uuid, p_g, (x ->> 'user')::uuid);
  end loop;
  update core.participant_period pp set valid_from = current_date - 10 from core.participant p where p.id = pp.participant_id and p.scope_id = p_g;
end $$;
grant execute on function pg_temp.gasto(uuid, uuid, uuid, uuid, uuid[], bigint, text, uuid, date), pg_temp.preview(uuid, text),
  pg_temp.canjear(uuid, uuid, text, text, uuid, text), pg_temp.asociar(uuid, uuid, uuid, uuid), pg_temp.retirar(uuid, uuid, uuid, uuid),
  pg_temp.presente(uuid, uuid), pg_temp.fila(uuid, uuid), pg_temp.vinculo(uuid), pg_temp.huella(uuid) to authenticated;

-- ============================ A · estructura =================================
do $a$
declare fallos text[] := '{}'; v_t text;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'core' and table_name = 'participant_user_link' and column_name = 'ended_at' and data_type = 'timestamp with time zone') then
    fallos := array_append(fallos, 'A1: falta participant_user_link.ended_at timestamptz');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'core.participant_user_link'::regclass and conname = 'participant_user_link_fin_coherente' and contype = 'c') then
    fallos := array_append(fallos, 'A2: falta el CHECK (ended_at is null) = (departure_id is null)');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'core.participant_user_link'::regclass and contype = 'f' and confrelid = 'core.group_departure'::regclass) then
    fallos := array_append(fallos, 'A3: departure_id no referencia core.group_departure');
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'core' and tablename = 'participant_user_link'
                  and indexname = 'participant_user_link_identidad_activa_unica' and indexdef like '%UNIQUE INDEX%(scope_id, user_id) WHERE (ended_at IS NULL)') then
    fallos := array_append(fallos, 'A4: falta el UNIQUE parcial (scope_id, user_id) WHERE ended_at IS NULL');
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'core.participant_user_link'::regclass and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (scope_id, user_id)') then
    fallos := array_append(fallos, 'A4b: sigue el UNIQUE total (scope_id, user_id): quien salio como Aitor no podria entrar como Ana');
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'core' and tablename = 'participant_user_link'
                  and indexname = 'participant_user_link_salida_unica' and indexdef like '%UNIQUE INDEX%(departure_id) WHERE (departure_id IS NOT NULL)') then
    fallos := array_append(fallos, 'A5: una salida deberia terminar a lo sumo un vinculo');
  end if;
  -- El provisioner: UPDATE solo de ended_at y departure_id, y ningun DELETE.
  select coalesce(string_agg(at.attname, ',' order by at.attname), '') into v_t
    from pg_attribute at cross join lateral aclexplode(at.attacl) a join pg_roles g on g.oid = a.grantee
   where at.attrelid = 'core.participant_user_link'::regclass and a.privilege_type = 'UPDATE' and g.rolname = 'nomey_provisioner';
  if v_t <> 'departure_id,ended_at' then fallos := array_append(fallos, 'A6: el provisioner actualiza [' || v_t || '] y deberia ser solo departure_id,ended_at'); end if;
  if has_table_privilege('nomey_provisioner', 'core.participant_user_link', 'delete') then
    fallos := array_append(fallos, 'A7: el provisioner sigue pudiendo borrar vinculos (la identidad es permanente, F10/ADR-002)');
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'participant_user_link' and cmd = 'DELETE') then
    fallos := array_append(fallos, 'A7b: queda una policy de DELETE sobre el vinculo');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'participant_user_link' and policyname = 'participant_user_link_provisioner_self_end' and cmd = 'UPDATE'
                  and qual like '%sec.request_actor_id()%' and with_check like '%sec.request_actor_id()%') then
    fallos := array_append(fallos, 'A8: la policy de terminar/reactivar no es self-only');
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'api' and table_name = 'group_participant' and column_name = 'is_departed') then
    fallos := array_append(fallos, 'A9: api.group_participant no publica is_departed');
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'api' and table_name = 'group_payment' and column_name = 'effective_time') then
    fallos := array_append(fallos, 'A10: api.group_payment no publica effective_time');
  end if;
  if array_length(fallos, 1) > 0 then raise exception 'FALLOS DE ESTRUCTURA: %', E'\n  - ' || array_to_string(fallos, E'\n  - '); end if;
  raise notice 'A · estructura del vinculo activo/historico: OK';
end $a$;

-- ============================ fixture ========================================
do $f$
declare r fx%rowtype; v jsonb; t text;
begin
  update fx set cat = (select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null);
  select * into r from fx;
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (r.s_edu, 'personal', r.eur, r.edu), (r.s_aitor, 'personal', r.eur, r.aitor), (r.s_bea, 'personal', r.eur, r.bea), (r.s_nadie, 'personal', r.eur, r.nadie);
  insert into core.membership (scope_id, user_id) values (r.s_edu, r.edu), (r.s_aitor, r.aitor), (r.s_bea, r.bea), (r.s_nadie, r.nadie);
  -- Edu crea con Aitor y Bea (cuentas) y Ana y Luis (fantasmas).
  perform pg_temp.grupo('a9d00000-0000-4000-8000-000000000020', r.g1, 'Ciclo', r.e1,
    jsonb_build_array(jsonb_build_object('client_participant_id', r.a1,  'display_name', 'Aitor'),
                      jsonb_build_object('client_participant_id', r.an1, 'display_name', 'Ana'),
                      jsonb_build_object('client_participant_id', r.l1,  'display_name', 'Luis'),
                      jsonb_build_object('client_participant_id', r.b1,  'display_name', 'Bea')),
    jsonb_build_array(jsonb_build_object('user', r.aitor, 'participant', r.a1), jsonb_build_object('user', r.bea, 'participant', r.b1)));
  perform pg_temp.gp_actor(r.edu);
  v := api.create_group_invitation(jsonb_build_object('client_command_id', 'a9d00000-0000-4000-8000-000000000021'::uuid, 'command_contract_version', 1, 'scope_id', r.g1));
  perform pg_temp.gp_super();
  update fx set token = v ->> 'token';
  -- X1: Aitor paga 400 entre Aitor, Ana, Luis y Edu (100 cada uno): Ana>Aitor 100, Luis>Aitor 100, Edu>Aitor 100.
  t := pg_temp.gasto(r.aitor, 'a9d00000-0000-4000-8000-000000000101', r.g1, r.a1, array[r.a1, r.an1, r.l1, r.e1], 400, 'Cena');
  if t not like 'OK %' then raise exception 'F1: %', t; end if; update fx set x1 = substr(t, 4)::uuid;
  select * into r from fx;
  if pg_temp.gp_pairs(r.g1) <> 'Ana>Aitor:100 Edu>Aitor:100 Luis>Aitor:100' then raise exception 'F2: %', pg_temp.gp_pairs(r.g1); end if;
  raise notice 'F · fixture: pares % · presente (Edu) %', pg_temp.gp_pairs(r.g1), pg_temp.presente(r.edu, r.g1);
end $f$;

-- ============================ B · salir ======================================
do $b$
declare r fx%rowtype; v text; v_link uuid; v_origin uuid; v_personal text;
begin
  select * into r from fx;
  -- F · con neto +300 no se sale (F09/ADR-007 C8): la economia de F9 manda.
  v := pg_temp.gp_leave(r.aitor, 'a9d00000-0000-4000-8000-000000000110', r.g1);
  if v not like 'LEAVE_BLOCKED_DEBT%' then raise exception 'F0: salio con neto: %', v; end if;
  if pg_temp.vinculo(r.a1) <> 'activo' then raise exception 'F0b: un rechazo toco el vinculo: %', pg_temp.vinculo(r.a1); end if;
  -- Todos le pagan; Aitor a cero y con pares vivos ajenos ninguno: sale.
  v := pg_temp.gp_pay(r.edu, 'a9d00000-0000-4000-8000-000000000111', r.g1, r.e1, r.a1, 100); if v not like 'OK %' then raise exception 'B0a: %', v; end if;
  v := pg_temp.gp_pay(r.aitor, 'a9d00000-0000-4000-8000-000000000112', r.g1, r.an1, r.a1, 100); if v not like 'OK %' then raise exception 'B0b: %', v; end if;
  v := pg_temp.gp_pay(r.aitor, 'a9d00000-0000-4000-8000-000000000113', r.g1, r.l1, r.a1, 100); if v not like 'OK %' then raise exception 'B0c: %', v; end if;
  if pg_temp.gp_pairs(r.g1) <> '-' then raise exception 'B0d: %', pg_temp.gp_pairs(r.g1); end if;
  select link_id, origin_command_id into v_link, v_origin from core.participant_user_link where participant_id = r.a1;
  v_personal := pg_temp.gp_personal(r.aitor);
  if pg_temp.presente(r.edu, r.g1) <> 'saldos=Aitor,Ana,Bea,Edu,Luis recuento=5 foto=5' then raise exception 'B0e: %', pg_temp.presente(r.edu, r.g1); end if;

  v := pg_temp.gp_leave(r.aitor, 'a9d00000-0000-4000-8000-000000000114', r.g1);
  if v <> 'OK' then raise exception 'B1: %', v; end if;
  -- B2 · el vinculo TERMINO, con la salida que lo termino, y sigue existiendo (mismo link_id y procedencia).
  if pg_temp.vinculo(r.a1) <> 'historico:true' then raise exception 'B2: %', pg_temp.vinculo(r.a1); end if;
  if (select link_id from core.participant_user_link where participant_id = r.a1) <> v_link then raise exception 'B2b: cambio el link_id'; end if;
  if (select origin_command_id from core.participant_user_link where participant_id = r.a1) is distinct from v_origin then raise exception 'B2c: cambio la procedencia'; end if;
  if exists (select 1 from core.membership where scope_id = r.g1 and user_id = r.aitor) then raise exception 'B2d: sigue siendo miembro'; end if;
  if not sec.participant_departed(r.a1, r.g1) then raise exception 'B2e: no esta salido para F9'; end if;
  -- B3 · el presente, como Edu: sin Aitor en Saldos, en el recuento ni en la foto de netos.
  raise notice 'B · fuera: presente (Edu) % · fila de Aitor % · fila de Ana %', pg_temp.presente(r.edu, r.g1), pg_temp.fila(r.edu, r.a1), pg_temp.fila(r.edu, r.an1);
  if pg_temp.presente(r.edu, r.g1) <> 'saldos=Ana,Bea,Edu,Luis recuento=4 foto=4' then raise exception 'B3: %', pg_temp.presente(r.edu, r.g1); end if;
  -- B4 · pero sigue en group_participant, marcado, con su nombre (los gastos anteriores lo nombran); Ana no esta marcada.
  if pg_temp.fila(r.edu, r.a1) <> 'false/false/true/true' then raise exception 'B4: %', pg_temp.fila(r.edu, r.a1); end if;
  if pg_temp.fila(r.edu, r.an1) <> 'false/true/false/false' then raise exception 'B4b: %', pg_temp.fila(r.edu, r.an1); end if;
  perform pg_temp.gp_actor(r.edu);
  if (select payer_participant_id from api.group_operation where operation_id = r.x1) <> r.a1 then raise exception 'B4c: el gasto dejo de nombrarlo'; end if;
  if (select display_name from api.group_participant where participant_id = (select payer_participant_id from api.group_operation where operation_id = r.x1)) <> 'Aitor' then raise exception 'B4d: el nombre del pagador se perdio'; end if;
  perform pg_temp.gp_super();
  -- B5 · su Personal y su atribucion (claimed_dimension) no cambian: la historia
  --      sigue siendo suya. Su is_self historico lo lee D4d, cuando vuelve a ser
  --      miembro (fuera del grupo no lee sus filas: RLS).
  if pg_temp.gp_personal(r.aitor) <> v_personal then raise exception 'B5: % → %', v_personal, pg_temp.gp_personal(r.aitor); end if;
  -- B6 · NO es un participante sin cuenta: ni disponible, ni reclamable, ni retirable, ni asociable.
  if sec.participant_available(r.a1, r.g1) then raise exception 'B6: quien salio aparece disponible'; end if;
  if pg_temp.preview(r.nadie, r.token) <> 'join · Ana,Luis' then raise exception 'B6b: %', pg_temp.preview(r.nadie, r.token); end if;
  v := pg_temp.canjear(r.nadie, 'a9d00000-0000-4000-8000-000000000115', r.token, 'claim', r.a1);
  if v <> 'PARTICIPANT_ALREADY_CLAIMED' then raise exception 'B6c: otra cuenta reclamo a quien salio: %', v; end if;
  if exists (select 1 from core.membership where scope_id = r.g1 and user_id = r.nadie) then raise exception 'B6d: un rechazo dio membresia'; end if;
  v := pg_temp.retirar(r.edu, 'a9d00000-0000-4000-8000-000000000116', r.g1, r.a1);
  if v <> 'PARTICIPANT_LINKED' then raise exception 'B6e: se retiro a quien salio: %', v; end if;
  v := pg_temp.asociar(r.edu, 'a9d00000-0000-4000-8000-000000000117', r.g1, r.a1);
  if v <> 'PARTICIPANT_LINKED' then raise exception 'B6f: se asocio a quien salio: %', v; end if;
  if pg_temp.vinculo(r.a1) <> 'historico:true' then raise exception 'B6g: algun rechazo toco el vinculo'; end if;
  -- B7 · replay de la salida: nada nuevo.
  v := pg_temp.gp_leave(r.aitor, 'a9d00000-0000-4000-8000-000000000114', r.g1);
  if v <> 'REPLAY' then raise exception 'B7: %', v; end if;
  raise notice 'B · salir: vinculo terminado, fuera del presente, historia y Personal intactos, ni reclamable ni retirable: OK';
end $b$;

-- ============================ C · volver como Aitor ==========================
do $c$
declare r fx%rowtype; v text; v_huella text; v_link uuid;
begin
  select * into r from fx;
  v_huella := pg_temp.huella(r.g1);
  select link_id into v_link from core.participant_user_link where participant_id = r.a1;
  -- C1 · quien ya estuvo ve: volver como Aitor MAS los fantasmas disponibles.
  if pg_temp.preview(r.aitor, r.token) <> 'rejoin:Aitor · Ana,Luis' then raise exception 'C1: %', pg_temp.preview(r.aitor, r.token); end if;
  -- C2 · vuelve: el MISMO vinculo se reactiva.
  v := pg_temp.canjear(r.aitor, 'a9d00000-0000-4000-8000-000000000121', r.token, 'rejoin');
  if v <> 'OK rejoined' then raise exception 'C2: %', v; end if;
  if pg_temp.vinculo(r.a1) <> 'activo' then raise exception 'C2b: %', pg_temp.vinculo(r.a1); end if;
  if (select link_id from core.participant_user_link where participant_id = r.a1) <> v_link then raise exception 'C2c: volver creo otra instancia'; end if;
  if not exists (select 1 from core.membership where scope_id = r.g1 and user_id = r.aitor) then raise exception 'C2d: sin membresia'; end if;
  if pg_temp.huella(r.g1) <> v_huella then raise exception 'C3: % → %', v_huella, pg_temp.huella(r.g1); end if;
  -- C4 · de vuelta al presente.
  if pg_temp.presente(r.edu, r.g1) <> 'saldos=Aitor,Ana,Bea,Edu,Luis recuento=5 foto=5' then raise exception 'C4: %', pg_temp.presente(r.edu, r.g1); end if;
  if pg_temp.fila(r.edu, r.a1) <> 'false/true/true/false' then raise exception 'C4b: %', pg_temp.fila(r.edu, r.a1); end if;
  if pg_temp.preview(r.aitor, r.token) <> 'member' then raise exception 'C5: %', pg_temp.preview(r.aitor, r.token); end if;
  raise notice 'C · volver como Aitor: el mismo vinculo reactivado, de vuelta a Saldos y al recuento: OK';
end $c$;

-- ============================ D · elegir un fantasma =========================
do $d$
declare r fx%rowtype; v text; v_n int; v_ok boolean;
begin
  select * into r from fx;
  -- Sale otra vez (a cero) y esta vez entra como Ana.
  v := pg_temp.gp_leave(r.aitor, 'a9d00000-0000-4000-8000-000000000131', r.g1);
  if v <> 'OK' then raise exception 'D0: %', v; end if;
  if pg_temp.vinculo(r.a1) <> 'historico:true' then raise exception 'D0b: %', pg_temp.vinculo(r.a1); end if;
  if (select count(*) from core.group_departure where participant_id = r.a1) <> 2 then raise exception 'D0c: dos salidas registradas'; end if;
  if pg_temp.preview(r.aitor, r.token) <> 'rejoin:Aitor · Ana,Luis' then raise exception 'D1: %', pg_temp.preview(r.aitor, r.token); end if;
  v := pg_temp.canjear(r.aitor, 'a9d00000-0000-4000-8000-000000000132', r.token, 'claim', r.an1);
  if v <> 'OK' then raise exception 'D2: %', v; end if;
  -- D3 · Ana es su identidad ACTIVA; Aitor sigue siendo historia. Dos vinculos de la misma cuenta en el grupo: uno activo.
  if pg_temp.vinculo(r.an1) <> 'activo' then raise exception 'D3: %', pg_temp.vinculo(r.an1); end if;
  if pg_temp.vinculo(r.a1) <> 'historico:true' then raise exception 'D3b: %', pg_temp.vinculo(r.a1); end if;
  select count(*) into v_n from core.participant_user_link where scope_id = r.g1 and user_id = r.aitor;
  if v_n <> 2 then raise exception 'D3c: vinculos de aitor en el grupo: %', v_n; end if;
  select count(*) into v_n from core.participant_user_link where scope_id = r.g1 and user_id = r.aitor and ended_at is null;
  if v_n <> 1 then raise exception 'D3d: identidades activas de aitor: %', v_n; end if;
  -- D4 · el presente, como Edu: Ana con cuenta (is_linked), Aitor fuera.
  if pg_temp.presente(r.edu, r.g1) <> 'saldos=Ana,Bea,Edu,Luis recuento=4 foto=4' then raise exception 'D4: %', pg_temp.presente(r.edu, r.g1); end if;
  if pg_temp.fila(r.edu, r.an1) <> 'false/true/true/false' then raise exception 'D4b: %', pg_temp.fila(r.edu, r.an1); end if;
  if pg_temp.fila(r.aitor, r.an1) <> 'true/true/true/false' then raise exception 'D4c: %', pg_temp.fila(r.aitor, r.an1); end if;
  if pg_temp.fila(r.aitor, r.a1) <> 'true/false/true/true' then raise exception 'D4d: is_self historico de Aitor: %', pg_temp.fila(r.aitor, r.a1); end if;
  -- D5 · Aitor (historia) sigue sin ser reclamable por nadie, tampoco por quien fue.
  if pg_temp.preview(r.nadie, r.token) <> 'join · Luis' then raise exception 'D5: %', pg_temp.preview(r.nadie, r.token); end if;
  v := pg_temp.canjear(r.nadie, 'a9d00000-0000-4000-8000-000000000133', r.token, 'claim', r.a1);
  if v <> 'PARTICIPANT_ALREADY_CLAIMED' then raise exception 'D5b: %', v; end if;
  -- D6 · UNA sola identidad activa por cuenta y grupo, estructural: un segundo vinculo activo de aitor se rehusa.
  v_ok := false;
  begin
    insert into core.participant_user_link (participant_id, scope_id, user_id) values (r.l1, r.g1, r.aitor);
    v_ok := true;
  exception when unique_violation then null;
  end;
  if v_ok then raise exception 'D6: dos identidades activas de la misma cuenta en el grupo'; end if;
  -- D7 · la atribucion suma las dos historias: la cuota de Aitor en X1 (100) y la de Ana (100) son de la cuenta aitor.
  perform pg_temp.gp_actor(r.aitor);
  if (select your_share from api.group_operation where operation_id = r.x1) <> '200' then raise exception 'D7: your_share = %', (select your_share from api.group_operation where operation_id = r.x1); end if;
  perform pg_temp.gp_super();
  -- D8 · asociar a Luis va a la identidad ACTIVA (Ana), nunca a la historica.
  v := pg_temp.asociar(r.aitor, 'a9d00000-0000-4000-8000-000000000134', r.g1, r.l1);
  if v <> 'OK' then raise exception 'D8: %', v; end if;
  if (select target_participant_id from core.participant_merge where source_participant_id = r.l1) <> r.an1 then raise exception 'D8b: asocio a la historica'; end if;
  -- D9 · salir como Ana termina el vinculo de Ana; Aitor sigue historia; volver ofrece la MAS RECIENTE (Ana).
  --      Todo este check corre en UNA transaccion (now() no avanza): se envejece la salida
  --      anterior una hora, como habria pasado en la vida real.
  update core.group_departure d set left_at = d.left_at - interval '1 hour' where d.id = (select l.departure_id from core.participant_user_link l where l.participant_id = r.a1);
  update core.participant_user_link l set ended_at = d.left_at from core.group_departure d where d.id = l.departure_id and l.participant_id = r.a1;
  v := pg_temp.gp_leave(r.aitor, 'a9d00000-0000-4000-8000-000000000135', r.g1);
  if v <> 'OK' then raise exception 'D9: %', v; end if;
  if pg_temp.vinculo(r.an1) <> 'historico:true' or pg_temp.vinculo(r.a1) <> 'historico:true' then raise exception 'D9b: % %', pg_temp.vinculo(r.an1), pg_temp.vinculo(r.a1); end if;
  if pg_temp.preview(r.aitor, r.token) <> 'rejoin:Ana' then raise exception 'D9c: %', pg_temp.preview(r.aitor, r.token); end if;
  raise notice 'D · elegir a Ana: identidad activa nueva, Aitor historia irreclamable, una sola activa, atribucion sumada: OK';
end $d$;

-- ============================ E · «nuevo» y quien nunca estuvo ===============
do $e$
declare r fx%rowtype; v text; v_huella text;
begin
  select * into r from fx;
  v_huella := pg_temp.huella(r.g1);
  -- E1 · quien ya estuvo no entra como nuevo; nada se escribe.
  v := pg_temp.canjear(r.aitor, 'a9d00000-0000-4000-8000-000000000141', r.token, 'new', null, 'Aitor bis');
  if v <> 'REJOIN_REQUIRED' then raise exception 'E1: %', v; end if;
  if exists (select 1 from core.membership where scope_id = r.g1 and user_id = r.aitor) then raise exception 'E1b: un rechazo dio membresia'; end if;
  if pg_temp.huella(r.g1) <> v_huella then raise exception 'E1c: % → %', v_huella, pg_temp.huella(r.g1); end if;
  -- E2 · quien nunca estuvo: sin identidad anterior (join), y «nuevo» entra.
  if pg_temp.preview(r.nadie, r.token) <> 'join' then raise exception 'E2: %', pg_temp.preview(r.nadie, r.token); end if;
  v := pg_temp.canjear(r.nadie, 'a9d00000-0000-4000-8000-000000000142', r.token, 'rejoin');
  if v <> 'REJOIN_NOT_AVAILABLE' then raise exception 'E2b: %', v; end if;
  v := pg_temp.canjear(r.nadie, 'a9d00000-0000-4000-8000-000000000143', r.token, 'new', null, 'Nadie');
  if v <> 'OK' then raise exception 'E2c: %', v; end if;
  if pg_temp.presente(r.edu, r.g1) <> 'saldos=Bea,Edu,Nadie recuento=3 foto=3' then raise exception 'E2d: %', pg_temp.presente(r.edu, r.g1); end if;
  raise notice 'E · nuevo con identidad anterior rehusado; quien nunca estuvo entra como nuevo: OK';
end $e$;

-- ============================ F · la economia de F9 sigue ====================
do $f9$
declare r fx%rowtype; v text; t text;
begin
  select * into r from fx;
  -- Aitor vuelve como Ana; Edu paga 300 entre Edu, Ana y Bea → Ana>Edu 100, Bea>Edu 100. Ana no puede salir con neto -100.
  v := pg_temp.canjear(r.aitor, 'a9d00000-0000-4000-8000-000000000151', r.token, 'rejoin');
  if v <> 'OK rejoined' then raise exception 'F1: %', v; end if;
  t := pg_temp.gasto(r.edu, 'a9d00000-0000-4000-8000-000000000152', r.g1, r.e1, array[r.e1, r.an1, r.b1], 300, 'Taxi', null, current_date);
  if t not like 'OK %' then raise exception 'F2: %', t; end if;
  if pg_temp.gp_pairs(r.g1) <> 'Ana>Edu:100 Bea>Edu:100' then raise exception 'F3: %', pg_temp.gp_pairs(r.g1); end if;
  v := pg_temp.gp_leave(r.aitor, 'a9d00000-0000-4000-8000-000000000153', r.g1);
  if v not like 'LEAVE_BLOCKED_DEBT%' then raise exception 'F4: salio debiendo: %', v; end if;
  -- Paga y sale: neto cero; el par Bea>Edu es ajeno y no se toca (sin novacion que hacer).
  v := pg_temp.gp_pay(r.aitor, 'a9d00000-0000-4000-8000-000000000154', r.g1, r.an1, r.e1, 100); if v not like 'OK %' then raise exception 'F5: %', v; end if;
  v := pg_temp.gp_leave(r.aitor, 'a9d00000-0000-4000-8000-000000000155', r.g1);
  if v <> 'OK' then raise exception 'F6: %', v; end if;
  if pg_temp.gp_pairs(r.g1) <> 'Bea>Edu:100' then raise exception 'F7: %', pg_temp.gp_pairs(r.g1); end if;
  -- La obligacion de quien salio es intocable (F09/ADR-008): corregir el gasto que nombra a Ana se rehusa.
  t := pg_temp.gasto(r.edu, 'a9d00000-0000-4000-8000-000000000156', r.g1, r.e1, array[r.e1, r.an1, r.b1], 600, 'Taxi', (substr(t, 4))::uuid, current_date);
  if t <> 'DEPARTED_OBLIGATION_CHANGED' then raise exception 'F8: %', t; end if;
  raise notice 'F · salida con neto bloqueada, sin novacion espuria, obligacion de quien salio intocable: OK';
end $f9$;

rollback;
