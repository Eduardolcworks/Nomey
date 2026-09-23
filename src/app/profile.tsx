import { useRouter } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Alert, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import {
  AccountAvatar,
  buildSignOutConfirmation,
  DisplayNameEditor,
  signOut,
  updatePublicName,
  useAccountIdentity,
  useAuthSubmit,
  UsernameEditor,
} from '@/features/auth';
import { FriendLinkActions, useMyFriendRequests } from '@/features/friends';
import { isGuest, useSession } from '@/features/session';
import { PlaceholderScreen } from '@/features/shell';
import { pluralCategory, useTranslation } from '@/lib/i18n';
import {
  ActionButton,
  GlassPressable,
  GlassSurface,
  Icon,
  type IconProps,
  ROUND_TRIGGER,
  Section,
  ThemedText,
} from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

/**
 * Perfil: who you are, then what you can change.
 *
 * The screen reads top to bottom as identity, settings, plan, account. The
 * photo is the largest thing on it because identity is what the screen is
 * about; everything below is a list, and lists are for scanning rather than
 * for looking at.
 *
 * **General's options are visible, not behind a row.** A settings row that
 * opens a screen containing three more rows costs a tap and a push to show
 * what already fits on the surface the user is standing on.
 *
 * **One card per section, with hairline dividers inside** - not one bordered
 * box per option. At three items the stack-of-boxes pattern reads as noise and
 * as a generic settings list; a single material object with an icon rail gives
 * the eye one edge to follow instead of three.
 *
 * `OptionRow` and `OptionGroup` stay local. Exactly one screen uses them, and
 * a component earns its place in `ui/` by having a second consumer rather than
 * an anticipated one.
 */

type Option = {
  readonly icon: IconProps['name'];
  readonly label: string;
};

