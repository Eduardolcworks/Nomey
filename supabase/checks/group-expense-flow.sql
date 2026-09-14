-- Comprobaciones del alta y la lectura de un GASTO COMPARTIDO, contra la base
-- REAL construida por las migraciones.
--
-- Uso, con el stack levantado:
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--     -X -q -v ON_ERROR_STOP=1 < supabase/checks/group-expense-flow.sql
--
-- Acumula los fallos de cada seccion y termina con excepcion si hubo alguno.
-- Todo ocurre dentro de una transaccion que termina en ROLLBACK, asi que **no
-- deja ni una fila**: el censo previo de la base no se toca.
--
-- La identidad y el rol se simulan con `set_config`, igual que en el resto de
-- los checks. Lo que eso NO demuestra es la frontera con un JWT real, que mide
-- `scripts/http-boundary-check.sh`.
--
-- Lo que este fichero tampoco cubre: dos altas SIMULTANEAS con la misma clave.
-- Una sola sesion de psql no tiene concurrencia real.

\pset pager off
\set ON_ERROR_STOP on

begin;

-- ============== A · estructura, privilegios y limites de lectura ===========
do $a$
declare
  fallos text[] := '{}';
  v_n int;
  v_t text;
begin
  -- A1 · el provisioner puede ABRIR periodos y nada mas. Cerrar uno pertenece
  -- al ciclo de vida de participantes, que es F10.
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'core' and table_name = 'participant_period'
     and grantee = 'nomey_provisioner' and privilege_type = 'INSERT';
  if v_n <> 1 then fallos := array_append(fallos, 'A1 el provisioner no puede abrir presencias'); end if;

  -- ADR-034 §1: cerrar la PROPIA presencia al salir es del provisioner, y es
  -- lo unico: UPDATE solo sobre valid_until (privilegio de columna), sin
  -- DELETE, y la politica lo acota al participante vinculado al actor.
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'core' and table_name = 'participant_period'
     and grantee = 'nomey_provisioner' and privilege_type in ('UPDATE','DELETE');
  if v_n <> 0 then fallos := array_append(fallos, 'A1b el provisioner puede modificar o borrar presencias enteras'); end if;
  select string_agg(column_name, ',' order by column_name) into v_t from information_schema.column_privileges
   where table_schema = 'core' and table_name = 'participant_period'
     and grantee = 'nomey_provisioner' and privilege_type = 'UPDATE';
  if v_t is distinct from 'valid_until' then fallos := array_append(fallos, 'A1c el provisioner actualiza mas que valid_until: ' || coalesce(v_t, 'nada')); end if;

  -- A2 · y el CLIENTE sigue sin alcanzarlas, ni para leer ni para escribir: una
  -- presencia dice cuando alguien fue elegible, y no es asunto suyo.
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'core' and table_name = 'participant_period'
     and grantee in ('authenticated','anon');
  if v_n <> 0 then fallos := array_append(fallos, 'A2 el cliente alcanza participant_period'); end if;

  -- A3 · `sec.is_my_participant` es definer, con search_path fijado, y solo
  -- responde sobre uno mismo: no acepta un usuario arbitrario.
  select p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|'
         || pg_get_function_identity_arguments(p.oid)
    into v_t
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'sec' and p.proname = 'is_my_participant';
  if v_t is distinct from 'true|search_path=""|p_participant uuid' then
    fallos := array_append(fallos, ('A3 is_my_participant mal configurada: ' || coalesce(v_t, 'ausente')));
  end if;
  if not pg_get_functiondef((select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                              where n.nspname='sec' and p.proname='is_my_participant'))
         like '%sec.request_actor_id()%' then
    fallos := array_append(fallos, 'A3b is_my_participant no se ancla al actor de la peticion');
  end if;
  if has_function_privilege('anon', 'sec.is_my_participant(uuid)', 'EXECUTE') then
    fallos := array_append(fallos, 'A3c anon puede preguntar por participantes');
  end if;

  -- A4 · el VINCULO sigue sin publicarse en ninguna vista de `api`. Publicarlo
  -- diria que cuenta global hay detras de cada identidad contextual.
  select count(*) into v_n
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class v   on v.oid = r.ev_class
    join pg_namespace nv on nv.oid = v.relnamespace
    join pg_class t   on t.oid = d.refobjid
    join pg_namespace nt on nt.oid = t.relnamespace
   where nv.nspname = 'api' and d.classid = 'pg_rewrite'::regclass
     and nt.nspname = 'core' and t.relname = 'participant_user_link';
  if v_n <> 0 then fallos := array_append(fallos, 'A4 una vista de api lee el vinculo con la cuenta'); end if;

  -- A5 · las dos vistas nuevas existen, son `security_invoker` y solo las lee
  -- quien ha iniciado sesion.
  for v_t in select unnest(array['group_operation','group_summary']) loop
    select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'api' and c.relname = v_t
       and c.reloptions @> array['security_invoker=true'];
    if v_n <> 1 then fallos := array_append(fallos, ('A5 ' || v_t || ' no existe o no es security_invoker')); end if;

    if has_table_privilege('anon', 'api.' || v_t, 'SELECT') then
      fallos := array_append(fallos, ('A5b anon lee ' || v_t));
    end if;
    if not has_table_privilege('authenticated', 'api.' || v_t, 'SELECT') then
      fallos := array_append(fallos, ('A5c authenticated no lee ' || v_t));
    end if;
  end loop;

  -- A6 · NINGUNA de las dos depende de `core.effect`: ADR-013 §9 reserva ese
  -- derecho a la proyeccion canonica, y las dos leen de `core.current_effect`.
  select count(*) into v_n
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class v   on v.oid = r.ev_class
    join pg_namespace nv on nv.oid = v.relnamespace
    join pg_class t   on t.oid = d.refobjid
    join pg_namespace nt on nt.oid = t.relnamespace
   where nv.nspname = 'api' and v.relname in ('group_operation','group_summary')
     and d.classid = 'pg_rewrite'::regclass
     and nt.nspname = 'core' and t.relname = 'effect';
  if v_n <> 0 then fallos := array_append(fallos, 'A6 una vista de grupo depende de core.effect'); end if;

  -- A7 · `assert_shared_category_usable` la ejecuta el escritor y NADIE mas.
  if has_function_privilege('authenticated', 'sec.assert_shared_category_usable(uuid,uuid)', 'EXECUTE') then
    fallos := array_append(fallos, 'A7 el cliente ejecuta la guarda de categoria compartida');
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'A · estructura:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'A · estructura, privilegios y limites de lectura: OK';
end
$a$;

-- ============ B · crear el grupo ABRE las presencias, y es idempotente =====
do $b$
declare
  fallos text[] := '{}';
  v_eur  uuid := '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';
  v_ua   uuid := 'aa000000-0000-4000-8000-000000000001';
  v_g    uuid := 'ab000000-0000-4000-8000-000000000010';
  v_personal uuid := 'ab000000-0000-4000-8000-0000000000f1';
  v_cmd  uuid := 'ac000000-0000-4000-8000-000000000020';
  v_p1   uuid := 'ad000000-0000-4000-8000-000000000031';
  v_p2   uuid := 'ad000000-0000-4000-8000-000000000032';
  v_p3   uuid := 'ad000000-0000-4000-8000-000000000033';
  v_p4   uuid := 'ad000000-0000-4000-8000-000000000034';
  v_base jsonb;
  v_out  jsonb;
  v_n    int;
  v_d    date;
begin
  -- EL CREADOR TIENE MODO PERSONAL, y hace falta que lo tenga: el movimiento de
  -- caja del pagador se asienta en SU ambito personal, derivado del vinculo
  -- —nunca tomado del payload—. Sin ambito personal no hay extremo interno que
  -- registrar, igual que en una transferencia externa, y C4 no podria
  -- distinguir «no se escribio» de «no habia donde escribirlo».
  perform set_config('role', 'postgres', true);
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
  values (v_personal, 'personal', v_eur, v_ua);
  insert into core.membership (scope_id, user_id) values (v_personal, v_ua);

  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true);
  perform set_config('role', 'authenticated', true);

  v_base := jsonb_build_object(
    'client_command_id', v_cmd, 'command_contract_version', 1,
    'client_group_id', v_g, 'display_name', 'Prueba gastos compartidos',
    'emoji', 'GRP', 'currency_definition_id', v_eur,
    'creator_participant_id', v_p1, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(
      jsonb_build_object('client_participant_id', v_p2, 'display_name', 'Ana'),
      jsonb_build_object('client_participant_id', v_p3, 'display_name', 'Luis'),
      jsonb_build_object('client_participant_id', v_p4, 'display_name', 'Marta')));

  v_out := api.create_group(v_base);

  -- Para MIRAR lo escrito hace falta `core`, que el cliente no alcanza: es
  -- justamente lo que A2 comprueba. Se vuelve a `postgres` para inspeccionar y
  -- se regresa a `authenticated` antes de la siguiente llamada a la frontera.
  perform set_config('role', 'postgres', true);

  -- B1 · CUATRO periodos, uno por participante, abiertos y sin cierre.
  select count(*) into v_n
    from core.participant_period pp
    join core.participant p on p.id = pp.participant_id
   where p.scope_id = v_g and pp.valid_until is null;
  if v_n <> 4 then
    fallos := array_append(fallos, format('B1 se esperaban 4 presencias abiertas y hay %s', v_n));
  end if;

  -- B2 · con una fecha coherente con el contrato temporal: el mismo `current_date`
  -- que `sec.assert_participant_eligible` compara contra la fecha efectiva.
  select count(*) into v_n
    from core.participant_period pp
    join core.participant p on p.id = pp.participant_id
   where p.scope_id = v_g and pp.valid_from = current_date;
  if v_n <> 4 then fallos := array_append(fallos, 'B2 alguna presencia no empieza hoy'); end if;

  select min(pp.valid_from) into v_d
    from core.participant_period pp
    join core.participant p on p.id = pp.participant_id
   where p.scope_id = v_g;

  -- B3 · EL REINTENTO NO DUPLICA NI DESPLAZA. Misma clave de comando: la
  -- respuesta es un replay y las presencias siguen siendo las mismas cuatro,
  -- con la misma fecha de inicio.
  perform set_config('role', 'authenticated', true);
  v_out := api.create_group(v_base);
  perform set_config('role', 'postgres', true);
  if (v_out ->> 'replay') is distinct from 'true' then
    fallos := array_append(fallos, format('B3 el reintento no fue replay: %s', v_out::text));
  end if;

  select count(*) into v_n
    from core.participant_period pp
    join core.participant p on p.id = pp.participant_id
   where p.scope_id = v_g;
  if v_n <> 4 then fallos := array_append(fallos, format('B3b el reintento dejo %s presencias', v_n)); end if;

  select count(*) into v_n
    from core.participant_period pp
    join core.participant p on p.id = pp.participant_id
   where p.scope_id = v_g and pp.valid_from <> v_d;
  if v_n <> 0 then fallos := array_append(fallos, 'B3c el reintento desplazo alguna presencia'); end if;

  -- B4 · `is_self` responde sobre UNO MISMO: el creador si, los demas no. Y no
  -- dice de quien son los otros, solo que no son de quien pregunta.
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from api.group_participant gp
   where gp.scope_id = v_g and gp.is_self;
  if v_n <> 1 then fallos := array_append(fallos, format('B4 is_self marca %s participantes', v_n)); end if;

  select count(*) into v_n from api.group_participant gp
   where gp.scope_id = v_g and gp.participant_id = v_p1 and gp.is_self;
  if v_n <> 1 then fallos := array_append(fallos, 'B4b el creador no se reconoce a si mismo'); end if;

  if array_length(fallos, 1) is not null then
    raise exception E'B · presencias:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'B · crear el grupo abre las presencias, e idempotente: OK';
