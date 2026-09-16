-- ============================================================================
-- VOLVER A ENTRAR TRAS SALIR (ADR-041) · contra las funciones reales, aislado
-- ============================================================================
--
-- api.preview_invitation / api.redeem_invitation (migracion 20260914140000)
-- llamadas como cada cuenta, con invitaciones reales. Las ayudas de
-- lib/group-payment-helpers.sql solo leen y envuelven. Todo en rollback.
--
--   { cat supabase/checks/lib/group-payment-helpers.sql; cat supabase/checks/rejoin-after-departure.sql; } | docker exec -i supabase_db_NomeyIso psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1
--
--   A · salir y volver: la misma identidad, dos periodos con el hueco entre
--       medias, membresia; ningun participante, vinculo, operacion ni caja
--       nuevos; la novacion de salida intacta
--   B · repetir el enlace ya dentro: nada nuevo; new con identidad anterior:
--       REJOIN_REQUIRED; claim de una identidad con cuenta: rehusado y sin
--       membresia; rejoin sin identidad anterior: REJOIN_NOT_AVAILABLE; enlace
--       revocado o caducado: su estado, sin escribir
--   C · sin reparto retroactivo: un alta fechada en la ausencia lo rehusa; la
--       correccion de un gasto anterior que lo nombraba sigue valiendo
--   D · identidad fusionada: vuelve como el destino; pares canonicos y caja
--       como antes de salir; ninguna incorporacion nueva
--   E · C6 una sola vez: la deuda reabierta se lee por la excepcion mientras
--       esta fuera y como miembro al volver, nunca las dos
\pset pager off
\set ON_ERROR_STOP on
begin;

create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  'a8d00000-0000-4000-8000-0000000000e1'::uuid as edu,   'a8d00000-0000-4000-8000-0000000000f1'::uuid as s_edu,
  'a8d00000-0000-4000-8000-0000000000a1'::uuid as aitor, 'a8d00000-0000-4000-8000-0000000000f2'::uuid as s_aitor,
  'a8d00000-0000-4000-8000-0000000000a2'::uuid as ana,   'a8d00000-0000-4000-8000-0000000000f3'::uuid as s_ana,
  'a8d00000-0000-4000-8000-000000000010'::uuid as g1,
  'a8d00000-0000-4000-8000-000000000311'::uuid as a1, 'a8d00000-0000-4000-8000-000000000321'::uuid as af1,
  'a8d00000-0000-4000-8000-000000000331'::uuid as an1, 'a8d00000-0000-4000-8000-000000000341'::uuid as e1,
  'a8d00000-0000-4000-8000-000000000361'::uuid as l1,
  null::uuid as cat, null::uuid as x1, null::uuid as x2, null::uuid as p1, null::text as token, null::text as token2;
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
-- PREVISUALIZAR como p_who: 'estado[:identidad anterior]'.
create function pg_temp.preview(p_who uuid, p_token text) returns text language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.gp_actor(p_who);
  v := api.preview_invitation(p_token);
  perform pg_temp.gp_super();
  return (v ->> 'state') || coalesce(':' || pg_temp.gp_name((v -> 'previous_participant' ->> 'participant_id')::uuid), '');
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
-- Los periodos de un participante: '[desde,hasta) [desde,)' en dias relativos a hoy.
create function pg_temp.periodos(p_participant uuid) returns text language sql stable as $$
  select coalesce(string_agg('[' || (pp.valid_from - current_date) || ',' || coalesce((pp.valid_until - current_date)::text, '') || ')', ' ' order by pp.valid_from), '-')
    from core.participant_period pp where pp.participant_id = p_participant;
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
  pg_temp.canjear(uuid, uuid, text, text, uuid, text), pg_temp.periodos(uuid), pg_temp.huella(uuid) to authenticated;

