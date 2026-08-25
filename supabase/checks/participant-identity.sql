-- Comprobaciones del vinculo participante-cuenta y de los periodos de
-- presencia, contra la base REAL construida por las migraciones.
--
-- Uso, desde Ubuntu y con el stack levantado:
--   docker exec -i supabase_db_Nomey psql -U postgres -d postgres \
--     -X -q -v ON_ERROR_STOP=1 < supabase/checks/participant-identity.sql
--
-- Acumula los fallos de cada seccion y termina con excepcion si hubo alguno,
-- para que un unico error no oculte los demas. Todo ocurre dentro de una
-- transaccion que termina en ROLLBACK: no deja datos ni restricciones
-- modificadas.

\pset pager off
\set ON_ERROR_STOP on

begin;

-- ============================ A · extension, forma, privilegios y catalogo ==
do $estructura$
declare
  fallos text[] := '{}';
  v_n int;
begin
  -- A1 · la extension esta instalada y en el schema del stack.
  if not exists (
    select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'btree_gist' and n.nspname = 'extensions'
  ) then
    fallos := array_append(fallos, 'A1: btree_gist no esta instalada en el schema extensions');
  end if;

  -- A1b · y realmente aporta el operator class que `uuid` no tiene. Sin el, la
  -- exclusion de solapes no puede existir (E18: 42704).
  if not exists (
    select 1
    from pg_opclass oc
    join pg_am am on am.oid = oc.opcmethod
    where am.amname = 'gist' and oc.opcintype = 'uuid'::regtype
  ) then
    fallos := array_append(fallos, 'A1b: no hay operator class GiST para uuid');
  end if;

  -- A2 · las dos relaciones nuevas existen.
  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'core' and c.relkind = 'r'
    and c.relname in ('participant_user_link','participant_period');
  if v_n <> 2 then
    fallos := array_append(fallos, format('A2: se esperaban 2 relaciones nuevas y hay %s', v_n));
  end if;

  -- A3 · ninguna tabla de core sin RLS. Regla dura, sobre todas.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'core' and c.relkind = 'r' and not c.relrowsecurity
  ) then
    fallos := array_append(fallos, 'A3: hay tablas de core sin RLS activada');
  end if;

  -- A4 · ninguna policy de core aplicable a PUBLIC (ADR-011 §15). Semantico.
  if exists (
    select 1 from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'core' and 0 = any(p.polroles)
  ) then
    fallos := array_append(fallos, 'A4: existe una policy de core aplicable a PUBLIC');
  end if;

  -- A5 · el rol cliente no alcanza ninguna de las dos, ni para leer.
  if has_table_privilege('authenticated', 'core.participant_user_link', 'select') then
    fallos := array_append(fallos, 'A5: authenticated tiene SELECT sobre core.participant_user_link');
  end if;
  if has_table_privilege('authenticated', 'core.participant_period', 'select') then
    fallos := array_append(fallos, 'A5b: authenticated tiene SELECT sobre core.participant_period');
  end if;
  select count(*) into v_n
  from information_schema.table_privileges
  where table_schema = 'core'
    and table_name in ('participant_user_link','participant_period')
    and grantee in ('anon','authenticated','service_role');
  if v_n <> 0 then
    fallos := array_append(fallos, format('A5c: los roles cliente tienen %s privilegios sobre las relaciones nuevas', v_n));
  end if;

  -- A6 · el writer LEE y NO escribe. La ausencia de escritura es la decision:
  -- no hay comando autoritativo que escriba estas relaciones todavia.
  if not has_table_privilege('nomey_writer', 'core.participant_user_link', 'select') then
    fallos := array_append(fallos, 'A6: el writer no puede leer el vinculo');
  end if;
  if not has_table_privilege('nomey_writer', 'core.participant_period', 'select') then
    fallos := array_append(fallos, 'A6b: el writer no puede leer los periodos');
  end if;
  -- Se excluye al PROPIETARIO, que tiene todos los privilegios por definicion y
  -- es quien ejecuta las migraciones. El invariante es que NINGUN OTRO rol
  -- puede escribir estas dos relaciones por el camino normal.
  select count(*) into v_n
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  join pg_roles g on g.oid = a.grantee
  where n.nspname = 'core'
    and c.relname in ('participant_user_link','participant_period')
    and a.grantee <> c.relowner
    and a.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
  if v_n <> 0 then
    fallos := array_append(fallos, format('A6c: %s roles distintos del propietario pueden escribir las relaciones nuevas; ningun comando autoritativo lo justifica todavia', v_n));
  end if;

  -- A7 · las tres cardinalidades de ADR-012 §6 son ESTRUCTURALES, no
  -- comentarios. Se comprueba la forma en catalogo; B las ejerce.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'core.participant_user_link'::regclass and contype = 'p'
      and conkey = array[(select attnum from pg_attribute
                          where attrelid = 'core.participant_user_link'::regclass
                            and attname = 'participant_id')]
  ) then
    fallos := array_append(fallos, 'A7: la clave primaria del vinculo no es participant_id solo');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'core.participant_user_link'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (scope_id, user_id)'
  ) then
    fallos := array_append(fallos, 'A7b: falta UNIQUE (scope_id, user_id) en el vinculo');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'core.participant_user_link'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) like '%(participant_id, scope_id) REFERENCES core.participant(id, scope_id)%'
  ) then
    fallos := array_append(fallos, 'A7c: falta la FK compuesta hacia (id, scope_id) del participante');
  end if;

  -- A7d · ADR-012 §6 RETIRA expresamente UNIQUE (user_id, participant_id): no
  -- impone el invariante que su comentario declaraba.
  if exists (
    select 1 from pg_constraint
    where conrelid = 'core.participant_user_link'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (user_id, participant_id)'
  ) then
    fallos := array_append(fallos, 'A7e: reapareció UNIQUE (user_id, participant_id), que ADR-012 §6 retira');
  end if;

  -- A8 · la exclusion existe y es de tipo exclusion, no un check disfrazado.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'core.participant_period'::regclass and contype = 'x'
  ) then
    fallos := array_append(fallos, 'A8: no hay restriccion de exclusion sobre los periodos');
  end if;

  -- A9 · el participante NO ha adquirido columnas temporales. Es la
  -- alternativa E de ADR-012, descartada porque solo admite un periodo.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'core' and table_name = 'participant'
      and column_name in ('joined_at','left_at','valid_from','valid_until','user_id')
  ) then
    fallos := array_append(fallos, 'A9: core.participant adquirio una columna temporal o de usuario; ADR-012 lo descarta');
  end if;

  -- A10 · la regla generica del bloque anterior sigue en pie: ningun GRANT
  -- SELECT de core queda inutilizado por ausencia total de policy aplicable.
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
    fallos := array_append(fallos, format('A10: %s GRANT SELECT de core quedan inutilizados por ausencia de policy aplicable', v_n));
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE ESTRUCTURA:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · A · extension, forma, privilegios y catalogo';
end
$estructura$;