end
$b$;

-- ============ C · registrar el gasto, y lo que NO se escribe con el ========
do $c$
declare
  fallos text[] := '{}';
  v_eur  uuid := '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';
  v_ua   uuid := 'aa000000-0000-4000-8000-000000000001';
  v_g    uuid := 'ab000000-0000-4000-8000-000000000010';
  v_p1   uuid := 'ad000000-0000-4000-8000-000000000031';
  v_p2   uuid := 'ad000000-0000-4000-8000-000000000032';
  v_p3   uuid := 'ad000000-0000-4000-8000-000000000033';
  v_p4   uuid := 'ad000000-0000-4000-8000-000000000034';
  v_cat  uuid;
  v_propia uuid := 'ae000000-0000-4000-8000-000000000099';
  v_personal uuid := 'ab000000-0000-4000-8000-0000000000f1';
  v_op   uuid;
  v_out  jsonb;
  v_n    int;
  v_t    text;
begin
  perform set_config('role', 'postgres', true);
  select id into v_cat from core.category
   where message_key = 'category.expense.dining' and owner_user_id is null;
  if v_cat is null then
    raise exception 'C0 no existe la categoria de sistema de restaurantes';
  end if;

  -- Una categoria PROPIA, sembrada aqui como postgres para poder rechazarla.
  perform set_config('role', 'postgres', true);
  insert into core.category (id, owner_user_id, label, icon, ordinal)
  values (v_propia, v_ua, 'Mis cosas', 'tag', 99);

  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- C1 · UNA CATEGORIA PROPIA SE RECHAZA, y con su propio codigo: quien lo
  -- reciba tiene que poder decir «elige otra», no «no existe».
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', 'af000000-0000-4000-8000-000000000001'::uuid,
      'command_contract_version', 1, 'scope_id', v_g,
      'currency_definition_id', v_eur, 'total', '1000',
      'effective_date', current_date::text, 'concept', 'Cena de prueba',
      'category_id', v_propia, 'payer_participant_id', v_p1,
      'participants', jsonb_build_array(v_p1, v_p2, v_p3, v_p4),
      'split_method', jsonb_build_object('kind', 'equal')));
    fallos := array_append(fallos, 'C1 una categoria propia se acepto en un gasto compartido');
  exception when others then
    if sqlerrm not like '%CATEGORY_NOT_SHAREABLE%' then
      fallos := array_append(fallos, ('C1b se rechazo por otro motivo: ' || sqlerrm));
    end if;
  end;

  -- C1c · y el rechazo NO dejo nada escrito. Una escritura parcial seria peor
  -- que el rechazo.
  -- `core.operation` NO tiene ambito: una operacion se situa por sus EFECTOS,
  -- que es lo que ADR-013 §2 separa de su clase. Se cuenta por ahi.
  perform set_config('role', 'postgres', true);
  select count(distinct ov.operation_id) into v_n
    from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
   where e.scope_id = v_g;
  if v_n <> 0 then fallos := array_append(fallos, 'C1c el rechazo dejo una operacion escrita'); end if;

  -- Y tampoco reclamo la clave: un rechazo no consume idempotencia.
  select count(*) into v_n from core.client_command cc
   where cc.client_operation_id = 'af000000-0000-4000-8000-000000000001'::uuid;
  if v_n <> 0 then fallos := array_append(fallos, 'C1d el rechazo dejo reclamada la clave'); end if;

  -- C2 · el gasto de verdad: 10,00 EUR entre cuatro, a partes iguales.
  perform set_config('role', 'authenticated', true);
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'af000000-0000-4000-8000-000000000002'::uuid,
    'command_contract_version', 1, 'scope_id', v_g,
    'currency_definition_id', v_eur, 'total', '1000',
    'effective_date', current_date::text, 'concept', 'Cena de prueba',
    'category_id', v_cat, 'payer_participant_id', v_p1,
    'participants', jsonb_build_array(v_p1, v_p2, v_p3, v_p4),
    'split_method', jsonb_build_object('kind', 'equal')));

  v_op := (v_out ->> 'operation_id')::uuid;
  if v_op is null then fallos := array_append(fallos, format('C2 sin operacion: %s', v_out::text)); end if;

  perform set_config('role', 'postgres', true);

  -- C3 · CUATRO cuotas de 250, exactas. 1000 entre 4 no tiene resto, asi que el
  -- reparto es 250/250/250/250 y ninguno absorbe nada.
  select count(*) into v_n from core.current_effect e
   where e.scope_id = v_g and e.economic_amount = 250
     and e.economic_participant_id is not null;
  if v_n <> 4 then fallos := array_append(fallos, format('C3 hay %s cuotas de 250', v_n)); end if;

  -- C4 · EL PAGADOR ADELANTA 1000 DE CAJA, y eso NO es su gasto economico.
  -- Es la distincion de AGENTS.md §2: caja, economico y deuda son tres hechos.
  select count(*) into v_n
    from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
   where ov.operation_id = v_op and e.balance_amount = -1000
     and e.scope_id = v_personal;
  if v_n <> 1 then fallos := array_append(fallos, format('C4 el movimiento de caja del pagador es %s filas', v_n)); end if;

  -- C4b · UNO SOLO y POR EL TOTAL. No se descompone en gasto mas transferencia,
  -- y no se anota nada de caja en el ambito del grupo.
  select count(*) into v_n
    from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
   where ov.operation_id = v_op and e.balance_amount is not null;
  if v_n <> 1 then fallos := array_append(fallos, format('C4b hay %s efectos de caja', v_n)); end if;

  -- C5 · Y NO SE CREO NINGUN INGRESO PARA COMPENSARLE. Ni una operacion de otra
  -- clase, ni un efecto economico positivo: lo que los demas le deben es DEUDA.
  select count(distinct ov.operation_id) into v_n
    from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
   where e.scope_id = v_g;
  if v_n <> 1 then fallos := array_append(fallos, format('C5 el grupo tiene %s operaciones', v_n)); end if;

  select string_agg(distinct o.operation_class, ',') into v_t
    from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
    join core.operation o          on o.id  = ov.operation_id
   where e.scope_id = v_g;
  if v_t is distinct from 'group_expense' then
    fallos := array_append(fallos, format('C5b clases escritas: %s', coalesce(v_t, 'ninguna')));
  end if;

  -- **La cuantia economica se guarda en MAGNITUD, no con signo**: las cuatro
  -- cuotas son 250 positivos y lo que dice que son gasto es su dimension y la
  -- clase contable, no un menos. Asi que «no se invento un ingreso» no se
  -- comprueba por el signo economico —seria una lectura equivocada del modelo—
  -- sino por la CAJA: la del pagador baja 1000 y **la de nadie sube**.
  select count(*) into v_n from core.current_effect e
   where e.balance_amount > 0
     and e.operation_version_id in (
       select ov.id from core.operation_version ov where ov.operation_id = v_op);
  if v_n <> 0 then fallos := array_append(fallos, 'C5c a alguien le subio la caja con un gasto'); end if;

  -- Y lo que los demas le deben es DEUDA, no un cobro: tres derechos de 250 a
  -- favor del pagador, que es lo que AGENTS.md §2 separa de un ingreso.
  select count(*) into v_n from core.current_effect e
   where e.debt_amount = 250 and e.debt_creditor_participant_id = v_p1
     and e.operation_version_id in (
       select ov.id from core.operation_version ov where ov.operation_id = v_op);
  if v_n <> 3 then fallos := array_append(fallos, format('C5d hay %s derechos del pagador', v_n)); end if;

  -- C6 · el concepto y la categoria quedaron GUARDADOS, cada uno en su sitio.
  select md.concept into v_t
    from core.movement_detail md
    join core.operation_version ov on ov.id = md.operation_version_id
   where ov.operation_id = v_op;
  if v_t is distinct from 'Cena de prueba' then
    fallos := array_append(fallos, format('C6 el concepto guardado es %s', coalesce(v_t, 'ninguno')));
  end if;

  select count(*) into v_n
    from core.expense_category ec
    join core.operation_version ov on ov.id = ec.operation_version_id
   where ov.operation_id = v_op and ec.category_id = v_cat;
  if v_n <> 1 then fallos := array_append(fallos, 'C6b la categoria no quedo asociada a la version'); end if;

  -- C7 · REINTENTO CON LA MISMA CLAVE: replay, y ni una operacion mas.
  perform set_config('role', 'authenticated', true);
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'af000000-0000-4000-8000-000000000002'::uuid,
    'command_contract_version', 1, 'scope_id', v_g,
    'currency_definition_id', v_eur, 'total', '1000',
    'effective_date', current_date::text, 'concept', 'Cena de prueba',
    'category_id', v_cat, 'payer_participant_id', v_p1,
    'participants', jsonb_build_array(v_p1, v_p2, v_p3, v_p4),
    'split_method', jsonb_build_object('kind', 'equal')));
  -- El sobre del ESCRITOR marca el replay como `already_processed`; el del
  -- provisioning de grupo lo llama `replay`. Son dos contratos distintos y se
  -- leen cada uno por su nombre, sin unificarlos aqui.
  if (v_out ->> 'already_processed') is distinct from 'true' then
    fallos := array_append(fallos, format('C7 el reintento no fue replay: %s', v_out::text));
  end if;
  perform set_config('role', 'postgres', true);
  select count(distinct ov.operation_id) into v_n
    from core.current_effect e
    join core.operation_version ov on ov.id = e.operation_version_id
   where e.scope_id = v_g;
  if v_n <> 1 then fallos := array_append(fallos, format('C7b tras el reintento hay %s operaciones', v_n)); end if;

  if array_length(fallos, 1) is not null then
    raise exception E'C · el gasto:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'C · registrar el gasto, y lo que no se escribe con el: OK';
end
$c$;

-- ================= D · lo que las dos vistas publican ======================
do $d$
declare
  fallos text[] := '{}';
  v_g    uuid := 'ab000000-0000-4000-8000-000000000010';
  v_row  record;
  v_n    int;
  v_p1   uuid := 'ad000000-0000-4000-8000-000000000031';
  v_ua   uuid := 'aa000000-0000-4000-8000-000000000001';
