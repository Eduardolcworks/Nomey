// E16 · La misma funcion, alcanzada por HTTP con un JWT real.
//
// Confirma que el camino PostgREST -> GUC request.jwt.claims -> SECURITY DEFINER
// del writer se comporta igual que medido a nivel SQL.
//
// Cero dependencias. NO ES UNA MIGRACION.

const BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const PUB = process.env.SUPABASE_PUBLISHABLE;
const SECRET = process.env.SUPABASE_SECRET;
const EMAIL = 'e16-a@probe.local';
const PASSWORD = `e16-${crypto.randomUUID()}`;

if (!PUB || !SECRET) {
  console.error('Faltan SUPABASE_PUBLISHABLE y/o SUPABASE_SECRET.');
  process.exit(1);
}

const cabAdmin = {
  apikey: SECRET,
  Authorization: `Bearer ${SECRET}`,
  'Content-Type': 'application/json',
};

const alta = await fetch(`${BASE}/auth/v1/admin/users`, {
  method: 'POST',
  headers: cabAdmin,
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
});
const usuario = await alta.json();

const login = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: PUB, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const token = (await login.json()).access_token;

console.log(`\n  usuario A creado: ${usuario.id}`);

const r = await fetch(`${BASE}/rest/v1/rpc/e16_probe`, {
  method: 'POST',
  headers: { apikey: PUB, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: '{}',
});
console.log(`  HTTP  : ${r.status}`);
console.log(`  cuerpo: ${(await r.text()).replace(/\s+/g, ' ')}`);

// Limpieza del usuario de prueba.
await fetch(`${BASE}/auth/v1/admin/users/${usuario.id}`, { method: 'DELETE', headers: cabAdmin });
console.log('  usuario A borrado');
