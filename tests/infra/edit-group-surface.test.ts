import { describe, expect, it } from 'vitest';

import ROUTE from '../../src/app/edit-group.tsx?raw';
import LIST from '../../src/app/(tabs)/groups.tsx?raw';
import LAYOUT from '../../src/app/_layout.tsx?raw';
import WINDOW from '../../src/features/groups/group-window.tsx?raw';
import FORM from '../../src/features/groups/group-form.tsx?raw';
import HOOK from '../../src/features/groups/use-update-group.ts?raw';
import SERVICE from '../../src/features/groups/group-service.ts?raw';
import CURRENCY from '../../src/features/groups/currency-field.tsx?raw';
import PARTICIPANTS from '../../src/features/groups/use-group-participants.ts?raw';
import GROUPS from '../../src/features/groups/use-groups.ts?raw';
import MENU_IOS from '../../src/ui/components/long-press-menu.ios.tsx?raw';
import MENU_ANDROID from '../../src/ui/components/long-press-menu.tsx?raw';
import MIGRATION from '../../supabase/migrations/20260910130000_update_group_profile.sql?raw';

/**
 * MODIFICAR UN GRUPO, Y EL MENÚ AL MANTENER PULSADO.
 *
 * Sin renderer de React, lo estructural se fija aquí; lo contable —permisos,
 * replay, CAS, altas sin retroactividad— lo mide la sección U de
 * `supabase/checks/group-provisioning.sql` contra la base real.
 */

describe('el editor es la MISMA ventana que crear, en modo edición', () => {
  it('la ruta reutiliza GroupWindow con `edit`, sin una tercera lectura', () => {
    expect(ROUTE).toContain('<GroupWindow');
    expect(ROUTE).toContain('edit={{');
    expect(ROUTE).toContain('useGroups(actorId, session.status)');
    expect(ROUTE).toContain("useGroupParticipants(id ?? '', actorId, session.status)");
    // Sin grupo resuelto no hay editor: ni vacío ni inventado.
    expect(ROUTE).toContain('if (group === null) {');
    // Y está registrada como ventana transparente, igual que crear.
    expect(LAYOUT).toContain('name="edit-group"');
  });

  it('precarga lo que hay en el servidor: nombre, emoji, divisa REAL, participantes y testigo', () => {
    expect(ROUTE).toContain('name: group.displayName');
    expect(ROUTE).toContain('emoji: group.emoji');
    expect(ROUTE).toContain('id: group.currencyDefinitionId');
    expect(ROUTE).toContain('id: one.participantId');
    expect(ROUTE).toContain('updatedAt: group.updatedAt');
    expect(WINDOW).toContain('useState(edit?.emoji ?? DEFAULT_GROUP_EMOJI)');
    expect(FORM).toContain("useState(edit?.name ?? '')");
  });

  it('la divisa se ve bloqueada: sin galón, más oscura, y deshabilitada para quien escucha', () => {
    const bloqueada = CURRENCY.slice(
      CURRENCY.indexOf('if (locked && selected !== null)'),
      CURRENCY.indexOf('return (\n    <View style={styles.column}>'),
    );
    expect(bloqueada).toContain('accessibilityState={{ disabled: true }}');
    expect(bloqueada).toContain("accessibilityHint={t('groups.currencyLocked')}");
    expect(bloqueada).toContain('level="bar"');
    expect(bloqueada).toContain('Symbols.lock');
    expect(bloqueada).not.toContain('Symbols.expand');
    expect(bloqueada).not.toContain('<Pressable');
    // Y el contrato del servidor ni siquiera la acepta: se rechaza por forma.
    expect(MIGRATION).not.toMatch(/c_allowed[^\]]*currency_definition_id/);
  });

  it('los participantes existentes van FIJOS y sólo viajan las altas', () => {
    expect(FORM).toContain('fixed: true,');
    expect(FORM).toContain('if (row.owner || row.fixed === true) {');
    const envio = WINDOW.slice(
      WINDOW.indexOf('if (edit !== undefined) {'),
      WINDOW.indexOf('onEdited?.('),
    );
    expect(envio).toContain("row.fixed !== true && normaliseName(row.name) !== ''");
    expect(envio).toContain('expected_updated_at: edit.updatedAt');
    // Ni la identidad ni la moneda viajan como dato editable.
    expect(SERVICE).not.toMatch(/GroupUpdatePayload = \{[^}]*currency_definition_id/s);
  });

  it('un grupo sin confirmar no se edita, y se dice', () => {
    expect(FORM).toContain('edit?.pending !== true');
    expect(FORM).toContain("t('groups.editPending')");
    expect(WINDOW).toContain('if (edit.updatedAt === null) return false;');
  });

  it('el botón dice «Guardar cambios» con el tratamiento de CTA existente', () => {
    expect(FORM).toContain(
      "label={edit === undefined ? t('groups.createTitle') : t('groups.saveChanges')}",
    );
    expect(FORM).toContain("tone={enabled ? 'brand' : 'primary'}");
  });
});

