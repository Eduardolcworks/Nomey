-- Serializacion y observacion de la dimension SALDO · F6.C, primera parte.
--
-- Decimotercera migracion real. Trae la infraestructura, sin tocar todavia
-- ninguna funcion `api.*`: el renombrado del lock, los dos helpers de derivacion
-- y las dos relaciones nuevas. Las ocho funciones se reescriben en la migracion
-- siguiente, del mismo commit.
--
-- Evidencia que la motiva: `supabase/e22/`.
--
-- ===================== POR QUE EL LOCK DEJA DE LLAMARSE DE DEUDA ===========
--
-- `sec.lock_debt_scopes` nunca supo nada de deuda: bloquea filas de `core.scope`
-- en orden ascendente y falla ruidosamente si el `SELECT ... FOR UPDATE`
-- devuelve cero filas, que es el modo que E20 midio que NO da error. El
-- mecanismo ya era agnostico de la dimension; solo el nombre estaba atado.
--
-- ADR-013 §11 fija que la pertenencia al protocolo se decide «por que efectos
-- produce, no por el nombre de la clase». F6.C aplica ese mismo criterio a la
-- dimension SALDO, asi que el protocolo pasa a ser uno solo con dos dimensiones
-- y **un unico orden global ascendente**. Mantener dos nombres para un mismo
-- mecanismo invitaria a creer que son dos ordenes distintos, que es exactamente
-- como se construye un deadlock.

drop function sec.lock_debt_scopes(uuid[]);

create function sec.lock_scopes(p_scopes uuid[])
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_scope  uuid;
  v_locked uuid;
begin
  for v_scope in
    select distinct s from unnest(p_scopes) as s where s is not null order by 1
  loop
    select sc.id into v_locked from core.scope sc where sc.id = v_scope for update;
    -- Cero filas aqui NO significa «el ambito no existe»: su existencia ya se
    -- comprobo antes. Significa que falta la policy o el privilegio de UPDATE,
    -- que es el fallo que E20 midio que NO da error. Se convierte en ruidoso a
    -- proposito: continuar seria validar y escribir sobre datos que la
    -- transaccion cree haber protegido.
    if v_locked is null then
      raise exception
        'no se pudo bloquear el ambito % para serializar saldo y deuda (ADR-013 §11): falta la policy o el privilegio de UPDATE del writer',
        v_scope;
    end if;
  end loop;
end
$fn$;

comment on function sec.lock_scopes(uuid[]) is
  'Pasos 2-3 de ADR-013 §11, para saldo Y deuda: bloquea las filas estables de los ambitos afectados, en un unico orden ascendente por identificador.';

revoke execute on function sec.lock_scopes(uuid[]) from public;
grant  execute on function sec.lock_scopes(uuid[]) to nomey_writer;

-- ==================== 2 · el saldo, derivado de la proyeccion ==============
--
-- LA PIEZA CENTRAL, y la que responde a la pregunta de secuencia: como obtener
-- el saldo SIN la version que se sustituye, antes de haber persistido la nueva.
--
-- La respuesta no necesita ninguna estructura nueva: en el instante de corregir,
-- **el puntero de vigencia todavia no se ha movido**, asi que la version
-- sustituida ES la vigente y sus efectos estan DENTRO de `core.current_effect`.
-- Basta excluirla por `operation_version_id` sobre la propia proyeccion
-- canonica. No hay que leer `core.effect`, no hay que restar nada por fuera, y
-- no aparece ninguna segunda fuente de verdad.
--
-- Un solo helper cubre los tres usos del protocolo:
--
--   balance_before               sin excluir nada, antes de escribir
--   balance_without_superseded   excluyendo la version que se sustituye
--   balance_after                sin excluir nada, DESPUES de mover el puntero
--
-- `BEGIN ATOMIC` y no cuerpo textual: ADR-013 §9 lo exige para las funciones de
-- lectura economicas, porque es la unica forma que deja las dependencias
-- analizables en el catalogo. Asi la guarda que vigila quien depende de
-- `core.effect` tambien cubre esto, y se ve que lee la PROYECCION y no la tabla.

