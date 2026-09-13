import { describe, expect, it } from 'vitest';

import FIELDS from '../../src/features/groups/shared-expense-fields.tsx?raw';
import FORM from '../../src/features/groups/shared-expense-form.tsx?raw';
import CARD from '../../src/features/groups/split-participants-card.tsx?raw';
import MODEL from '../../src/features/groups/shared-expense.ts?raw';
import PARTICIPANTS from '../../src/features/groups/participant-service.ts?raw';
import WINDOW from '../../src/features/groups/shared-expense-window.tsx?raw';
import ROUTE from '../../src/app/group-expense.tsx?raw';
import LAYOUT from '../../src/app/_layout.tsx?raw';
import IOS_MENU from '../../src/ui/components/option-menu.ios.tsx?raw';

/**
 * AÑADIR UN GASTO COMPARTIDO, comprobado sobre el fuente.
 *
 * Lo que aquí se afirma son propiedades **estructurales** —de qué contrato sale
 * cada cosa, qué no se envía, qué no se adivina—, no estilos. El reparto en sí
 * se prueba aparte y como función pura, en `tests/lib/shared-expense.test.ts`.
 */

/** El fuente sin comentarios: se afirma sobre el código, no sobre la prosa. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('la ventana es la de Inicio, no una copia', () => {
  it('monta la composición compartida y el armazón compartido', () => {
    expect(code(WINDOW)).toContain('<SheetWindow');
    expect(code(FORM)).toContain('<AmountSheet');
    expect(code(FORM)).toContain("from '@/ui/components'");
  });

  /**
   * Ni un import de otra feature ni una segunda ventana con los mismos números.
   * Lo que las dos comparten vive por debajo: la composición en `ui/`, la
   * aritmética en `domain/`.
   */
  it('sin leer de otra feature y sin reescribir la composición', () => {
    // Sobre el CÓDIGO: los comentarios nombran la otra feature justamente para
    // explicar por qué NO se importa y quién compone en su lugar — la ruta.
    for (const fuente of [WINDOW, FORM, FIELDS, CARD, MODEL]) {
      expect(code(fuente)).not.toContain('features/personal');
    }
    expect(code(FORM)).not.toContain('StyleSheet.create({\n  sheet');
  });

  it('donde Inicio pone «Personal», aquí va el nombre del grupo, y como rótulo', () => {
    expect(code(FORM)).toContain('{groupName}');
    expect(code(FORM)).not.toContain("t('scope.personal')");
    // Un rótulo: nada pulsable, ningún selector de ámbito.
    const cabecera = code(FORM).slice(
      code(FORM).indexOf('header={'),
      code(FORM).indexOf('fields={'),
    );
    expect(cabecera).not.toContain('Pressable');
    expect(cabecera).not.toContain('OptionMenu');
  });

  it('la clase se elige entre DOS, y ninguna es un ingreso', async () => {
    const KINDS = (await import('../../src/features/groups/shared-expense.ts?raw')).default;
    expect(code(KINDS)).toContain("export type GroupKind = 'expense' | 'transfer'");
    expect(code(KINDS)).not.toContain("'income'");
    // El de Personal no se importa: es otra feature y otro vocabulario.
    expect(code(FORM)).not.toContain('EntryKindSelector');
    expect(code(FORM)).toContain('<ExpenseKindSelector');
  });

  /**
   * Liquidar no es gastar: tiene deudor y acreedor, no pagador y reparto. El modo
   * existe y explica qué le falta, pero **no enseña el formulario de gasto con
   * otra etiqueta** — que es lo único que lo convertiría en una promesa falsa.
   */
  it('y el modo liquidación no reutiliza el formulario de gasto', () => {
    const rama = code(FORM).slice(code(FORM).indexOf("if (kind === 'transfer')"));
    const hasta = rama.slice(0, rama.indexOf('return (\n    <>'));
    expect(hasta).toContain('<EmptyState');
    expect(hasta).not.toContain('<AmountSheet');
    expect(hasta).not.toContain('SharedExpenseFields');
    expect(hasta).not.toContain('SplitParticipantsCard');
  });

  /**
   * La categoría es la MISMA pieza y el MISMO catálogo que en Inicio: el círculo
   * bajó a `ui/` y el modelo a `lib/categories`, así que no hay un segundo botón
   * ni una segunda lista. Lo que no hay es un sistema de menús propio: se
   * despliega con `OptionMenu`, el mismo control del sistema que el pagador.
   */
  it('la categoría reutiliza el botón y el catálogo, sin duplicar ninguno', () => {
    expect(code(FIELDS)).toContain('<CategoryTrigger');
    expect(code(FIELDS)).toContain("from '@/lib/categories'");
    expect(code(FIELDS)).toContain('categoryOptions(categories, draft.categoryId, t)');
    // Ni catálogo escrito a mano ni un segundo menú.
    expect(code(FIELDS)).not.toContain('category.expense.');
    expect(code(FIELDS)).not.toContain('MenuView');
  });

  /**
   * Y el catálogo lo monta la RUTA, que es quien puede ver las dos features. Es
   * lo que hace que sea uno solo sin que una importe de la otra.
   */
  it('y el catálogo llega desde la ruta, no de una carga propia', () => {
    expect(code(ROUTE)).toContain('useEntryCategories(actorId)');
    expect(code(FIELDS)).not.toContain('useEntryCategories');
    expect(code(FORM)).not.toContain('useEntryCategories');
  });
});

