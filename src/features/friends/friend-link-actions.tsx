import { useState } from 'react';
import { Alert, Share, StyleSheet, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { GlassPressable, Icon, ROUND_TRIGGER } from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import { useMyFriendLink } from './use-my-friend-link';

/**
 * EL LADO DEL CUADRADO, y no es un número escogido aquí.
 *
 * Es `ROUND_TRIGGER`, la medida táctil que Nomey ya usa para `IconButton`,
 * para el avión de «Pegar enlace» y para las píldoras de opción: 44. Empezó
 * en 60, y a ese tamaño competía con el avatar —que mide 96— por ser lo
 * primero que se mira, cuando el orden de lectura de esa cabecera es al
 * revés: primero quién eres, después qué puedes hacer con tu enlace.
 *
 * Con 44 el área táctil sigue siendo la que la guía pide, los dos cuadrados
 * más su separación ocupan 96 puntos y el bloque de identidad conserva el
 * resto: en 360 dp quedan ~156 para el `@username` una vez descontados el
 * avatar y los huecos.
 */
export const FRIEND_ACTION_SIZE = ROUND_TRIGGER;

/**
 * LAS DOS ACCIONES DEL ENLACE DE AMISTAD, en la cabecera de Perfil.
 *
 * **Dos botones, no uno.** Enseñar el QR y compartir el enlace son dos
 * gestos distintos —uno es «ten, escanéame» en persona, el otro es «te lo
 * mando»— y meterlos en un solo control obligaría a elegir por la persona o
 * a abrir un menú para preguntárselo. Del mismo tamaño, el mismo radio y el
 * mismo material: ninguno es el principal.
 *
 * **Compartir no abre pantalla.** Pide el enlace, lo construye y abre
 * directamente la hoja del sistema. Y lo pide SIEMPRE, aunque ya lo tuviera:
 * el token es rotable desde otro aparato, así que repartir uno guardado
 * podría repartir un enlace muerto sin que nada fallara aquí.
 *
 * **El QR sí abre pantalla**, porque allí hay algo más que mirar: el código,
 * quién eres y la opción de regenerar.
 */
export function FriendLinkActions({
  handle,
  onOpenQr,
}: {
  /** El `@handle` propio, para la frase que se comparte. Sin él no se comparte. */
  readonly handle: string | null;
  readonly onOpenQr: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { revalidate } = useMyFriendLink();
  const [sharing, setSharing] = useState(false);

  const share = async () => {
    if (sharing || handle === null) return;
    setSharing(true);
    try {
      const url = await revalidate();
      if (url === null) {
        // Sin enlace confirmado no se abre la hoja: compartir un token viejo
        // reparte algo que la otra persona no podrá usar.
        Alert.alert(t('friendLink.shareFailed'), undefined, [{ text: t('action.understood') }]);
        return;
      }
      /*
       * `message` lleva la frase y el enlace juntos, como en Compartir grupo:
       * un esquema de app no es una URL que iOS trate como tal en `url`, y así
       * lo que llega a WhatsApp o al portapapeles es un texto completo.
       */
      await Share.share({ message: t('friendLink.shareMessage', { handle, link: url }) });
    } catch {
      // La hoja del sistema no se pudo abrir: nada que fingir.
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.row}>
      <GlassPressable
        label={t('friendLink.qrAction')}
        depth="raised"
        radius={Radius.lg}
        onPress={onOpenQr}>
        <View style={styles.square}>
          <Icon name={Symbols.qr} size={20} colour={theme.text} />
        </View>
      </GlassPressable>

      <GlassPressable
        label={t('friendLink.shareAction')}
        depth="raised"
        radius={Radius.lg}
        busy={sharing}
        disabled={sharing || handle === null}
        onPress={() => {
          void share();
        }}>
        <View style={styles.square}>
          <Icon
            name={Symbols.share}
            size={20}
            colour={handle === null ? theme.textDisabled : theme.text}
          />
        </View>
      </GlassPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // Pequeña y uniforme: los dos se leen como UN grupo, no como dos
    // controles sueltos que casualmente están al lado.
    gap: Spacing.xs,
  },
  /** Cuadrado: los dos miden exactamente lo mismo, y es una constante. */
  square: {
    width: FRIEND_ACTION_SIZE,
    height: FRIEND_ACTION_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
