import { AmountSheet } from './amount-sheet';
import type { CategoryRow } from './category';
import { categoryIcon, categoryName } from './category';
import { CategoryMenu } from './category-menu';
import { CIRCLE } from './movement-fields';
import { BLOCKER_HINT } from './movement-blocker';
import {
  type AmountEntry,
  amountValue,
  type EntryKind,
  sameEntry,
  usesCategory,
} from './movement-entry';
import type { MovementFormScope } from './movement-form';
import { useMovementDraft } from './use-movement-draft';
import { useRecordMovement } from './use-record-movement';
import type { CalendarDate } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';

/**
 * La versión VIGENTE de la operación que se está corrigiendo.
 *
 * **La identidad es `operationId` + `expectedVersionId`, y nada más.** Ni la
 * posición en la lista, ni el concepto, ni el importe, ni el signo: el par
 * identifica la operación y fija contra qué versión se corrige, que es lo que
 * el CAS del servidor comprueba antes de encadenar la nueva.
 *
 * Los demás campos llegan igualmente aunque la ventana todavía no los enseñe:
 * son los que el payload de corrección tiene que conservar sin tocarlos.
 */
export type MovementEdit = {
  readonly operationId: string;
  readonly expectedVersionId: string;
  readonly kind: EntryKind;
  readonly amount: AmountEntry;
  readonly concept: string;
  readonly categoryId: string | null;
  readonly date: CalendarDate;
  readonly time: string;
};

/**
 * EL CONTENIDO de corregir un movimiento. **La ventana no es suya.**
 *
 * **Ahora mismo enseña UNA cifra y nada más**, exactamente como el editor del
 * Disponible: sin selector de clase, sin concepto, sin categoría y sin fecha.
 * Es deliberado y es un paso — los campos se añaden uno a uno después de
 * validar que esta ventana es la correcta.
 *
 * **Y ésa era la causa del parecido con «Añadir movimiento».** No estaba en el
 * armazón ni en la composición, que ya se compartían: estaba en lo que se les
 * metía dentro. Una hoja con selector arriba y una fila de concepto, categoría
 * y fecha abajo **es** la pantalla del alta, monte lo que monte por debajo.
 * Vaciar los dos huecos es lo que hace que la ventana vuelva a ser la del
 * saldo.
 *
 * Esta pieza no dibuja ventana: la monta `EditWindow`, la misma que envuelve a
 * `BalanceEditor`. Aquí sólo se resuelve estado y se entrega a `AmountSheet`
 * —con los dos huecos vacíos, igual que su hermano— y por eso ninguno de los
 * dos declara **un solo estilo**, ni un `View`, ni un `StyleSheet`.
 *
 * **Lo que NO se ha recortado es la corrección.** Concepto, categoría, fecha y
 * hora siguen viajando en el payload con el valor que ya tenían: el borrador
 * arranca de la versión vigente, así que lo que no se toca se manda igual. La
 * ventana enseña menos; el comando dice lo mismo.
 *
 * **Y esto no toca el Disponible.** Corregir un gasto de 50 a 70 sustituye el
 * efecto de esa operación, no fija el saldo a 70: aquí no entra
 * `record_adjustment`, ni `target_balance`, ni `useAdjustBalance`.
 *
 * **El importe SÍ es el borrador**, y ésa es la diferencia de fondo con editar
 * el Disponible: corregir parte de lo que había, mientras que fijar un saldo
 * declara uno nuevo entero. Es funcional, no visual — la zona de la cifra es la
 * misma y la referencia apagada no aparece aquí.
 */
