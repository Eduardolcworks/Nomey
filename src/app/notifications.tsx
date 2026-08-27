import { PlaceholderScreen } from '@/features/shell';
import { useTranslation } from '@/lib/i18n';

/**
 * Notifications, as structure only.
 *
 * Pushed rather than presented as a sheet: it is a place with content and a
 * back affordance, not a task that is started and finished.
 */
export default function NotificationsScreen() {
  const { t } = useTranslation();
  return <PlaceholderScreen title="nav.notifications" body={t('notifications.empty')} />;
}
