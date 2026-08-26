-- Comprobaciones de la proyeccion canonica y de la atribucion economica,
-- contra la base REAL construida por las migraciones.
--
-- Uso, desde Ubuntu y con el stack levantado:
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--     -X -q -v ON_ERROR_STOP=1 < supabase/checks/canonical-attribution.sql
--
-- Acumula los fallos de cada seccion y termina con excepcion si hubo alguno.
-- Todo ocurre dentro de una transaccion que termina en ROLLBACK.

\pset pager off
\set ON_ERROR_STOP on

begin;

-- ============================ A · catalogo, privilegios y guarda ===========
do $estructura$
declare
  fallos text[] := '{}';
  v_n int;
  v_t text;
begin
  -- A1 · la proyeccion canonica y la superficie existen.
  if to_regclass('core.current_effect') is null then
    fallos := array_append(fallos, 'A1: no existe la proyeccion canonica core.current_effect');
  end if;
  if to_regclass('api.personal_effect') is null then
    fallos := array_append(fallos, 'A1b: no existe api.personal_effect');
  end if;

  -- A2 · las dos vistas son security_invoker. E19: sin eso, el camino de
  -- lectura pierde la RLS y SIGUE devolviendo cifras creibles.
  for v_t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where (n.nspname, c.relname) in (('core','current_effect'),('api','personal_effect'))
               and not coalesce((select option_value = 'true' from pg_options_to_table(c.reloptions)
                                 where option_name = 'security_invoker'), false)
  loop
    fallos := array_append(fallos, format('A2: la vista %s NO es security_invoker', v_t));
  end loop;

  -- A3 · GUARDA DE ADR-013 §9. La unica RELACION que puede depender
  -- directamente de core.effect es la proyeccion canonica. E19 midio que las
  -- dependencias del catalogo son DIRECTAS y no transitivas, y eso es lo que
  -- hace verificable la regla.
  select count(*) into v_n
  from pg_depend d
  join pg_rewrite r on r.oid = d.objid
  join pg_class dep on dep.oid = r.ev_class
  where d.refobjid = 'core.effect'::regclass
    and d.classid = 'pg_rewrite'::regclass
    and dep.relkind = 'v'
    and dep.oid <> 'core.current_effect'::regclass;
  if v_n <> 0 then
    fallos := array_append(fallos, format('A3: %s vistas dependen directamente de core.effect saltandose la proyeccion canonica', v_n));
  end if;

  -- A3b · y ninguna FUNCION depende directamente de core.effect tampoco. La
  -- frontera del claim debe pasar por la proyeccion, no por la tabla.
  select count(*) into v_n
  from pg_depend d
  join pg_proc p on p.oid = d.objid
  where d.refobjid = 'core.effect'::regclass
    and d.classid = 'pg_proc'::regclass;
  if v_n <> 0 then
    fallos := array_append(fallos, format('A3c: %s funciones dependen directamente de core.effect', v_n));
  end if;

  -- A3d · POSITIVO: la frontera SI deja dependencia analizable, que es lo que
  -- ADR-013 §9 exige con `BEGIN ATOMIC`. Sin ella la guarda no la cubriria.
  if not exists (
    select 1 from pg_depend d
    join pg_class c on c.oid = d.refobjid
    where d.objid = 'api.claimed_dimension()'::regprocedure
      and d.classid = 'pg_proc'::regclass
      and c.relname = 'current_effect'
  ) then
    fallos := array_append(fallos, 'A3d: api.claimed_dimension no deja dependencia de catalogo hacia la proyeccion canonica');
  end if;

  -- A4 · la frontera privilegiada, atributo por atributo.
  if not exists (select 1 from pg_proc where oid = 'api.claimed_dimension()'::regprocedure
                   and prosecdef) then
    fallos := array_append(fallos, 'A4: api.claimed_dimension no es SECURITY DEFINER');
  end if;
  if (select pg_get_userbyid(proowner) from pg_proc
      where oid = 'api.claimed_dimension()'::regprocedure) <> 'postgres' then
    fallos := array_append(fallos, 'A4b: el owner de la frontera no es postgres, asi que no atraviesa la RLS y no puede recuperar lo reclamado');
  end if;
  if not exists (select 1 from pg_proc where oid = 'api.claimed_dimension()'::regprocedure
                   and provolatile = 's'
                   and proconfig = array['search_path=""']) then
    fallos := array_append(fallos, 'A4c: la frontera no es STABLE con search_path fijado a vacio');
  end if;
  -- SIN PARAMETROS: no hay identidad ajena que pasarle ni nada que enumerar.
  if (select pronargs from pg_proc where oid = 'api.claimed_dimension()'::regprocedure) <> 0 then
    fallos := array_append(fallos, 'A4d: la frontera acepta parametros; podria usarse como oraculo sobre otra identidad');
  end if;

  -- A5 · EXECUTE: PUBLIC no, anon no, authenticated si.
  if has_function_privilege('public', 'api.claimed_dimension()', 'execute') then
    fallos := array_append(fallos, 'A5: PUBLIC puede ejecutar la frontera');
  end if;
  if has_function_privilege('anon', 'api.claimed_dimension()', 'execute') then
    fallos := array_append(fallos, 'A5b: anon puede ejecutar la frontera');
  end if;
  if not has_function_privilege('authenticated', 'api.claimed_dimension()', 'execute') then
    fallos := array_append(fallos, 'A5c: authenticated no puede ejecutar la frontera');
  end if;

  -- A6 · ningun acceso nuevo del cliente sobre el vinculo ni sobre core.
  if has_table_privilege('authenticated', 'core.participant_user_link', 'select') then
    fallos := array_append(fallos, 'A6: authenticated gano SELECT sobre core.participant_user_link');
  end if;
  if has_schema_privilege('authenticated', 'core', 'usage') then
    fallos := array_append(fallos, 'A6b: authenticated gano USAGE sobre core');
  end if;
  select count(*) into v_n
  from information_schema.table_privileges
  where table_schema = 'core' and grantee in ('anon','authenticated','service_role')
    and privilege_type <> 'SELECT';
  if v_n <> 0 then
    fallos := array_append(fallos, format('A6c: los roles cliente tienen %s privilegios de core distintos de SELECT', v_n));
  end if;

  -- A7 · la RLS de core.effect NO se amplio. Sigue siendo exactamente la de
  -- ADR-013 §10: membresia del ambito.
  select count(*) into v_n
  from pg_policy p
  join pg_roles r on r.oid = any(p.polroles)
  where p.polrelid = 'core.effect'::regclass and r.rolname = 'authenticated';
  if v_n <> 1 then
    fallos := array_append(fallos, format('A7: core.effect tiene %s policies de cliente y deberia tener 1', v_n));
  end if;
  if not exists (
    select 1 from pg_policy p
    where p.polrelid = 'core.effect'::regclass
      and pg_get_expr(p.polqual, p.polrelid) like '%is_member%'
  ) then
    fallos := array_append(fallos, 'A7b: la policy de cliente de core.effect ya no deriva de la membresia del ambito');
  end if;

  -- A8 · ninguna policy de core aplicable a PUBLIC, y ninguna tabla sin RLS.
  if exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
             join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'core' and 0 = any(p.polroles)) then
    fallos := array_append(fallos, 'A8: existe una policy de core aplicable a PUBLIC');
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'core' and c.relkind = 'r' and not c.relrowsecurity) then
    fallos := array_append(fallos, 'A8b: hay tablas de core sin RLS activada');
  end if;

  -- A9 · BIGINT NO CRUZA `api`. ADR-008 §1: los valores exactos salen como
  -- texto, porque E11 midio que la degradacion la produce JSON.parse.
  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'api' and data_type = 'bigint';
  if v_n <> 0 then
    fallos := array_append(fallos, format('A9: %s columnas de api son bigint y cruzarian como numero JSON', v_n));
  end if;
  if pg_get_function_result('api.claimed_dimension()'::regprocedure) like '%bigint%' then
    fallos := array_append(fallos, 'A9b: la frontera devuelve bigint en vez de texto');
  end if;

  -- A9c · y la lista de columnas de la frontera es EXACTAMENTE la acordada.
  -- Es la frontera de privacidad: ampliarla es una decision de privacidad.
  v_t := pg_get_function_result('api.claimed_dimension()'::regprocedure);
  foreach v_t in array array['scope_id','participant_id','effect_id','operation_id',
                             'operation_version_id','owner_user_id','debtor','creditor']
  loop
    if pg_get_function_result('api.claimed_dimension()'::regprocedure) like '%' || v_t || '%' then
      fallos := array_append(fallos, format('A9c: la frontera expone %s, que la lista acordada excluye', v_t));
    end if;
  end loop;

  -- A10 · la propiedad durable NO se expone en ninguna superficie de api.
  if exists (select 1 from information_schema.columns
             where table_schema = 'api' and column_name = 'owner_user_id') then
    fallos := array_append(fallos, 'A10: owner_user_id esta expuesto en una superficie de api');
  end if;

  -- A11 · regla generica heredada: ningun GRANT SELECT de core inutilizado.
  select count(*) into v_n
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  join pg_roles g on g.oid = a.grantee
  where n.nspname = 'core' and c.relkind = 'r' and c.relrowsecurity
    and a.privilege_type = 'SELECT'
    and g.rolname in ('anon','authenticated','service_role','nomey_writer')
    and not exists (select 1 from pg_policy p
                    where p.polrelid = c.oid and p.polcmd in ('r','*')
                      and (0 = any(p.polroles) or a.grantee = any(p.polroles)));
  if v_n <> 0 then
    fallos := array_append(fallos, format('A11: %s GRANT SELECT de core quedan inutilizados por ausencia de policy', v_n));
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE CATALOGO:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · A · catalogo, guarda de la proyeccion y frontera privilegiada';
end
$estructura$;

