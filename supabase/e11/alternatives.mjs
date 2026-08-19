// E11 · FRONTERAS ALTERNATIVAS.
// Solo se ejecuta si la frontera directa incumple algún invariante de ADR-003.
import { createClient } from '@supabase/supabase-js';

const URL_BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const KEY = process.env.SUPABASE_KEY;
if (!KEY) {
  console.error('Falta SUPABASE_KEY');
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const sb = createClient(URL_BASE, KEY, { auth: { persistSession: false } });

const PG = {
  1: '8620',
  2: '9007199254740991',
  3: '9007199254740992',
  4: '9007199254740993',
  5: '9223372036854775807',
  6: '-9007199254740993',
  7: '92233720368547758',
};
const q = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
const ok = (b) => (b ? 'sí' : '*** NO ***');

async function raw(label, path, init = {}) {
  const res = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: { ...H, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  console.log(`\n--- ${label}`);
  console.log(`    HTTP ${res.status}`);
  console.log(`    ${text}`);
}

console.log('='.repeat(104));
console.log('E11 · ALTERNATIVA 1 · VISTA CON ::text EN EL SERVIDOR');
console.log('='.repeat(104));

await raw('HTTP crudo de la vista', '/rest/v1/e11_probe_text?select=*&id=in.(1,4,5,8,9)&order=id');

{
  const { data, error } = await sb.from('e11_probe_text').select('*').order('id');
  if (error) throw error;
  console.log('\nsupabase-js sobre la vista:');
  console.log('id  typeof   v_bigint_text              intacto');
  console.log('-'.repeat(104));
  for (const r of data) {
    if (r.v_bigint_text === null) continue;
    console.log(
      `${String(r.id).padEnd(3)} ${(typeof r.v_bigint_text).padEnd(8)} ${q(r.v_bigint_text).padEnd(26)} ${ok(r.v_bigint_text === PG[r.id])}`,
    );
  }
  const r9 = data.find((x) => x.id === 9);
  console.log(`\n  id 9 · v_numeric_text    = ${q(r9.v_numeric_text)}`);
  console.log(
    `  id 9 · v_numeric_ps_text = ${q(r9.v_numeric_ps_text)}   <- ¿conserva los ceros finales?`,
  );
  const r10 = data.find((x) => x.id === 10);
  console.log(`  id 10 · v_numeric_text   = ${q(r10.v_numeric_text)}`);
}

console.log('\n' + '='.repeat(104));
console.log('E11 · ALTERNATIVA 2 · RPC QUE DEVUELVE json CON CAMPOS CASTEADOS A TEXTO');
console.log('='.repeat(104));

await raw('HTTP crudo del RPC', '/rest/v1/rpc/e11_probe_json', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_id: 4 }),
});

{
  const { data, error } = await sb.rpc('e11_probe_json', { p_id: 4 });
  if (error) throw error;
  console.log('\nsupabase-js sobre el RPC:');
  console.log('  typeof(data)      =', typeof data);
  console.log('  data.v_bigint     =', q(data.v_bigint), ' typeof =', typeof data.v_bigint);
  console.log('  intacto           =', ok(data.v_bigint === PG[4]));
  console.log('  data.v_numeric_ps =', q(data.v_numeric_ps));
}

console.log('\n' + '='.repeat(104));
console.log('E11 · ALTERNATIVA 3 · RPC QUE DEVUELVE bigint SIN CASTEAR');
console.log('='.repeat(104));

await raw('HTTP crudo del RPC', '/rest/v1/rpc/e11_probe_raw_bigint', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_id: 4 }),
});

{
  const { data, error } = await sb.rpc('e11_probe_raw_bigint', { p_id: 4 });
  if (error) throw error;
  console.log('\nsupabase-js sobre el RPC:');
  console.log('  typeof(data) =', typeof data);
  console.log('  data         =', q(data));
  console.log('  intacto      =', ok(String(data) === PG[4]));
}
