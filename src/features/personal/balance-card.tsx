import { StyleSheet, View } from 'react-native';

import { currencyDefinition, money } from '@/domain';
import { useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { GlassSurface, IconButton, ThemedText } from '@/ui/components';
import {
  HomeCardRelief,
  homeCardSurface,
  Radius,
  Spacing,
  Symbols,
  type TextColor,
  useTheme,
} from '@/ui/theme';

import { debtDisplay } from './debt-display';
import { toMinor } from './statistics';

export type BalanceCardProps = {
  /** Exacto, en unidad mínima. `null` mientras no se pueda afirmar. */
  readonly amount: string | null;
  readonly currencyCode: string;
  readonly currencyScale: number;
  /**
   * La deuda neta, en unidad mínima y con signo. **Todavía nadie la pasa**, y
   * por eso su valor por defecto es `null`: sin dato la tarjeta dice que no lo
   * sabe, en vez de afirmar un cero que nadie ha derivado. La distinción entre
   * «cero» y «no se sabe» vive en [`debtDisplay`](./debt-display.ts).
   *
   * Negativo = debes · positivo = te deben · cero = en paz. Es el mismo criterio
   * de signo que usan los efectos de deuda en `core`, así que F9 podrá
   * enchufarlo sin traducir nada.
   */
  readonly debt?: string | null;
  /** Ajustar el saldo. La escritura llega en F6.F. */
  readonly onAdjust: () => void;
};

/**
 * El color de una cifra de deuda.
 *
 * La semántica visual prevista, escrita ya para que F9 no tenga que decidirla
 * otra vez: **rojo si debes, verde si te deben, blanco si estás en paz**.
 *
 * No es lógica ficticia: se aplica al valor que la tarjeta tiene en la mano, y
 * sólo cuando hay valor. Sin dato no se elige color, porque no se pinta cifra.
 *
 * Y el color **nunca va solo**: la cifra lleva su etiqueta «Deudas» encima y su
 * signo, que es lo que exige `design-direction.md` §8.
 */
export function debtTone(minor: bigint): TextColor {
  if (minor < 0n) return 'negative';
  if (minor > 0n) return 'positive';
  return 'text';
}

/**
 * Cuánto baja la columna izquierda para que las dos etiquetas se lean a la
 * misma altura.
 *
 * El oblongo tiene su propio relleno vertical, así que su etiqueta empieza más
 * abajo que la de fuera. Igualarlo con este desplazamiento —y no moviendo el
 * oblongo hacia arriba— evita que el sub-bloque se salga del relleno de la
 * tarjeta, que es donde se notaría al agrandar el tipo de letra del sistema.
 */
const LABEL_ALIGN = Spacing.sm;

/**
 * El `Disponible` del Modo Personal, y la deuda a su lado.
 *
 * **La cifra viene de `api.personal_balance` y no se calcula aquí.** El
 * servidor la deriva de la proyección canónica; el cliente no descarga
 * movimientos para sumarlos, que es lo que ADR-025 existe para evitar.
 *
 * **`null` no es cero.** Mientras el saldo no se pueda afirmar se pinta un
 * marcador de posición sin cifra, en vez de un `0` que se leería como un dato.
 *
 * **DOS COLUMNAS, no una esquina compartida.** Antes la deuda y el lápiz caían
 * los dos abajo a la derecha y competían por el mismo sitio; ahora la tarjeta se
 * lee como lo que es —dos magnitudes emparejadas— con la deuda en su propio
 * sub-bloque arriba a la derecha y el lápiz solo, abajo.
 *
 * **El oblongo usa `GlassSurface`, y la elección de recurso importa.**
 * `design-direction.md` §4 reserva el glass a las **superficies que
 * contienen**, que es exactamente lo que este sub-bloque es; §5 reserva el
 * neumorfismo a los **controles que responden**, y éste no responde a nada. Por
 * eso va con `depth="flat"`: conserva el brillo del borde que lo separa del
 * fondo y **no** toma el sombreado táctil, para que no se lea como un botón.
 *
 * **El amarillo es identidad**, no decoración: es la única cifra de la pantalla
 * que responde «cuánto tengo». Medido en `colors.ts`: 13,2:1.
 */
export function BalanceCard({
  amount,
  currencyCode,
  currencyScale,
  debt = null,
  onAdjust,
}: BalanceCardProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();

  const definition = currencyDefinition({
    id: 'personal-base',
    code: currencyCode,
    scale: currencyScale,
  });

  const shownDebt = debtDisplay(debt);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: homeCardSurface(theme.surface), borderColor: theme.border },
        HomeCardRelief,
      ]}>
      <View style={styles.columns}>
        <View style={styles.available}>
          <ThemedText variant="caption" themeColor="textTertiary">
            {t('home.available')}
          </ThemedText>

          {amount === null ? (
            <ThemedText variant="amountHero" themeColor="textDisabled">
              {t('home.amountPending')}
            </ThemedText>
          ) : (
            <ThemedText
              variant="amountHero"
              themeColor="accent"
              numberOfLines={1}
              adjustsFontSizeToFit>
              {format.money(money(toMinor(amount), definition))}
            </ThemedText>
          )}
        </View>

        {/*
         * El sub-bloque de Deudas. NO es interactivo y no debe parecerlo: sin
         * `Pressable`, sin rol de botón y sin sombreado táctil.
         */}
        <GlassSurface level="regular" depth="flat" radius={Radius.md} style={styles.debt}>
          <ThemedText variant="caption" themeColor="textTertiary">
            {t('home.debts')}
          </ThemedText>
          {/*
           * `amountRow` y no `amountHero`: presencia suficiente para leerse como
           * una magnitud de la tarjeta, sin disputarle la jerarquía al
           * Disponible, que es la cifra que la tarjeta existe para responder.
           *
           * Y sin dato, EL MISMO marcador que el Disponible: `home.amountPending`
           * en `textDisabled`. No es una convención nueva —es la que ya usaban
           * el saldo y las dos tarjetas de flujo—, así que las cuatro cifras de
           * la pantalla dicen «no se sabe» de la misma manera.
           */}
          {shownDebt.kind === 'unknown' ? (
            <ThemedText variant="amountRow" themeColor="textDisabled">
              {t('home.amountPending')}
            </ThemedText>
          ) : (
            <ThemedText
              variant="amountRow"
              themeColor={debtTone(shownDebt.minor)}
              numberOfLines={1}>
              {format.money(money(shownDebt.minor, definition))}
            </ThemedText>
          )}
        </GlassSurface>
      </View>

      {/*
       * Solo, abajo a la derecha, y bajo el oblongo. Sigue siendo únicamente
       * affordance en F6.E — ajustar el saldo escribe, y escribir es de F6.F.
       */}
      <IconButton
        name={Symbols.edit}
        label={t('home.adjustBalance')}
        onPress={onAdjust}
        size={18}
        filled
        style={styles.adjust}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  /*
   * Las dos magnitudes, en paralelo. `flex-start` para que el oblongo se ajuste
   * a su contenido en vez de estirarse hasta el alto de la cifra principal.
   */
  columns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  /*
   * `flex: 1` con `minWidth: 0` para que una cifra larga encoja con
   * `adjustsFontSizeToFit` en vez de empujar al oblongo fuera de la tarjeta.
   */
  available: {
    flex: 1,
    minWidth: 0,
    paddingTop: LABEL_ALIGN,
    gap: Spacing.xs,
  },
  debt: {
    alignItems: 'flex-start',
    paddingVertical: LABEL_ALIGN,
    paddingHorizontal: Spacing.md,
    gap: Spacing.xxs,
  },
  /*
   * En el flujo y alineado a la derecha, así que cae bajo el oblongo sin
   * solaparlo. Nada de posición absoluta: se rompería en cuanto alguien
   * agrandara el tipo de letra del sistema.
   */
  adjust: {
    alignSelf: 'flex-end',
  },
});
