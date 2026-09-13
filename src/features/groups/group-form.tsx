import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { newClientOperationId } from '@/lib/id';
import { useTranslation } from '@/lib/i18n';
import {
  ActionButton,
  GlassSurface,
  Icon,
  MenuPill,
  OptionMenu,
  PILL_HEIGHT,
  ThemedText,
} from '@/ui/components';
import {
  type CategoryRow,
  categoryName,
  categoryOptions,
  sharedCategories,
} from '@/lib/categories';
import { Radius, Spacing, Symbols, useTheme } from '@/ui/theme';

import { CurrencyField } from './currency-field';
import {
  type GroupDraft,
  isDraftComplete,
  isTrailingBlank,
  normaliseName,
  ownerName,
  type ParticipantIssue,
  type ParticipantRow,
  participantIssues,
  presetDisplay,
  presetToAdopt,
  withTrailingBlank,
} from './group-draft';
import type { CurrencyOption } from './group-service';
import { useCurrencies } from './use-currencies';

/** El identificador de «Todas» en el menú. No es una categoría: es su ausencia. */
const PRESET_ALL = 'all';

/**
 * EL FORMULARIO DE CREAR GRUPO, y su acción real.
 *
 * **La acción de abajo no llama a `api.create_group`.** Entrega el borrador a
 * quien contiene el formulario, que lo congela y lo escribe en la cola durable
 * ANTES de cualquier petición (F07/ADR-001 §1). Esto no sabe nada de red, y por eso
 * funciona igual sin ella.
 *
 * **Y no se cierra por su cuenta.** Cerrar es de quien recibió el borrador, y
 * sólo si la escritura local quedó demostrada: si falla, la ventana sigue
 * abierta con todos los datos donde estaban y el motivo se dice aquí abajo.
 *
 * **El disco del emoji ya NO es la pieza de los emblemas de la hoja.** Era un
 * `GlassSurface` de nivel `action` —el cristal ámbar de la marca— y ahora lleva
 * el material neutro de control, el mismo par que el oblongo del nombre que
 * tiene al lado. El amarillo de esta ventana es uno solo y está abajo, en la
 * acción que crea el grupo; ver el motivo en cada sitio.
 */
export type GroupFormProps = {
  /** El nombre del perfil, o `null` si la cuenta no tiene ninguno. */
  readonly displayName: string | null;
  /**
   * La divisa del Modo Personal YA RESUELTA, o `null` mientras no se sepa.
   *
   * `null` NO es «euros»: es «todavía no se sabe», y el apartado lo dice en vez
   * de preseleccionar una moneda que nadie ha elegido.
   *
   * **Con su código y su escala, no sólo su id.** Es lo que hace que crear un
   * grupo funcione SIN RED: el ámbito personal está cacheado con las tres cosas,
   * y el catálogo —que sólo llega por red— hace falta únicamente para elegir OTRA
   * divisa. Con un id suelto, sin conexión no había ni código ni escala que
   * congelar, y la acción se quedaba apagada; medido en el emulador con Kong y
   * PostgREST parados.
   */
  readonly personalCurrency: CurrencyOption | null;
  /**
   * El emoji elegido y cómo pedir otro.
   *
   * Viven en `GroupWindow`, que es el ancestro común del botón y del selector.
   * El selector NO puede montarse aquí dentro: el panel de la ventana recorta,
   * y un teclado dentro del campo que rellena sale con altura negativa.
   */
  readonly emoji: string;
  readonly onPickEmoji: () => void;
  /**
   * Congela el borrador y lo escribe en disco. `true` si quedó escrito.
   *
   * La divisa viaja RESUELTA —id, código y escala—, no como un id suelto: la
   * escala pertenece a la definición monetaria y nadie debe presuponer dos
   * decimales (F02/ADR-001 §3).
   */
  readonly onSubmit: (draft: GroupDraft, currency: CurrencyOption) => Promise<boolean>;
  /** Mientras se congela y se guarda. Es lo que apaga la segunda pulsación. */
  readonly saving: boolean;
  /** El aviso que hay que decir, ya traducido, o `null`. */
  readonly failure: string | null;
  /**
   * MODO EDICIÓN: el mismo formulario sobre un grupo que ya existe.
   *
   * Lo que cambia: el nombre viene precargado, la divisa es la REAL del grupo y
   * queda bloqueada, los participantes existentes se enseñan fijos y sólo se
   * pueden AÑADIR nuevos, y la acción dice «Guardar cambios». Lo que no cambia:
   * la validación, el hueco final, el foco entre filas y la pieza entera.
   *
   * `pending` es un grupo cuya creación aún no ha vuelto del servidor: no hay
   * fila autoritativa que editar ni testigo que declarar, así que se dice y la
   * acción se apaga en vez de fingir que un cambio local quedó guardado.
   */
  readonly edit?: {
    readonly name: string;
    readonly currency: CurrencyOption;
    readonly existing: readonly {
      id: string;
      name: string;
      self: boolean;
      /** Salió del grupo: se lista como «Inactivo». Los retirados no llegan aquí. */
      inactive: boolean;
    }[];
    readonly pending: boolean;
    /** La preferencia guardada, o `null` («Todas»). */
    readonly defaultCategoryId: string | null;
  };
  /**
   * LAS CATEGORÍAS QUE UN GASTO COMPARTIDO PUEDE LLEVAR —de sistema y activas—,
   * traídas por la ruta del MISMO catálogo que usa el gasto. El formulario no
   * conoce otro catálogo ni inventa colores: elige entre estas o «Todas».
   */
  readonly categories: readonly CategoryRow[];
};