describe('la ruta es suya, no la de Personal', () => {
  it('el layout la declara como ventana transparente, igual que el alta', () => {
    expect(LAYOUT).toContain('name="group-expense"');
    const bloque = LAYOUT.slice(LAYOUT.indexOf('name="group-expense"'));
    expect(bloque.slice(0, 200)).toContain("presentation: 'transparentModal'");
  });

  it('y no reutiliza `/add`, que arrancaría el flujo del Modo Personal', () => {
    expect(ROUTE).not.toContain("'/add'");
    expect(ROUTE).not.toContain('MovementForm');
    expect(ROUTE).not.toContain('useEntryQueue');
  });

  it('el grupo sale de la MISMA proyección que la lista', () => {
    expect(code(ROUTE)).toContain('useGroups(actorId, session.status)');
    expect(code(ROUTE)).toContain('groups.find((one) => one.scopeId === groupId)');
  });

  it('y sólo se deshace cuando la lista remota ya se leyó, no sobre la cola local', () => {
    // Medido en el iPhone (2026-09-14): con una creación local en la cola, la
    // ruta veía «1 grupo, no es éste» antes de que el servidor respondiera y
    // volvía atrás; un grupo al que se entró por invitación nunca abría.
    expect(code(ROUTE)).toContain(
      'const { groups, loading } = useGroups(actorId, session.status);',
    );
    expect(code(ROUTE)).toContain('if (!loading && group === undefined) router.back();');
    expect(code(ROUTE)).not.toContain('groups.length > 0');
  });
});

describe('el pagador no se adivina', () => {
  it('arranca sin resolver, y no por el primero de la lista ni por el nombre', () => {
    expect(code(MODEL)).toContain('payerId: null');
    expect(code(MODEL)).not.toContain('participants[0]');
    expect(code(MODEL)).not.toContain('displayName ===');
    expect(code(MODEL)).not.toContain('.find((one) => one.displayName');
  });

  it('pero «quién mira» sí llega del servidor, sólo sobre el actor, y es el pagador por defecto', () => {
    // `api.group_participant` no trae el enlace de nadie: `is_self` responde
    // sólo sobre el actor (`sec.is_my_participant`), y eso es lo que se lee.
    expect(code(PARTICIPANTS)).not.toContain('participant_user_link');
    expect(code(PARTICIPANTS)).toContain(
      "'participant_id,display_name,created_at,is_self,is_active,eligible_until,is_retired,is_linked,has_history,claim_command_id,merged_into_participant_id'",
    );
    expect(code(PARTICIPANTS)).toContain('isSelf: row.is_self ?? null,');
    expect(code(FORM)).toContain('const payerId = draft.payerId ?? selfParticipantId;');
    expect(code(FORM)).toContain('participants.find((one) => one.isSelf === true)');
  });

  it('y participar es obligatorio para quien paga', () => {
    expect(code(MODEL)).toContain('if (id === draft.payerId) return draft;');
    expect(code(CARD)).toContain('disabled={isPayer || !eligible}');
    expect(code(CARD)).toContain("t('group.splitPayerHint')");
  });
});

describe('el reparto sale del dominio, no de esta pantalla', () => {
  it('la aritmética la hace `splitExpense`, y no se reescribe aquí', () => {
    expect(code(MODEL)).toContain("from '@/domain'");
    expect(code(MODEL)).toContain('splitExpense({');
    // Ni una división ni un redondeo propios sobre dinero.
    for (const fuente of [MODEL, FORM, CARD]) {
      expect(fuente).not.toContain('Math.round');
      expect(fuente).not.toContain('toFixed');
      expect(fuente).not.toContain('parseFloat');
    }
  });

  it('la escala sale de la divisa del GRUPO, nunca fijada a dos', () => {
    expect(code(WINDOW)).toContain('scale: group.currencyScale');
    expect(code(MODEL)).toContain('currency.scale');
    expect(code(MODEL)).not.toMatch(/scale = 2|scale: 2/);
  });

  it('y las cuotas pendientes son `null`, que no es cero', () => {
    expect(code(MODEL)).toContain('minor: bigint | null');
    expect(code(CARD)).toContain("t('home.amountPending')");
  });
});

