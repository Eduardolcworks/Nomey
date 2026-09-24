import { describe, expect, it } from 'vitest';

import SCREEN from '../../src/app/group/[id].tsx?raw';
import NOTIFICATIONS from '../../src/app/notifications.tsx?raw';
import TABS from '../../src/app/(tabs)/_layout.tsx?raw';
import LAYOUT from '../../src/app/_layout.tsx?raw';
import PREVIEW from '../../src/features/groups/group-transfer-preview.tsx?raw';
import ROW from '../../src/features/groups/group-transfer-row.tsx?raw';
import SERVICE from '../../src/features/groups/group-transfer-service.ts?raw';
import HOOKS from '../../src/features/groups/use-group-transfers.ts?raw';
import SUGGESTED from '../../src/features/groups/suggested-payments-card.tsx?raw';
import ROW_BALANCE from '../../src/features/groups/group-balance-row.tsx?raw';
import MODE from '../../src/features/groups/group-transfer-mode.tsx?raw';
import FORM_EXPENSE from '../../src/features/groups/shared-expense-form.tsx?raw';
import SELECTOR from '../../src/features/groups/expense-kind-selector.tsx?raw';
import TICK from '../../src/features/groups/participant-tick.tsx?raw';
import SPLIT_CARD from '../../src/features/groups/split-participants-card.tsx?raw';
import COLOURS from '../../src/ui/theme/colors.ts?raw';
import SHEET from '../../src/ui/components/amount-sheet.tsx?raw';
import DOMAIN from '../../src/features/groups/group-transfer.ts?raw';
import TIMELINE from '../../src/features/groups/group-timeline.ts?raw';
import MOVEMENTS from '../../src/features/groups/use-group-movements.ts?raw';
import OPERATION from '../../supabase/migrations/20261006120000_group_transfer_operation.sql?raw';
import CANDIDATES from '../../supabase/migrations/20261007120000_group_transfer_candidates.sql?raw';
import CHECK from '../../supabase/checks/group-transfer-client.sql?raw';
import CI from '../../.github/workflows/ci.yml?raw';
import TYPES from '../../src/types/database.ts?raw';
import ES from '../../src/lib/i18n/messages/es-ES.ts?raw';
import EN from '../../src/lib/i18n/messages/en.ts?raw';
import {
  absoluteMinor,
  exceedsDebt,
  netAfterTransfer,
  standingOf,
  transferableCandidates,
} from '../../src/features/groups/group-transfer';

/**
 * F12.C3 — LA TRANSFERENCIA DE GRUPO, DE UNA VOLUNTAD (F12/ADR-007).
 *
 * El contrato de propuestas de B3 se retiró del producto al validarlo a mano:
 * un participante SIN CUENTA no podía siquiera aparecer en la lista, porque no
 * había quien aceptara ni Personal al que abonar. Y un grupo con un fantasma
 * es el caso normal, no el raro.
 *
 * Lo que se fija, por orden de lo que más duele si se rompe:
 *
 *   1 · el álgebra de la deuda, que es la única lógica del cliente;
 *   2 · que el FANTASMA funcione, que es lo que motivó el cambio;
 *   3 · que la caja sea sólo la del emisor;
 *   4 · que sea UNA llamada atómica, sin propuestas ni aceptación;
 *   5 · que «Saldado», el Gasto y las transferencias Personal sigan igual.
 *
 * Sin renderer: se lee el fuente y se afirma sobre su estructura. Las cuatro
 * funciones puras sí se ejecutan.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('1 · el álgebra: D_after = D − N', () => {
  /*
   * LOS CINCO CASOS, y son la misma resta. El importe se aplica COMPLETO: sin
   * `min(N, deuda)`, sin partir en dos y sin tope. Es lo que hace que 30 sobre
   * una deuda de 20 INVIERTA la relación en vez de «saldar y sobrar 10».
   */
  it('parcial, exacta, sobrepago, sin deuda previa y deuda inversa', () => {
    expect(netAfterTransfer('2000', '500')).toBe('1500');
    expect(netAfterTransfer('2000', '2000')).toBe('0');
    expect(netAfterTransfer('2000', '3000')).toBe('-1000');
    expect(netAfterTransfer('0', '1500')).toBe('-1500');
    expect(netAfterTransfer('-1000', '500')).toBe('-1500');
  });

  it('el signo es la mitad del significado, y el importe se dice sin él', () => {
    expect(standingOf('2000')).toBe('owing');
    expect(standingOf('-2000')).toBe('owed');
    expect(standingOf('0')).toBe('settled');
    expect(absoluteMinor('-2000')).toBe('2000');
    expect(absoluteMinor('2000')).toBe('2000');
  });

  /*
   * SÓLO AVISA CUANDO PUEDE SORPRENDER: se superó una deuda que existía. Sin
   * deuda previa, o con la deuda ya invertida, cualquier importe la aumenta y
   * el propio resultado lo dice; un aviso ahí sería ruido.
   */
  it('el aviso de sobrepago es exactamente el caso que sorprende', () => {
    expect(exceedsDebt('2000', '3000')).toBe(true);
    expect(exceedsDebt('2000', '2000')).toBe(false);
    expect(exceedsDebt('2000', '500')).toBe(false);
    expect(exceedsDebt('0', '1500')).toBe(false);
    expect(exceedsDebt('-1000', '500')).toBe(false);
  });

  it('el neto viene del servidor, y nadie recalcula deuda aquí', () => {
    expect(SERVICE).toContain("supabase.rpc('group_transfer_candidates'");
    expect(CANDIDATES).toContain('sec.net_debt(p_group, v_sender, p.id, null)');
    // Ni una suma de efectos ni de operaciones en el cliente.
    expect(code(HOOKS)).not.toMatch(/current_effect|debt_amount|sum\(/);
  });
});

