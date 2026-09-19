import { describe, expect, it } from 'vitest';

import MIGRATION from '../../supabase/migrations/20260920120000_merge_invariants.sql?raw';
import CHECK from '../../supabase/checks/merge-invariants.sql?raw';
import CI from '../../.github/workflows/ci.yml?raw';
import ADR from '../../docs/adr/F10/ADR-004-identity-scope-closure.md?raw';

/**
 * LOS DOS CIERRES QUE F10/ADR-004 ASIGNÓ A C0: lo estructural. Lo que ocurre
 * de verdad —retirar/saldar a un origen fusionado rehusado sin escribir; una
 * cadena rehusada en catálogo escriba quien escriba; la suma cero intacta— lo
 * mide `merge-invariants.sql` contra las funciones reales.
 */

const sql = (text: string) => text.replace(/--.*$/gm, '');

describe('retirar a un origen fusionado (regresión medida en B0)', () => {
  it('la guarda vive en el núcleo que comparten retirar y «Saldado», con el código de los writers', () => {
    expect(sql(MIGRATION)).toContain('create or replace function sec.retire_participant_core(');
    const core = sql(MIGRATION).slice(
      sql(MIGRATION).indexOf('create or replace function sec.retire_participant_core('),
      sql(MIGRATION).indexOf('create function sec.participant_merge_one_hop()'),
    );
    expect(core).toContain(
      'if exists (select 1 from core.participant_merge m where m.source_participant_id = p_target) then',
    );
    expect(core).toContain("'PARTICIPANT_MERGED'");
    // Antes de leer pares, de reclamar la clave y de escribir nada.
    expect(core.indexOf("'PARTICIPANT_MERGED'")).toBeLessThan(core.indexOf('sec.pending_debt('));
    expect(core.indexOf("'PARTICIPANT_MERGED'")).toBeLessThan(core.indexOf('sec.begin_command('));
  });
});

describe('una fusión es de un salto (invariante de F10/ADR-004 §5)', () => {
  it('lo impone el catálogo con un trigger de fila, definer, en insert y update', () => {
    expect(sql(MIGRATION)).toContain('create function sec.participant_merge_one_hop()');
    expect(sql(MIGRATION)).toContain('returns trigger');
    expect(sql(MIGRATION)).toContain('security definer');
    expect(sql(MIGRATION)).toContain(
      'create trigger participant_merge_un_salto\n  before insert or update on core.participant_merge\n  for each row execute function sec.participant_merge_one_hop();',
    );
    // Las tres reglas: origen que es destino, destino que es origen, reapuntado.
    expect(sql(MIGRATION)).toContain(
      'select 1 from core.participant_merge m where m.target_participant_id = new.source_participant_id',
    );
    expect(sql(MIGRATION)).toContain(
      'select 1 from core.participant_merge m where m.source_participant_id = new.target_participant_id',
    );
    expect(sql(MIGRATION)).toContain('new.source_participant_id <> old.source_participant_id');
    expect(sql(MIGRATION)).toContain('new.target_participant_id <> old.target_participant_id');
  });

  it('el check cubre lo pedido y CI lo ejecuta', () => {
    for (const marker of [
      'B2: retirar a un origen fusionado',
      'B3: «Saldado» a un origen fusionado',
      'B4: quedo una retirada escrita',
      'B7: retirar a un fantasma normal dejo de funcionar',
      // A → B válida, también dos orígenes sobre un destino
      'C1: un segundo origen sobre el mismo destino se rehuso',
      // B → C, C → A, reapuntado, y la suma cero
      'D1: el catalogo dejo pasar B → C',
      'D2: el catalogo dejo pasar C → A',
      'D4: una fusion se reapunto',
      'D6: los saldos cambiaron o no suman cero',
      'D7: el trigger rehuso una fusion de un salto valida',
    ]) {
      expect(CHECK).toContain(marker);
    }
    expect(CHECK.trim().endsWith('rollback;')).toBe(true);
    expect(CI).toContain('supabase/checks/merge-invariants.sql');
    // El ADR que lo pidió sigue diciendo qué debía cerrar C0.
    expect(ADR).toMatch(/un origen\s+nunca es destino, un destino nunca es origen/);
    expect(ADR).toContain('`PARTICIPANT_MERGED`');
  });
});
