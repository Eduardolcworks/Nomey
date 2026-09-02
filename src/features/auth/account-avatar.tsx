import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { ControlMaterial, Icon, ThemedText } from '@/ui/components';
import { controlEdge, emphasisDepth, Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import { initialsFrom } from './display-name';

/**
 * The account's face, before it has one.
 *
 * **The photo is not implemented, and this is the affordance rather than a
 * half-built version of it.** Making it real needs two things Nomey does not
 * have and cannot improvise: a picker, which is a new runtime dependency and
 * therefore an approval, and somewhere to put the result, which is Supabase
 * Storage with its own bucket, policies and migration. The handoff already
 * closed this once - "Avatar, fuera de F5" - so what is built here is the
 * shape of the thing, wired to say so honestly when tapped.
 *
 * The one shortcut that looks tempting is genuinely dangerous: stuffing a
 * base64 image into `user_metadata` would put it inside the JWT and inside the
 * stored session. The real session was measured at 2285 bytes over 5 chunks;
 * an encoded photo would blow straight past the 128-chunk ceiling and break
 * signing in, not just the avatar.
 *
 * **Empty must never read as broken.** An image that fails to load and a
 * placeholder that is doing its job look identical if the placeholder is an
 * empty circle, so there are three separate signals that this is deliberate:
 * the initials or a person glyph in the middle, the hairline rim, and the
 * camera badge. Any one of them alone would be ambiguous.
 *
 * The initials come from the display name and **never from the email**. The
 * local part of an address is not a name, and two letters of it stamped on
 * the most prominent element of the screen is the same small lie in a larger
 * font.
 */

const SIZE = 96;
const BADGE = 30;

export function AccountAvatar({ name }: { name: string | null }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const initials = initialsFrom(name);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('profile.addPhoto')}
      // Not `disabled`. A disabled control is announced as unavailable and
      // gives no feedback at all; this one answers, and the answer is honest.
      accessibilityHint={t('action.soon')}
      onPress={() => {
        Alert.alert(t('profile.photoSoonTitle'), t('profile.photoSoonBody'), [
          { text: t('action.close'), style: 'cancel' },
        ]);
      }}
      style={({ pressed }) => [
        styles.avatar,
        {
          backgroundColor: pressed ? theme.surface : theme.surfaceSunken,
          borderColor: controlEdge(theme.border),
          boxShadow: emphasisDepth(pressed ? 'pressed' : 'raised'),
        },
      ]}>
      {({ pressed }) => (
        <>
          {/*
           * El círculo es un control neutro y recibe el material aprobado. El
           * relleno sigue al estado —al pulsarlo se retira y asoma el
           * `theme.surface` del host, que es la respuesta que ya daba—, y el rim
           * base con su acento superior sustituyen al `inset` que oscurecía el
           * interior. En iOS no se monta ningún nodo.
           */}
          <ControlMaterial radius={Radius.full} fill={!pressed} />
          {initials === null ? (
            <Icon name={Symbols.person} size={38} colour={theme.textTertiary} shape="circle" />
          ) : (
            <ThemedText variant="title" themeColor="textSecondary">
              {initials}
            </ThemedText>
          )}

          {/*
           * The badge sits on `surfaceRaised` with its own rim so it reads as an
           * object on top of the circle rather than a hole cut out of it. It is
           * the only part of this control that says "add", which is why it is not
           * allowed to blend in.
           */}
          <View
            style={[
              styles.badge,
              { backgroundColor: theme.surfaceRaised, borderColor: theme.border },
            ]}>
            <Icon name={Symbols.camera} size={14} colour={theme.textSecondary} shape="circle" />
          </View>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: SIZE,
    height: SIZE,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    right: -Spacing.xxs,
    bottom: -Spacing.xxs,
    width: BADGE,
    height: BADGE,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
