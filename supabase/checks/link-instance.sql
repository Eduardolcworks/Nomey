-- ============================================================================
-- INSTANCIA DE VINCULO: ESQUEMA, RELLENO Y ALTAS · F10/ADR-001 §1, §3, §7, §11
-- ============================================================================
--
-- Migraciones 20260915120000 (F10.A2.1) y 20260916120000 (F10.A2). Contra las
-- funciones REALES, con identidad simulada, fixtures propias y ROLLBACK. Lo que
-- se afirma es que toda instancia nace con identidad, procedencia, S0 y linea
-- base correctos, que nada de eso puede escribirse fuera de su ambito ni por
-- otra cuenta, que las relaciones son insert-only de verdad, que rejoin y
-- associate siguen como estaban y que la baja de una instancia nacida con una
-- fusion previa pasa (§4). La baja en si la mide unlink-evidence.sql.
--
--   A · catalogo y privilegios (intentando las escrituras prohibidas)
--   B · relleno: invariantes sobre la base viva
--   C · create_group: instancia del creador bajo el rango 1
--   D · redeem new / claim con historia real (gasto + settlement) / rejoin
--   E · claim de un destino de fusion: S0 con el origen y su linea base
--   F · integridad de ambito y de titular en las policies; associate y unclaim
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
create function pg_temp.provisioner(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true),
         set_config('role', 'nomey_provisioner', true);
$$;
grant execute on function pg_temp.actor(uuid), pg_temp.super(), pg_temp.provisioner(uuid)
  to authenticated, nomey_provisioner, nomey_writer;

-- api.<fn>(payload) como <who>; devuelve el json o 'ERR <code>'.
create function pg_temp.call(p_fn text, p_payload jsonb, p_who uuid) returns text
language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.actor(p_who);
  execute format('select api.%I($1)', p_fn) into v using p_payload;
  perform pg_temp.super();
  return v::text;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return 'ERR ' || (sqlerrm::json ->> 'code');
end $$;
grant execute on function pg_temp.call(text, jsonb, uuid) to authenticated;

-- Ejecuta una sentencia como <who> con el rol <role> y devuelve el SQLSTATE
-- ('OK' si no fallo). Para intentar las escrituras prohibidas.
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
  'f3000000-0000-4000-8000-0000000000a1'::uuid as edu,   -- creador
  'f3000000-0000-4000-8000-0000000000a2'::uuid as ana,   -- entra como nueva
  'f3000000-0000-4000-8000-0000000000a3'::uuid as bea,   -- reclama
  'f3000000-0000-4000-8000-0000000000a4'::uuid as zoe,   -- reclama despues de Bea
  'f3000000-0000-4000-8000-0000000000f1'::uuid as s_edu,
  'f3000000-0000-4000-8000-0000000000f2'::uuid as s_ana,
  'f3000000-0000-4000-8000-0000000000f3'::uuid as s_bea,
  'f3000000-0000-4000-8000-0000000000f4'::uuid as s_zoe,
  'f3000000-0000-4000-8000-000000000010'::uuid as g,
  'f3000000-0000-4000-8000-000000000011'::uuid as g2,    -- otro grupo, para la integridad de ambito
  'f3000000-0000-4000-8000-000000000031'::uuid as p_edu,
  'f3000000-0000-4000-8000-000000000032'::uuid as p_luis,
  'f3000000-0000-4000-8000-000000000033'::uuid as p_gus,
  'f3000000-0000-4000-8000-000000000041'::uuid as p_edu2,
  'f3000000-0000-4000-8000-000000000042'::uuid as p_otro, -- participante de g2
  'f3000000-0000-4000-8000-000000000061'::uuid as cmd_create,
  'f3000000-0000-4000-8000-000000000062'::uuid as cmd_new,
  'f3000000-0000-4000-8000-000000000063'::uuid as cmd_claim,
  null::uuid as p_ana, null::text as token, null::text as token2, null::uuid as op_e1, null::uuid as op_s1, null::uuid as op_sin;
grant select, update on fx to authenticated;

