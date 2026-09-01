-- Comprobaciones de la anatomia del movimiento · F6.B.
--
-- Uso, con el stack levantado:
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--     -X -q -v ON_ERROR_STOP=1 < supabase/checks/movement-anatomy.sql
--
-- Acumula los fallos de cada seccion y termina con excepcion si hubo alguno.
-- Todo ocurre dentro de una transaccion que termina en ROLLBACK.
--
-- No repite lo que ya vigilan otros ficheros: la paridad con los vectores del
-- ingreso la miden `authoritative-writer.sql` G y `authoritative-writer-debt.sql`
-- J, contra `tests/vectors/scenarios.json`.

\pset pager off
\set ON_ERROR_STOP on

begin;

-- Identidades y ambitos. Se siembran como `postgres`, igual que el resto de
-- checks; lo que aqui debe ser real es la llamada del cliente y la RLS.
create temporary table ma_fix (k text primary key, v text) on commit drop;
insert into ma_fix (k, v) values
  ('U1',  'b1111111-1111-4111-8111-111111111111'),
  ('U2',  'b2222222-2222-4222-8222-222222222222'),
  ('S1',  'c0000000-0000-4000-8000-000000000001'),
  ('S2',  'c0000000-0000-4000-8000-000000000002'),
  ('EUR', '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'),
  ('GOTR','4ed30a44-9f82-578f-828c-b491a25ebdd9'),   -- Otros, gasto
  ('GALI','80088454-77aa-51ae-864e-523ca74d66eb'),   -- Alimentacion, gasto
  ('IOTR','ea9f1167-f497-5edf-af01-c7e1c3a64d9d'),   -- Otros, ingreso
  ('INOM','a04cc703-9316-52a0-83f3-9b82933c6702');   -- Nomina, ingreso

insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
select (select v from ma_fix where k='S1')::uuid, 'personal',
       (select v from ma_fix where k='EUR')::uuid, (select v from ma_fix where k='U1')::uuid;
insert into core.scope (id, kind, base_currency_definition_id, owner_user_id)
select (select v from ma_fix where k='S2')::uuid, 'personal',
       (select v from ma_fix where k='EUR')::uuid, (select v from ma_fix where k='U2')::uuid;
insert into core.membership (scope_id, user_id)
select (select v from ma_fix where k='S1')::uuid, (select v from ma_fix where k='U1')::uuid;
insert into core.membership (scope_id, user_id)
select (select v from ma_fix where k='S2')::uuid, (select v from ma_fix where k='U2')::uuid;

-- ==================== A · estructura, catalogo y superficie ================
do $a$
declare
  fallos text[] := '{}';
  v_n int; v_t text;
begin
  -- A1 · la hora vive en la version y es ANULABLE. Que lo sea es la decision:
  -- NOT NULL habria obligado a las seis clases restantes a inventarse una hora.
  select count(*) into v_n from information_schema.columns
   where table_schema='core' and table_name='operation_version'
     and column_name='effective_time' and data_type='time without time zone'
     and is_nullable='YES';
  if v_n <> 1 then
    fallos := array_append(fallos, 'A1: operation_version.effective_time no es un `time` sin zona y anulable');
  end if;

  -- A1b · y `effective_date` NO se ha tocado: sigue siendo `date` y NOT NULL.
  if not exists (select 1 from information_schema.columns
                  where table_schema='core' and table_name='operation_version'
                    and column_name='effective_date' and data_type='date' and is_nullable='NO') then
    fallos := array_append(fallos, 'A1c: effective_date dejo de ser un date NOT NULL');
  end if;

  -- A1d · `core.participant_period` sigue en grano `date`. Es la autoridad de
  -- elegibilidad y F6.B se comprometio a no convertirla a timestamp.
  if exists (select 1 from information_schema.columns
              where table_schema='core' and table_name='participant_period'
                and column_name in ('valid_from','valid_until') and data_type <> 'date') then
    fallos := array_append(fallos, 'A1e: participant_period dejo de ser de grano date');
  end if;

  -- A2 · concepto y categoria NO estan en la version: viven en su relacion.
  if exists (select 1 from information_schema.columns
              where table_schema='core' and table_name='operation_version'
                and column_name in ('concept','category_id')) then
    fallos := array_append(fallos,
      'A2: concepto o categoria se colaron como columnas de operation_version, donde su obligacion no se puede expresar');
  end if;

  -- A3 · las dos columnas del detalle son NOT NULL, que es lo que la relacion
  -- separada hace posible.
  select count(*) into v_n from information_schema.columns
   where table_schema='core' and table_name='movement_detail'
     and column_name = 'concept' and is_nullable='NO';
  if v_n <> 1 then
    fallos := array_append(fallos, 'A3: el concepto dejo de ser NOT NULL');
  end if;

  -- A3b · Y LA CATEGORIA VIVE APARTE, tambien NOT NULL (ADR-027). Ese NOT NULL
  -- es lo que hace IMPOSIBLE un gasto sin categorizar: no hay nulo que poner.
  select count(*) into v_n from information_schema.columns
   where table_schema='core' and table_name='expense_category'
     and column_name = 'category_id' and is_nullable='NO';
  if v_n <> 1 then
    fallos := array_append(fallos, 'A3b: core.expense_category no exige categoria');
  end if;

  -- A3c · y `movement_detail` YA NO la lleva: si volviera, volveria el nulo.
  if exists (select 1 from information_schema.columns
              where table_schema='core' and table_name='movement_detail'
                and column_name in ('category_id','applies_to')) then
    fallos := array_append(fallos, 'A3c: movement_detail recupero la categoria o la familia');
  end if;

  -- A4 · el catalogo OFICIAL: diez activas, y quince filas en total porque las
  -- cinco retiradas siguen ahi. ADR-021 prohibe el DELETE incluso sin
  -- historico, asi que retirar es dar de baja.
  select count(*) into v_n from core.category where owner_user_id is null;
  if v_n <> 15 then
    fallos := array_append(fallos, format('A4: hay %s filas de sistema y deberian seguir siendo 15', v_n));
  end if;
  select count(*) into v_n from core.category where owner_user_id is null and is_active;
  if v_n <> 10 then
    fallos := array_append(fallos, format('A4b: hay %s categorias activas y deberian ser 10', v_n));
  end if;

  -- A4c · las cinco retiradas, una por una, INACTIVAS Y PRESENTES.
  for v_t in select unnest(array['category.expense.utilities','category.expense.education',
                                 'category.income.salary','category.income.extra',
                                 'category.income.other'])
  loop
    if not exists (select 1 from core.category where message_key = v_t and not is_active) then
      fallos := array_append(fallos, format('A4c: %s no esta retirada o desaparecio', v_t));
    end if;
  end loop;

  -- A5 · `Otros` de gasto es una categoria REAL y sigue ACTIVA. Es lo que
  -- permite que la categoria sea NOT NULL sin que exista el caso nulo.
  if not exists (select 1 from core.category
                  where owner_user_id is null and is_active
                    and message_key = 'category.expense.other') then
    fallos := array_append(fallos, 'A5: falta la categoria Otros de gasto, o esta retirada');
  end if;

  -- A6 · LA FAMILIA DESAPARECIO. Todas las categorias son de gasto, asi que una
  -- columna constante no aportaba nada (ADR-027).
  if exists (select 1 from information_schema.columns
              where table_schema='core' and table_name='category'
                and column_name='applies_to') then
    fallos := array_append(fallos, 'A6: core.category conserva la familia');
  end if;

  -- A7 · la vista existe, es security_invoker y no proyecta identidad.
  if to_regclass('api.category') is null then
    fallos := array_append(fallos, 'A7: no existe api.category');
  elsif not coalesce((select option_value = 'true'
                        from pg_options_to_table((select reloptions from pg_class where oid='api.category'::regclass))
                       where option_name='security_invoker'), false) then
    fallos := array_append(fallos, 'A7b: api.category NO es security_invoker');
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema='api' and table_name='category' and column_name='owner_user_id') then
    fallos := array_append(fallos, 'A7c: api.category proyecta owner_user_id');
  end if;

  -- A8 · el cliente solo LEE la vista.
  if has_table_privilege('authenticated','api.category','INSERT')
     or has_table_privilege('authenticated','api.category','UPDATE')
     or has_table_privilege('authenticated','api.category','DELETE') then
    fallos := array_append(fallos, 'A8: authenticated puede escribir en api.category');
  end if;

  -- A9 · EXACTAMENTE UNA `sec.persist_version`. Si sobreviviera la de nueve
  -- argumentos, las siete funciones anteriores podrian resolverse contra ella y
  -- escribir SIN la guarda de clase.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='sec' and p.proname='persist_version';
  if v_n <> 1 then
    fallos := array_append(fallos,
      format('A9: hay %s versiones de sec.persist_version; la antigua no lleva la guarda de clase', v_n));
  end if;

  if array_length(fallos,1) is not null then
    raise exception E'A · estructura:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · A · estructura, catalogo y superficie';
