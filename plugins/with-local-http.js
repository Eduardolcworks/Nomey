/**
 * PERMITIR HTTP SIN CIFRAR, Y SÓLO CONTRA EL ORDENADOR QUE SIRVE EL STACK.
 *
 * **El fallo que corrige, medido en F8.A5.** Una build de **release** de Android
 * no puede hablar HTTP sin cifrar. `usesCleartextTraffic` sólo vive en el
 * manifiesto de `debug` que genera la plantilla, y con `targetSdk 36` el valor
 * por defecto de la plataforma es «no». Medido sobre el manifiesto FUSIONADO de
 * release: cero menciones del atributo. El síntoma no aparece al compilar ni al
 * instalar — aparece dentro de la aplicación, como un fallo de red, que es
 * exactamente el modo de fallo tardío que este bloque existe para evitar.
 *
 * **Por qué un plugin local y no una opción de configuración.** Expo SDK 57 no
 * expone ninguna: `usesCleartextTraffic` aparece en `@expo/config-plugins`
 * únicamente como atributo del manifiesto, y no existe en el esquema de
 * `@expo/config-types@57`. [ADR-030](../docs/adr/ADR-030-native-code-model.md)
 * §3 ya decidió qué hacer en ese caso: un config plugin local y versionado. Éste
 * es el primero de Nomey.
 *
 * **Por qué acotado a loopback y no un permiso general.** `usesCleartextTraffic`
 * a secas permite texto claro contra **cualquier** host, y eso sobreviviría al
 * día en que Staging apunte a un backend alojado — justo cuando dejaría de ser
 * inocuo. Una configuración de seguridad de red permite decir lo que de verdad
 * se necesita: texto claro **sólo** contra el ordenador que sirve el stack
 * local, alcanzado por `adb reverse`. Todo lo demás sigue exigiendo TLS.
 *
 * **Quién lo lleva.** Sólo la variante que lo pide, porque `app.config.ts` lo
 * declara sólo para ella. Production **nunca** lo declara, y una guarda de
 * `tests/infra/` lo comprueba en vez de confiar en que nadie lo copie.
 *
 * **Y esto no es una edición de `/android`.** El plugin es fuente: se revisa, se
 * versiona y viaja en el commit; lo que escribe se regenera en cada `prebuild`.
 */
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

/** El nombre del recurso, usado en los dos sitios que tienen que coincidir. */
const RESOURCE = 'network_security_config';

/**
 * Los únicos destinos que pueden ir sin cifrar.
 *
 * `127.0.0.1` es el extremo del túnel de `adb reverse`, y `localhost` es su
 * nombre. No se añade ninguna dirección de red local: ésa es precisamente la
 * dependencia de la que F8.A4 sacó a Development.
 */
const CLEARTEXT_HOSTS = ['127.0.0.1', 'localhost'];

const XML = `<?xml version="1.0" encoding="utf-8"?>
<!--
  GENERADO por plugins/with-local-http.js. No se edita a mano: se regenera en
  cada prebuild y cualquier cambio aquí se pierde sin avisar.
-->
<network-security-config>
  <!-- Todo lo demás sigue exigiendo TLS: no se toca la base de la plataforma. -->
  <domain-config cleartextTrafficPermitted="true">
${CLEARTEXT_HOSTS.map((host) => `    <domain includeSubdomains="false">${host}</domain>`).join('\n')}
  </domain-config>
</network-security-config>
`;

/** Escribe el recurso dentro del proyecto generado, en cada prebuild. */
function withResource(config) {
  return withDangerousMod(config, [
    'android',
    async (inner) => {
      const dir = join(inner.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${RESOURCE}.xml`), XML, 'utf8');
      return inner;
    },
  ]);
}

/** Y lo referencia desde `<application>`, que es lo que lo activa. */
function withReference(config) {
  return withAndroidManifest(config, (inner) => {
    const application = inner.modResults.manifest.application?.[0];
    if (application === undefined) {
      throw new Error('with-local-http: el manifiesto no tiene <application>');
    }
    application.$['android:networkSecurityConfig'] = `@xml/${RESOURCE}`;
    return inner;
  });
}

module.exports = function withLocalHttp(config) {
  return withReference(withResource(config));
};
