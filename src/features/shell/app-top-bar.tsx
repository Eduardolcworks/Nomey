import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { IconButton, ThemedText } from '@/ui/components';
import { Spacing, Symbols } from '@/ui/theme';

const MARK = require('../../../assets/splash/splash-icon.png') as number;

/**
 * La barra superior que comparten los dos destinos raíz, y **lo único de
 * arriba que no se mueve**.
 *
 * El grupo de la derecha —notificaciones y perfil— es idéntico en Inicio y en
 * Grupos, y eso es deliberado y no casual. Las notificaciones que produce de
 * verdad una app de gastos compartidos nacen en Grupos: alguien añadió un
 * gasto, alguien saldó. Una campana que sólo existiera en Inicio convertiría
 * leerlas en un rodeo por la barra de pestañas, y rompería una regla que si no
 * se explica en una frase — tu cuenta y tus avisos viven arriba a la derecha.
 *
 * **Y el lado izquierdo ya no cambia.** Llevó un título de sección alternativo
 * para Grupos, y eso hacía dos cabeceras distintas para dos destinos del mismo
 * nivel: entrar en Grupos borraba la marca y ponía el nombre de la sección en su
 * sitio. Ahora la marca es la misma en los dos, y el nombre del destino baja a
 * la fila de contenido —[`ScreenTitle`](./screen-title.tsx)—, que es la misma
 * que Inicio usa para el saludo. Una composición, no dos.
 *
 * **Y aquí NO va el saludo.** Estuvo en el mismo componente, y con él dentro
 * sólo había dos opciones, las dos malas: o se quedaba todo fijo arriba, o se
 * desplazaba todo con el contenido. Son dos cosas distintas —una identifica la
 * aplicación, la otra dice de quién es el dinero que se está mirando— y ahora
 * son dos piezas: ésta se queda quieta, [`HomeGreeting`](./home-greeting.tsx)
 * pertenece al contenido de Inicio y sube con él.
 */
export type AppTopBarProps = {
  /**
   * Whether the bell has something unresolved behind it.
   *
   * **Passed in, never looked up.** The shell may not import another feature,
   * and the thing that knows is the queue, which belongs to `personal`. The
   * route sees both and hands the answer down — the same shape `ScopeProvider`
   * already uses for identity.
   */
  alerts?: boolean;
};

export function AppTopBar({ alerts = false }: AppTopBarProps) {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <View style={styles.brand}>
          <Image source={MARK} style={styles.mark} contentFit="contain" />
          <View>
            <ThemedText variant="heading">Nomey</ThemedText>
            {/*
             * The signature, and deliberately quiet: two roles down from the
             * wordmark and in tertiary grey, which still measures 6.1:1 on
             * the ground. It reads as a maker's mark rather than as a second
             * title competing with the first.
             */}
            <ThemedText variant="caption" themeColor="textTertiary" style={styles.signature}>
              {t('brand.signature')}
            </ThemedText>
          </View>
        </View>

        <View style={styles.actions}>
          <IconButton
            name={Symbols.notifications}
            // The dot is silent to a screen reader, so the name carries it.
            label={
              alerts
                ? `${t('nav.notifications')}. ${t('incident.pending')}`
                : t('nav.notifications')
            }
            badge={alerts}
            onPress={() => {
              router.push('/notifications');
            }}
          />
          <IconButton
            name={Symbols.profile}
            label={t('nav.profile')}
            onPress={() => {
              router.push('/profile');
            }}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * El relleno de la barra, que es exactamente el que tenía la cabecera
   * entera.
   *
   * El `paddingBottom` reproduce el `gap` que separaba esta fila del saludo
   * cuando eran un solo componente. **Lo pone la barra, una vez.** Puesto
   * también en lo que viene debajo, la distancia se contaría dos veces.
   */
  bar: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  /**
   * El `minHeight` va en la fila y no en el contenedor, y no es lo mismo: en
   * Yoga la altura mínima incluye el relleno, así que en el contenedor dejaría
   * la fila `md` más baja de lo que es hoy.
   */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  mark: {
    width: 30,
    height: 30,
  },
  signature: {
    marginTop: -2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
});
