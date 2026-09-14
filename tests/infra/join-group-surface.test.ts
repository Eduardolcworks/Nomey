import { describe, expect, it } from 'vitest';

import ROUTE from '../../src/app/group-action.tsx?raw';
import SHEET from '../../src/features/groups/group-action-sheet.tsx?raw';
import PANEL from '../../src/features/groups/join-panel.tsx?raw';
import SCANNER from '../../src/features/groups/qr-scanner.tsx?raw';
import HOOK from '../../src/features/groups/use-join-group.ts?raw';
import SERVICE from '../../src/features/groups/invitation-service.ts?raw';
import LINK from '../../src/features/groups/invitation-link.ts?raw';
import CONFIG from '../../app.config.ts?raw';
import PKG from '../../package.json?raw';
import MIGRATION from '../../supabase/migrations/20260911150000_group_invitations.sql?raw';
import REJOIN from '../../supabase/migrations/20260914140000_rejoin_after_departure.sql?raw';
import REJOIN_CHECK from '../../supabase/checks/rejoin-after-departure.sql?raw';
import CHECK from '../../supabase/checks/group-invitations.sql?raw';

/**
 * «ÚNETE A UN GRUPO» — F09/ADR-004.
 *
 * Sin renderer de React, lo estructural se fija aquí; el contrato —emitir,
 * previsualizar, canjear, freno, conflicto, reincorporación— lo mide
 * `supabase/checks/group-invitations.sql` contra la base real.
 */

