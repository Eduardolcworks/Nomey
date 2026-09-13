import { describe, expect, it } from 'vitest';

import LAYOUT from '../../src/app/_layout.tsx?raw';
import SCREEN from '../../src/app/group/[id].tsx?raw';
import ROUTE from '../../src/app/share-group.tsx?raw';
import BAR from '../../src/features/groups/group-identity-bar.tsx?raw';
import WINDOW from '../../src/features/groups/share-group-window.tsx?raw';
import HOOK from '../../src/features/groups/use-group-invitation.ts?raw';
import LINK from '../../src/features/groups/invitation-link.ts?raw';
import JOIN from '../../src/features/groups/use-join-group.ts?raw';
import QR from '../../src/ui/components/qr-code.tsx?raw';
import MATRIX from '../../src/ui/components/qr-matrix.ts?raw';
import PKG from '../../package.json?raw';

/**
 * «COMPARTIR GRUPO» — F09/ADR-004, la otra mitad de «Únete».
 *
 * Lo estructural se fija aquí; que el enlace codificado sea una invitación
 * válida lo miden `group-invitations.sql` (el contrato) y `qr-code.test.ts`
 * (la matriz y el enlace).
 */

describe('la ventana', () => {
  it('se abre desde el icono de compartir de la cabecera, que ya es un control', () => {
    expect(BAR).toContain('name={Symbols.share}');
    expect(BAR).toContain("label={t('group.shareTitle')}");
    expect(BAR).not.toContain('Compartir: pendiente');
    expect(SCREEN).toMatch(/pathname: '\/share-group',\s*params: \{ id: group\.scopeId \}/);
    // Un grupo sin confirmar en el servidor no se comparte: no hay ámbito que invitar.
    expect(SCREEN).toMatch(/onShare=\{\s*group\.pending\s*\?\s*undefined/);
  });

  it('es la misma familia que Crear grupo: SheetWindow, transparentModal, fade', () => {
    expect(WINDOW).toContain('<SheetWindow');
    expect(WINDOW).toContain("title={t('group.shareTitle')}");
    expect(WINDOW).toContain('<CloseOnBack close={close} />');
    expect(LAYOUT).toContain('name="share-group"');
    expect(ROUTE).toContain('<ShareGroupWindow');
    expect(ROUTE).toContain('useEffect(() => hideBackdrop, [hideBackdrop]);');
  });

  it('nombre real, QR grande y contrastado, y el oblongo amarillo debajo', () => {
    expect(ROUTE).toContain('name={group.displayName}');
    expect(WINDOW).toContain('const qrSize = Math.min(280,');
    expect(WINDOW).toContain('value={invitation.link}');
    expect(QR).toContain("backgroundColor: '#FFFFFF'");
    expect(QR).toContain("backgroundColor: '#000000'");
    expect(QR).toContain('const QUIET = 4;');
    expect(WINDOW).toContain("label={t('group.shareSend')}");
    expect(WINDOW).toContain("tone={invitation.kind === 'ready' ? 'brand' : 'primary'}");
    expect(WINDOW).toContain("disabled={invitation.kind !== 'ready'}");
  });

  it('sin QR ficticio: carga, error con reintento, y el envío apagado sin invitación', () => {
    expect(WINDOW).toContain("invitation.kind === 'loading' ? (\n              <LoadingState");
    expect(WINDOW).toMatch(/label=\{t\('action\.retry'\)\}\s*onPress=\{invitation\.retry\}/);
    expect(HOOK).toContain("reason: 'offline' | 'notMember' | 'rejected'");
  });
});

describe('la invitación', () => {
  it('es la del sistema existente, emitida por su función, y una por grupo y sesión', () => {
    expect(HOOK).toContain("supabase.rpc('create_group_invitation'");
    expect(HOOK).toContain('const CACHE = new Map<string, Issued>();');
    expect(HOOK).toContain("if (cached.kind === 'ready') return;");
    expect(HOOK).not.toMatch(/from 'expo-secure-store'|AsyncStorage/);
    // No se emite en cada render: sólo en el efecto, y a petición.
    expect(HOOK).toContain('useEffect(() => {');
    expect(HOOK).toContain('const retry = useCallback(() => {');
    // Ni un segundo sistema de enlaces: el mismo constructor que lee «Pegar enlace».
    // El enlace lo construye expo-linking para ESTE entorno (exp:// en Expo Go,
    // el esquema de la variante en una build), y «Pegar enlace» lee las dos formas.
    expect(HOOK).toContain('Linking.createURL(JOIN_PATH, { queryParams: { t: token } })');
    expect(JOIN).toContain("import { readInvitation } from './invitation-link';");
    expect(LINK).toContain('export const JOIN_PATH');
    expect(HOOK).not.toMatch(/console\.(log|warn|info)/);
    expect(WINDOW).not.toMatch(/console\.(log|warn|info)/);
  });

  it('abrir Compartir no incorpora a nadie ni toca participantes', () => {
    expect(WINDOW).not.toMatch(/rpc\(|redeem|update_group_profile/);
    expect(HOOK).not.toMatch(/rpc\('redeem|rpc\('update_group_profile|membership/);
  });
});

describe('enviar', () => {
  it('abre la hoja nativa del sistema con la frase y el enlace, y no afirma ningún envío', () => {
    expect(WINDOW).toContain(
      "await Share.share({ message: t('group.shareMessage', { group: name, link }) });",
    );
    expect(WINDOW).not.toMatch(/whatsapp:\/\/|Linking\.openURL/i);
    expect(WINDOW).not.toMatch(/sharedAction|shareSent|Invitación enviada/);
  });

  it('el QR se dibuja con toqr, declarado, y sin módulo nativo', () => {
    expect(PKG).toContain('"toqr": "0.1.1"');
    expect(MATRIX).toContain("from 'toqr'");
    expect(PKG).not.toContain('react-native-svg');
  });
});
