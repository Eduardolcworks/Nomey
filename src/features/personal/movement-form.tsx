import { StyleSheet } from 'react-native';

import { AmountSheet } from './amount-sheet';
import { EntryKindSelector } from './entry-kind-selector';
import { BLOCKER_HINT } from './movement-blocker';
import { MovementFields } from './movement-fields';
import type { EntryCategories } from './use-entry-categories';
import type { EntryQueue } from './use-entry-queue';
import { useMovementDraft } from './use-movement-draft';
import { useTranslation } from '@/lib/i18n';
import { ThemedText } from '@/ui/components';

export type MovementFormScope = {
  readonly scopeId: string;
  readonly currencyDefinitionId: string;
  readonly currencyCode: string;
  readonly currencyScale: number;
};

/**
 * Registrar un movimiento personal. **Sólo el alta, y siempre por la cola.**
 *
 * Desde F7.D guardar no envía nada: **persiste** la intención con su clave en
 * SQLite (`useEntryQueue`), y sólo si eso quedó demostrado se cierra la hoja.
 * La proyección de Inicio pinta el movimiento de inmediato y el worker lo envía
 * por detrás; con red o sin ella, la hoja se comporta igual (ADR-028 §1, §8).
 * Si la base falla, la hoja y el borrador se quedan y se dice: no se intenta
 * una petición directa para salvarlo.
 *
 * **Corregir uno existente es otra pantalla** —`MovementEditor`— y sigue
 * enviando directamente con su CAS: ADR-028 §4 deja las correcciones fuera de
 * la cola. Lo que las dos comparten son las piezas: la composición, los campos
 * y el borrador.
 *
 * **La categoría desaparece cuando la clase es un ingreso; no se desactiva.**
 * Es la consecuencia visual de ADR-027 §3: `category_id` no es un campo
 * admisible de esa clase y mandarlo se rechaza por FORMA del payload. Un
 * control desactivado describiría un permiso; su ausencia describe el contrato.
 *
 * **Sin red y sin catálogo previo, el gasto se bloquea y se explica** (ADR-028
 * §16): no se inventa una categoría ni se encola un gasto sin ella. El ingreso
 * no se bloquea por eso, porque no la lleva.
 *
 * **El importe es el foco y no lleva moneda dentro.** El símbolo vive en su
 * propio cuadro, a la izquierda: hoy es la moneda base del ámbito y sólo se
 * puede mirar.
 */
export function MovementForm({
  scope,
  categories,
  queue,
  onSaved,
}: {
  scope: MovementFormScope | null;
  categories: EntryCategories;
  /** La cola del actor, montada por la ruta: `features/` no puede leer la sesión. */
  queue: EntryQueue;
  onSaved: () => void;
}) {
  const { t } = useTranslation();

  const scale = scope?.currencyScale ?? 2;
  const draft = useMovementDraft(scale, scope !== null, undefined, !categories.unavailable);

  /*
   * Qué se dice cuando no quedó persistida. Sin sesión o con un borrador que la
   * cola no admite es el mismo mensaje genérico; una base que no responde tiene
   * el suyo, porque la salida es distinta: reintentar aquí mismo, no cambiar
   * nada del formulario.
   */
  const error =
    queue.failure === null
      ? null
      : queue.failure === 'storeUnavailable'
        ? t('entry.queueFailed')
        : t('entry.saveFailed');

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
      fields={<MovementFields draft={draft} categories={categories.rows} kind={draft.kind} />}
      entry={draft.entry}
      onChangeEntry={draft.setEntry}
      amountLabel={t('entry.amountLabel')}
      currency={scope === null ? null : { code: scope.currencyCode, scale: scope.currencyScale }}
      hint={draft.blocker === null ? null : t(BLOCKER_HINT[draft.blocker])}
      error={error}
      saveLabel={t('action.save')}
      saveDisabled={draft.blocker !== null}
      saving={queue.saving}
      onSave={() => {
        if (scope === null) return;
        // 3 → 5: se cierra SÓLO cuando la entrada quedó en disco.
        void queue.enqueue(draft.draft, scope).then((ok) => {
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
