-- E15-A · Como mapea PostgREST v16.1 un error de PostgreSQL a HTTP.
--
-- Objetivo: poder transportar codigos estables SIN depender del mensaje humano.
-- NO fija el contrato: solo mide que llega al cliente en cada forma.
--
-- Idempotente. NO ES UNA MIGRACION.

\pset pager off
begin;

drop function if exists public.e15_raise_default();
drop function if exists public.e15_raise_p0001();
drop function if exists public.e15_raise_privilege();
drop function if exists public.e15_raise_unique();
drop function if exists public.e15_raise_check();
drop function if exists public.e15_raise_pgrst();

-- 1 · RAISE EXCEPTION sin errcode: PostgreSQL asigna P0001 por defecto.
create function public.e15_raise_default() returns void language plpgsql as $$
begin
  raise exception 'SETTLEMENT_EXCEEDS_DEBT';
end $$;

-- 2 · P0001 explicito, con message / detail / hint separados.
create function public.e15_raise_p0001() returns void language plpgsql as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'SETTLEMENT_EXCEEDS_DEBT',
    detail  = 'Se intenta liquidar 3100 sobre una deuda pendiente de 3000',
    hint    = 'codigo estable en message; detail es humano';
end $$;

-- 3 · SQLSTATE de privilegio insuficiente.
create function public.e15_raise_privilege() returns void language plpgsql as $$
begin
  raise exception using errcode = '42501', message = 'NOT_A_MEMBER';
end $$;

-- 4 · SQLSTATE de violacion de unicidad, el candidato natural a "conflicto".
create function public.e15_raise_unique() returns void language plpgsql as $$
begin
  raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_REUSED';
end $$;

-- 5 · SQLSTATE de violacion de CHECK.
create function public.e15_raise_check() returns void language plpgsql as $$
begin
  raise exception using errcode = '23514', message = 'SPLIT_EXACT_AMOUNTS_MISMATCH';
end $$;

-- 6 · Bloque PGRST: forma documentada de fijar status y cuerpo sin hacks.
create function public.e15_raise_pgrst() returns void language plpgsql as $$
begin
  raise sqlstate 'PGRST' using
    message = '{"code":"IDEMPOTENCY_KEY_REUSED","message":"clave reutilizada con otra intencion"}',
    detail  = '{"status":409,"headers":{}}';
end $$;

commit;

notify pgrst, 'reload schema';

\echo ''
\echo '=== funciones de sondeo creadas ==='
select proname from pg_proc where proname like 'e15%' order by 1;
