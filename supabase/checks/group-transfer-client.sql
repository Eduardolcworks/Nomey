-- ============================================================================
-- LA TRANSFERENCIA DE GRUPO DE UNA VOLUNTAD (F12/ADR-007, F12.C3)
-- contra las funciones reales de 20261006120000 y 20261007120000
-- ============================================================================
--
--   cat supabase/checks/lib/group-payment-helpers.sql supabase/checks/group-transfer-client.sql | docker exec -i supabase_db_Nomey psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1
--
-- B3 (`20260928120000`) conserva su check y sus nueve carreras: las propuestas,
-- la aceptacion y la irreversibilidad de dos voluntades siguen demostradas
-- alli, intactas y sin superficie cliente. Lo que se demuestra AQUI es el
-- contrato que las sustituyo en producto:
--
--   A · catalogo y privilegios de lo nuevo
--   B · candidatos: quien puede recibir, y quien no
--   C · un receptor: la operacion, su reparto, su efecto y su caja
--   D · EL FANTASMA — el caso que motivo el cambio entero
--   E · varios receptores: una operacion atomica, reparto exacto
--   F · la caja es SOLO la del emisor
--   G · ni Ingreso ni Gasto
--   H · la deuda cambia YA, y puede cruzar cero
--   I · ni propuesta ni aceptacion
--   J · lo que se rehusa, y antes de escribir
--   K · anulacion: devuelve grupo y caja, con su guarda multi-par
--   L · el historico: una intencion, una fila
\pset pager off
\set ON_ERROR_STOP on
begin;

create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  (select id from core.currency_definition where code = 'USD') as usd,
  (select id from core.category where message_key = 'category.expense.dining' and owner_user_id is null) as cat,
  'f7000000-0000-4000-8000-0000000000a1'::uuid as edu,
  'f7000000-0000-4000-8000-0000000000a2'::uuid as aitor,
  'f7000000-0000-4000-8000-0000000000a3'::uuid as nora,   -- se va del grupo
  'f7000000-0000-4000-8000-0000000000a4'::uuid as cris,   -- otro grupo
  'f7000000-0000-4000-8000-0000000000a5'::uuid as bea,    -- absorbe un fantasma
  'f7000000-0000-4000-8000-0000000000f1'::uuid as s_edu,
  'f7000000-0000-4000-8000-0000000000f2'::uuid as s_aitor,
  'f7000000-0000-4000-8000-0000000000f3'::uuid as s_nora,
  'f7000000-0000-4000-8000-0000000000f4'::uuid as s_cris,
  'f7000000-0000-4000-8000-0000000000f5'::uuid as s_bea,
  'f7000000-0000-4000-8000-000000000010'::uuid as g,
  'f7000000-0000-4000-8000-000000000011'::uuid as g2,
  'f7000000-0000-4000-8000-000000000031'::uuid as p_edu,
  'f7000000-0000-4000-8000-000000000032'::uuid as p_gus,  -- FANTASMA receptor
  'f7000000-0000-4000-8000-000000000033'::uuid as p_ret,  -- fantasma a retirar
  'f7000000-0000-4000-8000-000000000034'::uuid as p_mer,  -- fantasma a fusionar
  'f7000000-0000-4000-8000-000000000041'::uuid as p_cris,
  null::uuid as p_aitor, null::uuid as p_nora, null::uuid as p_bea,
  null::text as token, null::uuid as op1, null::uuid as op3;
grant select, update on fx to authenticated;

create function pg_temp.actor(p_user uuid, p_anon boolean default false) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'is_anonymous', p_anon)::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.super() returns void language sql as $$
  select set_config('role', 'postgres', true);
