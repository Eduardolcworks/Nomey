import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * Todo script de `scripts/` está registrado en Git como ejecutable.
 *
 * **Por qué hace falta un test para algo tan pequeño.** El bit de ejecución no
 * es una preferencia de estilo: CI ejecuta cuatro de estos scripts como
 * `run: ./scripts/<nombre>.sh`, y uno registrado como `100644` aborta con
 * `Permission denied` y código 126 sin haber llegado a arrancar. Ha pasado dos
 * veces. La primera fue peor que la segunda: el paso canalizaba a través de un
 * grupo de llaves sin `pipefail`, el prólogo moría, `psql` leía EOF y **el paso
 * se reportaba en verde habiendo comprobado nada**.
 *
 * **Por qué se consulta el ÍNDICE DE GIT y no el sistema de ficheros.** Es la
 * parte que hace útil el test, y sin ella no detectaría nada:
 *
 * - Este repositorio tiene `core.fileMode = false`, así que Git **ignora** el
 *   modo del disco y conserva el que tuviera el fichero al añadirse. Un
 *   `chmod +x` del sistema de ficheros no llega al índice, y por tanto no llega
 *   a CI.
 * - Git Bash sobre NTFS reporta **todos** los ficheros como `-rwxr-xr-x`. Un
 *   `fs.statSync(...).mode` o un `test -x` dirían «ejecutable» sobre un fichero
 *   commiteado como `644`.
 *
 * Con lo cual: el disco miente en Windows y Git no lo mira de todas formas. El
 * único dato autoritativo —y el único que viaja al runner— es el que guarda el
 * índice, y es el que se lee aquí. Eso hace además que el test dé el mismo
 * resultado en Windows y en Linux, que es justo lo que se le pide.
 *
 * **Regla sin excepciones, y comprobado que es honesta.** Los seis scripts
 * llevan `#!/usr/bin/env bash` y se invocan directamente —desde CI, desde
 * `docs/runbooks/local-setup.md`, o a mano—. **Ninguno se usa con `source` ni
 * con `.`**, así que no hay ningún caso legítimo de script no ejecutable que
 * exigir `100755` estropee. Si algún día se añade uno pensado solo para
 * incluirse, la excepción se documenta aquí explícitamente en vez de relajar la
 * regla en silencio.
 *
 * El arreglo, cuando esto falle, **no** es `chmod`:
 *
 * ```bash
 * git update-index --chmod=+x scripts/<nombre>.sh
 * ```
 */

const EXECUTABLE = '100755';

/** Lo que Git tiene registrado, que es lo único que llega al runner. */
function gitIndexModes(): { path: string; mode: string }[] {
  const output = execFileSync('git', ['ls-files', '--stage', '--', 'scripts/*.sh'], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
  });

  return output
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [mode] = line.split(' ');
      const path = line.slice(line.indexOf('\t') + 1);
      return { mode, path };
    });
}

describe('modo de los scripts versionados', () => {
  const entries = gitIndexModes();

  /*
   * Sin esto el test se volvería vacío en silencio el día que la ruta cambie o
   * `git` no esté disponible, que es exactamente el modo de fallo contra el que
   * existe: una comprobación que no comprueba nada y pasa igual.
   */
  it('encuentra los scripts en el índice de Git', () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.path.endsWith('.sh'))).toBe(true);
  });

  it.each(entries)('$path está registrado como ejecutable', ({ path, mode }) => {
    expect(
      mode,
      `${path} está en el índice como ${mode}. CI lo ejecuta como ./${path} y fallaría ` +
        `con "Permission denied" (126). Arréglalo con:\n` +
        `  git update-index --chmod=+x ${path}\n` +
        `Un chmod del sistema de ficheros NO sirve: core.fileMode es false.`,
    ).toBe(EXECUTABLE);
  });
});
