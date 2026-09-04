import { describe, expect, it } from 'vitest';

import AGENTS from '../../AGENTS.md?raw';
import CI from '../../.github/workflows/ci.yml?raw';
import ANDROID_CHECK from '../../scripts/android-project-check.mjs?raw';
import DERIVE from '../../scripts/derive-brand-assets.ps1?raw';
import ICON_CHECK from '../../scripts/icon-geometry-check.mjs?raw';
import RUNBOOK from '../../docs/runbooks/android-build.md?raw';

/**
 * Las carpetas nativas son artefactos, y el runbook no puede decir otra cosa.
 *
 * **Por qué hace falta un test para un documento.** El modo de fallo de ADR-030
 * no es que alguien reescriba el ADR: es que un runbook, con toda la buena
 * intención, escriba «y luego edita el `AndroidManifest.xml`». Esa frase
 * funciona, se copia, y sobrevive exactamente hasta el siguiente
 * `prebuild --clean` — que la borra sin avisar y deja el conocimiento en una
 * sola máquina. Lo que se comprueba aquí es que el camino documentado sigue
 * siendo regenerar, no retocar.
 *
 * Lo que NO se comprueba aquí es el proyecto generado, porque `android/` no
 * está versionado y en CI no existe. De eso se ocupa
 * `scripts/android-project-check.mjs` en la máquina que acaba de generarlo, y
 * lo que este fichero vigila es que ese script siga preguntando lo que dice
 * preguntar.
 */

describe('el runbook de Android no documenta la edición manual', () => {
  it('revisa de verdad lo que dice revisar', () => {
    expect(RUNBOOK.length).toBeGreaterThan(2000);
    expect(RUNBOOK).toContain('prebuild --platform android --clean');
  });

  it('dice que las carpetas nativas no se editan a mano', () => {
    expect(RUNBOOK).toMatch(/no se editan a mano jamás/i);
    expect(RUNBOOK).toContain('ADR-030');
  });

  it('y manda el cambio a la configuración, no al proyecto generado', () => {
    expect(RUNBOOK).toContain('`app.config.ts` o un config plugin local');
  });

  it('nombra la variante en cada generación, en vez de dejarla implícita', () => {
    // `expo prebuild` a secas resolvería el defecto, que hoy es development;
    // documentarlo así dejaría la identidad implícita, que es lo que ADR-031
    // §2 evita.
    expect(RUNBOOK).toContain('node scripts/with-variant.mjs development prebuild');
    expect(RUNBOOK).not.toMatch(/^\s*npx expo prebuild/m);
  });

  it('AGENTS.md sigue prohibiendo editarlas', () => {
    expect(AGENTS).toContain('Edit `/ios` or `/android`');
    expect(AGENTS).toContain('generated artefacts');
  });
});

describe('el runbook es reproducible en otra máquina', () => {
  it('no lleva ninguna ruta absoluta de una máquina concreta', () => {
    // Una ruta con letra de unidad o con un perfil de usuario dentro convierte
    // el documento en las notas de una persona.
    expect(RUNBOOK).not.toMatch(/[A-Za-z]:\\/);
    expect(RUNBOOK).not.toMatch(/C:\//);
    expect(RUNBOOK).not.toMatch(/Users\\[^<]/);
    expect(RUNBOOK).not.toMatch(/\/home\/[a-z]/i);
  });

  it('usa marcadores para lo que cambia de una máquina a otra', () => {
    expect(RUNBOOK).toContain('<LOCALAPPDATA>');
    expect(RUNBOOK).toContain('Sustituye `<LOCALAPPDATA>`');
  });

  it('y no lleva ninguna credencial ni dirección de red', () => {
    expect(RUNBOOK).not.toMatch(/sb_publishable_[A-Za-z0-9_-]{8,}/);
    expect(RUNBOOK).not.toMatch(/sb_secret_[A-Za-z0-9_-]{8,}/);
    // Ninguna IP salvo las documentales; la LAN de nadie entra aquí.
    expect(RUNBOOK).not.toMatch(/\b(?:10|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });
});

describe('la inspección del proyecto generado sigue preguntando lo que importa', () => {
  it('exige la identidad de Development, y sólo ésa', () => {
    expect(ANDROID_CHECK).toContain("applicationId: 'es.lcworks.nomey.dev'");
    expect(ANDROID_CHECK).toContain("name: 'Nomey Dev'");
    expect(ANDROID_CHECK).toContain("scheme: 'nomey-dev'");
  });

  it('y rechaza cualquier rastro de otra variante', () => {
    // La negación de `.dev` es lo que hace que el patrón atrape producción
    // -`es.lcworks.nomey` a secas- además de staging.
    expect(ANDROID_CHECK).toContain('/es\\.lcworks\\.nomey(?!\\.dev)/');
    expect(ANDROID_CHECK).toContain('android:scheme="nomey(-staging)?"');
  });

  it('comprueba que Development no escucha ningún canal', () => {
    expect(ANDROID_CHECK).toContain('expo.modules.updates.ENABLED" android:value="false"');
    expect(ANDROID_CHECK).toContain('expo-channel-name');
  });

  it('y que las reglas de backup de la sesión siguen aplicadas — ADR-017', () => {
    expect(ANDROID_CHECK).toContain('secure_store_backup_rules');
    expect(ANDROID_CHECK).toContain('secure_store_data_extraction_rules');
  });

  it('nunca edita el proyecto: sólo lee', () => {
    expect(ANDROID_CHECK).not.toContain('writeFileSync');
    expect(ANDROID_CHECK).not.toContain('rmSync');
  });
});

describe('el contrato del icono adaptativo', () => {
  it('el foreground se deriva a 1024, dentro de la misma zona segura', () => {
    // El cambio de 512 a 1024 es de resolución y no de geometría: `Place`
    // recibe el mismo marco y el mismo $SAFE_FRACTION.
    expect(DERIVE).toMatch(/Place\(\$markOnly, \$markBox, 1024, \$SAFE_FRACTION, 0\)/);
    expect(DERIVE).toMatch(/^\$SAFE_FRACTION = 0\.60$/m);
  });

  it('y el resto de los assets conserva su tamaño', () => {
    expect(DERIVE).toMatch(/Place\(\$markOnly, \$markBox, 1024, \$MARK_FRACTION, \$GROUND_ARGB\)/);
    expect(DERIVE).toMatch(/Place\(\$silhouette, \$markBox, 432, \$SAFE_FRACTION, 0\)/);
    expect(DERIVE).toMatch(/Place\(\$splashMark, \$splashBox, 512, 0\.92, 0\)/);
  });

  it('la comprobación de geometría exige dimensiones, formato, alfa y proporción', () => {
    expect(ICON_CHECK).toContain("file: 'assets/icons/android-icon-foreground.png'");
    expect(ICON_CHECK).toMatch(
      /width: 1024,\n {4}height: 1024,\n {4}format: 'RGBA',\n {4}alpha: true,\n {4}widthFraction: 0\.6,/,
    );
    // El icono de iOS no puede llevar alfa, y eso no es una preferencia.
    expect(ICON_CHECK).toContain("format: 'RGB',");
    expect(ICON_CHECK).toContain('alpha: false,');
  });

  it('y corre en CI, que es donde nadie se acuerda de ejecutarla', () => {
    expect(CI).toContain('node scripts/icon-geometry-check.mjs');
  });
});
