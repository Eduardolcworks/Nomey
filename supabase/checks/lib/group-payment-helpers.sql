-- ============================================================================
-- AYUDAS PARA LA EVIDENCIA DE PAGOS REGISTRADOS (ADR-038 / ADR-039)
-- ============================================================================
--
-- Solo objetos pg_temp de DOS clases: lecturas legibles (pares, netos,
-- Personal, con nombres) para las aserciones, y envoltorios que llaman a las
-- funciones REALES de `api` como una cuenta concreta y devuelven el resultado
-- o el codigo del error. Ninguna guarda ni ningun calculo contable vive aqui:
-- todo lo que decide es la implementacion (20260912170000).
--
-- Se carga por cat delante del check (psql corre dentro del contenedor).

create function pg_temp.gp_actor(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.gp_super() returns void language sql as $$
  select set_config('role', 'postgres', true);
$$;
grant execute on function pg_temp.gp_actor(uuid), pg_temp.gp_super() to authenticated;

create function pg_temp.gp_name(p_participant uuid) returns text language sql stable as $$
  select display_name from core.participant where id = p_participant;
$$;

-- Lecturas con nombres, como postgres (sec.pending_pairs es la del writer).
create function pg_temp.gp_pairs(p_scope uuid) returns text language sql stable as $$
  select coalesce(string_agg(pg_temp.gp_name(debtor) || '>' || pg_temp.gp_name(creditor) || ':' || amount, ' '
                             order by pg_temp.gp_name(debtor), pg_temp.gp_name(creditor)), '-')
    from sec.pending_pairs(p_scope);
$$;
create function pg_temp.gp_positions(p_scope uuid) returns text language sql stable as $$
  select coalesce(string_agg(pg_temp.gp_name(p.id) || ':' || coalesce(n.net, 0), ' ' order by pg_temp.gp_name(p.id), p.id), '-')
    from core.participant p
    left join (
      select x.pid, sum(x.amt) net from (
        select e.debt_creditor_participant_id pid, e.debt_amount amt from core.current_effect e where e.scope_id = p_scope and e.debt_amount is not null
        union all
        select e.debt_debtor_participant_id, - e.debt_amount from core.current_effect e where e.scope_id = p_scope and e.debt_amount is not null) x
      group by x.pid) n on n.pid = p.id
   where p.scope_id = p_scope;
$$;
-- Lo que el cliente manda: las FILAS de api.group_balance como lista, leidas
-- COMO EL ACTOR (un miembro) cuando se da, y como postgres si no. Tiene que
-- ser la vista y no una copia del texto del servidor: una copia probaba el CAS
-- contra si mismo y escondio que la vista excluye a retirados y origenes
-- fusionados y el texto no (20260914160000). Desde F10/ADR-003 la vista
-- excluye tambien a las identidades historicas por una ayuda acotada a
-- MIEMBROS (sec.participant_link_ended), asi que la foto real es la de un
-- miembro: leida como postgres incluiria a quien salio y caducaria siempre.
create function pg_temp.gp_expected(p_scope uuid, p_as uuid default null) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  if p_as is not null then perform pg_temp.gp_actor(p_as); end if;
  select coalesce(jsonb_agg(jsonb_build_object('participant_id', participant_id, 'net', net_position)), '[]'::jsonb)
    into v from api.group_balance where scope_id = p_scope;
  if p_as is not null then perform pg_temp.gp_super(); end if;
  return v;
end $$;
create function pg_temp.gp_decompose_text(p_scope uuid, p_payer uuid, p_receiver uuid, p_amount bigint) returns text language plpgsql as $$
declare v text;
begin
  select coalesce(string_agg(kind || ' ' || pg_temp.gp_name(debtor) || '>' || pg_temp.gp_name(creditor) || ':' || amount, ' '
                             order by kind, pg_temp.gp_name(debtor), pg_temp.gp_name(creditor)), '-')
    into v from sec.decompose_payment(p_scope, p_payer, p_receiver, p_amount);
  return v;
exception when sqlstate 'PGRST' then
  return sqlerrm::json ->> 'code';
end $$;

-- Lo que api.group_payment_allocation publica de un pago, como p_user (miembro).
create function pg_temp.gp_allocation(p_user uuid, p_operation uuid) returns text language plpgsql as $$
declare v text; j jsonb;
begin
  -- Se lee como el usuario (la vista, bajo su RLS) y se nombra como postgres.
  perform pg_temp.gp_actor(p_user);
  select jsonb_agg(jsonb_build_object('k', kind, 'd', debtor_participant_id, 'c', creditor_participant_id, 'a', amount) order by ordinal)
    into j from api.group_payment_allocation where operation_id = p_operation;
  perform pg_temp.gp_super();
  select coalesce(string_agg((x ->> 'k') || ' ' || pg_temp.gp_name((x ->> 'd')::uuid) || '>' || pg_temp.gp_name((x ->> 'c')::uuid) || ':' || (x ->> 'a'), ' '), '-')
    into v from jsonb_array_elements(coalesce(j, '[]'::jsonb)) x;
  return v;
end $$;

-- REGISTRAR un pago con la funcion real, como p_actor, con la foto de netos
-- dada (jsonb) o, si es nula, la vigente. Devuelve 'OK <op>' / 'REPLAY <op>'
-- / codigo. p_operation/p_expected solo sirven para probar que se rehusa.
create function pg_temp.gp_pay(p_actor uuid, p_key uuid, p_scope uuid, p_payer uuid, p_receiver uuid, p_amount bigint,
                               p_positions jsonb default null, p_operation uuid default null, p_expected uuid default null)
returns text language plpgsql as $$
declare v jsonb; v_payload jsonb;
begin
  v_payload := jsonb_build_object('client_operation_id', p_key, 'command_contract_version', 1,
    'scope_id', p_scope, 'currency_definition_id', '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid,
    'amount', p_amount::text, 'effective_date', current_date::text,
    'payer_participant_id', p_payer, 'receiver_participant_id', p_receiver,
    'expected_positions', coalesce(p_positions, pg_temp.gp_expected(p_scope, p_actor)));
  if p_operation is not null then v_payload := v_payload || jsonb_build_object('operation_id', p_operation, 'expected_version_id', p_expected); end if;
  perform pg_temp.gp_actor(p_actor);
  v := api.record_group_payment(v_payload);
  perform pg_temp.gp_super();
  return case when (v ->> 'already_processed')::boolean then 'REPLAY ' else 'OK ' end || (v ->> 'operation_id');
exception when sqlstate 'PGRST' then
  perform pg_temp.gp_super();
  return (sqlerrm::json ->> 'code') || coalesce(' ' || (sqlerrm::json ->> 'details'), '');
end $$;

-- ANULAR con la funcion real, como p_actor, sobre la version vigente (o la dada).
create function pg_temp.gp_annul(p_actor uuid, p_key uuid, p_operation uuid, p_expected uuid default null) returns text language plpgsql as $$
declare v jsonb; v_exp uuid;
begin
  v_exp := coalesce(p_expected, (select current_version_id from core.operation where id = p_operation));
  perform pg_temp.gp_actor(p_actor);
  v := api.annul_operation(jsonb_build_object('client_operation_id', p_key, 'command_contract_version', 2,
    'operation_id', p_operation, 'expected_version_id', v_exp));
  perform pg_temp.gp_super();
  return case when (v ->> 'already_processed')::boolean then 'REPLAY' else 'OK' end;
exception when sqlstate 'PGRST' then
  perform pg_temp.gp_super();
  return sqlerrm::json ->> 'code';
end $$;

-- SALIR con la funcion real, como p_user. 'OK' / 'REPLAY' / codigo (+ details).
create function pg_temp.gp_leave(p_user uuid, p_key uuid, p_scope uuid) returns text language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.gp_actor(p_user);
  v := api.leave_group(jsonb_build_object('client_command_id', p_key, 'command_contract_version', 1, 'scope_id', p_scope));
  perform pg_temp.gp_super();
  return case when (v ->> 'already_processed')::boolean then 'REPLAY' else 'OK' end;
exception when sqlstate 'PGRST' then
  perform pg_temp.gp_super();
  return (sqlerrm::json ->> 'code') || coalesce(' ' || (sqlerrm::json ->> 'details'), '');
end $$;

-- La deuda reabierta que la excepcion C6 le publica a p_user (sec.my_reopened_debt), como el.
create function pg_temp.gp_reopened_debt(p_user uuid) returns bigint language plpgsql as $$
declare v bigint;
begin
  -- Como postgres con las claims del usuario: authenticated no tiene USAGE en sec (por diseno).
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true);
  select coalesce(sum(amount), 0) into v from sec.my_reopened_debt();
  return v;
