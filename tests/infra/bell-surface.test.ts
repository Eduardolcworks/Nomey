import { describe, expect, it } from 'vitest';

import TABS from '../../src/app/(tabs)/_layout.tsx?raw';
import BELL from '../../src/app/notifications.tsx?raw';
import EVENTS from '../../src/features/groups/group-events.ts?raw';
import NOTICE from '../../src/features/groups/group-notice-card.tsx?raw';
import SERVICE from '../../src/features/groups/membership-service.ts?raw';
import HOOKS from '../../src/features/groups/use-membership.ts?raw';
import SEEN from '../../src/features/personal/incident-seen.ts?raw';
import INCIDENTS from '../../src/features/personal/use-incidents.ts?raw';
import CI from '../../.github/workflows/ci.yml?raw';
import CHECK from '../../supabase/checks/group-notices-seen.sql?raw';
import MIGRATION from '../../supabase/migrations/20260912100000_group_notices_seen.sql?raw';

/**
 * EL PUNTO DE LA CAMPANA: «hay algo que no has visto», y entrar lo apaga.
 *
 * El contrato, en una línea: el punto = incidencias no vistas + avisos sin
 * leer; entrar en la campana da por visto lo que había al entrar, y nada de
 * lo que llegue después. Lo estructural se fija aquí; lo que sólo la base
 * puede demostrar —frontera, antiguos fuera de página, carrera, aislamiento—
 * lo mide `supabase/checks/group-notices-seen.sql`, y lo local, por actor,
 * `tests/lib/incident-seen.test.ts`.
 */

describe('el indicador', () => {
  it('se enciende por lo NO VISTO, no por lo no resuelto', () => {
    // Desde F12.C una tercera fuente, y ésta sí es «pendiente»: una propuesta
    // de transferencia entrante no tiene marca de visto en el servidor, y lo
    // que pide es respuesta. Se apaga al contestarla.
    expect(TABS).toContain(
      'const bell = incidents.unseen > 0 || notices.unread > 0 || proposals.incoming.length > 0;',
    );
    expect(TABS).toContain('<AppTopBar alerts={bell} />');
    expect(TABS).not.toContain('incidents.unresolved > 0');
    // Visto y resuelto son dos cosas: la incidencia sigue con sus botones.
    expect(INCIDENTS).toContain('readonly unseen: number;');
    expect(INCIDENTS).toContain('readonly unresolved: number;');
    expect(INCIDENTS).toContain('unseen: unseenIncidents(visible, seen).length');
  });
});

describe('entrar en la campana', () => {
  it('marca una vez por fuente, y sólo cuando la fuente se mostró bien', () => {
    expect(BELL).toContain('const marked = useRef({ notices: false, incidents: false });');
    expect(BELL).toContain('if (fresh === null && !notices.loading && !notices.failed) {');
    expect(BELL).toContain('if (fresh === null || marked.current.notices) return;');
    expect(BELL).toContain('if (marked.current.incidents || !ready) return;');
    expect(BELL).toContain('void markSeen(incidents.map((one) => one.clientOperationId));');
    // Y abrir un aviso ya no es necesario: sólo lo intenta si aquello falló.
    expect(BELL).toContain(
      'if (notice !== undefined && notice.readAt === null) void notices.markRead(id);',
    );
  });

  it('no borra avisos ni resuelve incidencias, y lo nuevo se sigue viendo como nuevo', () => {
    expect(BELL).not.toMatch(/dismiss\(\)|\.remove\(|delete/);
    expect(BELL).toContain('fresh={fresh?.has(notice.id) ?? false}');
    expect(NOTICE).toContain('const unread = fresh || notice.readAt === null;');
  });

  it('los avisos: frontera = el más reciente cargado, sin optimismo, y todas las listas releen', () => {
    expect(HOOKS).toContain('const newest = notices[0];');
    expect(HOOKS).toContain('markGroupNoticesSeen(newest.id)');
    expect(HOOKS).toContain('if (response === null || !response.ok) return false;');
    expect(HOOKS).toContain('publishNoticesSeen();');
    expect(HOOKS).toContain('subscribeNoticesSeen(() => {');
    expect(HOOKS).toContain('readonly failed: boolean;');
    expect(SERVICE).toContain("supabase.rpc('mark_group_notices_seen'");
    expect(EVENTS).toContain('export function publishNoticesSeen(): void {');
    // El fallo de lectura se dice, no se esconde tras una lista vacía.
    expect(HOOKS).toContain('if (live) setFailed(true);');
  });

  it('las incidencias: un conjunto de claves por actor, en el documento opaco, y todas las listas releen', () => {
    expect(SEEN).toContain("export const INCIDENT_SEEN_KEY = 'incident.seen';");
    expect(SEEN).toContain('cache.write(actorId, INCIDENT_SEEN_KEY, serializeSeen(seen), now)');
    expect(INCIDENTS).toContain('readSeen(await offlineCatalogueCache(), actorId)');
    expect(INCIDENTS).toContain('publishIncidentsSeen(actorId);');
    expect(INCIDENTS).toContain('if (seenActor !== actorId) return;');
    // Sin escritura, sin punto apagado.
    expect(INCIDENTS).toContain(
      '// Nothing written: the dot stays on, and the next visit tries again.',
    );
  });
});

describe('el servidor', () => {
  it('marca hasta la frontera del propio actor, en sus grupos, sin borrar y sin re-marcar', () => {
    expect(MIGRATION).toContain('create function api.mark_group_notices_seen(p_newest uuid)');
    expect(MIGRATION).toContain('and n.recipient_user_id = (select auth.uid())');
    expect(MIGRATION).toContain('and n.read_at is null');
    expect(MIGRATION).toContain('and n.occurred_at <= (select occurred_at from cutoff)');
    expect(MIGRATION).toContain('and sec.is_member(n.scope_id)');
    expect(MIGRATION).not.toMatch(/delete from/);
    expect(MIGRATION).toContain(
      'revoke execute on function api.mark_group_notices_seen(uuid) from public;',
    );
  });

  it('y el check lo mide: antiguos fuera de página, carrera, aislamiento, conservación', () => {
    expect(CHECK).toContain('B3 el aviso antiguo sigue pendiente');
    expect(CHECK).toContain('C2 el aviso posterior se dio por visto por la carrera');
    expect(CHECK).toContain('D1 Ana marco %s con una frontera ajena');
    expect(CHECK).toContain('D4 Ana marco %s en un grupo del que salio');
    expect(CHECK).toContain('E2 un aviso ya leido se re-marco');
    expect(CHECK.trim().endsWith('rollback;')).toBe(true);
    expect(CI).toContain('supabase/checks/group-notices-seen.sql');
  });
});
