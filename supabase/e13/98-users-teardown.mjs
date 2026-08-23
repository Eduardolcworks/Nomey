// E13 · Borrado de los usuarios de prueba. Idempotente.
//
// NO ES UNA MIGRACION.

const BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SECRET = process.env.SUPABASE_SECRET;

if (!SECRET) {
  console.error('Falta SUPABASE_SECRET.');
  process.exit(1);
}

const cab = { apikey: SECRET, Authorization: `Bearer ${SECRET}` };
const r = await fetch(`${BASE}/auth/v1/admin/users?per_page=200`, { headers: cab });
const d = await r.json();

let n = 0;
for (const u of d.users ?? []) {
  if ((u.email ?? '').startsWith('e13-')) {
    await fetch(`${BASE}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: cab });
    console.log('borrado', u.email);
    n += 1;
  }
}
console.log(`usuarios e13 borrados: ${n}`);
