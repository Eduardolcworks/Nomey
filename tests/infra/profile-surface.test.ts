import { describe, expect, it } from 'vitest';

import PROFILE_RAW from '../../src/app/profile.tsx?raw';
import AVATAR_RAW from '../../src/features/auth/account-avatar.tsx?raw';
import EDITOR_RAW from '../../src/features/auth/display-name-editor.tsx?raw';
import AUTH_SERVICE from '../../src/features/auth/auth-service.ts?raw';
import HOME from '../../src/app/(tabs)/index.tsx?raw';
import { initialsFrom } from '../../src/features/auth/display-name';
import { esES } from '../../src/lib/i18n/messages/es-ES';
import { en } from '../../src/lib/i18n/messages/en';

/**
 * La pantalla de Perfil: qué se ve al entrar y de dónde sale el nombre.
 *
 * Igual que el resto de comprobaciones de pantalla, se lee el fuente —no hay
 * renderer, y montarlo sería probar React— salvo `initialsFrom`, que es puro y
 * se ejecuta de verdad. La validación estética es el dispositivo; lo que se
 * fija aquí es la estructura y las reglas que no deben poder deshacerse por
 * accidente.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const PROFILE = stripComments(PROFILE_RAW);
const AVATAR = stripComments(AVATAR_RAW);
const EDITOR = stripComments(EDITOR_RAW);

describe('las iniciales del avatar', () => {
  it('de un nombre simple, una letra', () => {
    expect(initialsFrom('Eduardo')).toBe('E');
  });

  it('de nombre y apellido, la primera de cada uno', () => {
    expect(initialsFrom('Eduardo Álvarez')).toBe('EÁ');
  });

  it('de tres palabras, la primera y la última', () => {
    // «Ana María Pérez» es AP, no AM: el apellido identifica más que el
    // segundo nombre.
    expect(initialsFrom('Ana María Pérez')).toBe('AP');
  });

  it('sin nombre no hay iniciales, y eso es una respuesta válida', () => {
    // `null` es lo que hace que el avatar pinte la silueta en vez de inventar
    // una letra.
    expect(initialsFrom(null)).toBeNull();
    expect(initialsFrom('   ')).toBeNull();
    expect(initialsFrom('')).toBeNull();
  });

  it('no se rompe con acentos ni con emoji', () => {
    expect(initialsFrom('Óscar')).toBe('Ó');
    // Un par sustituto partido a la mitad daría un carácter inválido.
    expect(initialsFrom('🙂 Ana')).toBe('🙂A');
  });

  it('y NUNCA salen del email', () => {
    // La regla es la misma que la del nombre: la parte local de una dirección
    // no es un nombre, y dos letras suyas en el elemento más grande de la
    // pantalla son la misma mentira en cuerpo mayor.
    expect(AVATAR).not.toMatch(/email/i);
  });
});

describe('la cabecera de identidad', () => {
  it('la foto va arriba y el nombre debajo', () => {
    const avatarAt = PROFILE.indexOf('<AccountAvatar');
    const nameAt = PROFILE.indexOf('<DisplayNameEditor');
    expect(avatarAt).toBeGreaterThan(-1);
    expect(nameAt).toBeGreaterThan(avatarAt);
  });

  it('los dos leen el nombre de la sesión, no de otra fuente', () => {
    expect(PROFILE).toContain('state.identity.displayName');
    expect(PROFILE).toContain('name={displayName}');
  });

  it('Perfil no consulta al backend para pintarse', () => {
    expect(PROFILE).not.toContain('supabase');
    expect(PROFILE).not.toMatch(/\.from\(/);
    expect(PROFILE).not.toContain('getUser');
  });
});

describe('el avatar vacío', () => {
  it('tiene affordance de añadir foto, con nombre accesible', () => {
    expect(AVATAR).toContain("t('profile.addPhoto')");
    expect(AVATAR).toContain('accessibilityRole="button"');
  });

  it('lleva la insignia de cámara además de las iniciales', () => {
    // Vacío no puede parecer roto: iniciales o silueta, borde e insignia son
    // tres señales de que el hueco es deliberado.
    expect(AVATAR).toContain('camera');
    expect(AVATAR).toContain('person.fill');
  });

  it('responde al toque en vez de quedarse mudo', () => {
    // Un control deshabilitado no da respuesta alguna; éste dice la verdad.
    expect(AVATAR).toContain('Alert.alert');
    expect(AVATAR).toContain("t('profile.photoSoonBody')");
    expect(AVATAR).not.toContain('disabled={true}');
  });

  it('y no finge persistir nada', () => {
    // Ni picker ni almacenamiento: si apareciera alguno aquí sería una
    // implementación a medias de algo que necesita bucket, políticas y
    // migración.
    expect(AVATAR).not.toContain('ImagePicker');
    expect(AVATAR).not.toContain('launchImageLibrary');
    expect(AVATAR).not.toContain('storage');
    expect(AVATAR).not.toContain('base64');
  });
});

describe('editar el nombre', () => {
  it('se edita en la propia pantalla, sin abrir otra', () => {
    expect(EDITOR).toContain('TextInput');
    expect(EDITOR).not.toContain('router.push');
    expect(EDITOR).not.toContain('presentation');
  });

  it('el lápiz es la affordance y lleva etiqueta accesible', () => {
    expect(EDITOR).toContain('name="pencil"');
    expect(EDITOR).toContain("t('profile.editName')");
  });

  it('guardar va detrás del guardián de envío, como el resto de auth', () => {
    expect(EDITOR).toContain('useAuthSubmit');
    expect(EDITOR).toContain('updateDisplayName');
  });

  it('la escritura NO es optimista: sólo cierra si el servidor dijo que sí', () => {
    /*
     * La regresión que evita: pintar el nombre nuevo al instante y que una
     * petición fallida lo revierta en silencio. La persona vería dos nombres
     * distintos sin saber cuál es el real.
     */
    expect(EDITOR).toMatch(/result\?\.ok === true/);
    expect(EDITOR).toContain('setEditing(false)');
    // El valor que se pinta en reposo es el de la sesión, no el borrador.
    expect(EDITOR).toMatch(/\{name \?\? t\('account\.noName'\)\}/);
  });

  it('un nombre vacío no se envía', () => {
    expect(EDITOR).toContain('normaliseDisplayName(draft)');
    expect(EDITOR).toContain('empty');
  });

  it('y el fallo se cuenta como alerta accesible', () => {
    expect(EDITOR).toContain('accessibilityRole="alert"');
  });
});