-- ============================ B · propiedad durable del Modo Personal ======
do $ownership$
declare
  fallos text[] := '{}';
  EUR constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  A constant uuid := '11111111-1111-4111-8111-111111111111';
begin
  insert into core.currency_definition (id, code, scale) values (EUR,'EUR',2);

  -- B1 · personal CON dueno.
  begin
    insert into core.scope (id,kind,base_currency_definition_id,owner_user_id)
    values ('f0000000-0000-4000-8000-000000000001','personal',EUR,A);
  exception when others then
    fallos := array_append(fallos, format('B1: se rechazo un personal con dueno: %s', sqlerrm));
  end;

  -- B2 · personal SIN dueno.
  begin
    insert into core.scope (id,kind,base_currency_definition_id)
    values ('f0000000-0000-4000-8000-000000000002','personal',EUR);
    fallos := array_append(fallos, 'B2: se acepto un Modo Personal sin dueno');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('B2: sqlstate inesperado %s', sqlstate));
  end;

  -- B3 · group y couple CON dueno.
  begin
    insert into core.scope (id,kind,base_currency_definition_id,owner_user_id)
    values ('f0000000-0000-4000-8000-000000000003','group',EUR,A);
    fallos := array_append(fallos, 'B3: se acepto un group con dueno');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('B3: sqlstate inesperado %s', sqlstate));
  end;
  begin
    insert into core.scope (id,kind,base_currency_definition_id,owner_user_id)
    values ('f0000000-0000-4000-8000-000000000004','couple',EUR,A);
    fallos := array_append(fallos, 'B3b: se acepto un couple con dueno');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('B3b: sqlstate inesperado %s', sqlstate));
  end;

  -- B4 · segundo Modo Personal del mismo usuario.
  begin
    insert into core.scope (id,kind,base_currency_definition_id,owner_user_id)
    values ('f0000000-0000-4000-8000-000000000005','personal',EUR,A);
    fallos := array_append(fallos, 'B4: se acepto un segundo Modo Personal del mismo usuario');
  exception when unique_violation then null;
    when others then fallos := array_append(fallos, format('B4: sqlstate inesperado %s', sqlstate));
  end;

  -- B5 · POSITIVO · varios ambitos compartidos sin dueno conviven: los NULL no
  -- colisionan en el indice unico. Sin este positivo, B4 pasaria con un indice
  -- que prohibiese todo.
  begin
    insert into core.scope (id,kind,base_currency_definition_id) values
      ('f0000000-0000-4000-8000-000000000006','group',EUR),
      ('f0000000-0000-4000-8000-000000000007','group',EUR),
      ('f0000000-0000-4000-8000-000000000008','couple',EUR);
  exception when others then
    fallos := array_append(fallos, format('B5: se rechazaron varios ambitos compartidos sin dueno: %s', sqlerrm));
  end;

  delete from core.scope where id::text like 'f0000000%';

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE PROPIEDAD:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · B · propiedad durable del Modo Personal, estructural';
end
$ownership$;