describe('guardar: directo a la frontera, una clave por intención', () => {
  it('no pasa por la cola durable', () => {
    expect(HOOK).not.toContain('queueStore');
    expect(HOOK).not.toContain('enqueue');
    expect(SERVICE).toContain("supabase.rpc('update_group_profile'");
  });

  it('la clave se conserva mientras la intención no cambia, y cambia con ella', () => {
    expect(HOOK).toContain('const fingerprint = JSON.stringify(intent);');
    expect(HOOK).toContain('key.current.fingerprint !== fingerprint');
    expect(HOOK).toContain('key.current = { fingerprint, id: newClientOperationId() };');
    // Tras el éxito se suelta: la siguiente edición es otra intención.
    expect(HOOK).toContain('key.current = null;');
  });

  it('el conflicto concurrente se reconoce y se explica, no se pisa', () => {
    expect(HOOK).toContain("if (code === 'PROFILE_CONFLICT') return 'conflict';");
    expect(WINDOW).toContain("conflict: 'groups.editConflict'");
    // El servidor compara bajo bloqueo de fila y con un instante distinto por guardado.
    expect(MIGRATION).toContain('for update;');
    expect(MIGRATION).toContain('updated_at   = clock_timestamp()');
    expect(MIGRATION).toContain("'PROFILE_CONFLICT'");
  });

  it('las altas abren su presencia HOY y no tocan gastos anteriores', () => {
    expect(MIGRATION).toContain(
      "values ((v_item ->> 'client_participant_id')::uuid, current_date, null);",
    );
    // Historial y aviso en la misma transacción, antes del cambio.
    expect(MIGRATION.indexOf('insert into core.group_profile_change')).toBeLessThan(
      MIGRATION.indexOf('update core.group_profile'),
    );
    expect(MIGRATION).toContain('insert into core.group_profile_notice');
  });

  it('tras guardar se publica en el bus que ya existía, y los lectores están suscritos', () => {
    expect(ROUTE).toContain('publishGroupRecorded(scopeId);');
    expect(GROUPS).toContain('subscribeGroupRecorded(');
    expect(PARTICIPANTS).toContain('subscribeGroupRecorded(');
  });
});

describe('el menú contextual de la tarjeta', () => {
  it('es el del sistema en las dos plataformas, sin menú flotante propio', () => {
    expect(MENU_IOS).toContain("from '@expo/ui/swift-ui'");
    expect(MENU_IOS).toContain('<ContextMenu>');
    expect(MENU_IOS).toContain("role={action.destructive === true ? 'destructive' : 'default'}");
    expect(MENU_ANDROID).toContain('shouldOpenOnLongPress');
    expect(MENU_ANDROID).toContain('destructive: true');
  });

  it('la tarjeta conserva su toque; el menú lleva las tres acciones', () => {
    expect(LIST).toContain('<LongPressMenu');
    expect(LIST).toContain("id: 'expense', title: t('groups.menuAddExpense'), icon: Symbols.add");
    expect(LIST).toContain("id: 'edit', title: t('groups.menuEdit'), icon: Symbols.edit");
    expect(LIST).toContain("id: 'leave',");
    expect(LIST).toContain('destructive: true,');
    expect(LIST).toMatch(/pathname: '\/group-expense',\s*params: \{ groupId: group\.scopeId \}/);
    expect(LIST).toContain("pathname: '/edit-group', params: { id: group.scopeId }");
    // El toque normal sigue abriendo el grupo.
    expect(LIST).toContain("pathname: '/group/[id]', params: { id: group.scopeId }");
  });

  /**
   * F09/ADR-003: no hay eliminación. «Salir del grupo» se confirma con las cuatro
   * cosas que pasan, y ninguna función de borrado existe en el cliente.
   */
  it('salir sustituye a eliminar: con confirmación y sin borrar nada', () => {
    expect(LIST).toContain("t('groups.leaveTitle', { name: displayName })");
    expect(LIST).toContain("t('groups.leaveBody')");
    expect(LIST).toContain('leaving.leave(scopeId)');
    expect(LIST).not.toContain('delete_group');
    expect(LIST).not.toContain('deleteUnavailable');
    expect(SERVICE).not.toContain('delete_group');
    // Un grupo sin confirmar no ofrece acciones sobre el servidor.
    expect(LIST).toMatch(/group\.pending\s*\?\s*\[\]/);
  });
});

/**
 * EL EDITOR RECUPERA LA PREESTABLECIDA GUARDADA. El defecto era de instante:
 * la ruta montaba el editor sobre la proyección LOCAL de un grupo ya
 * confirmado —sin preferencia y sin testigo— mientras el servidor viajaba.
 */
describe('la preestablecida al reabrir el editor', () => {
  it('la ruta no monta el editor sobre la proyección local mientras la lectura viaja', () => {
    expect(ROUTE).toContain('if (loading && group.pending) return null;');
    expect(ROUTE).toContain('defaultCategoryId: group.defaultCategoryId');
  });

  it('el formulario adopta el perfil que llega después, salvo elección manual, en render', () => {
    expect(FORM).toContain('const decision = presetToAdopt({');
    expect(FORM).toContain('if (decision.adopt) setDefaultCategoryId(decision.value);');
    expect(FORM).toContain('setPresetTouched(true);');
    expect(FORM).not.toMatch(/useEffect\([^)]*setDefaultCategoryId/s);
  });

  it('cargando, no disponible y «Todas» son tres estados, y ninguno se convierte en otro', () => {
    expect(FORM).toContain('const shown = presetDisplay(');
    expect(FORM).toContain("t('groups.presetLoading')");
    expect(FORM).toContain("t('groups.presetUnavailable')");
    expect(FORM).toContain("t('groups.presetAll')");
    // Guardar se apaga sólo por «no disponible», nunca por «cargando».
    expect(FORM).toContain("const presetUnusable = shown.kind === 'unavailable';");
    expect(FORM).toMatch(/const enabled =[\s\S]*!presetUnusable;/);
  });

  it('guardar envía la preferencia del borrador tal cual: la guardada, la nueva, o null por «Todas»', () => {
    expect(WINDOW).toContain('default_category_id: draft.defaultCategoryId,');
  });
});
