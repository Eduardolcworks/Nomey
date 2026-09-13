import { useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';

import type { CategoryRow } from '@/lib/categories';
import { useTranslation } from '@/lib/i18n';
import type { SessionStatus } from '@/lib/offline';
import { SheetWindow } from '@/ui/components';

import { EmojiPicker } from './emoji-picker';
import { DEFAULT_GROUP_EMOJI, type GroupDraft, normaliseName, ownerName } from './group-draft';
import { GroupForm } from './group-form';
import { useUpdateGroup } from './use-update-group';
import type { CurrencyOption } from './group-service';
import { useCreateGroup } from './use-create-group';
import { useEmojiRecents } from './use-emoji-recents';

/**
 * LA VENTANA DE CREAR GRUPO, con el selector de emojis FUERA de ella.
 *
 * **Y ésa es la razón de que esta pieza exista.** El selector estuvo dentro del
 * formulario, y el formulario vive dentro del panel de `SheetWindow`, que mide
 * lo que mide su contenido y recorta con `overflow: 'hidden'`. Un panel
 * absoluto de media pantalla dentro de una caja más baja **sale con altura
 * negativa**: medido en el emulador, el buscador quedaba con `h = -73` y no se
 * podía enfocar. Un teclado no cabe dentro del campo que rellena.
 *
 * Aquí los dos son hermanos sobre el lienzo de la ruta: la ventana se queda
 * donde estaba, y el selector sube desde el borde inferior de la PANTALLA, por
 * encima de todo, como haría el teclado del sistema.
 *
 * **El emoji vive aquí**, que es el ancestro común de los dos: el botón lo
 * enseña y el selector lo cambia. Todo lo demás del borrador se queda en el
 * formulario, que es quien lo usa.
 */
export type GroupWindowProps = {
  /** El nombre del perfil, o `null` si la cuenta no tiene ninguno. */
  readonly displayName: string | null;
  /** La cuenta, para aislar los emojis recientes. */
  readonly actorId: string;
  /**
   * La divisa del Modo Personal YA RESUELTA, o `null` mientras no se sepa.
   *
   * Con código y escala, para que crear un grupo no dependa de tener red: el
   * catálogo sólo hace falta para elegir OTRA divisa.
   */
  readonly personalCurrency: CurrencyOption | null;
  /** El estado de la sesión, para que la cola sepa de quién es lo que escribe. */
  readonly sessionStatus: SessionStatus;
  /** Se llama cuando la ventana ya ha bajado del todo. */
  readonly onClosed: () => void;
  /**
   * Qué hacer con el grupo recién escrito, con su identidad definitiva.
   *
   * Se llama **después** de que la escritura durable haya quedado demostrada y
   * **antes** de que la ventana empiece a bajar, para que la lista de Grupos ya
   * tenga la tarjeta cuando la ventana termine de caer.
   */
  readonly onCreated?: (groupId: string) => void;
  /**
   * MODO EDICIÓN. La misma ventana sobre un grupo que ya existe.
   *
   * Lo que se precarga es lo que hay en el servidor —nombre, emoji, divisa
   * real, participantes con su identidad— más el testigo del CAS. Guardar va
   * DIRECTO a `api.update_group_profile` (no a la cola: F07/ADR-001 no se extendió
   * a ediciones) y cierra sólo cuando el servidor ha confirmado.
   *
   * `updatedAt` en `null` es un grupo cuya creación aún no ha vuelto: el
   * formulario lo dice y apaga la acción, en vez de fingir un guardado local.
   */
  readonly edit?: {
    readonly scopeId: string;
    readonly name: string;
    readonly emoji: string;
    readonly currency: CurrencyOption;
    readonly existing: readonly { id: string; name: string; self: boolean; inactive: boolean }[];
    readonly updatedAt: string | null;
    readonly defaultCategoryId: string | null;
  };
  /** Las categorías utilizables en un gasto compartido, del catálogo del actor. */
  readonly categories: readonly CategoryRow[];
  /** Tras guardar una edición con éxito, antes de que la ventana baje. */
  readonly onEdited?: (groupId: string) => void;
};

/**
 * ATRÁS SALE POR LA MISMA PUERTA QUE LA `X`.
 *
 * Sin esto el sistema deshace UNA ruta: la ventana desaparece sin bajar y
 * debajo asoma el selector, que es justo el paso intermedio que sobra. Con la
 * salida de la ventana, el panel cae y al terminar, `onClosed` deshace la pila
 * entera de una vez.
 *
 * **Es una pieza aparte porque el cierre llega como argumento del render de
 * `SheetWindow`.** Guardarlo en una ref durante ese render es escribir una ref
 * mientras se renderiza; recibiéndolo como `prop`, la ref se actualiza en un
 * efecto, que es donde se puede.
 *
 * **El selector de emojis gana cuando está abierto**, porque se monta después
 * y su suscripción es la más reciente: ese Atrás cierra sólo los emojis y el
 * siguiente ya llega aquí.
 */
function CloseOnBack({ close }: { readonly close: () => void }) {
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      latest.current();
      return true;
    });
    return () => subscription.remove();
  }, []);

  return null;
}

