-- Comprobaciones del reparto contextual y de la conversion congelada, contra la
-- base REAL construida por las migraciones.
--
-- Uso, desde Ubuntu y con el stack levantado:
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--     -X -q -v ON_ERROR_STOP=1 < supabase/checks/split-conversion.sql
--
-- Acumula los fallos de cada seccion y termina con excepcion si hubo alguno,
-- para que un unico error no oculte los demas. Todo ocurre dentro de una
-- transaccion que termina en ROLLBACK: no deja datos ni constraints alteradas.

\pset pager off
\set ON_ERROR_STOP on

begin;

-- ===================================== A · forma, privilegios y catalogo ====
do $estructura$
declare
  fallos text[] := '{}';
  v_n int;
begin
  -- A1 · las tres relaciones nuevas existen.
  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'core' and c.relkind = 'r'
    and c.relname in ('split','split_participant','frozen_conversion');
  if v_n <> 3 then
    fallos := array_append(fallos, format('A1: se esperaban 3 relaciones nuevas y hay %s', v_n));
  end if;

  -- A2 · ninguna tabla de core sin RLS. Regla dura, sobre todas.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'core' and c.relkind = 'r' and not c.relrowsecurity
  ) then
    fallos := array_append(fallos, 'A2: hay tablas de core sin RLS activada');
  end if;

  -- A3 · ninguna policy de core aplicable a PUBLIC (ADR-011 §15). Semantico.
  if exists (
    select 1 from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'core' and 0 = any(p.polroles)
  ) then
    fallos := array_append(fallos, 'A3: existe una policy de core aplicable a PUBLIC');
  end if;

  -- A4 · el rol cliente no alcanza ninguna de las tres, ni con grant ni con
  -- policy. La lectura llegara por la superficie `api`, que no existe todavia.
  select count(*) into v_n
  from information_schema.table_privileges
  where table_schema = 'core'
    and table_name in ('split','split_participant','frozen_conversion')
    and grantee in ('anon','authenticated','service_role');
  if v_n <> 0 then
    fallos := array_append(fallos, format('A4: los roles cliente tienen %s privilegios sobre las relaciones nuevas', v_n));
  end if;

  select count(*) into v_n
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_roles r on r.oid = any(p.polroles)
  where n.nspname = 'core'
    and c.relname in ('split','split_participant','frozen_conversion')
    and r.rolname in ('anon','authenticated','service_role');
  if v_n <> 0 then
    fallos := array_append(fallos, format('A4b: hay %s policies de cliente sobre las relaciones nuevas', v_n));
  end if;

  -- A5 · grants EXACTOS del writer: SELECT sobre las tres, y NADA mas.
  --
  -- El `INSERT` que este bloque concedio lo REVOCO 7a, porque ninguna funcion
  -- autoritativa lo ejercia: el principio «cada privilegio corresponde a una
  -- ruta concreta» tambien se aplica hacia atras. `split` y `split_participant`
  -- lo recuperan en 7b con `record_group_expense`; `frozen_conversion` cuando
  -- exista una regla de resolucion de FX (ADR-009 §8).
  select count(*) into v_n
  from information_schema.table_privileges
  where table_schema = 'core'
    and table_name in ('split','split_participant','frozen_conversion')
    and grantee = 'nomey_writer'
    and privilege_type = 'SELECT';
  if v_n <> 3 then
    fallos := array_append(fallos, format('A5: el writer tiene %s de los 3 grants SELECT esperados', v_n));
  end if;

  select count(*) into v_n
  from information_schema.table_privileges
  where table_schema = 'core'
    and table_name in ('split','split_participant','frozen_conversion')
    and grantee = 'nomey_writer'
    and privilege_type <> 'SELECT';
  if v_n <> 0 then
    fallos := array_append(fallos, format('A5b: el writer tiene %s privilegios sin ruta autoritativa que los ejerza', v_n));
  end if;

  -- A5c · y nadie distinto del propietario puede mutarlas (ADR-011 §14).
  select count(*) into v_n
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  where n.nspname = 'core'
    and c.relname in ('split','split_participant','frozen_conversion')
    and a.grantee <> c.relowner
    and a.privilege_type in ('UPDATE','DELETE','TRUNCATE');
  if v_n <> 0 then
    fallos := array_append(fallos, format('A5c: %s roles distintos del propietario pueden mutar el reparto o la conversion', v_n));
  end if;

  -- A6 · la clave que sostiene la FK compuesta triple de la conversion.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'core.operation_version'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (id, effective_date, original_currency_definition_id)'
  ) then
    fallos := array_append(fallos, 'A6: falta el UNIQUE (id, effective_date, original_currency_definition_id) en operation_version');
  end if;

  -- A7 · la FK del pagador es DIFERIBLE. Sin eso la cabecera no puede
  -- insertarse antes que sus filas y la secuencia autoritativa no cierra.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'core.split'::regclass and contype = 'f'
      and conname = 'split_pagador_del_reparto'
      and condeferrable and condeferred
  ) then
    fallos := array_append(fallos, 'A7: la FK del pagador no existe o no es DEFERRABLE INITIALLY DEFERRED');
  end if;

  -- A8 · la regla generica del bloque anterior sigue en pie.
  select count(*) into v_n
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  join pg_roles g on g.oid = a.grantee
  where n.nspname = 'core'
    and c.relkind = 'r'
    and c.relrowsecurity
    and a.privilege_type = 'SELECT'
    and g.rolname in ('anon','authenticated','service_role','nomey_writer')
    and not exists (
      select 1 from pg_policy p
      where p.polrelid = c.oid
        and p.polcmd in ('r','*')
        and (0 = any(p.polroles) or a.grantee = any(p.polroles))
    );
  if v_n <> 0 then
    fallos := array_append(fallos, format('A8: %s GRANT SELECT de core quedan inutilizados por ausencia de policy aplicable', v_n));
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE ESTRUCTURA:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · A · forma, privilegios y catalogo';
end
$estructura$;