-- ============================ fixture ========================================
do $f$
declare r fx%rowtype; v jsonb; t text;
begin
  update fx set cat = (select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null);
  select * into r from fx;
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (r.s_edu, 'personal', r.eur, r.edu), (r.s_aitor, 'personal', r.eur, r.aitor), (r.s_ana, 'personal', r.eur, r.ana);
  insert into core.membership (scope_id, user_id) values (r.s_edu, r.edu), (r.s_aitor, r.aitor), (r.s_ana, r.ana);
  -- Edu crea con Aitor (Soy nuevo), «Aitor F» (fantasma), Ana y Luis (fantasma).
  perform pg_temp.grupo('a8d00000-0000-4000-8000-000000000020', r.g1, 'Vuelta', r.e1,
    jsonb_build_array(jsonb_build_object('client_participant_id', r.a1,  'display_name', 'Aitor'),
                      jsonb_build_object('client_participant_id', r.af1, 'display_name', 'Aitor F'),
                      jsonb_build_object('client_participant_id', r.an1, 'display_name', 'Ana'),
                      jsonb_build_object('client_participant_id', r.l1,  'display_name', 'Luis')),
    jsonb_build_array(jsonb_build_object('user', r.aitor, 'participant', r.a1), jsonb_build_object('user', r.ana, 'participant', r.an1)));
  -- Una invitacion viva de Edu.
  perform pg_temp.gp_actor(r.edu);
  v := api.create_group_invitation(jsonb_build_object('client_command_id', 'a8d00000-0000-4000-8000-000000000021'::uuid, 'command_contract_version', 1, 'scope_id', r.g1));
  perform pg_temp.gp_super();
  update fx set token = v ->> 'token';
  -- X1: F paga 900 a F, Edu y Ana → Edu>F 300, Ana>F 300. Aitor asocia a F.
  t := pg_temp.gasto(r.edu, 'a8d00000-0000-4000-8000-000000000101', r.g1, r.af1, array[r.af1, r.e1, r.an1], 900, 'Cena');
  if t not like 'OK %' then raise exception 'F1: %', t; end if; update fx set x1 = substr(t, 4)::uuid;
  perform pg_temp.gp_actor(r.aitor);
  v := api.associate_participant(jsonb_build_object('client_command_id', 'a8d00000-0000-4000-8000-000000000031'::uuid, 'command_contract_version', 1, 'scope_id', r.g1, 'participant_id', r.af1));
  perform pg_temp.gp_super();
  if (v ->> 'incorporated_versions') <> '1' then raise exception 'F2: %', v; end if;
  -- X2: Aitor paga 600 a Aitor y Luis → Luis>Aitor 300. Edu le paga 300 a Aitor (vigente; se anulara en E).
  t := pg_temp.gasto(r.aitor, 'a8d00000-0000-4000-8000-000000000102', r.g1, r.a1, array[r.a1, r.l1], 600, 'Taxi');
  if t not like 'OK %' then raise exception 'F3: %', t; end if; update fx set x2 = substr(t, 4)::uuid;
  t := pg_temp.gp_pay(r.edu, 'a8d00000-0000-4000-8000-000000000103', r.g1, r.e1, r.a1, 300);
  if t not like 'OK %' then raise exception 'F4: %', t; end if; update fx set p1 = substr(t, 4)::uuid;
  select * into r from fx;
  raise notice 'F · pares % · netos % · Personal Aitor %', pg_temp.gp_pairs(r.g1), pg_temp.gp_positions(r.g1), pg_temp.gp_personal(r.aitor);
  -- Aitor (destino de la fusion): Ana>Aitor 300, Luis>Aitor 300; Edu ya le pago. Neto +600: no puede salir.
  if pg_temp.gp_pairs(r.g1) <> 'Ana>Aitor:300 Luis>Aitor:300' then raise exception 'F5: %', pg_temp.gp_pairs(r.g1); end if;
end $f$;

