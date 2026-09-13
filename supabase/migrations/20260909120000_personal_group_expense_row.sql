-- ============================================================================
-- EL GASTO DE GRUPO, VISTO DESDE PERSONAL. Una fila mas en el historial, y ni
-- un euro mas en ninguna cuenta.
-- ============================================================================
--
-- ═══════════ QUE SE ANADE, Y QUE NO ═══════════
--
-- **No se crea ninguna operacion ni ningun efecto.** El dinero ya estaba: el
-- escritor de `record_group_expense` deja en el ambito personal DEL PAGADOR un
-- efecto de saldo con la salida de caja entera, y `api.personal_balance` ya lo
-- suma —no lleva lista blanca de clases, deriva de todos los efectos vigentes—.
-- Lo unico que faltaba era que la operacion apareciera en la LISTA, cuya lista
-- blanca de `operation_class` la dejaba fuera. Esta migracion abre esa lista y
-- publica tres columnas mas. Nada mas.
--
-- ═══════════ POR QUE ESTO ES «SER EL PAGADOR» Y NO «HABER REGISTRADO» ═══════════
--
-- No hace falta ninguna condicion nueva, y ese es el punto: la vista ya estaba
-- acotada a `s.owner_user_id = auth.uid()` y a `e.balance_amount is not null`.
-- El unico efecto de saldo que un gasto de grupo produce vive en el ambito
-- personal del pagador, y el escritor lo deriva de `core.participant_user_link`
-- —nunca del autor ni del payload—. Asi que la fila aparece exactamente cuando
-- quien mira puso el dinero. Registrar un gasto que pago otro no deja efecto de
-- saldo en el ambito de quien lo registro, y por tanto no produce fila.
--
-- ═══════════ LO QUE ESTA MIGRACION NO TOCA, MEDIDO ═══════════
--
-- **Las estadisticas no cambian, y no por cuidado sino por estructura.**
-- `api.personal_statistics` filtra su desglose por `operation_class =
-- 'personal_expense'` de forma explicita, asi que una fila `group_expense` no
-- entra; y su `expense_total` sale de `api.personal_effect`, que publica
-- `economic_amount` SOLO cuando `economic_participant_id is null`. La dimension
-- economica de un gasto compartido lleva siempre participante y vive en el
-- ambito del grupo, de modo que ninguna de las dos cifras se mueve. La seccion
-- L del check lo afirma como igualdad antes y despues, no como comentario.
--
-- **`api.personal_balance` tampoco cambia**: ya incluia la salida de caja. Si
-- esta migracion anadiera un efecto, seria ahi donde se veria el duplicado.
--
-- ═══════════ LAS TRES COLUMNAS NUEVAS ═══════════
--
-- `group_scope_id` y `group_display_name` identifican el grupo de origen: sin
-- ellos la fila seria un gasto personal de 15,00 que nadie recuerda haber
-- hecho. `your_share` es la parte economica REAL de quien mira, resuelta por
-- `sec.is_my_participant` sobre el vinculo, no por su nombre ni por dividir el
-- total. Son tres hechos distintos —lo que salio de caja, lo que consumi, de
-- que grupo es— y la pantalla los tiene que poder decir por separado, que es lo
-- que `AGENTS.md` §2 exige.
--
-- Las tres se correlacionan por `o.current_version_id` y no por `ov.id`: son la
-- misma fila —`core.current_effect` proyecta la version vigente— pero solo la
-- primera esta en el `GROUP BY`, y usar la otra seria SQL invalido.

create or replace view api.personal_operation
with (security_invoker = true) as
select o.id                                as operation_id,
       o.operation_class,
       e.scope_id,
       e.currency_definition_id,
       sum(e.balance_amount)::text         as balance_amount,
       ov.original_amount::text            as original_amount,
       ov.effective_date,
       ov.effective_time,
       md.concept,
       xc.category_id,
       ad.target_balance::text             as target_balance,
       o.current_version_id,
       ov.supersedes_version_id            as previous_version_id,
       ov.version_no,
       o.created_at                        as operation_created_at,
       -- El ambito de grupo de esta misma operacion, si lo tiene.
       (select ce.scope_id
          from core.current_effect ce
          join core.scope g on g.id = ce.scope_id and g.kind = 'group'
         where ce.operation_version_id = o.current_version_id
         limit 1)                          as group_scope_id,
       (select gp.display_name
          from core.current_effect ce
          join core.scope g on g.id = ce.scope_id and g.kind = 'group'
          join core.group_profile gp on gp.scope_id = g.id
         where ce.operation_version_id = o.current_version_id
         limit 1)                          as group_display_name,
       -- Mi parte economica. Del vinculo, nunca del reparto ni del total.
       (select sum(ge.economic_amount)::text
          from core.current_effect ge
         where ge.operation_version_id = o.current_version_id
           and ge.economic_amount is not null
           and sec.is_my_participant(ge.economic_participant_id)) as your_share
  from core.current_effect e
  join core.operation_version ov on ov.id = e.operation_version_id
  join core.operation o on o.id = ov.operation_id
  join core.scope s on s.id = e.scope_id
  left join core.movement_detail md on md.operation_version_id = ov.id
  left join core.expense_category xc on xc.operation_version_id = ov.id
  left join core.adjustment_detail ad on ad.operation_version_id = ov.id
 where s.kind = 'personal'
   and s.owner_user_id = (select auth.uid())
   and o.operation_class = any (array['personal_expense',
                                      'personal_income',
                                      'adjustment',
                                      'group_expense'])
   and ov.version_kind = 'record'
   and e.balance_amount is not null
 group by o.id, o.operation_class, e.scope_id, e.currency_definition_id,
          ov.original_amount, ov.effective_date, ov.effective_time,
          md.concept, xc.category_id, ad.target_balance,
          o.current_version_id, ov.supersedes_version_id, ov.version_no,
          o.created_at;

comment on view api.personal_operation is
  'El historial personal, una fila por operacion vigente. Incluye el gasto de '
  'grupo del que quien mira fue PAGADOR —la unica clase ajena al ambito que '
  'deja efecto de saldo en el—, con su grupo de origen y su parte economica. '
  'No produce ni un efecto: el dinero ya lo escribio record_group_expense.';