-- ================================================================ fixture ===
-- Como `postgres`: propietario y con BYPASSRLS. Las secciones B a E comprueban
-- CONSTRAINTS, no politicas.
insert into core.currency_definition (id, code, scale) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','EUR',2),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','USD',2);

insert into core.scope (id, kind, base_currency_definition_id) values
  ('51000000-0000-4000-8000-000000000000','group','cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  ('52000000-0000-4000-8000-000000000000','group','cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  -- Ambito libre de conversiones: permite que cada negativo de la seccion E
  -- falle por SU constraint y no por la clave primaria de otro caso.
  ('53000000-0000-4000-8000-000000000000','group','cccccccc-cccc-4ccc-8ccc-cccccccccccc');

insert into core.participant (id, scope_id, display_name) values
  ('a1a00000-0000-4000-8000-000000000000','51000000-0000-4000-8000-000000000000','Marta'),
  ('a1b00000-0000-4000-8000-000000000000','51000000-0000-4000-8000-000000000000','Carlos'),
  ('a1c00000-0000-4000-8000-000000000000','51000000-0000-4000-8000-000000000000','Ana'),
  ('a1d00000-0000-4000-8000-000000000000','51000000-0000-4000-8000-000000000000','Libre'),
  ('a2000000-0000-4000-8000-000000000000','52000000-0000-4000-8000-000000000000','Ajeno');

-- OP1, del actor A. Cinco versiones para no tener que reutilizar pares
-- (version, ambito), que son clave primaria en las tres relaciones nuevas.
insert into core.operation (id, operation_class, created_by, current_version_id)
values ('01000000-0000-4000-8000-000000000000','group_expense',
        '11111111-1111-4111-8111-111111111111','0f100000-0000-4000-8000-000000000000');
insert into core.operation_version
  (id, operation_id, version_no, supersedes_version_id, created_by,
   effective_date, original_amount, original_currency_definition_id, economic_rules_version)
values
  ('0f100000-0000-4000-8000-000000000000','01000000-0000-4000-8000-000000000000',1,null,
   '11111111-1111-4111-8111-111111111111', date '2026-01-15', 10000,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','v1'),
  -- 0,01 EUR: es el caso de `data-model.md` §5 con pesos 1·2·2.
  ('0f200000-0000-4000-8000-000000000000','01000000-0000-4000-8000-000000000000',2,'0f100000-0000-4000-8000-000000000000',
   '11111111-1111-4111-8111-111111111111', date '2026-01-15', 1,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','v1'),
  ('0f300000-0000-4000-8000-000000000000','01000000-0000-4000-8000-000000000000',3,'0f200000-0000-4000-8000-000000000000',
   '11111111-1111-4111-8111-111111111111', date '2026-01-15', 10000,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','v1'),
  ('0f400000-0000-4000-8000-000000000000','01000000-0000-4000-8000-000000000000',4,'0f300000-0000-4000-8000-000000000000',
   '11111111-1111-4111-8111-111111111111', date '2026-01-15', 10000,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','v1'),
  ('0f500000-0000-4000-8000-000000000000','01000000-0000-4000-8000-000000000000',5,'0f400000-0000-4000-8000-000000000000',
   '11111111-1111-4111-8111-111111111111', date '2026-01-15', 10000,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','v1');

-- OP2, del actor A, declarada en USD: la que necesita conversion.
insert into core.operation (id, operation_class, created_by, current_version_id)
values ('02000000-0000-4000-8000-000000000000','group_expense',
        '11111111-1111-4111-8111-111111111111','0fa00000-0000-4000-8000-000000000000');
insert into core.operation_version
  (id, operation_id, version_no, supersedes_version_id, created_by,
   effective_date, original_amount, original_currency_definition_id, economic_rules_version)
values ('0fa00000-0000-4000-8000-000000000000','02000000-0000-4000-8000-000000000000',1,null,
        '11111111-1111-4111-8111-111111111111', date '2026-02-01', 10000,'dddddddd-dddd-4ddd-8ddd-dddddddddddd','v1');

-- OP3, del actor B: para la barrera cross-actor del writer.
insert into core.operation (id, operation_class, created_by, current_version_id)
values ('03000000-0000-4000-8000-000000000000','group_expense',
        '22222222-2222-4222-8222-222222222222','0fb00000-0000-4000-8000-000000000000');
insert into core.operation_version
  (id, operation_id, version_no, supersedes_version_id, created_by,
   effective_date, original_amount, original_currency_definition_id, economic_rules_version)
values ('0fb00000-0000-4000-8000-000000000000','03000000-0000-4000-8000-000000000000',1,null,
        '22222222-2222-4222-8222-222222222222', date '2026-03-01', 10000,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','v1');

-- ==================================== B · los tres metodos, en positivo =====
do $metodos$
declare
  fallos text[] := '{}';
  S1 constant uuid := '51000000-0000-4000-8000-000000000000';
  P1 constant uuid := 'a1a00000-0000-4000-8000-000000000000';
  P2 constant uuid := 'a1b00000-0000-4000-8000-000000000000';
  P3 constant uuid := 'a1c00000-0000-4000-8000-000000000000';
  V1 constant uuid := '0f100000-0000-4000-8000-000000000000';
  V2 constant uuid := '0f200000-0000-4000-8000-000000000000';
  V3 constant uuid := '0f300000-0000-4000-8000-000000000000';
  v_n int;
begin
  -- B1 · `equal`. Lo declarado es LA INCLUSION: ni peso ni importe. 100,00
  -- entre tres da 33,34 / 33,33 / 33,33, con el centimo al pagador
  -- (`data-model.md` §5).
  begin
    insert into core.split (operation_version_id, scope_id, split_method, payer_participant_id)
    values (V1, S1, 'equal', P1);
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method, resolved_amount)
    values (V1,S1,P1,0,'equal',3334), (V1,S1,P2,1,'equal',3333), (V1,S1,P3,2,'equal',3333);
  exception when others then
    fallos := array_append(fallos, format('B1: se rechazo un reparto `equal` valido: %s', sqlerrm));
  end;

  -- B2 · `shares` con PESOS ENTEROS, nunca porcentajes. Y es a la vez el caso
  -- del RESUELTO EN CERO: 0,01 con pesos 1·2·2 deja al PAGADOR en 0, porque el
  -- empate por mayor resto se produce entre los otros dos. Sigue siendo valido:
  -- su participacion DECLARADA era positiva (`data-model.md` §5).
  begin
    insert into core.split (operation_version_id, scope_id, split_method, payer_participant_id)
    values (V2, S1, 'shares', P1);
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method,
       declared_weight, resolved_amount)
    values (V2,S1,P1,0,'shares',1,0), (V2,S1,P2,1,'shares',2,1), (V2,S1,P3,2,'shares',2,0);
  exception when others then
    fallos := array_append(fallos, format('B2: se rechazo un reparto `shares` valido con resuelto en cero: %s', sqlerrm));
  end;

  select count(*) into v_n
  from core.split_participant
  where operation_version_id = V2 and resolved_amount = 0;
  if v_n <> 2 then
    fallos := array_append(fallos, format('B2b: se conservaron %s resueltos en cero y deberian ser 2', v_n));
  end if;

  -- B3 · `exact_amounts`: declarado > 0 y declarado = resuelto.
  begin
    insert into core.split (operation_version_id, scope_id, split_method, payer_participant_id)
    values (V3, S1, 'exact_amounts', P1);
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method,
       declared_amount, resolved_amount)
    values (V3,S1,P1,0,'exact_amounts',5000,5000),
           (V3,S1,P2,1,'exact_amounts',3000,3000),
           (V3,S1,P3,2,'exact_amounts',2000,2000);
  exception when others then
    fallos := array_append(fallos, format('B3: se rechazo un reparto `exact_amounts` valido: %s', sqlerrm));
  end;

  -- B4 · el pagador figura entre los participantes: la FK diferible se
  -- satisface al forzarla.
  begin
    set constraints all immediate;
    set constraints all deferred;
  exception when others then
    fallos := array_append(fallos, format('B4: el pagador valido no supero la FK diferible: %s', sqlerrm));
  end;

  -- B5 · un metodo fuera del vocabulario se rechaza.
  begin
    insert into core.split (operation_version_id, scope_id, split_method, payer_participant_id)
    values ('0f400000-0000-4000-8000-000000000000', S1, 'percentage', null);
    fallos := array_append(fallos, 'B5: se acepto un metodo de reparto fuera del vocabulario');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('B5: sqlstate inesperado %s', sqlstate));
  end;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE METODOS:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · B · los tres metodos de reparto, en positivo';
end
$metodos$;

-- =============================== C · invariantes del reparto, en negativo ===
do $reparto_neg$
declare
  fallos text[] := '{}';
  S1 constant uuid := '51000000-0000-4000-8000-000000000000';
  S2 constant uuid := '52000000-0000-4000-8000-000000000000';
  P1 constant uuid := 'a1a00000-0000-4000-8000-000000000000';
  P2 constant uuid := 'a1b00000-0000-4000-8000-000000000000';
  P3 constant uuid := 'a1c00000-0000-4000-8000-000000000000';
  PX constant uuid := 'a2000000-0000-4000-8000-000000000000';
  V2 constant uuid := '0f200000-0000-4000-8000-000000000000';
  V3 constant uuid := '0f300000-0000-4000-8000-000000000000';
  V4 constant uuid := '0f400000-0000-4000-8000-000000000000';
  V5 constant uuid := '0f500000-0000-4000-8000-000000000000';
begin
  -- Cabecera de trabajo para las filas negativas.
  insert into core.split (operation_version_id, scope_id, split_method, payer_participant_id)
  values (V5, S1, 'equal', null);

  -- C1 · un participante de OTRO ambito. Es lo que hace estructural que el
  -- participante sea contextual (ADR-012 §1).
  begin
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method, resolved_amount)
    values (V5,S1,PX,10,'equal',0);
    fallos := array_append(fallos, 'C1: se acepto un participante de otro ambito en el reparto');
  exception when foreign_key_violation then null;
    when others then fallos := array_append(fallos, format('C1: sqlstate inesperado %s', sqlstate));
  end;

  -- C2 · el metodo de la fila no puede divergir del de su cabecera. Se aporta
  -- el peso para que lo que falle sea la FK y no el CHECK.
  begin
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method,
       declared_weight, resolved_amount)
    values (V5,S1,P1,11,'shares',1,0);
    fallos := array_append(fallos, 'C2: se acepto una fila cuyo metodo diverge del de su cabecera');
  exception when foreign_key_violation then null;
    when others then fallos := array_append(fallos, format('C2: sqlstate inesperado %s', sqlstate));
  end;

  -- C3 · un participante, una sola vez por reparto. La fila es valida en todo
  -- lo demas —declarado positivo y coincidente con el resuelto— para que lo que
  -- falle sea la clave primaria y no otro CHECK.
  begin
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method,
       declared_amount, resolved_amount)
    values (V3,S1,P1,90,'exact_amounts',1000,1000);
    fallos := array_append(fallos, 'C3: se acepto un participante duplicado en el mismo reparto');
  exception when unique_violation then null;
    when others then fallos := array_append(fallos, format('C3: sqlstate inesperado %s', sqlstate));
  end;

  -- C4 · ordinal unico dentro del reparto. Es el orden estable del desempate:
  -- dos filas con el mismo ordinal harian ambiguo a quien va el centimo.
  begin
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method, resolved_amount)
    values (V5,S1,P2,0,'equal',0);
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method, resolved_amount)
    values (V5,S1,P3,0,'equal',0);
    fallos := array_append(fallos, 'C4: se acepto un ordinal duplicado dentro del reparto');
  exception when unique_violation then null;
    when others then fallos := array_append(fallos, format('C4: sqlstate inesperado %s', sqlstate));
  end;

  -- C5 · ordinal negativo.
  begin
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method, resolved_amount)
    values (V5,S1,P3,-1,'equal',0);
    fallos := array_append(fallos, 'C5: se acepto un ordinal negativo');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('C5: sqlstate inesperado %s', sqlstate));
  end;

  -- C6 · `shares` sin peso.
  begin
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method, resolved_amount)
    values (V2,S1,PX,20,'shares',0);
    fallos := array_append(fallos, 'C6: se acepto una fila `shares` sin peso declarado');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('C6: sqlstate inesperado %s', sqlstate));
  end;

  -- C7 · peso cero. La positividad recae sobre LO DECLARADO.
  begin
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method,
       declared_weight, resolved_amount)
    values (V2,S1,PX,21,'shares',0,0);
    fallos := array_append(fallos, 'C7: se acepto un peso declarado de cero');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('C7: sqlstate inesperado %s', sqlstate));
  end;

  -- C8 · `exact_amounts` sin importe declarado.
  begin
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method, resolved_amount)
    values (V3,S1,PX,30,'exact_amounts',0);
    fallos := array_append(fallos, 'C8: se acepto una fila `exact_amounts` sin importe declarado');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('C8: sqlstate inesperado %s', sqlstate));
  end;

  -- C9 · importe declarado de cero. Quien declara 0 NO es participante de esa
  -- operacion: no es una fila con cero, es una fila que no existe.
  begin
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method,
       declared_amount, resolved_amount)
    values (V3,S1,PX,31,'exact_amounts',0,0);
    fallos := array_append(fallos, 'C9: se acepto un importe declarado de cero en `exact_amounts`');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('C9: sqlstate inesperado %s', sqlstate));
  end;

  -- C10 · `exact_amounts` con declarado DISTINTO del resuelto. Es un invariante
  -- LOCAL —el dominio devuelve los declarados tal cual— y por eso no se reserva
  -- al writer.
  begin
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method,
       declared_amount, resolved_amount)
    values (V3,S1,PX,32,'exact_amounts',5000,4000);
    fallos := array_append(fallos, 'C10: se acepto `exact_amounts` con declarado distinto del resuelto');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('C10: sqlstate inesperado %s', sqlstate));
  end;

  -- C11 · `equal` con peso o importe declarado.
  begin
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method,
       declared_weight, resolved_amount)
    values (V5,S1,P3,40,'equal',1,0);
    fallos := array_append(fallos, 'C11: se acepto un peso declarado en un reparto `equal`');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('C11: sqlstate inesperado %s', sqlstate));
  end;

  -- C12 · resuelto negativo. ADR-003 T11: el reparto opera sobre magnitud no
  -- negativa; el signo pertenece al efecto.
  begin
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method, resolved_amount)
    values (V5,S1,P3,41,'equal',-1);
    fallos := array_append(fallos, 'C12: se acepto un resuelto negativo');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('C12: sqlstate inesperado %s', sqlstate));
  end;

  -- C13 · una fila sin cabecera.
  begin
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method, resolved_amount)
    values (V4,S2,PX,0,'equal',0);
    fallos := array_append(fallos, 'C13: se acepto una fila de reparto sin cabecera');
  exception when foreign_key_violation then null;
    when others then fallos := array_append(fallos, format('C13: sqlstate inesperado %s', sqlstate));
  end;

  -- C14 · PAGADOR FUERA DEL REPARTO. La FK es diferible, asi que no falla al
  -- insertar: falla al forzarla, que es lo que ocurriria al hacer commit.
  begin
    insert into core.split (operation_version_id, scope_id, split_method, payer_participant_id)
    values (V4, S1, 'equal', P1);
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method, resolved_amount)
    values (V4,S1,P2,0,'equal',5000), (V4,S1,P3,1,'equal',5000);
    set constraints all immediate;
    fallos := array_append(fallos, 'C14: se acepto un pagador que no figura entre los participantes');
  exception when foreign_key_violation then null;
    when others then fallos := array_append(fallos, format('C14: sqlstate inesperado %s', sqlstate));
  end;
  set constraints all deferred;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE INVARIANTES DEL REPARTO:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · C · invariantes del reparto, en negativo';
