import { type EntryKind, ENTRY_KINDS } from './movement-entry';
import { type MessageKey, useTranslation } from '@/lib/i18n';
import { KindSelector, type KindOption } from '@/ui/components';
import { type PlatformSymbol, useTheme } from '@/ui/theme';

const LABEL: Record<EntryKind, MessageKey> = {
  expense: 'entry.kindExpense',
  income: 'entry.kindIncome',
  transfer: 'entry.kindTransfer',
};

/**
 * Los tres glifos, cada uno con su pareja de plataforma.
 *
 * **El de traslado era el carácter `⇄` y por eso no había manera de centrarlo.**
 * Un texto se centra por su CAJA DE LÍNEA, no por su tinta, y la tinta de ese
 * carácter no está en el centro de su caja: las flechas se dibujan alrededor del
 * eje matemático de la fuente, por encima de la mitad. Da igual cuántos
 * `alignItems: 'center'` se pongan — se estaba centrando bien una caja cuyo
 * contenido está alto. Un símbolo no tiene ese problema: su recuadro ES su
 * dibujo.
 *
 * **Y los tres van como pareja `{ ios, android }`, no sólo el nuevo.** Menos y
 * más se pasaban como cadena suelta, que es un nombre de SF Symbol: fuera de iOS
 * `Icon` no lo resuelve y cae en su recuadro de respaldo. Es el mismo defecto
 * que F06/ADR-009 corrigió en las categorías, y dejar dos de tres sin pareja habría
 * puesto en Android dos huecos vacíos y una flecha.
 *
 * Nombres comprobados contra los vocabularios reales, no de memoria: los de iOS
 * contra `sf-symbols-typescript`, los de Android contra las 4055 entradas de
 * `expo-symbols/android/symbols.json`.
 */
const GLYPH: Record<EntryKind, PlatformSymbol> = {
  expense: { ios: 'minus', android: 'remove' },
  income: { ios: 'plus', android: 'add' },
  transfer: { ios: 'arrow.left.arrow.right', android: 'swap_horiz' },
};

/**
 * Las clases que se pueden CORREGIR, y por tanto las únicas que el selector
 * enseña cuando está bloqueado.
 *
 * El traslado no está aquí por dos razones que se suman: no tiene ruta de
 * escritura todavía, y aunque la tuviera, una corrección no cambia la clase de
 * una operación. Dejar su segmento en modo edición sería ofrecer una conversión
 * imposible por partida doble — y encima reservaría un tercio del ancho para
 * algo que no se puede pulsar.
 *
 * **Bloqueado, la pista se recompone a dos y se vuelve a centrar.** No es un
 * segmento oculto ni un hueco vacío: el ancho sale del número de clases que se
 * dibujan, así que el oblongo mide lo que enseña y el indicador cae donde debe.
 */
const EDITABLE_KINDS: readonly EntryKind[] = ['expense', 'income'];

/**
 * LAS TRES CLASES DE MOVIMIENTO PERSONAL.
 *
 * **El control ya no vive aquí**: está en `ui/components/kind-selector.tsx`,
 * porque el alta de un gasto compartido monta el mismo con sus propias opciones
 * y una feature no puede leer de otra. Lo que queda es lo único que era del Modo
 * Personal: **qué clases hay, con qué glifo, de qué color y cómo se llaman**.
 */
export function EntryKindSelector({
  value,
  onChange,
  locked = false,
}: {
  value: EntryKind;
  onChange: (kind: EntryKind) => void;
  /** Enseña la clase pero no deja cambiarla, y recorta la lista a lo corregible. */
  locked?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  const tone: Record<EntryKind, string> = {
    expense: theme.negative,
    income: theme.positive,
    transfer: theme.neutralFlow,
  };

  const options: readonly KindOption<EntryKind>[] = (locked ? EDITABLE_KINDS : ENTRY_KINDS).map(
    (kind) => ({ key: kind, glyph: GLYPH[kind], tone: tone[kind], label: t(LABEL[kind]) }),
  );

  return <KindSelector options={options} value={value} onChange={onChange} locked={locked} />;
}
