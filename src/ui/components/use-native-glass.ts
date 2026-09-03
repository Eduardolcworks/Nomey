import { isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the native effect will do anything on this device, right now.
 *
 * Reduce Transparency is read asynchronously and subscribed to, because a user
 * can turn it on while the app is open and a surface that ignored that would
 * be overriding an accessibility setting.
 *
 * **Vive en su propio fichero desde que `GlassSurface` se partió por
 * plataforma.** No es una rama: es exactamente la misma función que había, y su
 * respuesta no cambia en iOS. En Android devuelve `false` por sí sola —
 * `isLiquidGlassAvailable()` lo es— así que la implementación de allí ni la
 * llama. Está aquí para que el barril pueda exportarla sin depender de cuál de
 * las dos implementaciones resuelva Metro.
 */
export function useNativeGlass(): boolean {
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    let active = true;

    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (active) setReduceTransparency(enabled);
      })
      .catch(() => {
        // Not supported everywhere. Assuming "off" only costs an effect that
        // the checks below may refuse anyway.
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduceTransparency,
    );

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return isGlassEffectAPIAvailable() && isLiquidGlassAvailable() && !reduceTransparency;
}
