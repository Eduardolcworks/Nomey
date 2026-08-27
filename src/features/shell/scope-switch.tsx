import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { GlassSurface, ThemedText } from '@/ui/components';
import { Radius, Spacing, Tactile, useTheme } from '@/ui/theme';

import { SCOPE_AVAILABLE, SCOPE_LABEL, type Scope, useScope } from './scope-context';

/** With two scopes, "the other one" is the whole cycle. */
function nextScope(current: Scope): Scope {
  return current === 'personal' ? 'couple' : 'personal';
}

/**
 * One button that says which scope is active, and swaps to the other.
 *
 * A two-half segmented control spent half its width showing the option you are
 * not in, which is the wrong emphasis for something that answers "whose money
 * am I looking at". A single button states the answer, and the swap glyph says
 * it can change.
 *
 * The cost of that trade is that the alternative is no longer visible, so the
 * label carries the current scope in full-strength text and the accessible
 * name says where a press goes - "Cambiar a Pareja" - rather than leaving the
 * user to discover it by pressing.
 *
 * Glass for the surface, tactile depth for the press. Both, because this is
 * the control the whole screen hangs off: the balance below it and the action
 * button at the bottom both mean something different depending on it.
 */
export function ScopeSwitch() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { scope, setScope } = useScope();

  const target = nextScope(scope);
  const unavailable = !SCOPE_AVAILABLE[scope];

  return (
    <Pressable
      accessibilityRole="button"
      // El nombre dice el estado y la pista dice la acción, que es justo la
      // ambigüedad de un pulsador cuya etiqueta cambia: "Personal" no aclara por
      // sí solo si es dónde estás o adónde vas.
      accessibilityLabel={`${t('scope.label')}: ${t(SCOPE_LABEL[scope])}`}
      accessibilityHint={t('scope.switchTo', { scope: t(SCOPE_LABEL[target]) })}
      onPress={() => {
        setScope(target);
      }}
      style={({ pressed }) => [
        styles.pressable,
        { boxShadow: pressed ? Tactile.pressed : Tactile.raised },
      ]}>
      {({ pressed }) => (
        <GlassSurface
          level="regular"
          radius={Radius.full}
          style={[
            styles.surface,
            {
              borderColor: pressed ? theme.borderInteractive : theme.borderStrong,
            },
          ]}>
          <ThemedText variant="label" themeColor={unavailable ? 'textSecondary' : 'text'}>
            {t(SCOPE_LABEL[scope])}
          </ThemedText>
          <SymbolView
            name="arrow.left.arrow.right"
            size={13}
            tintColor={theme.textTertiary}
            fallback={<View style={[styles.fallback, { borderColor: theme.textTertiary }]} />}
          />
        </GlassSurface>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    borderRadius: Radius.full,
    // 44pt of height for a thumb, whatever the label measures.
    minHeight: 44,
    justifyContent: 'center',
  },
  surface: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 44,
  },
  fallback: {
    width: 11,
    height: 11,
    borderWidth: 2,
    borderRadius: Radius.sm,
  },
});