-- ═══════════════ A · catalogo y privilegios ═════════════════════════════════
do $a$
declare r fx%rowtype; fallos text[] := '{}'; v text; v_n int;
begin
  select * into r from fx;
  perform pg_temp.super();

  -- A1 · columnas y constraints del vinculo.
  if not exists (select 1 from information_schema.columns where table_schema = 'core' and table_name = 'participant_user_link'
                  and column_name = 'link_id' and is_nullable = 'NO' and column_default like 'gen_random_uuid()%') then
    fallos := array_append(fallos, 'A1 link_id no es not null con default gen_random_uuid()');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'core.participant_user_link'::regclass and contype = 'u'
                  and pg_get_constraintdef(oid) = 'UNIQUE (link_id)') then
    fallos := array_append(fallos, 'A1 falta UNIQUE (link_id)');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'core.participant_user_link'::regclass and contype = 'p'
                  and pg_get_constraintdef(oid) = 'PRIMARY KEY (participant_id)') then
    fallos := array_append(fallos, 'A1 la PK dejo de ser participant_id');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'core.participant_user_link'::regclass and contype = 'f'
                  and pg_get_constraintdef(oid) = 'FOREIGN KEY (user_id, origin_command_id) REFERENCES core.provisioning_command(created_by, client_command_id)') then
    fallos := array_append(fallos, 'A1 falta la FK compuesta de origin_command_id');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'core.participant_user_link'::regclass and contype = 'c'
                  and pg_get_constraintdef(oid) like '%claim_command_id IS NULL%OR%claim_command_id = origin_command_id%') then
    fallos := array_append(fallos, 'A1 falta el CHECK claim_command_id = origin_command_id');
  end if;

  -- A2 · linea base: FK compuesta version-operacion; sujetos: FK al participante;
  --      NINGUNA FK hacia participant_user_link (sobreviven a la baja).
  if not exists (select 1 from pg_constraint where conrelid = 'core.link_baseline'::regclass and contype = 'f'
                  and pg_get_constraintdef(oid) = 'FOREIGN KEY (operation_id, baseline_version_id) REFERENCES core.operation_version(operation_id, id)') then
    fallos := array_append(fallos, 'A2 falta la FK (operation_id, baseline_version_id) -> operation_version');
  end if;
  if exists (select 1 from pg_constraint where contype = 'f' and confrelid = 'core.participant_user_link'::regclass
              and conrelid in ('core.link_baseline'::regclass, 'core.link_baseline_subject'::regclass, 'core.participant_unlink'::regclass)) then
    fallos := array_append(fallos, 'A2 alguna relacion de instancia lleva FK al vinculo vivo: no sobreviviria a la baja');
  end if;

  -- A3 · participant_unlink: dos comandos distintos con dos FK independientes,
  --      unicidad (user_id, client_command_id), actor = titular, reason = self.
  select count(*) into v_n from pg_constraint where conrelid = 'core.participant_unlink'::regclass and contype = 'f'
    and confrelid = 'core.provisioning_command'::regclass;
  if v_n <> 2 then fallos := array_append(fallos, 'A3 participant_unlink no tiene dos FK a provisioning_command: ' || v_n); end if;
  if not exists (select 1 from pg_constraint where conrelid = 'core.participant_unlink'::regclass and contype = 'f'
                  and pg_get_constraintdef(oid) = 'FOREIGN KEY (user_id, client_command_id) REFERENCES core.provisioning_command(created_by, client_command_id)') then
    fallos := array_append(fallos, 'A3 el comando de baja no sigue la identidad (actor, comando)');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'core.participant_unlink'::regclass and contype = 'f'
                  and pg_get_constraintdef(oid) = 'FOREIGN KEY (user_id, origin_command_id) REFERENCES core.provisioning_command(created_by, client_command_id)') then
    fallos := array_append(fallos, 'A3 el origen de la instancia no sigue la identidad (actor, comando)');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'core.participant_unlink'::regclass and contype = 'u'
                  and pg_get_constraintdef(oid) = 'UNIQUE (user_id, client_command_id)') then
    fallos := array_append(fallos, 'A3 falta UNIQUE (user_id, client_command_id)');
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'core.participant_unlink'::regclass and contype = 'u'
              and pg_get_constraintdef(oid) = 'UNIQUE (client_command_id)') then
    fallos := array_append(fallos, 'A3 client_command_id tiene una unicidad global aislada');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'core.participant_unlink'::regclass and contype = 'c'
                  and pg_get_constraintdef(oid) = 'CHECK ((unlinked_by = user_id))') then
    fallos := array_append(fallos, 'A3 falta CHECK unlinked_by = user_id');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'core.participant_unlink'::regclass and contype = 'c'
                  and pg_get_constraintdef(oid) like '%reason = ''self''%') then
    fallos := array_append(fallos, 'A3 falta CHECK reason = self');
  end if;

  -- A4 · RLS en las tres; grants exactos; nada para el writer ni PUBLIC; el cliente solo
  --      las tres columnas del aviso en participant_unlink (20260916120000); nadie con
  --      update/delete.
  for v in select unnest(array['link_baseline', 'link_baseline_subject', 'participant_unlink']) loop
    if not (select relrowsecurity from pg_class where oid = ('core.' || v)::regclass) then
      fallos := array_append(fallos, 'A4 ' || v || ' sin RLS');
    end if;
    if exists (select 1 from information_schema.role_table_grants where table_schema = 'core' and table_name = v
                and grantee in ('nomey_writer', 'PUBLIC'))
       or exists (select 1 from information_schema.role_table_grants where table_schema = 'core' and table_name = v
                   and grantee = 'authenticated' and v <> 'participant_unlink') then
      fallos := array_append(fallos, 'A4 ' || v || ' tiene grants para authenticated, writer o PUBLIC');
    end if;
    if exists (select 1 from information_schema.role_table_grants where table_schema = 'core' and table_name = v
                and grantee <> 'postgres' and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')) then
      fallos := array_append(fallos, 'A4 ' || v || ' tiene update/delete/truncate para algun rol');
    end if;
  end loop;
  for v in select unnest(array['link_baseline', 'link_baseline_subject']) loop
    if (select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
         where table_schema = 'core' and table_name = v and grantee = 'nomey_provisioner') is distinct from 'INSERT,SELECT' then
      fallos := array_append(fallos, 'A4 el provisioner no tiene exactamente insert,select en ' || v);
    end if;
  end loop;
  if (select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
       where table_schema = 'core' and table_name = 'participant_unlink' and grantee = 'nomey_provisioner') is distinct from 'INSERT,SELECT'
     or (select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges
          where table_schema = 'core' and table_name = 'participant_unlink' and grantee = 'authenticated') is distinct from 'id,participant_id,scope_id' then
    fallos := array_append(fallos, 'A4 participant_unlink: el provisioner escribe y lee lo suyo; el cliente solo id, participant_id, scope_id');
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'core' and table_name = 'participant_user_link'
              and grantee <> 'postgres' and privilege_type = 'UPDATE') then
    fallos := array_append(fallos, 'A4 alguien tiene UPDATE sobre participant_user_link');
  end if;

  -- A5 · helpers: definer de postgres, search_path fijado, ejecutables solo por el provisioner.
  for v in select unnest(array['sec.participant_in_scope(uuid, uuid)', 'sec.version_touches_scope(uuid, uuid)', 'sec.link_baseline_rows(uuid, uuid[])']) loop
    if not exists (select 1 from pg_proc p join pg_roles o on o.oid = p.proowner
                    where p.oid = v::regprocedure and p.prosecdef and o.rolname = 'postgres'
                      and array_to_string(p.proconfig, ',') like '%search_path=%') then
      fallos := array_append(fallos, 'A5 ' || v || ' no es definer de postgres con search_path fijado');
    end if;
    if has_function_privilege('authenticated', v, 'execute') or has_function_privilege('nomey_writer', v, 'execute') then
      fallos := array_append(fallos, 'A5 ' || v || ' es ejecutable por authenticated o el writer');
    end if;
    if not has_function_privilege('nomey_provisioner', v, 'execute') then
      fallos := array_append(fallos, 'A5 ' || v || ' no es ejecutable por el provisioner');
    end if;
  end loop;

  -- A6 · las dos altas siguen siendo del provisioner.
  if (select o.rolname from pg_proc p join pg_roles o on o.oid = p.proowner where p.oid = 'api.create_group(jsonb)'::regprocedure) <> 'nomey_provisioner'
     or (select o.rolname from pg_proc p join pg_roles o on o.oid = p.proowner where p.oid = 'api.redeem_invitation(jsonb)'::regprocedure) <> 'nomey_provisioner' then
    fallos := array_append(fallos, 'A6 create_group o redeem_invitation ya no son del provisioner');
  end if;

  if cardinality(fallos) > 0 then raise exception 'A · catalogo: %', array_to_string(fallos, ' | '); end if;
  raise notice 'A · catalogo y privilegios: columnas, FKs independientes, RLS, grants minimos, insert-only, helpers: OK';
