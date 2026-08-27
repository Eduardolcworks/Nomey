import * as SecureStore from 'expo-secure-store';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useFormat } from '@/lib/format';
import { type MessageKey, useTranslation } from '@/lib/i18n';
import {
  CHUNKED_STORAGE_LIMITS,
  createChunkedStore,
  measureStoredSession,
  secureStoreBackend,
  SESSION_STORAGE_KEY,
  supabase,
} from '@/lib/supabase';
import { ThemedText, ThemedView } from '@/ui/components';
import { Radius, Spacing, type TextColor, useTheme } from '@/ui/theme';

/**
 * The F5.A probe. `__DEV__` only, reachable only from Profile's dev section.
 *
 * This is not a feature and never becomes one. It exists because four of the
 * things F5.A decides cannot be verified anywhere but on a real phone:
 *
 * - the Supabase client is constructible under Hermes at all;
 * - `getSession()` with nothing stored answers `null` rather than throwing;
 * - SecureStore is actually available on the device;
 * - and a value far larger than one keychain entry survives a round trip
 *   through the chunking store.
 *
 * Vitest proves none of these. It runs on V8 with a fake backend, and `Intl`
 * already taught this project that passing there says nothing about the phone.
 *
 * It writes to a key of its own, never to the session's, and clears up after
 * itself. Reusing the real key would let a probe run sign the user out.
 */

/** Its own key. Touching the session's would make the probe destructive. */
const PROBE_KEY = 'nomey-probe-value';

/** Big enough to need many chunks, so the interesting path is the one tested. */
const PROBE_UNITS = CHUNKED_STORAGE_LIMITS.chunkSize * 9 + 7;

type Outcome = 'pending' | 'pass' | 'fail';

type Check = {
  readonly label: MessageKey;
  readonly outcome: Outcome;
  /** Free-form evidence: a size, a null, an error message. Never copy. */
  readonly detail: string;
};

const MARK: Record<Outcome, { mark: string; colour: TextColor }> = {
  pending: { mark: '·', colour: 'textTertiary' },
  pass: { mark: '✓', colour: 'positive' },
  fail: { mark: '✕', colour: 'negative' },
};

function payload(length: number): string {
  let out = '';
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < length; i += 1) out += alphabet[i % alphabet.length];
  return out;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export default function SessionProbeScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();
  const [checks, setChecks] = useState<readonly Check[]>([]);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    const results: Check[] = [];

    // 1 - is SecureStore there at all?
    try {
      const available = await SecureStore.isAvailableAsync();
      results.push({
        label: 'probe.secureStore',
        outcome: available ? 'pass' : 'fail',
        detail: String(available),
      });
    } catch (error) {
      results.push({ label: 'probe.secureStore', outcome: 'fail', detail: describe(error) });
    }

    // 2 - a value far larger than one entry, through the real backend.
    const store = createChunkedStore(secureStoreBackend);
    const value = payload(PROBE_UNITS);
    try {
      await store.setItem(PROBE_KEY, value);
      const read = await store.getItem(PROBE_KEY);
      const identical = read === value;
      results.push({
        label: 'probe.largeValue',
        outcome: identical ? 'pass' : 'fail',
        detail: `${format.number(value.length)} / ${format.number(read?.length ?? 0)}`,
      });
    } catch (error) {
      results.push({ label: 'probe.largeValue', outcome: 'fail', detail: describe(error) });
    }

    // 3 - and it can be taken away again, which is what sign-out will need.
    try {
      await store.removeItem(PROBE_KEY);
      const afterRemoval = await store.getItem(PROBE_KEY);
      results.push({
        label: 'probe.cleared',
        outcome: afterRemoval === null ? 'pass' : 'fail',
        detail: String(afterRemoval),
      });
    } catch (error) {
      results.push({ label: 'probe.cleared', outcome: 'fail', detail: describe(error) });
    }

    // 4 - the client exists, which under Hermes is not a given.
    results.push({
      label: 'probe.client',
      outcome: typeof supabase?.auth?.getSession === 'function' ? 'pass' : 'fail',
      detail: typeof supabase,
    });

    /*
     * 5 - and answers cleanly. With nothing stored the answer is `null`, which
     *     was F5.A's acceptance criterion; with a real session it is a
     *     session, and what is checked is that asking did not throw. The
     *     session itself is never rendered - only which of the two it was.
     */
    try {
      const { data, error } = await supabase.auth.getSession();
      results.push({
        label: 'probe.session',
        outcome: error === null ? 'pass' : 'fail',
        detail: error === null ? (data.session === null ? 'null' : 'session') : describe(error),
      });
    } catch (error) {
      results.push({ label: 'probe.session', outcome: 'fail', detail: describe(error) });
    }

    /*
     * 6 - the real session payload, which ADR-017 requires measured on a
     *     device before Phase 5 closes and which had no session to measure
     *     until F5.C produced one.
     *
     * Numbers only, and structurally so: `measureStoredSession` returns four
     * integers and a boolean, so there is no shape in which a token could
     * arrive here to be rendered.
     */
    try {
      const metrics = await measureStoredSession(secureStoreBackend, SESSION_STORAGE_KEY);
      const size = `${format.number(metrics.utf8Bytes)} B · ${format.number(metrics.codeUnits)} u`;
      const shape = `${metrics.chunks} chunks · max ${format.number(metrics.largestChunkBytes)} B`;
      results.push({
        label: 'probe.payload',
        outcome: metrics.present ? 'pass' : 'pending',
        detail: metrics.present ? `${size} · ${shape}` : '—',
      });
    } catch (error) {
      results.push({ label: 'probe.payload', outcome: 'fail', detail: describe(error) });
    }

    setChecks(results);
    setRunning(false);
  }, [format]);

  /*
   * Nothing runs on mount, on purpose. The probe writes to the keychain, and
   * arriving at a screen is not consent to do that; it also makes the run
   * repeatable and its timing obvious when reading the result on a phone.
   */
  return (
    <ThemedView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText variant="caption" themeColor="textTertiary">
          {t('probe.hint')}
        </ThemedText>

        <View style={styles.rows}>
          {checks.map((check) => (
            <View
              key={check.label}
              style={[styles.row, { borderColor: theme.border, backgroundColor: theme.surface }]}>
              <ThemedText variant="body" themeColor={MARK[check.outcome].colour}>
                {MARK[check.outcome].mark}
              </ThemedText>
              <View style={styles.rowText}>
                <ThemedText variant="body">{t(check.label)}</ThemedText>
                <ThemedText variant="caption" themeColor="textTertiary">
                  {check.detail}
                </ThemedText>
              </View>
            </View>
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(checks.length === 0 ? 'probe.run' : 'probe.rerun')}
          accessibilityState={{ disabled: running }}
          disabled={running}
          onPress={() => void run()}
          style={({ pressed }) => [
            styles.button,
            {
              borderColor: theme.border,
              backgroundColor: pressed ? theme.surfaceSunken : 'transparent',
            },
          ]}>
          <ThemedText variant="body" themeColor={running ? 'textDisabled' : 'text'}>
            {t(checks.length === 0 ? 'probe.run' : 'probe.rerun')}
          </ThemedText>
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingTop: Spacing.xxl, gap: Spacing.lg },
  rows: { gap: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 52,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
  },
  rowText: { flex: 1, gap: 2 },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
  },
});
