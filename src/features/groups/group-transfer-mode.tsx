import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { type CurrencyDefinition, moneyFromMinorString } from '@/domain';
import { currencySymbol, useFormat } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import {
  type AmountEntry,
  AmountSheet,
  EMPTY_AMOUNT,
  EmptyState,
  GlassSurface,
  LoadingState,
  ThemedText,
} from '@/ui/components';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import type { TransferCandidate } from './group-transfer';
import { GroupTransferPreview } from './group-transfer-preview';
import { fetchGroupTransferCandidates } from './group-transfer-service';
import { transferableCandidates, transferSubmission } from './group-transfer';
import { ParticipantTick } from './participant-tick';
import { useRecordGroupTransfer } from './use-group-transfers';

/**
 * EL MODO «TRANSFERENCIA» DE LA VENTANA DEL GRUPO (F12/ADR-007, F12.C3).
 *
 * **La misma forma que el alta de un gasto, y por el mismo motivo.** Importe
 * arriba, concepto debajo y la lista de personas al final — los tres desde
 * que se entra. Una primera pantalla sólo para elegir destinatario hacía que
 * la ventana cambiara de alto al pasar al importe, y de paso decidía por la
 * persona que una transferencia es a UNA sola.
 *
 * **El importe es el TOTAL, y se reparte entre los marcados.** Lo que se ve
 * aquí es una VISTA PREVIA: el reparto autoritativo lo hace el servidor con
 * la misma regla —`allocateByLargestRemainder` de F01/ADR-001 §5— sobre el
 * mismo orden, el que `api.group_transfer_candidates` devuelve. Por eso la
 * unidad menor que sobra se enseña en la persona que de verdad la recibe.
 *
 * ═══════════ UNA VOLUNTAD, UNA OPERACIÓN, TODO O NADA ═══════════
 *
 * No hay propuesta, ni aceptación, ni rechazo: el actor DECLARA que ha
 * transferido, y el efecto ocurre al confirmar el servidor. Con varios
 * destinatarios sigue siendo **una sola operación atómica**, así que no hay
 * envío parcial que contar — o entran los N o no entra ninguno.
 *
 * **Y el receptor es el PARTICIPANTE, no una cuenta.** Un fantasma aparece en
 * la lista y recibe como cualquiera: no hace falta que tenga cuenta, ni
 * username, ni Modo Personal, ni amistad. Que no la tenga NO puede bloquear
 * el botón.
 */
