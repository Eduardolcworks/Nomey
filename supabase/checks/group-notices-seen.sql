-- ============================================================================
-- LA CAMPANA DA POR VISTOS LOS AVISOS AL ABRIRSE · api.mark_group_notices_seen
-- ============================================================================
--
-- Fixtures propios, en una transaccion que termina en ROLLBACK. Dos grupos,
-- dos destinatarios, y un aviso posterior a la visita. Las secciones:
--
--   A · catalogo y privilegios
--   B · entrar marca los pendientes hasta la frontera, incluidos los antiguos
--   C · un aviso posterior a la frontera sigue pendiente aunque la llamada
--       llegue tarde
--   D · aislamiento: la frontera de otro no sirve, lo de otro no se toca, y
--       un grupo del que ya no se es miembro queda fuera
--   E · nada se borra ni se re-marca
\pset pager off
\set ON_ERROR_STOP on
begin;

create function pg_temp.actor(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text)::text, true),
         set_config('role', 'authenticated', true);
$$;
create function pg_temp.super() returns void language sql as $$
  select set_config('role', 'postgres', true);
$$;
grant execute on function pg_temp.actor(uuid), pg_temp.super() to authenticated;

create temp table fx as select
  '830e6f7e-2e33-564e-9ea3-f6c2023af1fe'::uuid as eur,
  'a3500000-0000-4000-8000-0000000000a1'::uuid as edu,
  'a3500000-0000-4000-8000-0000000000b1'::uuid as ana,
  'a3500000-0000-4000-8000-000000000010'::uuid as g1,
  'a3500000-0000-4000-8000-000000000011'::uuid as g2,
  'a3500000-0000-4000-8000-000000000021'::uuid as n_old,     -- Edu, g1, hace 3 dias
  'a3500000-0000-4000-8000-000000000022'::uuid as n_mid,     -- Edu, g1, hace 1 dia (la frontera)
  'a3500000-0000-4000-8000-000000000023'::uuid as n_g2,      -- Edu, g2, hace 2 dias
  'a3500000-0000-4000-8000-000000000024'::uuid as n_ana,     -- Ana, g1, hace 2 dias
  'a3500000-0000-4000-8000-000000000025'::uuid as n_read,    -- Edu, g1, hace 4 dias, ya leido
  'a3500000-0000-4000-8000-000000000026'::uuid as n_late,    -- Edu, g1, despues de la frontera
  'a3500000-0000-4000-8000-0000000000e1'::uuid as ajeno;
grant select on fx to authenticated;

do $f$
declare r fx%rowtype;
begin
  select * into r from fx;
  perform pg_temp.super();
  insert into core.scope (id, kind, base_currency_definition_id, owner_user_id) values
    (r.g1, 'group', r.eur, null), (r.g2, 'group', r.eur, null);
  insert into core.membership (scope_id, user_id) values (r.g1, r.edu), (r.g1, r.ana), (r.g2, r.edu);
  insert into core.group_notice (id, recipient_user_id, scope_id, kind, subject_id, actor_user_id, occurred_at, read_at) values
    (r.n_old,  r.edu, r.g1, 'edit',    gen_random_uuid(), r.ana, now() - interval '3 days', null),
    (r.n_mid,  r.edu, r.g1, 'profile', gen_random_uuid(), r.ana, now() - interval '1 day',  null),
    (r.n_g2,   r.edu, r.g2, 'edit',    gen_random_uuid(), r.ana, now() - interval '2 days', null),
    (r.n_ana,  r.ana, r.g1, 'edit',    gen_random_uuid(), r.edu, now() - interval '2 days', null),
    (r.n_read, r.edu, r.g1, 'edit',    gen_random_uuid(), r.ana, now() - interval '4 days', now() - interval '4 days');
end
$f$;

-- ============================ A · catalogo ===================================
do $a$
declare fallos text[] := '{}'; v_t text;
begin
  select pg_get_userbyid(p.proowner) || ':' || (case when p.prosecdef then 'definer' else 'invoker' end) into v_t
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname = 'mark_group_notices_seen';
  if v_t is distinct from 'postgres:definer' then fallos := array_append(fallos, 'A1 mark_group_notices_seen: ' || coalesce(v_t, 'ausente')); end if;
  if has_function_privilege('anon', 'api.mark_group_notices_seen(uuid)', 'EXECUTE') then
    fallos := array_append(fallos, 'A2 anon puede ejecutarla');
  end if;
  if not has_function_privilege('authenticated', 'api.mark_group_notices_seen(uuid)', 'EXECUTE') then
    fallos := array_append(fallos, 'A2b authenticated no puede ejecutarla');
  end if;
  if array_length(fallos, 1) is not null then raise exception E'A · catalogo:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'A · catalogo y privilegios: OK';
end
$a$;