-- ================================================================ fixture ===
-- A: dueno de SPA. Vinculado a PA del grupo G. NO es miembro de G.
-- B: dueno de SPB, miembro de G, vinculado a PB.
-- C: vinculado a PC de G.
-- CPL: Modo Pareja de A y B, con saldo comun.
insert into core.scope (id,kind,base_currency_definition_id,owner_user_id) values
  ('a0000000-0000-4000-8000-0000000000a1','personal','cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111'),
  ('a0000000-0000-4000-8000-0000000000b1','personal','cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222');
insert into core.scope (id,kind,base_currency_definition_id) values
  ('a0000000-0000-4000-8000-0000000000f1','group','cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  ('a0000000-0000-4000-8000-0000000000c1','couple','cccccccc-cccc-4ccc-8ccc-cccccccccccc');

insert into core.participant (id,scope_id,display_name) values
  ('b0000000-0000-4000-8000-0000000000aa','a0000000-0000-4000-8000-0000000000f1','Ana'),
  ('b0000000-0000-4000-8000-0000000000bb','a0000000-0000-4000-8000-0000000000f1','Beto'),
  ('b0000000-0000-4000-8000-0000000000cc','a0000000-0000-4000-8000-0000000000f1','Cris');

-- El vinculo se establece HOY, muy despues de las fechas efectivas de 2025.
-- Es la prueba de que `linked_at` no filtra historia.
insert into core.participant_user_link (participant_id,scope_id,user_id) values
  ('b0000000-0000-4000-8000-0000000000aa','a0000000-0000-4000-8000-0000000000f1','11111111-1111-4111-8111-111111111111'),
  ('b0000000-0000-4000-8000-0000000000bb','a0000000-0000-4000-8000-0000000000f1','22222222-2222-4222-8222-222222222222'),
  ('b0000000-0000-4000-8000-0000000000cc','a0000000-0000-4000-8000-0000000000f1','33333333-3333-4333-8333-333333333333');

-- A NO es miembro de G. Ese es el caso.
insert into core.membership (scope_id,user_id) values
  ('a0000000-0000-4000-8000-0000000000a1','11111111-1111-4111-8111-111111111111'),
  ('a0000000-0000-4000-8000-0000000000b1','22222222-2222-4222-8222-222222222222'),
  ('a0000000-0000-4000-8000-0000000000f1','22222222-2222-4222-8222-222222222222'),
  ('a0000000-0000-4000-8000-0000000000c1','11111111-1111-4111-8111-111111111111'),
  ('a0000000-0000-4000-8000-0000000000c1','22222222-2222-4222-8222-222222222222');

-- OP1 en G, corregida: V1 historica, V2 vigente.
insert into core.operation (id,operation_class,created_by,current_version_id)
values ('c0000000-0000-4000-8000-000000000001','expense',
        '22222222-2222-4222-8222-222222222222','d0000000-0000-4000-8000-000000000002');
insert into core.operation_version
  (id,operation_id,version_no,supersedes_version_id,created_by,effective_date,
   original_amount,original_currency_definition_id,economic_rules_version)
values
  ('d0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',1,null,
   '22222222-2222-4222-8222-222222222222',date '2025-03-10',9000,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','v1'),
  ('d0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001',2,
   'd0000000-0000-4000-8000-000000000001',
   '22222222-2222-4222-8222-222222222222',date '2025-03-10',9000,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','v1');

-- Efectos de V1 · HISTORICOS, no deben contar.
insert into core.effect
  (id,operation_version_id,scope_id,accounting_class,currency_definition_id,
   economic_amount,economic_participant_id)
values ('e0000000-0000-4000-8000-0000000000e1','d0000000-0000-4000-8000-000000000001',
        'a0000000-0000-4000-8000-0000000000f1','expense','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        5000,'b0000000-0000-4000-8000-0000000000aa');

-- Efectos de V2 · VIGENTES.
--   E1 · FILA MIXTA: economica de PB (de B) + deuda PA->PB. La que decide.
--   E2 · economica de PA (de A).
--   E3 · deuda PC->PA: A es ACREEDOR, signo positivo.
--   E4 · deuda PB->PC: entre terceros, A no debe verla.
insert into core.effect
  (id,operation_version_id,scope_id,accounting_class,currency_definition_id,
   economic_amount,economic_participant_id,
   debt_amount,debt_debtor_participant_id,debt_creditor_participant_id)
values
  ('e0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-0000000000f1','expense','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   3000,'b0000000-0000-4000-8000-0000000000bb',
   3000,'b0000000-0000-4000-8000-0000000000aa','b0000000-0000-4000-8000-0000000000bb'),
  ('e0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-0000000000f1','expense','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   3000,'b0000000-0000-4000-8000-0000000000aa',null,null,null),
  ('e0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-0000000000f1','expense','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   null,null,
   1000,'b0000000-0000-4000-8000-0000000000cc','b0000000-0000-4000-8000-0000000000aa'),
  ('e0000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-0000000000f1','expense','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   null,null,
   500,'b0000000-0000-4000-8000-0000000000bb','b0000000-0000-4000-8000-0000000000cc');

-- OP2 · gasto personal de A en SPA: saldo -2000 y economica SIN participante.
insert into core.operation (id,operation_class,created_by,current_version_id)
values ('c0000000-0000-4000-8000-000000000002','expense',
        '11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000003');
insert into core.operation_version
  (id,operation_id,version_no,supersedes_version_id,created_by,effective_date,
   original_amount,original_currency_definition_id,economic_rules_version)
values ('d0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000002',1,null,
        '11111111-1111-4111-8111-111111111111',date '2025-05-02',2000,
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc','v1');
insert into core.effect
  (id,operation_version_id,scope_id,accounting_class,currency_definition_id,
   balance_amount,economic_amount)
values ('e0000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000003',
        'a0000000-0000-4000-8000-0000000000a1','expense','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        -2000,2000);

-- OP3 · saldo del Modo Pareja. NO se atribuye a nadie individualmente.
insert into core.operation (id,operation_class,created_by,current_version_id)
values ('c0000000-0000-4000-8000-000000000003','expense',
        '11111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000004');
insert into core.operation_version
  (id,operation_id,version_no,supersedes_version_id,created_by,effective_date,
   original_amount,original_currency_definition_id,economic_rules_version)
values ('d0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000003',1,null,
        '11111111-1111-4111-8111-111111111111',date '2025-06-01',800,
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc','v1');
insert into core.effect
  (id,operation_version_id,scope_id,accounting_class,currency_definition_id,balance_amount)
values ('e0000000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-000000000004',
        'a0000000-0000-4000-8000-0000000000c1','expense','cccccccc-cccc-4ccc-8ccc-cccccccccccc',-800);

-- OP4 · saldo en el Modo Personal de B. No es de A aunque compartan Pareja.
insert into core.operation (id,operation_class,created_by,current_version_id)
values ('c0000000-0000-4000-8000-000000000004','expense',
        '22222222-2222-4222-8222-222222222222','d0000000-0000-4000-8000-000000000005');
insert into core.operation_version
  (id,operation_id,version_no,supersedes_version_id,created_by,effective_date,
   original_amount,original_currency_definition_id,economic_rules_version)
values ('d0000000-0000-4000-8000-000000000005','c0000000-0000-4000-8000-000000000004',1,null,
        '22222222-2222-4222-8222-222222222222',date '2025-07-01',6000,
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc','v1');
insert into core.effect
  (id,operation_version_id,scope_id,accounting_class,currency_definition_id,balance_amount)
values ('e0000000-0000-4000-8000-000000000007','d0000000-0000-4000-8000-000000000005',
        'a0000000-0000-4000-8000-0000000000b1','expense','cccccccc-cccc-4ccc-8ccc-cccccccccccc',-6000);

-- Superficie de test para medir la RLS general del efecto. Las definitivas de
-- lectura general llegan con sus fases; esta desaparece con el ROLLBACK.
create view api.chk_current with (security_invoker = true) as
  select * from core.current_effect;
grant select on api.chk_current to authenticated;

-- ============================ C · la proyeccion canonica ===================
do $proyeccion$
declare
  fallos text[] := '{}';
  v_n int;
begin
  -- C1 · como propietario, sin RLS de por medio: V1 fuera, V2 dentro.
  select count(*) into v_n from core.current_effect
   where operation_version_id = 'd0000000-0000-4000-8000-000000000001';
  if v_n <> 0 then
    fallos := array_append(fallos, format('C1: la proyeccion incluye %s efectos de la version SUPERADA', v_n));
  end if;

  select count(*) into v_n from core.current_effect
   where operation_version_id = 'd0000000-0000-4000-8000-000000000002';
  if v_n <> 4 then
    fallos := array_append(fallos, format('C1b: la proyeccion incluye %s efectos de la version vigente y deberia incluir 4', v_n));
  end if;

  -- C1c · y los de OTRAS operaciones vigentes tambien estan.
  select count(*) into v_n from core.current_effect;
  if v_n <> 7 then
    fallos := array_append(fallos, format('C1d: la proyeccion tiene %s efectos vigentes en total y deberia tener 7', v_n));
  end if;

  -- C2 · el efecto historico SIGUE en la tabla: la vigencia no borra historia.
  select count(*) into v_n from core.effect;
  if v_n <> 8 then
    fallos := array_append(fallos, format('C2: hay %s efectos persistidos y deberia haber 8, historico incluido', v_n));
  end if;

  -- C3 · la RLS sigue aplicandose a traves de la proyeccion. A no es miembro
  -- de G, asi que por la superficie general no alcanza NINGUN efecto de G.
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
  select count(*) into v_n from api.chk_current
   where scope_id = 'a0000000-0000-4000-8000-0000000000f1';
  if v_n <> 0 then
    fallos := array_append(fallos, format('C3: A alcanza %s efectos de G por la superficie general y no es miembro', v_n));
  end if;

  -- C3b · POSITIVO: si alcanza los de sus propios ambitos. Sin esto, C3
  -- pasaria con la proyeccion vacia.
  select count(*) into v_n from api.chk_current;
  if v_n <> 2 then
    fallos := array_append(fallos, format('C3b: A alcanza %s efectos propios (personal + pareja) y deberian ser 2', v_n));
  end if;

  -- C3c · B, miembro de G, si los ve.
  perform set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
  select count(*) into v_n from api.chk_current
   where scope_id = 'a0000000-0000-4000-8000-0000000000f1';
  if v_n <> 4 then
    fallos := array_append(fallos, format('C3d: B, miembro de G, alcanza %s efectos vigentes de G y deberian ser 4', v_n));
  end if;
  reset role;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE LA PROYECCION CANONICA:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · C · proyeccion canonica: solo la version vigente, y la RLS sigue mordiendo';
end
$proyeccion$;

-- ==================== D · atribucion por propiedad del Modo Personal =======
do $ambito$
declare
  fallos text[] := '{}';
  v_n int; r record;
begin
  set local role authenticated;

  -- D1 · el DUENO obtiene el saldo y la economica sin participante de su
  -- Modo Personal, con los importes como TEXTO.
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
  select count(*) into v_n from api.personal_effect;
  if v_n <> 1 then
    fallos := array_append(fallos, format('D1: A obtiene %s filas personales y deberia obtener 1', v_n));
  end if;
  for r in select * from api.personal_effect loop
    if r.balance_amount <> '-2000' or r.economic_amount <> '2000' then
      fallos := array_append(fallos, format('D1b: importes inesperados: saldo=% economica=%', r.balance_amount, r.economic_amount));
    end if;
    if r.effective_date <> date '2025-05-02' then
      fallos := array_append(fallos, 'D1c: la fecha no es la efectiva original');
    end if;
  end loop;

  -- D2 · el saldo del Modo Personal de B NO es de A.
  select count(*) into v_n from api.personal_effect
   where scope_id = 'a0000000-0000-4000-8000-0000000000b1';
  if v_n <> 0 then
    fallos := array_append(fallos, 'D2: A obtiene el saldo del Modo Personal de B');
  end if;

  -- D3 · EL MODO PAREJA NO GENERA ATRIBUCION PERSONAL DE SALDO, aunque A sea
  -- miembro. Invariante 16: al no existir porcentajes de propiedad, ningun
  -- miembro tiene una parte determinable del saldo comun.
  select count(*) into v_n from api.personal_effect
   where scope_id = 'a0000000-0000-4000-8000-0000000000c1';
  if v_n <> 0 then
    fallos := array_append(fallos, 'D3: el saldo del Modo Pareja se atribuyo individualmente');
  end if;

  -- D4 · la MEMBRESIA AJENA no convierte un saldo en propio. A es miembro del
  -- Modo Pareja y no obtiene su saldo; y si fuera miembro del personal de B
  -- tampoco, porque la atribucion mira `owner_user_id`.
  perform set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
  select count(*) into v_n from api.personal_effect;
  if v_n <> 1 then
    fallos := array_append(fallos, format('D4: B obtiene %s filas personales y deberia obtener 1', v_n));
  end if;
  select count(*) into v_n from api.personal_effect
   where scope_id = 'a0000000-0000-4000-8000-0000000000a1';
  if v_n <> 0 then
    fallos := array_append(fallos, 'D4b: B obtiene el saldo del Modo Personal de A');
  end if;

  -- D5 · un tercero sin ambitos no obtiene nada.
  perform set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333"}',true);
  select count(*) into v_n from api.personal_effect;
  if v_n <> 0 then
    fallos := array_append(fallos, format('D5: C obtiene %s filas personales sin tener Modo Personal', v_n));
  end if;

  -- D6 · sin identidad, nada.
  perform set_config('request.jwt.claims','',true);
  select count(*) into v_n from api.personal_effect;
  if v_n <> 0 then
    fallos := array_append(fallos, format('D6: sin JWT se obtienen %s filas personales', v_n));
  end if;
  reset role;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE ATRIBUCION POR AMBITO:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · D · el saldo es del DUENO del Modo Personal, nunca del miembro ni del Modo Pareja';
end
$ambito$;

-- ============================ E · claim retroactivo por participante =======
do $claim$
declare
  fallos text[] := '{}';
  v_n int; v_eco text; v_deudor text; v_acreedor text; r record;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);

  -- E1 · A recupera exactamente TRES dimensiones, sin ser miembro de G.
  select count(*) into v_n from api.claimed_dimension();
  if v_n <> 3 then
    fallos := array_append(fallos, format('E1: A recupera %s dimensiones y deberian ser 3', v_n));
  end if;

  -- E2 · la economica de PA, de la version VIGENTE.
  select amount into v_eco from api.claimed_dimension() where dimension = 'economic';
  if v_eco is distinct from '3000' then
    fallos := array_append(fallos, format('E2: la economica reclamada es % y deberia ser 3000 (la de V2, no la de V1)', coalesce(v_eco,'NULA')));
  end if;

  -- E2b · la de V1 (5000) NO aparece: la proyeccion canonica ya la excluyo.
  if exists (select 1 from api.claimed_dimension() where amount = '5000') then
    fallos := array_append(fallos, 'E2c: aparece el importe de la version SUPERADA');
  end if;

  -- E3 · deuda como DEUDOR, en negativo.
  select amount into v_deudor from api.claimed_dimension()
   where dimension = 'debt' and amount like '-%';
  if v_deudor is distinct from '-3000' then
    fallos := array_append(fallos, format('E3: la deuda como deudor es % y deberia ser -3000', coalesce(v_deudor,'NULA')));
  end if;

  -- E4 · deuda como ACREEDOR, en positivo.
  select amount into v_acreedor from api.claimed_dimension()
   where dimension = 'debt' and amount not like '-%';
  if v_acreedor is distinct from '1000' then
    fallos := array_append(fallos, format('E4: la deuda como acreedor es % y deberia ser 1000', coalesce(v_acreedor,'NULA')));
  end if;

  -- E5 · FECHAS ORIGINALES, pese a que el vinculo se creo hoy.
  for r in select * from api.claimed_dimension() loop
    if r.effective_date <> date '2025-03-10' then
      fallos := array_append(fallos, format('E5: fecha % en vez de la efectiva original 2025-03-10', r.effective_date));
    end if;
  end loop;

  -- E5b · y el vinculo es POSTERIOR a esas fechas: `linked_at` no filtra.
  select count(*) into v_n from api.claimed_dimension();
  reset role;
  if (select min(linked_at)::date from core.participant_user_link) <= date '2025-03-10' then
    fallos := array_append(fallos, 'E5c: el fixture no prueba nada: el vinculo no es posterior a la fecha efectiva');
  end if;
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);

  -- E6 · NO FUGA EN LA FILA MIXTA. A es solo el deudor de E1, cuya economica
  -- es de PB por 3000. A obtiene UNA sola economica —la suya, de E2— y no dos.
  select count(*) into v_n from api.claimed_dimension() where dimension = 'economic';
  if v_n <> 1 then
    fallos := array_append(fallos, format('E6: A obtiene %s dimensiones economicas y solo una es suya; la fila mixta esta filtrando la ajena', v_n));
  end if;

  -- E7 · la deuda entre TERCEROS (PB->PC, 500) no aparece.
  if exists (select 1 from api.claimed_dimension() where amount in ('500','-500')) then
    fallos := array_append(fallos, 'E7: A obtiene una deuda entre terceros');
  end if;

  -- E9 · y A SIGUE sin alcanzar ningun efecto de G por la superficie general.
  select count(*) into v_n from api.chk_current
   where scope_id = 'a0000000-0000-4000-8000-0000000000f1';
  if v_n <> 0 then
    fallos := array_append(fallos, format('E9: tras usar la frontera, A alcanza %s efectos de G por la superficie general', v_n));
  end if;

  -- E10 · B, miembro normal, conserva su visibilidad general Y obtiene sus
  -- propias dimensiones reclamadas.
  perform set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
  select count(*) into v_n from api.chk_current
   where scope_id = 'a0000000-0000-4000-8000-0000000000f1';
  if v_n <> 4 then
    fallos := array_append(fallos, format('E10: B alcanza %s efectos vigentes de G y deberian ser 4', v_n));
  end if;
  select count(*) into v_n from api.claimed_dimension();
  if v_n <> 3 then
    fallos := array_append(fallos, format('E10b: B recupera %s dimensiones y deberian ser 3 (economica, acreedor de PA, deudor de PC)', v_n));
  end if;

  -- E11 · sin JWT, cero filas. Falla cerrado.
  perform set_config('request.jwt.claims','',true);
  select count(*) into v_n from api.claimed_dimension();
  if v_n <> 0 then
    fallos := array_append(fallos, format('E11: sin JWT la frontera devuelve %s filas', v_n));
  end if;

  -- E12 · con un sub que no es de nadie, cero filas.
  perform set_config('request.jwt.claims','{"sub":"99999999-9999-4999-8999-999999999999"}',true);
  select count(*) into v_n from api.claimed_dimension();
  if v_n <> 0 then
    fallos := array_append(fallos, format('E12: un usuario sin vinculos obtiene %s filas', v_n));
  end if;
  reset role;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DEL CLAIM RETROACTIVO:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · E · claim retroactivo sin membresia, con fechas originales y sin fuga en la fila mixta';
end
$claim$;

-- ============================ F · las dos rutas son disjuntas ==============
-- No hay doble contabilizacion, y no por convencion: por construccion. La ruta
-- de ambito solo toma dimensiones que NO nombran participante; la de claim solo
-- toma las que SI lo nombran.
do $disjuntas$
declare
  fallos text[] := '{}';
  v_n int;
begin
  -- F1 · ninguna fila de la ruta de ambito lleva economica con participante.
  select count(*) into v_n
  from core.current_effect e
  join core.scope s on s.id = e.scope_id
  where s.kind = 'personal'
    and e.economic_amount is not null
    and e.economic_participant_id is not null;
  if v_n <> 0 then
    fallos := array_append(fallos, format('F1: hay %s efectos economicos CON participante en un Modo Personal: las dos rutas dejarian de ser disjuntas', v_n));
  end if;

  -- F2 · ninguna dimension de saldo nombra participante. Es estructural: la
  -- tabla no tiene esa columna. Se comprueba en catalogo.
  if exists (select 1 from information_schema.columns
             where table_schema = 'core' and table_name = 'effect'
               and column_name in ('balance_participant_id','balance_owner_id')) then
    fallos := array_append(fallos, 'F2: la dimension de saldo adquirio identidad de participante');
  end if;

  -- F3 · el importe personal de A no se cuenta dos veces. La economica sin
  -- participante de su Modo Personal (2000) sale por la ruta de ambito, y NO
  -- aparece entre las dimensiones reclamadas.
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
  select count(*) into v_n from api.claimed_dimension() where amount = '2000';
  if v_n <> 0 then
    fallos := array_append(fallos, 'F3: la economica del Modo Personal aparece TAMBIEN por la ruta de claim');
  end if;
  select count(*) into v_n from api.personal_effect where economic_amount = '3000';
  if v_n <> 0 then
    fallos := array_append(fallos, 'F3b: la economica del grupo aparece TAMBIEN por la ruta de ambito');
  end if;
  reset role;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE DISYUNCION:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · F · las dos rutas son disjuntas: no hay doble contabilizacion';
end
$disjuntas$;

-- ============================ G · regresiones deliberadas ==================
do $regresion$
declare
  fallos text[] := '{}';
  v_n int; v_ok boolean;
begin
  ------------------------------------------- la propiedad, no la membresia --
  -- Si la atribucion mirase la membresia, A obtendria el saldo del Modo
  -- Personal de B en cuanto se le anadiera como miembro. Se comprueba que NO.
  insert into core.membership (scope_id,user_id)
  values ('a0000000-0000-4000-8000-0000000000b1','11111111-1111-4111-8111-111111111111');

  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
  select count(*) into v_n from api.personal_effect
   where scope_id = 'a0000000-0000-4000-8000-0000000000b1';
  reset role;
  if v_n <> 0 then
    fallos := array_append(fallos, 'G1: hacerse miembro del Modo Personal de otro le atribuyo su saldo: la atribucion esta mirando la membresia');
  end if;
  delete from core.membership
   where scope_id = 'a0000000-0000-4000-8000-0000000000b1'
     and user_id = '11111111-1111-4111-8111-111111111111';

  ----------------------------------------- perder la membresia no borra ----
  -- B pierde la membresia de G. Su historial reclamado debe SEGUIR ahi: es
  -- justo lo que la frontera existe para garantizar.
  delete from core.membership
   where scope_id = 'a0000000-0000-4000-8000-0000000000f1'
     and user_id = '22222222-2222-4222-8222-222222222222';

  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
  select count(*) into v_n from api.claimed_dimension();
  if v_n <> 3 then
    fallos := array_append(fallos, format('G2: tras perder la membresia B recupera %s dimensiones y deberian seguir siendo 3', v_n));
  end if;
  select count(*) into v_n from api.chk_current
   where scope_id = 'a0000000-0000-4000-8000-0000000000f1';
  if v_n <> 0 then
    fallos := array_append(fallos, format('G2b: tras perder la membresia B sigue alcanzando %s efectos de G por la superficie general', v_n));
  end if;
  reset role;
  insert into core.membership (scope_id,user_id)
  values ('a0000000-0000-4000-8000-0000000000f1','22222222-2222-4222-8222-222222222222');

  --------------------------------------------- la vigencia muerde de verdad -
  -- Si el puntero vuelve a V1, la proyeccion debe cambiar de contenido.
  update core.operation set current_version_id = 'd0000000-0000-4000-8000-000000000001'
   where id = 'c0000000-0000-4000-8000-000000000001';
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
  select count(*) into v_n from api.claimed_dimension();
  reset role;
  if v_n <> 1 then
    fallos := array_append(fallos, format('G3: con el puntero en V1, A recupera %s dimensiones y deberia recuperar 1; la proyeccion canonica no esta filtrando por vigencia', v_n));
  end if;
  update core.operation set current_version_id = 'd0000000-0000-4000-8000-000000000002'
   where id = 'c0000000-0000-4000-8000-000000000001';

  ------------------------------------------- el vinculo es lo que atribuye --
  -- Sin vinculo no hay atribucion, aunque el participante siga en la fila.
  delete from core.participant_user_link
   where participant_id = 'b0000000-0000-4000-8000-0000000000aa';
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
  select count(*) into v_n from api.claimed_dimension();
  reset role;
  if v_n <> 0 then
    fallos := array_append(fallos, format('G4: sin vinculo A sigue recuperando %s dimensiones', v_n));
  end if;
  insert into core.participant_user_link (participant_id,scope_id,user_id)
  values ('b0000000-0000-4000-8000-0000000000aa','a0000000-0000-4000-8000-0000000000f1',
          '11111111-1111-4111-8111-111111111111');

  ------------------------------------ la vista de ambito no es una formalidad
  -- Si `personal_effect` mirase la membresia en vez de la propiedad, D2 y D4b
  -- pasarian igual. Se comprueba que la condicion de propiedad esta en el
  -- predicado: sin dueno coincidente, cero filas.
  update core.scope set owner_user_id = '99999999-9999-4999-8999-999999999999'
   where id = 'a0000000-0000-4000-8000-0000000000a1';
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111"}',true);
  select count(*) into v_n from api.personal_effect;
  reset role;
  if v_n <> 0 then
    fallos := array_append(fallos, 'G5: cambiar el dueno no cambio la atribucion; personal_effect no esta mirando owner_user_id');
  end if;
  update core.scope set owner_user_id = '11111111-1111-4111-8111-111111111111'
   where id = 'a0000000-0000-4000-8000-0000000000a1';

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE REGRESION DELIBERADA:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · G · propiedad, vigencia y vinculo son lo que realmente atribuye';
end
$regresion$;

rollback;
