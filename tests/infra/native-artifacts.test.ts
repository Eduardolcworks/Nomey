import { describe, expect, it } from 'vitest';

import AGENTS from '../../AGENTS.md?raw';
import CI from '../../.github/workflows/ci.yml?raw';
import PACKAGE_JSON from '../../package.json?raw';
import ANDROID_CHECK from '../../scripts/android-project-check.mjs?raw';
import ANDROID_REVERSE from '../../scripts/android-reverse.mjs?raw';
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

    /*
     * Ninguna IP de red privada, porque ahí es donde acabaría la LAN de alguien
     * y el documento dejaría de servir en otra máquina.
     *
     * **La única excepción es `10.0.2.2`, y se nombra en vez de relajar la
     * regla.** No es la red de nadie: es la constante con la que el emulador de
     * Android alcanza a su anfitrión, y aparece precisamente para explicar por
     * qué Nomey NO la usa —sólo existe en el emulador, y un teléfono por cable
     * no la resuelve—. `127.0.0.1` no entra en el patrón y es la dirección
     * buena.
     */
    const EMULATOR_HOST_ALIAS = /10\.0\.2\.2/g;
    const sinLaExcepcion = RUNBOOK.replace(EMULATOR_HOST_ALIAS, '<alias-del-emulador>');
    expect(sinLaExcepcion).not.toMatch(/\b(?:10|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
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

  it('comprueba el canal en las dos direcciones, no sólo en una', () => {
    /*
     * Desde F8.A5 la comprobación está parametrizada por variante, así que ya no
     * basta con «Development no escucha»: un Staging **sin** canal tampoco
     * recibiría nunca nada, y lo parecería todo. El script exige lo que cada
     * variante declara y rechaza lo contrario.
     */
    expect(ANDROID_CHECK).toContain('expo.modules.updates.ENABLED" android:value="${String(');
    expect(ANDROID_CHECK).toContain('expo-channel-name');
    expect(ANDROID_CHECK).toContain('declara el canal');
    expect(ANDROID_CHECK).toMatch(/deberia escuchar/);
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

describe('la build de Android es propia, y no depende de Expo Go', () => {
  const manifest = JSON.parse(PACKAGE_JSON) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it('`expo-dev-client` está declarado, y dentro de SDK 57', () => {
    // Es lo que convierte el binario propio en algo capaz de cargar desde
    // Metro. Sin él, una build local arranca sólo con el JavaScript empotrado.
    const declared = manifest.dependencies['expo-dev-client'];
    expect(declared, 'expo-dev-client debe ser una dependencia de runtime').toBeDefined();
    expect(declared).toMatch(/^~57\./);
  });

  it('y es una dependencia de runtime, no de desarrollo', () => {
    // Va dentro del binario: `devDependencies` no se instala en un checkout de
    // producción y la build saldría sin el cliente.
    expect(manifest.devDependencies['expo-dev-client']).toBeUndefined();
  });

  it('el runbook explica la diferencia con Expo Go en vez de darla por sabida', () => {
    expect(RUNBOOK).toContain('Expo Go');
    expect(RUNBOOK).toContain('development build');
  });

  it('y no propone Expo Go como forma de ejecutar Nomey en Android', () => {
    // Expo Go sigue siendo la vía de iOS hasta F8.B, así que la prohibición es
    // acotada: en Android hay binario propio, y volver a Expo Go allí sería
    // probar otro contenedor, no la aplicación.
    const lines = RUNBOOK.split('\n').filter((line) => /Expo Go/.test(line));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line, `«${line.trim()}»`).not.toMatch(/^\s*(npx |npm |node ).*Expo Go/);
    }
  });
});

describe('el Android de Development alcanza el ordenador sin depender de la red', () => {
  const REVERSE = ANDROID_REVERSE;
  const PACKAGE = JSON.parse(PACKAGE_JSON) as { scripts: Record<string, string> };

  it('revisa de verdad lo que dice revisar', () => {
    expect(REVERSE).toBeTypeOf('string');
    expect(REVERSE.length).toBeGreaterThan(1000);
  });

  it('el arranque de Android pone los túneles antes de Metro', () => {
    // Si Metro arrancara primero, la aplicación cargaría y fallaría al hablar
    // con la frontera, que es el síntoma lejano que esto existe para evitar.
    expect(PACKAGE.scripts.android).toMatch(/^node scripts\/android-reverse\.mjs &&/);
    expect(PACKAGE.scripts['android:reverse:check']).toContain('--check');
  });

  it('no lleva ninguna IP de red dentro: la dirección es loopback', () => {
    /*
     * Una IP de red local aquí reintroduciría exactamente el acoplamiento que
     * el script existe para quitar. La misma excepción acotada que en el
     * runbook: `10.0.2.2` aparece en la cabecera para explicar por qué NO se
     * usa, y no es la red de nadie.
     */
    const sinLaExcepcion = REVERSE.replace(/10\.0\.2\.2/g, '<alias-del-emulador>');
    expect(sinLaExcepcion).not.toMatch(/\b(?:10|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(REVERSE).toContain("'127.0.0.1'");
  });

  it('lee la .env pero no la escribe, y no imprime lo que hay dentro', () => {
    /*
     * La lee para saber a dónde apunta —si no es loopback, no hay nada que
     * tunelar—. Escribirla convertiría el helper en algo que edita la
     * configuración de alguien a su espalda, que es justo lo que se quería
     * dejar de hacer en cada cambio de red.
     */
    expect(REVERSE).toContain("readFileSync('.env'");
    expect(REVERSE).not.toMatch(/writeFileSync|appendFileSync/);
    expect(REVERSE).not.toContain('PUBLISHABLE');
  });

  it('y no arranca ni para ningún servicio', () => {
    // Diagnostica y configura túneles. Levantar el stack o matar Metro serían
    // otro trabajo, y uno que nadie le ha pedido.
    expect(REVERSE).not.toMatch(/docker\s+(start|stop|restart)/);
    expect(REVERSE).not.toMatch(/supabase-cli\.sh/);
  });

  it('el runbook explica por qué loopback y descarta el alias del emulador', () => {
    expect(RUNBOOK).toContain('http://127.0.0.1:54321');
    expect(RUNBOOK).toContain('npm run android:reverse:check');
    expect(RUNBOOK).toMatch(/sólo existe en el emulador/);
  });
});

describe('el contrato del icono adaptativo', () => {
  it('las DOS capas adaptativas comparten una sola fracción', () => {
    /*
     * Es la guarda que importa de este bloque. El primer plano y el monocromo
     * son el mismo icono en dos modos, así que si cada uno tuviera su constante
     * un lanzador que alterna entre ellos mostraría la marca cambiando de
     * tamaño. Se separaron durante exactamente una compilación de F8.A3 y se
     * corrigió; esto impide que vuelva a pasar por descuido.
     */
    expect(DERIVE).toMatch(/^\$ADAPTIVE_FRACTION = 0\.54$/m);
    expect(DERIVE).toMatch(/Place\(\$markOnly, \$markBox, 1024, \$ADAPTIVE_FRACTION, 0\)/);
    expect(DERIVE).toMatch(/Place\(\$silhouette, \$markBox, 432, \$ADAPTIVE_FRACTION, 0\)/);
    // Y ninguna constante suelta que pueda desalinearlas otra vez.
    expect(DERIVE).not.toMatch(/\$SAFE_FRACTION|\$FOREGROUND_FRACTION/);
  });

  it('el icono de iOS y el splash conservan su propia proporción', () => {
    // No comparten fracción con las capas de Android, y no deben: el de iOS
    // reproduce el encuadre del original y el splash llena su lienzo.
    expect(DERIVE).toMatch(/Place\(\$markOnly, \$markBox, 1024, \$MARK_FRACTION, \$GROUND_ARGB\)/);
    expect(DERIVE).toMatch(/Place\(\$splashMark, \$splashBox, 512, 0\.92, 0\)/);
  });

  it('la comprobación de geometría exige dimensiones, formato, alfa y proporción', () => {
    expect(ICON_CHECK).toContain("file: 'assets/icons/android-icon-foreground.png'");
    expect(ICON_CHECK).toContain("file: 'assets/icons/android-icon-monochrome.png'");
    // Las dos capas de Android, con la misma fracción que el script deriva.
    expect(ICON_CHECK.match(/widthFraction: 0\.54,/g)).toHaveLength(2);
    // El icono de iOS no puede llevar alfa, y eso no es una preferencia.
    expect(ICON_CHECK).toContain("format: 'RGB',");
    expect(ICON_CHECK).toContain('alpha: false,');
  });

  it('y corre en CI, que es donde nadie se acuerda de ejecutarla', () => {
    expect(CI).toContain('node scripts/icon-geometry-check.mjs');
  });
});