end
$reparto_neg$;

-- ======================================== D · la cabecera vacia es posible ==
-- NO ES UNA GARANTIA ESTRUCTURAL, y este check existe para dejarlo escrito.
--
-- «Todo reparto contiene al menos un participante» es un invariante de la
-- FRONTERA AUTORITATIVA. Una cabecera SIN PAGADOR y sin filas es fisicamente
-- insertable: la FK diferible solo muerde cuando hay pagador, y ninguna
-- restriccion declarativa puede exigir la existencia de filas hijas.
--
-- No se anade un trigger para conseguirlo. Se clasifica, igual que ADR-011 §11
-- clasifica «el predecesor es exactamente la version anterior».
do $vacia$
declare
  fallos text[] := '{}';
  S2 constant uuid := '52000000-0000-4000-8000-000000000000';
  V5 constant uuid := '0f500000-0000-4000-8000-000000000000';
  v_n int;
begin
  begin
    insert into core.split (operation_version_id, scope_id, split_method, payer_participant_id)
    values (V5, S2, 'equal', null);
    set constraints all immediate;
    set constraints all deferred;
  exception when others then
    fallos := array_append(fallos,
      format('D1: la cabecera vacia fue rechazada por la base. Si eso es deliberado, la documentacion que la declara NO estructural esta obsoleta: %s', sqlerrm));
  end;

  select count(*) into v_n
  from core.split s
  where s.operation_version_id = V5 and s.scope_id = S2
    and not exists (select 1 from core.split_participant sp
                    where sp.operation_version_id = s.operation_version_id
                      and sp.scope_id = s.scope_id);
  if v_n <> 1 then
    fallos := array_append(fallos, 'D1b: no quedo constancia de la cabecera vacia');
  end if;

  delete from core.split where operation_version_id = V5 and scope_id = S2;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE CARDINALIDAD MINIMA:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · D · la cabecera vacia es posible: el minimo 1..n pertenece a la frontera, no a las tablas';
