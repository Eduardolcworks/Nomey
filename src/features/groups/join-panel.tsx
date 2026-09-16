import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Alert } from 'react-native';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { GlassSurface, Icon, ThemedText } from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import type { InvitationPreview } from './invitation-service';
import type { JoinFailure, PreviewStatus } from './use-join-group';

/**
 * EL CONTENIDO DE «ÚNETE A UN GRUPO», dentro de la MISMA hoja del `+`. F09/ADR-004.
 *
 * Dos vistas, en las dos posiciones que la hoja ya tenía:
 *
 *   `JoinEntry`   arriba, donde estaba «Crear grupo», la tarjeta «Escanear QR»
 *                 con el emblema lila del `+`; abajo, donde estaba «Únete», el
 *                 oblongo «Pegar enlace» —SIN teclado: al tocarlo lee el
 *                 portapapeles, sólo entonces, y rellena— y, a su derecha, el
 *                 avión de papel en un disco redondo del MISMO material y alto
 *                 que el oblongo: apagado hasta que el servidor confirma que la
 *                 invitación se puede usar, amarillo entonces, y con carga
 *                 mientras se comprueba. Pegar sólo rellena y valida; la unión
 *                 la inicia el avión.
 *   `WhoAreYou`   los participantes disponibles del grupo —sólo el nombre— en
 *                 una lista que se desplaza, y «Soy nuevo» FUERA de esa lista,
 *                 anclado debajo: siempre a la vista, haya cero o veinte
 *                 nombres. Quien YA ESTUVO ve además «Volver a entrar como X»
 *                 arriba y no ve «Soy nuevo» (F10/ADR-003 §2). Sin deudas,
 *                 importes ni historial: la única información necesaria para
 *                 elegir identidad.
 *
 * Los estilos de tarjeta y emblema son los de la hoja: se reciben, no se
 * copian, para que las dos vistas sean la hoja y no otra cosa dentro de ella.
 */
/** El alto del oblongo, y por tanto el diámetro del avión. */
const LINK_HEIGHT = 44;
const PLANE_GLYPH = 20;

const STATUS_KEY = {
  invalid: 'groups.linkInvalid',
  revoked: 'groups.linkRevoked',
  expired: 'groups.linkExpired',
  throttled: 'groups.linkThrottled',
} as const;