begin
  -- Las vistas se leen COMO CLIENTE: son `security_invoker`, asi que leerlas
  -- como `postgres` no demostraria que la RLS las deja pasar.
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true);
  perform set_config('role', 'authenticated', true);

  select * into v_row from api.group_operation go where go.scope_id = v_g;

  -- D1 · UNA fila por operacion. No una por efecto ni una por participante.
  if not found then
    fallos := array_append(fallos, 'D1 group_operation no publica el gasto');
  else
    -- D2 · el importe es EL GASTO ENTERO, y viaja como texto (ADR-008 §1).
    if v_row.total_amount is distinct from '1000' then
      fallos := array_append(fallos, format('D2 total_amount = %s', coalesce(v_row.total_amount, 'nulo')));
    end if;
    if pg_typeof(v_row.total_amount)::text <> 'text' then
      fallos := array_append(fallos, 'D2b total_amount no sale como texto');
    end if;

    -- D3 · y la cuota de quien mira es OTRA cifra: 250, no 1000.
    if v_row.your_share is distinct from '250' then
      fallos := array_append(fallos, format('D3 your_share = %s', coalesce(v_row.your_share, 'nulo')));
    end if;

    -- D4 · `total_order` es el mismo importe como ENTERO, y existe solo para
    -- ordenar: sin el, `100` iria antes que `9` por orden de texto.
    if pg_typeof(v_row.total_order)::text <> 'bigint' then
      fallos := array_append(fallos, format('D4 total_order es %s', pg_typeof(v_row.total_order)::text));
    end if;
    if v_row.total_order <> 1000 then
      fallos := array_append(fallos, format('D4b total_order = %s', v_row.total_order::text));
    end if;

    if v_row.concept is distinct from 'Cena de prueba' then
      fallos := array_append(fallos, 'D5 el concepto no llega a la vista');
    end if;
    if v_row.category_id is null then fallos := array_append(fallos, 'D5b la categoria no llega'); end if;
  end if;

  -- D5d · QUIEN PAGO SE PUBLICA, y con el privilegio que eso exige.
  --
  -- El pagador vive en `core.split`, y una vista `security_invoker` se evalua
  -- con los privilegios de quien llama: sin `select` para `authenticated` la
  -- vista respondia `permission denied for table split` — medido en la tanda
  -- anterior, que es por lo que entonces no se publico. Ahora la tarjeta lo
  -- necesita, asi que se abre la tabla CON SU RLS, no sin ella.
  if v_row.payer_participant_id is distinct from v_p1 then
    fallos := array_append(fallos, 'D5d el pagador no llega o no es el que pago');
  end if;
  if v_row.split_method is distinct from 'equal' then
    fallos := array_append(fallos, format('D5e el metodo es %s', coalesce(v_row.split_method, 'nulo')));
  end if;
  if v_row.version_id is null then
    fallos := array_append(fallos, 'D5f la version vigente no se publica: no se podria corregir');
  end if;

  -- D6 · LAS TRES CIFRAS DEL RESUMEN, agregadas en SQL y distintas entre si.
  -- Total 1000, tu gastaste 250, te deben 750. Cuatro numeros del mismo hecho.
  select * into v_row from api.group_summary gs where gs.scope_id = v_g;
  if not found then
    fallos := array_append(fallos, 'D6 group_summary no publica el grupo');
  else
    if v_row.total_amount is distinct from '1000' then
      fallos := array_append(fallos, format('D6a total = %s', coalesce(v_row.total_amount, 'nulo')));
    end if;
    if v_row.your_share is distinct from '250' then
      fallos := array_append(fallos, format('D6b tu gastaste = %s', coalesce(v_row.your_share, 'nulo')));
    end if;
    if v_row.net_position is distinct from '750' then
      fallos := array_append(fallos, format('D6c posicion = %s', coalesce(v_row.net_position, 'nulo')));
    end if;
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'D · las vistas:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'D · lo que las dos vistas publican: OK';
end
$d$;

-- ================= E · los CUATRO ordenes, con importes y fechas ==========
--
-- Se anaden tres gastos mas con importes y fechas deliberadamente cruzados:
-- el mas caro NO es el mas reciente, y hay un importe de tres digitos junto a
-- uno de dos para que ordenar por TEXTO se distinga de ordenar por VALOR.
do $e$
declare
  fallos text[] := '{}';
  v_eur  uuid := '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';
  v_ua   uuid := 'aa000000-0000-4000-8000-000000000001';
  v_g    uuid := 'ab000000-0000-4000-8000-000000000010';
  v_p1   uuid := 'ad000000-0000-4000-8000-000000000031';
  v_p2   uuid := 'ad000000-0000-4000-8000-000000000032';
  v_p3   uuid := 'ad000000-0000-4000-8000-000000000033';
  v_p4   uuid := 'ad000000-0000-4000-8000-000000000034';
  v_cat  uuid;
  v_t    text;
begin
  perform set_config('role', 'postgres', true);
  select id into v_cat from core.category
   where message_key = 'category.expense.dining' and owner_user_id is null;

  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- «Cena de prueba» ya existe: 1000, hoy.
  --   Taxi        900, ayer          -> por TEXTO '900' > '1000', por VALOR no
  --   Museo       200, hace tres dias
  --   Desayuno   1500, hace un dia mas todavia -> el mas caro es el MAS VIEJO
  perform api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'af000000-0000-4000-8000-000000000003'::uuid,
    'command_contract_version', 1, 'scope_id', v_g,
    'currency_definition_id', v_eur, 'total', '900',
    'effective_date', (current_date + 1)::text, 'concept', 'Taxi',
    'category_id', v_cat, 'payer_participant_id', v_p1,
    'participants', jsonb_build_array(v_p1, v_p2, v_p3, v_p4),
    'split_method', jsonb_build_object('kind', 'equal')));

  perform api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'af000000-0000-4000-8000-000000000004'::uuid,
    'command_contract_version', 1, 'scope_id', v_g,
    'currency_definition_id', v_eur, 'total', '200',
    'effective_date', (current_date + 3)::text, 'concept', 'Museo',
    'category_id', v_cat, 'payer_participant_id', v_p2,
    'participants', jsonb_build_array(v_p1, v_p2, v_p3, v_p4),
    'split_method', jsonb_build_object('kind', 'equal')));

  perform api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'af000000-0000-4000-8000-000000000005'::uuid,
    'command_contract_version', 1, 'scope_id', v_g,
    'currency_definition_id', v_eur, 'total', '1500',
    'effective_date', (current_date + 4)::text, 'concept', 'Desayuno',
    'category_id', v_cat, 'payer_participant_id', v_p3,
    'participants', jsonb_build_array(v_p1, v_p2, v_p3, v_p4),
    'split_method', jsonb_build_object('kind', 'equal')));

  -- E1 · fecha mas reciente primero.
  select string_agg(concept, ',') into v_t from (
    select go.concept from api.group_operation go where go.scope_id = v_g
     order by go.effective_date desc, go.operation_created_at desc, go.operation_id asc) q;
  if v_t is distinct from 'Desayuno,Museo,Taxi,Cena de prueba' then
    fallos := array_append(fallos, ('E1 fecha desc: ' || coalesce(v_t, 'nada')));
  end if;

  -- E2 · fecha menos reciente primero.
  select string_agg(concept, ',') into v_t from (
    select go.concept from api.group_operation go where go.scope_id = v_g
     order by go.effective_date asc, go.operation_created_at desc, go.operation_id asc) q;
  if v_t is distinct from 'Cena de prueba,Taxi,Museo,Desayuno' then
    fallos := array_append(fallos, ('E2 fecha asc: ' || coalesce(v_t, 'nada')));
  end if;

  -- E3 · MAYOR GASTO PRIMERO, por valor exacto. Si se ordenara por el texto de
  -- `total_amount`, '900' saldria antes que '1500' y que '1000'.
  select string_agg(concept, ',') into v_t from (
    select go.concept from api.group_operation go where go.scope_id = v_g
     order by go.total_order desc, go.operation_created_at desc, go.operation_id asc) q;
  if v_t is distinct from 'Desayuno,Cena de prueba,Taxi,Museo' then
    fallos := array_append(fallos, ('E3 importe desc: ' || coalesce(v_t, 'nada')));
  end if;

  -- E4 · menor gasto primero.
  select string_agg(concept, ',') into v_t from (
    select go.concept from api.group_operation go where go.scope_id = v_g
     order by go.total_order asc, go.operation_created_at desc, go.operation_id asc) q;
  if v_t is distinct from 'Museo,Taxi,Cena de prueba,Desayuno' then
    fallos := array_append(fallos, ('E4 importe asc: ' || coalesce(v_t, 'nada')));
  end if;

  -- E5 · y ordenar por el TEXTO daria otra cosa: es la prueba de que la columna
  -- ordenable no es decoracion.
  select string_agg(concept, ',') into v_t from (
    select go.concept from api.group_operation go where go.scope_id = v_g
     order by go.total_amount desc) q;
  if v_t is not distinct from 'Desayuno,Cena de prueba,Taxi,Museo' then
    fallos := array_append(fallos, 'E5 ordenar por texto coincide con ordenar por valor: la prueba no distingue');
  end if;

  -- E6 · EL RESUMEN SIGUE CUADRANDO CON LOS CUATRO GASTOS, y sale de un solo
  -- agregado en SQL: no se suma ninguna pagina.
  --
  --   Total       1000 + 900 + 200 + 1500                    = 3600
  --   Tu cuota     250 + 225 +  50 +  375                     =  900
  --   Posicion    acreedor (750 en Cena + 675 en Taxi) = 1425
  --               deudor   ( 50 en Museo + 375 en Desayuno) =  425  ->  1000
  --
  -- Y las tres son numeros DISTINTOS del mismo hecho, que es exactamente lo que
  -- AGENTS.md §2 exige no confundir.
  select gs.total_amount || '|' || gs.your_share || '|' || gs.net_position into v_t
    from api.group_summary gs where gs.scope_id = v_g;
  if v_t is distinct from '3600|900|1000' then
    fallos := array_append(fallos, ('E6 el resumen agregado es ' || coalesce(v_t, 'nulo')));
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'E · los ordenes:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'E · los cuatro ordenes, con importes y fechas: OK';
end
$e$;

-- ============ G · FILTRAR: sobre el CONJUNTO, no sobre una pagina ==========
--
-- **El filtro se aplica antes de paginar, igual que el orden.** Es el mismo
-- motivo que obligo a agregar en SQL: `max_rows` acota una peticion a mil
-- filas, asi que quedarse con «los que cumplen, de los que llegaron» produce
-- una lista incompleta que no lanza nada. Aqui se demuestra con un caso que
-- una primera pagina NO contiene: se siembran 40 gastos y se comprueba que el
-- que cumple el filtro sale aunque quede fuera de las primeras 10 filas de
-- cualquiera de los cuatro ordenes.
do $g$
declare
  fallos text[] := '{}';
  v_eur  uuid := '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';
  v_ua   uuid := 'aa000000-0000-4000-8000-000000000001';
  v_g    uuid := 'ab000000-0000-4000-8000-000000000010';
  v_p1   uuid := 'ad000000-0000-4000-8000-000000000031';
  v_p2   uuid := 'ad000000-0000-4000-8000-000000000032';
  v_p3   uuid := 'ad000000-0000-4000-8000-000000000033';
  v_p4   uuid := 'ad000000-0000-4000-8000-000000000034';
  v_cena uuid; v_viajes uuid;
  v_n    int;
  v_t    text;
  v_i    int;