$$;
create function pg_temp.call(p_fn text, p_payload jsonb, p_who uuid, p_anon boolean default false) returns text
language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.actor(p_who, p_anon);
  execute format('select api.%I($1)', p_fn) into v using p_payload;
  perform pg_temp.super();
  return v::text;
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return 'ERR ' || (sqlerrm::json ->> 'code');
end $$;
create function pg_temp.espera(p_label text, p_got text, p_want text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception '%: se esperaba «%» y se obtuvo «%»', p_label, p_want, p_got;
  end if;
end $$;
create function pg_temp.k(p_n integer) returns uuid language sql immutable as $$
  select ('f7e00000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid;
$$;

-- TRANSFERIR con la funcion real, como p_who. Devuelve 'ok:<operation_id>',
-- 'replay:<operation_id>' o el codigo de la frontera.
create function pg_temp.transferir(p_who uuid, p_key uuid, p_group uuid, p_total text,
                                   p_receivers uuid[], p_concept text default null,
                                   p_anon boolean default false, p_extra jsonb default null)
returns text language plpgsql as $$
declare v jsonb; p jsonb;
begin
  -- La fecha y la hora van en el payload, como en un gasto o en un pago: son
  -- las del aparato de quien registra, no las del reloj del servidor.
  p := jsonb_build_object('client_operation_id', p_key, 'command_contract_version', 1,
         'group_scope_id', p_group, 'total_amount', p_total,
         'effective_date', current_date::text, 'effective_time', localtime(0)::text,
         'receiver_participant_ids', to_jsonb(coalesce(p_receivers, '{}'::uuid[])));
  if p_concept is not null then p := p || jsonb_build_object('concept', p_concept); end if;
  if p_extra is not null then p := p || p_extra; end if;
  perform pg_temp.actor(p_who, p_anon);
  v := api.record_group_transfer(p);
  perform pg_temp.super();
  return case when (v ->> 'already_processed')::boolean then 'replay:' else 'ok:' end || (v ->> 'operation_id');
exception when sqlstate 'PGRST' then
  perform pg_temp.super();
  return sqlerrm::json ->> 'code';
end $$;

-- Los candidatos como «nombre=estado», ordenados POR NOMBRE para poder
-- afirmar sobre el conjunto sin depender del orden de entrega.
create function pg_temp.cands(p_who uuid, p_group uuid, p_anon boolean default false)
returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.actor(p_who, p_anon);
  select string_agg(display_name || '=' || state, ' ' order by display_name) into v
    from api.group_transfer_candidates(p_group);
  perform pg_temp.super();
  return coalesce(v, 'sin-filas');
end $$;

-- Y el ORDEN EN QUE LOS ENTREGA, que es el contrato del reparto: la lista
-- de nombres tal cual sale de la funcion.
create function pg_temp.cands_orden(p_who uuid, p_group uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.actor(p_who);
  select string_agg(display_name, ' ') into v from api.group_transfer_candidates(p_group);
  perform pg_temp.super();
  return coalesce(v, 'sin-filas');
end $$;

-- El reparto persistido de una operacion: «nombre:importe» por ordinal.
create function pg_temp.reparto(p_operation uuid) returns text language sql stable as $$
  select coalesce(string_agg(p.display_name || ':' || a.amount, ' ' order by a.ordinal), 'sin-reparto')
    from core.group_transfer_allocation a
    join core.operation_version ov on ov.id = a.operation_version_id
    join core.operation o on o.id = ov.operation_id and o.current_version_id = ov.id
    join core.participant p on p.id = a.receiver_participant_id
   where ov.operation_id = p_operation;
$$;

-- Los pares del grupo, NETEADOS por pareja y en su direccion real:
-- «deudor>acreedor:importe», siempre positivo.
--
-- Netear por la pareja SIN orden es lo que hace legible el cruce de cero:
-- los efectos se guardan con el deudor y el acreedor de cada hecho, asi que
-- una deuda de A a B y una transferencia de B a A viven como dos direcciones
-- distintas de la MISMA relacion. Saldos las lee juntas, y aqui tambien.
create function pg_temp.pares(p_scope uuid) returns text language sql stable as $$
  select coalesce(string_agg(t.linea, ' ' order by t.linea), 'sin-deuda') from (
    select case when t0.neto > 0 then t0.bajo || '>' || t0.alto || ':' || t0.neto
                else t0.alto || '>' || t0.bajo || ':' || (- t0.neto) end as linea
      from (select least(pd.display_name, pc.display_name)    as bajo,
                   greatest(pd.display_name, pc.display_name) as alto,
                   sum(case when pd.display_name < pc.display_name
                            then e.debt_amount else - e.debt_amount end) as neto
              from core.current_effect e
              join core.participant pd on pd.id = e.debt_debtor_participant_id
              join core.participant pc on pc.id = e.debt_creditor_participant_id
             where e.scope_id = p_scope and e.debt_amount is not null
             group by 1, 2
            having sum(case when pd.display_name < pc.display_name
                            then e.debt_amount else - e.debt_amount end) <> 0) t0) t;
$$;

-- Lo que Personal le ensena a una cuenta: caja, gasto e ingreso del periodo.
create function pg_temp.personal(p_user uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.actor(p_user);
  v := 'caja=' || coalesce((select balance_amount from api.personal_balance), '0')
    || ' gasto=' || coalesce(api.personal_statistics(null, null) ->> 'expense_total', '0')
    || ' ingreso=' || coalesce(api.personal_statistics(null, null) ->> 'income_total', '0');
  perform pg_temp.super();
  return v;
end $$;

grant execute on function pg_temp.actor(uuid, boolean), pg_temp.super(), pg_temp.call(text, jsonb, uuid, boolean),
  pg_temp.espera(text, text, text), pg_temp.k(integer),
  pg_temp.transferir(uuid, uuid, uuid, text, uuid[], text, boolean, jsonb),
  pg_temp.cands(uuid, uuid, boolean), pg_temp.cands_orden(uuid, uuid),
  pg_temp.reparto(uuid), pg_temp.pares(uuid),
  pg_temp.personal(uuid) to authenticated;

do $f$
declare r fx%rowtype; v text;
begin
  select * into r from fx;
  perform pg_temp.super();
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (r.s_edu, 'personal', r.eur, r.edu), (r.s_aitor, 'personal', r.eur, r.aitor),
    (r.s_nora, 'personal', r.eur, r.nora), (r.s_cris, 'personal', r.eur, r.cris),
    (r.s_bea, 'personal', r.eur, r.bea);
  insert into core.membership (scope_id, user_id) values
    (r.s_edu, r.edu), (r.s_aitor, r.aitor), (r.s_nora, r.nora), (r.s_cris, r.cris), (r.s_bea, r.bea);

  perform pg_temp.actor(r.edu);   perform api.reserve_username('{"handle":"gt7_edu","public_name":"Edu"}');
  perform pg_temp.actor(r.aitor); perform api.reserve_username('{"handle":"gt7_aitor","public_name":"Aitor"}');
  perform pg_temp.super();

  -- El grupo: Edu con TRES fantasmas —Gus recibe, Ret se retira, Mer se
  -- fusiona— y luego entran Aitor, Nora y Bea.
  v := pg_temp.call('create_group', jsonb_build_object('client_command_id', pg_temp.k(1), 'command_contract_version', 1,
    'client_group_id', r.g, 'display_name', 'Viaje', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', r.p_edu, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(
      jsonb_build_object('client_participant_id', r.p_gus, 'display_name', 'Gus'),
      jsonb_build_object('client_participant_id', r.p_ret, 'display_name', 'Ret'),
      jsonb_build_object('client_participant_id', r.p_mer, 'display_name', 'Mer'))), r.edu);
  if v like 'ERR%' then raise exception 'fixture create_group: %', v; end if;

  v := pg_temp.call('create_group_invitation', jsonb_build_object('client_command_id', pg_temp.k(2), 'command_contract_version', 1, 'scope_id', r.g), r.edu);
  update fx set token = v::jsonb ->> 'token';
  select * into r from fx;

  v := pg_temp.call('redeem_invitation', jsonb_build_object('client_command_id', pg_temp.k(3), 'command_contract_version', 1,
         'token', r.token, 'choice', 'new', 'display_name', 'Aitor'), r.aitor);
  update fx set p_aitor = (v::jsonb ->> 'participant_id')::uuid;
  v := pg_temp.call('redeem_invitation', jsonb_build_object('client_command_id', pg_temp.k(4), 'command_contract_version', 1,
         'token', r.token, 'choice', 'new', 'display_name', 'Nora'), r.nora);
  update fx set p_nora = (v::jsonb ->> 'participant_id')::uuid;
  -- Bea entra y ABSORBE al fantasma Mer, que queda como origen fusionado.
  v := pg_temp.call('redeem_invitation', jsonb_build_object('client_command_id', pg_temp.k(5), 'command_contract_version', 1,
         'token', r.token, 'choice', 'new', 'display_name', 'Bea'), r.bea);
  update fx set p_bea = (v::jsonb ->> 'participant_id')::uuid;
  select * into r from fx;
  v := pg_temp.call('associate_participant', jsonb_build_object('client_command_id', pg_temp.k(6), 'command_contract_version', 1,
         'scope_id', r.g, 'participant_id', r.p_mer), r.bea);
  if v like 'ERR%' then raise exception 'fixture associate: %', v; end if;

  -- Ret se retira (sin deuda: nunca participo en nada).
  v := pg_temp.call('retire_participant', jsonb_build_object('client_operation_id', pg_temp.k(7), 'command_contract_version', 1,
         'scope_id', r.g, 'participant_id', r.p_ret, 'expected_pairs', '[]'::jsonb), r.edu);
  if v like 'ERR%' then raise exception 'fixture retire: %', v; end if;

  -- Nora se va.
  v := pg_temp.call('leave_group', jsonb_build_object('client_command_id', pg_temp.k(8), 'command_contract_version', 1,
         'scope_id', r.g), r.nora);
  if v like 'ERR%' then raise exception 'fixture leave: %', v; end if;

  -- EL TIEMPO, que dentro de una transaccion no pasa. Sin esto los siete
  -- nacen con el mismo `created_at` y el orden canonico lo decide el
  -- identificador, aleatorio para quien entro por invitacion. Se separan
  -- para que el orden que se afirma sea el de entrada, como en produccion.
  perform pg_temp.super();
  update core.participant p
     set created_at = now() - interval '1 hour' + (interval '1 minute' * x.n)
    from (values (r.p_edu, 1), (r.p_gus, 2), (r.p_ret, 3), (r.p_mer, 4),
                 (r.p_aitor, 5), (r.p_nora, 6), (r.p_bea, 7)) as x(id, n)
   where p.id = x.id;

  -- Otro grupo, para el participante ajeno.
  v := pg_temp.call('create_group', jsonb_build_object('client_command_id', pg_temp.k(9), 'command_contract_version', 1,
    'client_group_id', r.g2, 'display_name', 'Otro', 'emoji', 'GRP', 'currency_definition_id', r.eur,
    'creator_participant_id', r.p_cris, 'creator_display_name', 'Cris', 'participants', '[]'::jsonb), r.cris);
  if v like 'ERR%' then raise exception 'fixture create_group g2: %', v; end if;
end
$f$;

-- ═══════════════ A · catalogo y privilegios ═════════════════════════════════
do $a$
declare r fx%rowtype; v text;
begin
  select * into r from fx;

  -- El writer es del WRITER, no de postgres: una frontera de ESCRITURA se
  -- queda BAJO la RLS (E16), al reves que una de lectura.
  select pg_get_userbyid(p.proowner) into v from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname = 'record_group_transfer';
  perform pg_temp.espera('A · propietario del writer', v, 'nomey_writer');

  select case when p.prosecdef then 'definer' else 'invoker' end into v from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname = 'record_group_transfer';
  perform pg_temp.espera('A · definer', v, 'definer');

  -- El veredicto vive en `sec`, donde `authenticated` no llega.
  select has_function_privilege('authenticated',
    (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'sec' and p.proname = 'group_transfer_state'), 'execute')::text into v;
  perform pg_temp.espera('A · sec.group_transfer_state fuera del cliente', v, 'false');

  -- `authenticated` ejecuta el writer y la lista, y nada mas.
  select has_function_privilege('authenticated',
    (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'api' and p.proname = 'record_group_transfer'), 'execute')::text into v;
  perform pg_temp.espera('A · EXECUTE del writer', v, 'true');

  -- La tabla del reparto: RLS encendida, y el cliente solo ve la de sus grupos.
  select c.relrowsecurity::text into v from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'core' and c.relname = 'group_transfer_allocation';
  perform pg_temp.espera('A · RLS en core.group_transfer_allocation', v, 'true');

  -- Las dos vistas son invoker: la autorizacion es la de las tablas.
  select string_agg(c.relname || '=' || coalesce((select option_value from pg_options_to_table(c.reloptions)
                                                   where option_name = 'security_invoker'), 'off'), ' ' order by c.relname)
    into v from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'api' and c.relname in ('group_transfer_operation', 'group_transfer_allocation');
  perform pg_temp.espera('A · vistas invoker', v,
    'group_transfer_allocation=true group_transfer_operation=true');

  -- NI uid, NI correo, NI handle en ninguna de las dos.
  select coalesce(string_agg(column_name, ' '), 'ninguna') into v from information_schema.columns
   where table_schema = 'api' and table_name in ('group_transfer_operation', 'group_transfer_allocation')
     and (column_name like '%user_id%' or column_name like '%email%' or column_name like '%handle%');
  perform pg_temp.espera('A · sin identidad de cuenta', v, 'ninguna');

  -- Y la superficie del contrato rechazado NO existe.
  select coalesce(string_agg(p.proname, ' '), 'ninguna') into v from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname in ('group_transfer_context', 'group_transfer_pair_net');
  perform pg_temp.espera('A · sin preflight de un receptor', v, 'ninguna');
  select coalesce(string_agg(table_name, ' '), 'ninguna') into v from information_schema.views
   where table_schema = 'api' and table_name = 'my_group_transfer_proposals';
  perform pg_temp.espera('A · sin vista agregada de pendientes', v, 'ninguna');

  -- B3 SIGUE EN PIE, dormido: sus tres comandos y sus dos vistas.
  select string_agg(p.proname, ' ' order by p.proname) into v from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname in ('create_group_transfer_proposal',
     'cancel_group_transfer_proposal', 'decline_group_transfer_proposal', 'record_settlement_by_transfer');
  perform pg_temp.espera('A · B3 conservado', v,
    'cancel_group_transfer_proposal create_group_transfer_proposal decline_group_transfer_proposal record_settlement_by_transfer');

  -- `api.group_operation` no cambio: la transferencia NO entra en el histórico
  -- de gastos.
  select count(*)::text into v from information_schema.columns
   where table_schema = 'api' and table_name = 'group_operation' and column_name = 'total_amount';
  perform pg_temp.espera('A · group_operation intacta', v, '1');

  raise notice 'OK · A · catalogo: writer del writer, veredicto fuera del cliente, vistas invoker sin identidad, superficie rechazada retirada, B3 en pie';
end
$a$;

-- ═══════════════ B · candidatos: quien puede recibir ════════════════════════
do $b$
declare r fx%rowtype; v text;
begin
  select * into r from fx;

  -- EL VEREDICTO, uno por participante:
  --   Gus, Aitor, Bea = ready         (fantasma y vinculados, todos activos)
  --   Edu             = self          (uno mismo nunca)
  --   Ret             = unavailable   (retirado)
  --   Mer             = unavailable   (origen de una fusion)
  --   Nora            = unavailable   (salio del grupo)
  perform pg_temp.espera('B · el veredicto de cada uno',
    pg_temp.cands(r.edu, r.g),
    'Aitor=ready Bea=ready Edu=self Gus=ready Mer=unavailable Nora=unavailable Ret=unavailable');

  -- EL ORDEN es parte del contrato: `(created_at, id)`, el mismo con el que
  -- el writer reparte. Se compara contra la regla calculada aparte, no
  -- contra una lista cableada: dentro de un mismo `create_group` todos los
  -- participantes comparten `created_at` —es una sola transaccion— y el
  -- desempate lo hace el identificador, que es igual de estable.
  select string_agg(p.display_name, ' ' order by p.created_at, p.id) into v
    from core.participant p where p.scope_id = r.g;
  perform pg_temp.espera('B · entrega en el orden canonico de reparto',
    pg_temp.cands_orden(r.edu, r.g), v);

  -- NINGUNA cuenta hace falta: Gus no tiene cuenta, ni username, ni Personal,
  -- y es `ready` igual que Aitor, que los tiene los tres.
  select string_agg(p.display_name || '=' || sec.participant_is_linked(p.id)::text, ' ' order by p.created_at)
    into v from core.participant p where p.scope_id = r.g and p.display_name in ('Gus', 'Aitor');
  perform pg_temp.espera('B · uno vinculado y el otro no, los dos ready', v, 'Gus=false Aitor=true');

  -- Un ambito AJENO: cero filas, no un error. No se distingue de inexistente.
  perform pg_temp.espera('B · grupo ajeno', pg_temp.cands(r.edu, r.g2), 'sin-filas');
  perform pg_temp.espera('B · grupo inexistente',
    pg_temp.cands(r.edu, '00000000-0000-4000-8000-000000000000'::uuid), 'sin-filas');

  -- Y el participante de OTRO grupo no aparece en esta lista por definicion.
  select (count(*) = 0)::text into v from core.participant p
   where p.scope_id = r.g and p.id = r.p_cris;
  perform pg_temp.espera('B · el ajeno no esta en el ambito', v, 'true');

  raise notice 'OK · B · candidatos: fantasma ready, self, retirado, fusionado y salido fuera; cuenta irrelevante; ambito ajeno sin filas';
end
$b$;

-- ═══════════════ C · un receptor: operacion, reparto, efecto y caja ═════════
do $c$
declare r fx%rowtype; v text; v_op uuid;
begin
  select * into r from fx;

  -- Edu declara 25,00 € a Aitor. Sin propuesta y sin que nadie acepte.
  v := pg_temp.transferir(r.edu, pg_temp.k(20), r.g, '2500', array[r.p_aitor], 'Cena');
  if v not like 'ok:%' then raise exception 'C · transferir: %', v; end if;
  v_op := substring(v from 4)::uuid;
  update fx set op1 = v_op;

  -- UNA operacion, UNA version, de la clase nueva.
  select o.operation_class || ' v' || count(ov.id)::text into v
    from core.operation o join core.operation_version ov on ov.operation_id = o.id
   where o.id = v_op group by o.operation_class;
  perform pg_temp.espera('C · una operacion group_transfer con una version', v, 'group_transfer v1');

  perform pg_temp.espera('C · el reparto', pg_temp.reparto(v_op), 'Aitor:2500');

  -- UN efecto de deuda y UN efecto de caja, y nada mas.
  select string_agg(e.accounting_class || ':' || coalesce(e.debt_amount::text, e.balance_amount::text), ' ' order by e.accounting_class)
    into v from core.current_effect e where e.operation_version_id = (select current_version_id from core.operation where id = v_op);
  perform pg_temp.espera('C · dos efectos: la deuda y la caja del emisor', v, 'settlement:-2500 transfer:-2500');

  -- La deuda del par, YA: Aitor debe 25 a Edu (no habia deuda previa, asi que
  -- la transferencia la CREA invertida — sin tope, §9).
  perform pg_temp.espera('C · el par', pg_temp.pares(r.g), 'Aitor>Edu:2500');

  -- Idempotencia: la misma clave no crea una segunda.
  perform pg_temp.espera('C · replay', pg_temp.transferir(r.edu, pg_temp.k(20), r.g, '2500', array[r.p_aitor], 'Cena'),
    'replay:' || v_op::text);
  select count(distinct o.id)::text into v
    from core.operation o
    join core.operation_version ov on ov.id = o.current_version_id
    join core.group_transfer_allocation a on a.operation_version_id = ov.id
   where o.operation_class = 'group_transfer' and a.scope_id = r.g;
  perform pg_temp.espera('C · sigue habiendo una', v, '1');

  raise notice 'OK · C · un receptor: una operacion, un reparto, deuda + caja del emisor, idempotente';
end
$c$;

-- ═══════════════ D · EL FANTASMA ════════════════════════════════════════════
--
-- El caso que motivo el cambio entero. Gus no tiene cuenta, ni username, ni
-- Modo Personal, ni amistad, ni vinculo — y recibe una transferencia como
-- cualquiera.
do $d$
declare r fx%rowtype; v text; v_op uuid;
begin
  select * into r from fx;

  -- Lo que Gus NO tiene, dicho antes de transferirle.
  select 'vinculo=' || sec.participant_is_linked(r.p_gus)::text
      || ' personal=' || coalesce(sec.participant_personal_scope(r.p_gus)::text, 'ninguno')
    into v;
  perform pg_temp.espera('D · el fantasma no tiene nada de cuenta', v, 'vinculo=false personal=ninguno');

  v := pg_temp.transferir(r.edu, pg_temp.k(21), r.g, '1000', array[r.p_gus], 'Le adelanto');
  if v not like 'ok:%' then raise exception 'D · transferir al fantasma: %', v; end if;
  v_op := substring(v from 4)::uuid;

  perform pg_temp.espera('D · el reparto', pg_temp.reparto(v_op), 'Gus:1000');
  select string_agg(e.accounting_class || ':' || coalesce(e.debt_amount::text, e.balance_amount::text), ' ' order by e.accounting_class)
    into v from core.current_effect e where e.operation_version_id = (select current_version_id from core.operation where id = v_op);
  perform pg_temp.espera('D · deuda del par + caja del emisor, sin mas', v, 'settlement:-1000 transfer:-1000');

  -- La deuda existe y nombra al FANTASMA: el receptor autoritativo es el
  -- participante, no una cuenta.
  perform pg_temp.espera('D · los dos pares', pg_temp.pares(r.g), 'Aitor>Edu:2500 Gus>Edu:1000');

  -- Y NO se creo ningun Personal para el.
  select coalesce(sec.participant_personal_scope(r.p_gus)::text, 'ninguno') into v;
  perform pg_temp.espera('D · sigue sin Personal', v, 'ninguno');

  raise notice 'OK · D · el fantasma recibe: sin cuenta, sin username, sin Personal, sin vinculo — y sin inventarle ninguno';
end
$d$;

-- ═══════════════ E · varios receptores: una operacion atomica ═══════════════
do $e$
declare r fx%rowtype; v text; v_want text; v_op uuid;
begin
  select * into r from fx;

  -- 10,00 € entre TRES: 3,34 / 3,33 / 3,33. El centimo que sobra va al
  -- PRIMERO DEL ORDEN CANONICO, y el orden del JSON no influye — se manda a
  -- proposito en un orden distinto del canonico.
  v := pg_temp.transferir(r.edu, pg_temp.k(22), r.g, '1000', array[r.p_bea, r.p_aitor, r.p_gus]);
  if v not like 'ok:%' then raise exception 'E · transferir a tres: %', v; end if;
  v_op := substring(v from 4)::uuid;
  update fx set op3 = v_op;

  -- El reparto esperado, calculado con la MISMA regla que el cliente usa
  -- para su vista previa: los tres en orden canonico, y el centimo al
  -- primero.
  select string_agg(q.display_name || ':' || (case when q.n = 1 then 334 else 333 end)::text,
                    ' ' order by q.n) into v_want
    from (select p.display_name,
                 row_number() over (order by p.created_at, p.id) as n
            from core.participant p
           where p.id in (r.p_gus, r.p_aitor, r.p_bea)) q;
  perform pg_temp.espera('E · reparto por mayor resto, en orden canonico',
    pg_temp.reparto(v_op), v_want);

  -- Y el orden de los ordinales es EXACTAMENTE el de los candidatos.
  select string_agg(p.display_name, ' ' order by a.ordinal) into v
    from core.group_transfer_allocation a
    join core.participant p on p.id = a.receiver_participant_id
   where a.operation_version_id = (select current_version_id from core.operation where id = v_op);
  select string_agg(x.display_name, ' ' order by x.created_at, x.id) into v_want
    from core.participant x where x.id in (r.p_gus, r.p_aitor, r.p_bea);
  perform pg_temp.espera('E · los ordinales siguen el orden canonico', v, v_want);

  -- UNA operacion y UNA version para las tres.
  select count(*)::text into v from core.operation_version where operation_id = v_op;
  perform pg_temp.espera('E · una sola version', v, '1');

  -- TRES allocations y TRES efectos de deuda, mas UNA caja.
  select count(*)::text into v from core.group_transfer_allocation
   where operation_version_id = (select current_version_id from core.operation where id = v_op);
  perform pg_temp.espera('E · tres allocations', v, '3');
  select count(*) filter (where debt_amount is not null)::text || '/' || count(*) filter (where balance_amount is not null)::text
    into v from core.current_effect
   where operation_version_id = (select current_version_id from core.operation where id = v_op);
  perform pg_temp.espera('E · tres deudas y una caja', v, '3/1');

  -- La suma del reparto es EXACTAMENTE el total.
  select sum(amount)::text into v from core.group_transfer_allocation
   where operation_version_id = (select current_version_id from core.operation where id = v_op);
  perform pg_temp.espera('E · la suma cierra', v, '1000');

  raise notice 'OK · E · varios receptores: una operacion, una version, N allocations, N efectos, reparto exacto por orden canonico';
end
$e$;

-- ═══════════════ F · la caja es SOLO la del emisor ══════════════════════════
do $f2$
declare r fx%rowtype; v text;
begin
  select * into r from fx;

  -- Edu ha declarado 25,00 + 10,00 + 10,00 = 45,00 €.
  perform pg_temp.espera('F · la caja del emisor baja por el total',
    pg_temp.personal(r.edu), 'caja=-4500 gasto=0 ingreso=0');

  -- Aitor NO recibe caja: ni la de C (25,00) ni la de E (3,33).
  perform pg_temp.espera('F · el receptor vinculado no recibe nada en su Personal',
    pg_temp.personal(r.aitor), 'caja=0 gasto=0 ingreso=0');
  perform pg_temp.espera('F · ni Bea', pg_temp.personal(r.bea), 'caja=0 gasto=0 ingreso=0');

  -- Y no hay NINGUN efecto en un ambito personal que no sea el del emisor.
  select coalesce(string_agg(distinct s.owner_user_id::text, ' '), 'ninguno') into v
    from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
    join core.operation o on o.id = ov.operation_id
    join core.scope s on s.id = e.scope_id and s.kind = 'personal'
   where o.operation_class = 'group_transfer'
     and exists (select 1 from core.group_transfer_allocation a
                  where a.operation_version_id = ov.id and a.scope_id = r.g);
  perform pg_temp.espera('F · el unico Personal tocado es el del emisor', v, r.edu::text);

  -- UN efecto de caja por operacion, no N.
  select string_agg(c::text, ' ' order by c) into v from (
    select count(*) filter (where e.balance_amount is not null) as c
      from core.operation o
      join core.current_effect e on e.operation_version_id = o.current_version_id
     where o.operation_class = 'group_transfer'
       and exists (select 1 from core.group_transfer_allocation a
                    where a.operation_version_id = o.current_version_id and a.scope_id = r.g)
     group by o.id) t;
  perform pg_temp.espera('F · una sola caja por operacion', v, '1 1 1');

  raise notice 'OK · F · caja del emisor por el total, cero en todos los receptores, un efecto de balance por operacion';
end
$f2$;

-- ═══════════════ G · ni Ingreso ni Gasto ════════════════════════════════════
do $g$
declare r fx%rowtype; v text;
begin
  select * into r from fx;

  -- El debito del emisor es CAJA, no consumo: no produce dimension economica.
  select count(*)::text into v from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
    join core.operation o on o.id = ov.operation_id
   where o.operation_class = 'group_transfer' and e.economic_amount is not null
     and exists (select 1 from core.group_transfer_allocation a
                  where a.operation_version_id = ov.id and a.scope_id = r.g);
  perform pg_temp.espera('G · ninguna dimension economica', v, '0');

  -- Y las estadisticas no la cuentan por ninguno de los dos lados. F12.E.E
  -- (`20261002120000`) cuenta SOLO `internal_transfer` recibida como Ingreso,
  -- y esta clase no es esa.
  perform pg_temp.espera('G · el emisor no registra gasto', pg_temp.personal(r.edu), 'caja=-4500 gasto=0 ingreso=0');
  perform pg_temp.espera('G · el receptor no registra ingreso', pg_temp.personal(r.aitor), 'caja=0 gasto=0 ingreso=0');

  raise notice 'OK · G · ni Gasto para el emisor ni Ingreso para el receptor: el debito es caja';
end
$g$;

-- ═══════════════ H · la deuda cambia YA, y cruza cero ═══════════════════════
do $h$
declare r fx%rowtype; v text; v_op uuid;
begin
  select * into r from fx;

  -- Un gasto que deja a Edu debiendo a Aitor: 30,00 pagados por Aitor entre
  -- los dos → Edu le debe 15,00. Sobre la deuda ya existente de 25,00 a favor
  -- de Edu, el par queda en 10,00 a favor de Edu.
  v := pg_temp.call('record_group_expense', jsonb_build_object(
    'client_operation_id', pg_temp.k(23), 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'total', '3000',
    'effective_date', current_date::text, 'payer_participant_id', r.p_aitor,
    'participants', jsonb_build_array(r.p_edu, r.p_aitor),
    'split_method', jsonb_build_object('kind', 'equal'),
    'concept', 'Taxi', 'category_id', r.cat), r.aitor);
  if v like 'ERR%' then raise exception 'H · gasto: %', v; end if;
  perform pg_temp.espera('H · tras el gasto', pg_temp.pares(r.g),
    'Aitor>Edu:1333 Bea>Edu:333 Gus>Edu:1334');

  -- Aitor le debe 13,33 a Edu. Edu le transfiere 30,00 MAS: el importe se
  -- aplica COMPLETO y sin tope, asi que la deuda de Aitor crece a 43,33 en
  -- vez de quedarse en lo que habia.
  v := pg_temp.transferir(r.edu, pg_temp.k(24), r.g, '3000', array[r.p_aitor]);
  if v not like 'ok:%' then raise exception 'H · transferir sobre deuda: %', v; end if;
  perform pg_temp.espera('H · sin tope: el par se mueve el importe entero', pg_temp.pares(r.g),
    'Aitor>Edu:4333 Bea>Edu:333 Gus>Edu:1334');

  -- Y CRUZA CERO: Aitor, que debe 43,33, transfiere 50,00 a Edu. No se
  -- salda y sobra: el par se INVIERTE y Edu pasa a deberle 6,67.
  v := pg_temp.transferir(r.aitor, pg_temp.k(25), r.g, '5000', array[r.p_edu]);
  if v not like 'ok:%' then raise exception 'H · cruzar cero: %', v; end if;
  perform pg_temp.espera('H · cruza cero y deja la deuda invertida', pg_temp.pares(r.g),
    'Bea>Edu:333 Edu>Aitor:667 Gus>Edu:1334');

  raise notice 'OK · H · la deuda cambia al confirmar: importe completo, sin tope, cruzando cero en los dos sentidos';
end
$h$;

-- ═══════════════ I · ni propuesta ni aceptacion ═════════════════════════════
do $i$
declare r fx%rowtype; v text;
begin
  select * into r from fx;

  -- NINGUNA propuesta de grupo se creo por el camino.
  select count(*)::text into v from core.group_transfer_proposal where group_scope_id = r.g;
  perform pg_temp.espera('I · cero propuestas de grupo', v, '0');

  -- NINGUNA `transfer_part`: eso es B3, y B3 no se ejecuto.
  select count(*)::text into v from core.transfer_part;
  perform pg_temp.espera('I · cero transfer_part', v, '0');

  -- Y ninguna operacion de la clase de dos voluntades.
  select count(*)::text into v from core.operation where operation_class = 'settlement_by_transfer';
  perform pg_temp.espera('I · cero settlement_by_transfer', v, '0');

  -- El receptor no tuvo que hacer NADA: la operacion ya es vigente.
  select count(distinct o.id)::text into v
    from core.operation o
    join core.operation_version ov on ov.id = o.current_version_id
    join core.group_transfer_allocation a on a.operation_version_id = ov.id
   where o.operation_class = 'group_transfer' and a.scope_id = r.g
     and ov.version_kind = 'record';
  perform pg_temp.espera('I · todas vigentes sin que nadie aceptara', v, '5');

  raise notice 'OK · I · sin propuesta, sin transfer_part, sin aceptacion: la operacion nace vigente';
end
$i$;

-- ═══════════════ J · lo que se rehusa, y antes de escribir ══════════════════
do $j$
declare r fx%rowtype; v text; v_antes bigint;
begin
  select * into r from fx;
  select count(distinct o.id) into v_antes
    from core.operation o
    join core.operation_version ov on ov.id = o.current_version_id
    join core.group_transfer_allocation a on a.operation_version_id = ov.id
   where o.operation_class = 'group_transfer' and a.scope_id = r.g;

  -- Uno mismo.
  perform pg_temp.espera('J · a uno mismo',
    pg_temp.transferir(r.edu, pg_temp.k(30), r.g, '1000', array[r.p_edu]), 'DEBT_SELF_REFERENCE');
  -- Un participante de OTRO grupo.
  perform pg_temp.espera('J · de otro ambito',
    pg_temp.transferir(r.edu, pg_temp.k(31), r.g, '1000', array[r.p_cris]), 'PARTICIPANT_NOT_IN_SCOPE');
  -- Retirado: retirar CIERRA su presencia, asi que lo que llega es que ya no
  -- es elegible hoy. Las dos guardas lo rehusan; la primera es esa.
  perform pg_temp.espera('J · retirado',
    pg_temp.transferir(r.edu, pg_temp.k(32), r.g, '1000', array[r.p_ret]), 'PARTICIPANT_NOT_ELIGIBLE');
  perform pg_temp.espera('J · origen de una fusion',
    pg_temp.transferir(r.edu, pg_temp.k(33), r.g, '1000', array[r.p_mer]), 'PARTICIPANT_MERGED');
  -- Quien salio del grupo.
  perform pg_temp.espera('J · quien salio',
    pg_temp.transferir(r.edu, pg_temp.k(34), r.g, '1000', array[r.p_nora]), 'PARTICIPANT_NOT_ELIGIBLE');
  -- Importe no positivo, y el que no llega a una unidad menor por cabeza.
  perform pg_temp.espera('J · importe cero',
    pg_temp.transferir(r.edu, pg_temp.k(35), r.g, '0', array[r.p_aitor]), 'SETTLEMENT_AMOUNT_NOT_POSITIVE');
  perform pg_temp.espera('J · dos centimos entre tres',
    pg_temp.transferir(r.edu, pg_temp.k(36), r.g, '2', array[r.p_aitor, r.p_gus, r.p_bea]),
    'TRANSFER_AMOUNT_TOO_SMALL');
  -- Lista vacia y duplicados.
  perform pg_temp.espera('J · sin destinatarios',
    pg_temp.transferir(r.edu, pg_temp.k(37), r.g, '1000', '{}'::uuid[]), 'PAYLOAD_INVALID');
  perform pg_temp.espera('J · un destinatario repetido',
    pg_temp.transferir(r.edu, pg_temp.k(38), r.g, '1000', array[r.p_aitor, r.p_aitor]), 'PAYLOAD_INVALID');
  -- Un grupo del que no se es miembro.
  perform pg_temp.espera('J · grupo ajeno',
    pg_temp.transferir(r.edu, pg_temp.k(39), r.g2, '1000', array[r.p_cris]), 'NOT_AUTHORIZED');
  -- Y CORREGIR no existe: es un error de forma, antes que nada.
  perform pg_temp.espera('J · corregir no existe',
    pg_temp.transferir(r.edu, pg_temp.k(40), r.g, '1000', array[r.p_aitor], null, false,
      jsonb_build_object('operation_id', r.op1, 'expected_version_id',
        (select current_version_id from core.operation where id = r.op1))),
    'TRANSFER_NOT_EDITABLE');

  -- NINGUNO dejo nada escrito.
  select (count(distinct o.id) - v_antes)::text into v
    from core.operation o
    join core.operation_version ov on ov.id = o.current_version_id
    join core.group_transfer_allocation a on a.operation_version_id = ov.id
   where o.operation_class = 'group_transfer' and a.scope_id = r.g;
  perform pg_temp.espera('J · ni una operacion nueva', v, '0');
  select count(*)::text into v from core.group_transfer_allocation a
    join core.operation_version ov on ov.id = a.operation_version_id
    join core.operation o on o.id = ov.operation_id
   where o.id not in (select id from core.operation where operation_class = 'group_transfer');
  perform pg_temp.espera('J · ni un reparto huerfano', v, '0');

  raise notice 'OK · J · self, ajeno, retirado, fusionado, salido, importe invalido, lista vacia, duplicados y correccion: rehusados sin escribir';
end
$j$;

-- ═══════════════ K · anulacion ══════════════════════════════════════════════
do $k$
declare r fx%rowtype; v text; v_op uuid;
begin
  select * into r from fx;

  -- Una transferencia NO se corrige pero SI se anula, al reves que las de dos
  -- voluntades. Anular escribe una version SIN efectos: la deuda y la caja
  -- vuelven solas, porque `current_version_id` es la unica autoridad.
  perform pg_temp.espera('K · antes de anular la de tres', pg_temp.pares(r.g),
    'Bea>Edu:333 Edu>Aitor:667 Gus>Edu:1334');

  perform pg_temp.espera('K · anular', pg_temp.gp_annul(r.edu, pg_temp.k(41), r.op3), 'OK');

  -- Los TRES pares vuelven a la vez, y el de Bea —que solo existia por esa
  -- transferencia— desaparece: la anulacion es atomica como el alta.
  perform pg_temp.espera('K · los tres pares vuelven', pg_temp.pares(r.g),
    'Edu>Aitor:1000 Gus>Edu:1000');

  -- Y la caja del emisor recupera los 10,00 €: de -75,00 a -65,00. El gasto
  -- de 15,00 que sigue ahi es su mitad del taxi de H —un gasto compartido si
  -- produce dimension economica—, y la anulacion de una transferencia no lo
  -- toca: son dos hechos distintos.
  perform pg_temp.espera('K · la caja del emisor vuelve, y el gasto no se mueve',
    pg_temp.personal(r.edu), 'caja=-6500 gasto=1500 ingreso=0');

  -- La version anulada no tiene efectos, y el reparto SE CONSERVA: es lo que
  -- esa transferencia declaro, no los saldos de ahora.
  select count(*)::text into v from core.current_effect
   where operation_version_id = (select current_version_id from core.operation where id = r.op3);
  perform pg_temp.espera('K · la version vigente no tiene efectos', v, '0');
  select count(*)::text into v from core.group_transfer_allocation a
    join core.operation_version ov on ov.id = a.operation_version_id
   where ov.operation_id = r.op3;
  perform pg_temp.espera('K · el reparto se conserva en la version anulada', v, '3');

  -- Anular dos veces no vuelve a escribir.
  perform pg_temp.espera('K · anulada ya', pg_temp.gp_annul(r.edu, pg_temp.k(42), r.op3), 'OPERATION_ANNULLED');

  -- Y solo el EMISOR puede: la version toca su Personal, y la autorizacion es
  -- la membresia de cada ambito alcanzado.
  perform pg_temp.espera('K · un tercero no anula',
    pg_temp.gp_annul(r.aitor, pg_temp.k(43), r.op1), 'NOT_AUTHORIZED');

  raise notice 'OK · K · anulable: los N pares y la caja del emisor vuelven a la vez, el reparto se conserva, y solo el emisor anula';
end
$k$;

-- ═══════════════ L · la guarda de anulacion, con N pares ════════════════════
do $l$
declare r fx%rowtype; v text; v_op uuid;
begin
  select * into r from fx;

  -- Edu transfiere 10,00 repartidos entre Gus y Bea. A Bea, que estaba a
  -- cero, le crea una deuda de 5,00 hacia Edu; a Gus le suma 5,00.
  v := pg_temp.transferir(r.edu, pg_temp.k(50), r.g, '1000', array[r.p_gus, r.p_bea]);
  if v not like 'ok:%' then raise exception 'L · transferir: %', v; end if;
  v_op := substring(v from 4)::uuid;
  perform pg_temp.espera('L · tras la transferencia', pg_temp.pares(r.g),
    'Bea>Edu:500 Edu>Aitor:1000 Gus>Edu:1500');

  -- Y ahora Bea le paga a Edu esos 5,00 con «Saldado», que deja su par a
  -- cero. El de Gus no se toca.
  v := pg_temp.call('record_group_payment', jsonb_build_object(
    'client_operation_id', pg_temp.k(51), 'command_contract_version', 1,
    'scope_id', r.g, 'currency_definition_id', r.eur, 'amount', '500',
    'effective_date', current_date::text, 'payer_participant_id', r.p_bea,
    'receiver_participant_id', r.p_edu,
    'expected_positions', pg_temp.gp_expected(r.g, r.bea)), r.bea);
  if v like 'ERR%' then raise exception 'L · pago de Bea: %', v; end if;
  perform pg_temp.espera('L · Bea salda lo suyo', pg_temp.pares(r.g),
    'Edu>Aitor:1000 Gus>Edu:1500');

  -- Anular la transferencia dejaria el par Bea↔Edu en -5,00: Bea habria pagado
  -- una deuda que deja de existir. La guarda lo rehusa, y NO anula nada — ni
  -- siquiera el par de Gus, que si aguantaria.
  perform pg_temp.espera('L · la guarda mira TODOS los pares',
    pg_temp.gp_annul(r.edu, pg_temp.k(52), v_op), 'SETTLEMENT_EXCEEDS_DEBT');
  perform pg_temp.espera('L · y no anulo nada', pg_temp.pares(r.g),
    'Edu>Aitor:1000 Gus>Edu:1500');
  select ov.version_kind into v from core.operation o
    join core.operation_version ov on ov.id = o.current_version_id where o.id = v_op;
  perform pg_temp.espera('L · la operacion sigue vigente', v, 'record');

  raise notice 'OK · L · la guarda de anulacion valida los N pares antes de escribir: si uno falla, no se anula ninguno';
end
$l$;

-- ═══════════════ M · el historico: una intencion, una fila ══════════════════
do $m$
declare r fx%rowtype; v text; v_want text;
begin
  select * into r from fx;

  perform pg_temp.actor(r.edu);
  -- UNA fila por operacion vigente, con su numero de receptores.
  select string_agg(sender_display_name || ':' || total_amount || ':' || receiver_count::text, ' ' order by total_amount)
    into v from api.group_transfer_operation where group_scope_id = r.g;
  perform pg_temp.espera('M · una fila por operacion, con su reparto contado', v,
    'Edu:1000:1 Edu:1000:2 Edu:2500:1 Edu:3000:1 Aitor:5000:1');

  -- La anulada NO aparece: su version vigente no tiene reparto.
  select (count(*) = 0)::text into v from api.group_transfer_operation where operation_id = r.op3;
  perform pg_temp.espera('M · la anulada desaparece del historico', v, 'true');

  -- El detalle: una fila por receptor, con su importe.
  select string_agg(receiver_display_name || ':' || amount, ' ' order by ordinal)
    into v from api.group_transfer_allocation
   where operation_id = (select operation_id from api.group_transfer_operation
                          where group_scope_id = r.g and receiver_count = 2 limit 1);
  perform pg_temp.super();
  select string_agg(p.display_name || ':500', ' ' order by p.created_at, p.id) into v_want
    from core.participant p where p.id in (r.p_gus, r.p_bea);
  perform pg_temp.espera('M · el detalle de la de dos', v, v_want);
  perform pg_temp.actor(r.edu);

  -- `version_id` viaja, porque anular lo necesita.
  select (count(*) filter (where version_id is not null) = count(*))::text
    into v from api.group_transfer_operation where group_scope_id = r.g;
  perform pg_temp.espera('M · la version vigente se publica', v, 'true');

  -- Un ajeno no ve nada de este grupo.
  perform pg_temp.actor(r.cris);
  select count(*)::text into v from api.group_transfer_operation where group_scope_id = r.g;
  perform pg_temp.espera('M · un ajeno no ve nada', v, '0');
  perform pg_temp.super();

  raise notice 'OK · M · historico: una fila por operacion con su detalle, la anulada fuera, version publicada, ambito ajeno vacio';
end
$m$;

rollback;
