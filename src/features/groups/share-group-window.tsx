import { useEffect, useRef, useState } from 'react';
import { BackHandler, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { ActionButton, LoadingState, QrCode, SheetWindow, ThemedText } from '@/ui/components';
import { Spacing } from '@/ui/theme';

import { useGroupInvitation } from './use-group-invitation';

/**
 * «COMPARTIR GRUPO». La misma ventana que Crear grupo —`SheetWindow`: material,
 * velo, animación, cierre y áreas seguras—, con otro contenido: el nombre real
 * del grupo, un QR grande y el oblongo amarillo «Enviar invitación».
 *
 * **Una invitación real, y la misma en el QR y en la hoja de compartir.** La
 * emite `useGroupInvitation` por el mecanismo de F09/ADR-004 —una por grupo y
 * sesión, reutilizada hasta caducar—, y el enlace es exactamente el que
 * «Pegar enlace» y el escáner leen. Abrir esta ventana no incorpora a nadie
 * ni toca participantes: sólo emite una invitación.
 *
 * **Sin QR ficticio.** Mientras no hay invitación se ve la carga; si falla, el
 * motivo y «Reintentar», y el envío queda apagado: no hay nada que enviar.
 *
 * **Enviar abre la hoja nativa del sistema** (copiar, WhatsApp, lo que haya) con
 * una frase que identifica Nomey y el grupo, y el enlace. Cancelarla deja la
 * ventana como estaba; y no se dice «enviada» por abrir o cerrar la hoja, que
 * no demuestra ningún envío.
 *
 * El QR mide lo que la ventana permite: el ancho del panel menos los márgenes,
 * con tope de 280 puntos, que cualquier lector coge a un palmo. No se copian
 * las medidas de otra ventana: el alto lo pone el contenido.
 */
export function ShareGroupWindow({
  scopeId,
  emoji,
  name,
  onClosed,
}: {
  readonly scopeId: string;
  readonly emoji: string;
  readonly name: string;
  readonly onClosed: () => void;
}) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const invitation = useGroupInvitation(scopeId);
  const [sharing, setSharing] = useState(false);

  /*
   * El panel mide el 94 % de la pantalla como mucho (ver `SheetWindow`) y el
   * cuerpo lleva `Spacing.md` por lado; el QR ocupa lo que queda, acotado.
   */
  const qrSize = Math.min(280, Math.floor(width * 0.94) - Spacing.md * 2 - Spacing.lg * 2);

  const send = async (link: string) => {
    setSharing(true);
    try {
      /*
       * `message` lleva la frase y el enlace juntos: un esquema de app no es
       * una URL que iOS trate como tal en `url`, y así el texto que llega a
       * WhatsApp o al portapapeles es uno solo y completo.
       */
      await Share.share({ message: t('group.shareMessage', { group: name, link }) });
    } catch {
      // La hoja no se pudo abrir: la ventana sigue utilizable, sin fingir nada.
    } finally {
      setSharing(false);
    }
  };

  return (
    <SheetWindow title={t('group.shareTitle')} closeLabel={t('action.close')} onClosed={onClosed}>
      {(close) => (
        <View style={styles.body}>
          <CloseOnBack close={close} />

          <View style={styles.identity}>
            <Text style={styles.emoji}>{emoji}</Text>
            <ThemedText variant="heading" numberOfLines={1} style={styles.name}>
              {name}
            </ThemedText>
          </View>

          <View style={[styles.qrSlot, { width: qrSize, height: qrSize }]}>
            {invitation.kind === 'ready' ? (
              <QrCode
                value={invitation.link}
                size={qrSize}
                label={t('group.shareQrLabel', { group: name })}
              />
            ) : invitation.kind === 'loading' ? (
              <LoadingState label={t('group.shareLoading')} />
            ) : (
              <View style={styles.failed}>
                <ThemedText variant="body" themeColor="negative" style={styles.centered}>
                  {t(
                    invitation.reason === 'offline'
                      ? 'group.shareOffline'
                      : invitation.reason === 'notMember'
                        ? 'group.shareNotMember'
                        : 'group.shareFailed',
                  )}
                </ThemedText>
                {invitation.reason === 'notMember' ? null : (
                  <ActionButton
                    label={t('action.retry')}
                    onPress={invitation.retry}
                    tone="primary"
                  />
                )}
              </View>
            )}
          </View>

          <ThemedText variant="caption" themeColor="textTertiary" style={styles.centered}>
            {invitation.kind === 'ready' ? t('group.shareHint') : ' '}
          </ThemedText>

          {/* Apagado sin invitación: no hay nada que enviar. */}
          <ActionButton
            label={t('group.shareSend')}
            hint={t('group.shareSendHint')}
            tone={invitation.kind === 'ready' ? 'brand' : 'primary'}
            disabled={invitation.kind !== 'ready'}
            busy={sharing}
            onPress={() => {
              if (invitation.kind === 'ready') void send(invitation.link);
            }}
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
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    maxWidth: '100%',
  },
  emoji: {
    fontSize: 22,
  },
  name: {
    flexShrink: 1,
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