end
$vacia$;

-- ================================================ E · conversion congelada ==
do $conversion$
declare
  fallos text[] := '{}';
  EUR constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  USD constant uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  S1  constant uuid := '51000000-0000-4000-8000-000000000000';
  S2  constant uuid := '52000000-0000-4000-8000-000000000000';
  S3  constant uuid := '53000000-0000-4000-8000-000000000000';  -- libre de conversiones
  W1  constant uuid := '0fa00000-0000-4000-8000-000000000000';  -- 100 USD, 2026-02-01
  V4  constant uuid := '0f400000-0000-4000-8000-000000000000';  -- EUR, 2026-01-15
  v_n int;
begin
  -- E1 · POSITIVO con ESCALA 12, el ejemplo del propio ADR-003 §4:
  --   0,862034781245  ->  coeficiente 862034781245 , escala 12
  begin
    insert into core.frozen_conversion
      (operation_version_id, scope_id, source_currency_definition_id,
       target_currency_definition_id, rate_coefficient, rate_scale, resolved_for_date)
    values (W1, S1, USD, EUR, 862034781245, 12, date '2026-02-01');
  exception when others then
    fallos := array_append(fallos, format('E1: se rechazo una conversion valida con escala 12: %s', sqlerrm));
  end;

  -- E2 · POSITIVO con ESCALA 0. La cota es un MAXIMO, no una escala fija: una
  -- tasa de otra magnitud usa otra escala, y precision y magnitud dependen de
  -- ambas conjuntamente.
  begin
    insert into core.frozen_conversion
      (operation_version_id, scope_id, source_currency_definition_id,
       target_currency_definition_id, rate_coefficient, rate_scale, resolved_for_date)
    values (W1, S2, USD, EUR, 1, 0, date '2026-02-01');
  exception when others then
    fallos := array_append(fallos, format('E2: se rechazo una conversion valida con escala 0: %s', sqlerrm));
  end;

  -- E3 · la moneda ORIGEN debe ser la del importe original de esa version.
  begin
    insert into core.frozen_conversion
      (operation_version_id, scope_id, source_currency_definition_id,
       target_currency_definition_id, rate_coefficient, rate_scale, resolved_for_date)
    values (V4, S1, USD, EUR, 100, 2, date '2026-01-15');
    fallos := array_append(fallos, 'E3: se acepto una conversion cuyo origen no es la moneda original de la version');
  exception when foreign_key_violation then null;
    when others then fallos := array_append(fallos, format('E3: sqlstate inesperado %s', sqlstate));
  end;

  -- E4 · la moneda DESTINO debe ser la base del ambito.
  begin
    insert into core.frozen_conversion
      (operation_version_id, scope_id, source_currency_definition_id,
       target_currency_definition_id, rate_coefficient, rate_scale, resolved_for_date)
    values (V4, S1, EUR, USD, 100, 2, date '2026-01-15');
    fallos := array_append(fallos, 'E4: se acepto una conversion cuyo destino no es la moneda base del ambito');
  exception when foreign_key_violation then null;
    when others then fallos := array_append(fallos, format('E4: sqlstate inesperado %s', sqlstate));
  end;

  -- E5 · la FECHA debe coincidir con la fecha efectiva de su version. ADR-013
  -- §6 llama a lo contrario «representacionalmente imposible»; aqui lo es.
  begin
    insert into core.frozen_conversion
      (operation_version_id, scope_id, source_currency_definition_id,
       target_currency_definition_id, rate_coefficient, rate_scale, resolved_for_date)
    values (W1, S3, USD, EUR, 100, 2, date '2026-02-02');
    fallos := array_append(fallos, 'E5: se acepto una conversion resuelta para una fecha distinta de la efectiva');
  exception when foreign_key_violation then null;
    when others then fallos := array_append(fallos, format('E5: sqlstate inesperado %s', sqlstate));
  end;

  -- E6 · convertir una moneda a si misma no es una conversion.
  begin
    insert into core.frozen_conversion
      (operation_version_id, scope_id, source_currency_definition_id,
       target_currency_definition_id, rate_coefficient, rate_scale, resolved_for_date)
    values (V4, S1, EUR, EUR, 100, 2, date '2026-01-15');
    fallos := array_append(fallos, 'E6: se acepto una conversion de una moneda a si misma');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('E6: sqlstate inesperado %s', sqlstate));
  end;

  -- E7 · coeficiente cero y negativo.
  begin
    insert into core.frozen_conversion
      (operation_version_id, scope_id, source_currency_definition_id,
       target_currency_definition_id, rate_coefficient, rate_scale, resolved_for_date)
    values (W1, S3, USD, EUR, 0, 2, date '2026-02-01');
    fallos := array_append(fallos, 'E7: se acepto un coeficiente de cero');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('E7: sqlstate inesperado %s', sqlstate));
  end;
  begin
    insert into core.frozen_conversion
      (operation_version_id, scope_id, source_currency_definition_id,
       target_currency_definition_id, rate_coefficient, rate_scale, resolved_for_date)
    values (W1, S3, USD, EUR, -1, 2, date '2026-02-01');
    fallos := array_append(fallos, 'E7b: se acepto un coeficiente negativo');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('E7b: sqlstate inesperado %s', sqlstate));
  end;

  -- E8 · los limites de la cota: -1 y 13 fuera, 0 y 12 dentro (E1 y E2).
  begin
    insert into core.frozen_conversion
      (operation_version_id, scope_id, source_currency_definition_id,
       target_currency_definition_id, rate_coefficient, rate_scale, resolved_for_date)
    values (W1, S3, USD, EUR, 100, -1, date '2026-02-01');
    fallos := array_append(fallos, 'E8: se acepto una escala de -1');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('E8: sqlstate inesperado %s', sqlstate));
  end;
  begin
    insert into core.frozen_conversion
      (operation_version_id, scope_id, source_currency_definition_id,
       target_currency_definition_id, rate_coefficient, rate_scale, resolved_for_date)
    values (W1, S3, USD, EUR, 100, 13, date '2026-02-01');
    fallos := array_append(fallos, 'E8b: se acepto una escala de 13');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('E8b: sqlstate inesperado %s', sqlstate));
  end;

  -- E9 · una sola conversion por (version, ambito).
  begin
    insert into core.frozen_conversion
      (operation_version_id, scope_id, source_currency_definition_id,
       target_currency_definition_id, rate_coefficient, rate_scale, resolved_for_date)
    values (W1, S1, USD, EUR, 900000000000, 12, date '2026-02-01');
    fallos := array_append(fallos, 'E9: se aceptaron dos conversiones para el mismo par (version, ambito)');
  exception when unique_violation then null;
    when others then fallos := array_append(fallos, format('E9: sqlstate inesperado %s', sqlstate));
  end;

  -- E10 · el importe convertido NO se persiste: no hay columna donde ponerlo.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'core' and table_name = 'frozen_conversion'
      and column_name in ('converted_amount','target_amount','amount',
                          'provider','provider_id','source_name','provenance')
  ) then
    fallos := array_append(fallos, 'E10: frozen_conversion tiene columnas de importe convertido o de procedencia');
  end if;

  select count(*) into v_n from core.frozen_conversion;
  if v_n <> 2 then
    fallos := array_append(fallos, format('E11: quedaron %s conversiones y deberian ser 2', v_n));
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE CONVERSION:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · E · conversion congelada: origen, destino, fecha y cota de escala';
end
$conversion$;

