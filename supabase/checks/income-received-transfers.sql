-- ============================================================================
-- «INGRESOS» INCLUYE LA TRANSFERENCIA PERSONAL RECIBIDA (F12.E, 2026-09-22)
-- contra las funciones reales de 20261001120000, aislado
-- ============================================================================
--
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/checks/income-received-transfers.sql
--
--   A · el caso obligatorio: 100 de ingreso; propuesta de 25 pendiente sigue
--       en 100; aceptada, 125. Y UNA sola operacion nueva
--   B · los estados que NO cuentan: pendiente, rechazada, cancelada, caducada
--   C · direccion: lo ENVIADO no entra en los Ingresos del emisor, ni resta
--   D · sin doble conteo: personal_operation sigue sin listar la clase, la
--       dimension economica del receptor no cambia, y el saldo sube una vez
--   E · la clase: un settlement_by_transfer recibido NO cuenta (una
--       liquidacion no es un ingreso, F01/ADR-001)
--   F · el intervalo: fuera del periodo no entra; dos aceptadas suman las dos
--   G · el ayudante: reducido, definer, sin EXECUTE para public; solo el
--       ambito propio, y un tercero no ve nada
\pset pager off
\set ON_ERROR_STOP on
begin;

create temp table fx as select
  'c1000000-0000-4000-8000-0000000000a1'::uuid as ana,   -- recibe
  'c1000000-0000-4000-8000-0000000000b1'::uuid as bea,   -- envia
  'c1000000-0000-4000-8000-0000000000c1'::uuid as cris,  -- tercero
  'c1c00000-0000-4000-8000-0000000000e1'::uuid as eur,
  'c1a00000-0000-4000-8000-0000000000a1'::uuid as pa,
  'c1a00000-0000-4000-8000-0000000000b1'::uuid as pb,
  'c1a00000-0000-4000-8000-0000000000c1'::uuid as pc;
grant select on fx to authenticated;

insert into core.currency_definition (id, code, scale) select eur, 'EUR', 2 from fx;
insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
  select pa, 'personal', eur, ana from fx union all
  select pb, 'personal', eur, bea from fx union all
  select pc, 'personal', eur, cris from fx;
insert into core.membership (scope_id, user_id)
  select pa, ana from fx union all select pb, bea from fx union all select pc, cris from fx;

create function pg_temp.actor(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'is_anonymous', false)::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.super() returns void language sql as $$
  select set_config('role', 'postgres', true);
$$;
grant execute on function pg_temp.actor(uuid), pg_temp.super() to authenticated;

do $seed$
declare r record;
begin
  perform pg_temp.actor((select ana from fx));  select * into r from api.reserve_username('{"handle":"ana_irt","public_name":"Ana"}');
  perform pg_temp.actor((select bea from fx));  select * into r from api.reserve_username('{"handle":"bea_irt","public_name":"Bea"}');
  perform pg_temp.actor((select cris from fx)); select * into r from api.reserve_username('{"handle":"cris_irt","public_name":"Cris"}');
  perform pg_temp.super();
end $seed$;

create function pg_temp.recibidas(p_user uuid) returns integer language plpgsql as $$
declare v integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'is_anonymous', false)::text, true);
  select count(*) into v from sec.my_received_transfers();
  return v;
end $$;

-- Los ingresos del actor en el intervalo, en unidad minima.
create function pg_temp.ingresos(p_user uuid, p_from date default null, p_to date default null)
returns bigint language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.actor(p_user);
  v := api.personal_statistics(p_from, p_to);
  perform pg_temp.super();
  return (v ->> 'income_total')::bigint;
end $$;

create function pg_temp.gastos(p_user uuid) returns bigint language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.actor(p_user);
  v := api.personal_statistics(null, null);
  perform pg_temp.super();
  return (v ->> 'expense_total')::bigint;
end $$;

create function pg_temp.crear(p_user uuid, p_key uuid, p_handle text, p_amount text) returns uuid language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_user);
  r := api.create_transfer_proposal(jsonb_build_object(
         'client_command_id', p_key, 'command_contract_version', 1,
         'handle', p_handle, 'amount', p_amount,
         'currency_definition_id', (select eur from fx)));
  perform pg_temp.super();
  return (r ->> 'proposal_id')::uuid;