-- ===== A · salir y volver ====================================================
do $a$
declare r fx%rowtype; v text; v_huella text; v_personal text; v_pairs text; v_pos text;
begin
  select * into r from fx;
  -- Ana (neto -300) paga a Aitor y Luis (fantasma) tambien: Aitor queda a cero y sale.
  v := pg_temp.gp_pay(r.ana, 'a8d00000-0000-4000-8000-000000000111', r.g1, r.an1, r.a1, 300); if v not like 'OK %' then raise exception 'A0a: %', v; end if;
  v := pg_temp.gp_pay(r.aitor, 'a8d00000-0000-4000-8000-000000000112', r.g1, r.l1, r.a1, 300); if v not like 'OK %' then raise exception 'A0b: %', v; end if;
  if pg_temp.gp_pairs(r.g1) <> '-' then raise exception 'A0c: %', pg_temp.gp_pairs(r.g1); end if;
  v := pg_temp.gp_leave(r.aitor, 'a8d00000-0000-4000-8000-000000000113', r.g1);
  if v <> 'OK' then raise exception 'A1: %', v; end if;
  -- Fuera: sin membresia, con vinculo, periodo cerrado hoy (excluido), preview dice quien era.
  if exists (select 1 from core.membership where scope_id = r.g1 and user_id = r.aitor) then raise exception 'A2'; end if;
  if not sec.participant_departed(r.a1, r.g1) then raise exception 'A2b'; end if;
  raise notice 'A · fuera: periodos de Aitor % · preview %', pg_temp.periodos(r.a1), pg_temp.preview(r.aitor, r.token);
  if pg_temp.periodos(r.a1) <> '[-10,0)' then raise exception 'A3: %', pg_temp.periodos(r.a1); end if;
  if pg_temp.preview(r.aitor, r.token) <> 'rejoin:Aitor' then raise exception 'A4: %', pg_temp.preview(r.aitor, r.token); end if;
  v_huella := pg_temp.huella(r.g1); v_personal := pg_temp.gp_personal(r.aitor); v_pairs := pg_temp.gp_pairs(r.g1); v_pos := pg_temp.gp_positions(r.g1);
  -- Vuelve.
  v := pg_temp.canjear(r.aitor, 'a8d00000-0000-4000-8000-000000000114', r.token, 'rejoin');
  raise notice 'A · vuelve: % · periodos % · huella %', v, pg_temp.periodos(r.a1), pg_temp.huella(r.g1);
  if v <> 'OK rejoined' then raise exception 'A5: %', v; end if;
  if not exists (select 1 from core.membership where scope_id = r.g1 and user_id = r.aitor) then raise exception 'A6'; end if;
  if pg_temp.periodos(r.a1) <> '[-10,0) [0,)' then raise exception 'A7: %', pg_temp.periodos(r.a1); end if;
  if sec.participant_departed(r.a1, r.g1) then raise exception 'A7b'; end if;
  -- Nada mas cambio: ni participante, ni vinculo, ni operacion, ni efecto, ni fusion; la salida sigue registrada.
  if pg_temp.huella(r.g1) <> v_huella then raise exception 'A8: % → %', v_huella, pg_temp.huella(r.g1); end if;
  if pg_temp.gp_personal(r.aitor) <> v_personal then raise exception 'A9: % → %', v_personal, pg_temp.gp_personal(r.aitor); end if;
  if pg_temp.gp_pairs(r.g1) <> v_pairs or pg_temp.gp_positions(r.g1) <> v_pos then raise exception 'A10'; end if;
  -- Replay de la misma clave: nada nuevo.
  v := pg_temp.canjear(r.aitor, 'a8d00000-0000-4000-8000-000000000114', r.token, 'rejoin');
  if v <> 'REPLAY' then raise exception 'A11: %', v; end if;
  if pg_temp.periodos(r.a1) <> '[-10,0) [0,)' then raise exception 'A12: %', pg_temp.periodos(r.a1); end if;
  raise notice 'A · salir y volver: misma identidad, dos periodos con el hueco, nada mas escrito: OK';
end $a$;