export function GroupForm({
  displayName,
  personalCurrency,
  emoji,
  onPickEmoji,
  onSubmit,
  saving,
  failure,
  edit,
  categories,
}: GroupFormProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const [name, setName] = useState(edit?.name ?? '');
  /*
   * LA CATEGORÍA PREESTABLECIDA. `null` es «Todas». En edición arranca en la
   * guardada, aunque ya no sea utilizable: no se sustituye a escondidas por
   * otra —se enseña como no disponible y se apaga la acción hasta que la
   * persona elija una válida o «Todas»—.
   */
  const [defaultCategoryId, setDefaultCategoryId] = useState<string | null>(
    edit?.defaultCategoryId ?? null,
  );
  /*
   * ═══════ LA GUARDADA SE RECUPERA AUNQUE EL PERFIL LLEGUE DESPUÉS ═══════
   *
   * El estado se siembra al montar; si el perfil autoritativo llega en un
   * render posterior con OTRA preferencia guardada, se adopta — salvo que la
   * persona ya haya tocado el selector, porque una elección manual manda.
   * Ajustado durante el render, como la siembra del gasto: sin efecto que
   * escriba estado y sin fotograma con «Todas» sobre una guardada.
   *
   * `incoming` recuerda el último valor recibido para reaccionar sólo a
   * CAMBIOS del perfil, no a cada render.
   */
  const [presetTouched, setPresetTouched] = useState(false);
  const [incoming, setIncoming] = useState<string | null>(edit?.defaultCategoryId ?? null);
  if (edit !== undefined && edit.defaultCategoryId !== incoming) {
    const decision = presetToAdopt({
      incoming: edit.defaultCategoryId,
      lastIncoming: incoming,
      touched: presetTouched,
    });
    setIncoming(edit.defaultCategoryId);
    if (decision.adopt) setDefaultCategoryId(decision.value);
  }
  const usable = useMemo(() => sharedCategories(categories), [categories]);
  const shown = presetDisplay(
    defaultCategoryId,
    usable.map((row) => row.id),
  );
  const presetRow = usable.find((row) => row.id === defaultCategoryId);
  const presetUnusable = shown.kind === 'unavailable';
  const presetLoading = shown.kind === 'loading';
  /* La divisa que se ha elegido a mano, ya resuelta. `null` = la del Personal. */
  const [chosenCurrency, setChosenCurrency] = useState<CurrencyOption | null>(null);

  /*
   * IDENTIDADES ESTABLES, NUNCA EL ÍNDICE — Y UN UUID, no un contador.
   *
   * Dos cosas a la vez, y son la misma. Como identidad de render: con el índice,
   * quitar una fila de en medio desplaza a las de abajo y React reutiliza el
   * texto, el error y el foco de una fila en otra. Y como identidad de
   * PARTICIPANTE: es exactamente el `client_participant_id` que se congela en el
   * comando, así que tiene que ser un UUID —la cola rechaza por forma cualquier
   * otra cosa— y tiene que nacer con la fila, no en el momento de guardar.
   *
   * Un contador local (`p1`, `p2`) valía para lo primero y **no** para lo
   * segundo. Medido en el emulador: el comando se rechazaba por forma antes de
   * llegar al disco y la ventana se quedaba abierta diciendo que no se pudo
   * guardar — que es el comportamiento correcto ante un payload inválido, con la
   * causa equivocada.
   */
  const nextId = () => newClientOperationId();

  /*
   * LAS FILAS AÑADIDAS, CON SU HUECO FINAL YA DENTRO.
   *
   * No hay acción de «añadir»: el hueco existe desde el principio y escribir en
   * él hace aparecer el siguiente. La regla entera vive en `withTrailingBlank`,
   * que es pura y se comprueba aparte; aquí sólo se aplica en cada edición.
   *
   * Inicializador perezoso: la identidad del primer hueco se genera UNA vez, al
   * montar, y no en cada render — que es lo que la hace estable.
   */
  const [extras, setExtras] = useState<readonly ParticipantRow[]>(() => [
    { id: newClientOperationId(), name: '', owner: false },
  ]);

  /*
   * Un `TextInput` por identidad, para poder mover el foco al pulsar
   * «Siguiente». Guardados por `id` y no por posición, por lo mismo de arriba.
   */
  const fields = useRef(new Map<string, TextInput | null>());

  /*
   * LA FILA DEL CREADOR NO ES ESTADO: se deriva del perfil.
   *
   * Guardarla en `useState` la habría congelado con el nombre que hubiera al
   * montar, y el perfil llega por su cuenta. Derivarla también es lo que la hace
   * imborrable sin necesidad de una guarda: no hay ninguna acción que la toque.
   */
  const owner = ownerName(displayName);
  const participants = useMemo<readonly ParticipantRow[]>(
    () =>
      edit === undefined
        ? [{ id: 'owner', name: owner ?? '', owner: true }, ...extras]
        : /*
           * En edición los existentes vienen del SERVIDOR con su identidad y
           * su nombre, y van fijos: no se recrean al guardar. El propio actor
           * lleva su «(Tú)» por el vínculo que `api.group_participant` publica.
           */
          [
            ...edit.existing.map((one) => ({
              id: one.id,
              name: one.name,
              owner: one.self,
              fixed: true,
              inactive: one.inactive,
            })),
            ...extras,
          ],
    [owner, extras, edit],
  );

  /*
   * LA DIVISA EFECTIVA, resuelta: la elegida, o la del Modo Personal mientras
   * nadie elija. Las dos pueden ser `null`, y entonces no hay divisa que enseñar
   * — que es distinto de enseñar una por defecto.
   */
  const currency = edit?.currency ?? chosenCurrency ?? personalCurrency;

  /*
   * EL CATÁLOGO SE PIDE AQUÍ, y sólo sirve para ELEGIR OTRA.
   *
   * No para saber cuál hay: ésa llega resuelta desde el Modo Personal, con su
   * código y su escala, y cacheada. Presuponer una escala es justo lo que
   * F02/ADR-001 §3 prohíbe, y depender del catálogo para conocerla habría atado la
   * creación de un grupo a tener red.
   */
  /* En edición no se pide el catálogo: la divisa no se puede cambiar. */
  const currencies = useCurrencies(currency !== null && edit === undefined);

  const draft: GroupDraft = {
    emoji,
    name,
    currencyId: currency?.id ?? null,
    participants,
    defaultCategoryId,
  };
  const issues = participantIssues(participants);
  const complete = isDraftComplete(draft);
  /** Completo Y con divisa resuelta Y sin una escritura en curso Y, en edición, con fila autoritativa. */
  const enabled =
    complete && currency !== null && !saving && edit?.pending !== true && !presetUnusable;

  const editParticipant = (id: string, value: string) => {
    setExtras((current) =>
      withTrailingBlank(
        current.map((row) => (row.id === id ? { ...row, name: value } : row)),
        nextId,
      ),
    );
  };

  const removeParticipant = (id: string) => {
    fields.current.delete(id);
    setExtras((current) =>
      withTrailingBlank(
        current.filter((row) => row.id !== id),
        nextId,
      ),
    );
  };

  /*
   * «SIGUIENTE» AVANZA SÓLO SI LA FILA VALE.
   *
   * Con un nombre vacío o repetido el foco se queda donde está y el error se
   * enciende en ESA fila: saltar dejaría atrás una fila mal puesta sin que nadie
   * la volviera a mirar. Con un nombre válido el hueco de debajo ya existe
   * —`withTrailingBlank` lo creó al escribir la primera letra—, así que avanzar
   * es enfocarlo, y el teclado no llega a cerrarse.
   */
  const advance = (index: number) => {
    if (issues[index] !== null) return;
    const siguiente = participants[index + 1];
    if (siguiente === undefined) return;
    fields.current.get(siguiente.id)?.focus();
  };

  return (
    <ScrollView
      /*
       * Desplazable porque la lista crece: el panel tiene alto máximo y sin esto
       * el participante número veinte quedaría fuera de la pieza, no debajo.
       * `keyboardShouldPersistTaps` deja tocar otro oblongo con el teclado
       * abierto sin que el primer toque se gaste en cerrarlo, que es justo lo
       * que pide poder continuar tocando en vez de pulsando «Siguiente».
       */
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.body}>
      {/* ═══ PRIMERA FILA: emoji y nombre ═══ */}
      <View style={styles.firstRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('groups.emojiChosen', { emoji })}
          accessibilityHint={t('groups.emojiLabel')}
          onPress={onPickEmoji}>
          {/*
           * ═══════════ EL DISCO DEL EMOJI YA NO ES EL DE LA ACCIÓN ═══════════
           *
           * Llevaba `level="action"`, que es el cristal ámbar de la marca: el
           * mismo del `+` del dock y del emblema de «Crear grupo» de la hoja.
           * Ahí está bien —son la acción primaria de su superficie—, pero aquí
           * no lo es: **esto no crea nada, abre un selector**, y el amarillo es
           * lo que en Nomey significa «ésta es la respuesta que continúa». Con
           * el CTA de abajo ya en amarillo, dos amarillos en la misma ventana
           * dejan de señalar cuál manda.
           *
           * Pasa a `regular` con el material neutro, que es el MISMO par que
           * usa el oblongo del nombre justo al lado —`material="control"` y
           * `level="regular"`—, así que la fila queda de una sola pieza. Sobre
           * el fondo de la ventana compone a un gris casi negro.
           *
           * **El emoji no se toca.** Sigue siendo su glifo con sus colores
           * propios: un emoji recoloreado deja de ser el que la persona eligió.
           * Y no cambia ni el tamaño, ni el radio, ni el área táctil.
           *
           * `lens="inner"` se retira con el nivel: existía sólo para filtrar
           * las capas del cristal ámbar y quitarle el halo exterior. `regular`
           * no proyecta ninguno, así que ya no hay nada que filtrar.
           */}
          <GlassSurface
            material="control"
            level="regular"
            depth="flat"
            radius={Radius.full}
            nativeEffect={false}
            style={styles.emblem}>
            <Text style={styles.emblemGlyph}>{emoji}</Text>
          </GlassSurface>
        </Pressable>

        <GlassSurface
          material="control"
          level="regular"
          depth="well"
          rim="soft"
          radius={Radius.full}
          nativeEffect={false}
          style={styles.nameBox}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t('groups.namePlaceholder')}
            placeholderTextColor={theme.textDisabled}
            accessibilityLabel={t('groups.nameLabel')}
            /*
             * SIN `maxLength`. El contrato no fija ninguno: `core.scope` no
             * tiene columna de nombre todavía, así que un tope aquí sería un
             * límite inventado que después habría que defender.
             */
            style={[styles.nameInput, { color: theme.text }]}
          />
        </GlassSurface>
      </View>

      {/* ═══ DIVISA ═══ */}
      <ThemedText variant="label" themeColor="textSecondary" style={styles.section}>
        {t('groups.currency')}
      </ThemedText>
      <CurrencyField
        selected={currency}
        state={currencies}
        locked={edit !== undefined}
        onSelect={(option: CurrencyOption) => {
          setChosenCurrency(option);
        }}
      />

      {/*
       * ═══ CATEGORÍA PREESTABLECIDA ═══
       *
       * Un oblongo con el menú del sistema: «Todas» y las categorías de sistema
       * utilizables en un gasto compartido, del mismo catálogo que el gasto.
       * «Todas» es la ausencia de preselección, no una categoría. Si la guardada
       * ya no se puede usar, el oblongo lo dice y no elige otra por su cuenta.
       */}
      <ThemedText variant="label" themeColor="textSecondary" style={styles.section}>
        {t('groups.presetCategory')}
      </ThemedText>
      <OptionMenu
        height={PILL_HEIGHT}
        title={t('groups.presetCategory')}
        options={[
          { id: PRESET_ALL, title: t('groups.presetAll'), selected: defaultCategoryId === null },
          ...categoryOptions(usable, defaultCategoryId, t),
        ]}
        onSelect={(id) => {
          /* Elección manual: el perfil que llegue después ya no la pisa. */
          setPresetTouched(true);
          setDefaultCategoryId(id === PRESET_ALL ? null : id);
        }}>
        <MenuPill
          muted={defaultCategoryId === null || presetUnusable || presetLoading}
          text={
            defaultCategoryId === null
              ? t('groups.presetAll')
              : presetLoading
                ? t('groups.presetLoading')
                : presetUnusable
                  ? t('groups.presetUnavailable')
                  : (categoryName(presetRow, t) ?? t('entry.categoryUnknown'))
          }
          label={
            defaultCategoryId === null
              ? t('groups.presetLabelAll')
              : presetLoading
                ? t('groups.presetLoading')
                : presetUnusable
                  ? t('groups.presetLabelUnavailable')
                  : t('groups.presetLabelChosen', {
                      name: categoryName(presetRow, t) ?? t('entry.categoryUnknown'),
                    })
          }
        />
      </OptionMenu>
      {presetUnusable ? (
        <ThemedText variant="caption" themeColor="negative" style={styles.footnote}>
          {t('groups.presetUnavailableHint')}
        </ThemedText>
      ) : null}

      {/* ═══ PARTICIPANTES ═══ */}
      <ThemedText variant="label" themeColor="textSecondary" style={styles.section}>
        {t('groups.participants')}
      </ThemedText>

      {participants.map((row, index) => (
        <ParticipantField
          key={row.id}
          row={row}
          position={index}
          trailing={isTrailingBlank(participants, index)}
          issue={issues[index]}
          ownerFallback={owner === null}
          register={(node) => {
            fields.current.set(row.id, node);
          }}
          onChange={(value) => {
            editParticipant(row.id, value);
          }}
          onSubmit={() => {
            advance(index);
          }}
          onRemove={() => {
            removeParticipant(row.id);
          }}
        />
      ))}

      {/*
       * LA ACCIÓN. Disponible sólo con el borrador completo y la divisa
       * RESUELTA: sin código ni escala no se puede congelar un comando, y
       * dejarla pulsable produciría un fallo donde debería haber una espera.
       *
       * `saving` la apaga mientras se congela y se guarda. No es la única
       * defensa contra la doble pulsación —la de verdad es síncrona, en
       * `useCreateGroup`— sino lo que además lo hace visible.
       */}
      {/*
       * ═══════════ EL AMARILLO LLEGA CUANDO SE PUEDE CREAR ═══════════
       *
       * **Y llega por la puerta que ya existe.** `ActionButton` es la pieza de
       * la que salió esta llamada a la acción —su propio comentario lo dice— y
       * `tone="brand"` es el único sitio del sistema por el que pasa el
       * amarillo de marca: los mismos `accent` / `accentPressed` / `onAccent`
       * que usa el guardar de la hoja, para que en la aplicación haya un
       * amarillo y no dos. Aquí se había quedado un `Pressable` a mano que
       * repetía la geometría y nunca el color.
       *
       * **El color sigue a `enabled`, y `enabled` no se ha tocado.** Es el
       * mismo predicado de antes —borrador completo y divisa RESUELTA, con su
       * código y su escala—, así que el amarillo aparece exactamente cuando la
       * creación es posible de verdad. Pintarlo antes sería prometer una acción
       * que fallaría al pulsarla, que es justo lo que no se puede hacer.
       *
       * **Deshabilitado NO es amarillo al 50 %.** `brand` apagado seguiría
       * siendo amarillo translúcido, y un CTA de marca a media tinta se lee
       * como disponible-pero-lejos. Sin requisitos vuelve a `primary`, que es
       * exactamente la superficie elevada neutra que había hasta ahora: el
       * estado deshabilitado se conserva tal cual y sólo cambia el habilitado.
       */}
      {edit?.pending === true ? (
        <ThemedText variant="caption" themeColor="textSecondary" style={styles.footnote}>
          {t('groups.editPending')}
        </ThemedText>
      ) : null}
      <ActionButton
        tone={enabled ? 'brand' : 'primary'}
        label={edit === undefined ? t('groups.createTitle') : t('groups.saveChanges')}
        hint={
          enabled
            ? edit === undefined
              ? t('groups.createHint')
              : t('groups.saveChangesHint')
            : t('groups.incomplete')
        }
        disabled={!enabled}
        busy={saving}
        onPress={() => {
          if (!enabled || currency === null) return;
          void onSubmit(draft, currency);
        }}
        style={styles.cta}
      />

      {/*
       * El motivo, cuando la escritura local no salió. **Va debajo de la acción
       * y en el flujo**, no en un aviso que se va solo: la ventana sigue
       * abierta y hay que poder leerlo tantas veces como haga falta.
       */}
      {failure === null ? (
        complete ? null : (
          <ThemedText variant="caption" themeColor="textSecondary" style={styles.footnote}>
            {t('groups.incomplete')}
          </ThemedText>
        )
      ) : (
        <ThemedText
          variant="caption"
          themeColor="negative"
          accessibilityLiveRegion="polite"
          style={styles.footnote}>
          {failure}
        </ThemedText>
      )}
    </ScrollView>
  );
}