export function JoinEntry({
  text,
  onChangeText,
  status,
  onScan,
  onSend,
  disabled,
  card,
  emblem,
  emblemSurface,
  emblemGlyph,
}: {
  readonly text: string;
  readonly onChangeText: (next: string) => void;
  readonly status: PreviewStatus;
  readonly onScan: () => void;
  readonly onSend: () => void;
  readonly disabled: boolean;
  readonly card: (pressed: boolean) => StyleProp<ViewStyle>;
  readonly emblem: StyleProp<ViewStyle>;
  readonly emblemSurface: StyleProp<ViewStyle>;
  readonly emblemGlyph: number;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  const [clipboard, setClipboard] = useState<'empty' | 'failed' | null>(null);

  const ready = status.kind === 'ready';
  const checking = status.kind === 'checking';
  const problem =
    clipboard === 'empty'
      ? t('groups.pasteEmpty')
      : clipboard === 'failed'
        ? t('groups.pasteFailed')
        : status.kind === 'unusable'
          ? t(STATUS_KEY[status.state])
          : status.kind === 'offline'
            ? t('groups.linkOffline')
            : status.kind === 'notInvitation'
              ? t('groups.linkNotInvitation')
              : null;

  /*
   * EL PORTAPAPELES SE LEE AL TOCAR, y sólo al tocar: nunca al abrir la hoja
   * ni en segundo plano. Lo leído va al campo y a la previsualización; no se
   * registra en ningún sitio. Vacío o ilegible: un aviso breve, y se puede
   * volver a tocar.
   */
  const paste = () => {
    void Clipboard.getStringAsync()
      .then((content) => {
        const trimmed = content.trim();
        if (trimmed === '') {
          setClipboard('empty');
          return;
        }
        setClipboard(null);
        onChangeText(trimmed);
      })
      .catch(() => {
        setClipboard('failed');
      });
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('groups.scanQr')}
        accessibilityHint={t('groups.scanQrDescription')}
        disabled={disabled}
        onPress={onScan}
        style={({ pressed }) => card(pressed)}>
        <View
          style={emblem}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          <GlassSurface
            level="join"
            depth="flat"
            radius={Radius.full}
            lens="inner"
            nativeEffect={false}
            style={emblemSurface}>
            <Icon name={Symbols.qr} size={emblemGlyph} colour={theme.joinAccent} shape="circle" />
          </GlassSurface>
        </View>
        <View style={styles.copy}>
          <ThemedText variant="body" themeColor="text">
            {t('groups.scanQr')}
          </ThemedText>
          <ThemedText variant="bodySmall" themeColor="textSecondary">
            {t('groups.scanQrDescription')}
          </ThemedText>
        </View>
      </Pressable>

      <View style={card(false)}>
        <View style={styles.linkColumn}>
          {/*
           * UNA FILA para el oblongo y el avión, centrados entre sí; el aviso
           * va DEBAJO de la fila, para que al aparecer no desplace al avión.
           */}
          <View style={styles.linkRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={text === '' ? t('groups.pasteLink') : t('groups.linkLabel')}
              accessibilityHint={t('groups.pasteHint')}
              disabled={disabled}
              onPress={paste}
              style={styles.linkPress}>
              <GlassSurface
                material="control"
                level="regular"
                depth="well"
                rim="soft"
                radius={Radius.full}
                nativeEffect={false}
                style={styles.linkBox}>
                <ThemedText
                  variant="body"
                  themeColor={text === '' ? 'textDisabled' : 'text'}
                  numberOfLines={1}>
                  {text === '' ? t('groups.pasteLink') : text}
                </ThemedText>
              </GlassSurface>
            </Pressable>

            {/*
             * EL AVIÓN. Redondo, del MISMO material y alto que el oblongo —el
             * mismo `GlassSurface` de control, `well`, canto suave— y en su misma
             * fila. Apagado hasta que el servidor dice que sí; amarillo entonces
             * —el mismo acento que el CTA de guardar—; y carga mientras pregunta.
             */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('groups.linkSend')}
              accessibilityState={{ disabled: !ready || disabled, busy: checking }}
              disabled={!ready || disabled}
              onPress={onSend}>
              <GlassSurface
                material="control"
                level="regular"
                depth="well"
                rim="soft"
                radius={Radius.full}
                nativeEffect={false}
                style={[styles.plane, ready ? { backgroundColor: theme.accent } : null]}>
                {checking ? (
                  <ActivityIndicator color={theme.textSecondary} />
                ) : (
                  <Icon
                    name={Symbols.send}
                    size={PLANE_GLYPH}
                    colour={ready ? theme.onAccent : theme.textDisabled}
                    shape="circle"
                  />
                )}
              </GlassSurface>
            </Pressable>
          </View>
          {/* El motivo, en su sitio y sin borrar lo escrito. */}
          {problem === null ? null : (
            <ThemedText
              variant="caption"
              themeColor="negative"
              numberOfLines={2}
              style={styles.problem}>
              {problem}
            </ThemedText>
          )}
          {ready ? (
            <ThemedText
              variant="caption"
              themeColor="textSecondary"
              numberOfLines={1}
              style={styles.problem}>
              {t('groups.linkReady', { group: status.preview.displayName })}
            </ThemedText>
          ) : null}
        </View>
      </View>
    </>
  );
}

const FAILURE_KEY: Readonly<
  Record<
    JoinFailure,
    | 'groups.joinOffline'
    | 'groups.joinClaimed'
    | 'groups.joinRejoin'
    | 'groups.joinUnusable'
    | 'groups.joinRejected'
  >
> = {
  offline: 'groups.joinOffline',
  claimed: 'groups.joinClaimed',
  rejoinPending: 'groups.joinRejoin',
  unusable: 'groups.joinUnusable',
  rejected: 'groups.joinRejected',
};

export function WhoAreYou({
  preview,
  profileName,
  joining,
  failure,
  onClaim,
  onNew,
  onRejoin,
  onBack,
}: {
  readonly preview: InvitationPreview & { state: 'ok' };
  /** El nombre real del perfil, o `null` si la cuenta no tiene uno válido. */
  readonly profileName: string | null;
  readonly joining: boolean;
  readonly failure: JoinFailure | null;
  readonly onClaim: (participantId: string) => void;
  readonly onNew: (displayName: string) => void;
  /** Volver con la identidad de entonces (F09/ADR-010). */
  readonly onRejoin: () => void;
  readonly onBack: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const typed = name.trim();

  const rejoin = preview.membership === 'rejoin';

  return (
    <View style={styles.who}>
      <View style={styles.whoHead}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('groups.joinBack')}
          onPress={onBack}
          hitSlop={Spacing.sm}>
          <Icon name={Symbols.back} size={20} colour={theme.textSecondary} />
        </Pressable>
        <View style={styles.whoTitle}>
          <ThemedText variant="body" themeColor="text" numberOfLines={1}>
            {t('groups.whoTitle', { group: preview.displayName })}
          </ThemedText>
          <ThemedText variant="bodySmall" themeColor="textSecondary" numberOfLines={2}>
            {rejoin ? t('groups.whoRejoinHint') : t('groups.whoHint')}
          </ThemedText>
        </View>
      </View>

      {/*
       * VOLVER (F09/ADR-010, F10/ADR-003 §2): quien ya estuvo puede volver con
       * su identidad de entonces —el nombre es el actual de esa identidad (el
       * destino, si asoció a alguien)— O elegir, abajo, a alguien sin cuenta.
       * Lo que no hay es «Soy nuevo».
       */}
      {rejoin && preview.previousParticipant !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('groups.whoRejoin', {
            name: preview.previousParticipant.displayName,
          })}
          disabled={joining}
          onPress={onRejoin}
          style={({ pressed }) => [
            styles.option,
            styles.newOption,
            {
              backgroundColor: pressed ? theme.surfaceSunken : theme.surfaceRaised,
              borderColor: theme.accent,
            },
          ]}>
          <Icon name={Symbols.person} size={18} colour={theme.accent} />
          <ThemedText variant="body" themeColor="text" numberOfLines={1} style={styles.optionText}>
            {t('groups.whoRejoin', { name: preview.previousParticipant.displayName })}
          </ThemedText>
        </Pressable>
      ) : null}
      {/* Los participantes sin cuenta disponibles, haya estado antes o no. */}
      <ScrollView
        style={styles.whoScroll}
        contentContainerStyle={styles.whoList}
        keyboardShouldPersistTaps="handled">
        {preview.participants.length === 0 ? (
          <ThemedText variant="bodySmall" themeColor="textTertiary" style={styles.whoEmpty}>
            {t('groups.whoNone')}
          </ThemedText>
        ) : null}
        {preview.participants.map((one) => (
          <Pressable
            key={one.participantId}
            accessibilityRole="button"
            accessibilityLabel={t('groups.whoClaim', { name: one.displayName })}
            disabled={joining}
            onPress={() => {
              /*
               * «¿ERES [NOMBRE]?» antes de reclamar. Reclamar vincula a tu
               * cuenta los gastos y las deudas anteriores de esa identidad, y
               * el vínculo es PERMANENTE en este grupo (F10/ADR-002): no hay
               * ninguna acción para deshacerlo. Es lo que hay que leer antes
               * de confirmar, y el paso atrás es «Volver».
               */
              Alert.alert(
                t('groups.claimAskTitle', { name: one.displayName }),
                t('groups.claimAskBody'),
                [
                  { text: t('groups.claimBack'), style: 'cancel' },
                  {
                    text: t('groups.claimYes', { name: one.displayName }),
                    onPress: () => {
                      onClaim(one.participantId);
                    },
                  },
                ],
              );
            }}
            style={({ pressed }) => [
              styles.option,
              {
                backgroundColor: pressed ? theme.surfaceSunken : theme.surfaceRaised,
                borderColor: theme.border,
              },
            ]}>
            <Icon name={Symbols.person} size={18} colour={theme.textSecondary} />
            <ThemedText
              variant="body"
              themeColor="text"
              numberOfLines={1}
              style={styles.optionText}>
              {one.displayName}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>

      {/*
       * «SOY NUEVO», FUERA DE LA LISTA. Estaba dentro del ScrollView y con dos o
       * tres nombres quedaba por debajo del borde de la hoja: existía, pero no
       * se veía. Anclado aquí es la última fila del panel, siempre visible, y
       * se distingue de los nombres por el emblema lila y el borde. Con el
       * nombre del perfil; sin uno válido, se pide sólo ese dato. Quien YA
       * ESTUVO no lo ve (F10/ADR-003 §2): vuelve como entonces o elige a
       * alguien sin cuenta, y el servidor rehúsa «nuevo» (REJOIN_REQUIRED).
       */}
      {rejoin ? null : naming && profileName === null ? (
        <View
          style={[
            styles.option,
            { backgroundColor: theme.surfaceRaised, borderColor: theme.accent },
          ]}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t('groups.whoNewName')}
            placeholderTextColor={theme.textDisabled}
            accessibilityLabel={t('groups.whoNewName')}
            autoFocus
            editable={!joining}
            style={[styles.nameInput, { color: theme.text }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('groups.whoNewConfirm')}
            disabled={typed === '' || joining}
            onPress={() => {
              onNew(typed);
            }}
            hitSlop={Spacing.sm}>
            <Icon
              name={Symbols.send}
              size={20}
              colour={typed === '' ? theme.textDisabled : theme.accent}
            />
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('groups.whoNew')}
          accessibilityHint={t('groups.whoNewHint')}
          disabled={joining}
          onPress={() => {
            if (profileName === null) setNaming(true);
            else onNew(profileName);
          }}
          style={({ pressed }) => [
            styles.option,
            styles.newOption,
            {
              backgroundColor: pressed ? theme.surfaceSunken : theme.surfaceRaised,
              /* El amarillo de Nomey, no el tinte de «Unirse»: es la opción elegible. */
              borderColor: theme.accent,
            },
          ]}>
          <Icon name={Symbols.add} size={18} colour={theme.accent} />
          <ThemedText variant="body" themeColor="text" numberOfLines={1} style={styles.optionText}>
            {t('groups.whoNew')}
            {profileName === null ? '' : ` · ${profileName}`}
          </ThemedText>
        </Pressable>
      )}

      {joining ? <ActivityIndicator color={theme.textSecondary} /> : null}
      {failure === null ? null : (
        <ThemedText variant="caption" themeColor="negative" style={styles.problem}>
          {t(FAILURE_KEY[failure])}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  copy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.xxs,
  },
  linkColumn: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.xxs,
  },
  linkBox: {
    height: LINK_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  problem: {
    paddingHorizontal: Spacing.sm,
  },
  /** Oblongo y avión, centrados entre sí en su propia fila. */
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  linkPress: {
    flex: 1,
    minWidth: 0,
  },
  plane: {
    width: LINK_HEIGHT,
    height: LINK_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  who: {
    flex: 1,
    gap: Spacing.sm,
  },
  whoHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  whoTitle: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.xxs,
  },
  /** La lista cede el alto; «Soy nuevo» y el aviso de debajo lo conservan. */
  whoScroll: {
    flexShrink: 1,
  },
  whoList: {
    gap: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  whoEmpty: {
    paddingHorizontal: Spacing.sm,
  },
  /** Un punto de borde: se distingue de los nombres por trazo, no sólo por color. */
  newOption: {
    borderWidth: 1,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  optionText: {
    flex: 1,
    minWidth: 0,
  },
  nameInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
});
