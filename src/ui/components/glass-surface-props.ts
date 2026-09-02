import type { ViewProps } from 'react-native';

import type { GlassLevel, TactileState } from '@/ui/theme';

/**
 * EL CONTRATO DE `GlassSurface`, COMPARTIDO POR LAS DOS IMPLEMENTACIONES.
 *
 * Vive aparte porque desde F6.G hay dos: `glass-surface.tsx` —iOS y cualquier
 * otra plataforma que no sea Android— y `glass-surface.android.tsx`. Metro
 * elige por extensión, así que ninguna rama de plataforma vive en el código, y
 * el tipo es lo único que las dos comparten.
 *
 * **Un contrato, dos topologías.** iOS resuelve todo sobre una sola vista
 * porque Core Animation funde la lista de un `boxShadow` en un solo paso;
 * Android la apila como siluetas independientes y necesita separarlas en capas.
 * Esa diferencia es de renderizado, no de diseño: los tokens son los mismos.
 */
export type GlassSurfaceProps = ViewProps & {
  /** Which material this surface is. See `ui/theme/elevation.ts`. */
  level?: GlassLevel;
  /** How it sits: raised at rest, pressed when held, and so on. */
  depth?: TactileState | 'flat';
  /** How hard the top edge catches the light. See `GlassRim`. */
  rim?: GlassRim;
  radius?: number;
  /**
   * Whether this surface may layer the native effect on top. Defaults to `true`.
   *
   * **An opt-out, never a style choice.** Both branches paint the same tokens -
   * tint, border, radius, rim and depth - so turning it off does not make the
   * surface a different material; it only gives up the live refraction of
   * whatever sits behind. Reach for it when hosting a `GlassView` in that
   * particular place is what breaks, not when a surface would look better flat.
   *
   * The one caller that sets it is the category trigger: `GlassView` used as
   * the label of a SwiftUI `Menu` flattens into a blurred rectangular plate for
   * about a second on dismiss - expo/expo#44126, closed upstream with no
   * published fix.
   */
  nativeEffect?: boolean;
  /**
   * Whether this surface casts the outer half of its depth. Defaults to `true`.
   *
   * **A relocation, not a removal.** With `false` the surface keeps its inner
   * shading — the rim and the state's own shading are untouched — and only stops
   * casting onto the ground, because something else is casting it for it. Both
   * halves are separate entries of the same token, so nothing is rewritten or
   * approximated: see `castShadow` and `innerShading`.
   *
   * The one caller that sets it is the category trigger on iOS, whose circle is
   * the label of a SwiftUI `Menu`. That label is recomposed when the menu is
   * dismissed, and an outer shadow inside it is what surfaces as a flattened
   * plate for about a second. The shadow moves to a stable sibling instead.
   */
  castsShadow?: boolean;
  /**
   * Clips whatever it contains to its own rounded shape. Defaults to `false`.
   *
   * **A mask, not a style.** Without it an opaque child that fills the box
   * decides its own shape, and if it loses it, it covers the surface's: you see
   * the child's square instead of the pill underneath. With it the surface owns
   * the shape and the child's stops mattering.
   *
   * The only caller that asks for it is the windows' CTA, whose accent fill is
   * exactly that opaque child: disabled it showed the correct pill, and the
   * moment it turned yellow it went square on Android - measured on the
   * emulator, with the same `borderRadius` on both layers.
   *
   * **It does not clip the outer shadow.** `overflow` reaches children, not
   * what the view itself casts beyond its own bounds.
   */
  clip?: boolean;
  /**
   * Que el control está deshabilitado. Por omisión `false`.
   *
   * **Sólo Android lo mira.** La implementación de iOS lo ignora por completo:
   * allí lo deshabilitado se dice con la opacidad que ya ponía quien llama, y
   * ni un token ni un nodo de su árbol cambian por esto. En Android elige una
   * variante propia —`TactileAndroid.disabled`— que conserva la forma y el
   * borde y baja la profundidad, porque una píldora que pierde su relieve al
   * deshabilitarse se lee como un rectángulo plano.
   *
   * Es un booleano y no un estado táctil a propósito: añadir `disabled` a
   * `TactileState` habría obligado a darle una entrada a `TactileIOS`, que está
   * congelado.
   */
  disabled?: boolean;
  /**
   * Qué ES esta superficie. Por omisión `'surface'`.
   *
   * **Sólo Android lo mira.** Un `'control'` —un oblongo, una píldora, un
   * círculo que se pulsa o un campo— recibe allí el material neutro aprobado:
   * relleno plano y un reflejo de un píxel arriba. Una `'surface'` —una ventana,
   * un panel, una tarjeta, el fondo del dock— conserva su cristal. Y una
   * `'window'` recibe el material plano de ventana: un gris uniforme y un rim
   * completo, sin sombras ni variación de tono.
   *
   * `'translucent-control'` es para los que NO pueden volverse opacos —la
   * píldora seleccionada del dock, el CTA apagado—: conserva el tinte y el alfa
   * de su nivel, quita toda sombra interior y añade el mismo rim continuo.
   *
   * **Es una distinción semántica, no un condicional por nombre ni por nivel.**
   * El nivel no sirve para separarlos: `bar` lo usan tanto el selector de tipo
   * de movimiento, que es un control, como el fondo del dock, que no lo es; y
   * `heavy` lo usan un control seleccionado y el panel de la ventana. Quien sabe
   * qué es cada pieza es quien la monta, y por eso lo declara.
   *
   * iOS lo recoge y no lo usa: su composición no cambia.
   */
  material?: 'control' | 'translucent-control' | 'surface' | 'window';
};

/**
 * How hard the top edge catches the light.
 *
 * `catch` is the original and stays the default, so nothing that predates this
 * prop changes. The other two exist because of what the rim does on a ROUNDED
 * shape: a one-pixel inset offset with no blur meets the curve tangentially at
 * the ends, so the light piles up there and the corners read brighter than the
 * edge it is supposed to describe. On a pill it is two bright crescents.
 *
 * `soft` keeps the light and spreads it, which is what removes the pile-up
 * without removing the depth. `none` drops it entirely, for a surface whose
 * own fill already separates it from the ground.
 */
export type GlassRim = 'catch' | 'soft' | 'none';
