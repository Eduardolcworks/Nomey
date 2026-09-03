import { useLocalSearchParams } from 'expo-router';

import {
  amountEntryFromMinor,
  type MovementEdit,
  MovementEditor,
  type MovementFormScope,
  useEntryCategories,
  usePersonalScope,
} from '@/features/personal';
import { EditWindow } from '@/features/shell';
import { useTranslation } from '@/lib/i18n';

/**
 * Corregir un movimiento reciente.
 *
 * **La misma ventana que editar el Disponible, y lo es de verdad**: las dos
 * rutas montan `EditWindow`, así que el fondo, el panel, el cristal, el
 * encabezado, la X, el teclado y la animación salen de un solo sitio. Esta ruta
 * sólo pone el título y el contenido.
 *
 * **Y la lógica es la contraria a la del saldo.** Aquí no entra
 * `record_adjustment` ni `target_balance`: se corrige la operación con el
 * writer de su clase, y el Disponible cambia porque cambia lo que se deriva de
 * los efectos vigentes — no porque nadie lo fije.
 *
 * **La ventana enseña por ahora una sola cifra**, como la del saldo: sin
 * selector, sin concepto, sin categoría y sin fecha. Esos valores llegan
 * igualmente y viajan intactos en la corrección; lo que falta es su interfaz,
 * que se añade uno a uno después de validar esta ventana.
 *
 * **Los valores llegan por parámetros, no se vuelven a consultar.** Son los de
 * la versión vigente que la fila ya tenía en la mano; un segundo viaje no
 * añadiría exactitud, sólo una ventana de tiempo en la que enseñar algo
 * distinto de lo que se pulsó. Y viajan como texto —el importe en unidades
 * mínimas— así que ningún `number` toca el dinero.
 */
export default function EditMovementScreen() {
  const { t } = useTranslation();
  const { state } = usePersonalScope();
  /*
   * **El MISMO catálogo del alta**, por la misma vía: `useEntryCategories`.
   * Corregir un gasto y darlo de alta eligen entre exactamente la misma lista,
   * y una segunda fuente aquí sería una segunda verdad sobre qué categorías
   * existen.
   */
  const categories = useEntryCategories();

  const params = useLocalSearchParams<{
    operationId?: string;
    versionId?: string;
    kind?: string;
    amount?: string;
    concept?: string;
    categoryId?: string;
    date?: string;
    time?: string;
    scale?: string;
  }>();

  const scope: MovementFormScope | null =
    state.status === 'ready'
      ? {
          scopeId: state.scopeId,
          currencyDefinitionId: state.currencyDefinitionId,
          currencyCode: state.currencyCode,
          currencyScale: state.currencyScale,
        }
      : null;

  /*
   * **La escala llega por parámetro, y por eso el contenido NO espera al
   * ámbito.** Esperarlo dejaba el panel reducido a su encabezado mientras iba y
   * volvía `ensure_personal_scope`: una tira con el título en medio de la
   * pantalla, con el resto de la ventana siendo en realidad el velo. Tocar donde
   * se dibuja la cifra caía FUERA del panel, así que el velo hacía lo que le
   * toca —cerrar—, y el campo del importe ni siquiera estaba montado.
   *
   * Reconstruirlo con una escala supuesta mientras tanto no valía: el borrador
   * siembra su importe UNA vez, con inicializadores perezosos, así que una
   * escala provisional se habría quedado congelada en la cifra a corregir.
   *
   * El ámbito sigue haciendo falta para GUARDAR —de él salen el ámbito y la
   * moneda del comando—, y `blockerFor` ya bloquea `Guardar` hasta que
   * resuelve, exactamente igual que en el `+` y en editar el Disponible.
   */
  const declaredScale = Number.parseInt(params.scale ?? '', 10);
  const scale = Number.isInteger(declaredScale) && declaredScale >= 0 ? declaredScale : 2;

  const edit: MovementEdit | null =
    params.operationId === undefined || params.versionId === undefined
      ? null
      : {
          operationId: params.operationId,
          expectedVersionId: params.versionId,
          kind: params.kind === 'income' ? 'income' : 'expense',
          amount: amountEntryFromMinor(params.amount ?? '0', scale),
          concept: params.concept ?? '',
          categoryId: params.categoryId === '' ? null : (params.categoryId ?? null),
          date: (params.date ?? '') as MovementEdit['date'],
          time: params.time ?? '',
        };

  const contenido = (close: () => void) => {
    // Sin operación que corregir no hay contenido — sólo pasa si se llega a
    // esta ruta sin sus parámetros, no mientras el ámbito resuelve.
    if (edit === null) return null;
    return <MovementEditor scope={scope} edit={edit} categories={categories} onSaved={close} />;
  };

  return <EditWindow title={t('entry.editTitle')}>{contenido}</EditWindow>;
}