/** El motivo de un fallo, dicho en el idioma de quien mira. */
const FAILURE_KEYS = {
  noSession: 'groups.saveFailedSession',
  noCurrency: 'groups.saveFailedCurrency',
  invalidDraft: 'groups.incomplete',
  invalidPayload: 'groups.saveFailed',
  storeUnavailable: 'groups.saveFailed',
} as const;

/** Los motivos de la edición, que vienen de la frontera y no del disco. */
const UPDATE_FAILURE_KEYS = {
  offline: 'groups.editOffline',
  conflict: 'groups.editConflict',
  notMember: 'groups.editNotMember',
  rejected: 'groups.editRejected',
} as const;

export function GroupWindow({
  displayName,
  actorId,
  personalCurrency,
  sessionStatus,
  onClosed,
  onCreated,
  edit,
  onEdited,
  categories,
}: GroupWindowProps) {
  const { t } = useTranslation();
  const { recents, remember } = useEmojiRecents(actorId);
  const { create, failure, saving } = useCreateGroup(actorId, sessionStatus);
  const update = useUpdateGroup();

  const [emoji, setEmoji] = useState(edit?.emoji ?? DEFAULT_GROUP_EMOJI);
  const [picking, setPicking] = useState(false);

  const editing = edit !== undefined;
  const shownFailure = editing
    ? update.failure === null
      ? null
      : t(UPDATE_FAILURE_KEYS[update.failure])
    : failure === null
      ? null
      : t(FAILURE_KEYS[failure]);

  return (
    <>
      <SheetWindow
        title={editing ? t('groups.editTitle') : t('groups.createTitle')}
        closeLabel={t('action.close')}
        onClosed={onClosed}>
        {(close) => (
          <>
            {/* Atrás sale por la misma puerta que la `X`. */}
            <CloseOnBack close={close} />
            <GroupForm
              displayName={displayName}
              personalCurrency={personalCurrency}
              emoji={emoji}
              onPickEmoji={() => {
                setPicking(true);
              }}
              saving={editing ? update.saving : saving}
              failure={shownFailure}
              edit={
                edit === undefined
                  ? undefined
                  : {
                      name: edit.name,
                      currency: edit.currency,
                      existing: edit.existing,
                      pending: edit.updatedAt === null,
                      defaultCategoryId: edit.defaultCategoryId,
                    }
              }
              categories={categories}
              onSubmit={async (draft: GroupDraft, currency: CurrencyOption) => {
                if (edit !== undefined) {
                  /*
                   * EDICIÓN: directo a la frontera, con el testigo que se leyó.
                   * Sólo viajan los participantes NUEVOS con nombre: los fijos
                   * conservan identidad y presencia, y el hueco final vacío no
                   * es un participante.
                   */
                  if (edit.updatedAt === null) return false;
                  const added = draft.participants
                    .filter((row) => row.fixed !== true && normaliseName(row.name) !== '')
                    .map((row) => ({
                      client_participant_id: row.id,
                      display_name: normaliseName(row.name),
                    }));
                  const ok = await update.save({
                    command_contract_version: 1,
                    scope_id: edit.scopeId,
                    display_name: normaliseName(draft.name),
                    emoji: draft.emoji,
                    default_category_id: draft.defaultCategoryId,
                    expected_updated_at: edit.updatedAt,
                    participants: added,
                  });
                  if (!ok) return false;
                  onEdited?.(edit.scopeId);
                  close();
                  return true;
                }
                /*
                 * **La ventana se cierra AQUÍ, y sólo con una identidad.** Es lo
                 * único que demuestra que la clave y el payload están en disco;
                 * sin ella, el formulario se queda abierto con todos sus datos y
                 * el motivo aparece debajo de la acción.
                 */
                const groupId = await create(
                  draft,
                  // El nombre del creador, ya canonicalizado. Sin perfil no hay
                  // participante que nombrar, y `create` lo rechaza por borrador.
                  ownerName(displayName) ?? '',
                  {
                    definitionId: currency.id,
                    code: currency.code,
                    scale: currency.scale,
                  },
                );
                if (groupId === null) return false;

                onCreated?.(groupId);
                close();
                return true;
              }}
            />
          </>
        )}
      </SheetWindow>

      {/*
       * Montado sólo mientras está abierto: así empieza limpio cada vez y su
       * suscripción al botón Atrás es la última, que es lo que le hace ganar
       * sobre la de la ventana.
       */}
      {picking ? (
        <EmojiPicker
          recents={recents}
          onSelect={(chosen) => {
            setEmoji(chosen);
            remember(chosen);
            setPicking(false);
          }}
          onClose={() => {
            setPicking(false);
          }}
        />
      ) : null}
    </>
  );
}