end $$;

create function pg_temp.aceptar(p_user uuid, p_key uuid, p_proposal uuid) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.actor(p_user);
  r := api.record_internal_transfer(jsonb_build_object(
         'client_operation_id', p_key, 'command_contract_version', 1, 'proposal_id', p_proposal));
  perform pg_temp.super();
  return 'ok';
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;

create function pg_temp.ingreso_personal(p_user uuid, p_key uuid, p_amount text, p_date date) returns void language plpgsql as $$
begin
  perform pg_temp.actor(p_user);
  perform api.record_personal_income(jsonb_build_object(
    'client_operation_id', p_key, 'command_contract_version', 2,
    'scope_id', (select pa from fx),
    'amount', p_amount, 'currency_definition_id', (select eur from fx),
    'effective_date', p_date, 'effective_time', '08:00', 'concept', 'Nomina'));
  perform pg_temp.super();
end $$;

-- ══════════════ A · el caso obligatorio ═════════════════════════════════════
select pg_temp.ingreso_personal((select ana from fx), gen_random_uuid(), '10000', current_date);

do $a$
declare v_before bigint; v_after bigint; v_pending bigint; v_prop uuid; v_ops integer;
begin
  v_before := pg_temp.ingresos((select ana from fx));
  if v_before <> 10000 then raise exception 'A1 el punto de partida no es 100,00: %', v_before; end if;

  v_prop := pg_temp.crear((select bea from fx), gen_random_uuid(), 'ana_irt', '2500');
  v_pending := pg_temp.ingresos((select ana from fx));
  if v_pending <> 10000 then raise exception 'A2 una propuesta PENDIENTE ya sumo en Ingresos: %', v_pending; end if;

  perform pg_temp.actor((select ana from fx));
  select count(*) into v_ops from api.personal_operation;
  perform pg_temp.super();

  if pg_temp.aceptar((select ana from fx), gen_random_uuid(), v_prop) <> 'ok' then
    raise exception 'A3 la aceptacion no salio bien';
  end if;

  v_after := pg_temp.ingresos((select ana from fx));
  if v_after <> 12500 then raise exception 'A4 aceptada, Ingresos deberia ser 125,00 y es %', v_after; end if;

  -- UNA sola operacion: la transferencia no aparece en personal_operation, asi
  -- que el desglose de la lista no gana una fila de ingreso fantasma.
  perform pg_temp.actor((select ana from fx));
  if (select count(*) from api.personal_operation) <> v_ops then
    raise exception 'A5 personal_operation gano una fila con la transferencia';
  end if;
  if (select count(*) from api.my_transfers where direction = 'incoming') <> 1 then
    raise exception 'A6 la transferencia recibida no sale UNA vez en my_transfers';
  end if;
  perform pg_temp.super();
end $a$;

-- ══════════════ B · lo que no cuenta ════════════════════════════════════════
do $b$
declare v_prop uuid; v_base bigint;
begin
  v_base := pg_temp.ingresos((select ana from fx));

  -- rechazada
  v_prop := pg_temp.crear((select bea from fx), gen_random_uuid(), 'ana_irt', '700');
  perform pg_temp.actor((select ana from fx));
  perform api.decline_transfer_proposal(jsonb_build_object('proposal_id', v_prop));
  perform pg_temp.super();
  if pg_temp.ingresos((select ana from fx)) <> v_base then
    raise exception 'B1 una propuesta RECHAZADA sumo en Ingresos';
  end if;

  -- cancelada por quien la envio
  v_prop := pg_temp.crear((select bea from fx), gen_random_uuid(), 'ana_irt', '800');
  perform pg_temp.actor((select bea from fx));
  perform api.cancel_transfer_proposal(jsonb_build_object('proposal_id', v_prop));
  perform pg_temp.super();
  if pg_temp.ingresos((select ana from fx)) <> v_base then
    raise exception 'B2 una propuesta CANCELADA sumo en Ingresos';
  end if;

  -- caducada: se retrasa la marca como postgres, que es lo unico que now() no da
  v_prop := pg_temp.crear((select bea from fx), gen_random_uuid(), 'ana_irt', '900');
  update core.transfer_proposal set created_at = now() - interval '8 days', expires_at = now() - interval '1 second' where id = v_prop;
  if pg_temp.ingresos((select ana from fx)) <> v_base then
    raise exception 'B3 una propuesta CADUCADA sumo en Ingresos';
  end if;
