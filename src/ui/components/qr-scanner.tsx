import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing, Symbols, useTheme } from '@/ui/theme';

import { ActionButton } from './action-button';
import { IconButton } from './icon-button';
import { ThemedText } from './themed-text';

/**
 * EL ESCÁNER DE QR. Una cámara, un código, y **ninguna idea de qué significa**.
 *
 * `expo-camera` es la única API de lectura de códigos que Expo Go SDK 57
 * trae; aquí se usa para **una sola cosa**: leer un QR. No graba imagen,
 * vídeo ni audio (`mute`, sin micrófono en la configuración nativa), pide el
 * permiso de cámara **sólo al abrirse** y libera la cámara al cerrarse: el
 * `Modal` desmonta la vista y `active` se apaga antes.
 *
 * **Una lectura, una vez.** El sensor repite el mismo código muchas veces por
 * segundo; `handled` deja pasar la primera y apaga el escáner.
 *
 * ═══════════ POR QUÉ VIVE AQUÍ Y NO EN UNA FEATURE ═══════════
 *
 * Nació en `features/groups` leyendo invitaciones, y llamaba a
 * `readInvitation` por dentro. Desde F12.E.C tiene DOS consumidores reales
 * —la invitación a un grupo y el enlace de amistad—, que viven en features
 * distintas y no pueden importarse entre sí. Duplicar la cámara, el permiso y
 * su ciclo de vida para leer la misma clase de código habría sido dos copias
 * que se separan al primer retoque.
 *
 * Así que el escáner **entrega la cadena cruda** y quien lo abre decide si la
 * reconoce: `onScan` devuelve `true` cuando lo leído es suyo —y entonces el
 * escáner se apaga— y `false` cuando no, y se sigue apuntando con el aviso de
 * «esto no es nuestro». Aquí dentro no hay ni un `readInvitation` ni un
 * `readFriendLink`, y no puede haberlos: `ui/` no importa features.
 *
 * Por lo mismo **los textos llegan traducidos**, como en `DateSheet`: `ui/`
 * tampoco puede leer el catálogo, y quien lo monta sí sabe qué está buscando.
 */
export function QrScanner({
  labels,
  onScan,
  onCancel,
}: {
  /** Ya traducidos: este control no conoce el catálogo. */
  readonly labels: {
    readonly close: string;
    readonly hint: string;
    readonly foreign: string;
    readonly permission: string;
    readonly denied: string;
    readonly deniedAction: string;
  };
  /**
   * Lo leído, crudo. `true` = reconocido (el escáner se apaga y no vuelve a
   * disparar); `false` = ajeno, se avisa y se sigue apuntando.
   */
  readonly onScan: (text: string) => boolean;
  readonly onCancel: () => void;
}) {
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
              if (!onScan(result.data)) {
                // Un QR que no es de quien lo abrió: se dice, y se sigue apuntando.
                setForeign(true);
                return;
              }
              handled.current = true;
              setDone(true);
            }}
          />
        ) : null}

        <View style={[styles.top, { paddingTop: insets.top + Spacing.sm }]}>
          <IconButton
            name={Symbols.close}
            label={labels.close}
            colour={theme.text}
            onPress={onCancel}
          />
        </View>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <ThemedText variant="body" themeColor="text" style={styles.hint}>
            {denied
              ? labels.denied
              : permission?.granted === true
                ? foreign
                  ? labels.foreign
                  : labels.hint
                : labels.permission}
          </ThemedText>
          {denied ? (
            <ActionButton label={labels.deniedAction} onPress={onCancel} tone="primary" />
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
