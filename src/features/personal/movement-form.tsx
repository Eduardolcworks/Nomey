import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AmountSheet } from './amount-sheet';
import { EntryKindSelector } from './entry-kind-selector';
import { BLOCKER_HINT } from './movement-blocker';
import { MovementFields } from './movement-fields';
import type { EntryCategories } from './use-entry-categories';
import type { EntryQueue } from './use-entry-queue';
import { type AmountEntry } from './movement-entry';
import { useMovementDraft } from './use-movement-draft';
import { useTranslation } from '@/lib/i18n';
import { ThemedText } from '@/ui/components';
import { Spacing } from '@/ui/theme';

/**
 * What the «Transferencia» slot shares with this form: THE SAME amount and
 * concept the person typed for a movement (F12.C2). One source of truth —
 * this form's draft — so switching Gasto ↔ Ingreso ↔ Transferencia in any
 * direction keeps the figure. The slot renders against it; it owns nothing
 * of its own but what only a transfer has.
 */
export type TransferSlot = {
  readonly entry: AmountEntry;
  readonly setEntry: (next: AmountEntry) => void;
  readonly concept: string;
  readonly setConcept: (next: string) => void;
};

export type MovementFormScope = {
  readonly scopeId: string;
  readonly currencyDefinitionId: string;
  readonly currencyCode: string;
  readonly currencyScale: number;
  /**
   * La base del ámbito, SÓLO cuando la moneda del formulario no lo es: al
   * corregir una operación en moneda extranjera (F11.C). Un alta nunca la
   * lleva, porque F11.C no permite crearlas desde la interfaz.
   */
  readonly baseCurrencyDefinitionId?: string;
};

/**
 * Registrar un movimiento personal. **Sólo el alta, y siempre por la cola.**
 *
 * Desde F7.D guardar no envía nada: **persiste** la intención con su clave en
 * SQLite (`useEntryQueue`), y sólo si eso quedó demostrado se cierra la hoja.
 * La proyección de Inicio pinta el movimiento de inmediato y el worker lo envía
 * por detrás; con red o sin ella, la hoja se comporta igual (F07/ADR-001 §1, §8).
 * Si la base falla, la hoja y el borrador se quedan y se dice: no se intenta
 * una petición directa para salvarlo.
 *
 * **Corregir uno existente es otra pantalla** —`MovementEditor`— y sigue
 * enviando directamente con su CAS: F07/ADR-001 §4 deja las correcciones fuera de
 * la cola. Lo que las dos comparten son las piezas: la composición, los campos
 * y el borrador.
 *
 * **La categoría desaparece cuando la clase es un ingreso; no se desactiva.**
 * Es la consecuencia visual de F06/ADR-009 §3: `category_id` no es un campo
 * admisible de esa clase y mandarlo se rechaza por FORMA del payload. Un
 * control desactivado describiría un permiso; su ausencia describe el contrato.
 *
 * **Sin red y sin catálogo previo, el gasto se bloquea y se explica** (F07/ADR-001
 * §16): no se inventa una categoría ni se encola un gasto sin ella. El ingreso
 * no se bloquea por eso, porque no la lleva.
 *
 * **El importe es el foco y no lleva moneda dentro.** El símbolo vive en su
 * propio cuadro, a la izquierda: hoy es la moneda base del ámbito y sólo se
 * puede mirar.
 *
 * **La clase «Transferencia» no es un movimiento y no la registra este
 * formulario.** Dentro caben dos cosas —una PROPUESTA a otra cuenta
 * (F12/ADR-002) y un ENLACE para que otra cuenta pague (F12/ADR-004)— y
 * las dos viven en `features/transfers`, que una feature no importa, así
 * que la ruta las monta y las pasa por `transfer`: con ese segmento
 * elegido, el selector de clase se queda y lo que hay debajo es lo que la
 * ruta entregó. Sin nada entregado se bloquea el guardado con el aviso de
 * siempre, que es lo que hacía antes de F12.C.
 */
export function MovementForm({
  scope,
  categories,
  queue,
  initial,
  resolving,
  onSaved,
  transfer,
}: {
  scope: MovementFormScope | null;
  categories: EntryCategories;
  /** La cola del actor, montada por la ruta: `features/` no puede leer la sesión. */
  queue: EntryQueue;
  /**
   * Con qué llega la hoja rellena, cuando se abre desde `Revisar`.
   *
   * **El importe no viene nunca** (F07/ADR-002 §3): el de la entrada en conflicto
   * pertenece a otra definición monetaria, y traerlo lo convertiría en doce de
   * algo distinto sin que nadie hubiera convertido nada.
   */
  initial?: Parameters<typeof useMovementDraft>[2];
  /** La entrada terminal que se resolverá al guardar, en la misma transacción. */
  resolving?: string | null;
  onSaved: () => void;
  /**
   * Lo que se pinta bajo el selector con «Transferencia» elegida (F12.C),
   * construido sobre el importe y el concepto de ESTE borrador.
   */
  transfer?: (shared: TransferSlot) => ReactNode;
}) {
  const { t } = useTranslation();

  const scale = scope?.currencyScale ?? 2;
  const draft = useMovementDraft(scale, scope !== null, initial, !categories.unavailable);

  /*
   * **El ámbito se anuncia al DAR DE ALTA**, porque aquí se está decidiendo
   * dónde cae el movimiento. Al corregir uno ya existente no se elige, así que
   * allí no se repite. La misma cabecera en las dos ramas de abajo.
   */
  const header = (
    <>
      <EntryKindSelector value={draft.kind} onChange={draft.setKind} />
      <ThemedText variant="label" themeColor="textSecondary" style={styles.scope}>
        {t('scope.personal')}
      </ThemedText>
    </>
  );

  if (draft.kind === 'transfer' && transfer !== undefined) {
    return (
      <View style={styles.transfer}>
        {header}
        {transfer({
          entry: draft.entry,
          setEntry: draft.setEntry,
          concept: draft.concept,
          setConcept: draft.setConcept,
        })}
      </View>
    );
  }

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
      header={header}
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
        void queue.enqueue(draft.draft, scope, resolving).then((ok) => {
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
  transfer: {
    gap: Spacing.md,
  },
});