-- ===== B · repetir, elegir mal, enlaces invalidos ============================
do $b$
declare r fx%rowtype; v text; v_huella text; v_periodos text; v_inv uuid;
begin
  select * into r from fx;
  v_huella := pg_temp.huella(r.g1); v_periodos := pg_temp.periodos(r.a1);
  -- Ya dentro: preview 'member'; repetir el enlace con otra clave no crea otra presencia.
  if pg_temp.preview(r.aitor, r.token) <> 'member' then raise exception 'B1: %', pg_temp.preview(r.aitor, r.token); end if;
  v := pg_temp.canjear(r.aitor, 'a8d00000-0000-4000-8000-000000000121', r.token, 'rejoin');
  if v <> 'OK already_member' then raise exception 'B2: %', v; end if;
  v := pg_temp.canjear(r.aitor, 'a8d00000-0000-4000-8000-000000000122', r.token, 'new', null, 'Aitor otra vez');
  if v <> 'OK already_member' then raise exception 'B2b: %', v; end if;
  if pg_temp.periodos(r.a1) <> v_periodos or pg_temp.huella(r.g1) <> v_huella then raise exception 'B3'; end if;
  -- Fuera otra vez (a cero, sin pares): «nuevo» con identidad anterior se
  -- rehusa (REJOIN_REQUIRED); reclamar SI esta abierto desde F10/ADR-003 §2
  -- —lo ejerce supabase/checks/link-lifecycle.sql— pero sigue guardado: una
  -- identidad con cuenta no se reclama; rejoin sin identidad anterior se rehusa.
  v := pg_temp.gp_leave(r.aitor, 'a8d00000-0000-4000-8000-000000000123', r.g1);
  if v <> 'OK' then raise exception 'B4: %', v; end if;
  v := pg_temp.canjear(r.aitor, 'a8d00000-0000-4000-8000-000000000124', r.token, 'new', null, 'Aitor bis');
  if v <> 'REJOIN_REQUIRED' then raise exception 'B5: %', v; end if;
  v := pg_temp.canjear(r.aitor, 'a8d00000-0000-4000-8000-000000000125', r.token, 'claim', r.an1);
  if v <> 'PARTICIPANT_ALREADY_CLAIMED' then raise exception 'B6: %', v; end if;
  if exists (select 1 from core.membership where scope_id = r.g1 and user_id = r.aitor) then raise exception 'B6b: un rechazo dio membresia'; end if;
  -- Una cuenta que nunca estuvo no puede «volver».
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values ('a8d00000-0000-4000-8000-0000000000f9', 'personal', r.eur, 'a8d00000-0000-4000-8000-0000000000b9');
  v := pg_temp.canjear('a8d00000-0000-4000-8000-0000000000b9', 'a8d00000-0000-4000-8000-000000000126', r.token, 'rejoin');
  if v <> 'REJOIN_NOT_AVAILABLE' then raise exception 'B7: %', v; end if;
  -- Enlace revocado: su estado, sin escribir; uno nuevo vale.
  select i.id into v_inv from core.group_invitation i where i.scope_id = r.g1 and i.revoked_at is null order by i.created_at desc limit 1;
  perform pg_temp.gp_actor(r.edu);
  perform api.revoke_group_invitation(jsonb_build_object('client_command_id', 'a8d00000-0000-4000-8000-000000000127'::uuid, 'command_contract_version', 1, 'invitation_id', v_inv));
  perform pg_temp.gp_super();
  if pg_temp.preview(r.aitor, r.token) <> 'revoked' then raise exception 'B8: %', pg_temp.preview(r.aitor, r.token); end if;
  v := pg_temp.canjear(r.aitor, 'a8d00000-0000-4000-8000-000000000128', r.token, 'rejoin');
  if v <> 'revoked' then raise exception 'B9: %', v; end if;
  if exists (select 1 from core.membership where scope_id = r.g1 and user_id = r.aitor) then raise exception 'B9b'; end if;
  -- Caducado: se fuerza la fecha del nuevo enlace.
  perform pg_temp.gp_actor(r.edu);
  update fx set token2 = (api.create_group_invitation(jsonb_build_object('client_command_id', 'a8d00000-0000-4000-8000-000000000129'::uuid, 'command_contract_version', 1, 'scope_id', r.g1)) ->> 'token');
  perform pg_temp.gp_super();
  select * into r from fx;
  update core.group_invitation set created_at = now() - interval '2 days', expires_at = now() - interval '1 minute' where scope_id = r.g1 and revoked_at is null;
  if pg_temp.preview(r.aitor, r.token2) <> 'expired' then raise exception 'B10: %', pg_temp.preview(r.aitor, r.token2); end if;
  v := pg_temp.canjear(r.aitor, 'a8d00000-0000-4000-8000-00000000012a', r.token2, 'rejoin');
  if v <> 'expired' then raise exception 'B11: %', v; end if;
  update core.group_invitation set expires_at = now() + interval '1 day' where scope_id = r.g1 and revoked_at is null;
  if pg_temp.preview(r.aitor, r.token2) <> 'rejoin:Aitor' then raise exception 'B12: %', pg_temp.preview(r.aitor, r.token2); end if;
  raise notice 'B · ya dentro nada nuevo; claim/new con vinculo y rejoin sin vinculo rehusados; revocado y caducado respetados: OK';
