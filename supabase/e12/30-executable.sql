-- E12 · Privilegio EJECUTABLE: intentar de verdad cada operacion como el rol.
--
-- Un privilegio listado no demuestra nada hasta que se intenta la operacion.
-- Cada bloque hace `set local role`, intenta, y registra el resultado o el
-- mensaje de error EXACTO de PostgreSQL.
--
-- NO ES UNA MIGRACION.

\pset pager off

create temporary table e12_resultado (
  n serial, prueba text, rol text, veredicto text, detalle text
);

-- ---------------------------------------------------------------------------
-- 1 · SELECT sin GRANT
-- ---------------------------------------------------------------------------
do $$
declare r record; v int;
begin
  for r in select unnest(array['anon','authenticated']) as rol loop
    begin
      execute format('set local role %I', r.rol);
      execute 'select count(*) from public.e12_public_plain' into v;
      reset role;
      insert into e12_resultado(prueba, rol, veredicto, detalle)
        values ('SELECT sobre public.e12_public_plain', r.rol, 'PUDO', v::text);
    exception when others then
      reset role;
      insert into e12_resultado(prueba, rol, veredicto, detalle)
        values ('SELECT sobre public.e12_public_plain', r.rol, 'DENEGADO', sqlerrm);
    end;
    reset role;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · TRUNCATE sobre tabla SIN RLS
-- ---------------------------------------------------------------------------
do $$
declare r record; v int;
begin
  for r in select unnest(array['anon','authenticated']) as rol loop
    begin
      execute format('set local role %I', r.rol);
      execute 'truncate table public.e12_public_plain';
      reset role;
      execute 'select count(*) from public.e12_public_plain' into v;
      insert into e12_resultado(prueba, rol, veredicto, detalle)
        values ('TRUNCATE sobre public.e12_public_plain', r.rol, 'PUDO',
                'filas restantes: ' || v::text);
      insert into public.e12_public_plain values (1, 'fila de sondeo');
    exception when others then
      reset role;
      insert into e12_resultado(prueba, rol, veredicto, detalle)
        values ('TRUNCATE sobre public.e12_public_plain', r.rol, 'DENEGADO', sqlerrm);
    end;
    reset role;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · TRUNCATE sobre tabla CON RLS ACTIVADA Y SIN POLITICA
--     Prueba si la RLS protege frente a TRUNCATE.
-- ---------------------------------------------------------------------------
do $$
declare v int;
begin
  begin
    set local role anon;
    execute 'truncate table public.e12_public_rls';
    reset role;
    execute 'select count(*) from public.e12_public_rls' into v;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('TRUNCATE sobre tabla con RLS activada y SIN politica', 'anon', 'PUDO',
              'filas restantes: ' || v::text);
    insert into public.e12_public_rls values (1, 'protegida por RLS sin politica');
  exception when others then
    reset role;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('TRUNCATE sobre tabla con RLS activada y SIN politica', 'anon', 'DENEGADO', sqlerrm);
  end;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · DELETE sobre la misma tabla, para contrastar con TRUNCATE
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    set local role anon;
    execute 'delete from public.e12_public_rls';
    reset role;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('DELETE sobre tabla con RLS activada y SIN politica', 'anon', 'PUDO', '');
  exception when others then
    reset role;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('DELETE sobre tabla con RLS activada y SIN politica', 'anon', 'DENEGADO', sqlerrm);
  end;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- 5 · REFERENCES: crear una FK que apunte a la tabla de public
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    set local role anon;
    execute 'create table e12_playground.e12_fk_probe (id integer primary key, ref integer references public.e12_public_plain(id))';
    reset role;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('REFERENCES: crear FK hacia public.e12_public_plain', 'anon', 'PUDO',
              'tabla e12_playground.e12_fk_probe creada por anon');
  exception when others then
    reset role;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('REFERENCES: crear FK hacia public.e12_public_plain', 'anon', 'DENEGADO', sqlerrm);
  end;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- 6 · Consecuencia de la FK: el owner de la tabla referenciada queda bloqueado
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    execute 'insert into e12_playground.e12_fk_probe values (1, 1)';
    execute 'delete from public.e12_public_plain where id = 1';
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('postgres borra una fila referenciada por la FK de anon', 'postgres', 'PUDO', '');
    execute 'insert into public.e12_public_plain values (1, ''fila de sondeo'')';
  exception when others then
    reset role;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('postgres borra una fila referenciada por la FK de anon', 'postgres', 'BLOQUEADO', sqlerrm);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 7 · TRIGGER: anon crea una funcion propia y la engancha a la tabla de public
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    set local role anon;
    execute 'create function e12_playground.e12_spy() returns trigger language plpgsql security invoker as $f$ begin insert into e12_playground.e12_trigger_log(quien) values (current_user || '' / '' || session_user); return new; end $f$';
    execute 'create trigger e12_spy_trg after insert on public.e12_public_plain for each row execute function e12_playground.e12_spy()';
    reset role;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('TRIGGER: anon engancha su codigo a una tabla de public', 'anon', 'PUDO',
              'trigger e12_spy_trg creado');
  exception when others then
    reset role;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('TRIGGER: anon engancha su codigo a una tabla de public', 'anon', 'DENEGADO', sqlerrm);
  end;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- 8 · El trigger de anon se ejecuta cuando escribe postgres?