begin
  perform set_config('role', 'postgres', true);
  select id into v_cena from core.category
   where message_key = 'category.expense.dining' and owner_user_id is null;
  select id into v_viajes from core.category
   where message_key = 'category.expense.travel' and owner_user_id is null;

  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- G0 · cuarenta gastos mas, todos de Viajes, todos entre p3 y p4 -sin quien
  -- mira- y con importes que NO chocan con los cuatro de la seccion E.
  for v_i in 1 .. 40 loop
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', ('af000000-0000-4000-8000-0000000010' || lpad(v_i::text, 2, '0'))::uuid,
      'command_contract_version', 1, 'scope_id', v_g,
      'currency_definition_id', v_eur, 'total', (5000 + v_i * 10)::text,
      'effective_date', (current_date + 10 + v_i)::text,
      'concept', 'Relleno ' || v_i,
      'category_id', v_viajes, 'payer_participant_id', v_p3,
      'participants', jsonb_build_array(v_p3, v_p4),
      'split_method', jsonb_build_object('kind', 'equal')));
  end loop;

  -- G1 · EL INTERVALO, con los dos extremos DENTRO. El gasto de 1000 sale
  -- cuando el intervalo llega justo hasta 1000, y el de 200 cuando empieza
  -- justo en 200: `gte`/`lte`, no `gt`/`lt`.
  select count(*) into v_n from api.group_operation go
   where go.scope_id = v_g and go.total_order >= 200 and go.total_order <= 1000;
  if v_n <> 3 then fallos := array_append(fallos, format('G1 el intervalo [200,1000] trae %s', v_n)); end if;

  select count(*) into v_n from api.group_operation go
   where go.scope_id = v_g and go.total_order >= 201 and go.total_order <= 999;
  if v_n <> 1 then fallos := array_append(fallos, format('G1b el intervalo [201,999] trae %s', v_n)); end if;

  -- G2 · LA CATEGORIA. Los cuatro de la seccion E son de Restaurantes; los
  -- cuarenta de relleno, de Viajes.
  select count(*) into v_n from api.group_operation go
   where go.scope_id = v_g and go.category_id = v_cena;
  if v_n <> 4 then fallos := array_append(fallos, format('G2 por categoria salen %s', v_n)); end if;

  -- G3 · EL PAGADOR, y **no** quien participa en el reparto. `v_p1` pago dos
  -- de los cuatro primeros —«Cena» y «Taxi»— y ninguno de los de relleno,
  -- aunque participa en los cuatro. Si el filtro fuese por participacion este
  -- numero seria 4: es exactamente el caso que separa las dos lecturas.
  select count(*) into v_n from api.group_operation go
   where go.scope_id = v_g and go.payer_participant_id = v_p1;
  if v_n <> 2 then fallos := array_append(fallos, format('G3 por pagador salen %s', v_n)); end if;

  -- G3b · `v_p2` pago uno solo —«Museo»— y participa en los cuatro.
  select count(*) into v_n from api.group_operation go
   where go.scope_id = v_g and go.payer_participant_id = v_p2;
  if v_n <> 1 then fallos := array_append(fallos, format('G3b por el otro pagador salen %s', v_n)); end if;

  -- G3c · y `v_p4` no pago NINGUNO, aunque tiene cuota en los 44. Con la
  -- lectura anterior habrian salido los 44.
  select count(*) into v_n from api.group_operation go
   where go.scope_id = v_g and go.payer_participant_id = v_p4;
  if v_n <> 0 then fallos := array_append(fallos, format('G3c tener cuota no es pagar: %s', v_n)); end if;

  -- G4 · LOS TRES SE COMBINAN CON AND. Intervalo + categoria + persona.
  select count(*) into v_n from api.group_operation go
   where go.scope_id = v_g
     and go.total_order >= 900 and go.total_order <= 1500
     and go.category_id = v_cena
     and go.payer_participant_id = v_p1;
  if v_n <> 2 then fallos := array_append(fallos, format('G4 la combinacion trae %s', v_n)); end if;

  -- G5 · FUERA DE LA PRIMERA PAGINA. Con «mayor gasto» primero, los cuarenta
  -- de relleno ocupan las cuarenta primeras filas: el gasto de 1500 esta en la
  -- posicion 41. Filtrar por su categoria lo trae igualmente, lo que no
  -- ocurriria si el filtro se aplicara a una pagina ya descargada.
  select go.concept into v_t from api.group_operation go
   where go.scope_id = v_g
   order by go.total_order desc, go.operation_created_at desc, go.operation_id asc
   offset 40 limit 1;
  if v_t is distinct from 'Desayuno' then
    fallos := array_append(fallos, format('G5 en la fila 41 hay %s', coalesce(v_t, 'nada')));
  end if;

  select go.concept into v_t from api.group_operation go
   where go.scope_id = v_g and go.category_id = v_cena
   order by go.total_order desc, go.operation_created_at desc, go.operation_id asc
   limit 1;
  if v_t is distinct from 'Desayuno' then
    fallos := array_append(fallos, format('G5b filtrado, el mayor es %s', coalesce(v_t, 'nada')));
  end if;

  -- G6 · EL MAXIMO NO SE MUEVE AL FILTRAR. Sale del conjunto completo, asi que
  -- es el del mayor gasto del grupo -1500 de la seccion E frente a los 5400 del
  -- ultimo relleno- y no el del resultado filtrado.
  select gs.max_total || the.sep || gs.expense_count::text into v_t
    from api.group_summary gs, (select '|' as sep) the where gs.scope_id = v_g;
  if v_t is distinct from '5400|44' then
    fallos := array_append(fallos, format('G6 max|cuenta = %s', coalesce(v_t, 'nulo')));
  end if;

  -- G6b · y las TRES cifras del resumen siguen describiendo el grupo entero.
  -- Un filtro del listado que las moviera estaria contando otra cosa.
  select gs.total_amount into v_t from api.group_summary gs where gs.scope_id = v_g;
  if v_t is distinct from (3600 + (select sum(5000 + i * 10) from generate_series(1,40) i))::text then
    fallos := array_append(fallos, format('G6b el total del grupo es %s', coalesce(v_t, 'nulo')));
  end if;

  -- G7 · el pagador es SIEMPRE alguien del propio grupo, y su identidad es la
  -- contextual que `api.group_participant` ya publica con su nombre. El vinculo
  -- con la cuenta global sigue sin aparecer en ninguna vista.
  select count(*) into v_n from api.group_operation go
   where go.scope_id = v_g
     and go.payer_participant_id is not null
     and go.payer_participant_id not in (select gp.participant_id
                                           from api.group_participant gp
                                          where gp.scope_id = v_g);
  if v_n <> 0 then fallos := array_append(fallos, 'G7 un gasto nombra a un pagador de fuera del grupo'); end if;

  if array_length(fallos, 1) is not null then
    raise exception E'G · filtros:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'G · filtrar sobre el conjunto completo: OK';
end
$g$;

-- ============ H · CORREGIR Y ANULAR UN GASTO COMPARTIDO ====================
--
-- Las dos escrituras que la tarjeta desplegada ofrece, contra la base real y
-- dentro de la transaccion que termina en ROLLBACK: no se toca ni un gasto de
-- los que ya hay.
--
-- Corregir NO crea otro gasto: escribe otra VERSION de la misma operacion y la
-- anterior queda como historia (ADR-011). Anular escribe una version SIN
-- efectos (ADR-024): no se borra ni una fila, y `current_version_id` sigue
-- siendo la unica autoridad sobre que cuenta.
--
-- **Y hay un bloqueo real que esta seccion mide en vez de sortear**: H8.
do $h$
declare
  fallos text[] := '{}';
  v_eur  uuid := '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';
  v_ua   uuid := 'aa000000-0000-4000-8000-000000000001';
  v_g    uuid := 'ab000000-0000-4000-8000-000000000010';
  v_p1   uuid := 'ad000000-0000-4000-8000-000000000031';
  v_p2   uuid := 'ad000000-0000-4000-8000-000000000032';
  v_p3   uuid := 'ad000000-0000-4000-8000-000000000033';
  v_p4   uuid := 'ad000000-0000-4000-8000-000000000034';
  -- Un grupo APARTE, sin deudas cruzadas, para poder medir la anulacion.
  v_g2   uuid := 'ab000000-0000-4000-8000-0000000000b0';
  v_q1   uuid := 'ad000000-0000-4000-8000-0000000000b1';
  v_q2   uuid := 'ad000000-0000-4000-8000-0000000000b2';
  v_cena uuid; v_viajes uuid;
  v_op uuid; v_v1 uuid; v_v2 uuid;
  v_out jsonb;
  v_n int; v_t text;
