import { StyleSheet, TextInput, View } from 'react-native';

import type { CategoryRow } from './category';
import { categoryIcon, categoryName } from './category';
import { CategoryMenu } from './category-menu';
import { DateSheet } from './entry-pickers';
import { type EntryKind, usesCategory } from './movement-entry';
import type { MovementDraft } from './use-movement-draft';
import { useTranslation } from '@/lib/i18n';
import { GlassPressable, GlassSurface, Icon } from '@/ui/components';
import { Radius, Spacing, useTheme } from '@/ui/theme';

/** El lado de los dos círculos de la fila, y del oblongo del concepto. */
const CIRCLE = 52;

/**
 * Lo que un movimiento tiene además de una cifra: concepto, categoría y fecha.
 *
 * **Van juntos porque se leen juntos**: el concepto ocupando el ancho y dos
 * círculos a la derecha. Dar de alta y corregir usan esta misma pieza, así que
 * no hay dos versiones de los mismos campos que puedan separarse.
 *
 * **Un ingreso no lleva categoría, y su círculo DESAPARECE en vez de
 * desactivarse.** Un control gris afirma «esto existe para los ingresos y ahora
 * no se puede», y lo cierto es lo contrario: `category_id` no es un campo
 * admisible de esa clase y mandarlo se rechaza por FORMA del payload
 * (ADR-027 §3). Un control apagado describiría un permiso; su ausencia describe
 * el contrato.
 */
export function MovementFields({
  draft,
  categories,
  kind,
}: {
  readonly draft: MovementDraft;
  readonly categories: readonly CategoryRow[];
  readonly kind: EntryKind;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  const chosen = categories.find((row) => row.id === draft.categoryId) ?? null;

  return (
    <>
      <View style={styles.conceptRow}>
        <GlassSurface
          level="regular"
          depth="well"
          rim="soft"
          radius={Radius.full}
          /* Superficie de campo: se toca y se escribe en ella. Es un control. */
          nativeEffect={false}
          style={styles.conceptBox}>
          <TextInput
            value={draft.concept}
            onChangeText={draft.setConcept}
            placeholder={t('entry.conceptPlaceholder')}
            placeholderTextColor={theme.textDisabled}
            accessibilityLabel={t('entry.conceptLabel')}
            style={[styles.conceptInput, { color: theme.text }]}
          />
        </GlassSurface>

        {usesCategory(kind) ? (
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
        ) : null}

        <GlassPressable
          label={t('entry.dateLabel')}
          depth="well"
          onPress={() => {
            draft.setPicking('date');
          }}>
          <View style={styles.circle}>
            <Icon name="calendar" size={20} colour={theme.textSecondary} shape="circle" />
          </View>
        </GlassPressable>
      </View>

      {/*
       * El calendario del sistema viaja con el campo que lo abre. La categoría
       * ya no monta nada aquí: su menú vive ANCLADO a su propio botón, que es
       * lo que lo hace un menú del sistema y no una hoja disfrazada.
       */}
      <DateSheet
        visible={draft.picking === 'date'}
        value={draft.date}
        onSelect={draft.setDate}
        onClose={() => {
          draft.setPicking(null);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  conceptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  conceptBox: {
    flex: 1,
    height: CIRCLE,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  conceptInput: {
    fontSize: 16,
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