-- ===================================================== F · el writer ========
do $writer$
declare
  fallos text[] := '{}';
  A constant text := '11111111-1111-4111-8111-111111111111';
  B constant text := '22222222-2222-4222-8222-222222222222';
  EUR constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  S2  constant uuid := '52000000-0000-4000-8000-000000000000';
  PX  constant uuid := 'a2000000-0000-4000-8000-000000000000';
  V4  constant uuid := '0f400000-0000-4000-8000-000000000000';  -- de A
  U1  constant uuid := '0fb00000-0000-4000-8000-000000000000';  -- de B
  v_n int;
begin
  set local role nomey_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', A)::text, true);

  -- F1 · EL WRITER NO PUEDE ESCRIBIR ESTAS TRES. 7a revoco el `INSERT` porque
  -- ninguna funcion autoritativa lo ejercia; `split` y `split_participant` lo
  -- recuperan en 7b, y `frozen_conversion` cuando exista la regla de FX.
  --
  -- Lo que lo impide es la AUSENCIA DE GRANT, no una policy: por eso el
  -- sqlstate es 42501 y no una fila rechazada en silencio.
  begin
    insert into core.split (operation_version_id, scope_id, split_method, payer_participant_id)
    values (V4, S2, 'equal', PX);
    fallos := array_append(fallos, 'F1: el writer inserto una cabecera de reparto sin ruta autoritativa que lo justifique');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('F1: sqlstate inesperado %s', sqlstate));
  end;

  begin
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method, resolved_amount)
    values (V4, S2, PX, 0, 'equal', 10000);
    fallos := array_append(fallos, 'F1b: el writer inserto una fila de reparto');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('F1b: sqlstate inesperado %s', sqlstate));
  end;

  begin
    insert into core.frozen_conversion
      (operation_version_id, scope_id, source_currency_definition_id,
       target_currency_definition_id, rate_coefficient, rate_scale, resolved_for_date)
    values (V4, S2, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', EUR, 1, 0, date '2026-01-15');
    fallos := array_append(fallos, 'F1c: el writer congelo una conversion sin regla de FX que la resuelva');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('F1c: sqlstate inesperado %s', sqlstate));
  end;

  -- F2 · pero las policies de INSERT siguen INTACTAS: son decisiones razonadas
  -- de ADR-013 §10 y volveran a hacer falta sin cambios.
  select count(*) into v_n
  from pg_policy p join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'core'
    and c.relname in ('split','split_participant','frozen_conversion')
    and p.polcmd = 'a';
  if v_n <> 3 then
    fallos := array_append(fallos, format('F2: quedan %s policies de INSERT de las 3 que deben conservarse', v_n));
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', B)::text, true);

  -- F3 · pero B SI puede LEER el reparto y la conversion de A. Sin esa lectura
  -- no puede construir V2: el reparto anterior cuelga de (version, ambito) y el
  -- FX congelado se hereda. E20 midio que la lectura estrecha devuelve NULL sin
  -- error, y la frontera concluiria que no hay predecesor.
  select count(*) into v_n from core.split;
  if v_n < 3 then
    fallos := array_append(fallos, format('F3: el writer solo alcanza %s cabeceras; no puede construir una correccion', v_n));
  end if;
  select count(*) into v_n from core.split_participant;
  if v_n < 8 then
    fallos := array_append(fallos, format('F3b: el writer solo alcanza %s filas de reparto', v_n));
  end if;
  select count(*) into v_n from core.frozen_conversion;
  if v_n < 2 then
    fallos := array_append(fallos, format('F3c: el writer solo alcanza %s conversiones; no puede heredar el FX', v_n));
  end if;

  -- F4 · sin UPDATE ni DELETE (ADR-011 §14). Lo impide el privilegio ausente.
  begin
    update core.split_participant set resolved_amount = 0;
    fallos := array_append(fallos, 'F4: el writer actualizo una fila de reparto');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('F4: sqlstate inesperado %s', sqlstate));
  end;
  begin
    delete from core.frozen_conversion;
    fallos := array_append(fallos, 'F4b: el writer borro una conversion congelada');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('F4b: sqlstate inesperado %s', sqlstate));
  end;
  begin
    update core.frozen_conversion set rate_coefficient = 1;
    fallos := array_append(fallos, 'F4c: el writer revalorizo una conversion congelada');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('F4c: sqlstate inesperado %s', sqlstate));
  end;

  -- F5 · sin identidad en la peticion, el WITH CHECK falla cerrado.
  perform set_config('request.jwt.claims', '', true);
  begin
    insert into core.split (operation_version_id, scope_id, split_method, payer_participant_id)
    values (U1, S2, 'equal', null);
    fallos := array_append(fallos, 'F5: se acepto un reparto sin identidad en la peticion');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('F5: sqlstate %s en vez de 42501', sqlstate));
  end;

  reset role;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DEL WRITER:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · F · el writer lee lo ajeno, no muta nada, y ya no puede escribir lo que 7a revoco';