/**
 * UNA FILA DE PARTICIPANTE. Tres, en realidad, y por eso no comparten rama.
 *
 * - **La del creador** no se edita ni se quita. No es una guarda sobre un campo
 *   editable: no hay campo, así que no existe la acción que habría que impedir.
 * - **El hueco final** no es todavía un participante: no lleva error ni control
 *   de quitar, y su nombre accesible dice que está por rellenar en vez de
 *   anunciarse como si ya hubiera alguien.
 * - **Las demás** llevan su posición, su error y su control de quitar.
 */
function ParticipantField({
  row,
  position,
  trailing,
  issue,
  ownerFallback,
  register,
  onChange,
  onSubmit,
  onRemove,
}: {
  readonly row: ParticipantRow;
  /** Cero es el creador, así que las editables empiezan a contar en uno. */
  readonly position: number;
  readonly trailing: boolean;
  readonly issue: ParticipantIssue | null;
  readonly ownerFallback: boolean;
  readonly register: (node: TextInput | null) => void;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onRemove: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  if (row.owner || row.fixed === true) {
    return (
      <View style={styles.participantRow}>
        <GlassSurface
          material="control"
          level="regular"
          depth="well"
          rim="soft"
          radius={Radius.full}
          nativeEffect={false}
          style={styles.participantBox}>
          {/*
           * Sin nombre de perfil se dice eso, NO el correo: una dirección de
           * correo como nombre de participante es justo el dato correlacionable
           * que F03/ADR-009 §1 mantiene fuera del ámbito.
           */}
          <ThemedText
            variant="body"
            themeColor={ownerFallback && row.owner ? 'textSecondary' : 'text'}
            numberOfLines={1}>
            {ownerFallback && row.owner && row.fixed !== true
              ? t('groups.participantNoName')
              : row.name}
          </ThemedText>
        </GlassSurface>
        {/* «(Tú)» sólo en la fila del propio actor: fija o no, es la suya. */}
        {row.owner ? (
          <ThemedText variant="caption" themeColor="textSecondary" style={styles.youTag}>
            {t('groups.participantYou')}
          </ThemedText>
        ) : row.inactive === true ? (
          // «Inactivo» es TEXTO (design-direction.md §8). Sigue en el grupo con
          // sus pendientes; no se reenvía ni se puede tocar desde aquí.
          <ThemedText variant="caption" themeColor="textTertiary" style={styles.youTag}>
            {t('group.participantInactive')}
          </ThemedText>
        ) : null}
      </View>
    );
  }

  /*
   * El aviso viaja con el campo, no sólo debajo: va también en su indicación
   * accesible, así que queda asociado a ESTA fila y a ninguna otra.
   */
  const etiqueta = trailing
    ? t('groups.participantNew')
    : t('groups.participantLabel', { position });
  const aviso =
    issue === null ? null : issue === 'blank' ? t('groups.nameBlank') : t('groups.nameDuplicate');

  return (
    <View style={styles.participantRow}>
      <View style={styles.participantColumn}>
        <GlassSurface
          material="control"
          level="regular"
          depth="well"
          rim="soft"
          radius={Radius.full}
          nativeEffect={false}
          style={styles.participantBox}>
          <TextInput
            ref={register}
            value={row.name}
            onChangeText={onChange}
            placeholder={trailing ? t('groups.addParticipant') : t('groups.participantPlaceholder')}
            placeholderTextColor={theme.textDisabled}
            accessibilityLabel={etiqueta}
            accessibilityHint={trailing ? undefined : (aviso ?? undefined)}
            /*
             * «Siguiente» y no «Intro»: es lo que el sistema anuncia y lo que
             * describe lo que hace — validar esta fila y bajar a la siguiente.
             * `submitBehavior="submit"` es lo que impide que Android cierre el
             * teclado antes de que el foco llegue abajo.
             */
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={onSubmit}
            autoCorrect={false}
            style={[styles.nameInput, { color: theme.text }]}
          />
        </GlassSurface>
        {/* El hueco final no lleva error: todavía no es nadie. */}
        {trailing || aviso === null ? null : (
          <ThemedText variant="caption" themeColor="negative" style={styles.issue}>
            {aviso}
          </ThemedText>
        )}
      </View>

      {/* Ni control de quitar: no hay nada que quitar en una fila por rellenar. */}
      {trailing ? (
        <View style={styles.remove} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('groups.removeParticipant', {
            name: normaliseName(row.name) === '' ? etiqueta : row.name,
          })}
          onPress={onRemove}
          style={styles.remove}>
          <Icon name={Symbols.close} size={16} colour={theme.textSecondary} shape="circle" />
        </Pressable>
      )}
    </View>
  );
}

const EMBLEM = 50;

const styles = StyleSheet.create({
  body: {
    gap: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  firstRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  emblem: {
    width: EMBLEM,
    height: EMBLEM,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emblemGlyph: {
    fontSize: 26,
    lineHeight: 32,
  },
  nameBox: {
    flex: 1,
    height: EMBLEM,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  nameInput: {
    fontSize: 16,
    padding: 0,
  },
  section: {
    paddingTop: Spacing.sm,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  participantColumn: {
    flex: 1,
    gap: Spacing.xxs,
  },
  participantBox: {
    flex: 1,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  youTag: {
    width: 44,
    textAlign: 'center',
  },
  issue: {
    paddingHorizontal: Spacing.lg,
  },
  remove: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /*
   * **Sólo la separación, no la geometría.** El alto mínimo de 48, el radio, el
   * borde y el centrado los pone `ActionButton`, que es de donde salieron; que
   * los repitiera aquí es lo que dejó que las tres llamadas a la acción del
   * proyecto empezaran a separarse en radio y relleno. Lo único que la ventana
   * decide es cuánto lo separa de lo de arriba.
   */
  cta: {
    marginTop: Spacing.sm,
  },
  footnote: {
    textAlign: 'center',
  },
});
