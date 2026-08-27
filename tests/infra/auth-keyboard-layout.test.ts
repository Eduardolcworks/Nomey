import { describe, expect, it } from 'vitest';

// Los paréntesis de «(auth)» son sintaxis de grupo para el glob, así que se
// recoge todo y se filtra: escaparlos sería más frágil que filtrar.
const ALL_SOURCES = import.meta.glob(['../../src/app/**/*.tsx', '../../src/features/auth/*.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * Sin comentarios.
 *
 * Hace falta de verdad: el andamio **documenta el bug** que arregló, y por
 * tanto nombra `KeyboardAvoidingView`, `flexGrow` y `LayoutAnimation` en su
 * cabecera. Comprobar sobre el texto crudo haría fallar el test por la
 * explicación en vez de por el código, y la salida sería borrar la
 * explicación — justo lo que no se quiere.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const FILES = Object.entries(ALL_SOURCES)
  .map(([path, text]) => ({
    path: path.replace('../../src/', ''),
    code: stripComments(text as string),
  }))
  .filter(
    (file) =>
      file.path.includes('(auth)') ||
      // La superficie de recovery es un formulario con dos campos de
      // contrasena y el mismo andamio: le aplica el mismo bucle y por tanto
      // las mismas reglas, aunque viva bajo otra guarda de sesion.
      file.path.includes('(recovery)') ||
      file.path.endsWith('auth-screen.tsx'),
  );

function code(name: string): string {
  const found = FILES.find((file) => file.path.endsWith(name));
  if (found === undefined) throw new Error(`No se encontró ${name}`);
  return found.code;
}

/**
 * La estructura de la que dependía el salto del teclado.
 *
 * En un iPhone, tocar un campo hacía que el formulario se recolocara varias
 * veces, y cambiar de campo con el teclado abierto producía pequeños saltos.
 * La causa no era una opción mal puesta: eran **dos sistemas moviendo el mismo
 * contenido en vertical**, cada uno alimentando al otro —
 * `KeyboardAvoidingView` encogía el contenedor y animaba el cambio, y el
 * contenido estaba centrado con `flexGrow`, así que la posición de cada campo
 * dependía de la altura del contenedor.
 *
 * No hay renderer de React en el proyecto, y montar uno para esto sería probar
 * React Native. Lo que sí se puede fijar es **que las dos piezas del bucle no
 * vuelven**, que es exactamente lo que alguien reintroduciría al añadir «un
 * poco de lógica de teclado».
 *
 * La comprobación de verdad es el dispositivo. Esto solo evita la recaída.
 */
describe('las pantallas de auth no reconstruyen el bucle del teclado', () => {
  const paths = FILES.map((file) => file.path).sort();

  it('encuentra las superficies que tiene que vigilar', () => {
    expect(paths).toEqual([
      'app/(auth)/_layout.tsx',
      'app/(auth)/forgot-password.tsx',
      'app/(auth)/sign-in.tsx',
      'app/(auth)/sign-up.tsx',
      'app/(recovery)/_layout.tsx',
      'app/(recovery)/new-password.tsx',
      'features/auth/auth-screen.tsx',
    ]);
  });

  it.each(paths)('%s no usa KeyboardAvoidingView', (path) => {
    expect(code(path)).not.toContain('KeyboardAvoidingView');
  });

  it.each(paths)('%s no anima el layout a mano', (path) => {
    expect(code(path)).not.toContain('LayoutAnimation');
  });

  it.each(paths)('%s no centra contenido desplazable con flexGrow', (path) => {
    // `flexGrow: 1` + `justifyContent: 'center'` hace que la posición de cada
    // campo dependa de la altura del contenedor, que es lo que cierra el bucle
    // en cuanto el teclado la cambia.
    expect(/flexGrow:\s*1[\s\S]{0,120}justifyContent:\s*'center'/.test(code(path))).toBe(false);
  });

  describe('el andamio', () => {
    const scaffold = code('auth-screen.tsx');

    it('deja el hueco del teclado al ScrollView nativo', () => {
      expect(scaffold).toContain('automaticallyAdjustKeyboardInsets');
    });

    it('conserva `keyboardShouldPersistTaps`, que permite saltar de campo de un toque', () => {
      expect(scaffold).toContain('keyboardShouldPersistTaps="handled"');
    });

    it('excluye el borde inferior del área segura, para no contarlo dos veces', () => {
      expect(scaffold).toMatch(/edges=\{\['top', 'left', 'right'\]\}/);
    });

    it('y devuelve ese hueco como padding del contenido', () => {
      expect(scaffold).toMatch(/paddingBottom: insets\.bottom/);
    });
  });

  describe('las dos pantallas usan el andamio y no montan el suyo', () => {
    it.each(['sign-in.tsx', 'sign-up.tsx'])('%s', (name) => {
      expect(code(name)).toContain('<AuthScreen>');
      expect(code(name)).not.toContain('<ScrollView');
    });
  });
});
