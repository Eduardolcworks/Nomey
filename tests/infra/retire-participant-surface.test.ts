import { describe, expect, it } from 'vitest';

import SCREEN from '../../src/app/group/[id].tsx?raw';
import ROW from '../../src/features/groups/group-balance-row.tsx?raw';
import JOIN from '../../src/features/groups/join-panel.tsx?raw';
import HOOKS from '../../src/features/groups/use-membership.ts?raw';
import SERVICE from '../../src/features/groups/membership-service.ts?raw';
import BUTTON from '../../src/ui/components/action-button.tsx?raw';
import MENU_IOS from '../../src/ui/components/action-menu.ios.tsx?raw';
import MENU from '../../src/ui/components/action-menu.tsx?raw';
import CI from '../../.github/workflows/ci.yml?raw';
import CHECK from '../../supabase/checks/retire-participant.sql?raw';
import RACE from '../../scripts/retire-claim-race.sh?raw';
import MIGRATION from '../../supabase/migrations/20260912140000_retire_participant.sql?raw';

/**
 * RETIRAR A UN PARTICIPANTE SIN CUENTA, «¿ERES [NOMBRE]?» Y EL «SALDADO» EN LA
 * FILA. Lo estructural; lo que sólo la base demuestra —pares, CAS, vínculo bajo
 * bloqueo, reintento, historial— lo miden `retire-participant.sql` y, con dos
 * sesiones reales, `scripts/retire-claim-race.sh`.
 */

const sql = (text: string) => text.replace(/--.*$/gm, '');