export default function ProfileScreen() {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const { state } = useSession();

  /*
   * Derived on every render rather than copied into state, exactly like
   * Inicio's greeting. Editing the name emits `USER_UPDATED`, the session
   * provider re-renders, and this follows without anything pushing it.
   */
  const displayName = state.status === 'signed-in' ? state.identity.displayName : null;
  const { submit: leave, state: leaving } = useAuthSubmit();

  /*
   * LA IDENTIDAD PÚBLICA (F12/ADR-001 §10, §13): lo que los demás ven. `core`
   * es la autoridad —`api.my_account_handle` por el proveedor de identidad—,
   * así que el nombre que Perfil enseña es el público cuando existe, y el de la
   * sesión (metadata de Auth) sólo mientras no haya identidad que leer.
   * Editarlo escribe PRIMERO `api.set_public_name` y después la copia de Auth;
   * si la segunda falla no se deshace la primera: se enseña lo que `core`
   * dice, y una sola frase avisa de que el saludo de Inicio se pondrá al día.
   */
  const { state: identity, apply: applyIdentity } = useAccountIdentity();
  const [nameNotice, setNameNotice] = useState<string | undefined>(undefined);
  const publicName =
    identity.status === 'ready' ? (identity.identity.publicName ?? displayName) : displayName;
  const savePublicName = async (draft: string) => {
    const result = await updatePublicName(draft);
    if (!result.ok) return result;
    applyIdentity(result.identity);
    setNameNotice(result.metadataStale ? t('identity.nameSyncPending') : undefined);
    return { ok: true } as const;
  };

  /*
   * AMIGOS (F12.E.B): una entrada de Perfil, no una pestaña. La amistad no es
   * dinero ni un grupo —no mueve nada y no da acceso a nada—, así que vive
   * junto a la identidad de la cuenta y no en la navegación principal.
   *
   * El contador es DISCRETO y dice una sola cosa: cuántas solicitudes
   * ENTRANTES hay esperando respuesta. Las salientes no cuentan aquí, igual
   * que no cuentan en la campana. Un invitado nunca ve esta fila: la rama de
   * arriba vuelve antes, y la ruta está cerrada.
   */
  const friendRequests = useMyFriendRequests(
    state.status === 'signed-in' ? state.identity.userId : '',
    state.status === 'signed-in' && !isGuest(state),
  );
  const pendingFriends = friendRequests.incoming.length;

  /*
   * ═══════ UN SOLO LÁPIZ PARA LOS DOS CAMPOS ═══════
   *
   * Había dos, uno por editor, y eran dos controles para una misma
   * intención: «cambiar mis datos». Ahora el lápiz de la cabecera abre los
   * DOS a la vez y cada editor sigue siendo dueño de lo suyo —su borrador,
   * su validación, su envío y su cooldown—, así que no se ha movido ni una
   * regla: lo único que cambió de sitio es quién dice «empieza a editar».
   *
   * **Dos banderas y no una**, porque guardar el nombre no tiene por qué
   * cerrar el `@username` a medio escribir: cada editor se cierra cuando
   * termina lo suyo. El lápiz vuelve a abrir los dos, que es lo que la
   * persona pidió al pulsarlo.
   *
   * El cooldown manda por encima de esto: si el handle no se puede cambiar
   * todavía, abrir no lo abre — se sigue viendo la fecha.
   */
  const [editingName, setEditingName] = useState(false);
  const [editingHandle, setEditingHandle] = useState(false);
  const editIdentity = () => {
    setEditingName(true);
    setEditingHandle(true);
  };

  const general: readonly Option[] = [
    { icon: Symbols.language, label: t('profile.languageCurrency') },
    { icon: Symbols.appearance, label: t('profile.appearance') },
    { icon: Symbols.shortcuts, label: t('profile.shortcuts') },
  ];

  /*
   * INVITADO: Perfil conserva su estructura —lista de ajustes, cerrar
   * sesion— y ensena arriba UNA accion de cuenta, «CREAR CUENTA», que lleva
   * a la pestaña Inicio, donde vive el formulario de conversion (una sola
   * implementacion; ni modal ni ruta duplicada). Sin nombre editable, ni
   * planes, ni «Cuenta»: dependen de una cuenta completa. Las opciones
   * generales se quedan: son preferencias del dispositivo, no de la cuenta,
   * y esta es la estructura sobre la que creceran (apariencia, ayuda,
   * privacidad…). Al final, «Cerrar sesion»: es una sesion REAL y se cierra
   * como tal; la confirmacion dice lo que cuesta (no se recupera).
   */
  if (isGuest(state)) {
    const confirmGuestSignOut = () => {
      const confirmation = buildSignOutConfirmation(
        {
          title: t('account.signOutConfirmTitle'),
          body: t('account.guestSignOutConfirmBody'),
          cancel: t('action.cancel'),
          confirm: t('account.signOut'),
        },
        () => {
          void leave(signOut);
        },
      );
      Alert.alert(
        confirmation.title,
        confirmation.body,
        confirmation.buttons.map((button) => ({
          text: button.label,
          style: button.role,
          onPress: button.onPress,
        })),
        { cancelable: true },
      );
    };
    return (
      <PlaceholderScreen title="nav.profile">
        {/* `brand`: el amarillo de la app, siempre habilitado (solo navega a Inicio). */}
        <ActionButton
          label={t('auth.signUpAction')}
          tone="brand"
          onPress={() => {
            router.navigate('/');
          }}
        />

        <Section title={t('profile.general')}>
          <OptionGroup>
            {general.map((option, index) => (
              <OptionRow
                key={option.label}
                icon={option.icon}
                label={option.label}
                first={index === 0}
                soon
              />
            ))}
          </OptionGroup>
        </Section>

        {/* Texto, no boton: la salida es una accion secundaria. En rojo, porque termina la sesion. */}
        <ThemedText
          variant="bodySmall"
          themeColor="negative"
          accessibilityRole="link"
          onPress={leaving.status === 'running' ? undefined : confirmGuestSignOut}
          style={styles.signOut}>
          {leaving.status === 'running' ? t('account.signOutBusy') : t('account.signOut')}
        </ThemedText>
        {leaving.status === 'failed' ? (
          <ThemedText variant="bodySmall" themeColor="negative" accessibilityRole="alert">
            {t(leaving.messageKey)}
          </ThemedText>
        ) : null}
      </PlaceholderScreen>
    );
  }

  return (
    <PlaceholderScreen title="nav.profile">
      {/*
       * ═══════ LA CABECERA DE IDENTIDAD ═══════
       *
       *   ┌──────────────────────────────────────────────┐
       *   │  ⬤   Eduardo                                 │
       *   │      @edu13                    [ QR ] [ ↗ ]  │
       *   └──────────────────────────────────────────────┘
       *
       * Una fila: el avatar pegado al borde izquierdo —sólo el relleno de la
       * pantalla— y, a su derecha y muy cerca, la columna de identidad.
       * Dentro de ella, el nombre arriba y, en la SEGUNDA línea, el
       * `@username` con las dos acciones del enlace empujadas al borde
       * derecho. Antes era una columna centrada, y no había sitio para nada
       * más: cualquier acción nueva caía debajo, en una fila propia,
       * leyéndose como un ajuste y no como algo que la identidad ofrece.
       *
       * **Las acciones van en la línea del `@username`, no en la del
       * nombre.** El nombre es lo que se lee primero y no debe compartir
       * renglón con dos controles; el handle es lo que hace falta para que
       * alguien te encuentre, y ahí es donde tiene sentido ofrecer cómo
       * mandárselo.
       *
       * **Las acciones NO son filas de la lista.** Enseñar tu QR y mandar tu
       * enlace son gestos de la identidad, no opciones de Perfil; metidos en
       * un `OptionRow` habrían quedado al mismo nivel que «Idioma y divisa».
       *
       * **Y no sustituyen a «Amigos»**, que sigue en su sección: son el
       * camino para que alguien te añada, no el sitio donde ves a quién tienes.
       */}
      <View style={styles.identity}>
        <AccountAvatar name={publicName} />

        {/*
         * EL CENTRO: el nombre arriba, el `@username` debajo, los dos en el
         * mismo eje X. Cede el ancho que sobre —`flex: 1` con `minWidth: 0`—,
         * así que con un nombre largo se recorta él y no empuja nada.
         *
         * Una cuenta normal solo llega a Perfil con identidad lista: sin
         * veredicto del servidor la raiz la retiene antes de las pestañas.
         */}
        <View style={styles.identityWho}>
          <DisplayNameEditor
            name={publicName}
            onSave={savePublicName}
            notice={nameNotice}
            editing={editingName}
            onEditingChange={setEditingName}
          />
          {identity.status === 'ready' ? (
            <UsernameEditor
              identity={identity.identity}
              editing={editingHandle}
              onEditingChange={setEditingHandle}
            />
          ) : null}
        </View>

        {/*
         * LA DERECHA: el lápiz arriba, QR y Compartir debajo, los tres
         * pegados al borde. Es una columna con `alignItems: 'flex-end'` y
         * sin `flex`, así que su ancho es el de los botones y no participa
         * en el reparto: lo que se estira es el centro.
         */}
        <View style={styles.identityActions}>
          <GlassPressable
            label={t('profile.editIdentity')}
            depth="raised"
            radius={Radius.lg}
            onPress={editIdentity}>
            <View style={styles.identityEdit}>
              <Icon name={Symbols.edit} size={20} colour={theme.textSecondary} />
            </View>
          </GlassPressable>

          <FriendLinkActions
            handle={identity.status === 'ready' ? identity.identity.handle : null}
            onOpenQr={() => {
              router.push('/friend-link');
            }}
          />
        </View>
      </View>

      <Section title={t('profile.general')}>
        <OptionGroup>
          {general.map((option, index) => (
            <OptionRow
              key={option.label}
              icon={option.icon}
              label={option.label}
              first={index === 0}
              soon
            />
          ))}
        </OptionGroup>
      </Section>

      <Section title={t('profile.social')}>
        <OptionGroup>
          <OptionRow
            icon={Symbols.friends}
            label={t('friends.title')}
            badge={pendingFriends}
            badgeLabel={t(
              pluralCategory(locale, pendingFriends) === 'one'
                ? 'friends.pendingOne'
                : 'friends.pendingOther',
              { count: pendingFriends },
            )}
            first
            onPress={() => {
              router.push('/friends');
            }}
          />
        </OptionGroup>
      </Section>

      <Section title={t('profile.plans')}>
        <PlansCard />
      </Section>

      {/*
       * Cuenta stands alone, with no section title and space above it. It is
       * the only path here that leads somewhere consequential - the session
       * ends behind it - so it reads as a boundary rather than as a fourth
       * General option.
       */}
      <OptionGroup style={styles.account}>
        <OptionRow
          icon={Symbols.profile}
          label={t('profile.account')}
          first
          onPress={() => {
            router.push('/account');
          }}
        />
      </OptionGroup>

      {__DEV__ ? (
        <Section title={t('dev.states')}>
          <OptionGroup>
            <OptionRow
              icon={Symbols.diagnostics}
              label={t('profile.diagnostics')}
              first
              onPress={() => {
                router.push('/diagnostics');
              }}
            />
            <OptionRow
              icon={Symbols.states}
              label={t('dev.states')}
              onPress={() => {
                router.push('/states');
              }}
            />
            <OptionRow
              icon={Symbols.sessionProbe}
              label={t('dev.sessionProbe')}
              onPress={() => {
                router.push('/session-probe');
              }}
            />
          </OptionGroup>
          <ThemedText variant="caption" themeColor="textTertiary">
            {t('dev.statesHint')}
          </ThemedText>
        </Section>
      ) : null}
    </PlaceholderScreen>
  );
}