describe('el guardado es real, y no se finge', () => {
  /**
   * **La pantalla no habla con Supabase**, y eso no cambió al conectar el
   * guardado: quien lo hace es `group-service`, la única puerta del dominio a la
   * red. Lo que la pantalla monta es el hook, que es donde viven la clave de
   * idempotencia y el cerrojo.
   */
  it('la escritura sale por el servicio, no desde la pantalla', () => {
    for (const fuente of [FORM, FIELDS, CARD, MODEL, WINDOW]) {
      expect(code(fuente)).not.toContain('supabase');
      expect(code(fuente)).not.toContain('enqueue');
    }
    expect(code(FORM)).toContain('useRecordExpense()');
  });

  /**
   * **Se cierra SÓLO con la garantía.** `record` devuelve `true` únicamente
   * cuando el servidor respondió que lo escribió; con cualquier otra cosa la
   * ventana se queda con el borrador entero y el motivo debajo.
   */
  it('la ventana se cierra sólo cuando el servidor lo confirmó', () => {
    expect(code(FORM)).toContain('if (ok) onRecorded();');
    expect(code(WINDOW)).toContain('onRecorded();');
    // Ni un `close()` ni un `onRecorded()` fuera de esa condición.
    expect(code(FORM)).not.toContain('.then(() => onRecorded())');
  });

  /**
   * LA CLAVE DEL COMANDO SE ACUÑA UNA VEZ Y SOBREVIVE AL REINTENTO (F03/ADR-007).
   *
   * En una `ref` y no en un estado: un `useState` se lee del render anterior, y
   * dos toques rápidos entrarían los dos antes de que React repinte. Sólo se
   * renueva cuando un intento termina bien; ante un fallo sin respuesta se
   * conserva, porque puede que el servidor sí lo haya escrito.
   */
  it('la clave del comando es la misma en el reintento', async () => {
    const HOOK = (await import('../../src/features/groups/use-record-expense.ts?raw')).default;
    expect(code(HOOK)).toContain('commandId.current ??= newClientOperationId()');
    expect(code(HOOK)).toContain('if (inFlight.current) return false;');
    // Se descarta SÓLO tras un `ok`.
    const exito = code(HOOK).slice(code(HOOK).indexOf('if (response.ok)'));
    expect(exito.slice(0, 160)).toContain('commandId.current = null');
    expect(code(HOOK)).not.toContain('setSaving(true);\n    const key');
  });

  it('y `Guardar` se apaga mientras escribe y con su motivo escrito', () => {
    expect(code(MODEL)).not.toContain("'noRoute'");
    expect(code(FORM)).toContain('saveDisabled={outcome.blocker !== null || writer.saving}');
    expect(code(FORM)).toContain('BLOCKER_KEY[outcome.blocker]');
    // El rechazo se dice por su CÓDIGO, y el genérico no inventa una causa.
    expect(code(FORM)).toContain('REJECTION_KEY');
    expect(code(FORM)).toContain("'group.expenseRejected'");
  });

  /** La cola durable NO se amplía por su cuenta a gastos compartidos. */
  it('el vocabulario de la cola sigue siendo el de F9', async () => {
    const { QUEUE_COMMAND_TYPES } = await import('../../src/lib/offline/command');
    expect([...QUEUE_COMMAND_TYPES]).toEqual([
      'personal_expense.create',
      'personal_income.create',
      'group.create',
    ]);
  });
});

