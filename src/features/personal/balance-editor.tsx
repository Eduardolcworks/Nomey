import { useState } from 'react';

import { AmountSheet } from './amount-sheet';
import {
  type AmountEntry,
  amountEntryFromMinor,
  amountValue,
  EMPTY_AMOUNT,
  toMinorUnits,
} from './movement-entry';
import type { MovementFormScope } from './movement-form';
import { useAdjustBalance } from './use-adjust-balance';
import { useTranslation } from '@/lib/i18n';

/**
 * Editar el Disponible: una cifra y nada más.
 *
 * **Fijar el saldo NO es registrar un ingreso.** Lo que se escribe es cuánto
 * hay, y el servidor deriva la diferencia y la asienta como un ajuste (ADR-022).
 * Por eso aquí no hay concepto, ni categoría, ni clase, ni fecha: ninguna de
 * esas cosas pertenece a la frase «mi saldo debe ser X», y ofrecerlas sería
 * pedir datos que el comando no lleva.
 *
 * **Y es la misma ventana que corregir un movimiento**, no una parecida: la
 * composición entera —la fila del importe, el control de moneda, el aviso, el
 * botón— vive en `AmountSheet`. Esta pantalla es esa composición **sin los dos
 * huecos**: sin selector arriba y sin campos abajo.
 *
 * **La moneda no se toca.** El control dice que todavía no cambia nada en lugar
 * de fingir que sí: cambiar la definición monetaria de un ámbito con efectos es
 * imposible por construcción — lo impide la FK compuesta del efecto.
 */
export function BalanceEditor({
  scope,
  current,
  onSaved,
}: {
  readonly scope: MovementFormScope | null;
  /** El Disponible de ahora, en unidades mínimas. `null` mientras no se sabe. */
  readonly current: string | null;
  readonly onSaved: () => void;
}) {
  const { t } = useTranslation();

  const scale = scope?.currencyScale ?? 2;

  /*
   * **EL BORRADOR EMPIEZA VACÍO. El Disponible actual es sólo referencia.**
   *
   * Son dos cosas distintas y ésta es la diferencia que importa: lo que se
   * escribe aquí no es una corrección del saldo de antes, es un saldo nuevo
   * que se declara entero. Precargarlo como valor obligaría a borrar seis
   * dígitos para escribir uno, y la primera pulsación tendría que decidir
   * entre añadir al final o sustituirlo todo — dos comportamientos posibles
   * sobre el mismo gesto, que es exactamente lo que no debe pasar.
   *
   * Vacío, no hay ambigüedad: la primera tecla escribe, el borrado no tiene
   * nada que borrar, y `Guardar cambios` sigue apagado porque todavía no hay
   * ningún cambio.
   *
   * (Corregir un gasto es lo contrario, y ahí el importe anterior SÍ es el
   * borrador: se parte de lo que había.)
   */
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_AMOUNT);

  /*
   * La referencia: la misma conversión de siempre sobre el Disponible que
   * Inicio ya tenía en la mano. No inicializa nada, sólo se enseña apagada
   * mientras nadie escribe.
   */
  const reference = current === null ? undefined : amountEntryFromMinor(current, scale);

  const { status, adjust } = useAdjustBalance(scope);

  const target = toMinorUnits(amountValue(entry), scale);

  /*
   * **Sin cambio no se escribe**, y la comparación es en unidades mínimas: `5`,
   * `5,0` y `5,00` son el mismo saldo, así que ninguno de los tres debe dejar
   * un ajuste de cero en el historial.
   *
   * Un importe ilegible tampoco guarda: no se puede afirmar que sea igual ni
   * que sea distinto. Y sin escribir nada, `toMinorUnits('')` ya devuelve
   * `null`, así que el estado inicial cae aquí sin una condición aparte — no
   * tenerla es lo que impide que las dos se contradigan.
   */
  const unchanged = target === null || current === null || target.toString() === current;

  return (
    <AmountSheet
      entry={entry}
      onChangeEntry={setEntry}
      amountLabel={t('home.balanceLabel')}
      reference={reference}
      currency={scope === null ? null : { code: scope.currencyCode, scale: scope.currencyScale }}
      error={status === 'failed' ? t('home.balanceFailed') : null}
      saveLabel={t('action.saveChanges')}
      saveDisabled={unchanged}
      saving={status === 'saving'}
      onSave={() => {
        void adjust(amountValue(entry)).then((ok) => {
          if (ok) onSaved();
        });
      }}
    />
  );
}