-- ================================ B · cardinalidades del vinculo ============
-- Como `postgres`, propietario y con BYPASSRLS: aqui se comprueban
-- CONSTRAINTS, no politicas.
do $vinculo$
declare
  fallos text[] := '{}';
  EUR constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  UA  constant uuid := '11111111-1111-4111-8111-111111111111';
  UB  constant uuid := '22222222-2222-4222-8222-222222222222';
  S1  constant uuid := '51000000-0000-4000-8000-000000000000';
  S2  constant uuid := '52000000-0000-4000-8000-000000000000';
  P1A constant uuid := 'a1a00000-0000-4000-8000-000000000000';
  P1B constant uuid := 'a1b00000-0000-4000-8000-000000000000';
  P2  constant uuid := 'a2000000-0000-4000-8000-000000000000';
  v_n int;
begin
  insert into core.currency_definition (id, code, scale) values (EUR, 'EUR', 2);
  insert into core.scope (id, kind, base_currency_definition_id) values
    (S1, 'group', EUR), (S2, 'group', EUR);
  insert into core.participant (id, scope_id, display_name) values
    (P1A, S1, 'Marta'), (P1B, S1, 'Carlos'), (P2, S2, 'Carlos');

  -- B1 · POSITIVO. Un invitado sin cuenta ya existe y participa. El vinculo
  -- llega despues, y no toca al participante.
  begin
    insert into core.participant_user_link (participant_id, scope_id, user_id)
    values (P1B, S1, UB);
  exception when others then
    fallos := array_append(fallos, format('B1: no se pudo vincular un participante existente: %s', sqlerrm));
  end;

  -- B1b · el vinculo NO modifico el participante. ADR-012 §3: reclamar es un
  -- cambio de visibilidad, no de datos.
  select count(*) into v_n from core.participant
   where id = P1B and scope_id = S1 and display_name = 'Carlos';
  if v_n <> 1 then
    fallos := array_append(fallos, 'B1b: el vinculo altero la fila del participante');
  end if;

  -- B2 · CARDINALIDAD 1 · un participante, como maximo un usuario. Un segundo
  -- usuario reclamando el mismo participante se rechaza.
  begin
    insert into core.participant_user_link (participant_id, scope_id, user_id)
    values (P1B, S1, UA);
    fallos := array_append(fallos, 'B2: un segundo usuario reclamo un participante ya vinculado');
  exception when unique_violation then null;
    when others then fallos := array_append(fallos, format('B2: sqlstate inesperado %s', sqlstate));
  end;

  -- B3 · CARDINALIDAD 2 · un usuario, como maximo un participante POR AMBITO.
  begin
    insert into core.participant_user_link (participant_id, scope_id, user_id)
    values (P1A, S1, UB);
    fallos := array_append(fallos, 'B3: un usuario represento dos participantes del mismo ambito');
  exception when unique_violation then null;
    when others then fallos := array_append(fallos, format('B3: sqlstate inesperado %s', sqlstate));
  end;

  -- B3b · POSITIVO · el MISMO usuario en ambitos DISTINTOS si es correcto, y es
  -- la propiedad que hace util que el participante sea contextual. Sin este
  -- positivo, B3 pasaria con una restriccion que prohibiese todo.
  begin
    insert into core.participant_user_link (participant_id, scope_id, user_id)
    values (P2, S2, UB);
  exception when others then
    fallos := array_append(fallos, format('B3b: se rechazo vincular al mismo usuario en otro ambito: %s', sqlerrm));
  end;

  -- B4 · CARDINALIDAD 3 · el ambito del vinculo no diverge del participante.
  begin
    insert into core.participant_user_link (participant_id, scope_id, user_id)
    values (P1A, S2, UA);
    fallos := array_append(fallos, 'B4: se acepto un vinculo cuyo ambito no es el del participante');
  exception when foreign_key_violation then null;
    when others then fallos := array_append(fallos, format('B4: sqlstate inesperado %s', sqlstate));
  end;

  -- B5 · un participante inexistente.
  begin
    insert into core.participant_user_link (participant_id, scope_id, user_id)
    values ('afffffff-0000-4000-8000-000000000000', S1, UA);
    fallos := array_append(fallos, 'B5: se acepto un vinculo hacia un participante inexistente');
  exception when foreign_key_violation then null;
    when others then fallos := array_append(fallos, format('B5: sqlstate inesperado %s', sqlstate));
  end;

  -- B6 · el instante del vinculo existe siempre. ADR-012 §10 lo fija como
  -- propiedad universal.
  select count(*) into v_n from core.participant_user_link where linked_at is null;
  if v_n <> 0 then
    fallos := array_append(fallos, 'B6: hay vinculos sin instante');
  end if;

  -- B7 · el vinculo NO es un hecho contable: no crea version, no toca efectos,
  -- no mueve el puntero de vigencia (ADR-012, compatibilidad con ADR-011).
  select count(*) into v_n from core.operation_version;
  if v_n <> 0 then
    fallos := array_append(fallos, format('B7: vincular creo %s versiones', v_n));
  end if;
  select count(*) into v_n from core.effect;
  if v_n <> 0 then
    fallos := array_append(fallos, format('B7b: vincular creo %s efectos', v_n));
  end if;

  -- B8 · el vinculo NO concede membresia. ADR-012 §8: establece identidad, no
  -- autorizacion.
  select count(*) into v_n from core.membership;
  if v_n <> 0 then
    fallos := array_append(fallos, format('B8: vincular creo %s membresias; el claim no concede acceso', v_n));
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DEL VINCULO:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · B · las tres cardinalidades del vinculo participante-cuenta';
end
$vinculo$;