end $b$;

-- ══════════════ C · direccion ═══════════════════════════════════════════════
do $c$
declare v_prop uuid; v_bea_before bigint; v_bea_after bigint;
begin
  v_bea_before := pg_temp.ingresos((select bea from fx));
  v_prop := pg_temp.crear((select bea from fx), gen_random_uuid(), 'ana_irt', '1000');
  perform pg_temp.aceptar((select ana from fx), gen_random_uuid(), v_prop);
  v_bea_after := pg_temp.ingresos((select bea from fx));
  if v_bea_after <> v_bea_before then
    raise exception 'C1 lo ENVIADO entro en los Ingresos del emisor: % → %', v_bea_before, v_bea_after;
  end if;
  -- Y tampoco resta de ningun sitio: enviar no es gasto todavia.
  if pg_temp.gastos((select bea from fx)) <> 0 then
    raise exception 'C2 lo enviado se convirtio en gasto del emisor';
  end if;
end $c$;

-- ══════════════ D · sin doble conteo ════════════════════════════════════════
do $d$
declare v_econ bigint; v_saldo bigint;
begin
  perform pg_temp.actor((select ana from fx));
  -- La dimension economica de Ana sigue siendo SOLO su ingreso personal: la
  -- transferencia no produce efecto economico, asi que el primer sumando de
  -- income_total no la ha contado y no puede haber duplicado.
  select coalesce(sum(pe.economic_amount::bigint), 0) into v_econ
    from api.personal_effect pe where pe.accounting_class = 'income';
  select balance_amount::bigint into v_saldo from api.personal_balance;
  perform pg_temp.super();
  if v_econ <> 10000 then
    raise exception 'D1 la dimension economica de ingreso cambio: % (deberia seguir siendo 10000)', v_econ;
  end if;
  -- 10000 del ingreso + 2500 + 1000 recibidos = 13500, una sola vez cada uno.
  if v_saldo <> 13500 then
    raise exception 'D2 el saldo no subio exactamente una vez por transferencia: %', v_saldo;
  end if;
  if pg_temp.ingresos((select ana from fx)) <> 13500 then
    raise exception 'D3 Ingresos no suma las dos recibidas una sola vez';
  end if;
end $d$;

-- ══════════════ E · la clase: una liquidacion no es un ingreso ══════════════
-- Se siembra como postgres un settlement_by_transfer con la forma que el
-- writer de F12.B3 produce en los Personales: efectos de clase `transfer`,
-- ∓N, con su transfer_part marcada como de grupo. Es la unica forma de
-- medir el filtro por CLASE sin montar un grupo con deuda entero, y es
-- exactamente lo que este check viene a demostrar.
do $e$
declare v_op uuid := gen_random_uuid(); v_ver uuid := gen_random_uuid();
        v_grupo uuid := gen_random_uuid(); v_before bigint;