describe('la ventana: la misma hoja, tres vistas', () => {
  it('«Únete» cambia el contenido dentro del mismo panel, sin otra ventana', () => {
    expect(SHEET).toContain("type Mode = 'choose' | 'join' | 'who';");
    expect(SHEET).toContain("mode === 'join' ? (\n          <JoinEntry");
    expect(SHEET).toContain("mode === 'who' && invitation.status.kind === 'ready'");
    // El mismo alto, el mismo material: nada nuevo en el panel.
    expect(SHEET).toContain('height: panelHeight,');
    expect(SHEET.match(/sheetHeight\(height\)/g)?.length).toBe(1);
    // La vista inicial y el formulario de crear no cambian.
    expect(SHEET).toContain('GROUP_ACTIONS.map((action) =>');
    expect(ROUTE).toContain("router.push('/create-group')");
  });

  it('arriba «Escanear QR» con el emblema lila; abajo «Pegar enlace» sin teclado y el avión redondo', () => {
    expect(PANEL).toContain('level="join"');
    expect(PANEL).toContain('colour={theme.joinAccent}');
    expect(PANEL).toContain('name={Symbols.qr}');
    // Sin teclado: el oblongo es un botón que lee el portapapeles SÓLO al tocar.
    expect(PANEL).toContain("import * as Clipboard from 'expo-clipboard';");
    expect(PANEL).toContain('onPress={paste}');
    expect(PANEL).toContain('void Clipboard.getStringAsync()');
    expect(PANEL).not.toMatch(/keyboardType="url"/);
    expect(PANEL).not.toMatch(/useEffect\([^)]*Clipboard/);
    expect(PKG).toContain('"expo-clipboard": "~57.0.1"');
    // Pegar rellena y valida; la unión la inicia el avión.
    expect(PANEL).toContain('onChangeText(trimmed);');
    expect(PANEL).not.toContain('onSend()');
    // El avión: redondo, mismo material y alto que el oblongo.
    expect(PANEL).toContain('const LINK_HEIGHT = 44;');
    expect(PANEL).toContain('width: LINK_HEIGHT,\n    height: LINK_HEIGHT,');
    expect(PANEL).toContain(
      'style={[styles.plane, ready ? { backgroundColor: theme.accent } : null]}',
    );
    expect(PANEL).toContain('name={Symbols.send}');
    // Apagado hasta que el servidor confirma; amarillo entonces; carga mientras.
    expect(PANEL).toContain('disabled={!ready || disabled}');
    expect(PANEL).toMatch(/\{checking \? \(\s*<ActivityIndicator/);
    // El error conserva el texto: no hay ningún setText('') al fallar.
    expect(HOOK).not.toMatch(/setText\(''\)/);
  });

  it('sin peticiones por carácter, y sin que una respuesta vieja valide un enlace nuevo', () => {
    expect(HOOK).toContain('export const PREVIEW_DEBOUNCE_MS = 450;');
    expect(HOOK).toContain('const mine = ++serial.current;');
    expect(HOOK).toContain('if (serial.current !== mine) return;');
    expect(HOOK).toContain('return () => clearTimeout(wait);');
    // Lo que no es una invitación no se pregunta.
    expect(HOOK).toContain('const token = readInvitation(text);');
    expect(HOOK).toContain("{ kind: 'notInvitation' }");
  });
});

describe('QR y enlace: el mismo flujo', () => {
  it('el avión y el QR van a «¿Quién eres?» sin confirmación intermedia, o abren el grupo si ya se es miembro', () => {
    expect(SHEET).toContain("if (preview.membership === 'member' && preview.scopeId !== null) {");
    expect(SHEET).toContain("setMode('who');");
    expect(SHEET).toContain('invitation.setText(token);\n    setAutoSend(true);');
    expect(ROUTE).toContain("router.replace({ pathname: '/group/[id]', params: { id: scopeId } })");
  });

  it('el escáner: expo-camera, sólo QR, sin audio, permiso al abrir, una lectura, ajeno rechazado', () => {
    expect(PKG).toContain('"expo-camera": "~57.0.4"');
    expect(SCANNER).toContain("from 'expo-camera'");
    expect(SCANNER).toContain("barcodeScannerSettings={{ barcodeTypes: ['qr'] }}");
    expect(SCANNER).toContain('mute');
    expect(SCANNER).not.toMatch(/recordAsync|takePictureAsync/);
    expect(SCANNER).toContain('void requestPermission();');
    // Se monta sólo al abrir: el permiso no se pide antes.
    expect(SHEET).toContain('{scanning ? (\n        <QrScanner');
    expect(SCANNER).toContain('if (handled.current) return;');
    expect(SCANNER).toContain('active={!done}');
    expect(SCANNER).toContain('const token = readInvitation(result.data);');
    expect(SCANNER).not.toMatch(/Linking\.openURL|WebBrowser/);
    // Denegado: se vuelve, y queda la alternativa del enlace.
    expect(SCANNER).toContain("t('groups.scanDenied')");
    expect(SCANNER).toContain("label={t('groups.scanUseLink')}");
    // Configuración nativa: cámara sí, micrófono no.
    expect(CONFIG).toContain("'expo-camera'");
    expect(CONFIG).toContain('microphonePermission: false');
    expect(CONFIG).toContain('recordAudioAndroid: false');
  });

  it('un enlace ajeno no abre direcciones: sólo esquemas de app con /join', () => {
    expect(LINK).toContain('/^https?:\\/\\//i.test(path)');
    expect(LINK).not.toMatch(/Linking|openURL/);
  });
});

describe('«¿Quién eres?»', () => {
  it('«Soy nuevo» va FUERA de la lista, siempre a la vista, también sin nombres', () => {
    const scroll = PANEL.slice(PANEL.indexOf('<ScrollView'), PANEL.indexOf('</ScrollView>'));
    expect(scroll).toContain('preview.participants.map((one) =>');
    expect(scroll).not.toContain("t('groups.whoNew')");
    expect(PANEL.slice(PANEL.indexOf('</ScrollView>'))).toContain("t('groups.whoNew')");
    expect(PANEL).toContain("t('groups.whoNone')");
    expect(PANEL).toContain('styles.newOption');
    // Y la hoja crece para «¿Quién eres?» sin tocar el alto de las otras vistas.
    expect(SHEET).toContain("mode === 'who' ? Math.round(height * 0.5) : sheetHeight(height)");
  });

  it('sólo participantes disponibles y «Soy nuevo»; sin deudas, importes ni historial', () => {
    expect(PANEL).toContain('preview.participants.map((one) =>');
    expect(PANEL).toContain("t('groups.whoNew')");
    expect(PANEL).not.toMatch(/money\(|net_position|your_share|amount/);
    expect(SERVICE).not.toMatch(/net_position|amount/);
    // El servidor publica sólo nombre e identidad contextual, y scope_id sólo al miembro.
    expect(MIGRATION).toContain("'scope_id', case when v_state = 'member' then v_inv.scope_id end");
    expect(MIGRATION).toContain(
      "jsonb_build_object('participant_id', p.id, 'display_name', p.display_name)",
    );
    expect(CHECK).toContain('C1d la previsualizacion lleva datos economicos');
    expect(CHECK).toContain('C2 un invitado sin entrar ve el grupo');
  });

  it('«Soy nuevo» usa el nombre real del perfil, y si falta lo pide; nunca el correo', () => {
    expect(ROUTE).toContain('session.identity.displayName');
    expect(PANEL).toContain('if (profileName === null) setNaming(true);');
    expect(PANEL).not.toMatch(/email/i);
    expect(MIGRATION).toContain(
      "v_name := sec.canonical_display_name(payload ->> 'display_name');",
    );
    expect(MIGRATION).toContain("'hace falta un nombre para entrar como nuevo'");
  });

  it('reclamar vincula directamente; la clave por intención hace idempotente el reintento', () => {
    expect(HOOK).toContain('const fingerprint = JSON.stringify([args.token, args.choice]);');
    expect(HOOK).toContain("result.code === 'PARTICIPANT_ALREADY_CLAIMED'");
    expect(SHEET).toContain('invitation.refresh();');
    expect(CHECK).toContain('D2 el reintento no fue replay');
    expect(CHECK).toContain('D4c');
  });
});

describe('el enlace pulsado', () => {
  it('lo escucha la raíz, espera a la sesión, y lo recoge la MISMA hoja de «Únete»', async () => {
    const ROOT = (await import('../../src/app/_layout.tsx?raw')).default;
    const TABS = (await import('../../src/app/(tabs)/_layout.tsx?raw')).default;
    const INTENT = (await import('../../src/app/+native-intent.tsx?raw')).default;
    const ARRIVAL = (await import('../../src/features/groups/use-invitation-link.ts?raw')).default;
    expect(ROOT).toContain('useInvitationLink();');
    expect(TABS).toContain('useOpenPendingInvitation(isSignedIn(state));');
    expect(ARRIVAL).toContain('Linking.getInitialURL()');
    expect(ARRIVAL).toContain("Linking.addEventListener('url'");
    // Sin ruta y sin token en parámetros: la intención nativa no navega a /join.
    expect(INTENT).toContain('if (withoutQuery.endsWith(`/${JOIN_PATH}`)) return null;');
    expect(ARRIVAL).toContain("router.push('/group-action');");
    expect(ARRIVAL).not.toMatch(/params:/);
    // La hoja recoge el token una vez y sigue el mismo camino que pegar o escanear.
    expect(SHEET).toContain('const token = takeInvitation();');
    expect(SHEET).toMatch(/setMode\('join'\);\s*setText\(token\);\s*setAutoSend\(true\);/);
  });
});

describe('autorización, concurrencia y freno en el servidor', () => {
  it('la invitación autoriza; se verifica en cada operación y el ámbito sale de ella', () => {
    expect(MIGRATION).toContain('POSEER UNA INVITACION VALIDA AUTORIZA');
    expect(MIGRATION).toContain('una invitacion reenviada');
    expect(MIGRATION).toContain('select * into v_inv from sec.resolve_invitation(v_token);');
    expect(MIGRATION).toContain(
      "c_allowed constant text[] := array[\n    'client_command_id', 'command_contract_version', 'token', 'choice', 'participant_id', 'display_name'];",
    );
    expect(CHECK).toContain('D7 se acepto scope_id en el payload');
  });

  it('vínculo, membresía y presencia atómicos; la clave primaria decide la carrera', () => {
    expect(MIGRATION).toContain("perform sec.raise_boundary('PARTICIPANT_ALREADY_CLAIMED'");
    expect(MIGRATION).toContain('exception when unique_violation then');
    expect(MIGRATION).toContain('membership_provisioner_invitation_insert');
    expect(CHECK).toContain('D4d el conflicto dejo membresia a Bea');
  });

  it('sólo el hash; freno a los 20 fallos; el token nunca en logs ni en la intención', () => {
    expect(MIGRATION).toContain('token_hash  bytea not null unique');
    expect(MIGRATION).not.toMatch(/raise (notice|log)[^;]*token/i);
    expect(MIGRATION).toContain("if v_n >= 20 then\n    state := 'throttled'");
    expect(MIGRATION).toContain("'invitation_id', v_inv.invitation_id, 'choice', v_choice");
    expect(CHECK).toContain('B2c el token quedo escrito en la intencion canonica');
    expect(CHECK).toContain('C3e tras 20 fallos no se frena');
  });

  it('quien salió con vínculo no elude F09/ADR-003: vuelve con su identidad (F09/ADR-010) y nada más', () => {
    // La migración de origen paraba (rejoin_pending); 20260914140000 lo sustituye por 'rejoin'.
    expect(MIGRATION).toContain("v_state := 'rejoin_pending';");
    expect(REJOIN).toContain("v_state := 'rejoin';");
    expect(REJOIN).toContain("'previous_participant', case when v_state = 'rejoin'");
    expect(REJOIN).toContain("perform sec.raise_boundary('REJOIN_REQUIRED',");
    expect(REJOIN).toContain(
      "perform sec.raise_boundary('REJOIN_NOT_AVAILABLE', 'no estuviste en este grupo', 409);",
    );
    expect(REJOIN).toContain(
      'insert into core.participant_period (participant_id, valid_from, valid_until) values (v_mine, current_date, null);',
    );
    expect(PANEL).toContain("preview.membership === 'rejoin'");
    expect(PANEL).toContain(
      "t('groups.whoRejoin', { name: preview.previousParticipant.displayName })",
    );
    expect(SERVICE).toContain("| { readonly kind: 'rejoin' };");
    expect(SERVICE).toContain("raw === 'rejoin_pending'");
    expect(CHECK).toContain('E1b quien salio entro como nuevo (eludiendo ADR-034)');
    expect(REJOIN_CHECK).toContain(
      "if v <> 'OK rejoined' then raise exception 'A5: %', v; end if;",
    );
    expect(REJOIN_CHECK).toContain(
      "if pg_temp.periodos(r.a1) <> '[-10,0) [0,)' then raise exception 'A7: %'",
    );
    expect(REJOIN_CHECK).toContain("if v_in <> 0 then raise exception 'E5: %', v_in; end if;");
  });
});