-- ==================================== C · periodos de presencia =============
do $periodos$
declare
  fallos text[] := '{}';
  P1A constant uuid := 'a1a00000-0000-4000-8000-000000000000';
  P1B constant uuid := 'a1b00000-0000-4000-8000-000000000000';
  v_n int;
begin
  -- C1 · POSITIVO · entrar -> salir -> volver, con la MISMA identidad. Es el
  -- caso que ADR-012 §5 existe para permitir.
  begin
    insert into core.participant_period (participant_id, valid_from, valid_until) values
      (P1A, date '2026-01-01', date '2026-04-01'),   -- entra y sale
      (P1A, date '2026-07-01', date '2026-09-01'),   -- vuelve y sale
      (P1A, date '2026-11-01', null);                -- vuelve, abierto
  exception when others then
    fallos := array_append(fallos, format('C1: no se pudo representar entrar-salir-volver: %s', sqlerrm));
  end;
  select count(*) into v_n from core.participant_period where participant_id = P1A;
  if v_n <> 3 then
    fallos := array_append(fallos, format('C1b: hay %s periodos y deberia haber 3', v_n));
  end if;

  -- C1c · y siguen siendo UN solo participante. Entrar y volver no fragmenta la
  -- identidad.
  select count(distinct participant_id) into v_n
  from core.participant_period where participant_id = P1A;
  if v_n <> 1 then
    fallos := array_append(fallos, 'C1c: los periodos fragmentaron la identidad del participante');
  end if;

  -- C2 · POSITIVO · contiguo. La semantica [desde, hasta) hace que un periodo
  -- pueda terminar EXACTAMENTE cuando empieza otro sin solaparse.
  begin
    insert into core.participant_period (participant_id, valid_from, valid_until)
    values (P1B, date '2026-01-01', date '2026-03-01');
    insert into core.participant_period (participant_id, valid_from, valid_until)
    values (P1B, date '2026-03-01', date '2026-05-01');
  exception when others then
    fallos := array_append(fallos, format('C2: se rechazaron dos periodos contiguos: %s', sqlerrm));
  end;

  -- C3 · solape rechazado.
  begin
    insert into core.participant_period (participant_id, valid_from, valid_until)
    values (P1A, date '2026-02-01', date '2026-06-01');
    fallos := array_append(fallos, 'C3: se acepto un periodo solapado');
  exception when exclusion_violation then null;
    when others then fallos := array_append(fallos, format('C3: sqlstate inesperado %s', sqlstate));
  end;

  -- C3b · un segundo periodo ABIERTO tambien solapa con el abierto existente.
  begin
    insert into core.participant_period (participant_id, valid_from, valid_until)
    values (P1A, date '2026-12-01', null);
    fallos := array_append(fallos, 'C3b: se aceptaron dos periodos abiertos para el mismo participante');
  exception when exclusion_violation then null;
    when others then fallos := array_append(fallos, format('C3b: sqlstate inesperado %s', sqlstate));
  end;

  -- C3c · un periodo cerrado que se mete dentro del abierto.
  begin
    insert into core.participant_period (participant_id, valid_from, valid_until)
    values (P1A, date '2027-01-01', date '2027-02-01');
    fallos := array_append(fallos, 'C3c: se acepto un periodo contenido en uno abierto');
  exception when exclusion_violation then null;
    when others then fallos := array_append(fallos, format('C3c: sqlstate inesperado %s', sqlstate));
  end;

  -- C4 · POSITIVO · el MISMO intervalo para participantes DISTINTOS es valido.
  -- Sin este positivo, C3 pasaria con una exclusion que prohibiese todo.
  begin
    insert into core.participant_period (participant_id, valid_from, valid_until)
    values (P1B, date '2026-11-01', null);
  exception when others then
    fallos := array_append(fallos, format('C4: se rechazo el mismo intervalo para otro participante: %s', sqlerrm));
  end;

  -- C5 · intervalo vacio y limites invertidos.
  begin
    insert into core.participant_period (participant_id, valid_from, valid_until)
    values (P1B, date '2028-01-01', date '2028-01-01');
    fallos := array_append(fallos, 'C5: se acepto un intervalo vacio');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('C5: sqlstate inesperado %s', sqlstate));
  end;
  begin
    insert into core.participant_period (participant_id, valid_from, valid_until)
    values (P1B, date '2028-06-01', date '2028-01-01');
    fallos := array_append(fallos, 'C5b: se acepto un periodo que termina antes de empezar');
  exception when check_violation then null;
    when others then fallos := array_append(fallos, format('C5b: sqlstate inesperado %s', sqlstate));
  end;

  -- C6 · el extremo inferior es obligatorio.
  begin
    insert into core.participant_period (participant_id, valid_from, valid_until)
    values (P1B, null, date '2028-01-01');
    fallos := array_append(fallos, 'C6: se acepto un periodo sin extremo inferior');
  exception when not_null_violation then null;
    when others then fallos := array_append(fallos, format('C6: sqlstate inesperado %s', sqlstate));
  end;

  -- C7 · participante inexistente.
  begin
    insert into core.participant_period (participant_id, valid_from, valid_until)
    values ('afffffff-0000-4000-8000-000000000000', date '2026-01-01', null);
    fallos := array_append(fallos, 'C7: se acepto un periodo de un participante inexistente');
  exception when foreign_key_violation then null;
    when others then fallos := array_append(fallos, format('C7: sqlstate inesperado %s', sqlstate));
  end;

  -- C8 · la consulta de elegibilidad que la frontera autoritativa hara: una
  -- FECHA EFECTIVA contra los periodos. Es la razon de que la granularidad sea
  -- `date` y no un instante.
  select count(*) into v_n
  from core.participant_period
  where participant_id = P1A
    and daterange(valid_from, valid_until, '[)') @> date '2026-02-15';
  if v_n <> 1 then
    fallos := array_append(fallos, format('C8: la fecha dentro del primer periodo casa con %s periodos', v_n));
  end if;

  -- C8b · el extremo superior esta EXCLUIDO.
  select count(*) into v_n
  from core.participant_period
  where participant_id = P1A
    and daterange(valid_from, valid_until, '[)') @> date '2026-04-01';
  if v_n <> 0 then
    fallos := array_append(fallos, 'C8b: el extremo superior no esta excluido del intervalo');
  end if;

  -- C8c · el extremo inferior esta INCLUIDO.
  select count(*) into v_n
  from core.participant_period
  where participant_id = P1A
    and daterange(valid_from, valid_until, '[)') @> date '2026-01-01';
  if v_n <> 1 then
    fallos := array_append(fallos, 'C8c: el extremo inferior no esta incluido en el intervalo');
  end if;

  -- C8d · una fecha en el hueco entre dos periodos NO es elegible. Es lo que
  -- distingue "salio y volvio" de "estuvo todo el tiempo".
  select count(*) into v_n
  from core.participant_period
  where participant_id = P1A
    and daterange(valid_from, valid_until, '[)') @> date '2026-05-15';
  if v_n <> 0 then
    fallos := array_append(fallos, 'C8d: una fecha del hueco entre periodos resulta elegible');
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE PERIODOS:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · C · periodos: entrar, salir, volver, y sin solapes';
end
$periodos$;