end $$;

-- Lo que Personal le ensena a p_user: caja, gasto economico, deuda TOTAL
-- (api.claimed_dimension, membresia + excepcion), filas de pago en
-- Movimientos recientes (api.personal_operation) y la parte reabierta.
create function pg_temp.gp_personal(p_user uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.gp_actor(p_user);
  v := 'caja=' || coalesce((select balance_amount from api.personal_balance), '0')
    || ' gasto=' || coalesce(api.personal_statistics(null, null) ->> 'expense_total', '0')
    || ' deuda=' || coalesce((select sum(amount::bigint) from api.claimed_dimension() where dimension = 'debt'), 0)
    || ' movs_pago=' || (select count(*) from api.personal_operation where operation_class = 'group_payment');
  perform pg_temp.gp_super();
  return v || ' deuda_reabierta=' || pg_temp.gp_reopened_debt(p_user);
end $$;
grant execute on function pg_temp.gp_name(uuid), pg_temp.gp_pairs(uuid), pg_temp.gp_positions(uuid), pg_temp.gp_expected(uuid, uuid),
  pg_temp.gp_decompose_text(uuid, uuid, uuid, bigint), pg_temp.gp_pay(uuid, uuid, uuid, uuid, uuid, bigint, jsonb, uuid, uuid),
  pg_temp.gp_annul(uuid, uuid, uuid, uuid), pg_temp.gp_leave(uuid, uuid, uuid), pg_temp.gp_reopened_debt(uuid), pg_temp.gp_personal(uuid),
  pg_temp.gp_allocation(uuid, uuid)
  to authenticated;
