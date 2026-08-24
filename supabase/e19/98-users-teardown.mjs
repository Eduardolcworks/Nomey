// E19 · Borra los dos usuarios de prueba de GoTrue.
//
// Cero dependencias: fetch nativo de Node 22. NO ES UNA MIGRACION.

const BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SECRET = process.env.SUPABASE_SECRET;

if (!SECRET) {
  console.error('Falta SUPABASE_SECRET.');
  process.exit(1);
}

const h = { apikey: SECRET, Authorization: `Bearer ${SECRET}` };

const lista = await (await fetch(`${BASE}/auth/v1/admin/users`, { headers: h })).json();

for (const u of lista.users ?? []) {
  if (!/^e19-[ab]@probe\.local$/.test(u.email)) continue;
  const r = await fetch(`${BASE}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: h });
  console.log(`  ${r.status}  borrado ${u.email}`);
}

const quedan = await (await fetch(`${BASE}/auth/v1/admin/users`, { headers: h })).json();
const restos = (quedan.users ?? []).filter((u) => /^e19-/.test(u.email ?? ''));
console.log(`\n  usuarios e19 restantes: ${restos.length}`);
