import { UsernameGate } from '@/features/auth';
import { useSession } from '@/features/session';

/**
 * La ruta del gate de username (F12/ADR-001 §7, F12.A3): registrada por
 * `app/_layout.tsx` SOLO mientras la identidad de la cuenta diga `required`, y
 * en lugar de las pestañas. Composición y nada más: el nombre de la sesión es
 * el valor inicial del nombre público, porque las features no se leen entre
 * sí y esta ruta es quien ve las dos.
 */
export default function UsernameGateScreen() {
  const { state } = useSession();
  const initialName = state.status === 'signed-in' ? state.identity.displayName : null;
  return <UsernameGate initialName={initialName} />;
}
