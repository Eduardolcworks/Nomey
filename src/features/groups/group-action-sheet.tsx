import { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@/lib/i18n';
import { GlassSurface, Icon, ThemedText } from '@/ui/components';
import { Motion, Radius, Spacing, Symbols, Typography, useTheme } from '@/ui/theme';
import { SLIDE_IN, timing } from '@/ui/theme/motion-runtime';

import { DESCRIPTION_LINES, GROUP_ACTIONS, groupActionHandler, sheetHeight } from './group-actions';
import { rememberRedeemedInvitation, takeInvitation } from './invitation-arrival';
import { JoinEntry, WhoAreYou } from './join-panel';
import { QrScanner } from './qr-scanner';
import { useInvitationPreview, useRedeemInvitation } from './use-join-group';

/**
 * LO QUE SE PUEDE HACER DESDE EL `+` DE GRUPOS.
 *
 * **El defecto que corrige.** El `+` del dock navegaba SIEMPRE a `/add`, la hoja
 * de alta de movimientos del Modo Personal, y lo único que cambiaba con el
 * destino era la etiqueta accesible. Estando en Grupos abría, por tanto, el alta
 * de un movimiento personal: no fallaba nada, simplemente hacía otra cosa.
 *
 * **Es una hoja inferior, no una ventana flotante.** Negra y opaca, pegada a los
 * bordes izquierdo, derecho e inferior, sin margen exterior y con las dos
 * esquinas de arriba redondeadas. Sube entera desde debajo de la pantalla y baja
 * entera al cerrarse —no es un fundido de dos tarjetas sueltas— y mientras está
 * abierta **cubre el `+` y el dock**, que es lo que la hace una superficie del
 * sistema y no un objeto encima de otro.
 *
 * **El fondo no se dibuja aquí**, igual que en las otras ventanas: lo pinta el
 * árbol de las pestañas, que es el único que tiene la pantalla de debajo en su
 * jerarquía y puede desenfocarla. Esta capa es puramente táctil.
 *
 * **Y se declara modal para los lectores de pantalla.** Sin eso, lo que queda
 * detrás sigue siendo alcanzable: se llegaba al `+` trasero, que además anuncia
 * la etiqueta de Personal. Fuera lo oculta el árbol de las pestañas al ver
 * encendida la señal del fondo; aquí lo declara `accessibilityViewIsModal`.
 */
export type GroupActionSheetProps = {
  /**
   * Que la hoja se retire porque hay otra ventana encima.
   *
   * **Retirarse no es cerrarse.** La ruta sigue montada con todo su estado y
   * el fondo desenfocado sigue siendo suyo; lo único que se va es el panel,
   * que si no quedaría debajo de la ventana de crear grupo como un segundo
   * modal apilado. Volver atrás lo devuelve tal y como estaba.
   *
   * Lo decide la ruta, que es quien puede preguntarle al navegador. `features/`
   * no conoce la navegación.
   */
  readonly hidden?: boolean;
  /** Crear un grupo nuevo. Abre su ventana encima de esta hoja. */
  readonly onCreate: () => void;
  /**
   * Ya dentro del grupo (F09/ADR-004): el servidor confirmó la membresía —nueva o
   * existente— y la ruta abre el grupo. La hoja no navega por su cuenta.
   */
  readonly onJoined: (scopeId: string) => void;
  /** El nombre real del perfil, o `null`: «Soy nuevo» lo pide si falta. */
  readonly profileName: string | null;
  /** Deshacer la ruta, ya con la hoja abajo. */
  readonly onClosed: () => void;
};

/**
 * LAS TRES VISTAS DE LA MISMA HOJA. `choose` es la de siempre; `join` cambia
 * el contenido dentro del mismo tamaño y material (F09/ADR-004 §1); `who` es
 * «¿Quién eres?», con lo justo para elegir identidad.
 */
type Mode = 'choose' | 'join' | 'who';

/**
 * EL EMBLEMA DE CADA TARJETA, TOMADO DEL `+` PRINCIPAL.
 *
 * **Es su material, no una copia de su estilo.** El disco usa `GlassSurface` con
 * un nivel de `Glass`, igual que el `+` flotante: mismo cristal teñido, mismo
 * canto encendido y el mismo volumen. Lo único que cambia entre los dos
 * emblemas es el nivel —`action` en ámbar, `join` en lila— y el color del
 * glifo. No se reutiliza el botón del dock, que es un control de navegación con
 * su gesto y su ruta.
 *
 * **Y NO es un botón.** La tarjeta entera sigue siendo el único pulsable; el
 * disco es su emblema y se declara oculto para los lectores de pantalla, que si
 * no anunciarían dos elementos donde la persona ve uno.
 *
 * El diámetro es el del `+` a escala: 50 frente a sus 56, con el glifo en la
 * misma proporción —la mitad del disco— para que la pieza se reconozca.
 */
const EMBLEM_SIZE = 50;
const EMBLEM_GLYPH = 25;

/**
 * El alto reservado a la descripción, en el interlineado de su propio rol.
 *
 * Se deriva de `Typography` en vez de escribirse en puntos: si un día
 * `bodySmall` cambia de interlineado, el hueco lo sigue sin que nadie se
 * acuerde. `DESCRIPTION_LINES` dice cuántas, y vive en los datos.
 */
const DESCRIPTION_HEIGHT = DESCRIPTION_LINES * (Typography.bodySmall.lineHeight ?? 0);

export function GroupActionSheet({
  hidden = false,
  onCreate,
  onJoined,
  profileName,
  onClosed,
}: GroupActionSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  const [mode, setMode] = useState<Mode>('choose');
  /*
   * «¿Quién eres?» necesita más alto que las dos tarjetas: una lista de
   * nombres, «Soy nuevo» anclado y el aviso. La mitad de la pantalla, sin
   * tocar el alto aprobado de las otras dos vistas.
   */
  const panelHeight = mode === 'who' ? Math.round(height * 0.5) : sheetHeight(height);
  const [scanning, setScanning] = useState(false);
  const [autoSend, setAutoSend] = useState(false);
  const invitation = useInvitationPreview();
  const joining = useRedeemInvitation();

  /*
   * UN ENLACE PULSADO llega aquí ya recogido: la hoja se abre directamente en
   * «Únete» con el token en el campo, y sigue el MISMO camino que un enlace
   * pegado o un QR —previsualizar en servidor, y luego «¿Quién eres?» o el
   * grupo si ya se es miembro—. Se recoge una sola vez, al montar.
   */
  const setText = invitation.setText;
  useEffect(() => {
    const token = takeInvitation();
    if (token === null) return;
    const settle = setTimeout(() => {
      setMode('join');
      setText(token);
      setAutoSend(true);
    }, 0);
    return () => clearTimeout(settle);
  }, [setText]);

  /*
   * ═══════ ENLACE Y QR: EL MISMO FLUJO ═══════
   *
   * El avión sobre una invitación válida, o un QR válido, van a «¿Quién eres?»
   * sin confirmación intermedia: la previsualización ya dijo que se puede usar.
   * Si ya se es miembro, se abre el grupo sin escribir nada. El QR escaneado
   * se vuelca en el campo —es la misma cadena— y sigue por el mismo camino en
   * cuanto el servidor responde.
   */
  const proceed = (preview: {
    readonly membership: 'member' | 'rejoin' | 'join';
    readonly scopeId: string | null;
  }) => {
    if (preview.membership === 'member' && preview.scopeId !== null) {
      if (invitation.status.kind === 'ready') {
        rememberRedeemedInvitation(preview.scopeId, invitation.status.token);
      }
      onJoined(preview.scopeId);
      return;
    }
    setMode('who');
  };
  const send = () => {
    if (invitation.status.kind !== 'ready') return;
    proceed(invitation.status.preview);
  };
  const scanned = (token: string) => {
    setScanning(false);
    invitation.setText(token);
    setAutoSend(true);
  };
  const status = invitation.status;
  useEffect(() => {
    if (!autoSend) return;
    if (status.kind === 'checking' || status.kind === 'idle') return;
    // Una vez: inválida, caducada o revocada dejan su motivo bajo el campo.
    const settle = setTimeout(() => {
      setAutoSend(false);
      if (status.kind === 'ready') proceed(status.preview);
    }, 0);
    return () => clearTimeout(settle);
    // `proceed` se recrea en cada render y sólo depende de `onJoined`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, status]);

  const redeem = (
    choice:
      | { readonly kind: 'claim'; readonly participantId: string }
      | { readonly kind: 'new'; readonly displayName: string }
      | { readonly kind: 'rejoin' },
  ) => {
    if (invitation.status.kind !== 'ready') return;
    const token = invitation.status.token;
    void joining.redeem({ token, choice }).then((scopeId) => {
      if (scopeId !== null) {
        // Por si hay que deshacer la reclamación y volver aquí (F09/ADR-006 §4).
        rememberRedeemedInvitation(scopeId, token);
        onJoined(scopeId);
        return;
      }
      // Conflicto recuperable u otro fallo: se vuelven a pedir las opciones.
      invitation.refresh();
    });
  };
  /*
   * LA ENTRADA ES DECLARATIVA Y LA SALIDA IMPERATIVA, como en el resto de
   * ventanas de la app.
   *
   * `SLIDE_IN` es `SlideInDown`: el panel ENTERO entra deslizando desde debajo
   * del borde inferior, no aparece con un fundido. Salir sí tiene que ser
   * imperativo, porque hay que esperar a que la hoja llegue abajo antes de
   * deshacer la ruta — al revés no habría nada que animar, la pantalla ya
   * estaría desmontada.
   *
   * Y `fall` tiene **un solo punto de escritura**. No es estilo: es lo único
   * que admite `react-hooks/immutability`, y de paso garantiza que volver a la
   * base sea volver a cero exactamente por muchas veces que se abra y se cierre.
   */
  const fall = useSharedValue(0);
  const [closing, setClosing] = useState(false);

  const close = () => {
    if (closing) return;
    setClosing(true);
    fall.value = withTiming(panelHeight, timing(Motion.screen.duration), (finished) => {
      if (finished) runOnJS(onClosed)();
    });
  };

  /*
   * El botón Atrás de Android cierra como el velo, no como una salida distinta.
   *
   * Sin esto la ruta se deshace de golpe: la hoja desaparece sin bajar y el
   * fondo se apaga a destiempo. Devolver `true` es lo que evita que el sistema
   * la deshaga por su cuenta mientras la animación corre.
   *
   * La suscripción se monta UNA vez y lee el cierre por referencia: `close` se
   * redefine en cada render, y volver a suscribirse por eso sería trabajo sin
   * efecto — además de dejar la lista de dependencias mintiendo.
   */
  const latestClose = useRef(close);
  useEffect(() => {
    latestClose.current = close;
  });

  /*
   * **Y sólo mientras la hoja se ve.** Retirada porque hay otra ventana encima,
   * esta suscripción seguía viva y era la más reciente, así que se quedaba con
   * el Atrás de la ventana de arriba: medido en el emulador, cerraba las DOS
   * superficies de golpe y devolvía a Grupos sin desenfoque en vez de al
   * selector. Una hoja que no se ve no puede quedarse con el botón Atrás.
   */
  useEffect(() => {
    if (hidden) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      latestClose.current();
      return true;
    });
    return () => subscription.remove();
  }, [hidden]);

  const panel = useAnimatedStyle(() => ({ transform: [{ translateY: fall.value }] }));

  const tint = { create: theme.accent, join: theme.joinAccent } as const;
  const glass = { create: 'action', join: 'join' } as const;

  /*
   * Con otra ventana encima no se pinta NADA de esta: ni el panel ni el velo.
   * El velo dejaría un pulsable a pantalla completa por delante del fondo, y
   * tocar fuera de la ventana de arriba cerraría la de abajo.
   */
  if (hidden) return null;

  const cardStyle = (pressed: boolean) => [
    styles.card,
    {
      backgroundColor: pressed ? theme.surfaceSunken : theme.surfaceRaised,
      borderColor: theme.border,
    },
  ];
  return (
    <View style={styles.canvas}>
      {/*
       * EL VELO, que ocupa la pantalla entera y cierra al tocar fuera.
       *
       * El panel va después y con `zIndex` declarado, así que un toque en una
       * tarjeta nunca llega al velo y uno fuera sí baja hasta él. Se escribe el
       * `zIndex` en vez de confiar en el orden de los hermanos, que un
       * reordenamiento inocente invertiría sin cambiar nada del aspecto.
       */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('action.close')}
        onPress={close}
        style={StyleSheet.absoluteFill}
      />

      <Animated.View
        entering={SLIDE_IN}
        accessibilityViewIsModal
        style={[
          panel,
          styles.panel,
          {
            height: panelHeight,
            backgroundColor: theme.background,
            /*
             * El relleno de abajo sale de la inserción real del sistema: así el
             * contenido queda por encima de la barra de gestos sin inventarse un
             * margen que en otro aparato sobraría o faltaría.
             */
            paddingBottom: insets.bottom + Spacing.lg,
          },
        ]}>
        {mode === 'join' ? (
          <JoinEntry
            text={invitation.text}
            onChangeText={invitation.setText}
            status={invitation.status}
            onScan={() => {
              setScanning(true);
            }}
            onSend={send}
            disabled={closing}
            card={cardStyle}
            emblem={styles.emblem}
            emblemSurface={styles.emblemSurface}
            emblemGlyph={EMBLEM_GLYPH}
          />
        ) : null}
        {mode === 'who' && invitation.status.kind === 'ready' ? (
          <WhoAreYou
            preview={invitation.status.preview}
            profileName={profileName}
            joining={joining.joining}
            failure={joining.failure}
            onClaim={(participantId) => {
              redeem({ kind: 'claim', participantId });
            }}
            onNew={(displayName) => {
              redeem({ kind: 'new', displayName });
            }}
            onRejoin={() => {
              redeem({ kind: 'rejoin' });
            }}
            onBack={() => {
              setMode('join');
            }}
          />
        ) : null}
        {mode !== 'choose'
          ? null
          : GROUP_ACTIONS.map((action) => (
              <Pressable
                key={action.key}
                accessibilityRole="button"
                accessibilityLabel={t(action.labelKey)}
                /*
                 * El nombre es el título y la indicación es la descripción, que es
                 * el reparto que hace el sistema: VoiceOver y TalkBack anuncian el
                 * nombre y, tras una pausa, la indicación. Meter las dos en la
                 * etiqueta las leería de corrido como una frase sola.
                 */
                accessibilityHint={t(action.descriptionKey)}
                disabled={closing}
                onPress={groupActionHandler(action.key, {
                  create: onCreate,
                  join: () => {
                    setMode('join');
                  },
                })}
                style={({ pressed }) => cardStyle(pressed)}>
                <View
                  style={styles.emblem}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants">
                  <GlassSurface
                    level={glass[action.key]}
                    depth="flat"
                    radius={Radius.full}
                    /*
                     * SIN EL HALO, y sólo aquí.
                     *
                     * La lente del material mezcla dos brillos interiores con una
                     * capa que proyecta hacia FUERA. Sobre el fondo negro del dock
                     * ese halo es lo que hace que el `+` lea como luz sostenida, y
                     * allí está aprobado; dentro de una tarjeta no hay fondo que
                     * separar, así que el resplandor se derrama sobre el relleno y
                     * el disco pasa de pieza a bombilla.
                     *
                     * `inner` filtra la lista que ya existe —se queda con las capas
                     * `inset`— en vez de escribir una lente nueva. El color, el
                     * borde de un punto, el brillo interior y el volumen no se
                     * tocan, y el `+` del dock tampoco: allí sigue el valor por
                     * defecto.
                     */
                    lens="inner"
                    /* La acción principal del dock tampoco lo usa: es un control. */
                    nativeEffect={false}
                    style={styles.emblemSurface}>
                    <Icon
                      name={Symbols[action.symbol]}
                      size={EMBLEM_GLYPH}
                      colour={tint[action.key]}
                      shape="circle"
                    />
                  </GlassSurface>
                </View>
                {/*
                 * LA COLUMNA DE TEXTO, y por qué el disco sigue centrado.
                 *
                 * La tarjeta es una fila con `alignItems: 'center'`, así que centra
                 * a sus hijos entre sí: el emblema queda a la mitad de ESTE bloque,
                 * mida lo que mida, sin que nadie lo coloque. El título sube solo
                 * al aparecer la descripción debajo, por la misma razón.
                 *
                 * `flex: 1` es lo que le da a la descripción un ancho del que
                 * partir: sin él la columna se ajusta a su contenido, la frase larga
                 * empuja hacia fuera y se recorta contra el borde en vez de saltar
                 * de línea. `minWidth: 0` es lo que permite que ese `flex` encoja
                 * por debajo del ancho natural del texto.
                 */}
                <View style={styles.copy}>
                  <ThemedText variant="body" themeColor="text">
                    {t(action.labelKey)}
                  </ThemedText>
                  {/*
                   * El secundario que ya usa la app: más pequeño y más apagado.
                   *
                   * Con alto reservado y SIN `numberOfLines`: recortar con puntos
                   * suspensivos es justo lo que no debe pasar, así que si una cadena
                   * futura no cupiera, se vería —y se subiría `DESCRIPTION_LINES`—
                   * en vez de desaparecer en silencio.
                   */}
                  <ThemedText
                    variant="bodySmall"
                    themeColor="textSecondary"
                    style={styles.description}>
                    {t(action.descriptionKey)}
                  </ThemedText>
                </View>
              </Pressable>
            ))}
      </Animated.View>

      {scanning ? (
        <QrScanner
          onToken={scanned}
          onCancel={() => {
            setScanning(false);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1 },
  /**
   * Pegada a los tres bordes y sin margen exterior: es una hoja del sistema, no
   * una ventana. Sólo se redondean las esquinas de arriba, que son las únicas
   * que se ven.
   */
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    // La separación entre las dos tarjetas, que es lo que las hace dos.
    gap: Spacing.md,
  },
  /**
   * Las dos, del mismo alto y del mismo ancho: `flex: 1` reparte el hueco que
   * queda entre los rellenos, así que crecen y encogen juntas con la hoja.
   */
  /** El disco, y su hueco. Los dos emblemas miden exactamente lo mismo. */
  emblem: {
    width: EMBLEM_SIZE,
    height: EMBLEM_SIZE,
  },
  emblemSurface: {
    width: EMBLEM_SIZE,
    height: EMBLEM_SIZE,
    // Un punto entero, como en el `+`: sobre un disco, media línea no es canto.
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * El bloque de título y descripción. Sin alto propio y sin posición: lo
   * centra la fila, y por eso las dos tarjetas lo centran igual.
   */
  copy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.xxs,
  },
  /** El hueco de las dos líneas, igual en las dos tarjetas. */
  description: {
    minHeight: DESCRIPTION_HEIGHT,
  },
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
