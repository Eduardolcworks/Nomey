-- =========================================================================
-- F6.E · Estadisticas agregadas del Modo Personal
--
-- ADR-026, que SUPERSEDE el «cuatro objetos y ni uno mas» de ADR-025 §1 y NADA
-- MAS. Las cuatro superficies de F6.D siguen intactas y con su papel.
--
-- ================== POR QUE HACE FALTA UNA QUINTA SUPERFICIE ===============
--
-- Inicio muestra, para el intervalo elegido, el total de ingresos, el total de
-- gastos y el reparto por categoria. Ninguna superficie existente lo entrega
-- agregado: `api.personal_effect` y `api.personal_operation` son fila por
-- efecto y fila por operacion, y `api.personal_balance` agrega el ambito
-- entero, no un intervalo.
--
-- Y agregarlo en el cliente NO es una alternativa, medido contra este stack:
--
--   PostgREST 16.1 · funciones de agregado DESHABILITADAS
--     select=...sum()  ->  PGRST123 · 400 «Use of aggregate functions is not allowed»
--   max_rows = 1000  ->  tope DURO por peticion
--
-- Con eso, `Año` o `Todo` por encima de mil operaciones devolverian una cifra
-- contable INCOMPLETA que no falla. Es el modo de fallo que AGENTS.md §1 y §2
-- existen para impedir. Habilitar los agregados globalmente en PostgREST se
-- descarto por lo contrario: aflojaria TODA la Data API para resolver un
-- problema local.
--
-- ========================= NO ES UNA CACHE, Y SE VE =======================
--
-- No persiste nada, no se escribe nunca y no tiene fila propia: es una
-- consulta con nombre sobre las dos vistas que ya existen. Cada llamada vuelve
-- a derivar de `core.current_effect` a traves de ellas, asi que no hay nada
-- que sincronizar y no puede desincronizarse. Es la misma naturaleza que
-- `api.personal_balance`, que tambien agrega y tambien es derivada.
--
-- ============== LAS DOS SUPERFICIES, Y POR QUE CADA UNA ====================
--
--   TOTALES        `api.personal_effect`, que ADR-025 §2 conserva justamente
--                  como semantica estadistica. `accounting_class` YA expresa
--                  autoritativamente que cuenta como ingreso y que como gasto
--                  (ADR-002 §4), asi que aqui no se decide otra vez con una
--                  segunda aritmetica: se suma `economic_amount` agrupando por
--                  esa clase.
--
--   CATEGORIAS     `api.personal_operation`, que es la unica superficie que
--                  expone `category_id` de las operaciones personales
--                  vigentes, y que ya trae de F6.D la lista blanca de clases,
--                  el filtro de propiedad y la exclusion de anuladas.
--
-- POR QUE ESO NO CREA UNA SEGUNDA AUTORIDAD ECONOMICA, y esta es la parte que
-- hay que entender antes de tocar nada. Se leyeron las ocho funciones
-- autoritativas para comprobar QUE escribe cada una en un ambito personal:
--
--   personal_expense    balance −  y ECONOMICA +   clase `expense`
--   personal_income     balance +  y ECONOMICA +   clase `income`
--   adjustment          balance solo               clase `adjustment`
--   external/internal   balance solo               clase `transfer`
--   group_expense       en el personal del pagador, BALANCE SOLO. Sin economica
--   debt_settlement     deuda, nunca economica personal
--   settlement_by_transfer  balance y deuda, nunca economica personal
--
-- De donde se sigue que la dimension economica de un ambito personal la
-- producen EXACTAMENTE `record_personal_expense` y `record_personal_income`, y
-- que eso seguira siendo cierto cuando F9 traiga los Grupos: un gasto de Grupo
-- mueve la caja del pagador sin aportar economica a su Modo Personal.
--
-- Por tanto los dos caminos describen EL MISMO conjunto de hechos, y no dos
-- versiones de la verdad. El check §D lo AFIRMA en vez de confiarlo: la suma
-- de las categorias tiene que ser identica a `expense_total`, hasta la unidad
-- minima. Si algun dia dejaran de coincidir, es que alguien introdujo la
-- segunda autoridad que este comentario dice que no existe.
--
-- Los ajustes quedan fuera de estadisticas SIN NINGUNA CLAUSULA que los
-- excluya: no producen dimension economica, asi que `sum(economic_amount)` no
-- los ve. La lista de admitidos de ADR-002 §4 es estructural aqui.
--
-- ============================== EL INTERVALO ==============================
--
-- `[p_from, p_to]`, CERRADO por los dos extremos, sobre `effective_date`.
-- Cualquiera de los dos puede ser nulo: nulo es «sin limite por ese lado», y
-- los dos nulos son `Todo`.
--
-- CERRADO y no semiabierto, a diferencia de `core.participant_period`, que es
-- `[valid_from, valid_until)`. No es una incoherencia: aquel modela un PERIODO
-- de elegibilidad, donde uno empieza justo cuando acaba el anterior; esto
-- filtra DIAS de calendario, y «agosto» significa del 1 al 31 inclusive. Con
-- el semiabierto habria que pasar el 1 de septiembre para pedir agosto, que es
-- exactamente la ambiguedad que este contrato evita.
--
-- Y NO ENTRA NINGUN CONCEPTO DE UI: no hay `day | month | year` aqui dentro.
-- El cliente traduce su selector a dos fechas y la funcion recibe el intervalo
-- ya resuelto. Un dia concreto es `p_from = p_to`.
--
-- `effective_date` es el eje, y es lo que ADR-020 §3 fija con esas palabras.
-- `effective_time` NO participa: es reloj de pared local y solo ordena dentro
-- del dia.
--
-- ============================ FORMA DE LA RESPUESTA ========================
--
-- Un unico `jsonb`, para que la home resuelva las tres cifras en UNA peticion.
--
--   NULL                   el actor no tiene Modo Personal. Misma senal que
--                          las cero filas de `api.personal_balance`, y el
--                          cliente ya tiene que distinguirla para el
--                          provisioning
--   totales a "0" y []     hay ambito y no hay movimientos en el intervalo
--
-- El caso `expense_total = "0"` queda asi definido y sin ambiguedad: la lista
-- de categorias viene VACIA, porque una categoria solo aparece si hubo gasto y
-- `record_personal_expense` rechaza importes <= 0. El cliente no divide por
-- cero ni inventa porcentaje: pinta su estado vacio.
--
-- EL PORCENTAJE NO SE CALCULA AQUI, y es deliberado: `category_expense` y
-- `expense_total` son exactos y el cliente obtiene el reparto de su cociente
-- sin perder informacion. Devolver un porcentaje redondeado desde SQL seria
-- fabricar un dato derivado con menos precision que sus operandos.
--
-- TODO IMPORTE SALE COMO TEXTO tambien dentro del `jsonb` (ADR-008 §1). El
-- check A5 del catalogo cuenta columnas `bigint` y no ve dentro de un `jsonb`,
-- asi que §B4 lo comprueba sobre el valor devuelto.
--
-- ================================ PRIVILEGIOS =============================
--
-- `SECURITY INVOKER`, como `api.observed_balance` y por el mismo motivo: esta
-- lectura NO debe atravesar la RLS. Se apoya en dos vistas `security_invoker`
-- que ya filtran por propiedad, asi que un actor sin ambito obtiene NULL y uno
-- ajeno no alcanza nada.
--
-- `BEGIN ATOMIC` porque ADR-013 §9 lo exige para las funciones de lectura
-- economicas: es la unica forma que deja las dependencias analizables en el
-- catalogo. Asi la guarda que vigila `core.effect` tambien cubre esto, y se ve
-- que depende de las dos vistas y de NINGUNA tabla de `core`.
--
-- NINGUN GRANT NUEVO SOBRE `core`.
-- =========================================================================

