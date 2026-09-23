import { useEffect, useRef } from 'react';
import { Alert, BackHandler, StyleSheet, useWindowDimensions, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import {
  ActionButton,
  IdentityLine,
  LoadingState,
  QrCode,
  SheetWindow,
  ThemedText,
} from '@/ui/components';
import { Spacing, Symbols } from '@/ui/theme';

import { useMyFriendLink } from './use-my-friend-link';

/**
 * «TU ENLACE DE AMISTAD»: el QR, quién eres, y regenerar.
 *
 * La MISMA ventana que Compartir grupo —`SheetWindow`: material, velo,
 * animación, cierre y áreas seguras— con otro contenido, y por el mismo
 * motivo: duplicar el armazón habría duplicado su geometría y su movimiento.
 *
 * **El QR codifica EXACTAMENTE el mismo enlace que comparte el otro botón.**
 * Un solo token, un solo protocolo: lo que se escanea y lo que se pega son la
 * misma cadena, y por tanto recorren el mismo camino y las mismas
 * comprobaciones del servidor. No hay un «token de QR» aparte.
 *
 * **Sin QR ficticio**: mientras no hay enlace se ve la carga, y si falla, el
 * motivo y «Reintentar».
 *
 * **Regenerar no es automático y no es optimista.** Pide confirmación porque
 * invalida al instante el enlace y el QR anteriores —cualquiera que los
 * tuviera se queda con un enlace muerto—, y si el servidor no confirma, lo
 * que se sigue viendo es el token de antes: un QR cambiado sin rotación
 * sería un código que nadie puede escanear.
 */
export function FriendLinkWindow({
  publicName,
  handle,
  onClosed,
}: {
  readonly publicName: string | null;
  readonly handle: string | null;
  readonly onClosed: () => void;
}) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const link = useMyFriendLink();

  const { revalidate } = link;
  useEffect(() => {
    void revalidate();
  }, [revalidate]);

  /* El mismo cálculo que el QR de un grupo: el panel menos sus márgenes. */
  const qrSize = Math.min(280, Math.floor(width * 0.94) - Spacing.md * 2 - Spacing.lg * 2);

  const confirmRotate = () => {
    Alert.alert(t('friendLink.rotateTitle'), t('friendLink.rotateBody'), [
      { text: t('action.cancel'), style: 'cancel' },
      {
        text: t('friendLink.rotateConfirm'),
        style: 'destructive',
        onPress: () => {
          void link.rotate().then((done) => {
            if (done) return;
            Alert.alert(
              t(
                link.rotateFailure === 'limited'
                  ? 'friendLink.rotateLimited'
                  : 'friendLink.rotateFailed',
              ),
              undefined,
              [{ text: t('action.understood') }],
            );
          });
        },
      },
    ]);
  };

  return (
    <SheetWindow title={t('friendLink.qrTitle')} closeLabel={t('action.close')} onClosed={onClosed}>
      {(close) => (
        <View style={styles.body}>
          <CloseOnBack close={close} />

          <IdentityLine
            name={publicName}
            handle={handle}
            fallback={t('friends.unknown')}
            glyph={Symbols.person}
          />

          <View style={[styles.qrSlot, { width: qrSize, height: qrSize }]}>
            {link.state.kind === 'ready' ? (
              <QrCode
                value={link.state.url}
                size={qrSize}
                label={t('friendLink.qrLabel', { name: publicName ?? handle ?? '' })}
              />
            ) : link.state.kind === 'failed' ? (
              <View style={styles.failed}>
                <ThemedText variant="body" themeColor="negative" style={styles.centered}>
                  {t(
                    link.state.reason === 'offline'
                      ? 'friendLink.shareOffline'
                      : 'friendLink.shareFailed',
                  )}
                </ThemedText>
                <ActionButton
                  label={t('action.retry')}
                  tone="primary"
                  onPress={() => {
                    void link.revalidate();
                  }}
                />
              </View>
            ) : (
              <LoadingState label={t('friendLink.loading')} />
            )}
          </View>

          <ThemedText variant="caption" themeColor="textTertiary" style={styles.centered}>
            {link.state.kind === 'ready' ? t('friendLink.qrHint') : ' '}
          </ThemedText>

          {/* Secundaria y apagada sin enlace: no hay nada que regenerar. */}
          <ActionButton
            label={t('friendLink.rotate')}
            tone="secondary"
            material="control"
            busy={link.rotating}
            disabled={link.state.kind !== 'ready' || link.rotating}
            onPress={confirmRotate}
          />
        </View>
      )}
    </SheetWindow>
  );
}

/** Atrás sale por la misma puerta que la `X`, como en las otras ventanas. */
function CloseOnBack({ close }: { readonly close: () => void }) {
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      latest.current();
      return true;
    });
    return () => subscription.remove();
  }, []);
  return null;
}

const styles = StyleSheet.create({
  body: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.sm,
  },
  qrSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  failed: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  centered: {
    textAlign: 'center',
  },
});