begin
  v_before := pg_temp.ingresos((select ana from fx));

  insert into core.scope (id, kind, base_currency_definition_id)
  values (v_grupo, 'group', (select eur from fx));

  -- El puntero de la operacion es NOT NULL y su FK compuesta es diferible:
  -- se inserta la operacion ya apuntando a la version que viene detras.
  set constraints all deferred;
  insert into core.operation (id, operation_class, created_by, current_version_id)
  values (v_op, 'settlement_by_transfer', (select ana from fx), v_ver);
  insert into core.operation_version
    (id, operation_id, version_no, created_by, effective_date, effective_time,
     original_amount, original_currency_definition_id, economic_rules_version)
  values (v_ver, v_op, 1, (select ana from fx), current_date, '10:00',
          5000, (select eur from fx), 'v1');
  insert into core.effect (id, operation_version_id, scope_id, accounting_class, currency_definition_id, balance_amount)
  values (gen_random_uuid(), v_ver, (select pb from fx), 'transfer', (select eur from fx), -5000),
         (gen_random_uuid(), v_ver, (select pa from fx), 'transfer', (select eur from fx),  5000);
  insert into core.transfer_part (operation_version_id, from_scope_id, to_scope_id)
  values (v_ver, (select pb from fx), (select pa from fx));

  -- LO QUE SE MIDE: la liquidacion recibida movio la CAJA y no toco Ingresos.
  if pg_temp.ingresos((select ana from fx)) <> v_before then
    raise exception 'E1 un settlement_by_transfer recibido conto como Ingreso: % → %',
      v_before, pg_temp.ingresos((select ana from fx));
  end if;

  perform pg_temp.actor((select ana from fx));
  if (select balance_amount::bigint from api.personal_balance) <> 18500 then
    raise exception 'E2 el saldo no recogio la liquidacion recibida: %',
      (select balance_amount::bigint from api.personal_balance);
  end if;
  perform pg_temp.super();
  -- Y el ayudante tampoco la ve: filtra por CLASE, no por clase contable.
  if pg_temp.recibidas((select ana from fx)) <> 2 then
    raise exception 'E3 el ayudante recogio la liquidacion';
  end if;
end $e$;

-- ══════════════ F · el intervalo ════════════════════════════════════════════
do $f$
declare v_hoy bigint; v_ayer bigint;
begin
  v_hoy := pg_temp.ingresos((select ana from fx), current_date, current_date);
  if v_hoy <> 13500 then
    raise exception 'F1 el intervalo de hoy no trae las dos recibidas y el ingreso: %', v_hoy;
  end if;
  -- Un intervalo anterior no puede verlas: su effective_date es hoy.
  v_ayer := pg_temp.ingresos((select ana from fx), current_date - 10, current_date - 1);
  if v_ayer <> 0 then
    raise exception 'F2 una transferencia de hoy entro en un intervalo anterior: %', v_ayer;
  end if;
end $f$;

-- ══════════════ G · el ayudante ═════════════════════════════════════════════
do $g$
declare v_n integer;
begin
  -- Definer, y sin EXECUTE para public.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'sec' and p.proname = 'my_received_transfers' and p.prosecdef;
  if v_n <> 1 then raise exception 'G1 sec.my_received_transfers no es SECURITY DEFINER'; end if;

  if has_function_privilege('public', 'sec.my_received_transfers(date,date)', 'execute') then
    raise exception 'G2 public puede ejecutar el ayudante';
  end if;
  if not has_function_privilege('authenticated', 'sec.my_received_transfers(date,date)', 'execute') then
    raise exception 'G3 authenticated no puede ejecutar el ayudante';
  end if;
  -- Y NO puede nombrarlo: sin USAGE sobre `sec`, el unico camino del cliente
  -- es api.personal_statistics. Es la misma frontera que el resto de sec.
  if has_schema_privilege('authenticated', 'sec', 'usage') then
    raise exception 'G4 authenticated tiene USAGE sobre sec';
  end if;

  -- Solo el ambito PROPIO: un tercero sin transferencias no ve ninguna.
  if pg_temp.recibidas((select cris from fx)) <> 0 then
    raise exception 'G5 un tercero ve transferencias ajenas';
  end if;
  if pg_temp.ingresos((select cris from fx)) <> 0 then
    raise exception 'G6 un tercero ve Ingresos ajenos';
  end if;

  -- El emisor tampoco las ve como recibidas.
  if pg_temp.recibidas((select bea from fx)) <> 0 then
    raise exception 'G7 el emisor ve como recibidas las que envio';
  end if;

  -- Las dos de Ana, y solo esas dos.
  if pg_temp.recibidas((select ana from fx)) <> 2 then
    raise exception 'G8 el ayudante no publica exactamente las dos recibidas';
  end if;
end $g$;

select 'income-received-transfers: OK' as resultado;

rollback;