describe('dónde se escribe el nombre', () => {
  it('en `user_metadata.display_name`, por `updateUser`', () => {
    expect(AUTH_SERVICE).toContain(
      'supabase.auth.updateUser({ data: { display_name: displayName }',
    );
  });

  it('y en ningún otro sitio: ni tabla, ni store, ni segunda identidad', () => {
    const service = stripComments(AUTH_SERVICE);
    expect(service).not.toContain('profiles');
    expect(service).not.toContain('app_user');
    expect(service).not.toMatch(/\.from\(/);
  });

  it('nadie propaga el cambio a mano: lo hace el evento', () => {
    /*
     * `_updateUser` guarda la sesión y emite `USER_UPDATED`. El provider es el
     * único suscriptor y ya mapea al usuario. Un refetch o un segundo estado
     * aquí serían una copia que puede quedarse vieja.
     */
    const service = stripComments(AUTH_SERVICE);
    expect(service).not.toContain('refreshSession');
    expect(service).not.toContain('getUser()');
    expect(stripComments(EDITOR_RAW)).not.toContain('setState');
  });

  it('el saludo de Inicio sigue derivándose de la sesión en cada render', () => {
    // Es lo que hace que cambiar el nombre en Perfil se vea en Inicio sin que
    // nadie los conecte.
    expect(HOME).toContain('state.identity.displayName');
    expect(HOME).toContain('<HomeGreeting name={greetingName} />');
  });
});

describe('el bloque General', () => {
  it('no es una fila en la que entrar: sus tres opciones se ven', () => {
    expect(PROFILE).toContain("t('profile.general')");
    expect(PROFILE).toContain("t('profile.languageCurrency')");
    expect(PROFILE).toContain("t('profile.appearance')");
    expect(PROFILE).toContain("t('profile.shortcuts')");
    // Y ninguna de las tres navega a ningún sitio.
    expect(PROFILE).not.toMatch(/router\.push\('\/(language|appearance|shortcuts)'\)/);
  });

  it('son exactamente tres', () => {
    const general = PROFILE.slice(
      PROFILE.indexOf("t('profile.general')"),
      PROFILE.indexOf("t('profile.plans')"),
    );
    expect([...general.matchAll(/icon:/g)]).toHaveLength(0);
    // Las opciones se declaran en la lista `general`, antes del JSX.
    const list = PROFILE.slice(PROFILE.indexOf('const general'), PROFILE.indexOf('return ('));
    expect([...list.matchAll(/icon:/g)]).toHaveLength(3);
  });

  it('van en UNA superficie con separadores, no en tres cajas sueltas', () => {
    expect(PROFILE).toContain('OptionGroup');
    expect(PROFILE).toContain('borderTopWidth: StyleSheet.hairlineWidth');
  });

  it('lo inerte se señala con dos cosas, no sólo con el color', () => {
    // Ausencia de chevron Y presencia de la píldora.
    expect(PROFILE).toMatch(/soon \? <SoonPill \/> : <Icon name="chevron\.right"/);
    expect(PROFILE).toContain("t('action.soon')");
  });
});

describe('Planes y suscripciones', () => {
  it('existe como sección propia', () => {
    expect(PROFILE).toContain("t('profile.plans')");
    expect(PROFILE).toContain('<PlansCard />');
  });

  it('es una tarjeta con contenido, no una fila vacía', () => {
    expect(PROFILE).toContain("t('profile.plansTitle')");
    expect(PROFILE).toContain("t('profile.plansBody')");
  });

  it('y no inventa un plan ni un precio', () => {
    for (const catalogue of [esES, en]) {
      const copy = `${catalogue['profile.plansTitle']} ${catalogue['profile.plansBody']}`;
      expect(copy).not.toMatch(/[€$]|\d+\s*(€|\$|EUR|USD)/);
      expect(copy.toLowerCase()).not.toMatch(/gratis|free|premium|pro\b/);
    }
  });
});

describe('el amarillo de marca', () => {
  it('no aparece en Perfil: sigue siendo del botón flotante', () => {
    // El acento es minoritario por decisión de la dirección de diseño. Un CTA
    // amarillo aquí competiría con el `+`.
    expect(PROFILE).not.toContain('accent');
    expect(PROFILE).not.toContain('FDC506');
  });
});

describe('el catálogo', () => {
  it('las claves nuevas están en los dos idiomas', () => {
    const added = [
      'profile.general',
      'profile.languageCurrency',
      'profile.shortcuts',
      'profile.plans',
      'profile.plansTitle',
      'profile.plansBody',
      'profile.addPhoto',
      'profile.editName',
      'action.save',
    ] as const;

    for (const key of added) {
      expect(esES[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
      // Traducido de verdad, no copiado del español.
      expect(en[key]).not.toBe('');
    }
  });
});