end
$writer$;

-- ============================ G · regresiones deliberadas ===================
-- La suite debe poder fallar. Se relajan a proposito las garantias de este
-- bloque y se comprueba que la violacion OCURRE: si no ocurriera, las
-- aserciones anteriores estarian pasando por casualidad.
do $regresion$
declare
  fallos text[] := '{}';
  EUR constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  USD constant uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  S1  constant uuid := '51000000-0000-4000-8000-000000000000';
  PX  constant uuid := 'a2000000-0000-4000-8000-000000000000';
  P4  constant uuid := 'a1d00000-0000-4000-8000-000000000000';  -- de S1, sin reparto
  V3  constant uuid := '0f300000-0000-4000-8000-000000000000';
  V5  constant uuid := '0f500000-0000-4000-8000-000000000000';
  W1  constant uuid := '0fa00000-0000-4000-8000-000000000000';
  S2  constant uuid := '52000000-0000-4000-8000-000000000000';
  v_ok boolean;
begin
  --------------------------------- exact_amounts: declarado = resuelto -------
  set constraints all immediate;
  alter table core.split_participant drop constraint split_participant_exactos_coinciden;
  v_ok := false;
  begin
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method,
       declared_amount, resolved_amount)
    values (V3,S1,P4,80,'exact_amounts',5000,4000);
    v_ok := true;
  exception when others then null;
  end;
  if not v_ok then
    fallos := array_append(fallos,
      'G1: sin el check, `exact_amounts` con declarado distinto del resuelto SIGUE rechazandose; C10 no estaba probando ese check');
  end if;
  delete from core.split_participant
   where operation_version_id = V3 and scope_id = S1 and participant_id = P4;
  set constraints all immediate;
  alter table core.split_participant
    add constraint split_participant_exactos_coinciden
    check (split_method <> 'exact_amounts' or resolved_amount = declared_amount);

  ------------------------------------ participante del ambito del reparto ----
  set constraints all immediate;
  alter table core.split_participant drop constraint split_participant_del_ambito;
  v_ok := false;
  begin
    insert into core.split_participant
      (operation_version_id, scope_id, participant_id, ordinal, split_method, resolved_amount)
    values (V5,S1,PX,81,'equal',0);
    v_ok := true;
  exception when others then null;
  end;
  if not v_ok then
    fallos := array_append(fallos,
      'G2: sin la FK compuesta, un participante de otro ambito SIGUE rechazandose; C1 no estaba probando esa FK');
  end if;
  delete from core.split_participant
   where operation_version_id = V5 and scope_id = S1 and participant_id = PX;
  set constraints all immediate;
  alter table core.split_participant
    add constraint split_participant_del_ambito
    foreign key (participant_id, scope_id) references core.participant (id, scope_id);

  --------------------------------------- origen y fecha de la conversion -----
  set constraints all immediate;
  alter table core.frozen_conversion
    drop constraint frozen_conversion_origen_y_fecha_de_la_version;
  v_ok := false;
  begin
    insert into core.frozen_conversion
      (operation_version_id, scope_id, source_currency_definition_id,
       target_currency_definition_id, rate_coefficient, rate_scale, resolved_for_date)
    values (V5, S1, USD, EUR, 100, 2, date '2029-12-31');
    v_ok := true;
  exception when others then null;
  end;
  if not v_ok then
    fallos := array_append(fallos,
      'G3: sin la FK triple, una conversion con fecha y origen ajenos a su version SIGUE rechazandose; E3 y E5 no probaban esa FK');
  end if;
  delete from core.frozen_conversion where operation_version_id = V5 and scope_id = S1;
  set constraints all immediate;
  alter table core.frozen_conversion
    add constraint frozen_conversion_origen_y_fecha_de_la_version
    foreign key (operation_version_id, resolved_for_date, source_currency_definition_id)
    references core.operation_version (id, effective_date, original_currency_definition_id);

  ------------------------------------------------ cota de la escala ---------
  set constraints all immediate;
  alter table core.frozen_conversion drop constraint frozen_conversion_escala_acotada;
  v_ok := false;
  begin
    delete from core.frozen_conversion where operation_version_id = W1 and scope_id = S2;
    insert into core.frozen_conversion
      (operation_version_id, scope_id, source_currency_definition_id,
       target_currency_definition_id, rate_coefficient, rate_scale, resolved_for_date)
    values (W1, S2, USD, EUR, 100, 13, date '2026-02-01');
    v_ok := true;
  exception when others then null;
  end;
  if not v_ok then
    fallos := array_append(fallos,
      'G4: sin el check la escala 13 SIGUE rechazandose; E8b no estaba probando la cota');
  end if;
  delete from core.frozen_conversion where operation_version_id = W1 and scope_id = S2;
  set constraints all immediate;
  alter table core.frozen_conversion
    add constraint frozen_conversion_escala_acotada check (rate_scale between 0 and 12);

  ------------------------------------------------ pagador del reparto -------
  set constraints all immediate;
  alter table core.split drop constraint split_pagador_del_reparto;
  v_ok := false;
  begin
    update core.split set payer_participant_id = PX
     where operation_version_id = V5 and scope_id = S1;
    set constraints all immediate;
    set constraints all deferred;
    v_ok := true;
  exception when others then null;
  end;
  if not v_ok then
    fallos := array_append(fallos,
      'G5: sin la FK diferible un pagador ajeno al reparto SIGUE rechazandose; C14 no estaba probando esa FK');
  end if;
  update core.split set payer_participant_id = null
   where operation_version_id = V5 and scope_id = S1;
  set constraints all immediate;
  alter table core.split
    add constraint split_pagador_del_reparto
    foreign key (operation_version_id, scope_id, payer_participant_id)
    references core.split_participant (operation_version_id, scope_id, participant_id)
    deferrable initially deferred;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE REGRESION DELIBERADA:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · G · las garantias fallan cuando se relajan a proposito';
end
$regresion$;

rollback;