/**
 * Planes y suscripciones, with nothing to sell yet.
 *
 * A card rather than a row, because a section title over a single row that
 * does nothing is the definition of dead weight. Two lines of real content say
 * what the section will hold, occupy the space honestly, and leave the slot
 * ready without a later change of layout.
 *
 * No plan name and no tier is invented here. Nomey has not decided what it
 * sells, and a card announcing "Gratis" would be a product claim written by
 * the screen that displays it.
 *
 * No yellow either. An accent call to action would compete with the floating
 * `+`, which is the one control in this app allowed to be filled with the
 * brand colour.
 */
function PlansCard() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <GlassSurface material="control" level="regular" style={styles.plans}>
      <View style={styles.plansHead}>
        <Icon name={Symbols.premium} size={20} colour={theme.textSecondary} />
        <SoonPill />
      </View>
      <ThemedText variant="bodyStrong">{t('profile.plansTitle')}</ThemedText>
      <ThemedText variant="bodySmall" themeColor="textSecondary">
        {t('profile.plansBody')}
      </ThemedText>
    </GlassSurface>
  );
}

/** The material the options sit on: one surface per group, not one per row. */
function OptionGroup({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <GlassSurface material="control" level="regular" style={[styles.group, style]}>
      {children}
    </GlassSurface>
  );
}