-- ============================ B · entrar marca hasta la frontera =============
do $b$
declare fallos text[] := '{}'; r fx%rowtype; v_n int;
begin
  select * into r from fx;
  perform pg_temp.actor(r.edu);
  select api.mark_group_notices_seen(r.n_mid) into v_n;
  if v_n <> 3 then fallos := array_append(fallos, format('B1 marco %s y eran 3 (old, mid, g2)', v_n)); end if;
  perform pg_temp.super();
  select count(*) into v_n from core.group_notice where recipient_user_id = r.edu and read_at is null;
  if v_n <> 0 then fallos := array_append(fallos, format('B2 a Edu le quedan %s pendientes', v_n)); end if;
  -- el antiguo, fuera de cualquier primera pagina, tambien
  select count(*) into v_n from core.group_notice where id = r.n_old and read_at is not null;
  if v_n <> 1 then fallos := array_append(fallos, 'B3 el aviso antiguo sigue pendiente'); end if;
  -- y el de otro grupo del que tambien es miembro
  select count(*) into v_n from core.group_notice where id = r.n_g2 and read_at is not null;
  if v_n <> 1 then fallos := array_append(fallos, 'B4 el aviso del otro grupo sigue pendiente'); end if;
  if array_length(fallos, 1) is not null then raise exception E'B · frontera:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'B · entrar marca los pendientes hasta la frontera, antiguos incluidos: OK';
end
$b$;

-- ============================ C · un aviso posterior sigue pendiente =========
do $c$
declare fallos text[] := '{}'; r fx%rowtype; v_n int;
begin
  select * into r from fx;
  perform pg_temp.super();
  -- llega despues de que el cliente cargara la lista (frontera = n_mid)
  insert into core.group_notice (id, recipient_user_id, scope_id, kind, subject_id, actor_user_id, occurred_at)
  values (r.n_late, r.edu, r.g1, 'departure', gen_random_uuid(), r.ana, now());
  -- y la llamada de la visita anterior llega tarde, con la frontera de entonces
  perform pg_temp.actor(r.edu);
  select api.mark_group_notices_seen(r.n_mid) into v_n;
  if v_n <> 0 then fallos := array_append(fallos, format('C1 la llamada tardia marco %s', v_n)); end if;
  perform pg_temp.super();
  select count(*) into v_n from core.group_notice where id = r.n_late and read_at is null;
  if v_n <> 1 then fallos := array_append(fallos, 'C2 el aviso posterior se dio por visto por la carrera'); end if;
  if array_length(fallos, 1) is not null then raise exception E'C · posterior:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'C · un aviso posterior a la frontera sigue pendiente aunque la llamada llegue tarde: OK';
end
$c$;

-- ============================ D · aislamiento ================================
do $d$
declare fallos text[] := '{}'; r fx%rowtype; v_n int;
begin
  select * into r from fx;
  -- D1 · la frontera de OTRO no sirve: Ana con el aviso de Edu no marca nada
  perform pg_temp.actor(r.ana);
  select api.mark_group_notices_seen(r.n_late) into v_n;
  if v_n <> 0 then fallos := array_append(fallos, format('D1 Ana marco %s con una frontera ajena', v_n)); end if;
  perform pg_temp.super();
  select count(*) into v_n from core.group_notice where id = r.n_ana and read_at is null;
  if v_n <> 1 then fallos := array_append(fallos, 'D1b el aviso de Ana cambio con una frontera ajena'); end if;
  -- D2 · Edu, con su frontera nueva, no toca lo de Ana
  perform pg_temp.actor(r.edu);
  select api.mark_group_notices_seen(r.n_late) into v_n;
  if v_n <> 1 then fallos := array_append(fallos, format('D2 Edu marco %s y era 1', v_n)); end if;
  perform pg_temp.super();
  select count(*) into v_n from core.group_notice where recipient_user_id = r.ana and read_at is null;
  if v_n <> 1 then fallos := array_append(fallos, 'D2b lo de Ana se toco'); end if;
  -- D3 · un desconocido, con cualquier frontera, no marca nada
  perform pg_temp.actor(r.ajeno);
  select api.mark_group_notices_seen(r.n_ana) into v_n;
  if v_n <> 0 then fallos := array_append(fallos, format('D3 un ajeno marco %s', v_n)); end if;
  -- D4 · Ana ya no es miembro de g1: su aviso de g1 queda fuera aunque sea suyo
  perform pg_temp.super();
  delete from core.membership where scope_id = r.g1 and user_id = r.ana;
  perform pg_temp.actor(r.ana);
  select api.mark_group_notices_seen(r.n_ana) into v_n;
  if v_n <> 0 then fallos := array_append(fallos, format('D4 Ana marco %s en un grupo del que salio', v_n)); end if;
  perform pg_temp.super();
  if array_length(fallos, 1) is not null then raise exception E'D · aislamiento:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'D · aislamiento: frontera ajena, avisos ajenos y grupo abandonado: OK';
end
$d$;

-- ============================ E · nada se borra ni se re-marca ===============
do $e$
declare fallos text[] := '{}'; r fx%rowtype; v_n int; v_ts timestamptz;
begin
  select * into r from fx;
  perform pg_temp.super();
  select count(*) into v_n from core.group_notice where recipient_user_id in (r.edu, r.ana);
  if v_n <> 6 then fallos := array_append(fallos, format('E1 quedan %s avisos y eran 6', v_n)); end if;
  select read_at into v_ts from core.group_notice where id = r.n_read;
  if v_ts > now() - interval '3 days' then fallos := array_append(fallos, 'E2 un aviso ya leido se re-marco'); end if;
  if array_length(fallos, 1) is not null then raise exception E'E · conservacion:\n%', array_to_string(fallos, E'\n'); end if;
  raise notice 'E · nada se borra ni se re-marca: OK';
end
$e$;

rollback;
