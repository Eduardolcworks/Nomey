import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@/lib/i18n';
import { ActionButton, IconButton, ThemedText } from '@/ui/components';
import { Spacing, Symbols, useTheme } from '@/ui/theme';

import { readInvitation } from './invitation-link';

/**
 * EL ESCÁNER DE QR DE UNA INVITACIÓN. F09/ADR-004.
 *
 * `expo-camera` es la única API de lectura de códigos que Expo Go SDK 57 trae;
 * aquí se usa para **una sola cosa**: leer un QR. No graba imagen, vídeo ni
 * audio (`mute`, sin micrófono en la configuración nativa), pide el permiso
 * de cámara **sólo al abrirse** —no al abrir la ventana de unirse— y libera la
 * cámara al cerrarse: el `Modal` desmonta la vista y `active` se apaga antes.
 *
 * **Una lectura, una vez.** El sensor repite el mismo código muchas veces por
 * segundo; `handled` deja pasar la primera y apaga el escáner. Lo leído pasa
 * por `readInvitation`: un QR ajeno a Nomey no abre nada ni intenta unir — se
 * dice que no es una invitación y se puede seguir apuntando.
 *
 * Denegar el permiso o cancelar devuelve a la ventana, que conserva la
 * alternativa de pegar el enlace.
 */
export function QrScanner({
  onToken,
  onCancel,
}: {
  /** Un token de invitación leído del QR. Se llama una sola vez por apertura. */
  readonly onToken: (token: string) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [foreign, setForeign] = useState(false);
  // Se monta al abrir y se desmonta al cerrar: el estado nace limpio cada vez.
  const [done, setDone] = useState(false);
  const handled = useRef(false);

  // El permiso se pide al ABRIR el escáner, y sólo entonces.
  useEffect(() => {
    if (permission !== null && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const denied = permission !== null && !permission.granted && !permission.canAskAgain;

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[styles.canvas, { backgroundColor: theme.background }]}>
        {permission?.granted === true ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            mute
            active={!done}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={(result) => {
              if (handled.current) return;
              const token = readInvitation(result.data);
              if (token === null) {
                // Un QR que no es de Nomey: se dice, y se sigue apuntando.
                setForeign(true);
                return;
              }
              handled.current = true;
              setDone(true);
              onToken(token);
            }}
          />
        ) : null}

        <View style={[styles.top, { paddingTop: insets.top + Spacing.sm }]}>
          <IconButton
            name={Symbols.close}
            label={t('action.close')}
            colour={theme.text}
            onPress={onCancel}
          />
        </View>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <ThemedText variant="body" themeColor="text" style={styles.hint}>
            {denied
              ? t('groups.scanDenied')
              : permission?.granted === true
                ? foreign
                  ? t('groups.scanForeign')
                  : t('groups.scanHint')
                : t('groups.scanPermission')}
          </ThemedText>
          {denied ? (
            <ActionButton label={t('groups.scanUseLink')} onPress={onCancel} tone="primary" />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1 },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.md,
  },
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  hint: {
    textAlign: 'center',
  },
});