-- Las vistas del camino REAL de lectura del cliente. Probar la denegacion con
-- un `select` directo sobre `core` no demostraria nada sobre estas dos tablas:
-- `authenticated` no tiene `USAGE` sobre el schema, asi que fallaria igual
-- aunque tuviera el GRANT. La unica forma de aislar la ausencia de GRANT es la
-- superficie que ADR-006 §5 fija. Desaparecen con el ROLLBACK.
create view api.chk_link   with (security_invoker = true) as select * from core.participant_user_link;
create view api.chk_period with (security_invoker = true) as select * from core.participant_period;
grant select on api.chk_link, api.chk_period to authenticated;

-- ================================= D · rol cliente y writer =================
do $roles$
declare
  fallos text[] := '{}';
  UA constant text := '11111111-1111-4111-8111-111111111111';
  P1A constant uuid := 'a1a00000-0000-4000-8000-000000000000';
  S1  constant uuid := '51000000-0000-4000-8000-000000000000';
  v_n int;
begin
  ------------------------------------------------------------- cliente ------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', UA)::text, true);

  -- D1 · POR LA SUPERFICIE REAL, el rol cliente no alcanza el vinculo. Falta el
  -- GRANT sobre la relacion base, asi que el fallo es 42501 y no una lista
  -- vacia, que es la distincion que el handoff §15 advierte.
  begin
    perform 1 from api.chk_link;
    fallos := array_append(fallos, 'D1: el rol cliente leyo el vinculo participante-cuenta');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D1: sqlstate inesperado %s', sqlstate));
  end;

  -- D2 · ni los periodos.
  begin
    perform 1 from api.chk_period;
    fallos := array_append(fallos, 'D2: el rol cliente leyo los periodos');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D2: sqlstate inesperado %s', sqlstate));
  end;

  -- D2b · y tampoco por acceso directo a `core`, donde ademas falta el `USAGE`.
  -- Son dos barreras distintas y ninguna sustituye a la otra.
  begin
    perform 1 from core.participant_user_link;
    fallos := array_append(fallos, 'D2b: el rol cliente alcanzo core.participant_user_link directamente');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D2b: sqlstate inesperado %s', sqlstate));
  end;

  -- D3 · ni escribe ninguna de las dos.
  begin
    insert into core.participant_period (participant_id, valid_from) values (P1A, date '2029-01-01');
    fallos := array_append(fallos, 'D3: el rol cliente inserto un periodo');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D3: sqlstate inesperado %s', sqlstate));
  end;
  begin
    insert into core.participant_user_link (participant_id, scope_id, user_id)
    values (P1A, S1, UA::uuid);
    fallos := array_append(fallos, 'D3b: el rol cliente se auto-vinculo a un participante');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D3b: sqlstate inesperado %s', sqlstate));
  end;

  reset role;

  -------------------------------------------------------------- writer ------
  set local role nomey_writer;
  perform set_config('request.jwt.claims', json_build_object('sub', UA)::text, true);

  -- D4 · el writer resuelve cuenta <-> participante, incluidas filas que no son
  -- del actor: la validacion alcanza al pagador y a los demas participantes.
  select count(*) into v_n from core.participant_user_link;
  if v_n < 2 then
    fallos := array_append(fallos, format('D4: el writer alcanza %s vinculos; no puede resolver cuenta-participante', v_n));
  end if;

  -- D5 · y comprueba elegibilidad en una fecha efectiva.
  select count(*) into v_n
  from core.participant_period
  where participant_id = P1A
    and daterange(valid_from, valid_until, '[)') @> date '2026-02-15';
  if v_n <> 1 then
    fallos := array_append(fallos, 'D5: el writer no puede comprobar la elegibilidad en una fecha efectiva');
  end if;

  -- D6 · el writer NO escribe estas relaciones. Ningun comando autoritativo lo
  -- justifica todavia, y un `with check (true)` aparentaria una barrera
  -- inexistente.
  begin
    insert into core.participant_period (participant_id, valid_from) values (P1A, date '2029-01-01');
    fallos := array_append(fallos, 'D6: el writer inserto un periodo sin comando que lo justifique');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D6: sqlstate inesperado %s', sqlstate));
  end;
  begin
    insert into core.participant_user_link (participant_id, scope_id, user_id)
    values (P1A, S1, UA::uuid);
    fallos := array_append(fallos, 'D6b: el writer creo un vinculo sin prueba ni comando; ADR-012 §9 lo reserva a F10');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D6b: sqlstate inesperado %s', sqlstate));
  end;
  begin
    update core.participant_user_link set user_id = UA::uuid;
    fallos := array_append(fallos, 'D6c: el writer reasigno un vinculo; el camino normal no reasigna en silencio');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D6c: sqlstate inesperado %s', sqlstate));
  end;
  begin
    delete from core.participant_period;
    fallos := array_append(fallos, 'D6d: el writer borro periodos');
  exception when insufficient_privilege then null;
    when others then fallos := array_append(fallos, format('D6d: sqlstate inesperado %s', sqlstate));
  end;

  reset role;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE ROLES:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · D · el cliente no alcanza nada y el writer solo lee';