begin
  perform set_config('role', 'postgres', true);
  select id into v_cena from core.category
   where message_key = 'category.expense.dining' and owner_user_id is null;
  select id into v_viajes from core.category
   where message_key = 'category.expense.travel' and owner_user_id is null;

  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- H0 · un gasto propio de esta seccion, para no tocar los de las otras.
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'af000000-0000-4000-8000-0000000000a1'::uuid,
    'command_contract_version', 1, 'scope_id', v_g,
    'currency_definition_id', v_eur, 'total', '4000',
    'effective_date', current_date::text, 'concept', 'Alquiler',
    'category_id', v_cena, 'payer_participant_id', v_p2,
    'participants', jsonb_build_array(v_p1, v_p2, v_p3, v_p4),
    'split_method', jsonb_build_object('kind', 'equal')));
  v_op := (v_out ->> 'operation_id')::uuid;

  perform set_config('role', 'postgres', true);
  select o.current_version_id into v_v1 from core.operation o where o.id = v_op;

  -- H1 · LO DECLARADO se puede leer, y es lo que precarga la correccion.
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from api.group_split_participant sp where sp.version_id = v_v1;
  if v_n <> 4 then fallos := array_append(fallos, format('H1 el reparto publica %s filas', v_n)); end if;

  select sp.split_method into v_t from api.group_split_participant sp
   where sp.version_id = v_v1 limit 1;
  if v_t is distinct from 'equal' then
    fallos := array_append(fallos, format('H1b el metodo declarado es %s', coalesce(v_t, 'nulo')));
  end if;

  -- H2 · el filtro por pagador encuentra ESTE gasto por `v_p2`, que lo pago.
  select count(*) into v_n from api.group_operation go
   where go.scope_id = v_g and go.payer_participant_id = v_p2;
  if v_n <> 2 then fallos := array_append(fallos, format('H2 por pagador salen %s', v_n)); end if;

  -- H3 · CORREGIR: otro importe, otro metodo, otra categoria y otro concepto.
  -- Mismos participantes y mismo pagador — cambiar cualquiera de las dos cosas
  -- topa hoy con la guarda que H8 mide.
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'af000000-0000-4000-8000-0000000000a2'::uuid,
    'command_contract_version', 1,
    'operation_id', v_op, 'expected_version_id', v_v1,
    'scope_id', v_g, 'currency_definition_id', v_eur, 'total', '3000',
    'effective_date', current_date::text, 'concept', 'Alquiler corregido',
    'category_id', v_viajes, 'payer_participant_id', v_p2,
    'participants', jsonb_build_array(v_p1, v_p2, v_p3, v_p4),
    'split_method', jsonb_build_object('kind', 'shares', 'weights',
      jsonb_build_array('2','1','1','1'))));

  if (v_out ->> 'operation_id')::uuid is distinct from v_op then
    fallos := array_append(fallos, 'H3 corregir creo OTRA operacion');
  end if;

  perform set_config('role', 'postgres', true);
  select o.current_version_id into v_v2 from core.operation o where o.id = v_op;
  if v_v2 = v_v1 then fallos := array_append(fallos, 'H3b la version vigente no cambio'); end if;

  -- H3c · la version anterior SIGUE ESTANDO. No se actualiza nada inmutable.
  select count(*) into v_n from core.operation_version ov where ov.operation_id = v_op;
  if v_n <> 2 then fallos := array_append(fallos, format('H3c hay %s versiones', v_n)); end if;
  select count(*) into v_n from core.operation_version ov
   where ov.id = v_v2 and ov.supersedes_version_id = v_v1;
  if v_n <> 1 then fallos := array_append(fallos, 'H3d la nueva version no encadena con la anterior'); end if;

  -- H3e · y lo vigente es lo corregido: 3000 con pesos 2-1-1-1 son CINCO partes,
  -- asi que la doble vale 1200 y las otras tres 600.
  select count(*) into v_n from core.current_effect e
   where e.operation_version_id = v_v2 and e.economic_amount = 1200;
  if v_n <> 1 then fallos := array_append(fallos, 'H3e la parte doble no vale 1200'); end if;
  select count(*) into v_n from core.current_effect e
   where e.operation_version_id = v_v2 and e.economic_amount = 600;
  if v_n <> 3 then fallos := array_append(fallos, 'H3f las otras tres partes no valen 600'); end if;
  select count(*) into v_n from core.effect e where e.operation_version_id = v_v1;
  if v_n = 0 then fallos := array_append(fallos, 'H3g los efectos de la version vieja se borraron'); end if;

  -- H3h · y el reparto DECLARADO que se lee es el nuevo, con sus pesos.
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from api.group_split_participant sp
   where sp.version_id = v_v2 and sp.declared_weight = '1';
  if v_n <> 3 then fallos := array_append(fallos, format('H3h hay %s pesos de 1', v_n)); end if;

  -- H4 · REINTENTO con la misma clave: replay, y ni una version mas.
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'af000000-0000-4000-8000-0000000000a2'::uuid,
    'command_contract_version', 1,
    'operation_id', v_op, 'expected_version_id', v_v1,
    'scope_id', v_g, 'currency_definition_id', v_eur, 'total', '3000',
    'effective_date', current_date::text, 'concept', 'Alquiler corregido',
    'category_id', v_viajes, 'payer_participant_id', v_p2,
    'participants', jsonb_build_array(v_p1, v_p2, v_p3, v_p4),
    'split_method', jsonb_build_object('kind', 'shares', 'weights',
      jsonb_build_array('2','1','1','1'))));
  if (v_out ->> 'already_processed') is distinct from 'true' then
    fallos := array_append(fallos, format('H4 el reintento no fue replay: %s', v_out::text));
  end if;
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from core.operation_version ov where ov.operation_id = v_op;
  if v_n <> 2 then fallos := array_append(fallos, format('H4b tras el reintento hay %s versiones', v_n)); end if;

  -- H5 · CONFLICTO DE VERSION: corregir contra la version YA superada se
  -- rechaza. Es el CAS de ADR-011 §13, lo que impide pisar un cambio no visto.
  perform set_config('role', 'authenticated', true);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', 'af000000-0000-4000-8000-0000000000a3'::uuid,
      'command_contract_version', 1,
      'operation_id', v_op, 'expected_version_id', v_v1,
      'scope_id', v_g, 'currency_definition_id', v_eur, 'total', '2000',
      'effective_date', current_date::text, 'concept', 'Pisando',
      'category_id', v_cena, 'payer_participant_id', v_p2,
      'participants', jsonb_build_array(v_p1, v_p2, v_p3, v_p4),
      'split_method', jsonb_build_object('kind', 'equal')));
    fallos := array_append(fallos, 'H5 se acepto una correccion sobre una version superada');
  exception when others then
    if sqlerrm not like '%VERSION_CONFLICT%' then
      fallos := array_append(fallos, ('H5b se rechazo por otro motivo: ' || sqlerrm));
    end if;
  end;

  perform set_config('role', 'postgres', true);
  select count(*) into v_n from core.operation_version ov where ov.operation_id = v_op;
  if v_n <> 2 then fallos := array_append(fallos, 'H5c el conflicto dejo una escritura parcial'); end if;

  -- ═══════════ H6 · ANULAR, en un grupo SIN deudas cruzadas ═══════════
  --
  -- Grupo aparte a proposito: en uno con deudas en las dos direcciones, anular
  -- topa con la misma guarda que H8 mide. Aqui se comprueba el MECANISMO.
  perform set_config('role', 'authenticated', true);
  perform api.create_group(jsonb_build_object(
    'client_command_id', 'ac000000-0000-4000-8000-0000000000b9'::uuid,
    'command_contract_version', 1, 'client_group_id', v_g2,
    'display_name', 'Anulacion', 'emoji', 'GRP',
    'currency_definition_id', v_eur,
    'creator_participant_id', v_q1, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(
      jsonb_build_object('client_participant_id', v_q2, 'display_name', 'Ana'))));

  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'af000000-0000-4000-8000-0000000000b3'::uuid,
    'command_contract_version', 1, 'scope_id', v_g2,
    'currency_definition_id', v_eur, 'total', '600',
    'effective_date', current_date::text, 'concept', 'Para anular',
    'category_id', v_cena, 'payer_participant_id', v_q1,
    'participants', jsonb_build_array(v_q1, v_q2),
    'split_method', jsonb_build_object('kind', 'equal')));
  v_op := (v_out ->> 'operation_id')::uuid;

  perform set_config('role', 'postgres', true);
  select o.current_version_id into v_v2 from core.operation o where o.id = v_op;

  perform set_config('role', 'authenticated', true);
  perform api.annul_operation(jsonb_build_object(
    'client_operation_id', 'af000000-0000-4000-8000-0000000000b4'::uuid,
    'command_contract_version', 2,
    'operation_id', v_op, 'expected_version_id', v_v2));

  perform set_config('role', 'postgres', true);
  select count(*) into v_n from core.operation_version ov where ov.operation_id = v_op;
  if v_n <> 2 then fallos := array_append(fallos, format('H6 anular dejo %s versiones', v_n)); end if;

  select ov.version_kind into v_t from core.operation o
   join core.operation_version ov on ov.id = o.current_version_id where o.id = v_op;
  if v_t is distinct from 'annulment' then
    fallos := array_append(fallos, format('H6b la version vigente es %s', coalesce(v_t, 'nula')));
  end if;

  -- H6c · la version de anulacion no tiene NI UN efecto: es lo que la hace no
  -- contar, y es distinto de haber borrado los de antes.
  select count(*) into v_n from core.effect e
   join core.operation_version ov on ov.id = e.operation_version_id
   where ov.operation_id = v_op and ov.version_kind = 'annulment';
  if v_n <> 0 then fallos := array_append(fallos, 'H6c la anulacion escribio efectos'); end if;

  -- H6d · el gasto DESAPARECE de la lista, sin haberse borrado nada.
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from api.group_operation go where go.operation_id = v_op;
  if v_n <> 0 then fallos := array_append(fallos, 'H6d un gasto anulado sigue en la lista'); end if;

  perform set_config('role', 'postgres', true);
  select count(*) into v_n from core.effect e
   join core.operation_version ov on ov.id = e.operation_version_id
   where ov.operation_id = v_op;
  if v_n = 0 then fallos := array_append(fallos, 'H6e anular borro los efectos historicos'); end if;

  -- H7 · ANULAR ES TERMINAL. Volver a anular se rechaza.
  perform set_config('role', 'authenticated', true);
  begin
    perform api.annul_operation(jsonb_build_object(
      'client_operation_id', 'af000000-0000-4000-8000-0000000000b5'::uuid,
      'command_contract_version', 2,
      'operation_id', v_op, 'expected_version_id', v_v2));
    fallos := array_append(fallos, 'H7 se anulo dos veces');
  exception when others then
    null;
  end;

  -- ═══════════ H8 · DEUDAS CRUZADAS SIN LIQUIDAR: YA NO BLOQUEAN ═══════════
  --
  -- Era un defecto de implementacion, no una decision contable: las dos guardas
  -- exigian `net_debt(par) + delta >= 0`, y `net_debt` es el neto CON SIGNO de
  -- las dos direcciones. Con `S = 0` esa condicion degenera en «el neto de los
  -- gastos de A hacia B no puede ser negativo», que no es invariante de nada:
  -- un neto negativo solo dice que quien debe es el otro.
  --
  -- `20260908150000_settlement_guard_scope.sql` acota CUANDO se pregunta —solo
  -- en pares con liquidaciones— sin tocar la aritmetica. Aqui se comprueban las
  -- dos mitades: lo que antes fallaba y no debia, y lo que debe seguir fallando.
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from core.operation o
   where o.operation_class in ('debt_settlement','settlement_by_transfer');
  if v_n <> 0 then
    fallos := array_append(fallos, format('H8 la premisa no se cumple: hay %s liquidaciones', v_n));
  end if;

  select o.id, o.current_version_id into v_op, v_v1 from core.operation o
   join core.operation_version ov on ov.id = o.current_version_id
   join core.movement_detail md on md.operation_version_id = ov.id
   where md.concept = 'Alquiler corregido';

  -- H8a · CAMBIAR DE PAGADOR con deudas cruzadas y sin liquidar: ahora pasa.
  perform set_config('role', 'authenticated', true);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', 'af000000-0000-4000-8000-0000000000a9'::uuid,
      'command_contract_version', 1,
      'operation_id', v_op, 'expected_version_id', v_v1,
      'scope_id', v_g, 'currency_definition_id', v_eur, 'total', '3000',
      'effective_date', current_date::text, 'concept', 'Alquiler corregido',
      'category_id', v_viajes, 'payer_participant_id', v_p1,
      'participants', jsonb_build_array(v_p1, v_p2, v_p3, v_p4),
      'split_method', jsonb_build_object('kind', 'equal')));
  exception when others then
    fallos := array_append(fallos, ('H8a cambiar de pagador sigue bloqueado: ' || sqlerrm));
  end;

  -- H8b · EXCLUIR A ALGUIEN del reparto, tambien.
  perform set_config('role', 'postgres', true);
  select o.current_version_id into v_v1 from core.operation o where o.id = v_op;
  perform set_config('role', 'authenticated', true);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', 'af000000-0000-4000-8000-0000000000aa'::uuid,
      'command_contract_version', 1,
      'operation_id', v_op, 'expected_version_id', v_v1,
      'scope_id', v_g, 'currency_definition_id', v_eur, 'total', '3000',
      'effective_date', current_date::text, 'concept', 'Alquiler corregido',
      'category_id', v_viajes, 'payer_participant_id', v_p1,
      'participants', jsonb_build_array(v_p1, v_p2),
      'split_method', jsonb_build_object('kind', 'equal')));
  exception when others then
    fallos := array_append(fallos, ('H8b excluir a alguien sigue bloqueado: ' || sqlerrm));
  end;

  -- H8c · y ANULAR en ese mismo grupo con deudas cruzadas.
  perform set_config('role', 'postgres', true);
  select o.current_version_id into v_v1 from core.operation o where o.id = v_op;
  perform set_config('role', 'authenticated', true);
  begin
    perform api.annul_operation(jsonb_build_object(
      'client_operation_id', 'af000000-0000-4000-8000-0000000000ab'::uuid,
      'command_contract_version', 2,
      'operation_id', v_op, 'expected_version_id', v_v1));
  exception when others then
    fallos := array_append(fallos, ('H8c anular con deudas cruzadas sigue bloqueado: ' || sqlerrm));
  end;

  -- ═══════════ H9 · Y UNA SOBRELIQUIDACION REAL SIGUE RECHAZANDOSE ═══════════
  --
  -- El ejemplo canonico de `data-model.md` §3, en el grupo aislado: deuda 300,
  -- se liquidan 200, y la correccion la baja a 100. Sin la guarda quedaria una
  -- liquidacion de 200 respaldada por 100.
  perform set_config('role', 'authenticated', true);
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'af000000-0000-4000-8000-0000000000c1'::uuid,
    'command_contract_version', 1, 'scope_id', v_g2,
    'currency_definition_id', v_eur, 'total', '600',
    'effective_date', current_date::text, 'concept', 'Con liquidacion',
    'category_id', v_cena, 'payer_participant_id', v_q1,
    'participants', jsonb_build_array(v_q1, v_q2),
    'split_method', jsonb_build_object('kind', 'equal')));
  v_op := (v_out ->> 'operation_id')::uuid;

  -- H9a · un PAGO PARCIAL: 200 de los 300 que debe.
  perform api.record_debt_settlement(jsonb_build_object(
    'client_operation_id', 'af000000-0000-4000-8000-0000000000c2'::uuid,
    'command_contract_version', 1, 'scope_id', v_g2,
    'currency_definition_id', v_eur, 'amount', '200',
    'effective_date', current_date::text,
    'debtor_participant_id', v_q2, 'creditor_participant_id', v_q1));

  perform set_config('role', 'postgres', true);
  select o.current_version_id into v_v1 from core.operation o where o.id = v_op;

  -- H9b · corregir a 600 -> 200 deja la cuota en 100 y la liquidacion en 200.
  perform set_config('role', 'authenticated', true);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', 'af000000-0000-4000-8000-0000000000c3'::uuid,
      'command_contract_version', 1,
      'operation_id', v_op, 'expected_version_id', v_v1,
      'scope_id', v_g2, 'currency_definition_id', v_eur, 'total', '200',
      'effective_date', current_date::text, 'concept', 'Con liquidacion',
      'category_id', v_cena, 'payer_participant_id', v_q1,
      'participants', jsonb_build_array(v_q1, v_q2),
      'split_method', jsonb_build_object('kind', 'equal')));
    fallos := array_append(fallos, 'H9b una sobreliquidacion real se acepto');
  exception when others then
    if sqlerrm not like '%SETTLEMENT_EXCEEDS_DEBT%' then
      fallos := array_append(fallos, ('H9c se rechazo por otro motivo: ' || sqlerrm));
    end if;
  end;

  -- H9d · y el rechazo NO deja escritura parcial: sigue habiendo una version.
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from core.operation_version ov where ov.operation_id = v_op;
  if v_n <> 1 then fallos := array_append(fallos, format('H9d el rechazo dejo %s versiones', v_n)); end if;

  -- H9e · anular ese gasto tambien se rechaza: dejaria los 200 sin respaldo.
  perform set_config('role', 'authenticated', true);
  begin
    perform api.annul_operation(jsonb_build_object(
      'client_operation_id', 'af000000-0000-4000-8000-0000000000c4'::uuid,
      'command_contract_version', 2,
      'operation_id', v_op, 'expected_version_id', v_v1));
    fallos := array_append(fallos, 'H9e anular sobre una deuda ya liquidada se acepto');
  exception when others then
    if sqlerrm not like '%SETTLEMENT_EXCEEDS_DEBT%' then
      fallos := array_append(fallos, ('H9f se rechazo por otro motivo: ' || sqlerrm));
    end if;
  end;

  -- H9g · pero corregir a 500 —que deja 250, por encima de los 200 liquidados—
  -- SI pasa: la guarda acota, no prohibe corregir.
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', 'af000000-0000-4000-8000-0000000000c5'::uuid,
      'command_contract_version', 1,
      'operation_id', v_op, 'expected_version_id', v_v1,
      'scope_id', v_g2, 'currency_definition_id', v_eur, 'total', '500',
      'effective_date', current_date::text, 'concept', 'Con liquidacion',
      'category_id', v_cena, 'payer_participant_id', v_q1,
      'participants', jsonb_build_array(v_q1, v_q2),
      'split_method', jsonb_build_object('kind', 'equal')));
  exception when others then
    fallos := array_append(fallos, ('H9g una correccion que respeta lo liquidado se rechazo: ' || sqlerrm));
  end;
  if array_length(fallos, 1) is not null then
    raise exception E'H · corregir y anular:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'H · corregir y anular un gasto compartido: OK';
  raise notice 'H8/H9 · deudas cruzadas sin liquidar pasan; la sobreliquidacion real se rechaza';