function OptionRow({
  icon,
  label,
  first = false,
  soon = false,
  badge = 0,
  badgeLabel,
  onPress,
}: {
  icon: IconProps['name'];
  label: string;
  /** Suppresses the divider, which belongs to the row below it. */
  first?: boolean;
  soon?: boolean;
  /**
   * Cuántas cosas esperan detrás de esta fila. Cero no pinta nada: una
   * píldora con un 0 es ruido, no información. El número no viaja solo al
   * lector de pantalla —`badgeLabel` dice de qué es— porque una cifra suelta
   * después de un nombre no significa nada en voz alta.
   */
  badge?: number;
  badgeLabel?: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const interactive = onPress !== undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge > 0 && badgeLabel !== undefined ? `${label}. ${badgeLabel}` : label}
      accessibilityState={{ disabled: !interactive }}
      disabled={!interactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
        pressed && interactive ? { backgroundColor: theme.surfaceSunken } : null,
      ]}>
      {/*
       * The icon keeps full strength even on an inert row. Dimming it as well
       * would make the whole line read as broken rather than as pending, and
       * the icon rail is what makes the group scannable in the first place.
       */}
      <Icon name={icon} size={20} colour={theme.textSecondary} />
      <ThemedText
        variant="body"
        themeColor={interactive ? 'text' : 'textSecondary'}
        style={styles.rowLabel}>
        {label}
      </ThemedText>
      {/*
       * Two non-colour signals for "not yet": the chevron is absent AND a pill
       * is present. Either one alone would be a guess.
       */}
      {badge > 0 ? <CountPill count={badge} /> : null}
      {soon ? <SoonPill /> : <Icon name={Symbols.forward} size={14} colour={theme.textTertiary} />}
    </Pressable>
  );
}