end
$roles$;

-- ============================ E · regresiones deliberadas ===================
-- La suite debe poder fallar. Se relajan a proposito las garantias de este
-- bloque y se comprueba que la violacion OCURRE: si no ocurriera, las
-- aserciones anteriores estarian pasando por casualidad.
--
-- Todo se restaura acto seguido, y ademas la transaccion termina en ROLLBACK.
do $regresion$
declare
  fallos text[] := '{}';
  P1A constant uuid := 'a1a00000-0000-4000-8000-000000000000';
  P1B constant uuid := 'a1b00000-0000-4000-8000-000000000000';
  S1  constant uuid := '51000000-0000-4000-8000-000000000000';
  UA  constant uuid := '11111111-1111-4111-8111-111111111111';
  UB  constant uuid := '22222222-2222-4222-8222-222222222222';
  v_ok boolean;
begin
  ------------------------------------------- exclusion de solapes -----------
  alter table core.participant_period drop constraint participant_period_sin_solapes;
  v_ok := false;
  begin
    -- El mismo solape que C3 rechaza. La PK (participant_id, valid_from) no lo
    -- cubre: empieza en otra fecha.
    insert into core.participant_period (participant_id, valid_from, valid_until)
    values (P1A, date '2026-02-01', date '2026-06-01');
    v_ok := true;
  exception when others then null;
  end;
  if not v_ok then
    fallos := array_append(fallos,
      'E1: sin la exclusion el solape SIGUE rechazandose, asi que C3 no estaba probando la exclusion');
  end if;
  delete from core.participant_period
   where participant_id = P1A and valid_from = date '2026-02-01';
  alter table core.participant_period
    add constraint participant_period_sin_solapes
    exclude using gist (participant_id WITH =, daterange(valid_from, valid_until, '[)') WITH &&);

  -- E1b · y vuelve a rechazar tras restaurarla.
  begin
    insert into core.participant_period (participant_id, valid_from, valid_until)
    values (P1A, date '2026-02-01', date '2026-06-01');
    fallos := array_append(fallos, 'E1b: la exclusion no volvio a rechazar tras restaurarla');
  exception when exclusion_violation then null;
    when others then fallos := array_append(fallos, format('E1b: sqlstate inesperado %s', sqlstate));
  end;

  ------------------------------------- cardinalidad 2 del vinculo -----------
  alter table core.participant_user_link
    drop constraint participant_user_link_usuario_unico_por_ambito;
  v_ok := false;
  begin
    -- El mismo caso que B3 rechaza: UB ya representa a P1B en S1.
    insert into core.participant_user_link (participant_id, scope_id, user_id)
    values (P1A, S1, UB);
    v_ok := true;
  exception when others then null;
  end;
  if not v_ok then
    fallos := array_append(fallos,
      'E2: sin UNIQUE (scope_id, user_id) un usuario SIGUE sin poder representar dos participantes del ambito, asi que B3 no estaba probando esa restriccion');
  end if;
  delete from core.participant_user_link where participant_id = P1A;
  alter table core.participant_user_link
    add constraint participant_user_link_usuario_unico_por_ambito
    unique (scope_id, user_id);

  ------------------------------------- cardinalidad 3 del vinculo -----------
  alter table core.participant_user_link
    drop constraint participant_user_link_participante_del_ambito;
  v_ok := false;
  begin
    -- El mismo caso que B4 rechaza: P1A es de S1, no de S2.
    insert into core.participant_user_link (participant_id, scope_id, user_id)
    values (P1A, '52000000-0000-4000-8000-000000000000', UA);
    v_ok := true;
  exception when others then null;
  end;
  if not v_ok then
    fallos := array_append(fallos,
      'E3: sin la FK compuesta el ambito divergente SIGUE rechazandose, asi que B4 no estaba probando esa FK');
  end if;
  delete from core.participant_user_link where participant_id = P1A;
  alter table core.participant_user_link
    add constraint participant_user_link_participante_del_ambito
    foreign key (participant_id, scope_id) references core.participant (id, scope_id);

  ------------------------------------------ aislamiento del cliente ---------
  -- Lo unico que cierra el vinculo al cliente hoy es la ausencia de GRANT sobre
  -- la relacion base. Se comprueba POR LA SUPERFICIE REAL que concederlo abre
  -- la lectura, es decir que D1 no pasaba por casualidad.
  --
  -- Esta regresion ya sirvio una vez: con la comprobacion hecha contra `core`
  -- en directo, D1 pasaba por la falta de `USAGE` sobre el schema y no habria
  -- detectado un GRANT indebido sobre estas tablas.
  grant select on core.participant_user_link to authenticated;
  create policy tmp_regresion_link on core.participant_user_link
    for select to authenticated using (true);

  set local role authenticated;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', UA::text)::text, true);
  v_ok := false;
  begin
    perform 1 from api.chk_link;
    v_ok := true;
  exception when others then null;
  end;
  reset role;

  if not v_ok then
    fallos := array_append(fallos,
      'E4: ni con GRANT y policy el rol cliente alcanza el vinculo, asi que D1 no estaba probando la ausencia de grant');
  end if;

  drop policy tmp_regresion_link on core.participant_user_link;
  revoke select on core.participant_user_link from authenticated;

  -- E4b · y vuelve a estar cerrado.
  set local role authenticated;
  v_ok := false;
  begin
    perform 1 from api.chk_link;
    v_ok := true;
  exception when insufficient_privilege then null;
    when others then null;
  end;
  reset role;
  if v_ok then
    fallos := array_append(fallos, 'E4b: el vinculo siguio siendo legible tras revocar el grant');
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'FALLOS DE REGRESION DELIBERADA:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'OK · E · las garantias fallan cuando se relajan a proposito';
end
$regresion$;

rollback;
