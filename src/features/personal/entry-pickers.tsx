import { calendarDateOf, dateFromCalendar } from './movement-entry';
import { type CalendarDate } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { DateSheet as SharedDateSheet } from '@/ui/components';

/**
 * EL CALENDARIO DEL MOVIMIENTO, con los textos y el calendario de Nomey.
 *
 * **La presentación ya no vive aquí**: está en `ui/components/date-sheet.tsx`,
 * porque el alta de un gasto compartido monta exactamente la misma y una feature
 * no puede leer de otra. Lo que queda es lo único que era de esta pantalla: los
 * tres textos, y la conversión entre el `Date` del control nativo y el
 * `CalendarDate` con el que el borrador habla — que es una fecha de calendario
 * local, no un instante, y por eso no se deja al control decidirla.
 */
export function DateSheet({
  visible,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: CalendarDate;
  onSelect: (date: CalendarDate) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <SharedDateSheet
      visible={visible}
      value={dateFromCalendar(value)}
      onSelect={(date) => {
        onSelect(calendarDateOf(date));
      }}
      onClose={onClose}
      title={t('entry.dateTitle')}
      doneLabel={t('action.done')}
      closeLabel={t('action.close')}
    />
  );
}