describe('los participantes son los reales, y también sin red', () => {
  it('se leen de `api.group_participant` y de la cola local', async () => {
    const HOOK = (await import('../../src/features/groups/use-group-participants.ts?raw')).default;
    expect(HOOK).toContain('fetchGroupParticipants(scopeId)');
    expect(HOOK).toContain('groupPayloadOf(entry.commandType, entry.payload)');
    expect(HOOK).toContain('payload.creator_participant_id');
  });

  it('y en cuanto el servidor conoce el grupo, manda su lista: los añadidos después salen', async () => {
    const HOOK = (await import('../../src/features/groups/use-group-participants.ts?raw')).default;
    // La creación encolada sigue en la cola tras confirmarse; sólo vale mientras
    // el grupo no es visible (respuesta vacía), nunca por encima de la real.
    expect(HOOK).toContain('const confirmed = remote !== null && remote.length > 0;');
    expect(HOOK).toContain('participants: confirmed ? remote : (local ?? remote ?? []),');
    expect(HOOK).not.toContain('participants: local ?? remote ?? []');
  });

  it('y la elegibilidad es la desigualdad de la frontera, y no se inventa sin presencia', async () => {
    const presencia = (await import('../../src/features/groups/participant-presence.ts?raw'))
      .default;
    const HOOK = (await import('../../src/features/groups/use-group-participants.ts?raw')).default;
    expect(presencia).toContain('if (one.presence === null) return true;');
    expect(presencia).toContain('date < one.presence.eligibleUntil');
    expect(code(MODEL)).toContain('!eligibleOn(one, date)');
    // Una creación local sin reconciliar no sabe la presencia: no descarta.
    expect(HOOK).toContain('presence: null');
  });
});

/**
 * LA FILA DE OBLONGOS RESERVA SU ALTO EN iOS.
 *
 * El hueco del menú llevaba `flex: 1` dentro de una columna: en ese eje
 * `flexBasis: 0` manda sobre el `height` declarado, la fila reservaba cero
 * puntos y el anfitrión de SwiftUI pintaba el oblongo fuera de la caja — encima
 * de «Repartir entre». Con `alignSelf: 'stretch'` el alto declarado es el alto
 * real, igual que en Android.
 */
describe('la fila de menús nativos reserva su alto', () => {
  it('en iOS el hueco con alto declarado se estira, no reparte con flex', () => {
    const ios = IOS_MENU.slice(IOS_MENU.indexOf('slot: {'));
    expect(ios).toContain("alignSelf: 'stretch'");
    expect(ios).not.toContain('flex: 1');
    // Y el hueco sin alto —el círculo— sigue midiendo por su contenido.
    const trigger = IOS_MENU.slice(IOS_MENU.indexOf('trigger: {'), IOS_MENU.indexOf('slot: {'));
    expect(trigger).toContain("alignSelf: 'flex-start'");
  });

  it('y la separación con lo siguiente es espacio reservado, del token', () => {
    expect(FIELDS).toContain('<View style={[styles.row, styles.pillRow]}>');
    const pillRow = FIELDS.slice(FIELDS.indexOf('pillRow: {'), FIELDS.indexOf('caption: {'));
    expect(pillRow).toContain('paddingBottom: Spacing.sm');
    expect(pillRow).not.toMatch(/translate|marginTop: -|marginBottom: -/);
  });
});

/**
 * LA PREESTABLECIDA LLEGA AL BORRADOR AUNQUE EL CATÁLOGO LLEGUE TARDE.
 *
 * El defecto: la siembra ocurría UNA vez al montar y el catálogo aún no
 * estaba, así que la preferencia se perdía. Ahora se decide en cada render con
 * `presetToApply` y se aplica una sola vez, nunca sobre una elección manual.
 */
describe('la categoría preestablecida en la ventana', () => {
  it('la ventana sólo pasa una preferencia UTILIZABLE, comprobada contra el catálogo', () => {
    expect(WINDOW).toContain(
      'sharedCategories(categories.rows).some((row) => row.id === group.defaultCategoryId)',
    );
  });

  it('el formulario la aplica durante el render, una vez, y no en un efecto', () => {
    expect(FORM).toContain('const pending = presetToApply({');
    expect(FORM).toContain('setPresetApplied(true);');
    // Elegir a mano marca `touched`: a partir de ahí la preferencia no manda.
    expect(FORM).toContain('setCategoryTouched(true);');
    // Y no es un efecto que escriba estado ni una ref leída en el render.
    expect(FORM).not.toMatch(/useEffect\([^)]*setDraft/s);
  });

  it('el icono y el payload salen del MISMO categoryId del borrador', () => {
    // El botón resuelve la fila por el id del borrador contra el catálogo…
    expect(FIELDS).toContain(
      'const chosen = categories.find((row) => row.id === draft.categoryId) ?? null;',
    );
    expect(FIELDS).toContain("icon={categoryIcon(chosen ?? undefined) ?? 'tag'}");
    // …y el payload manda ese mismo id. Una sola selección, dos lecturas.
    expect(MODEL).toContain('category_id: draft.categoryId,');
  });
});