describe('el servidor', () => {
  it('es una ampliación EXPLÍCITA de F09/ADR-003 §6, sobre el mismo núcleo que «Saldado»', () => {
    expect(MIGRATION).toContain('AMPLIA ese');
    expect(MIGRATION).toContain('create function sec.retire_participant_core(');
    expect(MIGRATION).toContain('create or replace function api.settle_participant(payload jsonb)');
    expect(MIGRATION).toContain('create function api.retire_participant(payload jsonb)');
    // Las dos puertas delegan en el mismo núcleo.
    expect(sql(MIGRATION).match(/return sec\.retire_participant_core\(/g)).toHaveLength(2);
    // «Saldado» conserva su guardia; retirar tiene la suya.
    expect(sql(MIGRATION)).toContain("'PARTICIPANT_ACTIVE'");
    expect(sql(MIGRATION)).toContain("'PARTICIPANT_LINKED'");
  });

  it('comprueba sin cuenta BAJO BLOQUEO, y reclamar toma el mismo cerrojo', () => {
    expect(sql(MIGRATION)).toContain('create function sec.lock_participant_claims(p_scope uuid)');
    expect(sql(MIGRATION)).toContain('pg_advisory_xact_lock(hashtextextended(p_scope::text, 0))');
    expect(sql(MIGRATION).match(/perform sec\.lock_participant_claims\(/g)).toHaveLength(2);
    const retire = sql(MIGRATION).slice(
      sql(MIGRATION).indexOf('create function api.retire_participant('),
    );
    expect(retire.indexOf('lock_participant_claims')).toBeLessThan(
      retire.indexOf('from core.participant_user_link l where l.participant_id = v_target'),
    );
    // Sin borrado físico: se cierra la presencia HOY y se retira.
    expect(retire).toContain('set valid_until = current_date');
    expect(sql(MIGRATION)).not.toMatch(/delete from core\.participant\b/);
  });

  it('el writer sólo puede CERRAR presencias, con su idioma de membresía', () => {
    expect(MIGRATION).toContain(
      'grant update (valid_until) on core.participant_period to nomey_writer;',
    );
    expect(MIGRATION).toContain('with check (valid_until is not null');
    expect(MIGRATION).toContain('m.user_id = sec.request_actor_id()');
    expect(MIGRATION).toContain('revoke create on schema api from nomey_writer;');
  });

  it('el check y la carrera cubren lo pedido, y CI los ejecuta', () => {
    for (const marker of [
      'B1b sin historial no queda un retiro sin operacion',
      'B2d Marta sigue reclamable',
      'B3 un gasto nuevo admitio a la retirada',
      'B4 el reintento no fue replay',
      'C2c los efectos de Luis se borraron',
      'D0 el neto de Sol no es 0',
      'D1 «Eliminar» sin pares cancelo deudas en silencio',
      'D2c la retirada movio caja',
      'E2 se retiro por esta via a quien salio con vinculo',
      'F1 un ajeno retiro',
    ]) {
      expect(CHECK).toContain(marker);
    }
    expect(CHECK.trim().endsWith('rollback;')).toBe(true);
    expect(RACE).toContain('PARTICIPANT_ALREADY_CLAIMED');
    expect(RACE).toContain('PARTICIPANT_LINKED');
    expect(RACE).toContain('exigir_base_local');
    expect(CI).toContain('supabase/checks/retire-participant.sql');
    expect(CI).toContain('bash scripts/retire-claim-race.sh');
  });
});

describe('el cliente', () => {
  it('retirar y «Saldado» son la misma retirada con dos puertas; `linked` es el fallo propio', () => {
    expect(SERVICE).toContain("supabase.rpc('retire_participant'");
    expect(HOOKS).toContain('return useRetirement(sendRetireParticipant);');
    expect(HOOKS).toContain('return useRetirement(sendSettleParticipant);');
    expect(HOOKS).toContain("? 'linked'");
  });

  it('el menú al tocar sólo sobre sin cuenta y activo; la palabra la decide el historial', () => {
    expect(SCREEN).toContain('linkedOf.get(balance.participantId) === false &&');
    expect(SCREEN).toMatch(/=== false &&\s*!inactive &&/);
    expect(SCREEN).toContain("? 'group.retireParticipant'");
    expect(SCREEN).toContain(": 'group.removeParticipant'");
    // La confirmación detalla los pares y dice cómo se resuelven; nada se cancela solo.
    expect(SCREEN).toContain("t('group.retirePairsBody')");
    expect(SCREEN).toContain("void retirement.settle({ scopeId: id ?? '', participantId, pairs })");
    expect(SCREEN).toContain("if (outcome === 'linked')");
    // «Me equivoqué» (F09/ADR-006) vive en la fila PROPIA con procedencia: nunca en la de otro.
    expect(SCREEN).toMatch(
      /: balance\.isSelf &&\s*typeof claimOf\.get\(balance\.participantId\) === 'string'/,
    );
  });

  it('el menú nativo se abre al TOCAR, con acciones y rol destructivo, en los dos sistemas', () => {
    expect(MENU_IOS).toContain('<Menu');
    expect(MENU_IOS).toContain("role={action.destructive === true ? 'destructive' : 'default'}");
    expect(MENU).toContain('<MenuView');
    expect(MENU).not.toContain('shouldOpenOnLongPress');
    expect(ROW).toContain('<ActionMenu actions={menu} onSelect={onMenuSelect}>');
  });

  it('«Saldado» va en la fila, compacto, a la izquierda de la cifra, y la cifra no cede', () => {
    expect(ROW).toContain('size="compact"');
    expect(ROW).toContain('tone="brand"');
    expect(ROW).not.toContain('styles.settle');
    // Orden en la fila: identidad · Saldado · cifra.
    const row = ROW.slice(ROW.indexOf('<View style={[styles.row'));
    expect(row.indexOf('identity')).toBeLessThan(row.indexOf('size="compact"'));
    expect(row.indexOf('size="compact"')).toBeLessThan(row.indexOf('styles.amounts'));
    expect(ROW).toMatch(/amounts: \{[\s\S]*flexShrink: 0/);
    expect(ROW).toMatch(/identity: \{[\s\S]*flex: 1,\s*minWidth: 0/);
    // El compacto: 32 visibles, 44 tocables, mismos materiales.
    expect(BUTTON).toContain('const COMPACT_HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 };');
    expect(BUTTON).toMatch(/compact: \{\s*minHeight: 32,/);
    expect(BUTTON).toContain(
      "themeColor={disabled ? 'textDisabled' : brand ? 'onAccent' : 'text'}",
    );
  });

  it('«¿Eres [nombre]?» antes de reclamar, con «Volver» y «Sí, soy [nombre]»', () => {
    expect(JOIN).toContain("t('groups.claimAskTitle', { name: one.displayName })");
    expect(JOIN).toContain("{ text: t('groups.claimBack'), style: 'cancel' }");
    expect(JOIN).toContain("text: t('groups.claimYes', { name: one.displayName })");
    // Reclamar sólo tras confirmar.
    expect(JOIN).toMatch(/claimYes[\s\S]*onPress: \(\) => \{\s*onClaim\(one\.participantId\);/);
  });
});