end
$h$;

-- ============ I · SALDOS Y NOTIFICACIONES DE EDICION =======================
--
-- Todo dentro de la transaccion que termina en ROLLBACK.
do $i$
declare
  fallos text[] := '{}';
  v_eur  uuid := '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';
  v_ua   uuid := 'aa000000-0000-4000-8000-000000000001';
  v_ub   uuid := 'aa000000-0000-4000-8000-000000000002';
  v_g    uuid := 'ab000000-0000-4000-8000-0000000000e0';
  v_q1   uuid := 'ad000000-0000-4000-8000-0000000000e1';
  v_q2   uuid := 'ad000000-0000-4000-8000-0000000000e2';
  v_q3   uuid := 'ad000000-0000-4000-8000-0000000000e3';
  v_cena uuid;
  v_op uuid; v_v1 uuid; v_v2 uuid;
  v_out jsonb; v_n int; v_t text;
begin
  perform set_config('role', 'postgres', true);
  select id into v_cena from core.category
   where message_key = 'category.expense.dining' and owner_user_id is null;

  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- Un grupo de TRES participantes; solo dos de ellos tienen cuenta, y el
  -- tercero existe sin usuario: es el caso que no debe inventar destinatario.
  perform api.create_group(jsonb_build_object(
    'client_command_id', 'ac000000-0000-4000-8000-0000000000e9'::uuid,
    'command_contract_version', 1, 'client_group_id', v_g,
    'display_name', 'Saldos', 'emoji', 'GRP',
    'currency_definition_id', v_eur,
    'creator_participant_id', v_q1, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(
      jsonb_build_object('client_participant_id', v_q2, 'display_name', 'Ana'),
      jsonb_build_object('client_participant_id', v_q3, 'display_name', 'Sin cuenta'))));

  -- Una segunda cuenta con membresia, para poder contar destinatarios.
  perform set_config('role', 'postgres', true);
  insert into core.membership (scope_id, user_id) values (v_g, v_ub);

  -- ═══ I1 · SALDOS ═══ 900 entre tres, pagados por Edu: 300 cada uno.
  perform set_config('role', 'authenticated', true);
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'af000000-0000-4000-8000-0000000000e1'::uuid,
    'command_contract_version', 1, 'scope_id', v_g,
    'currency_definition_id', v_eur, 'total', '900',
    'effective_date', current_date::text, 'concept', 'Cena',
    'category_id', v_cena, 'payer_participant_id', v_q1,
    'participants', jsonb_build_array(v_q1, v_q2, v_q3),
    'split_method', jsonb_build_object('kind', 'equal')));
  v_op := (v_out ->> 'operation_id')::uuid;

  -- I1a · los TRES salen, incluido el que no tiene cuenta.
  select count(*) into v_n from api.group_balance b where b.scope_id = v_g;
  if v_n <> 3 then fallos := array_append(fallos, format('I1a salen %s participantes', v_n)); end if;

  -- I1b · +600 el pagador, -300 cada uno de los otros dos.
  select b.net_position into v_t from api.group_balance b
   where b.scope_id = v_g and b.participant_id = v_q1;
  if v_t is distinct from '600' then
    fallos := array_append(fallos, format('I1b la posicion del pagador es %s', coalesce(v_t, 'nula')));
  end if;
  select b.net_position into v_t from api.group_balance b
   where b.scope_id = v_g and b.participant_id = v_q3;
  if v_t is distinct from '-300' then
    fallos := array_append(fallos, format('I1c la del participante sin cuenta es %s', coalesce(v_t, 'nula')));
  end if;

  -- I1d · SUMA EXACTAMENTE CERO.
  select sum(b.net_position::bigint)::text into v_t from api.group_balance b where b.scope_id = v_g;
  if v_t is distinct from '0' then
    fallos := array_append(fallos, format('I1d las posiciones suman %s', coalesce(v_t, 'nulo')));
  end if;

  -- I1e · y coincide con la posicion del resumen, que es la misma pregunta.
  select gs.net_position into v_t from api.group_summary gs where gs.scope_id = v_g;
  select b.net_position into v_t from api.group_balance b
   where b.scope_id = v_g and b.is_self;
  if v_t is distinct from (select gs.net_position from api.group_summary gs where gs.scope_id = v_g) then
    fallos := array_append(fallos, 'I1e la posicion propia no coincide con el resumen');
  end if;

  -- ═══ I2 · UNA LIQUIDACION PARCIAL MUEVE LOS SALDOS ═══
  perform api.record_debt_settlement(jsonb_build_object(
    'client_operation_id', 'af000000-0000-4000-8000-0000000000e2'::uuid,
    'command_contract_version', 1, 'scope_id', v_g,
    'currency_definition_id', v_eur, 'amount', '100',
    'effective_date', current_date::text,
    'debtor_participant_id', v_q2, 'creditor_participant_id', v_q1));

  select b.net_position into v_t from api.group_balance b
   where b.scope_id = v_g and b.participant_id = v_q2;
  if v_t is distinct from '-200' then
    fallos := array_append(fallos, format('I2 tras liquidar 100 la posicion es %s', coalesce(v_t, 'nula')));
  end if;
  select sum(b.net_position::bigint)::text into v_t from api.group_balance b where b.scope_id = v_g;
  if v_t is distinct from '0' then
    fallos := array_append(fallos, format('I2b tras liquidar suman %s', coalesce(v_t, 'nulo')));
  end if;

  -- ═══ I3 · NOTIFICACIONES ═══
  -- Un alta NO notifica: no es una edicion de nada.
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from core.group_notice n where n.scope_id = v_g and n.kind = 'edit';
  if v_n <> 0 then fallos := array_append(fallos, format('I3 un alta genero %s avisos', v_n)); end if;

  select o.current_version_id into v_v1 from core.operation o where o.id = v_op;

  -- I3a · una CORRECCION notifica a cada cuenta con membresia, editor incluido.
  perform set_config('role', 'authenticated', true);
  perform api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'af000000-0000-4000-8000-0000000000e3'::uuid,
    'command_contract_version', 1,
    'operation_id', v_op, 'expected_version_id', v_v1,
    'scope_id', v_g, 'currency_definition_id', v_eur, 'total', '600',
    'effective_date', current_date::text, 'concept', 'Cena corregida',
    'category_id', v_cena, 'payer_participant_id', v_q1,
    'participants', jsonb_build_array(v_q1, v_q2, v_q3),
    'split_method', jsonb_build_object('kind', 'equal')));

  perform set_config('role', 'postgres', true);
  select o.current_version_id into v_v2 from core.operation o where o.id = v_op;

  select count(*) into v_n from core.group_notice n where n.kind = 'edit' and n.subject_id = v_v2;
  if v_n <> 2 then fallos := array_append(fallos, format('I3a hay %s avisos y hay 2 cuentas', v_n)); end if;

  -- I3b · el editor tambien lo recibe.
  select count(*) into v_n from core.group_notice n
   where n.kind = 'edit' and n.subject_id = v_v2 and n.recipient_user_id = v_ua;
  if v_n <> 1 then fallos := array_append(fallos, 'I3b el editor no recibio el suyo'); end if;

  -- I3c · y NO se invento cuenta para el participante sin usuario: los
  -- destinatarios salen de la membresia, que son dos.
  select count(distinct n.recipient_user_id) into v_n from core.group_notice n
   where n.kind = 'edit' and n.subject_id = v_v2;
  if v_n <> 2 then fallos := array_append(fallos, format('I3c hay %s destinatarios distintos', v_n)); end if;

  -- I3d · identidad y fecha del SERVIDOR: el editor es el actor autenticado y
  -- el instante no es la fecha de efecto del gasto.
  select count(*) into v_n from core.group_notice n
   where n.kind = 'edit' and n.subject_id = v_v2 and n.actor_user_id = v_ua
     and n.occurred_at::date = current_date and n.read_at is null;
  if v_n <> 2 then fallos := array_append(fallos, 'I3d el editor o el instante no son los del servidor'); end if;

  -- I3e · REINTENTO idempotente: replay antes de llegar aqui, y ni un aviso mas.
  perform set_config('role', 'authenticated', true);
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'af000000-0000-4000-8000-0000000000e3'::uuid,
    'command_contract_version', 1,
    'operation_id', v_op, 'expected_version_id', v_v1,
    'scope_id', v_g, 'currency_definition_id', v_eur, 'total', '600',
    'effective_date', current_date::text, 'concept', 'Cena corregida',
    'category_id', v_cena, 'payer_participant_id', v_q1,
    'participants', jsonb_build_array(v_q1, v_q2, v_q3),
    'split_method', jsonb_build_object('kind', 'equal')));
  if (v_out ->> 'already_processed') is distinct from 'true' then
    fallos := array_append(fallos, 'I3e el reintento no fue replay');
  end if;
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from core.group_notice n where n.scope_id = v_g and n.kind = 'edit';
  if v_n <> 2 then fallos := array_append(fallos, format('I3e2 tras el reintento hay %s avisos', v_n)); end if;

  -- I3f · una correccion RECHAZADA no notifica nada.
  perform set_config('role', 'authenticated', true);
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', 'af000000-0000-4000-8000-0000000000e4'::uuid,
      'command_contract_version', 1,
      'operation_id', v_op, 'expected_version_id', v_v1,
      'scope_id', v_g, 'currency_definition_id', v_eur, 'total', '600',
      'effective_date', current_date::text, 'concept', 'Pisando',
      'category_id', v_cena, 'payer_participant_id', v_q1,
      'participants', jsonb_build_array(v_q1, v_q2, v_q3),
      'split_method', jsonb_build_object('kind', 'equal')));
    fallos := array_append(fallos, 'I3f una correccion sobre version superada se acepto');
  exception when others then
    null;
  end;
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from core.group_notice n where n.scope_id = v_g and n.kind = 'edit';
  if v_n <> 2 then fallos := array_append(fallos, format('I3f2 un rechazo dejo %s avisos', v_n)); end if;

  -- I3g · AISLAMIENTO: cada cuenta ve la suya y solo la suya.
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from api.group_notice n where n.scope_id = v_g and n.kind = 'edit';
  if v_n <> 1 then fallos := array_append(fallos, format('I3g el editor ve %s avisos', v_n)); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_ub::text)::text, true);
  select count(*) into v_n from api.group_notice n where n.scope_id = v_g and n.kind = 'edit';
  if v_n <> 1 then fallos := array_append(fallos, format('I3g2 la otra cuenta ve %s avisos', v_n)); end if;

  -- I3h · y marcar leido es de cada uno: no toca el de nadie mas.
  -- ADR-034 §7: la relacion unica de avisos y su funcion de lectura. La
  -- politica pasa por sec.is_me: E23 midio que la anterior no era legible.
  perform api.mark_group_notice_read(n.id) from api.group_notice n where n.scope_id = v_g;
  select count(*) into v_n from api.group_notice n
   where n.scope_id = v_g and n.read_at is not null;
  if v_n <> 1 then fallos := array_append(fallos, 'I3h marcar leido no alcanzo su propia fila'); end if;

  perform set_config('role', 'postgres', true);
  select count(*) into v_n from core.group_notice n
   where n.scope_id = v_g and n.read_at is not null;
  if v_n <> 1 then fallos := array_append(fallos, format('I3h2 se marcaron %s filas como leidas', v_n)); end if;

  if array_length(fallos, 1) is not null then
    raise exception E'I · saldos y avisos:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'I · saldos derivados y avisos de edicion: OK';
