import { describe, expect, it } from 'vitest';

/**
 * LA ACTIVACIÓN DE LA COLA EN F7.D, comprobada sobre el fuente.
 *
 * Lo que aquí se afirma no se puede afirmar montando nada en Vitest —son
 * decisiones de composición y de cableado— y sin embargo son las que ADR-028
 * hace obligatorias: una sola ruta de alta, un solo worker en la raíz, un solo
 * listener de `AppState`, y ninguna maquinaria visible en la fila.
 */

const SOURCES = import.meta.glob('../../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function source(relative: string): string {
  const found = SOURCES[`../../${relative}`];
  expect(found, `falta ${relative}`).toBeDefined();
  return found as string;
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

const files = () =>
  Object.entries(SOURCES).map(([path, text]) => ({
    path: path.replace('../../', ''),
    code: stripComments(text as string),
  }));

describe('el alta sale por la cola y por ninguna otra puerta', () => {
  const SERVICE = stripComments(source('src/features/personal/personal-service.ts'));

  it('`recordPersonal*` sólo aceptan una corrección, en compilación y en ejecución', () => {
    expect(SERVICE).toContain('recordPersonalExpense(payload: CorrectionPayload)');
    expect(SERVICE).toContain('recordPersonalIncome(payload: CorrectionPayload)');
    expect(SERVICE).toContain("assertCorrection(payload, 'record_personal_expense')");
    expect(SERVICE).toContain("assertCorrection(payload, 'record_personal_income')");
    expect(SERVICE).toContain('class DirectCreationRefused');
  });

  it('el formulario de alta encola: no importa el writer directo', () => {
    const FORM = stripComments(source('src/features/personal/movement-form.tsx'));
    expect(FORM).not.toContain('useRecordMovement');
    expect(FORM).not.toContain('recordPersonal');
    expect(FORM).toContain('queue.enqueue(draft.draft, scope, resolving)');
    // Y se cierra SÓLO si quedó persistida.
    expect(FORM).toMatch(/if \(ok\) onSaved\(\)/);
  });

  it('el editor de corrección sigue por su ruta CAS, con `target` obligatorio', () => {
    const HOOK = stripComments(source('src/features/personal/use-record-movement.ts'));
    expect(HOOK).toContain('async (draft: EntryDraft, target: EntryTarget)');
    expect(HOOK).toContain('isCorrection(payload)');
    expect(source('src/features/personal/movement-editor.tsx')).toContain('useRecordMovement');
  });

  it('`sendPersonalEntry` tiene UN consumidor: el transporte de la cola', () => {
    const callers = files().filter(
      (file) =>
        file.code.includes('sendPersonalEntry') &&
        !file.path.endsWith('personal-service.ts') &&
        !file.path.endsWith('queue-transport.ts'),
    );
    expect(callers.map((file) => file.path)).toEqual(['src/features/personal/queue-runtime.ts']);
  });

  it('la persistencia va ANTES de publicar, publicar antes de cerrar, y despertar después', () => {
    const QUEUE = stripComments(source('src/features/personal/use-entry-queue.ts'));
    const persist = QUEUE.indexOf('await persistEntry(');
    const publish = QUEUE.indexOf('publishQueueChange({');
    const wake = QUEUE.indexOf('coordinator.wake()');
    const close = QUEUE.indexOf('return true;');
    expect(persist).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(persist);
    expect(wake).toBeGreaterThan(publish);
    expect(close).toBeGreaterThan(wake);
    // Y el despertar es una macrotarea: llega cuando la hoja ya se está cerrando.
    expect(QUEUE).toMatch(/setTimeout\(\(\) => \{\s*coordinator\.wake\(\);\s*\}, 0\)/);
  });
});

describe('un worker, en la raíz, con el listener de AppState que ya existía', () => {
  const LAYOUT = stripComments(source('src/app/_layout.tsx'));

  it('la raíz monta el runtime una vez y cablea el primer plano por el seam de F5', () => {
    expect(LAYOUT).toContain('<SessionProvider onForeground={wakeEntryQueue}>');
    expect(LAYOUT).toContain('useEntryQueueRuntime(');
    expect(LAYOUT.match(/useEntryQueueRuntime\(/g)).toHaveLength(1);
  });

  it('nadie más monta el runtime ni añade otro listener de AppState', () => {
    const runtimes = files().filter(
      (file) =>
        file.code.includes('useEntryQueueRuntime(') && !file.path.endsWith('queue-runtime.ts'),
    );
    expect(runtimes.map((file) => file.path)).toEqual(['src/app/_layout.tsx']);

    const listeners = files().filter((file) => file.code.includes('AppState.addEventListener'));
    expect(listeners.map((file) => file.path)).toEqual([
      'src/features/session/session-provider.tsx',
    ]);
  });

  it('la hoja de alta no crea ni detiene el worker', () => {
    const QUEUE = stripComments(source('src/features/personal/use-entry-queue.ts'));
    expect(QUEUE).not.toContain('coordinator.stop()');
    expect(QUEUE).not.toContain('connectivity.subscribe');
  });
});

describe('la maquinaria no se ve', () => {
  it('la fila no distingue una pendiente: ni etiqueta, ni contador, ni acción propia', () => {
    const ROW = stripComments(source('src/features/personal/movement-row.tsx'));
    expect(ROW).not.toContain('client_operation_id');
    expect(ROW).not.toContain('render_key');
    expect(ROW).not.toMatch(/pending|pendiente|sync|sincroniz/i);
  });

  it('Inicio no pasa a la fila ningún dato de cola', () => {
    const HOME = stripComments(source('src/app/(tabs)/index.tsx'));
    expect(HOME).not.toMatch(/<MovementRow[^>]*(pending|queued|local)=/s);
    // La clave de render sí: es lo que impide el remonte al confirmar (§9).
    expect(HOME).toContain('key={operation.render_key}');
  });

  it('los textos de espera existen para los DOS bloqueos de §10, y para nada más', () => {
    const HOME = stripComments(source('src/app/(tabs)/index.tsx'));
    expect(HOME).toContain("t('home.adjustBlockedTitle')");
    expect(HOME).toContain("t('home.rowBlockedTitle')");
    expect(HOME).toContain('projected.unreconciled > 0');
    expect(HOME).toContain('if (!isReconciled(operation))');
  });
});

describe('ninguna cifra proyectada alimenta una escritura', () => {
  it('Fijar el Disponible manda el saldo CONFIRMADO, no el proyectado', () => {
    const HOME = stripComments(source('src/app/(tabs)/index.tsx'));
    expect(HOME).toContain("params: { current: home.balance?.amount ?? '' }");
    expect(HOME).not.toContain('current: projected.balance');
  });

  it('los hooks de escritura no conocen la proyección', () => {
    for (const path of [
      'src/features/personal/use-adjust-balance.ts',
      'src/features/personal/use-annul-movement.ts',
      'src/features/personal/use-record-movement.ts',
      'src/features/personal/entry-enqueue.ts',
      'src/features/personal/queue-transport.ts',
    ]) {
      const code = stripComments(source(path));
      expect(code, path).not.toContain('projectHome');
      expect(code, path).not.toContain('useProjectedHome');
      expect(code, path).not.toContain('projected');
    }
  });

  it('la proyección deriva con las funciones de dominio, sin `number` en el dinero', () => {
    const PROJECTION = stripComments(source('src/features/personal/projection.ts'));
    for (const fn of [
      'derivePersonalExpense',
      'derivePersonalIncome',
      'deriveBalance',
      'deriveEconomicTotal',
      'sumMoney',
    ]) {
      expect(PROJECTION).toContain(fn);
    }
    expect(PROJECTION).not.toMatch(/Number\(|parseFloat|parseInt|toFixed/);
  });
});