-- ---------------------------------------------------------------------------
do $$
declare quien text;
begin
  begin
    execute 'insert into public.e12_public_plain values (99, ''escrita por postgres'')';
    select l.quien into quien from e12_playground.e12_trigger_log l order by l.id desc limit 1;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('El codigo de anon corre en la sesion de postgres', 'postgres',
              case when quien is null then 'NO SE EJECUTO' else 'SE EJECUTO' end,
              coalesce('current_user / session_user dentro del trigger: ' || quien, 'sin registro'));
    execute 'delete from public.e12_public_plain where id = 99';
  exception when others then
    reset role;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('El codigo de anon corre en la sesion de postgres', 'postgres', 'ERROR', sqlerrm);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 9 · MAINTAIN: ANALYZE sobre una tabla sin SELECT
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    set local role anon;
    execute 'analyze public.e12_public_plain';
    reset role;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('MAINTAIN: ANALYZE sobre public.e12_public_plain', 'anon', 'PUDO', '');
  exception when others then
    reset role;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('MAINTAIN: ANALYZE sobre public.e12_public_plain', 'anon', 'DENEGADO', sqlerrm);
  end;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- 10 · Secuencia: nextval y setval con solo UPDATE
-- ---------------------------------------------------------------------------
do $$
declare v bigint;
begin
  begin
    set local role anon;
    execute 'select nextval(''public.e12_public_serial_id_seq'')' into v;
    reset role;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('nextval sobre la secuencia de public', 'anon', 'PUDO', 'valor: ' || v::text);
  exception when others then
    reset role;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('nextval sobre la secuencia de public', 'anon', 'DENEGADO', sqlerrm);
  end;
  reset role;

  begin
    set local role anon;
    execute 'select setval(''public.e12_public_serial_id_seq'', 1)' into v;
    reset role;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('setval sobre la secuencia de public', 'anon', 'PUDO', 'reiniciada a ' || v::text);
  exception when others then
    reset role;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('setval sobre la secuencia de public', 'anon', 'DENEGADO', sqlerrm);
  end;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- 11 · EXECUTE sobre funciones sin GRANT explicito
-- ---------------------------------------------------------------------------
do $$
declare r record; v text;
begin
  for r in select unnest(array[
              'public.e12_public_fn()',
              'e12_playground.e12_usable_fn()',
              'e12_internal.e12_internal_fn()']) as fn loop
    begin
      set local role anon;
      execute 'select ' || r.fn into v;
      reset role;
      insert into e12_resultado(prueba, rol, veredicto, detalle)
        values ('EXECUTE ' || r.fn || ' sin GRANT explicito', 'anon', 'PUDO', v);
    exception when others then
      reset role;
      insert into e12_resultado(prueba, rol, veredicto, detalle)
        values ('EXECUTE ' || r.fn || ' sin GRANT explicito', 'anon', 'DENEGADO', sqlerrm);
    end;
    reset role;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 12 · Acceso al schema no expuesto por SQL directo
-- ---------------------------------------------------------------------------
do $$
declare v int;
begin
  begin
    set local role anon;
    execute 'select count(*) from e12_internal.e12_internal_plain' into v;
    reset role;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('SELECT sobre e12_internal.e12_internal_plain', 'anon', 'PUDO', v::text);
  exception when others then
    reset role;
    insert into e12_resultado(prueba, rol, veredicto, detalle)
      values ('SELECT sobre e12_internal.e12_internal_plain', 'anon', 'DENEGADO', sqlerrm);
  end;
  reset role;
end $$;

\echo '=== RESULTADOS ==='
select n, prueba, rol, veredicto, detalle from e12_resultado order by n;