end
$a$;

-- ============================ B · privilegios y RLS ========================
do $b$
declare
  fallos text[] := '{}';
  v_rel text;
begin
  -- B1 · GUARDA CONTRA EL FALLO SILENCIOSO. E21 lo midio tres veces: con GRANT y
  -- sin policy aplicable, la lectura devuelve CERO FILAS SIN ERROR. Se aplica a
  -- los dos roles no cliente sobre las tablas nuevas.
  for v_rel in
    select n.nspname||'.'||c.relname
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='core' and c.relname in ('category','movement_detail') and c.relrowsecurity
       and has_table_privilege('nomey_writer', c.oid, 'SELECT')
       and not exists (select 1 from pg_policy p where p.polrelid=c.oid
                        and 'nomey_writer' = any (select rolname from pg_roles where oid = any (p.polroles)))
  loop
    fallos := array_append(fallos, format('B1: nomey_writer lee %s SIN policy: cero filas sin error', v_rel));
  end loop;
  for v_rel in
    select n.nspname||'.'||c.relname
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='core' and c.relname in ('category','movement_detail') and c.relrowsecurity
       and has_table_privilege('nomey_provisioner', c.oid, 'SELECT')
       and not exists (select 1 from pg_policy p where p.polrelid=c.oid
                        and 'nomey_provisioner' = any (select rolname from pg_roles where oid = any (p.polroles)))
  loop
    fallos := array_append(fallos, format('B1b: nomey_provisioner lee %s SIN policy', v_rel));
  end loop;

  -- B2 · el cliente NO gana escritura directa sobre core.
  if has_table_privilege('authenticated','core.category','INSERT')
     or has_table_privilege('authenticated','core.category','UPDATE')
     or has_table_privilege('authenticated','core.movement_detail','INSERT') then
    fallos := array_append(fallos, 'B2: authenticated escribe directamente en core');
  end if;

  -- B3 · el escritor CONTABLE no toca el catalogo de categorias: no es su
  -- frontera. Crear una categoria no es un hecho contable.
  if has_table_privilege('nomey_writer','core.category','INSERT')
     or has_table_privilege('nomey_writer','core.category','UPDATE') then
    fallos := array_append(fallos, 'B3: nomey_writer puede escribir el catalogo de categorias');
  end if;

  -- B4 · y el provisioner no escribe contabilidad.
  if has_table_privilege('nomey_provisioner','core.movement_detail','INSERT')
     or has_table_privilege('nomey_provisioner','core.effect','INSERT') then
    fallos := array_append(fallos, 'B4: nomey_provisioner escribe contabilidad');
  end if;

  -- B5 · ninguna policy nueva aplica a PUBLIC.
  if exists (select 1 from pg_policy p join pg_class c on c.oid=p.polrelid
              where c.relname in ('category','movement_detail') and p.polroles='{0}') then
    fallos := array_append(fallos, 'B5: alguna policy nueva aplica a PUBLIC');
  end if;

  if array_length(fallos,1) is not null then
    raise exception E'B · privilegios:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · B · privilegios y RLS de las relaciones nuevas';
end
$b$;

-- ===================== C · concepto: obligatorio y canonico ================
do $c$
declare
  fallos text[] := '{}';
  U1 constant text := (select v from ma_fix where k='U1');
  S1 constant text := (select v from ma_fix where k='S1');
  EUR constant text := (select v from ma_fix where k='EUR');
  GOTR constant text := (select v from ma_fix where k='GOTR');
  r jsonb; v_txt text; v_op uuid;
  base jsonb;
