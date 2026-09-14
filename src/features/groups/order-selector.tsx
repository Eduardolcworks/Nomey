import { StyleSheet, View } from 'react-native';

import { type MessageKey, useTranslation } from '@/lib/i18n';
import { OptionMenu, ROUND_TRIGGER, RoundTrigger } from '@/ui/components';
import { Symbols } from '@/ui/theme';

import { type GroupOrder, GROUP_ORDERS } from './group-service';

/**
 * ORDENAR: un botón redondo que abre DIRECTAMENTE el menú del sistema.
 *
 * **Ordena, y no esconde nada.** Ninguna de las cuatro opciones deja gastos
 * fuera: las cuatro enseñan la misma lista en distinto orden. Quitar filas es lo
 * que hace el embudo de al lado, y por eso son dos controles y no uno.
 *
 * **No toca los filtros ni abre su panel.** Cambiar el orden con un filtro
 * puesto reordena lo que ese filtro deja ver, que es lo que alguien espera.
 *
 * **Las dos de fecha son la fecha DEL GASTO**, `effective_date`, no el instante
 * en que se sincronizó: registrar hoy una cena de la semana pasada la coloca
 * donde ocurrió. Y **las dos de importe ordenan por el valor exacto**, no por su
 * texto: `100,00 €` va después de `9,00 €` porque se compara el entero de
 * unidades menores, y no dos cadenas donde `'1'` precede a `'9'`.
 *
 * Quien ordena de verdad es el servidor —`fetchGroupOperations` lo pide en la
 * consulta—; esto sólo dice cuál está elegido.
 *
 * **El disparador va DENTRO del menú**, que es la única disposición que se
 * comprobó que recibe el toque: lo que se pulsa no es la vista de React Native
 * sino el nodo de Compose que hay dentro.
 */
const ORDER_LABEL = {
  dateDesc: 'group.orderDateDesc',
  dateAsc: 'group.orderDateAsc',
  amountDesc: 'group.orderAmountDesc',
  amountAsc: 'group.orderAmountAsc',
} as const satisfies Record<GroupOrder, MessageKey>;

export type OrderSelectorProps = {
  readonly value: GroupOrder;
  readonly onChange: (order: GroupOrder) => void;
};

export function OrderSelector({ value, onChange }: OrderSelectorProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.slot}>
      <OptionMenu
        title={t('group.sortTitle')}
        options={GROUP_ORDERS.map((order) => ({
          id: order,
          title: t(ORDER_LABEL[order]),
          selected: order === value,
        }))}
        onSelect={(id) => {
          /*
           * Se comprueba contra el vocabulario en vez de convertir a ciegas: el
           * identificador vuelve del lado nativo como texto, y una opción que no
           * esté en la lista no cambia el orden en lugar de dejarlo indefinido.
           */
          const chosen = GROUP_ORDERS.find((order) => order === id);
          if (chosen !== undefined) onChange(chosen);
        }}
        height={ROUND_TRIGGER}>
        <RoundTrigger
          name={Symbols.sort}
          /*
           * El nombre accesible lleva DENTRO la opción vigente: un icono de dos
           * flechas no dice cómo está ordenada la lista, y quien no ve la
           * pantalla no tiene otro sitio donde enterarse.
           */
          label={t('group.orderChosen', { name: t(ORDER_LABEL[value]) })}
        />
      </OptionMenu>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Marco de lado declarado: el menú necesita saber cuánto mide su hueco. */
  slot: {
    width: ROUND_TRIGGER,
    height: ROUND_TRIGGER,
  },
});
