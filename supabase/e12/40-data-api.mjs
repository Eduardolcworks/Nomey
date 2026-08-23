// E12 · El mismo rol por la Data API frente a la conexion SQL directa.
//
// Pregunta 7 de D4: un privilegio ejecutable por `psql` no implica que sea
// alcanzable por PostgREST, y al reves. Se mide con `fetch` nativo de Node y
// SIN ninguna dependencia: no se instala nada y no se toca el package.json de
// la app.
//
// NO ES UNA MIGRACION.
//
// Variables de entorno (valores locales de desarrollo, no credenciales reales):
//   SUPABASE_URL         http://127.0.0.1:54321
//   SUPABASE_PUBLISHABLE sb_publishable_...
//   SUPABASE_SECRET      sb_secret_...

const URL_BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE ?? '';
const SECRET = process.env.SUPABASE_SECRET ?? '';

if (!PUBLISHABLE) {
  console.error('Falta SUPABASE_PUBLISHABLE');
  process.exit(1);
}

const filas = [];

function anota(prueba, credencial, status, cuerpo) {
  const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
  filas.push({
    prueba,
    credencial,
    status,
    cuerpo: texto.length > 110 ? texto.slice(0, 110) + '…' : texto,
  });
}

async function rest(ruta, { token, metodo = 'GET', cabeceras = {}, cuerpo } = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1${ruta}`, {
    method: metodo,
    headers: {
      apikey: PUBLISHABLE,
      Authorization: `Bearer ${token ?? PUBLISHABLE}`,
      'Content-Type': 'application/json',
      ...cabeceras,
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { status: res.status, texto: await res.text() };
}

// --- Un usuario real, para medir el rol `authenticated` con un JWT real ------
const EMAIL = 'e12-probe@example.com';
const PASSWORD = 'e12-probe-password-0000';

async function creaUsuarioYToken() {
  if (!SECRET) return null;
  // Idempotente: si ya existe, se borra antes.
  await borraUsuario();
  const alta = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SECRET,
      Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  });
  if (!alta.ok) {
    anota('alta de usuario de sondeo', 'secreta', alta.status, await alta.text());
    return null;
  }
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const datos = await login.json();
  return datos.access_token ?? null;
}

async function borraUsuario() {
  if (!SECRET) return;
  const lista = await fetch(`${URL_BASE}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  });
  if (!lista.ok) return;
  const { users = [] } = await lista.json();
  for (const u of users) {
    if (u.email === EMAIL) {
      await fetch(`${URL_BASE}/auth/v1/admin/users/${u.id}`, {
        method: 'DELETE',
        headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
      });
    }
  }
}

const token = await creaUsuarioYToken();

// --- 1 · Tabla de `public` SIN grant -----------------------------------------
{
  const r = await rest('/e12_public_plain?select=*');
  anota('GET tabla de public sin GRANT', 'publicable (anon)', r.status, r.texto);
}
if (token) {
  const r = await rest('/e12_public_plain?select=*', { token });
  anota('GET tabla de public sin GRANT', 'JWT (authenticated)', r.status, r.texto);
}

// --- 2 · Tabla con RLS activada y SIN politica, pero CON grant ---------------
{
  const r = await rest('/e12_public_rls?select=*');
  anota('GET tabla con GRANT y RLS sin politica', 'publicable (anon)', r.status, r.texto);
}

// --- 3 · Funcion de `public` sin GRANT explicito de EXECUTE ------------------
{
  const r = await rest('/rpc/e12_public_fn', { metodo: 'POST', cuerpo: {} });
  anota('POST rpc de public sin GRANT de EXECUTE', 'publicable (anon)', r.status, r.texto);
}
if (token) {
  const r = await rest('/rpc/e12_public_fn', { metodo: 'POST', cuerpo: {}, token });
  anota('POST rpc de public sin GRANT de EXECUTE', 'JWT (authenticated)', r.status, r.texto);
}

// --- 4 · Schema no expuesto --------------------------------------------------
{
  const r = await rest('/e12_internal_plain?select=*');
  anota('GET tabla de schema no expuesto', 'publicable (anon)', r.status, r.texto);
}
{
  const r = await rest('/e12_internal_plain?select=*', {
    cabeceras: { 'Accept-Profile': 'e12_internal' },
  });
  anota('GET con Accept-Profile: e12_internal', 'publicable (anon)', r.status, r.texto);
}

// --- 5 · Privilegios `Dxtm` por HTTP ----------------------------------------
// PostgREST no expone TRUNCATE. Un DELETE sin filtro es lo mas parecido.
{
  const r = await rest('/e12_public_plain', { metodo: 'DELETE' });
  anota('DELETE sin filtro sobre tabla de public', 'publicable (anon)', r.status, r.texto);
}

// --- 6 · La clave secreta contra la misma tabla sin grant -------------------
if (SECRET) {
  const res = await fetch(`${URL_BASE}/rest/v1/e12_public_plain?select=*`, {
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  });
  anota('GET tabla de public sin GRANT', 'secreta (service_role)', res.status, await res.text());
}

// --- 7 · Identidad efectiva del JWT ------------------------------------------
if (token) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  anota(
    'claims del JWT emitido por GoTrue',
    'JWT',
    200,
    JSON.stringify({ role: payload.role, sub: payload.sub, aud: payload.aud }),
  );
}

await borraUsuario();

console.table(filas);

// --- FASE 2 · control positivo, tras aplicar `45-grants.sql` ----------------
// Distingue "no hay privilegio" (401/403 ruidoso) de "la RLS filtro en
// silencio" (200 con lista vacia, indistinguible de "no hay filas").
if (process.env.E12_FASE2 === '1') {
  const filas2 = [];
  const anota2 = (p, c, s, b) => filas2.push({ prueba: p, credencial: c, status: s, cuerpo: b });

  const a = await rest('/e12_public_plain?select=*');
  anota2('GET con GRANT y SIN RLS', 'publicable (anon)', a.status, a.texto);

  const b = await rest('/e12_public_rls?select=*');
  anota2('GET con GRANT y RLS activada SIN politica', 'publicable (anon)', b.status, b.texto);

  const c = await rest('/e12_public_plain', {
    metodo: 'DELETE',
    cabeceras: { Prefer: 'return=representation' },
    // filtro obligatorio para PostgREST
  });
  anota2('DELETE con GRANT de SELECT pero no de DELETE', 'publicable (anon)', c.status, c.texto);

  console.table(filas2);
}