begin
  base := jsonb_build_object(
    'command_contract_version',2,'effective_date','2026-05-01','effective_time','12:00',
    'scope_id',S1,'amount','1000','currency_definition_id',EUR,'category_id',GOTR);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);

  -- C1 · concepto ausente.
  begin
    r := api.record_personal_expense(base || jsonb_build_object(
           'client_operation_id','a1000000-0000-4000-8000-000000000001'));
    fallos := array_append(fallos, 'C1: se acepto un gasto SIN concepto');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%PAYLOAD_INVALID%' then
      fallos := array_append(fallos, format('C1b: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- C2 · concepto vacio, y C3 solo espacios: los dos rechazados por la MISMA
  -- via, porque la canonicalizacion recorta antes de mirar.
  begin
    r := api.record_personal_expense(base || jsonb_build_object(
           'client_operation_id','a1000000-0000-4000-8000-000000000002','concept',''));
    fallos := array_append(fallos, 'C2: se acepto un concepto vacio');
  exception when sqlstate 'PGRST' then null;
  end;
  begin
    r := api.record_personal_expense(base || jsonb_build_object(
           'client_operation_id','a1000000-0000-4000-8000-000000000003','concept','   '));
    fallos := array_append(fallos, 'C3: se acepto un concepto de solo espacios');
  exception when sqlstate 'PGRST' then null;
  end;

  -- C4 · el concepto se PERSISTE recortado.
  r := api.record_personal_expense(base || jsonb_build_object(
         'client_operation_id','a1000000-0000-4000-8000-000000000004',
         'concept','   Mercadona   '));
  v_op := (r ->> 'operation_id')::uuid;
  reset role;
  select d.concept into v_txt
    from core.movement_detail d
    join core.operation o on o.current_version_id = d.operation_version_id
   where o.id = v_op;
  if v_txt <> 'Mercadona' then
    fallos := array_append(fallos, format('C4: el concepto se guardo como %L y deberia ser recortado', v_txt));
  end if;

  -- C5 · NFC. Las dos formas de «Café» —precompuesta y descompuesta— producen
  -- el mismo texto guardado. Sin esto, el mismo texto tecleado en dos teclados
  -- seria una intencion distinta.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  r := api.record_personal_expense(base || jsonb_build_object(
         'client_operation_id','a1000000-0000-4000-8000-000000000005',
         'concept', 'Cafe' || U&'\0301'));   -- e + acento combinante
  v_op := (r ->> 'operation_id')::uuid;
  reset role;
  select d.concept into v_txt
    from core.movement_detail d
    join core.operation o on o.current_version_id = d.operation_version_id
   where o.id = v_op;
  if v_txt <> normalize('Café', nfc) then
    fallos := array_append(fallos, 'C5: el concepto no quedo normalizado a NFC');
  end if;

  if array_length(fallos,1) is not null then
    raise exception E'C · concepto:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · C · el concepto es obligatorio, se recorta y se normaliza a NFC';
end
$c$;

-- ================== D · categoria: familia, propiedad y baja ===============
do $d$
declare
  fallos text[] := '{}';
  U1 constant text := (select v from ma_fix where k='U1');
  U2 constant text := (select v from ma_fix where k='U2');
  S1 constant text := (select v from ma_fix where k='S1');
  EUR constant text := (select v from ma_fix where k='EUR');
  GOTR constant text := (select v from ma_fix where k='GOTR');
  r jsonb; base jsonb; v_ajena uuid; v_propia uuid; v_op uuid; v_v1 uuid;
begin
  base := jsonb_build_object(
    'command_contract_version',2,'effective_date','2026-05-02','effective_time','12:00',
    'scope_id',S1,'amount','1000','currency_definition_id',EUR,'concept','Prueba');

  -- D1 · UN GASTO EXIGE CATEGORIA. Omitirla no es un gasto «sin clasificar»:
  -- es un comando incompleto, y `Otros` es la categoria REAL para lo que no
  -- encaja en otra (ADR-027).
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  begin
    r := api.record_personal_expense(base || jsonb_build_object(
           'client_operation_id','a2000000-0000-4000-8000-000000000001'));
    fallos := array_append(fallos, 'D1: se acepto un gasto SIN categoria');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%PAYLOAD_INVALID%' then
      fallos := array_append(fallos, format('D1b: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- D2 · UN INGRESO NO ADMITE CATEGORIA, y el rechazo dice lo correcto: no es
  -- que la categoria sea invalida, es que ese campo NO EXISTE para esta clase.
  -- Por eso cae en `PAYLOAD_INVALID` y no en `CATEGORY_NOT_USABLE`.
  begin
    r := api.record_personal_income(jsonb_build_object(
           'client_operation_id','a2000000-0000-4000-8000-000000000002',
           'command_contract_version',1,'effective_date','2026-05-02','effective_time','12:00',
           'scope_id',S1,'amount','1000','currency_definition_id',EUR,
           'concept','Prueba','category_id',GOTR));
    fallos := array_append(fallos, 'D2: un ingreso acepto una categoria');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%PAYLOAD_INVALID%' then
      fallos := array_append(fallos, format('D2b: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- D2c · y un ingreso SIN categoria se registra con normalidad, dejando su
  -- concepto y NINGUNA fila en `core.expense_category`.
  r := api.record_personal_income(jsonb_build_object(
         'client_operation_id','a2000000-0000-4000-8000-00000000000d',
         'command_contract_version',1,'effective_date','2026-05-02','effective_time','12:00',
         'scope_id',S1,'amount','1000','currency_definition_id',EUR,
         'concept','Nomina limpia'));
  v_op := (r ->> 'operation_id')::uuid;
  reset role;
  if not exists (select 1 from core.movement_detail d
                   join core.operation o on o.current_version_id = d.operation_version_id
                  where o.id = v_op and d.concept = 'Nomina limpia') then
    fallos := array_append(fallos, 'D2c: el ingreso no guardo su concepto');
  end if;
  if exists (select 1 from core.expense_category x
               join core.operation o on o.current_version_id = x.operation_version_id
              where o.id = v_op) then
    fallos := array_append(fallos, 'D2d: un ingreso dejo fila de categoria');
  end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);

  -- D3 · una categoria que no existe.
  begin
    r := api.record_personal_expense(base || jsonb_build_object(
           'client_operation_id','a2000000-0000-4000-8000-000000000003',
           'category_id','00000000-0000-4000-8000-000000000000'));
    fallos := array_append(fallos, 'D3: se acepto una categoria inexistente');
  exception when sqlstate 'PGRST' then null;
  end;
  reset role;

  -- D4 · una categoria PERSONALIZADA AJENA no se puede usar. La crea U2.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U2)::text, true);
  r := api.create_custom_category('{"label":"Gimnasio","icon":"leisure"}'::jsonb);
  v_ajena := (r ->> 'category_id')::uuid;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  begin
    r := api.record_personal_expense(base || jsonb_build_object(
           'client_operation_id','a2000000-0000-4000-8000-000000000004','category_id',v_ajena));
    fallos := array_append(fallos, 'D4: se uso la categoria personalizada de OTRO usuario');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%CATEGORY_NOT_USABLE%' then
      fallos := array_append(fallos, format('D4b: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- D4b · y U1 no la ve siquiera. La RLS filtra filas, asi que ni existe para el.
  if exists (select 1 from api.category where id = v_ajena) then
    fallos := array_append(fallos, 'D4c: U1 VE la categoria personalizada de U2');
  end if;

  -- D5 · una categoria propia si se usa, y queda registrada.
  r := api.create_custom_category('{"label":"Peluqueria","icon":"shopping"}'::jsonb);
  v_propia := (r ->> 'category_id')::uuid;
  r := api.record_personal_expense(base || jsonb_build_object(
         'client_operation_id','a2000000-0000-4000-8000-000000000005','category_id',v_propia));
  v_op := (r ->> 'operation_id')::uuid;

  -- D6 · se da de BAJA y deja de poder ASIGNARSE a un movimiento nuevo.
  r := api.set_custom_category_active(jsonb_build_object('category_id',v_propia,'is_active',false));
  begin
    r := api.record_personal_expense(base || jsonb_build_object(
           'client_operation_id','a2000000-0000-4000-8000-000000000006','category_id',v_propia));
    fallos := array_append(fallos, 'D6: se asigno una categoria dada de baja a un movimiento nuevo');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%CATEGORY_NOT_USABLE%' then
      fallos := array_append(fallos, format('D6b: codigo inesperado: %s', sqlerrm));
    end if;
  end;
  reset role;

  -- D7 · pero el movimiento que YA la usaba sigue siendo CORREGIBLE conservando
  -- esa categoria. Sin esta excepcion, dar de baja una categoria dejaria
  -- incorregible todo lo que la usara —aunque la correccion no la tocase—.
  select current_version_id into v_v1 from core.operation where id = v_op;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  begin
    r := api.record_personal_expense(base || jsonb_build_object(
           'client_operation_id','a2000000-0000-4000-8000-000000000007',
           'category_id',v_propia,'amount','2500',
           'operation_id',v_op,'expected_version_id',v_v1));
  exception when sqlstate 'PGRST' then
    fallos := array_append(fallos,
      format('D7: no se pudo corregir un movimiento conservando su categoria dada de baja: %s', sqlerrm));
  end;
  reset role;

  -- D8 · y el historico la sigue RESOLVIENDO, con su nombre y su icono.
  if not exists (
    select 1 from core.expense_category d
      join core.category c on c.id = d.category_id
      join core.operation o on o.current_version_id = d.operation_version_id
     where o.id = v_op and c.label = 'Peluqueria' and not c.is_active) then
    fallos := array_append(fallos, 'D8: el movimiento historico no resuelve su categoria inactiva');
  end if;

  if array_length(fallos,1) is not null then
    raise exception E'D · categoria:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · D · familia, propiedad y baja logica de las categorias';
end
$d$;

-- ============================ E · la hora efectiva =========================
do $e$
declare
  fallos text[] := '{}';
  U1 constant text := (select v from ma_fix where k='U1');
  S1 constant text := (select v from ma_fix where k='S1');
  EUR constant text := (select v from ma_fix where k='EUR');
  GOTR constant text := (select v from ma_fix where k='GOTR');
  r jsonb; base jsonb; v_op uuid; v_v1 uuid; v_t time; v_d date; v_n int;
begin
  base := jsonb_build_object(
    'command_contract_version',2,'effective_date','2026-05-03',
    'scope_id',S1,'amount','1000','currency_definition_id',EUR,
    'concept','Cena','category_id',GOTR);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);

  -- E1 · la hora es obligatoria para un movimiento.
  begin
    r := api.record_personal_expense(base || jsonb_build_object(
           'client_operation_id','a3000000-0000-4000-8000-000000000001'));
    fallos := array_append(fallos, 'E1: se acepto un movimiento sin hora efectiva');
  exception when sqlstate 'PGRST' then null;
  end;

  -- E2 · persiste tal cual, y la fecha viaja intacta a su lado.
  r := api.record_personal_expense(base || jsonb_build_object(
         'client_operation_id','a3000000-0000-4000-8000-000000000002','effective_time','21:30'));
  v_op := (r ->> 'operation_id')::uuid;
  reset role;
  select ov.effective_time, ov.effective_date into v_t, v_d
    from core.operation_version ov join core.operation o on o.current_version_id = ov.id
   where o.id = v_op;
  if v_t <> time '21:30' then
    fallos := array_append(fallos, format('E2: la hora se guardo como %s', v_t));
  end if;
  if v_d <> date '2026-05-03' then
    fallos := array_append(fallos, format('E2b: la fecha efectiva quedo en %s', v_d));
  end if;

  -- E3 · corregir SOLO la hora crea una version nueva y no muta la anterior.
  select current_version_id into v_v1 from core.operation where id = v_op;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  r := api.record_personal_expense(base || jsonb_build_object(
         'client_operation_id','a3000000-0000-4000-8000-000000000003','effective_time','22:45',
         'operation_id',v_op,'expected_version_id',v_v1));
  reset role;

  select count(*) into v_n from core.operation_version where operation_id = v_op;
  if v_n <> 2 then
    fallos := array_append(fallos, format('E3: la correccion dejo %s versiones y deberian ser 2', v_n));
  end if;
  if not exists (select 1 from core.operation_version where id = v_v1 and effective_time = time '21:30') then
    fallos := array_append(fallos, 'E3b: la version anterior fue MUTADA');
  end if;
  if not exists (select 1 from core.operation o join core.operation_version ov on ov.id=o.current_version_id
                  where o.id = v_op and ov.effective_time = time '22:45') then
    fallos := array_append(fallos, 'E3c: la version vigente no tiene la hora corregida');
  end if;

  -- E4 · el AJUSTE declara hora desde F6.C, y es una decision, no una deriva:
  -- un ajuste por objetivo es por naturaleza una observacion en un instante, y
  -- una lista mixta necesita UN solo criterio de orden. Las otras cinco clases
  -- siguen sin declararla, y su hora es pregunta de F9/F12.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  r := api.record_adjustment(jsonb_build_object(
         'client_operation_id','a3000000-0000-4000-8000-000000000004',
         'command_contract_version',2,'effective_date','2026-05-04', 'effective_time','09:00',
         'scope_id',S1,'delta','500','currency_definition_id',EUR));
  v_op := (r ->> 'operation_id')::uuid;
  reset role;
  if not exists (select 1 from core.operation_version ov join core.operation o on o.current_version_id=ov.id
                  where o.id = v_op and ov.effective_time = time '09:00') then
    fallos := array_append(fallos, 'E4: el ajuste no conservo la hora declarada');
  end if;

  -- E4b · pero SIGUE sin concepto ni categoria. Su linea de historial la deriva
  -- el producto —«Saldo ajustado a X»— y nadie la escribe.
  if exists (select 1 from core.movement_detail d join core.operation o on o.current_version_id=d.operation_version_id
              where o.id = v_op) then
    fallos := array_append(fallos, 'E4b: un ajuste recibio concepto y categoria sinteticos');
  end if;

  if array_length(fallos,1) is not null then
    raise exception E'E · hora:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · E · la hora persiste, se corrige y no contamina otras clases';
end
$e$;

-- ================================ F · el ingreso ===========================
do $f$
declare
  fallos text[] := '{}';
  U1 constant text := (select v from ma_fix where k='U1');
  S1 constant text := (select v from ma_fix where k='S1');
  EUR constant text := (select v from ma_fix where k='EUR');
  INOM constant text := (select v from ma_fix where k='INOM');
  r jsonb; base jsonb; v_op uuid; v_v1 uuid; v_bal bigint; v_eco bigint; v_part uuid; v_n int;
begin
  base := jsonb_build_object(
    'command_contract_version',1,'effective_date','2026-06-01','effective_time','08:00',
    'scope_id',S1,'amount','150000','currency_definition_id',EUR,
    'concept','Nomina agosto');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);

  -- F1 · importe no positivo.
  begin
    r := api.record_personal_income(base || jsonb_build_object(
           'client_operation_id','a4000000-0000-4000-8000-000000000001','amount','0'));
    fallos := array_append(fallos, 'F1: se acepto un ingreso de cero');
  exception when sqlstate 'PGRST' then null;
  end;
  begin
    r := api.record_personal_income(base || jsonb_build_object(
           'client_operation_id','a4000000-0000-4000-8000-000000000002','amount','-100'));
    fallos := array_append(fallos, 'F1b: se acepto un ingreso negativo');
  exception when sqlstate 'PGRST' then null;
  end;

  -- F2 · los efectos: saldo POSITIVO, economica POSITIVA, participante NULO.
  r := api.record_personal_income(base || jsonb_build_object(
         'client_operation_id','a4000000-0000-4000-8000-000000000003'));
  v_op := (r ->> 'operation_id')::uuid;
  reset role;

  select e.balance_amount, e.economic_amount, e.economic_participant_id
    into v_bal, v_eco, v_part
    from core.current_effect e join core.operation o on o.current_version_id = e.operation_version_id
   where o.id = v_op;
  if v_bal <> 150000 then
    fallos := array_append(fallos, format('F2: el saldo del ingreso es %s y deberia ser +150000', v_bal));
  end if;
  if v_eco <> 150000 then
    fallos := array_append(fallos, format('F2b: la economica del ingreso es %s y deberia ser +150000', v_eco));
  end if;
  if v_part is not null then
    fallos := array_append(fallos, 'F2c: el ingreso nombra participante, y el Modo Personal no nomina');
  end if;

  -- F3 · la clase CONTABLE del efecto es `income`, que es lo que lo hace contar
  -- en estadisticas. Un ajuste disfrazado no lo haria.
  if not exists (select 1 from core.current_effect e join core.operation o on o.current_version_id=e.operation_version_id
                  where o.id = v_op and e.accounting_class = 'income') then
    fallos := array_append(fallos, 'F3: el efecto del ingreso no tiene clase contable income');
  end if;
  if not exists (select 1 from core.operation where id = v_op and operation_class = 'personal_income') then
    fallos := array_append(fallos, 'F3b: la operacion no tiene clase personal_income');
  end if;

  -- F4 · un solo efecto, como el gasto: una fila con dos dimensiones.
  select count(*) into v_n from core.current_effect e
    join core.operation o on o.current_version_id = e.operation_version_id where o.id = v_op;
  if v_n <> 1 then
    fallos := array_append(fallos, format('F4: el ingreso produjo %s efectos y deberia producir 1', v_n));
  end if;

  -- F5 · se corrige como cualquier otra clase.
  select current_version_id into v_v1 from core.operation where id = v_op;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  r := api.record_personal_income(base || jsonb_build_object(
         'client_operation_id','a4000000-0000-4000-8000-000000000004','amount','160000',
         'operation_id',v_op,'expected_version_id',v_v1));
  reset role;
  select e.balance_amount into v_bal
    from core.current_effect e join core.operation o on o.current_version_id = e.operation_version_id
   where o.id = v_op;
  if v_bal <> 160000 then
    fallos := array_append(fallos, format('F5: tras corregir, el saldo es %s y deberia ser 160000', v_bal));
  end if;
  if not exists (select 1 from core.operation_version where id = v_v1) then
    fallos := array_append(fallos, 'F5b: la version anterior del ingreso desaparecio');
  end if;

  if array_length(fallos,1) is not null then
    raise exception E'F · ingreso:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · F · el ingreso es una clase real, con sus dos dimensiones positivas';
end
$f$;

-- ==================== G · la correccion cruzada de clase ===================
-- La obligacion que dejo abierta F6.A. Es el defecto que `record_personal_income`
-- vuelve explotable, porque su payload es de forma IDENTICA al del gasto.
do $g$
declare
  fallos text[] := '{}';
  U1 constant text := (select v from ma_fix where k='U1');
  S1 constant text := (select v from ma_fix where k='S1');
  EUR constant text := (select v from ma_fix where k='EUR');
  GOTR constant text := (select v from ma_fix where k='GOTR');
  INOM constant text := (select v from ma_fix where k='INOM');
  r jsonb; v_gasto uuid; v_ing uuid; v_vg uuid; v_vi uuid; v_n int; v_clase text;
  v_ops int; v_vers int; v_efs int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);

  r := api.record_personal_expense(jsonb_build_object(
         'client_operation_id','a5000000-0000-4000-8000-000000000001',
         'command_contract_version',2,'effective_date','2026-07-01','effective_time','10:00',
         'scope_id',S1,'amount','3000','currency_definition_id',EUR,
         'concept','Gasto','category_id',GOTR));
  v_gasto := (r ->> 'operation_id')::uuid;

  r := api.record_personal_income(jsonb_build_object(
         'client_operation_id','a5000000-0000-4000-8000-000000000002',
         'command_contract_version',1,'effective_date','2026-07-01','effective_time','10:00',
         'scope_id',S1,'amount','9000','currency_definition_id',EUR,
         'concept','Ingreso'));
  v_ing := (r ->> 'operation_id')::uuid;
  reset role;

  select current_version_id into v_vg from core.operation where id = v_gasto;
  select current_version_id into v_vi from core.operation where id = v_ing;
  select count(*) into v_ops  from core.operation;
  select count(*) into v_vers from core.operation_version;
  select count(*) into v_efs  from core.effect;

  -- G1 · el writer de INGRESO no puede corregir una operacion de GASTO, ni
  -- siquiera acertando el `expected_version_id` vigente.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  begin
    r := api.record_personal_income(jsonb_build_object(
           'client_operation_id','a5000000-0000-4000-8000-000000000003',
           'command_contract_version',1,'effective_date','2026-07-02','effective_time','10:00',
           'scope_id',S1,'amount','3000','currency_definition_id',EUR,
           'concept','Colado',
           'operation_id',v_gasto,'expected_version_id',v_vg));
    fallos := array_append(fallos,
      'G1: el writer de ingreso CORRIGIO una operacion de gasto; operation_class y accounting_class habrian divergido');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%OPERATION_CLASS_MISMATCH%' then
      fallos := array_append(fallos, format('G1b: se rechazo, pero no por clase: %s', sqlerrm));
    end if;
  end;

  -- G2 · y al reves.
  begin
    r := api.record_personal_expense(jsonb_build_object(
           'client_operation_id','a5000000-0000-4000-8000-000000000004',
           'command_contract_version',2,'effective_date','2026-07-02','effective_time','10:00',
           'scope_id',S1,'amount','9000','currency_definition_id',EUR,
           'concept','Colado','category_id',GOTR,
           'operation_id',v_ing,'expected_version_id',v_vi));
    fallos := array_append(fallos, 'G2: el writer de gasto CORRIGIO una operacion de ingreso');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%OPERATION_CLASS_MISMATCH%' then
      fallos := array_append(fallos, format('G2b: se rechazo, pero no por clase: %s', sqlerrm));
    end if;
  end;

  -- G3 · un ajuste tampoco puede corregir un gasto. La guarda alcanza a las OCHO
  -- funciones, no solo a las dos nuevas, porque vive donde todas pasan.
  begin
    r := api.record_adjustment(jsonb_build_object(
           'client_operation_id','a5000000-0000-4000-8000-000000000005',
           'command_contract_version',2,'effective_date','2026-07-02', 'effective_time','09:00',
           'scope_id',S1,'delta','3000','currency_definition_id',EUR,
           'operation_id',v_gasto,'expected_version_id',v_vg));
    fallos := array_append(fallos, 'G3: el writer de ajuste corrigio una operacion de gasto');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%OPERATION_CLASS_MISMATCH%' then
      fallos := array_append(fallos, format('G3b: se rechazo, pero no por clase: %s', sqlerrm));
    end if;
  end;

  -- G4 · la MISMA clase si corrige. Sin esto la guarda podria estar rechazando
  -- todo y el test pasaria igual.
  begin
    r := api.record_personal_expense(jsonb_build_object(
           'client_operation_id','a5000000-0000-4000-8000-000000000006',
           'command_contract_version',2,'effective_date','2026-07-02','effective_time','10:00',
           'scope_id',S1,'amount','3500','currency_definition_id',EUR,
           'concept','Gasto corregido','category_id',GOTR,
           'operation_id',v_gasto,'expected_version_id',v_vg));
  exception when sqlstate 'PGRST' then
    fallos := array_append(fallos, format('G4: una correccion de la MISMA clase fue rechazada: %s', sqlerrm));
  end;
  reset role;

  -- G5 · ningun rechazo escribio nada. La guarda corre ANTES de insertar la
  -- version, asi que no puede quedar una version huerfana de otra clase.
  if (select count(*) from core.operation) <> v_ops then
    fallos := array_append(fallos, 'G5: los rechazos por clase crearon operaciones');
  end if;
  if (select count(*) from core.operation_version) <> v_vers + 1 then
    fallos := array_append(fallos,
      format('G5b: hay %s versiones y deberia haber %s: solo la correccion legitima de G4',
             (select count(*) from core.operation_version), v_vers + 1));
  end if;
  if (select count(*) from core.effect) <> v_efs + 1 then
    fallos := array_append(fallos, 'G5c: los rechazos por clase escribieron efectos');
  end if;

  -- G6 · y la clase de la operacion corregida NO cambio.
  select operation_class into v_clase from core.operation where id = v_gasto;
  if v_clase <> 'personal_expense' then
    fallos := array_append(fallos, format('G6: la clase de la operacion quedo en %s', v_clase));
  end if;

  -- G7 · NINGUNA operacion tiene efectos vigentes de una clase contable ajena a
  -- su clase de operacion. Es la propiedad que la guarda protege, comprobada
  -- sobre todo lo escrito por este check y no solo sobre los casos de arriba.
  select count(*) into v_n
    from core.operation o
    join core.current_effect e on e.operation_version_id = o.current_version_id
   where (o.operation_class = 'personal_expense' and e.accounting_class not in ('expense'))
      or (o.operation_class = 'personal_income'  and e.accounting_class not in ('income'))
      or (o.operation_class = 'adjustment'       and e.accounting_class not in ('adjustment'));
  if v_n <> 0 then
    fallos := array_append(fallos,
      format('G7: %s efectos vigentes tienen clase contable ajena a la clase de su operacion', v_n));
  end if;

  if array_length(fallos,1) is not null then
    raise exception E'G · clase cruzada:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · G · una clase no corrige a otra, y ningun rechazo escribio';
end
$g$;

-- ===================== H · idempotencia con los campos nuevos ==============
do $h$
declare
  fallos text[] := '{}';
  U1 constant text := (select v from ma_fix where k='U1');
  S1 constant text := (select v from ma_fix where k='S1');
  EUR constant text := (select v from ma_fix where k='EUR');
  GOTR constant text := (select v from ma_fix where k='GOTR');
  GALI constant text := (select v from ma_fix where k='GALI');
  r jsonb; base jsonb; v_op uuid;
begin
  base := jsonb_build_object(
    'client_operation_id','a6000000-0000-4000-8000-000000000001',
    'command_contract_version',2,'effective_date','2026-08-01','effective_time','13:00',
    'scope_id',S1,'amount','1200','currency_definition_id',EUR,
    'concept','Mercadona','category_id',GOTR);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);

  r := api.record_personal_expense(base);
  v_op := (r ->> 'operation_id')::uuid;

  -- H1 · reintento IDENTICO: replay, misma operacion, sin escribir.
  r := api.record_personal_expense(base);
  if (r ->> 'already_processed') <> 'true' or (r ->> 'operation_id')::uuid <> v_op then
    fallos := array_append(fallos, format('H1: el reintento identico no fue replay: %s', r::text));
  end if;

  -- H2 · misma clave, CONCEPTO distinto -> conflicto. Es el requisito explicito
  -- del contrato: un replay no puede devolver en silencio la primera escritura
  -- cuando la intencion es materialmente otra.
  begin
    r := api.record_personal_expense(base || jsonb_build_object('concept','Carrefour'));
    fallos := array_append(fallos, 'H2: un concepto distinto con la misma clave hizo REPLAY');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%IDEMPOTENCY_KEY_REUSED%' then
      fallos := array_append(fallos, format('H2b: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- H3 · misma clave, CATEGORIA distinta -> conflicto.
  begin
    r := api.record_personal_expense(base || jsonb_build_object('category_id',GALI));
    fallos := array_append(fallos, 'H3: una categoria distinta con la misma clave hizo REPLAY');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%IDEMPOTENCY_KEY_REUSED%' then
      fallos := array_append(fallos, format('H3b: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- H4 · misma clave, HORA distinta -> conflicto. La hora es intencion de la
  -- persona, no metadato de transporte.
  begin
    r := api.record_personal_expense(base || jsonb_build_object('effective_time','19:00'));
    fallos := array_append(fallos, 'H4: una hora distinta con la misma clave hizo REPLAY');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%IDEMPOTENCY_KEY_REUSED%' then
      fallos := array_append(fallos, format('H4b: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- H5 · el mismo concepto con espacios sobrantes SI es replay: la
  -- canonicalizacion se aplica ANTES de comparar, asi que un reintento no falla
  -- por un espacio.
  r := api.record_personal_expense(base || jsonb_build_object('concept','  Mercadona  '));
  if (r ->> 'already_processed') <> 'true' then
    fallos := array_append(fallos, 'H5: un concepto con espacios sobrantes no se reconocio como el mismo');
  end if;

  -- H6 · pero MERCADONA en mayusculas NO es lo mismo. La canonicalizacion no
  -- pliega mayusculas a proposito.
  begin
    r := api.record_personal_expense(base || jsonb_build_object('concept','MERCADONA'));
    fallos := array_append(fallos, 'H6: MERCADONA se trato como la misma intencion que Mercadona');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%IDEMPOTENCY_KEY_REUSED%' then
      fallos := array_append(fallos, format('H6b: codigo inesperado: %s', sqlerrm));
    end if;
  end;
  -- H7 · LA IDEMPOTENCIA DEL INGRESO, sobre su intencion canonica NUEVA. La
  -- categoria salio de ella al hacerse exclusiva del gasto (ADR-027), asi que
  -- las respuestas hay que volver a medirlas: una intencion mas corta compara
  -- menos campos, y lo que ya no se compara es exactamente lo que podria
  -- colarse como replay.
  base := jsonb_build_object(
    'client_operation_id','a6000000-0000-4000-8000-000000000002',
    'command_contract_version',2,'effective_date','2026-08-02','effective_time','09:00',
    'scope_id',S1,'amount','150000','currency_definition_id',EUR,'concept','Nomina');

  r := api.record_personal_income(base);
  v_op := (r ->> 'operation_id')::uuid;

  r := api.record_personal_income(base);
  if (r ->> 'already_processed') <> 'true' or (r ->> 'operation_id')::uuid <> v_op then
    fallos := array_append(fallos, format('H7: el ingreso identico no fue replay: %s', r::text));
  end if;

  -- H8 · los cuatro campos que SI forman la intencion del ingreso: cambiar
  -- cualquiera con la misma clave es conflicto, no replay.
  declare
    campos constant text[][] := array[
      array['amount','160000'], array['concept','Nomina extra'],
      array['effective_time','19:00'], array['effective_date','2026-08-03']];
    par text[];
  begin
    foreach par slice 1 in array campos loop
      begin
        r := api.record_personal_income(base || jsonb_build_object(par[1], par[2]));
        fallos := array_append(fallos,
          format('H8: cambiar %s con la misma clave hizo REPLAY', par[1]));
      exception when sqlstate 'PGRST' then
        if sqlerrm not like '%IDEMPOTENCY_KEY_REUSED%' then
          fallos := array_append(fallos, format('H8b: %s dio un codigo inesperado: %s', par[1], sqlerrm));
        end if;
      end;
    end loop;
  end;

  -- H9 · Y LA CATEGORIA NO ES UNO DE ELLOS, porque no hay forma de construir un
  -- ingreso que la lleve: el rechazo es de FORMA del payload y llega antes de
  -- mirar a que apunta. Por eso el uuid es uno REAL Y VIGENTE —si el rechazo
  -- dependiera de la categoria, este pasaria y la prueba no probaria nada.
  begin
    r := api.record_personal_income(base || jsonb_build_object('category_id',GOTR));
    fallos := array_append(fallos, 'H9: un ingreso acepto category_id');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%PAYLOAD_INVALID%' then
      fallos := array_append(fallos,
        format('H9b: el ingreso con categoria no se rechazo por forma: %s', sqlerrm));
    end if;
  end;

  reset role;

  -- H10 · y el ingreso que SI se escribio no dejo rastro de categoria. Es la
  -- otra mitad de H9: rechazar el campo no serviria de nada si la intencion
  -- canonica lo guardara por otra via. Se mira ya sin el rol del cliente,
  -- porque `core` no es suya —que es justamente lo que sostiene el invariante.
  if exists (select 1 from core.expense_category x
               join core.operation o on o.current_version_id = x.operation_version_id
              where o.id = v_op) then
    fallos := array_append(fallos, 'H10: el ingreso dejo fila en expense_category');
  end if;

  if array_length(fallos,1) is not null then
    raise exception E'H · idempotencia:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · H · la intencion canonica del gasto lleva categoria y la del ingreso no';
end
$h$;

-- ==================== I · la API de categorias personalizadas ==============
do $i$
declare
  fallos text[] := '{}';
  U1 constant text := (select v from ma_fix where k='U1');
  U2 constant text := (select v from ma_fix where k='U2');
  S1 constant text := (select v from ma_fix where k='S1');
  EUR constant text := (select v from ma_fix where k='EUR');
  GOTR constant text := (select v from ma_fix where k='GOTR');
  r jsonb; v_cat uuid; v_op uuid; v_label text; v_n int; v_ajena uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);

  -- I1 · crear una propia. SIN familia: todas las categorias son de gasto
  -- (ADR-027), asi que el campo ya no existe y mandarlo es un payload invalido.
  begin
    r := api.create_custom_category('{"applies_to":"income","label":"Alquiler piso"}'::jsonb);
    fallos := array_append(fallos, 'I1: se acepto una familia que ya no existe');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%PAYLOAD_INVALID%' then
      fallos := array_append(fallos, format('I1b: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- I1c · EL ICONO ES UNA CLAVE SEMANTICA, no un nombre de plataforma. Un
  -- nombre de SF Symbol se rechaza: colarlo devolveria el contrato al mundo de
  -- iOS y dejaria Android sin icono otra vez.
  begin
    r := api.create_custom_category('{"label":"Coladero","icon":"pawprint.fill"}'::jsonb);
    fallos := array_append(fallos, 'I1c: se acepto un nombre de SF Symbol como icono');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%PAYLOAD_INVALID%' then
      fallos := array_append(fallos, format('I1d: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  r := api.create_custom_category('{"label":"Mascota","icon":"other"}'::jsonb);
  v_cat := (r ->> 'category_id')::uuid;
  if (r ->> 'icon') <> 'other' then
    fallos := array_append(fallos, 'I1e: la personalizada no conservo su clave de icono');
  end if;

  -- I1f · y sin icono cae en el generico, no en un hueco.
  r := api.create_custom_category('{"label":"Sin icono"}'::jsonb);
  if (r ->> 'icon') <> 'other' then
    fallos := array_append(fallos, 'I1f: una personalizada sin icono no cayo en el generico');
  end if;

  -- I2 · el propietario NO se acepta del cliente.
  begin
    r := api.create_custom_category(
           jsonb_build_object('label','X','owner_user_id',U2));
    fallos := array_append(fallos, 'I2: se acepto owner_user_id en el payload');
  exception when sqlstate 'PGRST' then null;
  end;

  -- I3 · una clave de icono fuera del vocabulario.
  begin
    r := api.create_custom_category('{"label":"X","icon":"inventada"}'::jsonb);
    fallos := array_append(fallos, 'I3: se acepto una clave de icono desconocida');
  exception when sqlstate 'PGRST' then null;
  end;

  -- I4 · nombre duplicado.
  begin
    r := api.create_custom_category('{"label":"  mascota "}'::jsonb);
    fallos := array_append(fallos, 'I4: se creo una segunda categoria con el mismo nombre');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%CATEGORY_NAME_TAKEN%' then
      fallos := array_append(fallos, format('I4b: codigo inesperado: %s', sqlerrm));
    end if;
  end;

  -- I5 · se usa en un movimiento, y RENOMBRARLA cambia lo que ese movimiento
  -- historico muestra. Una categoria es una ENTIDAD, no una etiqueta copiada.
  r := api.record_personal_expense(jsonb_build_object(
         'client_operation_id','a7000000-0000-4000-8000-000000000001',
         'command_contract_version',2,'effective_date','2026-08-10','effective_time','11:00',
         'scope_id',S1,'amount','4000','currency_definition_id',EUR,
         'concept','Veterinario','category_id',v_cat));
  v_op := (r ->> 'operation_id')::uuid;

  r := api.rename_custom_category(jsonb_build_object('category_id',v_cat,'label','Animales'));
  reset role;

  select c.label into v_label
    from core.expense_category d
    join core.category c on c.id = d.category_id
    join core.operation o on o.current_version_id = d.operation_version_id
   where o.id = v_op;
  if v_label <> 'Animales' then
    fallos := array_append(fallos,
      format('I5: el movimiento historico muestra %L y el renombrado deberia alcanzarlo', v_label));
  end if;

  -- I5b · y renombrar NO creo ninguna version: no es un hecho contable.
  select count(*) into v_n from core.operation_version where operation_id = v_op;
  if v_n <> 1 then
    fallos := array_append(fallos, format('I5b: renombrar creo %s versiones', v_n));
  end if;

  -- I6 · una categoria de SISTEMA no la puede tocar nadie.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  begin
    r := api.rename_custom_category(jsonb_build_object('category_id',GOTR,'label','Mia'));
    fallos := array_append(fallos, 'I6: se renombro una categoria de SISTEMA');
  exception when sqlstate 'PGRST' then
    if sqlerrm not like '%CATEGORY_NOT_USABLE%' then
      fallos := array_append(fallos, format('I6b: codigo inesperado: %s', sqlerrm));
    end if;
  end;
  begin
    r := api.set_custom_category_active(jsonb_build_object('category_id',GOTR,'is_active',false));
    fallos := array_append(fallos, 'I6c: se dio de baja una categoria de SISTEMA');
  exception when sqlstate 'PGRST' then null;
  end;
  reset role;

  -- I7 · y la de OTRO usuario tampoco.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U2)::text, true);
  r := api.create_custom_category('{"label":"Suya","icon":"tag"}'::jsonb);
  v_ajena := (r ->> 'category_id')::uuid;
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  begin
    r := api.rename_custom_category(jsonb_build_object('category_id',v_ajena,'label','Robada'));
    fallos := array_append(fallos, 'I7: se renombro la categoria de OTRO usuario');
  exception when sqlstate 'PGRST' then null;
  end;

  -- I8 · la baja logica NO borra la fila: el historico la necesita.
  r := api.set_custom_category_active(jsonb_build_object('category_id',v_cat,'is_active',false));
  reset role;
  if not exists (select 1 from core.category where id = v_cat and not is_active) then
    fallos := array_append(fallos, 'I8: la baja borro la fila en vez de marcarla');
  end if;

  -- I9 · desaparece del SELECTOR —que filtra por is_active— y sigue estando en
  -- la vista para poder resolver el historico.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  select count(*) into v_n from api.category where id = v_cat and is_active;
  if v_n <> 0 then
    fallos := array_append(fallos, 'I9: la categoria dada de baja sigue apareciendo como activa');
  end if;
  select count(*) into v_n from api.category where id = v_cat;
  if v_n <> 1 then
    fallos := array_append(fallos, 'I9b: la categoria dada de baja dejo de ser legible y el historico no puede resolverla');
  end if;

  -- I10 · el catalogo que ve U1: las 15 de sistema y solo las SUYAS.
  select count(*) into v_n from api.category;
  if v_n <> 15 + 3 then
    fallos := array_append(fallos, format('I10: U1 ve %s categorias y deberian ser 18: 15 de sistema y 3 suyas', v_n));
  end if;
  reset role;

  if array_length(fallos,1) is not null then
    raise exception E'I · categorias personalizadas:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · I · crear, renombrar y dar de baja, con el historico intacto';
end
$i$;

\echo 'movement-anatomy: OK'

-- ============ J · «todo gasto tiene categoria»: que lo garantiza =============
--
-- La afirmacion se comprueba, y **se comprueba por partes**, porque `NOT NULL`
-- no dice lo que parece decir: garantiza que una fila EXISTENTE tenga categoria,
-- no que la fila exista.
do $j$
declare
  fallos text[] := '{}';
  U1   constant text := (select v from ma_fix where k='U1');
  S1   constant text := (select v from ma_fix where k='S1');
  EUR  constant text := (select v from ma_fix where k='EUR');
  GOTR constant text := (select v from ma_fix where k='GOTR');
  GALI constant text := (select v from ma_fix where k='GALI');
  r jsonb; v_op uuid; v_ver uuid; v_n int;
begin
  -- J1 · COMO MUCHO UNA: estructural, por clave primaria.
  if not exists (select 1 from pg_constraint
                  where conrelid='core.expense_category'::regclass and contype='p') then
    fallos := array_append(fallos, 'J1: expense_category no tiene clave primaria');
  end if;

  -- J2 · LA QUE HAY ES REAL: NOT NULL y FK al catalogo.
  if not exists (select 1 from information_schema.columns
                  where table_schema='core' and table_name='expense_category'
                    and column_name='category_id' and is_nullable='NO') then
    fallos := array_append(fallos, 'J2: la categoria del gasto dejo de ser NOT NULL');
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid='core.expense_category'::regclass and contype='f'
                    and confrelid='core.category'::regclass) then
    fallos := array_append(fallos, 'J2b: la categoria del gasto no referencia al catalogo');
  end if;

  -- J3 · AL MENOS UNA NO ES ESTRUCTURAL, y se afirma para que nadie lo describa
  -- como si lo fuera: no hay CHECK ni trigger que lo exija, y PostgreSQL no
  -- puede expresarlo porque la condicion depende de `operation_class`, que vive
  -- en otra tabla. La presencia la garantizan la frontera y el cierre de
  -- escrituras, que es lo que comprueban J4 y J5.
  select count(*) into v_n from pg_trigger
   where tgrelid in ('core.operation_version'::regclass,'core.expense_category'::regclass)
     and not tgisinternal;
  if v_n <> 0 then
    fallos := array_append(fallos,
      format('J3: han aparecido %s triggers; la garantia dejo de ser la documentada', v_n));
  end if;

  -- J4 · LA FRONTERA: un gasto sin categoria se rechaza. Ya lo cubre D1, y se
  -- repite aqui porque es una de las dos patas del invariante.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U1)::text, true);
  begin
    r := api.record_personal_expense(jsonb_build_object(
           'client_operation_id','a7000000-0000-4000-8000-000000000001',
           'command_contract_version',2,'effective_date','2026-06-01','effective_time','10:00',
           'scope_id',S1,'amount','1000','currency_definition_id',EUR,'concept','Sin categoria'));
    fallos := array_append(fallos, 'J4: la frontera acepto un gasto sin categoria');
  exception when sqlstate 'PGRST' then
    -- y por el motivo correcto: si algun dia rechazara por otra cosa este bloque
    -- seguiria pasando sin haber comprobado nada.
    if sqlerrm not like '%PAYLOAD_INVALID%' or sqlerrm not like '%category_id%' then
      fallos := array_append(fallos, format('J4b: rechazo por otro motivo: %s', sqlerrm));
    end if;
  end;

  -- J5 · EL CIERRE: no hay otra ruta. Sin `USAGE` sobre `core`, el cliente no
  -- puede crear una version a mano ni quitarle la categoria a un gasto.
  begin
    delete from core.expense_category;
    fallos := array_append(fallos, 'J5: authenticated pudo borrar filas de expense_category');
  exception when others then null;
  end;
  begin
    insert into core.movement_detail (operation_version_id, concept)
    values (gen_random_uuid(), 'colado');
    fallos := array_append(fallos, 'J5b: authenticated pudo escribir en core directamente');
  exception when others then null;
  end;

  -- J6 · DOS categorias para la misma version: imposible.
  r := api.record_personal_expense(jsonb_build_object(
         'client_operation_id','a7000000-0000-4000-8000-000000000002',
         'command_contract_version',2,'effective_date','2026-06-01','effective_time','10:00',
         'scope_id',S1,'amount','1000','currency_definition_id',EUR,'concept','Con categoria',
         'category_id',GOTR));
  v_op := (r ->> 'operation_id')::uuid;

  -- J7 · UN INGRESO NO ADQUIERE CATEGORIA por ninguna via del cliente.
  r := api.record_personal_income(jsonb_build_object(
         'client_operation_id','a7000000-0000-4000-8000-000000000003',
         'command_contract_version',2,'effective_date','2026-06-01','effective_time','10:00',
         'scope_id',S1,'amount','5000','currency_definition_id',EUR,'concept','Nomina'));
  reset role;

  select current_version_id into v_ver from core.operation where id = v_op;
  begin
    insert into core.expense_category (operation_version_id, category_id) values (v_ver, GALI::uuid);
    fallos := array_append(fallos, 'J6: se pudieron poner dos categorias a la misma version');
  exception when unique_violation then null;
  end;

  select count(*) into v_n
    from core.operation o
    join core.operation_version ov on ov.id = o.current_version_id
    join core.expense_category x on x.operation_version_id = ov.id
   where o.operation_class = 'personal_income';
  if v_n <> 0 then
    fallos := array_append(fallos, format('J7: %s ingresos tienen categoria', v_n));
  end if;

  -- J8 · Y EL INVARIANTE SE CUMPLE sobre TODO lo que este check ha escrito, no
  -- solo sobre los casos que preparo. Es la misma forma que G7.
  select count(*) into v_n
    from core.operation o
    join core.operation_version ov on ov.id = o.current_version_id
   where o.operation_class = 'personal_expense'
     and ov.version_kind = 'record'
     and not exists (select 1 from core.expense_category x
                      where x.operation_version_id = ov.id);
  if v_n <> 0 then
    fallos := array_append(fallos, format('J8: %s gastos vigentes SIN categoria', v_n));
  end if;

  if array_length(fallos,1) is not null then
    raise exception E'J · invariante gasto-categoria:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · J · como mucho una por estructura; al menos una por frontera y cierre';
end
$j$;

rollback;