export function MovementEditor({
  scope,
  edit,
  categories,
  onSaved,
}: {
  readonly scope: MovementFormScope | null;
  readonly edit: MovementEdit;
  /** El MISMO catálogo del alta, resuelto por `useEntryCategories` en la ruta. */
  readonly categories: readonly CategoryRow[];
  readonly onSaved: () => void;
}) {
  const { t } = useTranslation();

  const scale = scope?.currencyScale ?? 2;
  /*
   * **Arranca en la versión VIGENTE**, no en la original: si la operación ya se
   * corrigió antes, lo que se abre es lo que dice v2, no lo que decía v1. Es lo
   * que la fila tenía en la mano, así que no cuesta ninguna consulta.
   */
  const draft = useMovementDraft(scale, scope !== null, edit);
  const { status, save } = useRecordMovement(scope);

  /*
   * **SIN CAMBIOS NO SE ESCRIBE.** Abrir, mirar y cerrar no debe dejar una
   * versión idéntica a la anterior en el historial: no corrige nada y ensucia
   * la trazabilidad justo donde sirve para algo.
   *
   * La comparación es CANÓNICA y no visual —importe en unidades mínimas,
   * concepto recortado— así que escribir 5,00 donde ponía 5 no cuenta como
   * cambio: el payload sería el mismo.
   */
  const untouched = sameEntry(
    draft.draft,
    {
      kind: edit.kind,
      amount: amountValue(edit.amount),
      concept: edit.concept,
      categoryId: edit.categoryId,
      date: edit.date,
      time: edit.time,
    },
    scale,
  );

  /*
   * La categoría elegida ahora mismo, resuelta contra el catálogo exactamente
   * como en el alta. Si el identificador guardado ya no está en la lista,
   * `chosen` es `null` y el botón cae en su icono y su etiqueta de vacío: el
   * mismo repliegue, no uno propio de esta ventana.
   */
  const chosen = categories.find((row) => row.id === draft.categoryId) ?? null;

  return (
    <AmountSheet
      entry={draft.entry}
      onChangeEntry={draft.setEntry}
      amountLabel={t('entry.amountLabel')}
      currency={scope === null ? null : { code: scope.currencyCode, scale: scope.currencyScale }}
      hint={draft.blocker === null ? null : t(BLOCKER_HINT[draft.blocker])}
      error={status === 'failed' ? t('entry.editFailed') : null}
      saveLabel={t('action.saveChanges')}
      saveDisabled={draft.blocker !== null || untouched}
      saving={status === 'saving'}
      /*
       * EL SELECTOR DE CATEGORÍA, en la misma fila y a la derecha del €.
       *
       * Va en `aside`, dentro de la fila de la cifra: **no cuesta ni un punto
       * de alto**, así que la ventana mide exactamente lo que medía antes de
       * que existiera. Debajo, en `fields`, costaba una fila entera y empujaba
       * el CTA.
       *
       * Los dos comparten centro vertical porque los alinea la propia fila, y
       * la separación entre ellos es la del sistema — la misma que ya separaba
       * la cifra del €.
       *
       * **Es el componente del alta, no una copia.** Mismo `CategoryMenu`,
       * mismo catálogo, mismo icono, mismo color, misma etiqueta y mismo menú
       * anclado. De aquí no sale ni un color ni un icono.
       *
       * **Y sólo cuando la clase lo admite.** `usesCategory` es la misma puerta
       * que en el alta: un ingreso no monta el botón, no reserva su hueco y no
       * puede mandar categoría, porque `personal_income` la rechaza por forma
       * (ADR-027). Su fila queda exactamente como estaba, contrapeso incluido.
       */
      aside={
        usesCategory(draft.kind) ? (
          <CategoryMenu
            categories={categories}
            selected={draft.categoryId}
            onSelect={draft.setCategoryId}
            size={CIRCLE}
            icon={categoryIcon(chosen ?? undefined) ?? 'tag'}
            chosen={chosen !== null}
            label={
              chosen === null
                ? t('entry.categoryEmpty')
                : t('entry.categoryChosen', {
                    name: categoryName(chosen, t) ?? t('entry.categoryUnknown'),
                  })
            }
          />
        ) : null
      }
      onSave={() => {
        /*
         * **Corrección, no operación nueva.** Los dos campos del objetivo son
         * lo único que distingue esto de un alta en la frontera: con ellos,
         * `sec.lock_and_cas` comprueba que la versión que se dice corregir siga
         * siendo la vigente y encadena la nueva detrás. Sin `UPDATE`, sin
         * anular y volver a crear, sin operación independiente.
         *
         * Y va el borrador ENTERO: sólo el importe pudo cambiar, pero el
         * comando describe la versión completa — corregir no es un parche.
         */
        void save(draft.draft, {
          operationId: edit.operationId,
          expectedVersionId: edit.expectedVersionId,
        }).then((ok) => {
          if (ok) onSaved();
        });
      }}
    />
  );
}