/**
 * ═══════════ 2 · EL FANTASMA ═══════════
 *
 * El caso que motivó el cambio entero. Recibir una transferencia de grupo es
 * recibir una operación económica del grupo, y el receptor autoritativo es el
 * PARTICIPANTE: ni cuenta, ni username, ni Modo Personal, ni amistad.
 */
describe('2 · un participante sin cuenta recibe como cualquiera', () => {
  it('el veredicto son las reglas del GRUPO, y ninguna mira una cuenta', () => {
    expect(CANDIDATES).toContain('create function sec.group_transfer_state(');
    // Del ámbito, no fusionado, no retirado, con presencia vigente, no uno mismo.
    expect(CANDIDATES).toContain('core.participant_merge');
    expect(CANDIDATES).toContain('core.participant_retirement');
    expect(CANDIDATES).toContain('core.participant_period');
    expect(CANDIDATES).toContain("when p_receiver = p_sender then 'self'");
    /*
     * Y NINGUNA de: vínculo con cuenta, username, Personal, amistad o la
     * moneda de un Personal ajeno. El veredicto del receptor no las mira.
     */
    const verdict = CANDIDATES.slice(
      CANDIDATES.indexOf('create function sec.group_transfer_state('),
      CANDIDATES.indexOf('comment on function sec.group_transfer_state'),
    );
    expect(verdict).not.toMatch(
      /participant_user_link|account_handle|personal_scope|friendship|assert_no_conversion/,
    );
  });

  it('el writer aplica las MISMAS tres guardas a cada receptor, y ninguna más', () => {
    const loop = OPERATION.slice(
      OPERATION.indexOf('foreach v_from in array v_receivers loop'),
      OPERATION.indexOf('  v_from := null;'),
    );
    expect(loop).toContain('sec.assert_participant_eligible(v_from, v_group, v_date)');
    expect(loop).toContain('sec.assert_participant_not_retired(v_from, v_group)');
    expect(loop).toContain('sec.assert_participant_active(v_from, v_group)');
    expect(loop).toContain("'DEBT_SELF_REFERENCE'");
    expect(loop).not.toMatch(/participant_user_link|handle|personal_scope|USERNAME_REQUIRED/);
  });

  /** Y del receptor no se resuelve cuenta ni Personal por ningún lado. */
  it('del receptor no se resuelve cuenta ni Personal', () => {
    const writer = OPERATION.slice(OPERATION.indexOf('create function api.record_group_transfer'));
    // Sólo se resuelve el Personal del EMISOR, y sólo para su caja.
    expect(writer.match(/sec\.participant_personal_scope\(/g) ?? []).toHaveLength(1);
    expect(writer).toContain('v_from := sec.participant_personal_scope(v_sender);');
  });

  it('el cliente enseña a todos los `ready`, sin distinguir quién tiene cuenta', () => {
    expect(transferableCandidates([])).toEqual([]);
    expect(
      transferableCandidates([
        { participantId: 'a', displayName: 'Gus', state: 'ready', netMinor: '0' },
        { participantId: 'b', displayName: 'Yo', state: 'self', netMinor: '0' },
        { participantId: 'c', displayName: 'Nora', state: 'unavailable', netMinor: '0' },
      ]).map((one) => one.displayName),
    ).toEqual(['Gus']);
    // Ni insignia de fantasma, ni «sin cuenta», ni nada que lo señale.
    expect(code(MODE)).not.toMatch(/ghost|fantasma|isLinked|hasAccount/i);
  });
});

describe('3 · la caja es SOLO la del emisor', () => {
  it('un efecto de balance, por el total, en el Personal de quien registra', () => {
    expect(OPERATION).toContain(
      "values (gen_random_uuid(), v_version, v_from, 'transfer', v_currency, - v_total);",
    );
    // UNO, no N: el bucle de receptores sólo escribe deuda y reparto.
    const loop = OPERATION.slice(
      OPERATION.indexOf('for i in 1 .. v_n loop'),
      OPERATION.indexOf('perform sec.observe_balances('),
    );
    expect(loop).toContain('debt_amount, debt_debtor_participant_id, debt_creditor_participant_id');
    expect(loop).not.toContain('balance_amount');
  });

  /**
   * NADA ENTRA EN EL PERSONAL DE UN RECEPTOR, y es la diferencia entera con
   * `settlement_by_transfer`: allí las dos partes habían consentido, aquí no.
   */
  it('ningún efecto en el Personal de ningún receptor', () => {
    const writer = OPERATION.slice(OPERATION.indexOf('create function api.record_group_transfer'));
    expect(writer.match(/balance_amount/g) ?? []).toHaveLength(1);
    expect(writer).not.toMatch(/to_scope_id|receiver_personal/);
  });

  /** Y el débito es CAJA, no consumo: no produce dimensión económica. */
  it('ni Gasto para el emisor ni Ingreso para nadie', () => {
    const writer = OPERATION.slice(OPERATION.indexOf('create function api.record_group_transfer'));
    expect(writer).not.toContain('economic_amount');
    expect(CHECK).toContain('G · ni Gasto para el emisor ni Ingreso para el receptor');
  });
});

describe('4 · una voluntad, una llamada, todo o nada', () => {
  it('el cliente llama a UN comando, y no existe ningún otro', () => {
    expect(SERVICE).toContain("supabase.rpc('record_group_transfer'");
    expect(code(SERVICE)).not.toMatch(
      /create_group_transfer_proposal|cancel_group_transfer|decline_group_transfer|record_settlement_by_transfer/,
    );
    expect(MODE).toContain('.record(');
  });

  /**
   * NI PROPUESTA, NI ACEPTACIÓN, NI RECHAZO, NI CANCELACIÓN. No es que estén
   * escondidos: no hay código de cliente que los nombre.
   */
  it('no queda nada de pendientes en el cliente', () => {
    /*
     * En Notificaciones SÍ quedan `proposalId`: son las de PERSONAL (F12.C1),
     * que siguen siendo de dos voluntades y no se tocan. Lo que no puede
     * quedar es nada de GRUPO.
     */
    for (const source of [MODE, SERVICE, HOOKS, SCREEN]) {
      expect(code(source)).not.toMatch(/proposalId|GroupTransferNotice|GroupTransferCard/);
    }
    expect(code(NOTIFICATIONS)).not.toMatch(/GroupTransfer|groupTransfer/);
    expect(TABS).not.toMatch(/groupTransfer/i);
    expect(code(LAYOUT)).not.toContain('wakeGroupTransfers');
    for (const cat of [ES, EN]) {
      expect(cat).not.toContain("'group.transferPending'");
      expect(cat).not.toContain("'group.transferIncoming'");
      expect(cat).not.toContain("'group.transferAcceptTitle'");
      expect(cat).not.toContain("'group.transferGone'");
    }
  });

  /**
   * ATÓMICO DE VERDAD, no un bucle cliente. Se manda el TOTAL y los ids; si
   * algo falla, la transacción entera se deshace y no hay envío parcial que
   * contar.
   */
  it('multi-destinatario es UNA operación, no N llamadas', () => {
    expect(SERVICE).toContain('readonly receiver_participant_ids: readonly string[];');
    expect(MODE).toContain('chosen.map((one) => one.participantId)');
    // Ni bucle, ni parcial, ni clave por receptor.
    expect(code(HOOKS)).not.toMatch(/createMany|partial|failed\.push/);
    expect(code(MODE)).not.toMatch(/transferPartial|outcome\.sent/);
    for (const cat of [ES, EN]) expect(cat).not.toContain("'group.transferPartial'");
  });

  /** UNA clave de idempotencia, conservada entre reintentos. */
  it('una sola clave, y el doble envío se corta con una referencia', () => {
    expect(HOOKS).toContain('const key = useRef<string | null>(null);');
    expect(HOOKS).toContain('key.current ??= newClientOperationId();');
    expect(HOOKS).toContain('const inFlight = useRef(false);');
    expect(HOOKS).toContain('if (inFlight.current) return');
    // Y se suelta al confirmarse: volver a enviar ya es otra intención.
    expect(HOOKS).toContain('key.current = null;');
  });

  /** El reparto AUTORITATIVO es del servidor; el del cliente es la vista previa. */
  it('el reparto lo hace el servidor con la regla canónica', () => {
    expect(OPERATION).toContain('sec.allocate_by_largest_remainder(');
    expect(OPERATION).toContain('array(select 1::bigint from generate_series(1, v_n))');
    // El payload NO lleva cuotas.
    const payload = SERVICE.slice(
      SERVICE.indexOf('export type RecordGroupTransferPayload'),
      SERVICE.indexOf('export async function sendRecordGroupTransfer'),
    );
    expect(code(payload)).not.toMatch(/amount(s|Minor)|share/i);
    expect(DOMAIN).toContain('splitEvenly(totalMinor, count)');
  });

  /**
   * Y LOS DOS REPARTOS COINCIDEN PORQUE EL ORDEN ES EL MISMO: el canónico del
   * servidor —entrada al grupo— es el que `api.group_transfer_candidates`
   * entrega, y el cliente lo conserva.
   */
  it('cliente y servidor reparten sobre el mismo orden', () => {
    expect(CANDIDATES).toContain('order by p.created_at, p.id');
    expect(OPERATION).toContain(
      'select array_agg(p.id order by p.created_at, p.id) into v_receivers',
    );
    expect(MODE).toContain('(choices ?? []).filter((one) => selected.includes(one.participantId))');
  });
});

describe('5 · lo que se rehusa, y cómo se dice', () => {
  it('el importe que no llega a una unidad menor por cabeza', () => {
    expect(OPERATION).toContain("'TRANSFER_AMOUNT_TOO_SMALL'");
    expect(DOMAIN).toContain('tooSmallToSplit(totalMinor, count)');
    expect(MODE).toContain("t('group.transferTooSmall')");
    expect(ES).toContain("'group.transferTooSmall':");
    expect(EN).toContain("'group.transferTooSmall':");
  });

  it('cada fallo con su frase, y el transporte con la suya', () => {
    expect(MODE).toContain("t('group.transferOffline')");
    expect(MODE).toContain("t('group.transferCurrencyMismatch')");
    expect(MODE).toContain("t('group.transferFailed')");
  });

  it('corregir no existe: se anula y se registra otra', () => {
    expect(OPERATION).toContain("'TRANSFER_NOT_EDITABLE'");
    expect(OPERATION).toContain(
      "if v_clase = 'group_transfer' and p_version_kind is distinct from 'annulment' then",
    );
    expect(code(MODE)).not.toMatch(/operation_id|expected_version_id/);
  });

  it('duplicados, lista vacía y uno mismo, rehusados en el servidor', () => {
    expect(OPERATION).toContain('un destinatario no puede repetirse en la misma transferencia');
    expect(OPERATION).toContain('una transferencia necesita al menos un destinatario');
    expect(CHECK).toContain('J · self, ajeno, retirado, fusionado, salido');
  });
});

describe('6 · el CTA: la puerta, y el cable hasta la llamada', () => {
  /**
   * ═══════ LA PUERTA VIVE EN UNA FUNCIÓN PURA, Y POR UN MOTIVO ═══════
   *
   * Estuvo suelta entre ternarios dentro del render, y así se coló un
   * bloqueo que ninguna prueba podía ver: exigía `amountComplete` —«los
   * decimales están TERMINADOS»— cuando lo que hacía falta era «hay un
   * importe». Escribir `10` enseña `10,00 €` y el botón no se encendía.
   *
   * `tests/lib/group-transfer-cta.test.ts` la EJECUTA caso por caso. Aquí se
   * fija que la pantalla no tenga otra.
   */
  it('la decide `transferSubmission`, y el modo no vuelve a juzgar nada', () => {
    expect(MODE).toContain(
      'const submission = transferSubmission(entry, currency.scale, chosen.length);',
    );
    expect(MODE).toContain('const blocked = submission.blocker !== null || sending;');
    expect(MODE).toContain('saveDisabled={blocked}');
    // Ni aritmética ni condiciones de importe sueltas en el render.
    expect(code(MODE)).not.toMatch(/amountComplete|toMinorUnits|tooSmallToSplit/);
  });

  /**
   * Y LA PUERTA NO PUEDE MIRAR AL RECEPTOR: recibe el importe, la escala y
   * CUÁNTOS hay. Nada de quién es cada uno — no llega por ningún parámetro.
   */
  it('nada de la cuenta del receptor entra en la puerta', () => {
    expect(DOMAIN).toContain('export function transferSubmission(');
    const gate = DOMAIN.slice(DOMAIN.indexOf('export function transferSubmission('), DOMAIN.length);
    expect(gate).not.toMatch(/isLinked|handle|username|personal|friend|state/i);
    expect(code(MODE)).not.toMatch(/isLinked|hasPersonal|username/i);
  });

  it('y el fantasma llega a la lista como `ready`', () => {
    expect(CHECK).toContain('B · candidatos: fantasma ready');
    expect(CHECK).toContain('D · el fantasma recibe');
  });

  /**
   * ═══════ EL AMARILLO LO PONE EL DESIGN SYSTEM ═══════
   *
   * El modo no pinta un color: pasa `saveDisabled` y `SaveButton` decide.
   * Encendido es `theme.accent`; apagado es transparente, no un amarillo al
   * 40 % —un acento atenuado sigue leyéndose como «esto es la acción»—.
   */
  it('el CTA se enciende por el tema, no por un color escrito a mano', () => {
    expect(SHEET).toContain("backgroundColor: disabled ? 'transparent' : theme.accent");
    expect(SHEET).toContain('<SaveButton label={saveLabel} disabled={saveDisabled}');
    expect(code(MODE)).not.toMatch(/accent|#[0-9a-f]{6}/i);
  });

  /**
   * ═══════ Y EL CABLE HASTA LA LLAMADA ═══════
   *
   * No basta con que una variable diga que se puede: el press tiene que
   * llegar al comando, una sola vez, y no cerrar nada hasta que el servidor
   * conteste.
   */
  it('el press llega al comando, una vez, y con los ids marcados', () => {
    expect(MODE).toContain('onSave={send}');
    expect(MODE).toContain('if (blocked || total === null) return;');
    expect(MODE).toContain('.record(');
    expect(MODE).toContain('total.toString(),');
    expect(MODE).toContain('chosen.map((one) => one.participantId),');
    expect(SERVICE).toContain("supabase.rpc('record_group_transfer'");
  });

  it('nada se cierra antes del ok del servidor, y el doble toque no pasa', () => {
    // Cerrar y publicar lo económico sólo tras `result.ok`.
    expect(MODE).toContain('if (result.ok) {');
    expect(MODE).toContain('onRecorded();');
    expect(HOOKS).toContain('if (result.ok) {');
    expect(HOOKS).toContain('publishGroupRecorded(scopeId);');
    // La referencia corta el segundo toque del mismo fotograma.
    expect(HOOKS).toContain('const inFlight = useRef(false);');
    expect(HOOKS).toContain('if (inFlight.current) return');
    expect(HOOKS).toContain('key.current ??= newClientOperationId();');
    // Y NADA optimista: no se publica ni se limpia antes de la respuesta.
    const send = MODE.slice(MODE.indexOf('const send = () => {'), MODE.indexOf('const zero ='));
    expect(code(send)).not.toMatch(/setSelected\(\[\]\)|setEntry\(EMPTY_AMOUNT\)/);
  });
});

describe('7 · la ventana, el selector y el reparto en pantalla', () => {
  it('el `+` abre la ventana de creación, y nada más', () => {
    expect(SCREEN).toContain("pathname: '/group-expense',");
    expect(SCREEN).toContain("accessibilityLabel={t('group.expenseTitle')}");
    expect(code(SCREEN)).not.toContain('group-transfer-to');
  });

  it('el selector superior es el que ya existía, con sus dos clases', () => {
    expect(FORM_EXPENSE).toContain('<ExpenseKindSelector value={kind} onChange={setKind} />');
    expect(SELECTOR).toContain(
      "transfer: { ios: 'arrow.left.arrow.right', android: 'swap_horiz' },",
    );
    expect(SELECTOR).toContain('transfer: theme.neutralFlow,');
    expect(COLOURS).toMatch(/neutralFlow: '#0A5FBF'/);
    expect(COLOURS).toMatch(/neutralFlow: '#4FA8FF'/);
  });

  it('cambiar de modo NO navega: la misma superficie cambia de contenido', () => {
    expect(FORM_EXPENSE).toContain("if (kind === 'transfer') {");
    expect(FORM_EXPENSE).toContain('<GroupTransferMode');
    expect(FORM_EXPENSE).toContain('header={heading}');
    expect(code(MODE)).not.toMatch(/router\.(push|replace)|useLocalSearchParams/);
  });

  it('importe, concepto y lista desde el principio, sin paso intermedio', () => {
    expect(MODE).toContain('<AmountSheet');
    expect(MODE).toContain("t('group.transferRecipients')");
    expect(MODE).toContain("placeholder={t('transfer.conceptPlaceholder')}");
    expect(code(MODE)).not.toMatch(/\bstep\b|\bphase\b|setStage/);
  });

  it('nadie viene marcado, y el importe empieza vacío', () => {
    expect(MODE).toContain('const [selected, setSelected] = useState<readonly string[]>([]);');
    expect(MODE).toContain('useState<AmountEntry>(EMPTY_AMOUNT)');
  });

  it('se pueden marcar varios: la selección es una lista, no un valor', () => {
    expect(MODE).toContain('previous.includes(one.participantId)');
    expect(MODE).toContain('previous.filter((id) => id !== one.participantId)');
    expect(MODE).toContain('[...previous, one.participantId]');
    expect(code(MODE)).not.toMatch(/accessibilityRole="radio"|selectedId|setReceiver\b/);
  });

  /**
   * EL MISMO TICK QUE EL GASTO, no otro que se le parece. Se extrajo del
   * reparto y las dos listas montan el mismo componente.
   */
  it('el tick es el del selector de participantes del gasto, extraído', () => {
    expect(MODE).toContain('<ParticipantTick');
    expect(SPLIT_CARD).toContain('<ParticipantTick');
    expect(TICK).toContain('accessibilityRole="checkbox"');
    expect(TICK).toContain('minWidth: 44');
    expect(TICK).toContain('Symbols.confirm');
  });

  it('cada destinatario ve su cuota y su efecto sobre la deuda', () => {
    expect(MODE).toContain('format.money(moneyFromMinorString(share.toString(), currency))');
    expect(MODE).toContain('<GroupTransferPreview');
    expect(MODE).toContain('netMinor={one.netMinor}');
    // El neto llega con los candidatos: ni una consulta por persona.
    expect(CANDIDATES).toContain('net_debt');
  });

  it('la moneda no se elige: es la del grupo y la deriva el servidor', () => {
    expect(code(MODE)).not.toContain('currencyOptions');
    expect(MODE).toContain("currencyNote={t('group.transferCurrencyFixed')}");
    expect(code(SERVICE)).not.toMatch(/currency_definition_id:/);
    expect(OPERATION).toContain('select s.base_currency_definition_id into v_currency');
  });

  it('el aviso dice que se registra ya, no que se propone', () => {
    expect(MODE).toContain("t('group.transferImmediate', { count: chosen.length })");
    expect(MODE).toContain("saveLabel={t('group.transferRecord')}");
    for (const cat of [ES, EN]) {
      expect(cat).toContain("'group.transferImmediate':");
      expect(cat).not.toContain("'group.transferTwoWillsMany'");
    }
  });
});

describe('8 · el histórico: una intención, una fila', () => {
  it('una fila por operación, con su reparto cuando hay varios', () => {
    expect(OPERATION).toContain('create view api.group_transfer_operation');
    expect(OPERATION).toContain('create view api.group_transfer_allocation');
    expect(ROW).toContain("t('group.transferDoneMany'");
    expect(ROW).toContain("t('group.transferDone'");
    expect(ES).toContain("'group.transferDoneMany':");
    expect(EN).toContain("'group.transferDoneMany':");
  });

  /** Dos consultas, no 1+N: los repartos llegan todos juntos y se cosen aquí. */
  it('el reparto no cuesta una consulta por operación', () => {
    expect(SERVICE).toContain('const [heads, parts] = await Promise.all([');
    expect(SERVICE).toContain("supabase.from('group_transfer_allocation')");
    expect(SERVICE).toContain('byOperation.get(operationId)');
  });

  it('es la MISMA lista, mezclada en cliente: group_operation no se tocó', () => {
    expect(TIMELINE).toContain("kind: 'transfer'");
    expect(SCREEN).toContain('<GroupTransferRow');
    // Y no la recrea ni la altera: sólo la menciona al explicar por qué no.
    expect(OPERATION).not.toMatch(/create (or replace )?view api\.group_operation/);
    expect(OPERATION).not.toMatch(/alter view api\.group_operation/);
  });

  /**
   * ═══════ EL RELOJ ES EL DEL APARATO, COMO EN LAS OTRAS DOS CLASES ═══════
   *
   * De un fallo real: el writer tomaba `current_date` y `localtime(0)`, y el
   * servidor corre en UTC. Una transferencia hecha a las 21:30 en Madrid se
   * guardaba como las 19:30 y caía en Movimientos por debajo de lo
   * registrado esa misma tarde — mientras el gasto compartido y el pago
   * declarado siempre tomaron la fecha y la hora del aparato.
   */
  it('la fecha y la hora vienen del payload, no del reloj del servidor', () => {
    expect(OPERATION).toContain("v_date    := sec.payload_date(payload, 'effective_date');");
    expect(OPERATION).toContain("v_time    := sec.payload_time(payload, 'effective_time', false);");
    const writer = OPERATION.slice(OPERATION.indexOf('create function api.record_group_transfer'));
    expect(writer).not.toMatch(/current_date|localtime\(/);
    // Y el cliente las siembra desde la misma costura que el gasto.
    expect(SERVICE).toContain('readonly effective_date: string;');
    expect(MODE).toContain('{ date: today, time: now },');
    expect(FORM_EXPENSE).toContain('today={today}');
    expect(FORM_EXPENSE).toContain('now={now}');
  });

  /**
   * ═══════ UNA SOLA RELECTURA, Y LAS SEIS JUNTAS ═══════
   *
   * Tras registrar, lo económico se anuncia por `groupRecorded` y
   * `useGroupMovements` vuelve a pedirlo TODO en un `Promise.all`. No hay un
   * segundo lector con su propio ciclo: mezclar transferencias frescas con
   * gastos en caché daría un orden que no corresponde a ningún momento.
   */
  it('tras registrar se releen las seis lecturas a la vez', () => {
    expect(HOOKS).toContain('publishGroupRecorded(scopeId);');
    expect(MOVEMENTS).toContain('subscribeGroupRecorded((changed) => {');
    expect(MOVEMENTS).toContain(
      'const [rows, summary, positions, declared, pairs, accepted] = await Promise.all([',
    );
    expect(MOVEMENTS).toContain('fetchGroupTransfers(scopeId)');
    // Y el lector suelto se retiró: no queda una segunda fuente.
    expect(code(HOOKS)).not.toContain('useGroupTransfers');
  });

  /** El orden lo decide UNA normalización y UNA ordenación, sin `if kind`. */
  it('el comparador normaliza primero y ordena una sola vez', () => {
    expect(TIMELINE).toContain('function keyOf(entry: TimelineEntry): SortKey {');
    expect(TIMELINE).toContain(
      'const keyed = entries.map((entry) => ({ entry, key: keyOf(entry) }));',
    );
    expect(TIMELINE.match(/keyed\.sort\(/g) ?? []).toHaveLength(1);
    // El desempate es estable: alta más reciente y, a igualdad, identidad.
    expect(TIMELINE).toContain('function stable(a: SortKey, b: SortKey): number {');
    expect(TIMELINE).toContain('return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;');
  });

  /** El ordinal ES el orden del reparto: no se reordena por nombre. */
  it('el detalle sigue el ordinal', () => {
    expect(SERVICE).toContain('.sort((a, b) => a.ordinal - b.ordinal)');
  });
});

describe('9 · anular, con la disciplina de siempre', () => {
  it('se anula como un gasto o un pago, con confirmación previa', () => {
    expect(SCREEN).toContain('const askDeleteTransfer = (transfer: GroupTransferOperation) => {');
    expect(SCREEN).toContain("t('group.deleteTransfer')");
    expect(SCREEN).toContain('void writer.annul(transfer)');
    expect(ROW).toContain('onDelete');
    // La versión vigente viaja, porque anular la necesita.
    expect(OPERATION).toContain('as version_id');
  });

  /** Sólo quien la registró: la operación toca SU Personal. */
  it('sólo el emisor ve la acción, y el motivo se dice', () => {
    expect(ROW).toContain('{expanded && transfer.isSender ? (');
    expect(SCREEN).toContain("writer.code === 'NOT_AUTHORIZED'");
    expect(SCREEN).toContain("t('group.deleteTransferNotSender')");
    for (const cat of [ES, EN]) expect(cat).toContain("'group.deleteTransferNotSender':");
  });

  /** Y la guarda mira TODOS los pares antes de escribir. */
  it('la guarda de anulación es multi-par', () => {
    expect(SCREEN).toContain("writer.code === 'SETTLEMENT_EXCEEDS_DEBT'");
    expect(CHECK).toContain('L · la guarda de anulacion valida los N pares antes de escribir');
  });

  it('editar NO se ofrece en ninguna parte', () => {
    expect(code(ROW)).not.toMatch(/onEdit|editar/i);
  });
});

describe('10 · lo que NO cambió', () => {
  /** «Saldado» es OTRA cosa, y sigue exactamente como estaba. */
  it('«Saldado» intacto: una voluntad, acotado por deuda, y su propio comando', () => {
    expect(SUGGESTED).toContain("label={t('group.settleAction')}");
    expect(SUGGESTED).toContain('onPress={onSettle}');
    expect(SCREEN).toContain('onSettle={askPay}');
    expect(SCREEN).toContain('const askPay = (proposal: SuggestedPayment) => {');
  });

  /** Ni Pagos sugeridos ni la fila de un participante ofrecen transferir. */
  it('las entradas rechazadas siguen fuera', () => {
    expect(code(SUGGESTED)).not.toMatch(/onTransfer|transferPay|Transferencia/i);
    expect(code(ROW_BALANCE)).not.toMatch(/transfer/i);
    expect(ES).not.toContain("'group.transferPay'");
  });

  /** El borrador del gasto y el de la transferencia no se mezclan. */
  it('el gasto compartido sigue con su propio estado', () => {
    expect(FORM_EXPENSE).toContain('const [draft, setDraft] = useState');
    expect(code(MODE)).not.toMatch(/\bdraft\b|payerParticipantId|splitMode/);
    expect(FORM_EXPENSE).toContain("const [kind, setKind] = useState<GroupKind>('expense');");
  });

  /**
   * B3 SIGUE EN EL SERVIDOR Y DORMIDO, igual que las solicitudes de pago de
   * B2: su migración no se toca, y su check sigue registrado en CI.
   */
  it('el backend de propuestas se conserva, sin superficie cliente', () => {
    expect(OPERATION).toContain('api.create_group_transfer_proposal');
    expect(OPERATION).toContain('sec.group_transfer_currencies_match');
    expect(CI).toContain('supabase/checks/group-transfer-proposals.sql');
    expect(CI).toContain('supabase/checks/group-transfer-client.sql');
  });

  it('las transferencias Personal de F12.C1 no se tocan', () => {
    expect(TYPES).toContain('record_internal_transfer');
    expect(TYPES).toContain('my_transfers');
    expect(NOTIFICATIONS).toContain('useMyProposals(');
  });

  /** Y la clase nueva existe en los tipos generados, con sus dos vistas. */
  it('los tipos se regeneraron sobre el esquema vivo', () => {
    expect(TYPES).toContain('record_group_transfer');
    expect(TYPES).toContain('group_transfer_operation: {');
    expect(TYPES).toContain('group_transfer_allocation: {');
    // Y la superficie retirada ya no está.
    expect(TYPES).not.toContain('group_transfer_context');
    expect(TYPES).not.toContain('my_group_transfer_proposals');
  });

  it('el preview muestra el antes y el después, siempre los dos', () => {
    expect(PREVIEW).toContain('NOW[now]');
    expect(PREVIEW).toContain('AFTER[standingOf(after)]');
    expect(PREVIEW).toContain("t('group.transferExceeds')");
  });
});
