import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { ActionButton, GlassPressable, ThemedText } from '@/ui/components';
import { Radius, Spacing } from '@/ui/theme';

import type { PersonalStartMode } from './personal-scope';

/**
 * «¿CÓMO QUIERES EMPEZAR TU MODO PERSONAL?» (F10/ADR-005 §6).
 *
 * Se ve UNA vez: la primera que una cuenta que nació como Invitado abre su
 * Modo Personal con historia de grupos detrás. Dos opciones excluyentes y
 * «Continuar», deshabilitado hasta elegir. No decide nada por su cuenta: la
 * elección viaja al servidor (`start_personal_scope`), que la persiste y la
 * valida, y esta pieza desaparece cuando el ámbito releído dice que ya está
 * decidido. No hay «migrar» en ninguna cadena, y no hay marcha atrás: el
 * copy de «Empezar desde cero» dice lo que queda fuera.
 */
export function PersonalStart({
  onDecide,
  busy,
  failed,
  onRetry,
}: {
  readonly onDecide: (mode: PersonalStartMode) => void;
  readonly busy: boolean;
  /** El comando no llegó o el servidor lo rehusó: se enseña y se puede reintentar. */
  readonly failed: boolean;
  readonly onRetry: () => void;
}) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<PersonalStartMode | null>(null);

  const options: readonly { mode: PersonalStartMode; title: string; body: string }[] = [
    {
      mode: 'include',
      title: t('personalStart.includeTitle'),
      body: t('personalStart.includeBody'),
    },
    { mode: 'fresh', title: t('personalStart.freshTitle'), body: t('personalStart.freshBody') },
  ];

  return (
    <View style={styles.stack}>
      <View style={styles.heading}>
        <ThemedText variant="display">{t('personalStart.title')}</ThemedText>
        <ThemedText variant="body" themeColor="textSecondary">
          {t('personalStart.body')}
        </ThemedText>
      </View>

      <View style={styles.options} accessibilityRole="radiogroup">
        {options.map((option) => (
          <GlassPressable
            key={option.mode}
            label={option.title}
            selected={choice === option.mode}
            // La elegida lleva el borde amarillo; el estado accesible lo lleva `selected`.
            edge={choice === option.mode ? 'accent' : undefined}
            disabled={busy}
            radius={Radius.lg}
            rim="catch"
            onPress={() => setChoice(option.mode)}>
            <View style={styles.option}>
              <ThemedText variant="label">{option.title}</ThemedText>
              <ThemedText variant="bodySmall" themeColor="textSecondary">
                {option.body}
              </ThemedText>
            </View>
          </GlassPressable>
        ))}
      </View>

      {failed ? (
        <ThemedText
          variant="bodySmall"
          themeColor="negative"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert">
          {t('personalStart.failed')}
        </ThemedText>
      ) : null}

      {/*
       * `brand`: la única respuesta que la pantalla pide. Gris y apagado hasta
       * que haya una opción elegida; amarillo entonces (`action-button-style`).
       */}
      <ActionButton
        label={busy ? t('auth.working') : failed ? t('action.retry') : t('personalStart.continue')}
        onPress={() => {
          if (failed) {
            onRetry();
            return;
          }
          if (choice !== null) onDecide(choice);
        }}
        tone="brand"
        disabled={busy || (!failed && choice === null)}
        busy={busy}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.lg },
  heading: { gap: Spacing.xs },
  options: { gap: Spacing.md },
  option: { gap: Spacing.xs, padding: Spacing.md },
});