describe('«Por partes» con −/+ y «Cantidad» con automáticas', () => {
  it('las partes se ajustan sin teclado: dos botones, el − apagado en una, y lo escrito es entero', () => {
    expect(CARD).toContain('function SharesStepper(');
    expect(CARD).not.toContain('keyboardType="number-pad"');
    expect(CARD).toContain('const atMinimum = shares <= 1n;');
    expect(CARD).toContain('disabled={atMinimum}');
    expect(CARD).toContain('name={Symbols.remove}');
    expect(CARD).toContain('hitSlop={STEP_HIT_SLOP}');
    expect(CARD).toContain("t('group.splitSharesValue', { count })");
    expect(code(MODEL)).toContain('if (next < 1n) return draft;');
    expect(FORM).toContain('adjustShares(previous, participantId, delta)');
    expect(FORM).not.toContain('onChangeWeight');
  });

  it('el oblongo ES la cuota: se edita ahí, empieza de cero al tocarlo, y no hay otra cifra al lado', () => {
    expect(CARD).toContain('function QuotaField(');
    expect(CARD).toContain('keyboardType="decimal-pad"');
    // La cifra definitiva, formateada como cualquier cuota; el capturador encima.
    expect(CARD).toContain('format.money(money(quota, currency))');
    expect(CARD).toContain('caretHidden');
    expect(CARD).toContain('style={[StyleSheet.absoluteFill, styles.capture]}');
    // Al tocar se siembra la vigente; la primera tecla la sustituye (amountFieldStep).
    expect(CARD).toContain('amountEntryFromMinor(quota.toString(), scale)');
    expect(CARD).toContain('setEditing(seeded);');
    expect(CARD).toContain('amountFieldStep({ entry, pinToEnd: false }, next, scale)');
    expect(CARD).toContain('input.current?.setSelection(target.start, target.end)');
    // Siempre en color de texto, fijada o automática; sólo el «—» va apagado.
    expect(CARD).toContain('{ color: quota === null && !typed ? theme.textTertiary : theme.text }');
    expect(CARD).not.toContain('fixed || typed');
    // Desplazable desde cuatro participantes, sin esperar a la medida.
    expect(CARD).toContain('scrollEnabled={participants.length > 3}');
    // Y el responder se toma DENTRO de la lista: un gesto que empiece sobre el
    // nombre o la cuota desplaza igual que sobre un tick.
    expect(CARD).toContain('onStartShouldSetResponder={() => true}');
    // El indicador de desplazamiento, a la izquierda: inset medido, no una cifra fija.
    expect(CARD).toContain('scrollIndicatorInsets={');
    // El foco se ve con el estado táctil existente, por el foco REAL del campo.
    expect(CARD).toContain("depth={focused ? 'pressed' : 'well'}");
    expect(CARD).toContain('const focused = editing !== null;');
    expect(CARD).not.toMatch(/Keyboard.isVisible|keyboardWillShow/);
    expect(CARD).toContain('{ right: listWidth - INDICATOR_GAP }');
    expect(CARD).toMatch(
      /<ScrollView[\s\S]*onStartShouldSetResponder=\{\(\) => true\}[\s\S]*<ParticipantRow/,
    );
    // En «Cantidad» la columna de cuota no se repite: es el otro brazo del ternario.
    expect(CARD).toMatch(/<QuotaField[\s\S]*\/>\s*\) : \(/);
    expect(CARD).toContain("t('group.splitEqualize')");
    expect(FORM).toContain('setDraft(equalizeAmounts);');
  });

  it('el restante se reparte con la regla de restos del dominio, y al servidor viaja el reparto final', () => {
    expect(code(MODEL)).toContain('allocateByLargestRemainder(');
    expect(code(MODEL)).toContain('(id === draft.payerId ? -1 : index)');
    // Sin optimismo ni corrección: el exceso se enseña, nada negativo ni cero.
    expect(code(MODEL)).toContain("blocker: 'amountsIncomplete'");
    expect(code(MODEL)).toContain("blocker: zero ? 'amountsZero'");
    expect(code(MODEL)).toContain('if (remainder < 0n) {');
    // El payload sigue siendo `exact_amounts` del contrato: no hay segundo modelo.
    expect(code(MODEL)).toContain("return { kind: 'exact_amounts', amounts };");
    expect(code(MODEL)).not.toMatch(/fixed_amounts|kind: 'automatic'/);
    expect(FORM).toContain("amountsIncomplete: 'group.expenseAmountsIncomplete'");
    expect(FORM).toContain("amountsZero: 'group.expenseAmountsZero'");
  });
});
