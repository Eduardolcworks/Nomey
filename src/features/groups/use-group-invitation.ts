/**
 * LA INVITACIÓN QUE SE COMPARTE. F09/ADR-004 §3, y una decisión del cliente.
 *
 * `api.create_group_invitation` enseña el token **una sola vez**: el servidor
 * guarda sólo su hash. Por tanto el cliente decide dónde vive ese token entre
 * dos aperturas de «Compartir»:
 *
 *   - **En memoria, por grupo, mientras dure la sesión de la app**, y hasta su
 *     caducidad. Abrir y cerrar la ventana no emite otra; reiniciar la app sí,
 *     porque no se persiste ningún secreto en el aparato. Cada apertura tras
 *     un reinicio deja una invitación más en el grupo —todas válidas hasta
 *     caducar o revocarse (7 días)—, lo que es coherente con que son
 *     multiuso y revocables. Persistirlo en SecureStore es una decisión
 *     aparte y no se toma aquí.
 *
 * **No se emite en cada render**: la emisión ocurre en un efecto, una vez por
 * grupo y sesión, con su clave de comando, y se reintenta sólo a petición.
 * El enlace es el vigente, `<esquema>://join?t=<token>`, y lo construye
 * `Linking.createURL` para que sea EL QUE ESTE ENTORNO PUEDE ABRIR: en una
 * build propia `nomey-dev://join?t=…` (el esquema de la variante); en Expo Go
 * `exp://<host de Metro>/--/join?t=…`, que es la única forma de que Expo Go
 * reciba un enlace pulsado. El QR y la hoja de compartir llevan la MISMA
 * cadena, y `readInvitation` acepta las dos formas. Nunca se escribe en un
 * log.
 */
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useState } from 'react';

import { newClientOperationId } from '@/lib/id';
import { supabase } from '@/lib/supabase';

import { JOIN_PATH } from './invitation-link';

type Issued = { readonly token: string; readonly expiresAt: number };

/** Por grupo, durante la sesión de la app. */
const CACHE = new Map<string, Issued>();

export type InvitationState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly link: string; readonly expiresAt: number }
  | { readonly kind: 'failed'; readonly reason: 'offline' | 'notMember' | 'rejected' };

/** El enlace que ESTE entorno puede abrir, con el token de la invitación. */
export function invitationLinkHere(token: string): string {
  return Linking.createURL(JOIN_PATH, { queryParams: { t: token } });
}

export function useGroupInvitation(
  scopeId: string,
): InvitationState & { readonly retry: () => void } {
  const [state, setState] = useState<InvitationState>(() => fromCache(scopeId));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (scopeId === '') return;
    const cached = fromCache(scopeId);
    if (cached.kind === 'ready') return;
    let live = true;
    void (async () => {
      const result = await issue(scopeId);
      if (!live) return;
      setState(result);
    })();
    return () => {
      live = false;
    };
  }, [scopeId, attempt]);

  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, retry };
}

function fromCache(scopeId: string): InvitationState {
  const hit = CACHE.get(scopeId);
  if (hit !== undefined && hit.expiresAt > Date.now() + 60_000) {
    return {
      kind: 'ready',
      link: invitationLinkHere(hit.token),
      expiresAt: hit.expiresAt,
    };
  }
  return { kind: 'loading' };
}

async function issue(scopeId: string): Promise<InvitationState> {
  try {
    const response = (await supabase.rpc('create_group_invitation', {
      payload: {
        client_command_id: newClientOperationId(),
        command_contract_version: 1,
        scope_id: scopeId,
      } as never,
    })) as unknown as { data: unknown; error: { code?: string | null } | null; status?: number };
    const status = typeof response.status === 'number' ? response.status : 0;
    if (response.error !== null && response.error !== undefined) {
      return {
        kind: 'failed',
        reason:
          status === 0
            ? 'offline'
            : response.error.code === 'NOT_AUTHORIZED'
              ? 'notMember'
              : 'rejected',
      };
    }
    const data = response.data as Record<string, unknown> | null;
    const token = data?.token;
    const expires = data?.expires_at;
    if (typeof token !== 'string' || typeof expires !== 'string') {
      // Un replay sin token no puede ocurrir con una clave nueva; si ocurre, no hay enlace.
      return { kind: 'failed', reason: 'rejected' };
    }
    const issued = { token, expiresAt: Date.parse(expires) };
    CACHE.set(scopeId, issued);
    return { kind: 'ready', link: invitationLinkHere(token), expiresAt: issued.expiresAt };
  } catch {
    return { kind: 'failed', reason: 'offline' };
  }
}