end
$i$;

-- ============ F · LO QUE ESTA COMBINACION NO ADMITE, MEDIDO ================
--
-- **Un gasto con fecha ANTERIOR a la creacion del grupo se rechaza.** No es un
-- defecto de esta migracion: es la consecuencia directa de abrir las presencias
-- en `current_date`, y se deja escrita aqui para que sea una propiedad conocida
-- y no una sorpresa en produccion.
--
-- La alternativa era abrir el periodo en una fecha anterior, y ninguna es
-- defendible: cualquier fecha que se eligiera afirmaria que esas personas
-- formaban parte del grupo antes de que el grupo existiera, que es exactamente
-- la historia inventada que ADR-012 §7 evita al hacer la elegibilidad un hecho
-- fechado. Abrir el periodo hacia atras "por comodidad" convertiria una
-- restriccion honesta en un dato falso.
--
-- Lo que si es asunto del cliente: decir el motivo de forma comprensible y
-- conservar el borrador, que es lo que hace `group.expenseNotEligible`.
do $f$
declare
  fallos text[] := '{}';
  v_eur  uuid := '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';
  v_ua   uuid := 'aa000000-0000-4000-8000-000000000001';
  v_g    uuid := 'ab000000-0000-4000-8000-000000000010';
  v_p1   uuid := 'ad000000-0000-4000-8000-000000000031';
  v_p2   uuid := 'ad000000-0000-4000-8000-000000000032';
  v_cat  uuid;
  v_n    int;
begin
  perform set_config('role', 'postgres', true);
  select id into v_cat from core.category
   where message_key = 'category.expense.dining' and owner_user_id is null;

  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true);
  perform set_config('role', 'authenticated', true);

  -- F1 · ayer no vale, y el codigo lo dice.
  begin
    perform api.record_group_expense(jsonb_build_object(
      'client_operation_id', 'af000000-0000-4000-8000-0000000000f1'::uuid,
      'command_contract_version', 1, 'scope_id', v_g,
      'currency_definition_id', v_eur, 'total', '500',
      'effective_date', (current_date - 1)::text, 'concept', 'Cena de ayer',
      'category_id', v_cat, 'payer_participant_id', v_p1,
      'participants', jsonb_build_array(v_p1, v_p2),
      'split_method', jsonb_build_object('kind', 'equal')));
    fallos := array_append(fallos, 'F1 se acepto un gasto anterior a la creacion del grupo');
  exception when others then
    if sqlerrm not like '%PARTICIPANT_NOT_ELIGIBLE%' then
      fallos := array_append(fallos, ('F1b se rechazo por otro motivo: ' || sqlerrm));
    end if;
  end;

  -- F2 · y el rechazo no dejo nada escrito ni consumio la clave.
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from core.client_command cc
   where cc.client_operation_id = 'af000000-0000-4000-8000-0000000000f1'::uuid;
  if v_n <> 0 then fallos := array_append(fallos, 'F2 el rechazo dejo reclamada la clave'); end if;

  if array_length(fallos, 1) is not null then
    raise exception E'F · limites:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'F · el limite temporal de las presencias, medido: OK';
end
$f$;


-- ====== J · EL GASTO COMPARTIDO EN PERSONAL: una fila, y ni un euro mas ====
--
-- Lo que se afirma aqui es que la operacion del grupo se VE desde el Modo
-- Personal del pagador sin que exista una segunda operacion, un segundo efecto
-- de caja ni una segunda contabilidad. La salida de dinero ya estaba —el
-- escritor la asienta en el ambito personal del pagador, derivandolo del
-- vinculo— y lo unico que faltaba era publicarla en la lista.
--
-- Y lo que se afirma con mas fuerza es lo que NO cambia: el Disponible y las
-- estadisticas se miden ANTES y DESPUES del gasto, y la diferencia tiene que
-- ser exactamente la salida de caja en el primero y CERO en las segundas.
do $j$
declare
  fallos text[] := '{}';
  v_eur  uuid := '830e6f7e-2e33-564e-9ea3-f6c2023af1fe';
  v_ua   uuid := 'ba000000-0000-4000-8000-000000000001';
  v_g    uuid := 'bb000000-0000-4000-8000-000000000010';
  v_personal uuid := 'bb000000-0000-4000-8000-0000000000f1';
  v_p1   uuid := 'bd000000-0000-4000-8000-000000000031';
  v_p2   uuid := 'bd000000-0000-4000-8000-000000000032';
  v_op1  uuid := 'be000000-0000-4000-8000-000000000041';
  v_op2  uuid := 'be000000-0000-4000-8000-000000000042';
  v_cat  uuid;
  v_out  jsonb;
  v_n    bigint;
  v_saldo_antes    bigint;
  v_saldo_despues  bigint;
  v_gasto_antes    text;
  v_gasto_despues  text;
  v_cats_antes     jsonb;
  v_cats_despues   jsonb;
  v_ver  uuid;
  v_row  record;