end
$a$;

-- ═══════════════ B · relleno: invariantes sobre la base viva ════════════════
do $b$
declare fallos text[] := '{}'; v_n int;
begin
  perform pg_temp.super();
  -- B1 · todo vinculo tiene link_id y fila de sujeto consigo mismo.
  select count(*) into v_n from core.participant_user_link l
   where not exists (select 1 from core.link_baseline_subject s where s.link_id = l.link_id and s.participant_id = l.participant_id);
  if v_n <> 0 then fallos := array_append(fallos, 'B1 vinculos sin sujeto propio: ' || v_n); end if;
  -- B2 · el origen, cuando existe, es un comando del titular en ese ambito y de un tipo que crea vinculo.
  select count(*) into v_n from core.participant_user_link l join core.provisioning_command pc
      on pc.created_by = l.user_id and pc.client_command_id = l.origin_command_id
   where pc.result_scope_id is distinct from l.scope_id
      or not (pc.command_type = 'group.create' or (pc.command_type = 'invitation.redeem' and pc.canonical_intent ->> 'choice' in ('new', 'claim')));
  if v_n <> 0 then fallos := array_append(fallos, 'B2 origenes que no son un comando de alta del titular en ese ambito: ' || v_n); end if;
  -- B3 · claim_command_id nunca dice otra cosa que el origen.
  select count(*) into v_n from core.participant_user_link where claim_command_id is not null and claim_command_id is distinct from origin_command_id;
  if v_n <> 0 then fallos := array_append(fallos, 'B3 claim_command_id distinto del origen: ' || v_n); end if;
  -- B4 · create/new: cero filas de linea base.
  select count(*) into v_n from core.participant_user_link l join core.provisioning_command pc
      on pc.created_by = l.user_id and pc.client_command_id = l.origin_command_id
   where (pc.command_type = 'group.create' or pc.canonical_intent ->> 'choice' = 'new')
     and exists (select 1 from core.link_baseline b where b.link_id = l.link_id);
  if v_n <> 0 then fallos := array_append(fallos, 'B4 vinculos create/new con linea base: ' || v_n); end if;
  -- B5 · toda fila de linea base apunta a una version de su operacion y a un
  --      ambito en el que la instancia existe o existio.
  select count(*) into v_n from core.link_baseline b join core.operation_version ov on ov.id = b.baseline_version_id
   where ov.operation_id <> b.operation_id;
  if v_n <> 0 then fallos := array_append(fallos, 'B5 versiones base de otra operacion: ' || v_n); end if;
  -- B6 · ningun sujeto de otro ambito que el de su instancia (vinculos vivos).
  select count(*) into v_n from core.link_baseline_subject s join core.participant_user_link l on l.link_id = s.link_id
    join core.participant p on p.id = s.participant_id where p.scope_id <> l.scope_id;
  if v_n <> 0 then fallos := array_append(fallos, 'B6 sujetos de otro ambito: ' || v_n); end if;
  if cardinality(fallos) > 0 then raise exception 'B · relleno: %', array_to_string(fallos, ' | '); end if;
  raise notice 'B · relleno sobre la base viva (% vinculos): OK', (select count(*) from core.participant_user_link);
