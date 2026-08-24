// E15-A · Que devuelve PostgREST para cada forma de error.
//
// Cero dependencias: fetch nativo de Node 22. NO ES UNA MIGRACION.

const BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const PUB = process.env.SUPABASE_PUBLISHABLE;

if (!PUB) {
  console.error('Falta SUPABASE_PUBLISHABLE. Lo imprime `npx supabase start`.');
  process.exit(1);
}

const CASOS = [
  ['1 · RAISE EXCEPTION sin errcode (P0001 por defecto)', 'e15_raise_default'],
  ['2 · P0001 con message / detail / hint', 'e15_raise_p0001'],
  ['3 · SQLSTATE 42501 · privilegio insuficiente', 'e15_raise_privilege'],
  ['4 · SQLSTATE 23505 · unique_violation', 'e15_raise_unique'],
  ['5 · SQLSTATE 23514 · check_violation', 'e15_raise_check'],
  ['6 · SQLSTATE PGRST · status y cuerpo explicitos', 'e15_raise_pgrst'],
];

for (const [etiqueta, fn] of CASOS) {
  const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: PUB,
      Authorization: `Bearer ${PUB}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const cuerpo = (await r.text()).replace(/\s+/g, ' ');
  console.log(`\n  ${etiqueta}`);
  console.log(`    HTTP  : ${r.status}`);
  console.log(`    cuerpo: ${cuerpo.slice(0, 260)}`);
}
