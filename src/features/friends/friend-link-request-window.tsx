import { StyleSheet, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { ActionButton, EmptyState, IdentityLine, LoadingState, ThemedText } from '@/ui/components';
import { Spacing, Symbols } from '@/ui/theme';

import { isAnswerable, PREVIEW_NOTICE } from './friend-link-state';
import type { FriendLinkResponder } from './use-friend-link-response';

/**
 * RESPONDER A UN ENLACE DE AMISTAD RECIBIDO.
 *
 * Lo que se enseña es la identidad pública de quien lo compartió y una
 * pregunta: «¿quieres ser su amigo?». Nada más. **No hay uid, ni correo, ni
 * grupos, ni movimientos, ni nada económico** — el servidor no los publica y
 * esta pantalla no tendría de dónde sacarlos.
 *
 * **Los tres estados que se contestan se ven IGUAL**, a propósito: que
 * hubiera ya una solicitud suya hacia mí, o mía hacia él, o ninguna, es
 * contabilidad del servidor (`accepted_via_link`), no una diferencia que la
 * persona pueda o deba resolver. `respond_friend_link` reutiliza la que haya
 * y nunca duplica.
 *
 * **Un enlace inválido no dice de quién era.** Ésa es la línea: un enlace
 * rotado o inventado no puede servir para averiguar quién hay detrás de un
 * token, y por eso el servidor lo devuelve sin identidad y aquí no se
 * inventa ninguna.
 */
export function FriendLinkRequestWindow({
  responder,
  onDone,
}: {
  readonly responder: FriendLinkResponder;
  /** Cerrar: la pantalla ya no tiene nada que hacer. */
  readonly onDone: () => void;
}) {
  const { t } = useTranslation();
  const { view } = responder;

  if (view.kind === 'checking') {
    return <LoadingState label={t('friendLink.checking')} />;
  }

  if (view.kind === 'failed') {
    return (
      <View style={styles.block}>
        <ThemedText variant="body" themeColor="negative" style={styles.centered}>
          {t(view.offline ? 'friends.errorOffline' : 'friendLink.checkFailed')}
        </ThemedText>
        <View style={styles.actions}>
          <ActionButton label={t('action.retry')} tone="primary" onPress={responder.retry} />
          <ActionButton
            label={t('action.close')}
            tone="secondary"
            material="control"
            onPress={onDone}
          />
        </View>
      </View>
    );
  }

  if (view.kind === 'answered') {
    const answer = view.response;
    const notice =
      answer.state === 'friends'
        ? 'friendLink.accepted'
        : answer.state === 'declined' || answer.state === 'dismissed'
          ? 'friendLink.declined'
          : (PREVIEW_NOTICE[answer.state] ?? 'friendLink.invalid');
    return (
      <View style={styles.block} accessibilityLiveRegion="polite">
        <EmptyState symbol={Symbols.friends} title={t(notice)} />
        <ActionButton label={t('action.done')} tone="brand" onPress={onDone} />
      </View>
    );
  }

  const preview = view.preview;

  /* own, friends, invalid y throttled: se dicen y se cierra. Nada que contestar. */
  if (!isAnswerable(preview)) {
    const notice = PREVIEW_NOTICE[preview.state] ?? 'friendLink.invalid';
    return (
      <View style={styles.block}>
        {preview.state === 'friends' ? (
          <IdentityLine
            name={preview.publicName}
            handle={preview.handle}
            fallback={t('friends.unknown')}
            glyph={Symbols.person}
          />
        ) : null}
        <EmptyState symbol={Symbols.friends} title={t(notice)} />
        <ActionButton label={t('action.close')} tone="brand" onPress={onDone} />
      </View>
    );
  }

  const name =
    preview.publicName ?? (preview.handle === null ? t('friends.unknown') : `@${preview.handle}`);

  return (
    <View style={styles.block}>
      <IdentityLine
        name={preview.publicName}
        handle={preview.handle}
        fallback={t('friends.unknown')}
        glyph={Symbols.person}
        emphasis="strong"
      />
      <ThemedText variant="body" themeColor="textSecondary" style={styles.centered}>
        {t('friendLink.wantsToAdd', { name })}
      </ThemedText>

      <View style={styles.actions}>
        <ActionButton
          label={t('friends.accept')}
          tone="brand"
          busy={responder.busy}
          disabled={responder.busy}
          onPress={() => {
            void responder.accept();
          }}
          style={styles.action}
        />
        <ActionButton
          label={t('friends.decline')}
          tone="secondary"
          material="control"
          disabled={responder.busy}
          onPress={() => {
            void responder.decline();
          }}
          style={styles.action}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    justifyContent: 'center',
  },
  action: {
    flexGrow: 1,
  },
  centered: {
    textAlign: 'center',
  },
});