export function GroupTransferMode({
  scopeId,
  currency,
  today,
  now,
  header,
  onRecorded,
}: {
  readonly scopeId: string;
  /** La divisa base del GRUPO, que es la de la operación y no se elige. */
  readonly currency: CurrencyDefinition;
  /**
   * CUÁNDO, sembrado por la ruta desde el aparato — la misma costura que el
   * gasto compartido usa (`todayInDeviceCalendar()` y `clockTimeOf`). Esta
   * pantalla NO lee el reloj: recibe el instante.
   */
  readonly today: string;
  readonly now: string;
  /** El selector de clase y el nombre del grupo: los mismos que el gasto. */
  readonly header: ReactNode;
  readonly onRecorded: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const theme = useTheme();
  const writer = useRecordGroupTransfer();

  const [rows, setRows] = useState<readonly TransferCandidate[] | null>(null);
  const [failed, setFailed] = useState(false);
  /** A quién. **Nadie marcado al entrar**, a diferencia del gasto. */
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_AMOUNT);
  const [concept, setConcept] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (scopeId === '') return;
    let live = true;
    void (async () => {
      try {
        const loaded = await fetchGroupTransferCandidates(scopeId);
        if (live) {
          setRows(loaded);
          setFailed(false);
        }
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [scopeId]);

  /*
   * LOS CANDIDATOS TRAEN SU NETO, así que el reparto y la vista previa no
   * cuestan ni una consulta más por persona marcada:
   * `api.group_transfer_candidates` ya devuelve el neto de cada par en la
   * misma llamada. No hay N+1 que evitar y no hizo falta una lectura nueva.
   */
  const choices = rows === null ? null : transferableCandidates(rows);
  const chosen = useMemo(
    () => (choices ?? []).filter((one) => selected.includes(one.participantId)),
    [choices, selected],
  );

  /*
   * QUÉ IMPIDE ENVIAR Y CON QUÉ REPARTO: una sola función pura, en
   * `group-transfer.ts`, ejecutable en las pruebas. Vivía aquí, suelta entre
   * ternarios, y así fue como se coló un bloqueo que nadie podía ver: la
   * puerta exigía `amountComplete` —«los decimales están terminados»— cuando
   * lo que hacía falta era «hay un importe». Escribir `10` enseña `10,00 €`
   * porque la cifra se pinta con los céntimos completados, así que el botón
   * se quedaba apagado con un importe perfectamente válido delante.
   *
   * EL ORDEN DEL REPARTO ES EL DE LA LISTA, no el de los toques: `chosen` se
   * deriva filtrando el orden del servidor, que es el mismo con el que él
   * reparte.
   */
  const submission = transferSubmission(entry, currency.scale, chosen.length);
  const { totalMinor: total, shares } = submission;

  const sending = writer.sending;
  const blocked = submission.blocker !== null || sending;

  const hint =
    submission.blocker === 'too-small'
      ? t('group.transferTooSmall')
      : submission.blocker === 'recipients'
        ? t('group.transferPickSome')
        : null;

  const send = () => {
    if (blocked || total === null) return;
    setNotice(null);
    const trimmed = concept.trim();
    /*
     * SE MANDA EL TOTAL Y LOS IDS, no las cuotas: el reparto autoritativo es
     * del servidor, y mandar el calculado aquí sería pedirle que confiara en
     * una aritmética que no ha hecho él.
     */
    void writer
      .record(
        scopeId,
        total.toString(),
        chosen.map((one) => one.participantId),
        trimmed === '' ? null : trimmed,
        { date: today, time: now },
      )
      .then((result) => {
        if (result.ok) {
          onRecorded();
          return;
        }
        /*
         * TODO O NADA: si falla, no se escribió ni una fila, así que no hay
         * nada que deshacer ni nada parcial que contar. Cada motivo con su
         * frase; el transporte caído, con la suya.
         */
        setNotice(
          result.status === 0
            ? t('group.transferOffline')
            : result.code === 'CURRENCY_CONVERSION_UNSUPPORTED'
              ? t('group.transferCurrencyMismatch')
              : result.code === 'TRANSFER_AMOUNT_TOO_SMALL'
                ? t('group.transferTooSmall')
                : t('group.transferFailed'),
        );
      });
  };
  const zero = format.number(0, {
    minimumFractionDigits: currency.scale,
    maximumFractionDigits: currency.scale,
  });
  const cut = zero.search(/[^0-9]/);

  return (
    <AmountSheet
      header={header}
      fields={
        <View style={styles.fields}>
          <GlassSurface
            material="control"
            level="regular"
            depth="well"
            rim="soft"
            radius={Radius.full}
            nativeEffect={false}
            style={styles.conceptBox}>
            <TextInput
              value={concept}
              onChangeText={setConcept}
              placeholder={t('transfer.conceptPlaceholder')}
              placeholderTextColor={theme.textDisabled}
              accessibilityLabel={t('transfer.conceptLabel')}
              style={[styles.conceptInput, { color: theme.text }]}
            />
          </GlassSurface>

          <ThemedText variant="label" themeColor="textSecondary">
            {t('group.transferRecipients')}
          </ThemedText>

          {choices === null ? (
            failed ? (
              <EmptyState
                symbol={Symbols.warning}
                title={t('group.transferPickFailed')}
                description={t('group.transferPickFailedHint')}
              />
            ) : (
              <LoadingState label={t('group.transferPickLoading')} />
            )
          ) : choices.length === 0 ? (
            /*
             * NI UNA PALABRA SOBRE POR QUÉ. Puede no haber nadie porque los
             * demás no tienen cuenta, porque sus Modos Personales van en otra
             * moneda o porque el grupo es sólo tuyo; decir cuál de las tres
             * sería contar algo de esas personas.
             */
            <EmptyState
              symbol={Symbols.transfer}
              title={t('group.transferPickEmpty')}
              description={t('group.transferPickEmptyHint')}
            />
          ) : (
            <GlassSurface level="regular" depth="flat" radius={Radius.lg} style={styles.card}>
              <View style={styles.rows}>
                {choices.map((one) => {
                  const at = chosen.findIndex((x) => x.participantId === one.participantId);
                  const share = at === -1 || shares === null ? null : shares[at];
                  return (
                    <View key={one.participantId} style={styles.row}>
                      <ParticipantTick
                        checked={at !== -1}
                        label={t(at !== -1 ? 'group.splitExclude' : 'group.splitInclude', {
                          name: one.displayName,
                        })}
                        onPress={() => {
                          setNotice(null);
                          setSelected((previous) =>
                            previous.includes(one.participantId)
                              ? previous.filter((id) => id !== one.participantId)
                              : [...previous, one.participantId],
                          );
                        }}
                      />
                      <View style={styles.name}>
                        <ThemedText
                          variant="body"
                          themeColor={at !== -1 ? 'text' : 'textTertiary'}
                          numberOfLines={1}>
                          {one.displayName}
                        </ThemedText>
                      </View>
                      {share === null ? null : (
                        <ThemedText variant="bodyStrong" numberOfLines={1}>
                          {format.money(moneyFromMinorString(share.toString(), currency))}
                        </ThemedText>
                      )}
                    </View>
                  );
                })}
              </View>
            </GlassSurface>
          )}

          {/*
           * QUÉ LE HARÁ A CADA RELACIÓN, una línea por persona. Con uno solo
           * es la vista previa de siempre; con varios, la misma frase repetida
           * y precedida del nombre, que es lo único que hace falta añadir.
           */}
          {shares === null
            ? null
            : chosen.map((one, index) => (
                <View key={one.participantId} style={styles.preview}>
                  {chosen.length === 1 ? null : (
                    <ThemedText variant="caption" themeColor="textTertiary">
                      {one.displayName}
                    </ThemedText>
                  )}
                  <GroupTransferPreview
                    netMinor={one.netMinor}
                    amountMinor={(shares[index] ?? 0n).toString()}
                    currency={currency}
                    receiverName={one.displayName}
                  />
                </View>
              ))}

          {notice === null ? null : (
            <ThemedText variant="bodySmall" themeColor="negative" accessibilityLiveRegion="polite">
              {notice}
            </ThemedText>
          )}

          {/*
           * QUÉ VA A PASAR AL PULSAR, sin rodeos: se registra ya. No hay
           * «se enviará como propuesta» porque no hay propuesta, y quien
           * recibe no tiene que hacer nada.
           */}
          {chosen.length === 0 ? null : (
            <ThemedText variant="caption" themeColor="textTertiary">
              {t('group.transferImmediate', { count: chosen.length })}
            </ThemedText>
          )}
        </View>
      }
      entry={entry}
      onChangeEntry={setEntry}
      amountLabel={t('entry.amountLabel')}
      currency={{ code: currency.code, scale: currency.scale }}
      currencySymbol={currencySymbol(format.locale, currency.code, currency.scale)}
      decimalSeparator={cut === -1 ? '' : zero.slice(cut, cut + 1)}
      currencyLabel={t('entry.currencyLabel', { code: currency.code })}
      /*
       * SIN `currencyOptions`: el control es un rótulo, no un desplegable. La
       * moneda de esta operación es la base del GRUPO, que el servidor deriva
       * y el payload no lleva.
       */
      currencyNote={t('group.transferCurrencyFixed')}
      hint={hint}
      error={null}
      saveLabel={t('group.transferRecord')}
      saveDisabled={blocked}
      saving={sending}
      onSave={send}
    />
  );
}

const styles = StyleSheet.create({
  fields: { gap: Spacing.sm },
  conceptBox: { height: 56, justifyContent: 'center', paddingHorizontal: Spacing.lg },
  conceptInput: { fontSize: 16 },
  card: { padding: Spacing.md },
  rows: { gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { flex: 1, minWidth: 0 },
  preview: { gap: Spacing.xxs },
});