end $b$;

-- ===== C · sin reparto retroactivo ===========================================
do $c$
declare r fx%rowtype; v text;
begin
  select * into r from fx;
  -- Aitor sigue fuera (salio en B). Un alta fechada AYER que lo nombra: rehusada; y hoy tampoco (fuera).
  v := pg_temp.gasto(r.edu, 'a8d00000-0000-4000-8000-000000000131', r.g1, r.e1, array[r.e1, r.a1], 200, 'Ayer', null, current_date - 1);
  raise notice 'C · alta de ayer con Aitor fuera: %', v;
  if v <> 'DEPARTED_OBLIGATION_CHANGED' then raise exception 'C1: %', v; end if;
  -- Vuelve hoy: el periodo nuevo empieza hoy. Un alta de AYER sigue sin poder nombrarlo; una de HOY si.
  v := pg_temp.canjear(r.aitor, 'a8d00000-0000-4000-8000-000000000132', r.token2, 'rejoin');
  if v <> 'OK rejoined' then raise exception 'C2: %', v; end if;
  raise notice 'C · periodos de Aitor tras dos salidas y dos vueltas: %', pg_temp.periodos(r.a1);
  if pg_temp.periodos(r.a1) <> '[-10,0) [0,)' then raise exception 'C2b: %', pg_temp.periodos(r.a1); end if;
  -- Un hueco REAL de ausencia (salir y volver el mismo dia no deja ninguno):
  -- se retrotrae la salida a hace tres dias, como postgres, para medir la
  -- elegibilidad en el intervalo.
  update core.participant_period set valid_until = current_date - 3 where participant_id = r.a1 and valid_until = current_date;
  raise notice 'C · con hueco: %', pg_temp.periodos(r.a1);
  if pg_temp.periodos(r.a1) <> '[-10,-3) [0,)' then raise exception 'C2c: %', pg_temp.periodos(r.a1); end if;
  v := pg_temp.gasto(r.edu, 'a8d00000-0000-4000-8000-000000000133', r.g1, r.e1, array[r.e1, r.a1], 200, 'Ayer', null, current_date - 1);
  if v <> 'PARTICIPANT_NOT_ELIGIBLE' then raise exception 'C3: %', v; end if;
  v := pg_temp.gasto(r.edu, 'a8d00000-0000-4000-8000-000000000136', r.g1, r.e1, array[r.e1, r.a1], 200, 'Antes', null, current_date - 5);
  if v not like 'OK %' then raise exception 'C3b: %', v; end if;
  v := pg_temp.gasto(r.edu, 'a8d00000-0000-4000-8000-000000000134', r.g1, r.e1, array[r.e1, r.a1], 200, 'Hoy', null, current_date);
  if v not like 'OK %' then raise exception 'C4: %', v; end if;
  -- La correccion del gasto de AYER —en el hueco— que ya lo nombraba (X2, Aitor pago) sigue valiendo: quien constaba, sigue constando.
  v := pg_temp.gasto(r.aitor, 'a8d00000-0000-4000-8000-000000000135', r.g1, r.a1, array[r.a1, r.l1], 600, 'Taxi al aeropuerto', r.x2);
  if v not like 'OK %' then raise exception 'C5: %', v; end if;
  raise notice 'C · sin reparto retroactivo en la ausencia; lo anterior que lo nombraba se corrige igual: OK';
end $c$;

