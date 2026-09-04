import { StyleSheet, View } from 'react-native';

import { currencyDefinition, moneyFromMinorString } from '@/domain';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { ActionButton, ThemedText } from '@/ui/components';
import { Radius, Spacing, useTheme } from '@/ui/theme';

import { type CategoryRow, categoryName } from './category';
import { type Incident, incidentMessage } from './incidents';

/**
 * ONE INCIDENT, SAID IN THE PERSON'S WORDS.
 *
 * A sentence about their money and the choices they have. Nothing else reaches
 * this component: no state, no code, no key — ADR-028 §15 keeps §11's taxonomy
 * off the screen, and the two visible forms are all there is.
 *
 * **The amount goes through the shared formatter and the category through the
 * shared catalogue.** Building either by hand here would be a second source of
 * truth for how money reads, and the amount would stop being exact: it comes in
 * as minor units under the definition the entry froze, exactly as it was
 * captured, and `formatMoney` is what turns it into a locale string.
 *
 * **An income has no category, and none is invented** (ADR-027): its sentence
 * simply has no place for one.
 */
export function IncidentCard({
  incident,
  categories,
  busy,
  onYes,
  onNo,
  onReview,
  onDiscard,
}: {
  readonly incident: Incident;
  readonly categories: ReadonlyMap<string, CategoryRow>;
  readonly busy: boolean;
  /** Ordinary form only. */
  readonly onYes: () => void;
  readonly onNo: () => void;
  /** Exceptional form only. */
  readonly onReview: () => void;
  readonly onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();

  const amount = format.money(
    moneyFromMinorString(
      incident.amountMinor,
      currencyDefinition({
        // The definition the entry froze, never the scope's current one: under a
        // changed base currency they differ, and reading it with the new scale
        // would restate the amount (ADR-003 §7).
        id: `${incident.currencyCode}:${String(incident.currencyScale)}`,
        code: incident.currencyCode,
        scale: incident.currencyScale,
      }),
    ),
  );

  const category =
    incident.categoryId === null
      ? null
      : (categoryName(categories.get(incident.categoryId), t) ?? t('incident.unknownCategory'));

  const sentence = t(incidentMessage(incident), {
    amount,
    category: category ?? '',
    concept: incident.concept ?? '',
  });

  const ordinary = incident.form === 'ordinary';

  return (
    <View
      style={[styles.card, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}>
      <ThemedText variant="body">{sentence}</ThemedText>

      <View style={styles.actions}>
        {ordinary ? (
          <>
            {/*
             * LA QUE CONTINÚA VA EN AMARILLO Y LA QUE CIERRA EN NEUTRO.
             *
             * El amarillo es el mismo del CTA de la hoja — `brand` toma sus
             * tokens, no una copia—, y el neutro es el material formalizado de
             * los controles: relleno gris con su rim, sin acento, sin sombra
             * interior y sin elevación. Lo que NO hace el neutro es parecer
             * apagado: conserva su contraste de texto, su tacto y su hitbox.
             */}
            <ActionButton
              label={t('incident.yes')}
              tone="brand"
              busy={busy}
              disabled={busy}
              onPress={onYes}
              style={styles.action}
            />
            <ActionButton
              label={t('incident.no')}
              tone="secondary"
              material="control"
              disabled={busy}
              onPress={onNo}
              style={styles.action}
            />
          </>
        ) : (
          /*
           * Never `Sí` here. For a movement that might already exist, a new key
           * is duplicated money; `Revisar` sends the person to look first
           * (ADR-029 §2). The exceptional form is the one ADR-003 §7 demands.
           */
          <>
            <ActionButton
              label={t('incident.review')}
              tone="brand"
              disabled={busy}
              onPress={onReview}
              style={styles.action}
            />
            <ActionButton
              label={t('incident.discard')}
              tone="secondary"
              material="control"
              busy={busy}
              disabled={busy}
              onPress={onDiscard}
              style={styles.action}
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  /**
   * Envuelve en vez de comprimirse.
   *
   * Con el texto del sistema aumentado, dos etiquetas y sus rellenos pueden no
   * caber en una fila; sin `wrap` una de las dos se recortaría, y recortar una
   * acción es peor que bajarla. Con `flexBasis` cada botón pide la mitad y cede
   * al saltar de línea, así que el caso corriente sigue siendo dos columnas.
   */
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  action: {
    flexGrow: 1,
    flexBasis: 120,
  },
});