end
$b$;

-- ═══════════════ fixture comun ══════════════════════════════════════════════
do $f$
declare r fx%rowtype; v text;
begin
  select * into r from fx;
  perform pg_temp.super();
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (r.s_edu, 'personal', r.eur, r.edu), (r.s_ana, 'personal', r.eur, r.ana),
    (r.s_bea, 'personal', r.eur, r.bea), (r.s_zoe, 'personal', r.eur, r.zoe);
  insert into core.membership (scope_id, user_id) values (r.s_edu, r.edu), (r.s_ana, r.ana), (r.s_bea, r.bea), (r.s_zoe, r.zoe);
  v := pg_temp.call('create_group', jsonb_build_object('client_command_id', r.cmd_create, 'command_contract_version', 1,
    'client_group_id', r.g, 'display_name', 'Instancia', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', r.p_edu, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(jsonb_build_object('client_participant_id', r.p_luis, 'display_name', 'Luis'),
                                      jsonb_build_object('client_participant_id', r.p_gus, 'display_name', 'Gus'))), r.edu);
  if v like 'ERR%' then raise exception 'fixture create_group: %', v; end if;
  v := pg_temp.call('create_group', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
    'client_group_id', r.g2, 'display_name', 'Otro', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', r.p_edu2, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(jsonb_build_object('client_participant_id', r.p_otro, 'display_name', 'Otro'))), r.edu);
  if v like 'ERR%' then raise exception 'fixture create_group g2: %', v; end if;
  v := pg_temp.call('create_group_invitation', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', r.g), r.edu);
  update fx set token = v::jsonb ->> 'token';
  v := pg_temp.call('create_group_invitation', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', r.g2), r.edu);
  update fx set token2 = v::jsonb ->> 'token';
end
$f$;

-- ═══════════════ C · create_group ═══════════════════════════════════════════
do $c$
declare r fx%rowtype; fallos text[] := '{}'; l record; v_n int;
begin
  select * into r from fx;
  perform pg_temp.super();
  select * into l from core.participant_user_link where participant_id = r.p_edu;
  if l.link_id is null then fallos := array_append(fallos, 'C1 el creador no tiene link_id'); end if;
  if l.origin_command_id is distinct from r.cmd_create then fallos := array_append(fallos, 'C1 el origen del creador no es su comando group.create'); end if;
  if l.claim_command_id is not null then fallos := array_append(fallos, 'C1 el creador lleva claim_command_id'); end if;
  select count(*) into v_n from core.link_baseline_subject where link_id = l.link_id;
  if v_n <> 1 or not exists (select 1 from core.link_baseline_subject where link_id = l.link_id and participant_id = r.p_edu) then
    fallos := array_append(fallos, 'C2 S0 del creador no es {P}: ' || v_n || ' filas');
  end if;
  if exists (select 1 from core.link_baseline where link_id = l.link_id) then fallos := array_append(fallos, 'C3 el creador tiene linea base'); end if;
  -- C4 · los fantasmas no tienen instancia ni sujetos.
  if exists (select 1 from core.link_baseline_subject where participant_id in (r.p_luis, r.p_gus)) then
    fallos := array_append(fallos, 'C4 un fantasma aparece como sujeto de alguna instancia');
  end if;
  -- C5 · el orden del rango 1 lo afirma group-identity-lock.sql sobre el cuerpo
  --      vivo; aqui solo se comprueba que la funcion lo llama.
  if position('sec.lock_participant_claims(' in pg_get_functiondef('api.create_group(jsonb)'::regprocedure)) = 0 then
    fallos := array_append(fallos, 'C5 create_group no toma el cerrojo de identidad');
  end if;
  if cardinality(fallos) > 0 then raise exception 'C · create_group: %', array_to_string(fallos, ' | '); end if;
  raise notice 'C · create_group: link_id, origen = group.create, S0 = {P}, sin linea base, cerrojo de rango 1: OK';
end
$c$;

-- ═══════════════ D · redeem new / claim con historia real / rejoin ═════════
do $d$
declare r fx%rowtype; fallos text[] := '{}'; v text; l record; v_n int; v_link uuid; v_base int; v_subj int;
begin
  select * into r from fx;
  -- D1 · Ana entra como NUEVA.
  v := pg_temp.call('redeem_invitation', jsonb_build_object('client_command_id', r.cmd_new, 'command_contract_version', 1,
         'token', r.token, 'choice', 'new', 'display_name', 'Ana'), r.ana);
  if v like 'ERR%' then raise exception 'D1 redeem new: %', v; end if;
  update fx set p_ana = (v::jsonb ->> 'participant_id')::uuid;
  select * into r from fx;
  perform pg_temp.super();
  select * into l from core.participant_user_link where participant_id = r.p_ana;
  if l.origin_command_id is distinct from r.cmd_new or l.claim_command_id is not null then
    fallos := array_append(fallos, 'D1 el origen de «Soy nuevo» no es su comando, o lleva claim_command_id');
  end if;
  if (select count(*) from core.link_baseline_subject where link_id = l.link_id) <> 1
     or exists (select 1 from core.link_baseline where link_id = l.link_id) then
    fallos := array_append(fallos, 'D1 «Soy nuevo» sin S0 = {P} o con linea base');
  end if;

  -- D2 · HISTORIA REAL de Luis antes de que nadie lo reclame: Edu paga 200 a
  --      medias con Luis (Luis>Edu 100), Luis liquida 40 sin caja (settlement
  --      -40), y un gasto SIN Luis que no debe entrar en su base.
  v := pg_temp.call('record_group_expense', jsonb_build_object('client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '200', 'effective_date', current_date::text, 'concept', 'E1', 'category_id', r.cat,
    'payer_participant_id', r.p_edu, 'participants', jsonb_build_array(r.p_edu, r.p_luis), 'split_method', jsonb_build_object('kind', 'equal')), r.edu);
  if v like 'ERR%' then raise exception 'D2 gasto: %', v; end if;
  update fx set op_e1 = (v::jsonb ->> 'operation_id')::uuid;
  v := pg_temp.call('record_debt_settlement', jsonb_build_object('client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'amount', '40', 'effective_date', current_date::text,
    'debtor_participant_id', r.p_luis, 'creditor_participant_id', r.p_edu), r.edu);
  if v like 'ERR%' then raise exception 'D2 settlement: %', v; end if;
  update fx set op_s1 = (v::jsonb ->> 'operation_id')::uuid;
  v := pg_temp.call('record_group_expense', jsonb_build_object('client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '50', 'effective_date', current_date::text, 'concept', 'SinLuis', 'category_id', r.cat,
    'payer_participant_id', r.p_edu, 'participants', jsonb_build_array(r.p_edu, r.p_ana), 'split_method', jsonb_build_object('kind', 'equal')), r.edu);
  if v like 'ERR%' then raise exception 'D2 gasto sin Luis: %', v; end if;
  update fx set op_sin = (v::jsonb ->> 'operation_id')::uuid;
  -- Una correccion de E1 ANTES de reclamar: la base ha de apuntar a la VIGENTE.
  select * into r from fx;
  v := pg_temp.call('record_group_expense', jsonb_build_object('client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '200', 'effective_date', current_date::text, 'concept', 'E1 bis', 'category_id', r.cat,
    'payer_participant_id', r.p_edu, 'participants', jsonb_build_array(r.p_edu, r.p_luis), 'split_method', jsonb_build_object('kind', 'equal'),
    'operation_id', r.op_e1, 'expected_version_id', (select current_version_id from core.operation where id = r.op_e1)), r.edu);
  if v like 'ERR%' then raise exception 'D2 correccion: %', v; end if;

  -- D3 · Bea RECLAMA a Luis: origen = su comando = claim_command_id; S0 = {Luis};
  --      linea base = {E1 (version vigente = la corregida), S1}, y NO «SinLuis».
  v := pg_temp.call('redeem_invitation', jsonb_build_object('client_command_id', r.cmd_claim, 'command_contract_version', 1,
         'token', r.token, 'choice', 'claim', 'participant_id', r.p_luis), r.bea);
  if v like 'ERR%' then raise exception 'D3 redeem claim: %', v; end if;
  perform pg_temp.super();
  select * into l from core.participant_user_link where participant_id = r.p_luis;
  if l.origin_command_id is distinct from r.cmd_claim or l.claim_command_id is distinct from r.cmd_claim then
    fallos := array_append(fallos, 'D3 la reclamacion no deja origen = claim_command_id = su comando');
  end if;
  select count(*) into v_subj from core.link_baseline_subject where link_id = l.link_id;
  if v_subj <> 1 then fallos := array_append(fallos, 'D3 S0 de la reclamacion no es {Luis}: ' || v_subj); end if;
  select count(*) into v_base from core.link_baseline where link_id = l.link_id;
  if v_base <> 2 then fallos := array_append(fallos, 'D3 la linea base no tiene exactamente 2 operaciones: ' || v_base); end if;
  if not exists (select 1 from core.link_baseline b join core.operation o on o.id = b.operation_id
                  where b.link_id = l.link_id and o.id = r.op_e1 and b.baseline_version_id = o.current_version_id
                    and (select version_no from core.operation_version where id = b.baseline_version_id) = 2) then
    fallos := array_append(fallos, 'D3 la base de E1 no es su version vigente (la 2, corregida antes de reclamar)');
  end if;
  if not exists (select 1 from core.link_baseline b where b.link_id = l.link_id and b.operation_id = r.op_s1) then
    fallos := array_append(fallos, 'D3 el settlement previo no esta en la base');
  end if;
  if exists (select 1 from core.link_baseline b join core.operation_version ov on ov.id = b.baseline_version_id
              join core.movement_detail d on d.operation_version_id = ov.id where b.link_id = l.link_id and d.concept = 'SinLuis') then
    fallos := array_append(fallos, 'D3 una operacion que no nombra a Luis entro en su base');
  end if;
  -- D3b · una correccion POSTERIOR a la reclamacion no mueve la base.
  v_link := l.link_id;
  v := pg_temp.call('record_group_expense', jsonb_build_object('client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '300', 'effective_date', current_date::text, 'concept', 'E1 tris', 'category_id', r.cat,
    'payer_participant_id', r.p_edu, 'participants', jsonb_build_array(r.p_edu, r.p_luis), 'split_method', jsonb_build_object('kind', 'equal'),
    'operation_id', r.op_e1, 'expected_version_id', (select current_version_id from core.operation where id = r.op_e1)), r.edu);
  if v like 'ERR%' then raise exception 'D3b correccion posterior: %', v; end if;
  perform pg_temp.super();
  if (select version_no from core.operation_version ov join core.link_baseline b on b.baseline_version_id = ov.id where b.link_id = v_link and b.operation_id = r.op_e1) <> 2 then
    fallos := array_append(fallos, 'D3b la base se movio con una correccion posterior a la reclamacion');
  end if;

  -- D4 · replay de la reclamacion: nada nuevo.
  v := pg_temp.call('redeem_invitation', jsonb_build_object('client_command_id', r.cmd_claim, 'command_contract_version', 1,
         'token', r.token, 'choice', 'claim', 'participant_id', r.p_luis), r.bea);
  perform pg_temp.super();
  if (v::jsonb ->> 'already_processed') <> 'true' then fallos := array_append(fallos, 'D4 el replay no respondio already_processed'); end if;
  if (select count(*) from core.link_baseline_subject where link_id = v_link) <> 1
     or (select count(*) from core.link_baseline where link_id = v_link) <> 2 then
    fallos := array_append(fallos, 'D4 el replay altero S0 o la base');
  end if;

  -- D5 · Bea paga lo que debe, sale y VUELVE: mismo link_id, misma base, mismo S0, y ninguna fila nueva.
  v := pg_temp.call('record_debt_settlement', jsonb_build_object('client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'amount', '110', 'effective_date', current_date::text,
    'debtor_participant_id', r.p_luis, 'creditor_participant_id', r.p_edu), r.bea);
  if v like 'ERR%' then raise exception 'D5 liquidar antes de salir: %', v; end if;
  v := pg_temp.call('leave_group', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1, 'scope_id', r.g), r.bea);
  if v like 'ERR%' then raise exception 'D5 leave: %', v; end if;
  perform pg_temp.super();
  if (select link_id from core.participant_user_link where participant_id = r.p_luis) is distinct from v_link then
    fallos := array_append(fallos, 'D5 salir cambio o borro la instancia');
  end if;
  v := pg_temp.call('redeem_invitation', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
         'token', r.token, 'choice', 'rejoin'), r.bea);
  if v like 'ERR%' or (v::jsonb ->> 'rejoined') <> 'true' then raise exception 'D5 rejoin: %', v; end if;
  perform pg_temp.super();
  if (select link_id from core.participant_user_link where participant_id = r.p_luis) is distinct from v_link then
    fallos := array_append(fallos, 'D5 rejoin creo otra instancia');
  end if;
  if (select count(*) from core.link_baseline_subject where link_id = v_link) <> 1
     or (select count(*) from core.link_baseline where link_id = v_link) <> 2 then
    fallos := array_append(fallos, 'D5 rejoin altero S0 o la base');
  end if;
  if cardinality(fallos) > 0 then raise exception 'D · altas: %', array_to_string(fallos, ' | '); end if;
  raise notice 'D · new (origen, S0, sin base), claim con historia real (base = versiones vigentes bajo el cerrojo, ni una mas), replay, salir y volver (misma instancia): OK';
end
$d$;

-- ═══════════════ E · claim de un destino de fusion ══════════════════════════
-- Bea (vinculada a Luis) asocia a Gus (F09/ADR-009); despues Bea deja el grupo
-- SIN comando de baja —no existe aun—: se simula como postgres borrando su
-- vinculo y su membresia, que es exactamente lo que la baja hara. Zoe reclama
-- a Luis: S0 = {Luis, Gus} y la base incluye lo que nombraba a Gus.
do $e$
declare r fx%rowtype; fallos text[] := '{}'; v text; l record; v_old uuid; v_gus_op uuid;
begin
  select * into r from fx;
  -- Un gasto que solo nombra a Gus, antes de la fusion.
  v := pg_temp.call('record_group_expense', jsonb_build_object('client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '80', 'effective_date', current_date::text, 'concept', 'SoloGus', 'category_id', r.cat,
    'payer_participant_id', r.p_edu, 'participants', jsonb_build_array(r.p_edu, r.p_gus), 'split_method', jsonb_build_object('kind', 'equal')), r.edu);
  if v like 'ERR%' then raise exception 'E gasto de Gus: %', v; end if;
  v_gus_op := (v::jsonb ->> 'operation_id')::uuid;
  v := pg_temp.call('associate_participant', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
         'scope_id', r.g, 'participant_id', r.p_gus), r.bea);
  if v like 'ERR%' then raise exception 'E associate: %', v; end if;
  perform pg_temp.super();
  select link_id into v_old from core.participant_user_link where participant_id = r.p_luis;
  -- E1 · asociar NO toca el S0 de la instancia existente (la fusion es posterior a ella).
  if (select count(*) from core.link_baseline_subject where link_id = v_old) <> 1 then
    fallos := array_append(fallos, 'E1 asociar cambio el S0 de la instancia de Bea');
  end if;
  -- Bea deja la identidad (simulado).
  delete from core.participant_user_link where participant_id = r.p_luis;
  delete from core.membership where scope_id = r.g and user_id = r.bea;
  -- E2 · la base y los sujetos de la instancia terminada sobreviven.
  if (select count(*) from core.link_baseline_subject where link_id = v_old) <> 1
     or (select count(*) from core.link_baseline where link_id = v_old) <> 2 then
    fallos := array_append(fallos, 'E2 la base o los sujetos no sobrevivieron a la baja');
  end if;
  -- E3 · Zoe reclama a Luis: S0 = {Luis, Gus}; base con SoloGus.
  v := pg_temp.call('redeem_invitation', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
         'token', r.token, 'choice', 'claim', 'participant_id', r.p_luis), r.zoe);
  if v like 'ERR%' then raise exception 'E3 redeem claim de Zoe: %', v; end if;
  perform pg_temp.super();
  select * into l from core.participant_user_link where participant_id = r.p_luis;
  if l.link_id = v_old then fallos := array_append(fallos, 'E3 la nueva instancia reutilizo el link_id anterior'); end if;
  if (select count(*) from core.link_baseline_subject where link_id = l.link_id) <> 2
     or not exists (select 1 from core.link_baseline_subject where link_id = l.link_id and participant_id = r.p_gus) then
    fallos := array_append(fallos, 'E3 S0 no incluye al origen fusionado');
  end if;
  if not exists (select 1 from core.link_baseline where link_id = l.link_id and operation_id = v_gus_op) then
    fallos := array_append(fallos, 'E3 la base no incluye la operacion que nombraba a Gus');
  end if;
  if cardinality(fallos) > 0 then raise exception 'E · destino de fusion: %', array_to_string(fallos, ' | '); end if;
  raise notice 'E · asociar no toca S0; la base sobrevive a la baja; reclamar un destino de fusion hereda S0 = {P, origen} y su base: OK';
