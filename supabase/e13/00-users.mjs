// E13 · Alta de los dos usuarios de prueba, con JWT reales de GoTrue.
//
// Cero dependencias: usa el fetch nativo de Node 22. Los valores de entorno son
// los que imprime `npx supabase start`: son locales de desarrollo, NO son
// credenciales reales.
//
// NO ES UNA MIGRACION.

const BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SECRET = process.env.SUPABASE_SECRET;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE;

// Contraseña efímera, generada en cada ejecución y usada solo dentro de este
// proceso: se da de alta con ella y se inicia sesión acto seguido. No se
// escribe en ningún sitio y los usuarios se borran en el teardown.
//
// Deliberadamente NO es un literal en el repositorio: aunque estos usuarios
// sean desechables y locales, una contraseña versionada acaba copiándose a
// donde no debe.
const PASSWORD = `e13-${crypto.randomUUID()}`;

if (!SECRET || !PUBLISHABLE) {
  console.error('Faltan SUPABASE_SECRET y/o SUPABASE_PUBLISHABLE.');
  process.exit(1);
}

async function alta(email) {
  const r = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SECRET,
      Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  const d = await r.json();
  if (!d.id) throw new Error(`alta de ${email} fallo: ${JSON.stringify(d).slice(0, 200)}`);

  const l = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const t = await l.json();
  return { email, id: d.id, token: t.access_token };
}

const a = await alta('e13-a@probe.local');
const b = await alta('e13-b@probe.local');

console.log(JSON.stringify({ a, b }, null, 2));
console.error('\nExporta los tokens para 50-http.mjs:');
console.error(`export TOKEN_A=${a.token}`);
console.error(`export TOKEN_B=${b.token}`);