create function api.personal_statistics(
  p_from date default null,
  p_to   date default null
)
returns jsonb
language sql
stable
set search_path = ''
begin atomic
  select jsonb_build_object(
    'scope_id',               ps.id,
    'currency_definition_id', ps.base_currency_definition_id,
    'from',                   p_from,
    'to',                     p_to,

    -- Los totales, por la semantica estadistica de `api.personal_effect`. La
    -- clase la pone el efecto; aqui no se reinterpreta ninguna.
    --
    -- `economic_amount` cruza `api` como texto por ADR-008 §1 y se devuelve a
    -- `bigint` para sumar: el texto es la frontera del salto JSON, no una
    -- perdida, y el viaje de ida y vuelta dentro de SQL es exacto. Sumar sobre
    -- el texto seria imposible y sumar en coma flotante seria inaceptable.
    'income_total', coalesce((
      select sum(pe.economic_amount::bigint)
        from api.personal_effect pe
       where pe.scope_id = ps.id
         and pe.accounting_class = 'income'
         and pe.economic_amount is not null
         and (p_from is null or pe.effective_date >= p_from)
         and (p_to   is null or pe.effective_date <= p_to)), 0)::text,

    'expense_total', coalesce((
      select sum(pe.economic_amount::bigint)
        from api.personal_effect pe
       where pe.scope_id = ps.id
         and pe.accounting_class = 'expense'
         and pe.economic_amount is not null
         and (p_from is null or pe.effective_date >= p_from)
         and (p_to   is null or pe.effective_date <= p_to)), 0)::text,

    -- El reparto, por `api.personal_operation`, que es donde vive la categoria.
    -- COMPLETO y ordenado de mayor a menor: el «top 4» es una decision de
    -- presentacion y no se hornea aqui, porque la tarjeta despliega el resto y
    -- necesitaria el resto de todas formas.
    --
    -- `original_amount` y no `balance_amount`: es el importe DECLARADO, en
    -- positivo, que es la misma magnitud que `economic_amount` de un gasto. Con
    -- el saldo firmado el reparto saldria en negativo y no cuadraria con
    -- `expense_total`.
    'categories', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'category_id',     g.category_id,
                 'expense_total',   g.total::text,
                 'operation_count', g.operations)
               -- Desempate por identificador: sin el, dos categorias empatadas
               -- podrian intercambiarse entre dos llamadas y la tarjeta
               -- parpadearia sin que nada hubiera cambiado.
               order by g.total desc, g.category_id)
        from (
          select po.category_id,
                 sum(po.original_amount::bigint) as total,
                 count(*)::integer               as operations
            from api.personal_operation po
           where po.scope_id = ps.id
             and po.operation_class = 'personal_expense'
             and po.category_id is not null
             and (p_from is null or po.effective_date >= p_from)
             and (p_to   is null or po.effective_date <= p_to)
           group by po.category_id
        ) g), '[]'::jsonb)
  )
  from api.personal_scope ps;
end;

comment on function api.personal_statistics(date, date) is
  'Estadisticas del Modo Personal en un intervalo CERRADO de fechas efectivas. Derivada, nunca materializada. NULL = el actor no tiene ambito (ADR-026).';

revoke execute on function api.personal_statistics(date, date) from public;
grant  execute on function api.personal_statistics(date, date) to authenticated;