create function sec.derive_balance(p_scope uuid, p_exclude_version uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
begin atomic
  select coalesce(sum(e.balance_amount), 0)::bigint
    from core.current_effect e
   where e.scope_id = p_scope
     and e.balance_amount is not null
     and (p_exclude_version is null or e.operation_version_id <> p_exclude_version);
end;

comment on function sec.derive_balance(uuid, uuid) is
  'Saldo de un ambito derivado de la proyeccion canonica, opcionalmente excluyendo una version. Solo es cierto bajo el lock de ADR-013 §11.';

revoke execute on function sec.derive_balance(uuid, uuid) from public;
grant  execute on function sec.derive_balance(uuid, uuid) to nomey_writer;

-- Los ambitos en los que la version indicada dejo dimension de SALDO. Es la
-- mitad del conjunto a bloquear en una CORRECCION o en una ANULACION: sin ella,
-- sacar un ambito de la intencion —o quitarle todos sus efectos— lo dejaria
-- fuera del lock justo cuando su saldo cambia.
--
-- Analogo exacto de `sec.debt_scopes_of_version`, y lee la proyeccion canonica
-- por la misma razon.
create function sec.balance_scopes_of_version(p_version uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
begin atomic
  select coalesce(array_agg(distinct e.scope_id), '{}'::uuid[])
    from core.current_effect e
   where e.operation_version_id = p_version
     and e.balance_amount is not null;
end;

comment on function sec.balance_scopes_of_version(uuid) is
  'Ambitos donde una version dejo dimension de saldo. La mitad del conjunto a bloquear en una correccion o anulacion (ADR-013 §11).';

revoke execute on function sec.balance_scopes_of_version(uuid) from public;
grant  execute on function sec.balance_scopes_of_version(uuid) to nomey_writer;

-- ===================== 3 · el objetivo declarado, como intencion ===========
--
-- `target_balance` es INTENCION, no resultado: la persona declara «ahora mismo
-- tengo X». El delta que hace falta para llegar ahi es DERIVADO, y es lo que
-- viaja como `original_amount` de la version y como importe del efecto —igual
-- que en un ajuste por delta, de modo que esa columna conserva un unico
-- significado.
--
-- Va en relacion aparte y no como columna de la version por la misma razon que
-- concepto y categoria (ADR-020): **no toda version lo tiene**. Un ajuste por
-- delta no declara objetivo, y ninguna de las otras siete clases tampoco.
-- Presente donde el hecho existe, ausente donde no.
--
-- SEMANTICA, y conviene que quede sin ambiguedad:
--
--   `target_balance` es el saldo que la persona declara tener EN EL MOMENTO DE
--   RECONCILIAR. NO es «el saldo que tenia en un instante historico elegido».
--
-- De ahi se sigue lo que F6.C NO hace, y no por olvido: no reconstruye saldos
-- `as-of`, no recalcula ajustes anteriores cuando despues se introduce un
-- movimiento con fecha previa, y no reabre un ajuste ya escrito. La hora
-- efectiva del ajuste representa el momento declarado de esa reconciliacion y
-- **no convierte el objetivo en un saldo historico que haya que reconstruir**.

create table core.adjustment_detail (
  operation_version_id uuid   not null primary key
    references core.operation_version (id),
  target_balance       bigint not null
);

comment on table core.adjustment_detail is
  'Objetivo declarado de un ajuste por saldo objetivo. Intencion, no resultado: el delta se deriva bajo lock. Ausente en un ajuste por delta (ADR-022).';
comment on column core.adjustment_detail.target_balance is
  'Saldo que la persona declara tener AL RECONCILIAR. No es un saldo historico as-of, y nada lo recalcula despues.';

-- ====================== 4 · la observacion historica de saldo ==============
--
-- ADR-013 §1 dice que no hay CACHE economica en v1, y esto no la introduce. La
-- distincion es la que decide si esta relacion es legitima:
--
--   una CACHE se lee para responder la pregunta ACTUAL, y por eso puede
--   desincronizarse;
--
--   una OBSERVACION registra lo que el sistema calculo en un instante, se
--   escribe una vez, NUNCA se lee para responder la pregunta actual, y por
--   tanto no puede desincronizarse: no hay nada con que sincronizarla.
--
-- Y esa distincion se hace EXIGIBLE, no prometida:
--
--   · POR AMBITO, no por version: una operacion puede alcanzar varios y el saldo
--     es de cada uno.
--   · POR VERSION: una correccion escribe filas nuevas y NUNCA toca las
--     anteriores. Nada que sincronizar.
--   · INSERT-ONLY: sin UPDATE ni DELETE para nadie, writer incluido.
--   · GUARDA DE CATALOGO: ninguna vista ni funcion de `api` que produzca el
--     Disponible puede depender de ella. Con regresion deliberada.
--   · El nombre lo dice en los dos lados: `balance_observation` aqui, y
--     `observed_balance_after` cuando salga por `api`.
--
-- Solo se escribe en ambitos con dimension de SALDO. Un Grupo no tiene saldo
-- propio (`data-model.md` §2), asi que no recibe filas vacias.

create table core.balance_observation (
  operation_version_id   uuid   not null references core.operation_version (id),
  scope_id               uuid   not null references core.scope (id),
  currency_definition_id uuid   not null,
  balance_before         bigint not null,
  balance_after          bigint not null,

  constraint balance_observation_pk primary key (operation_version_id, scope_id),

  -- La observacion esta en la MONEDA BASE del ambito, con la misma FK compuesta
  -- que gobierna a `core.effect`. Sin ella, una observacion podria quedar en una
  -- moneda que el ambito nunca tuvo.
  constraint balance_observation_moneda_del_ambito
    foreign key (scope_id, currency_definition_id)
    references core.scope (id, base_currency_definition_id)
);

comment on table core.balance_observation is
  'Fotografia del saldo antes y despues de una version, por ambito. OBSERVACION historica, NUNCA fuente del Disponible ni de estadisticas (ADR-023).';
comment on column core.balance_observation.balance_before is
  'Saldo del ambito inmediatamente antes de esta version, bajo lock. Congelado: corregir otra operacion no lo altera.';

-- =============================== 5 · RLS ===================================

alter table core.adjustment_detail    enable row level security;
alter table core.balance_observation  enable row level security;

-- Misma regla de visibilidad que `core.movement_detail`: se ve el detalle de una
-- version de la que se ve algun efecto.
grant select on core.adjustment_detail to authenticated;

create policy adjustment_detail_client_select on core.adjustment_detail
  for select to authenticated
  using (
    exists (
      select 1 from core.effect e
      where e.operation_version_id = adjustment_detail.operation_version_id
        and sec.is_member(e.scope_id)
    )
  );

-- La observacion se ve por MEMBRESIA DEL AMBITO, que es mas directo: la fila ya
-- nombra su ambito y no hace falta derivarlo de los efectos.
grant select on core.balance_observation to authenticated;

create policy balance_observation_client_select on core.balance_observation
  for select to authenticated
  using (sec.is_member(scope_id));

-- El writer: lee para derivar, escribe una vez, y NO puede modificar ni borrar.
grant select, insert on core.adjustment_detail   to nomey_writer;
grant select, insert on core.balance_observation to nomey_writer;

create policy adjustment_detail_writer_select on core.adjustment_detail
  for select to nomey_writer using (true);

create policy balance_observation_writer_select on core.balance_observation
  for select to nomey_writer using (true);

-- Misma forma que `effect_writer_insert` y `movement_detail_writer_insert`: la
-- version referida debe estar atribuida al actor de la peticion.
create policy adjustment_detail_writer_insert on core.adjustment_detail
  for insert to nomey_writer
  with check (
    exists (
      select 1 from core.operation_version ov
      where ov.id = adjustment_detail.operation_version_id
        and ov.created_by = sec.request_actor_id()
    )
  );

create policy balance_observation_writer_insert on core.balance_observation
  for insert to nomey_writer
  with check (
    exists (
      select 1 from core.operation_version ov
      where ov.id = balance_observation.operation_version_id
        and ov.created_by = sec.request_actor_id()
    )
  );

-- ==================== 6 · escribir la observacion, en un sitio =============
--
-- Se llama DOS veces por escritura: una antes de persistir la version —para
-- capturar el `before` con el puntero aun sin mover— y otra despues, para el
-- `after`. Las dos bajo el mismo lock, y las dos derivando de la PROYECCION
-- CANONICA, de modo que ninguna de las dos cifras puede divergir de la
-- definicion de saldo.
--
-- No se calcula `after = before + delta`: seria aritmetica paralela que podria
-- equivocarse donde la proyeccion no. Dos lecturas de la misma fuente cuestan
-- una agregacion mas y no admiten esa clase de error.

-- Conjunto de ambitos normalizado: sin nulos, sin repetidos y en orden
-- ascendente. Hace falta porque en una CORRECCION la intencion nueva y la
-- version sustituida nombran casi siempre EL MISMO ambito, y la union ingenua lo
-- traeria dos veces. `sec.lock_scopes` ya normalizaba por dentro; la observacion
-- no puede, porque su array debe seguir alineado con el de saldos previos.
--
-- El orden ascendente no es cosmetico: es el MISMO que usa el lock, de modo que
-- el conjunto que se bloquea y el que se observa son literalmente la misma lista.
create function sec.normalize_scopes(p_scopes uuid[])
returns uuid[]
language sql
immutable
set search_path = ''
begin atomic
  select coalesce(array_agg(distinct s order by s), '{}'::uuid[])
    from unnest(p_scopes) as s
   where s is not null;
end;

comment on function sec.normalize_scopes(uuid[]) is
  'Ambitos sin nulos, sin repetidos y en orden ascendente: el mismo orden global que usa el lock (ADR-013 §11).';

revoke execute on function sec.normalize_scopes(uuid[]) from public;
grant  execute on function sec.normalize_scopes(uuid[]) to nomey_writer;

-- El «antes» de cada ambito, medido BAJO LOCK y antes de escribir nada. Se
-- separa de `observe_balances` porque los dos momentos no son el mismo: este
-- corre con el puntero de vigencia aun sin mover, y el otro despues.
create function sec.balances_before(p_scopes uuid[])
returns bigint[]
language sql
stable
security definer
set search_path = ''
begin atomic
  select coalesce(array_agg(sec.derive_balance(s, null) order by s), '{}'::bigint[])
    from unnest(sec.normalize_scopes(p_scopes)) as s;
end;

comment on function sec.balances_before(uuid[]) is
  'Saldo de cada ambito ANTES de la escritura, en el mismo orden del array. Solo es cierto bajo el lock de ADR-013 §11.';

revoke execute on function sec.balances_before(uuid[]) from public;
grant  execute on function sec.balances_before(uuid[]) to nomey_writer;

create function sec.observe_balances(
  p_version uuid,
  p_scopes  uuid[],
  p_before  bigint[]
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  i int;
  v_scope uuid;
  v_norm uuid[];
begin
  -- NORMALIZA con el mismo helper que , de modo que los
  -- dos arrays quedan alineados por construccion y ningun llamante puede
  -- desalinearlos. En una CORRECCION la intencion nueva y la version sustituida
  -- nombran casi siempre el MISMO ambito, y la union ingenua lo traeria dos
  -- veces: sin esto, la clave primaria de la observacion salta.
  v_norm := sec.normalize_scopes(p_scopes);
  if array_length(v_norm, 1) is null then
    return;
  end if;
  for i in 1 .. array_length(v_norm, 1) loop
    v_scope := v_norm[i];
    insert into core.balance_observation
      (operation_version_id, scope_id, currency_definition_id, balance_before, balance_after)
    select p_version, v_scope, s.base_currency_definition_id,
           p_before[i], sec.derive_balance(v_scope, null)
      from core.scope s where s.id = v_scope;
  end loop;
end
$fn$;

comment on function sec.observe_balances(uuid, uuid[], bigint[]) is
  'Escribe la observacion de saldo de una version. El `antes` llega ya medido bajo lock; el `despues` se deriva aqui, tras mover el puntero (ADR-023).';

revoke execute on function sec.observe_balances(uuid, uuid[], bigint[]) from public;
grant  execute on function sec.observe_balances(uuid, uuid[], bigint[]) to nomey_writer;