/**
 * Cuántas cosas esperan, en la misma píldora que «Próximamente».
 *
 * **Sin el amarillo de marca, y eso es una regla de esta pantalla**: el acento
 * es del botón flotante, y Perfil entero se pinta sin él. Un contador es un
 * dato, no una llamada a la acción, así que va en el mismo material neutro que
 * «Próximamente» y se distingue por llevar una cifra.
 *
 * Silenciosa para el lector de pantalla —la fila ya lo anuncia dentro de su
 * nombre, con la palabra que le da sentido; una cifra suelta detrás de
 * «Amigos» no significaría nada en voz alta.
 */
function CountPill({ count }: { count: number }) {
  const theme = useTheme();

  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.pill, { borderColor: theme.border, backgroundColor: theme.surfaceSunken }]}>
      <ThemedText variant="caption" themeColor="text">
        {String(count)}
      </ThemedText>
    </View>
  );
}

function SoonPill() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View
      style={[styles.pill, { borderColor: theme.border, backgroundColor: theme.surfaceSunken }]}>
      <ThemedText variant="caption" themeColor="textTertiary">
        {t('action.soon')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  /** La salida del invitado: un enlace gris, al nivel de «recuperar», nunca un boton. */
  signOut: { textAlign: 'center', paddingVertical: Spacing.sm },
  /**
   * LA CABECERA: dos zonas en una fila, no una columna centrada.
   *
   * `alignItems: 'center'` alinea verticalmente las dos zonas entre sí —los
   * dos cuadrados quedan a la altura del avatar y del nombre—, que es otra
   * cosa que el centrado horizontal que había: quién eres se lee desde la
   * izquierda, como el resto de la pantalla.
   */
  /**
   * LA CABECERA: tres zonas en una fila.
   *
   * El avatar a la izquierda, sin relleno horizontal propio —el de la
   * pantalla ya lo pone `PlaceholderScreen`—, la identidad en medio y los
   * botones a la derecha. `alignItems: 'center'` centra el avatar y la
   * columna de acciones VERTICALMENTE respecto al bloque entero.
   *
   * La separación con la identidad es `md` y no `sm`: pegados, el nombre
   * parecía una etiqueta de la foto en vez de una línea por derecho propio.
   */
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    /*
     * `lg` Y NO `md`: 24 puntos entre la foto y el nombre.
     *
     * Con 16 los dos bloques se tocaban y el nombre parecía un pie de la
     * foto en vez de una línea por derecho propio. El avatar mide 96, así
     * que necesita más aire a su lado que una fila de lista: la separación
     * tiene que estar a la escala de lo que separa.
     */
    gap: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  /**
   * El CENTRO se queda con todo lo que sobra, y `minWidth: 0` es lo que
   * permite que sus hijos se recorten: sin él, una caja flexible toma como
   * mínimo el tamaño de su contenido y un nombre largo empujaría la fila
   * fuera de la pantalla en vez de truncarse.
   *
   * `alignItems: 'flex-start'` pone el nombre y el `@username` en el MISMO
   * eje X, que es lo que hace que se lean como un bloque.
   */
  identityWho: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
    gap: Spacing.xxs,
  },
  /**
   * La DERECHA: el lápiz arriba y las dos acciones del enlace debajo.
   *
   * Sin `flex`: su ancho es el de los botones y no participa en el reparto,
   * así que lo que cede con un nombre largo es el centro y nunca ellos.
   * `flex-end` los pega al borde y alinea el lápiz con el grupo de abajo en
   * vez de centrarlo sobre él.
   */
  identityActions: {
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
  /** El mismo cuadrado que QR y Compartir: una sola medida en la cabecera. */
  identityEdit: {
    width: ROUND_TRIGGER,
    height: ROUND_TRIGGER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  group: {
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 56,
    paddingHorizontal: Spacing.md,
  },
  rowLabel: {
    flex: 1,
  },
  pill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  plans: {
    gap: Spacing.xs,
    padding: Spacing.md,
  },
  plansHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  account: {
    marginTop: Spacing.sm,
  },
});
