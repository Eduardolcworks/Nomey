-- E15-C · Modelo minimo para medir la carrera de la deuda pendiente.
--
-- La regla de `data-model.md` §3 dice que una liquidacion nunca supera la deuda
-- pendiente. Derivar esa deuda y consumirla son DOS pasos, y entre ellos cabe
-- otra transaccion.
--
-- Deuda inicial: 3000 unidades minimas. Dos liquidaciones simultaneas de 2000.
-- Si ambas pasan, el resultado es un sobrepago de -1000 que ninguna validacion
-- vio.
--
-- El modelo fisico real es D9 y NO se decide aqui: `e15_scope` es solo una fila
-- estable sobre la que bloquear.
--
-- Idempotente. NO ES UNA MIGRACION.

\pset pager off
begin;

drop table if exists public.e15_debt_effect;
drop table if exists public.e15_scope;
drop function if exists public.e15_settle(text, bigint);

create table public.e15_scope (
  scope_id uuid primary key
);

create table public.e15_debt_effect (
  id       bigserial primary key,
  scope_id uuid not null references public.e15_scope(scope_id),
  debtor   uuid not null,
  creditor uuid not null,
  delta    bigint not null          -- positivo nace deuda, negativo la liquida
);

insert into public.e15_scope values ('33333333-3333-3333-3333-333333333333');
insert into public.e15_debt_effect(scope_id, debtor, creditor, delta)
values ('33333333-3333-3333-3333-333333333333',
        '44444444-4444-4444-4444-444444444444',
        '55555555-5555-5555-5555-555555555555',
        3000);

-- Tres modos de serializacion sobre el mismo cuerpo.
--   'ninguno'   -> control: demuestra la carrera
--   'fila'      -> SELECT ... FOR UPDATE sobre la fila del ambito
--   'advisory'  -> pg_advisory_xact_lock por clave derivada del par de deuda
create function public.e15_settle(p_modo text, p_importe bigint)
returns text language plpgsql as $$
declare
  v_scope    uuid := '33333333-3333-3333-3333-333333333333';
  v_debtor   uuid := '44444444-4444-4444-4444-444444444444';
  v_creditor uuid := '55555555-5555-5555-5555-555555555555';
  v_pendiente bigint;
begin
  if p_modo = 'fila' then
    perform 1 from public.e15_scope where scope_id = v_scope for update;
  elsif p_modo = 'advisory' then
    perform pg_advisory_xact_lock(
      hashtext(v_scope::text || v_debtor::text || v_creditor::text));
  end if;

  select coalesce(sum(delta), 0) into v_pendiente
  from public.e15_debt_effect
  where scope_id = v_scope and debtor = v_debtor and creditor = v_creditor;

  -- La ventana de la carrera: entre derivar y consumir.
  perform pg_sleep(1);

  if p_importe > v_pendiente then
    return 'RECHAZADA · pendiente=' || v_pendiente || ' intento=' || p_importe;
  end if;

  insert into public.e15_debt_effect(scope_id, debtor, creditor, delta)
  values (v_scope, v_debtor, v_creditor, -p_importe);

  return 'ACEPTADA · pendiente_visto=' || v_pendiente || ' liquidado=' || p_importe;
end $$;

commit;

\echo '=== deuda inicial ==='
select coalesce(sum(delta),0) as pendiente from public.e15_debt_effect;
