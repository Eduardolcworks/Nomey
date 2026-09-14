-- ============================================================================
-- EL CERROJO DE IDENTIDAD DEL GRUPO · guardas de catalogo
-- ============================================================================
--
-- Migraciones 20260912150000, 20260912170000 (pagos y anulacion tambien
-- toman el rango 1) y 20260915120000 (asociar y crear grupo). No prueba carreras (eso lo hacen, con dos sesiones
-- reales, scripts/unclaim-race-evidence.sh, group-payment-race-evidence.sh y
-- departed-obligation-race-evidence.sh): prueba que las funciones VIVAS
-- siguen el orden del protocolo, leyendo sus cuerpos del catalogo, para que una
-- recreacion posterior —F11 toca los dos writers— no lo pierda en silencio.
--
--   0 · la clave de idempotencia, antes de todo bloqueo.
--   1 · sec.lock_participant_claims(grupo), antes de leer membresia, vinculo,
--       presencia o retiro, y antes de resolver un Personal por vinculo.
--   2 · sec.lock_scopes, despues de 1.
--   3 · sec.lock_and_cas, despues de 2.
--
-- Solo lectura. Termina en rollback por convencion.
begin;

create temp table fn (name text, body text);
insert into fn
select n.nspname || '.' || p.proname,
       regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('api', 'sec') and p.prokind = 'f';

create function pg_temp.pos(p_body text, p_needle text) returns integer
language sql immutable as $$ select nullif(position(p_needle in p_body), 0) $$;

create function pg_temp.antes(p_fn text, p_a text, p_b text) returns void
language plpgsql as $$
declare v_body text; v_a integer; v_b integer;
begin
  select body into v_body from fn where name = p_fn;
  if v_body is null then raise exception '% no existe', p_fn; end if;
  v_a := pg_temp.pos(v_body, p_a); v_b := pg_temp.pos(v_body, p_b);
  if v_a is null then raise exception '%: no llama a %', p_fn, p_a; end if;
  if v_b is not null and v_b < v_a then
    raise exception '%: % (pos %) va ANTES de % (pos %)', p_fn, p_b, v_b, p_a, v_a;
  end if;
end $$;

