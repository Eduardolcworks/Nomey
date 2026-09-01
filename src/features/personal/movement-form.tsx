import { StyleSheet } from 'react-native';

import { AmountSheet } from './amount-sheet';
import type { CategoryRow } from './category';
import { EntryKindSelector } from './entry-kind-selector';
import { BLOCKER_HINT } from './movement-blocker';
import { MovementFields } from './movement-fields';
import { useMovementDraft } from './use-movement-draft';
import { useRecordMovement } from './use-record-movement';
import { useTranslation } from '@/lib/i18n';
import { ThemedText } from '@/ui/components';

export type MovementFormScope = {
  readonly scopeId: string;
  readonly currencyDefinitionId: string;
  readonly currencyCode: string;
  readonly currencyScale: number;
};

/**
 * Registrar un movimiento personal. **Sólo el alta.**
 *
 * **Corregir uno existente no tiene pantalla ahora mismo**: se retiró entera
 * para rehacerla, y el lápiz de una fila reciente se queda a la vista pero
 * apagado hasta entonces. Lo que sigue en pie es la capacidad —el writer de
 * corrección, el payload con `operation_id` y `expected_version_id`, y la
 * idempotencia por intención— y las piezas que la nueva volverá a usar: la
 * composición, los campos y el borrador, que este alta también usa.
 *
 * Lo que NO vuelve es el modo de edición dentro de este formulario. Dar de alta
 * y corregir hacen cosas distintas —ésta elige clase, anuncia el ámbito y parte
 * de cero— y meterlas en un componente con dos comportamientos dentro fue el
 * error que llevó a separarlas.
 *
 * **La categoría desaparece cuando la clase es un ingreso; no se desactiva.**
 * Es la consecuencia visual de ADR-027 §3 y la decisión merece decirse: un
 * control gris y apagado afirma «esto existe para los ingresos y ahora no se
 * puede», y lo cierto es lo contrario —`category_id` no es un campo admisible
 * de esta clase y mandarlo se rechaza por FORMA del payload—. Un control
 * desactivado describiría un permiso; su ausencia describe el contrato.
 *
 * **El importe es el foco y no lleva moneda dentro.** El símbolo vive en su
 * propio cuadro, a la izquierda, porque es una pieza distinta: hoy es la moneda
 * base del ámbito y sólo se puede mirar, y el día que se pueda cambiar el
 * control ya está donde tiene que estar.
 */
export function MovementForm({
  scope,
  categories,
  onSaved,
}: {
  scope: MovementFormScope | null;
  categories: readonly CategoryRow[];
  onSaved: () => void;
}) {
  const { t } = useTranslation();

  const scale = scope?.currencyScale ?? 2;
  const draft = useMovementDraft(scale, scope !== null);
  const { status, save } = useRecordMovement(scope);

  return (
    <AmountSheet
      header={
        <>
          <EntryKindSelector value={draft.kind} onChange={draft.setKind} />
          {/*
           * **El ámbito se anuncia al DAR DE ALTA**, porque aquí se está
           * decidiendo dónde cae el movimiento. Al corregir uno ya existente no
           * se elige, así que allí no se repite.
           */}
          <ThemedText variant="label" themeColor="textSecondary" style={styles.scope}>
            {t('scope.personal')}
          </ThemedText>
        </>
      }
      fields={<MovementFields draft={draft} categories={categories} kind={draft.kind} />}
      entry={draft.entry}
      onChangeEntry={draft.setEntry}
      amountLabel={t('entry.amountLabel')}
      currency={scope === null ? null : { code: scope.currencyCode, scale: scope.currencyScale }}
      hint={draft.blocker === null ? null : t(BLOCKER_HINT[draft.blocker])}
      error={status === 'failed' ? t('entry.saveFailed') : null}
      saveLabel={t('action.save')}
      saveDisabled={draft.blocker !== null}
      saving={status === 'saving'}
      onSave={() => {
        void save(draft.draft).then((ok) => {
          if (ok) onSaved();
        });
      }}
    />
  );
}

/** Sin uso fuera de esta pantalla: el ámbito sólo se anuncia al dar de alta. */
const styles = StyleSheet.create({
  scope: {
    textAlign: 'center',
  },
});
