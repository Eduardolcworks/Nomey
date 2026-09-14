import { type MessageKey, useTranslation } from '@/lib/i18n';
import { KindSelector, type KindOption } from '@/ui/components';
import { type PlatformSymbol, useTheme } from '@/ui/theme';

import { GROUP_KINDS, type GroupKind } from './shared-expense';

const LABEL: Record<GroupKind, MessageKey> = {
  expense: 'group.kindExpense',
  transfer: 'group.kindTransfer',
};

/**
 * Los dos glifos, con su pareja de plataforma.
 *
 * Los MISMOS que el Modo Personal usa para las clases equivalentes: el menos del
 * gasto y las dos flechas del traslado. Un grupo no inventa una simbología
 * propia para lo que ya significa lo mismo en la otra pantalla.
 *
 * Nombres comprobados contra los vocabularios reales, no de memoria.
 */
const GLYPH: Record<GroupKind, PlatformSymbol> = {
  expense: { ios: 'minus', android: 'remove' },
  transfer: { ios: 'arrow.left.arrow.right', android: 'swap_horiz' },
};

/**
 * LAS DOS CLASES QUE UN GRUPO ADMITE. **Y por qué son dos y no tres.**
 *
 * Es el mismo control de Inicio —`KindSelector`, con su pista, su indicador
 * deslizante y sus tonos—, acotado al contexto: en un grupo se registra lo que
 * se gasta en común y lo que alguien paga a otro para saldar lo que le debe.
 *
 * **Sin ingreso, y no por simetría.** Un grupo no tiene ingresos: lo que entra
 * en el bolsillo de alguien cuando le devuelven dinero **no es un ingreso**, es
 * la cancelación de una deuda (AGENTS.md §2). Ofrecer el segmento habría
 * invitado a registrar como ganancia lo que sólo es un cobro, que es exactamente
 * el error que ese invariante existe para impedir.
 */
export function ExpenseKindSelector({
  value,
  onChange,
}: {
  readonly value: GroupKind;
  readonly onChange: (kind: GroupKind) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  const tone: Record<GroupKind, string> = {
    expense: theme.negative,
    transfer: theme.neutralFlow,
  };

  const options: readonly KindOption<GroupKind>[] = GROUP_KINDS.map((kind) => ({
    key: kind,
    glyph: GLYPH[kind],
    tone: tone[kind],
    label: t(LABEL[kind]),
  }));

  return <KindSelector options={options} value={value} onChange={onChange} />;
}