end
$e$;

-- ═══════════════ F · integridad de ambito y titular; insert-only; unclaim ═══
do $f2$
declare r fx%rowtype; fallos text[] := '{}'; v text; v_zoe uuid; v_edu2 uuid; v_ver uuid; v_ver2 uuid; v_origin uuid;
begin
  select * into r from fx;
  perform pg_temp.super();
  select link_id into v_zoe from core.participant_user_link where participant_id = r.p_luis;   -- de Zoe, en g
  select link_id into v_edu2 from core.participant_user_link where participant_id = r.p_edu2;  -- de Edu, en g2
  select current_version_id into v_ver from core.operation where id = r.op_e1;                  -- de g
  -- una version de g2
  v := pg_temp.call('record_group_expense', jsonb_build_object('client_operation_id', gen_random_uuid(), 'command_contract_version', 1,
    'scope_id', r.g2, 'currency_definition_id', r.eur, 'total', '10', 'effective_date', current_date::text, 'concept', 'G2', 'category_id', r.cat,
    'payer_participant_id', r.p_edu2, 'participants', jsonb_build_array(r.p_edu2, r.p_otro), 'split_method', jsonb_build_object('kind', 'equal')), r.edu);
  if v like 'ERR%' then raise exception 'F gasto g2: %', v; end if;
  perform pg_temp.super();
  select current_version_id into v_ver2 from core.operation where id = (v::jsonb ->> 'operation_id')::uuid;

  -- F1 · el provisioner, como Zoe, NO puede meter en su S0 a un participante de otro ambito.
  v := pg_temp.try(format('insert into core.link_baseline_subject (link_id, participant_id) values (%L, %L)', v_zoe, r.p_otro), 'nomey_provisioner', r.zoe);
  if v <> '42501' then fallos := array_append(fallos, 'F1 sujeto de otro ambito no rechazado: ' || v); end if;
  -- F2 · ...ni una operacion de otro ambito en su base.
  v := pg_temp.try(format('insert into core.link_baseline (link_id, operation_id, baseline_version_id) values (%L, %L, %L)',
                          v_zoe, (select operation_id from core.operation_version where id = v_ver2), v_ver2), 'nomey_provisioner', r.zoe);
  if v <> '42501' then fallos := array_append(fallos, 'F2 operacion de otro ambito no rechazada: ' || v); end if;
  -- F3 · ...ni escribir en una instancia AJENA aunque sea de su ambito (Edu en g2, como Zoe).
  v := pg_temp.try(format('insert into core.link_baseline_subject (link_id, participant_id) values (%L, %L)', v_edu2, r.p_otro), 'nomey_provisioner', r.zoe);
  if v <> '42501' then fallos := array_append(fallos, 'F3 instancia ajena no rechazada: ' || v); end if;
  -- F4 · una version de otra operacion: la FK compuesta lo rechaza aunque el ambito sea correcto.
  v := pg_temp.try(format('insert into core.link_baseline (link_id, operation_id, baseline_version_id) values (%L, %L, %L)',
                          v_zoe, r.op_sin, v_ver), 'nomey_provisioner', r.zoe);
  if v <> '23503' then fallos := array_append(fallos, 'F4 version de otra operacion no rechazada por FK: ' || v); end if;
  -- F5 · insert-only: update y delete rechazados para el provisioner y para authenticated.
  v := pg_temp.try(format('update core.link_baseline_subject set participant_id = %L where link_id = %L', r.p_gus, v_zoe), 'nomey_provisioner', r.zoe);
  if v <> '42501' then fallos := array_append(fallos, 'F5 update de sujetos no rechazado: ' || v); end if;
  v := pg_temp.try(format('delete from core.link_baseline where link_id = %L', v_zoe), 'nomey_provisioner', r.zoe);
  if v <> '42501' then fallos := array_append(fallos, 'F5 delete de base no rechazado: ' || v); end if;
  v := pg_temp.try(format('delete from core.link_baseline_subject where link_id = %L', v_zoe), 'authenticated', r.zoe);
  if v <> '42501' then fallos := array_append(fallos, 'F5 delete de sujetos por authenticated no rechazado: ' || v); end if;
  -- F6 · participant_unlink: el provisioner solo escribe un hecho cuyo titular y actor son el
  --      propio actor (policy); a nombre de otro, o con otro actor, 42501. La lectura del cliente
  --      es por columnas y solo a traves de las vistas de api (unlink-evidence.sql H3).
  v := pg_temp.try(format('insert into core.participant_unlink (link_id, participant_id, scope_id, user_id, unlinked_by, reason, client_command_id) values (%L, %L, %L, %L, %L, %L, %L)',
                          gen_random_uuid(), r.p_luis, r.g, r.edu, r.edu, 'self', gen_random_uuid()), 'nomey_provisioner', r.zoe);
  if v <> '42501' then fallos := array_append(fallos, 'F6 hecho a nombre de otro no rechazado: ' || v); end if;
  v := pg_temp.try(format('insert into core.participant_unlink (link_id, participant_id, scope_id, user_id, unlinked_by, reason, client_command_id) values (%L, %L, %L, %L, %L, %L, %L)',
                          gen_random_uuid(), r.p_luis, r.g, r.zoe, r.edu, 'self', gen_random_uuid()), 'nomey_provisioner', r.zoe);
  if v not in ('42501', '23514') then fallos := array_append(fallos, 'F6 hecho con otro actor no rechazado: ' || v); end if;
  -- F7 · como postgres, los CHECK y la FK de comando se cumplen: actor ≠ titular, motivo distinto, comando inexistente.
  v := pg_temp.try(format('insert into core.participant_unlink (link_id, participant_id, scope_id, user_id, unlinked_by, reason, client_command_id) values (%L, %L, %L, %L, %L, %L, %L)',
                          gen_random_uuid(), r.p_luis, r.g, r.zoe, r.edu, 'self', r.cmd_claim), 'postgres', r.zoe);
  if v <> '23514' then fallos := array_append(fallos, 'F7 unlinked_by <> user_id no rechazado: ' || v); end if;
  v := pg_temp.try(format('insert into core.participant_unlink (link_id, participant_id, scope_id, user_id, unlinked_by, reason, client_command_id) values (%L, %L, %L, %L, %L, %L, %L)',
                          gen_random_uuid(), r.p_luis, r.g, r.zoe, r.zoe, 'other', r.cmd_claim), 'postgres', r.zoe);
  if v <> '23514' then fallos := array_append(fallos, 'F7 reason distinto de self no rechazado: ' || v); end if;
  v := pg_temp.try(format('insert into core.participant_unlink (link_id, participant_id, scope_id, user_id, unlinked_by, reason, client_command_id) values (%L, %L, %L, %L, %L, %L, %L)',
                          gen_random_uuid(), r.p_luis, r.g, r.zoe, r.zoe, 'self', gen_random_uuid()), 'postgres', r.zoe);
  if v <> '23503' then fallos := array_append(fallos, 'F7 comando de baja inexistente no rechazado por FK: ' || v); end if;
  -- F8 · claim_command_id no puede divergir del origen ni siquiera como postgres.
  v := pg_temp.try(format('update core.participant_user_link set claim_command_id = %L where link_id = %L', gen_random_uuid(), v_zoe), 'postgres', r.zoe);
  if v <> '23514' then fallos := array_append(fallos, 'F8 claim_command_id divergente no rechazado: ' || v); end if;
  -- F9 · unclaim (wrapper de F10/ADR-001 §11) sobre la reclamacion de Zoe: la fusion de Gus en Luis
  --      es ANTERIOR a su instancia (esta en S0 y en la base), nada nacio durante y no hay caja:
  --      pasa, y deja el hecho con el origen de esa instancia (§4, §7). UNCLAIM_BLOCKED_MERGE ya no existe.
  select origin_command_id into v_origin from core.participant_user_link where link_id = v_zoe;
  v := pg_temp.call('unclaim_participant', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
         'scope_id', r.g, 'participant_id', r.p_luis, 'claim_command_id', v_origin), r.zoe);
  if v like 'ERR%' then fallos := array_append(fallos, 'F9 unclaim de un destino de fusion previa a la instancia no paso: ' || v); end if;
  if not exists (select 1 from core.participant_unlink u where u.link_id = v_zoe and u.user_id = r.zoe and u.unlinked_by = r.zoe
                   and u.origin_command_id = v_origin and u.reason = 'self')
     or exists (select 1 from core.participant_user_link where link_id = v_zoe) then
    fallos := array_append(fallos, 'F9 la baja no dejo el hecho con el origen de la instancia, o el vinculo sigue');
  end if;
  -- F10 · y sobre la reclamacion de Ana... Ana entro como nueva: UNCLAIM_NOT_AVAILABLE, como antes.
  v := pg_temp.call('unclaim_participant', jsonb_build_object('client_command_id', gen_random_uuid(), 'command_contract_version', 1,
         'scope_id', r.g, 'participant_id', r.p_ana, 'claim_command_id', r.cmd_new), r.ana);
  if v <> 'ERR UNCLAIM_NOT_AVAILABLE' then fallos := array_append(fallos, 'F10 unclaim de «Soy nuevo» cambio de respuesta: ' || v); end if;
  if cardinality(fallos) > 0 then raise exception 'F · integridad: %', array_to_string(fallos, ' | '); end if;
  raise notice 'F · ni otro ambito, ni instancia ajena, ni version de otra operacion; insert-only real; participant_unlink cerrado; CHECKs y FKs; la baja de una instancia con fusion previa pasa: OK';
end
$f2$;

rollback;
