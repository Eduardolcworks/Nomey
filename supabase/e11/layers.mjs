// E11 · Los cuatro niveles: schema expuesto -> objeto -> GRANT -> RLS.
const URL_BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const KEY = process.env.SUPABASE_KEY;
if (!KEY) {
  console.error('Falta SUPABASE_KEY');
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const casos = [
  {
    nivel: '1 · schema NO expuesto',
    detalle: 'e11_hidden.secreto — con GRANT y con RLS permisiva',
    path: '/rest/v1/secreto?select=*',
    extra: {},
  },
  {
    nivel: '1 · schema NO expuesto, header explícito',
    detalle: 'mismo objeto pidiendo el schema con Accept-Profile',
    path: '/rest/v1/secreto?select=*',
    extra: { 'Accept-Profile': 'e11_hidden' },
  },
  {
    nivel: '2+3 · expuesto, existe, SIN grant',
    detalle: 'public.e11_l3_no_grant — RLS permisiva pero sin GRANT',
    path: '/rest/v1/e11_l3_no_grant?select=*',
    extra: {},
  },
  {
    nivel: '4a · expuesto, con grant, RLS SIN política',
    detalle: 'public.e11_l4_rls_sin_politica',
    path: '/rest/v1/e11_l4_rls_sin_politica?select=*',
    extra: {},
  },
  {
    nivel: '4b · expuesto, con grant, RLS CON política filtrante',
    detalle: 'public.e11_l4_rls_con_politica — 2 filas, política deja pasar 1',
    path: '/rest/v1/e11_l4_rls_con_politica?select=*',
    extra: {},
  },
  {
    nivel: 'control · todo correcto',
    detalle: 'public.e11_probe — expuesto, con grant, RLS permisiva',
    path: '/rest/v1/e11_probe?select=id&limit=1',
    extra: {},
  },
];

console.log('='.repeat(100));
console.log('E11 · SEPARACIÓN DE NIVELES: schema expuesto -> objeto -> GRANT -> RLS');
console.log('='.repeat(100));

for (const c of casos) {
  const res = await fetch(`${URL_BASE}${c.path}`, { headers: { ...H, ...c.extra } });
  const body = await res.text();
  console.log(`\n${c.nivel}`);
  console.log(`  ${c.detalle}`);
  console.log(`  HTTP ${res.status}`);
  console.log(`  ${body.length > 300 ? body.slice(0, 300) + '…' : body}`);
}
