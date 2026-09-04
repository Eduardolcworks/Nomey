import { describe, expect, it } from 'vitest';

import GUARD from '../../scripts/local-db-guard.sh?raw';
import ISOLATION from '../../scripts/http-boundary-isolation.sh?raw';
import RUNBOOK from '../../docs/runbooks/local-setup.md?raw';

/**
 * Quien habla por la frontera comprueba antes que la frontera existe.
 *
 * **El fallo que impide.** Durante F8.A4 el stack se quedó con Postgres,
 * GoTrue y PostgREST en pie y el contenedor de Kong parado. En ese estado
 * `supabase start` sale con código 0 —los contenedores vivos le bastan para
 * darse por levantado—, `exigir_base_local` pasa —entra por `docker exec`, que
 * no toca el gateway— y `54321` no contesta a nadie. El primer síntoma llega
 * mucho después, en un `curl` cualquiera, como un `000` que no nombra a Kong.
 *
 * La guarda no es lo interesante: lo interesante es que **no se pueda añadir un
 * script que hable HTTP y se olvide de cargarla**. Por eso la regla se calcula
 * sobre lo que hay en `scripts/`, en vez de repetir una lista que envejecería
 * en silencio.
 */

const SCRIPTS = Object.entries(
  import.meta.glob('../../scripts/*.sh', { query: '?raw', import: 'default', eager: true }),
).map(([path, text]) => ({ name: path.replace('../../scripts/', ''), text: text as string }));

/**
 * Habla con la frontera local quien la llama de verdad: `curl` y el puerto.
 *
 * Las dos condiciones juntas son lo que hace honesta la regla.
 * `bundle-secrets-matrix.sh` menciona `54321` dentro de una URL ficticia sobre
 * `192.0.2.0/24` —el rango que RFC 5737 reserva para documentación— y no llama
 * a nadie; exigirle la guarda sería un falso positivo permanente.
 */
function callsTheBoundary(script: { text: string }): boolean {
  return /\bcurl\b/.test(script.text) && /54321/.test(script.text);
}

describe('las guardas del stack local', () => {
  it('revisa de verdad lo que dice revisar', () => {
    expect(SCRIPTS.length).toBeGreaterThan(5);
    expect(SCRIPTS.filter(callsTheBoundary).length).toBeGreaterThan(0);
  });

  it('el fichero compartido ofrece las dos, y son independientes', () => {
    expect(GUARD).toContain('exigir_base_local() {');
    expect(GUARD).toContain('exigir_frontera_http() {');
  });

  it('todo script que llama a la frontera la exige antes', () => {
    const olvidadizos = SCRIPTS.filter(callsTheBoundary)
      .filter((script) => !script.text.includes('exigir_frontera_http'))
      .map((script) => script.name);

    expect(olvidadizos, 'llaman a 54321 sin comprobar que hay gateway').toEqual([]);
  });

  it('y el que delega en uno de ellos también', () => {
    // No llama a `curl` ni nombra el puerto: ejecuta `http-boundary-check.sh`
    // entero. La regla estructural no puede verlo, así que se nombra aquí.
    expect(ISOLATION).toContain('exigir_frontera_http');
  });

  it('la guarda diagnostica, y no toca ningún contenedor', () => {
    /*
     * Es la parte que no puede relajarse por comodidad. Una guarda que
     * «arregla» el stack por su cuenta levantaría, pararía o reiniciaría
     * contenedores sin que nadie lo pidiera, y la primera vez que se equivocara
     * lo haría sobre el trabajo de alguien. Diagnostica y se aparta.
     */
    const cuerpo = GUARD.slice(GUARD.indexOf('exigir_frontera_http() {'));
    expect(cuerpo).not.toMatch(/docker\s+(start|stop|restart|rm|kill)/);
    expect(cuerpo).not.toMatch(/supabase-cli\.sh\s+(start|stop)/);
  });

  it('el runbook dice que un `start` con éxito no demuestra que Kong esté', () => {
    // Es el hallazgo, y sin escribirlo la guarda sólo lo esconde mejor.
    expect(RUNBOOK).toMatch(/NO demuestra que la frontera esté en pie/);
    expect(RUNBOOK).toContain('supabase_kong');
    expect(RUNBOOK).toContain('/auth/v1/health');
  });
});