do $a$
declare r record; v_n integer; v_rel text;
begin
  -- A · el cerrojo es de TRANSACCION y por ambito: no de sesion, no global.
  select body into r from fn where name = 'sec.lock_participant_claims';
  if r.body not like '%pg_advisory_xact_lock(hashtextextended(p_scope::text, 0))%' then
    raise exception 'A: lock_participant_claims ya no es pg_advisory_xact_lock por ambito';
  end if;
  raise notice 'OK · A · sec.lock_participant_claims: consultivo, de transaccion, por ambito';

  -- B · quien lo toma, y ANTES de que: membresia, vinculo, presencia, retiro,
  --     Personal por vinculo, filas de ambito, CAS.
  for r in select * from (values
    ('api.record_group_expense'),
    ('api.record_settlement_by_transfer'),
    ('api.retire_participant'),
    ('api.settle_participant'),
    ('api.leave_group'),
    ('api.redeem_invitation'),
    ('api.unclaim_participant'),
    ('api.annul_operation'),
    ('api.record_debt_settlement'),
    ('api.record_group_payment'),
    -- F09/ADR-009 (deuda anotada en F10.A0) y F10/ADR-001 §3 (toda alta de
    -- instancia escribe su linea base y su S0 bajo el cerrojo, create_group
    -- incluida: 20260915120000).
    ('api.associate_participant'),
    ('api.create_group')) as t(name)
  loop
    perform pg_temp.antes(r.name, 'sec.lock_participant_claims(', 'sec.assert_member(');
    perform pg_temp.antes(r.name, 'sec.lock_participant_claims(', 'sec.is_member(');
    perform pg_temp.antes(r.name, 'sec.lock_participant_claims(', 'sec.participant_personal_scope(');
    perform pg_temp.antes(r.name, 'sec.lock_participant_claims(', 'sec.participant_available(');
    for v_rel in select unnest(array['core.participant_user_link', 'core.membership',
                                      'core.participant_period', 'core.participant_retirement']) loop
      perform pg_temp.antes(r.name, 'sec.lock_participant_claims(', 'from ' || v_rel);
      perform pg_temp.antes(r.name, 'sec.lock_participant_claims(', 'into ' || v_rel);
      perform pg_temp.antes(r.name, 'sec.lock_participant_claims(', 'update ' || v_rel);
    end loop;
    perform pg_temp.antes(r.name, 'sec.lock_participant_claims(', 'sec.lock_scopes(');
    perform pg_temp.antes(r.name, 'sec.lock_participant_claims(', 'sec.lock_and_cas(');
  end loop;
  raise notice 'OK · B · doce funciones toman el cerrojo antes de leer o cambiar identidad, y antes de las filas';

  -- C · la clave de idempotencia va ANTES del cerrojo (0 < 1), donde la hay
  --     por insercion: los writers (begin_command) y el provisioner
  --     (provisioning_command). Retirar y «Saldado» reintentan por lectura
  --     bajo el cerrojo y su unicidad ya esta serializada por el.
  perform pg_temp.antes('api.record_group_expense',          'sec.begin_command(',     'sec.lock_participant_claims(');
  perform pg_temp.antes('api.record_settlement_by_transfer', 'sec.begin_command(',     'sec.lock_participant_claims(');
  perform pg_temp.antes('api.record_debt_settlement',        'sec.begin_command(',     'sec.lock_participant_claims(');
  perform pg_temp.antes('api.record_group_payment',          'sec.begin_command(',     'sec.lock_participant_claims(');
  perform pg_temp.antes('api.annul_operation',               'sec.begin_command(',     'sec.lock_participant_claims(');
  perform pg_temp.antes('api.leave_group',                   'core.provisioning_command', 'sec.lock_participant_claims(');
  perform pg_temp.antes('api.redeem_invitation',             'core.provisioning_command', 'sec.lock_participant_claims(');
  perform pg_temp.antes('api.unclaim_participant',            'core.provisioning_command', 'sec.lock_participant_claims(');
  perform pg_temp.antes('api.associate_participant',          'core.provisioning_command', 'sec.lock_participant_claims(');
  perform pg_temp.antes('api.create_group',                   'core.provisioning_command', 'sec.lock_participant_claims(');
  raise notice 'OK · C · la clave se reclama antes del cerrojo';

  -- D · orden 2 < 3 en quien tiene los dos.
  for r in select name from fn where body like '%sec.lock_and_cas(%' and name like 'api.%' loop
    perform pg_temp.antes(r.name, 'sec.lock_scopes(', 'sec.lock_and_cas(');
  end loop;
  raise notice 'OK · D · las filas de ambito siempre antes que la fila de la operacion';

  -- E · NADIE resuelve un Personal por vinculo sin el cerrojo delante. Es la
  --     guarda que vigila a F11: un writer nuevo o recreado que llame a
  --     sec.participant_personal_scope sin tomar antes el cerrojo falla aqui.
  v_n := 0;
  for r in select name, body from fn
            where body like '%sec.participant_personal_scope(%'
              and name <> 'sec.participant_personal_scope'
  loop
    v_n := v_n + 1;
    perform pg_temp.antes(r.name, 'sec.lock_participant_claims(', 'sec.participant_personal_scope(');
  end loop;
  if v_n < 2 then raise exception 'E: se esperaban al menos dos resolutores de Personal por vinculo, hay %', v_n; end if;
  raise notice 'OK · E · % funciones resuelven un Personal por vinculo, todas bajo el cerrojo', v_n;

  -- F · el aislamiento del provisioner se conserva: reclamar y salir toman
  --     SOLO el cerrojo (rectificar tambien); ninguna fila de ambito (E6 de group-provisioning: el
  --     provisioner no ve grupos de los que el actor no es miembro).
  for r in select name, body from fn where name in ('api.redeem_invitation', 'api.leave_group', 'api.unclaim_participant', 'api.associate_participant', 'api.create_group') loop
    if r.body like '%sec.lock_scopes(%' then
      raise exception 'F: % toma filas de ambito como provisioner', r.name;
    end if;
  end loop;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname in ('redeem_invitation', 'leave_group', 'unclaim_participant')
     and pg_get_userbyid(p.proowner) = 'nomey_provisioner';
  if v_n <> 3 then raise exception 'F: reclamar, rectificar y salir ya no son del provisioner'; end if;
  raise notice 'OK · F · reclamar, rectificar y salir: solo el cerrojo, y siguen siendo del provisioner';

  -- G · propietario y permisos conservados tras la recreacion.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api'
     and p.proname in ('record_group_expense', 'record_settlement_by_transfer', 'retire_participant', 'settle_participant',
                       'annul_operation', 'record_debt_settlement', 'record_group_payment')
     and pg_get_userbyid(p.proowner) = 'nomey_writer' and p.prosecdef;
  if v_n <> 7 then raise exception 'G: los siete del writer ya no son definer de nomey_writer (%)', v_n; end if;
  if not has_function_privilege('authenticated', 'api.record_group_expense(jsonb)', 'execute')
     or has_function_privilege('anon', 'api.record_group_expense(jsonb)', 'execute') then
    raise exception 'G: el execute de record_group_expense cambio';
  end if;
  raise notice 'OK · G · propietarios y execute intactos';
end
$a$;

rollback;