begin
  perform set_config('role', 'postgres', true);
  select id into v_cat from core.category
   where message_key = 'category.expense.dining' and owner_user_id is null;

  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
  values (v_personal, 'personal', v_eur, v_ua);
  insert into core.membership (scope_id, user_id) values (v_personal, v_ua);

  perform set_config('request.jwt.claims', json_build_object('sub', v_ua::text)::text, true);
  perform set_config('role', 'authenticated', true);

  perform api.create_group(jsonb_build_object(
    'client_command_id', 'bc000000-0000-4000-8000-000000000020'::uuid,
    'command_contract_version', 1,
    'client_group_id', v_g, 'display_name', 'Viaje J', 'emoji', 'GRP',
    'currency_definition_id', v_eur,
    'creator_participant_id', v_p1, 'creator_display_name', 'Edu',
    'participants', jsonb_build_array(
      jsonb_build_object('client_participant_id', v_p2, 'display_name', 'Ana'))));

  -- La foto de ANTES, con el ambito ya creado y sin ningun gasto.
  select (pb.balance_amount)::bigint into v_saldo_antes from api.personal_balance pb;
  select (api.personal_statistics(null, null) ->> 'expense_total'),
         (api.personal_statistics(null, null) -> 'categories')
    into v_gasto_antes, v_cats_antes;

  -- 20,00 entre dos, pagados por mi: caja -20,00, mi consumo 10,00, me deben 10,00.
  v_out := api.record_group_expense(jsonb_build_object(
    'client_operation_id', v_op1, 'command_contract_version', 1,
    'scope_id', v_g, 'currency_definition_id', v_eur, 'total', '2000',
    'effective_date', current_date::text, 'concept', 'Cena J',
    'category_id', v_cat, 'payer_participant_id', v_p1,
    'participants', jsonb_build_array(v_p1, v_p2),
    'split_method', jsonb_build_object('kind', 'equal')));

  -- J1 · UNA fila en el historial personal, y con los tres hechos separados.
  select count(*) into v_n from api.personal_operation po
   where po.operation_class = 'group_expense';
  if v_n <> 1 then
    fallos := array_append(fallos, ('J1 el gasto compartido sale ' || v_n || ' veces en Personal'));
  end if;

  select po.balance_amount as saldo, po.original_amount as pagado, po.your_share as parte,
         po.group_scope_id as grupo, po.group_display_name as nombre
    into v_row
    from api.personal_operation po
   where po.operation_class = 'group_expense';

  if v_row.saldo is distinct from '-2000' then
    fallos := array_append(fallos, ('J1b la salida de caja no es -2000: ' || coalesce(v_row.saldo, 'nula')));
  end if;
  if v_row.pagado is distinct from '2000' then
    fallos := array_append(fallos, 'J1c lo pagado no es 2000');
  end if;
  if v_row.parte is distinct from '1000' then
    fallos := array_append(fallos, ('J1d mi parte no es 1000: ' || coalesce(v_row.parte, 'nula')));
  end if;
  if v_row.grupo is distinct from v_g then
    fallos := array_append(fallos, 'J1e no se identifica el grupo de origen');
  end if;
  if v_row.nombre is distinct from 'Viaje J' then
    fallos := array_append(fallos, 'J1f no llega el nombre del grupo');
  end if;

  -- J2 · Y NO hay ninguna operacion personal nueva: es la MISMA del grupo.
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from core.operation o
   where o.operation_class in ('personal_expense','personal_income')
     and o.created_at >= now() - interval '1 minute';
  if v_n <> 0 then
    fallos := array_append(fallos, 'J2 se creo una operacion personal duplicada');
  end if;

  -- J3 · un solo efecto de caja en el ambito personal, y de -2000.
  select count(*) into v_n from core.current_effect e
   where e.scope_id = v_personal and e.balance_amount is not null;
  if v_n <> 1 then
    fallos := array_append(fallos, ('J3 hay ' || v_n || ' efectos de caja personales, no uno'));
  end if;
  perform set_config('role', 'authenticated', true);

  -- J4 · el Disponible baja EXACTAMENTE la salida de caja. Ni 1000 ni 3000.
  select (pb.balance_amount)::bigint into v_saldo_despues from api.personal_balance pb;
  if v_saldo_despues - v_saldo_antes <> -2000 then
    fallos := array_append(fallos, ('J4 el Disponible se movio ' ||
      (v_saldo_despues - v_saldo_antes) || ' en vez de -2000'));
  end if;

  -- J5 · LAS ESTADISTICAS NO SE MUEVEN. Ni el total ni el desglose.
  select (api.personal_statistics(null, null) ->> 'expense_total'),
         (api.personal_statistics(null, null) -> 'categories')
    into v_gasto_despues, v_cats_despues;
  -- J5 · LAS ESTADISTICAS SE MUEVEN EXACTAMENTE EN MI CUOTA, y no en la caja.
  -- Desde ADR-026 + 20260910120000 (seccion M de personal-statistics.sql) la
  -- parte economica de un gasto compartido cuenta como gasto propio: 2000
  -- entre dos es 1000 de cuota, y ni un euro de los 2000 que salieron de caja.
  if v_gasto_despues::bigint - v_gasto_antes::bigint <> 1000 then
    fallos := array_append(fallos, ('J5 expense_total cambio de ' || v_gasto_antes ||
      ' a ' || v_gasto_despues || ': tenia que subir exactamente la cuota, 1000'));
  end if;
  if v_cats_despues is not distinct from v_cats_antes then
    fallos := array_append(fallos, 'J5b el desglose por categorias no recogio la cuota');
  end if;

  -- J6 · la posicion del grupo es 1000 a mi favor, y el grupo suma cero.
  select (gs.net_position)::bigint into v_n from api.group_summary gs where gs.scope_id = v_g;
  if v_n <> 1000 then
    fallos := array_append(fallos, ('J6 net_position es ' || v_n || ' y deberia ser 1000'));
  end if;
  select coalesce(sum((gb.net_position)::bigint), 0) into v_n
    from api.group_balance gb where gb.scope_id = v_g;
  if v_n <> 0 then
    fallos := array_append(fallos, ('J6b los saldos del grupo suman ' || v_n || ' y no cero'));
  end if;

  -- J7 · CORREGIR el gasto actualiza la fila personal. No hay que presenciarlo.
  select po.current_version_id into v_ver from api.personal_operation po
   where po.operation_class = 'group_expense';
  perform api.record_group_expense(jsonb_build_object(
    'client_operation_id', 'be000000-0000-4000-8000-00000000004a'::uuid,
    'command_contract_version', 1,
    'operation_id', (v_out ->> 'operation_id')::uuid,
    'expected_version_id', v_ver,
    'scope_id', v_g, 'currency_definition_id', v_eur, 'total', '3000',
    'effective_date', current_date::text, 'concept', 'Cena J',
    'category_id', v_cat, 'payer_participant_id', v_p1,
    'participants', jsonb_build_array(v_p1, v_p2),
    'split_method', jsonb_build_object('kind', 'equal')));

  select po.balance_amount as saldo, po.your_share as parte
    into v_row from api.personal_operation po where po.operation_class = 'group_expense';
  if v_row.saldo is distinct from '-3000' or v_row.parte is distinct from '1500' then
    fallos := array_append(fallos, 'J7 la correccion no llego a la fila personal');
  end if;
  select count(*) into v_n from api.personal_operation po where po.operation_class = 'group_expense';
  if v_n <> 1 then
    fallos := array_append(fallos, ('J7b tras corregir hay ' || v_n || ' filas, no una'));
  end if;

  -- J8 · ANULAR lo retira del historial personal, sin borrar nada.
  select po.current_version_id into v_ver from api.personal_operation po
   where po.operation_class = 'group_expense';
  perform api.annul_operation(jsonb_build_object(
    'client_operation_id', 'be000000-0000-4000-8000-00000000004b'::uuid,
    'command_contract_version', 2,
    'operation_id', (v_out ->> 'operation_id')::uuid,
    'expected_version_id', v_ver));

  select count(*) into v_n from api.personal_operation po where po.operation_class = 'group_expense';
  if v_n <> 0 then
    fallos := array_append(fallos, 'J8 el gasto anulado sigue en el historial personal');
  end if;
  select (pb.balance_amount)::bigint into v_saldo_despues from api.personal_balance pb;
  if v_saldo_despues <> v_saldo_antes then
    fallos := array_append(fallos, 'J8b el Disponible no volvio a su sitio tras anular');
  end if;

  -- J9 · PAGA OTRO Y LO REGISTRO YO: no me carga su salida de dinero.
  --
  -- Es la condicion del producto escrita como prueba: la fila aparece por SER
  -- EL PAGADOR y no por haber pulsado Guardar. Ana no tiene cuenta ni ambito
  -- personal, asi que no hay caja donde asentar su desembolso; lo que importa
  -- es que tampoco se asienta en la mia.
  perform api.record_group_expense(jsonb_build_object(
    'client_operation_id', v_op2, 'command_contract_version', 1,
    'scope_id', v_g, 'currency_definition_id', v_eur, 'total', '4000',
    'effective_date', current_date::text, 'concept', 'Paga Ana',
    'category_id', v_cat, 'payer_participant_id', v_p2,
    'participants', jsonb_build_array(v_p1, v_p2),
    'split_method', jsonb_build_object('kind', 'equal')));

  select count(*) into v_n from api.personal_operation po where po.operation_class = 'group_expense';
  if v_n <> 0 then
    fallos := array_append(fallos, 'J9 un gasto que pago otra persona aparece en mi historial');
  end if;
  select (pb.balance_amount)::bigint into v_saldo_despues from api.personal_balance pb;
  if v_saldo_despues <> v_saldo_antes then
    fallos := array_append(fallos, ('J9b mi Disponible se movio ' ||
      (v_saldo_despues - v_saldo_antes) || ' por un gasto que pago otra persona'));
  end if;

  -- Y sin embargo la deuda SI cambia: ahora le debo su mitad.
  select (gs.net_position)::bigint into v_n from api.group_summary gs where gs.scope_id = v_g;
  if v_n <> -2000 then
    fallos := array_append(fallos, ('J9c mi posicion es ' || v_n || ' y deberia ser -2000'));
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'J · gasto compartido en Personal:\n%', array_to_string(fallos, E'\n');
  end if;
  raise notice 'J · el gasto compartido se ve en Personal sin duplicar dinero: OK';
end
$j$;

rollback;