-- ===== D · identidad fusionada ===============================================
do $d$
declare r fx%rowtype; v text; v_caja text;
begin
  select * into r from fx;
  -- Aitor (destino de F) esta dentro. Su caja y sus pares canonicos, antes de salir.
  v_caja := pg_temp.gp_personal(r.aitor);
  raise notice 'D · antes de salir: Personal Aitor % · pares %', v_caja, pg_temp.gp_pairs(r.g1);
  -- Pone a cero lo suyo (Aitor>Edu 200, los dos gastos de C) y sale.
  v := pg_temp.gp_pay(r.aitor, 'a8d00000-0000-4000-8000-000000000141', r.g1, r.a1, r.e1, 200); if v not like 'OK %' then raise exception 'D1: %', v; end if;
  v := pg_temp.gp_leave(r.aitor, 'a8d00000-0000-4000-8000-000000000142', r.g1); if v <> 'OK' then raise exception 'D2: %', v; end if;
  -- El origen sigue fusionado; el vinculo es el destino; preview lo nombra como Aitor.
  if (select target_participant_id from core.participant_merge where source_participant_id = r.af1) <> r.a1 then raise exception 'D3'; end if;
  if pg_temp.preview(r.aitor, r.token2) <> 'rejoin:Aitor' then raise exception 'D4: %', pg_temp.preview(r.aitor, r.token2); end if;
  v := pg_temp.canjear(r.aitor, 'a8d00000-0000-4000-8000-000000000143', r.token2, 'rejoin');
  if v <> 'OK rejoined' then raise exception 'D5: %', v; end if;
  -- Vuelve como el destino: ni participante nuevo, ni incorporacion de caja repetida (X1 sigue una vez).
  if (select count(*) from core.participant where scope_id = r.g1) <> 5 then raise exception 'D6'; end if;
  if (select count(*) from core.effect where scope_id = r.s_aitor and operation_version_id = (select current_version_id from core.operation where id = r.x1)) <> 1 then raise exception 'D7'; end if;
  raise notice 'D · vuelto: Personal Aitor % · pares % · vistas: origen fusionado=%', pg_temp.gp_personal(r.aitor), pg_temp.gp_pairs(r.g1),
    (select merged_into_participant_id is not null from api.group_participant where participant_id = r.af1);
  if (select merged_into_participant_id from api.group_participant where participant_id = r.af1) <> r.a1 then raise exception 'D8'; end if;
  raise notice 'D · una identidad fusionada vuelve como su destino, sin caja ni fusion repetidas: OK';
end $d$;

-- ===== E · C6 una sola vez ===================================================
do $e$
declare r fx%rowtype; v text; v_in bigint; v_out bigint;
begin
  select * into r from fx;
  -- Aitor dentro y a cero. Sale; Edu anula el pago de 300 que le hizo (P1): Edu>Aitor 300 reabierto.
  v := pg_temp.gp_leave(r.aitor, 'a8d00000-0000-4000-8000-000000000151', r.g1); if v <> 'OK' then raise exception 'E1: %', v; end if;
  v := pg_temp.gp_annul(r.edu, 'a8d00000-0000-4000-8000-000000000152', r.p1); if v <> 'OK' then raise exception 'E2: %', v; end if;
  -- Fuera: lo ve por la excepcion C6 (+300 a cobrar); como no miembro no lee pares del grupo.
  v_out := pg_temp.gp_reopened_debt(r.aitor);
  raise notice 'E · fuera: reabierta de Aitor % · pares del grupo %', v_out, pg_temp.gp_pairs(r.g1);
  if v_out <> 300 then raise exception 'E3: %', v_out; end if;
  if pg_temp.gp_pairs(r.g1) <> 'Edu>Aitor:300' then raise exception 'E3b: %', pg_temp.gp_pairs(r.g1); end if;
  -- Vuelve: la excepcion se apaga (hay membresia) y el par se lee como miembro. Una sola vez.
  v := pg_temp.canjear(r.aitor, 'a8d00000-0000-4000-8000-000000000153', r.token2, 'rejoin');
  if v <> 'OK rejoined' then raise exception 'E4: %', v; end if;
  v_in := pg_temp.gp_reopened_debt(r.aitor);
  raise notice 'E · dentro: reabierta % · Personal %', v_in, pg_temp.gp_personal(r.aitor);
  if v_in <> 0 then raise exception 'E5: %', v_in; end if;
  if pg_temp.gp_personal(r.aitor) not like '% deuda=300 %' then raise exception 'E6: %', pg_temp.gp_personal(r.aitor); end if;
  -- Y se salda como miembro, por el par directo (ya no es la excepcion 2 de ADR-038).
  v := pg_temp.gp_pay(r.edu, 'a8d00000-0000-4000-8000-000000000154', r.g1, r.e1, r.a1, 300);
  if v not like 'OK %' then raise exception 'E7: %', v; end if;
  if pg_temp.gp_pairs(r.g1) <> '-' then raise exception 'E8: %', pg_temp.gp_pairs(r.g1); end if;
  raise notice 'E · C6: fuera por la excepcion, dentro como miembro, nunca las dos: OK';
end $e$;

rollback;
