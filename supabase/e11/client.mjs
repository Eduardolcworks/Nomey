// E11 · FRONTERA DIRECTA. Qué recibe realmente supabase-js / postgrest-js.
import { createClient } from '@supabase/supabase-js';

const URL_BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const KEY = process.env.SUPABASE_KEY;
if (!KEY) {
  console.error('Falta SUPABASE_KEY');
  process.exit(1);
}
const sb = createClient(URL_BASE, KEY, { auth: { persistSession: false } });

// Valor exacto tal y como está en PostgreSQL.
const PG_BIGINT = {
  1: '8620',
  2: '9007199254740991',
  3: '9007199254740992',
  4: '9007199254740993',
  5: '9223372036854775807',
  6: '-9007199254740993',
  7: '92233720368547758',
};
const PG_NUMERIC = {
  1: '8620',
  8: '0.862034781245',
  9: '1.163842000000',
  10: '12345678901234567890.123456',
};
const PG_NUMERIC_PS = {
  1: '8620.000000000000',
  8: '0.862034781245',
  9: '1.163842000000',
};

const q = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
const ok = (b) => (b ? 'sí' : '*** NO ***');

console.log('='.repeat(104));
console.log('E11 · FRONTERA DIRECTA — LECTURA DE TABLA CON supabase-js');
console.log('='.repeat(104));

const { data, error } = await sb.from('e11_probe').select('*').order('id');
if (error) throw error;

console.log('\nBIGINT');
console.log('id  typeof     recibido                   exacto en PG               intacto');
console.log('-'.repeat(104));
for (const r of data) {
  if (r.v_bigint === null) continue;
  console.log(
    `${String(r.id).padEnd(3)} ${(typeof r.v_bigint).padEnd(10)} ${q(r.v_bigint).padEnd(26)} ${PG_BIGINT[r.id].padEnd(26)} ${ok(String(r.v_bigint) === PG_BIGINT[r.id])}`,
  );
}

console.log('\nNUMERIC (sin precisión declarada)');
console.log(
  'id  typeof     recibido                          exacto en PG                      intacto',
);
console.log('-'.repeat(104));
for (const r of data) {
  if (r.v_numeric === null) continue;
  console.log(
    `${String(r.id).padEnd(3)} ${(typeof r.v_numeric).padEnd(10)} ${q(r.v_numeric).padEnd(33)} ${(PG_NUMERIC[r.id] ?? '—').padEnd(33)} ${ok(String(r.v_numeric) === PG_NUMERIC[r.id])}`,
  );
}

console.log('\nNUMERIC(30,12)');
console.log(
  'id  typeof     recibido                          exacto en PG                      intacto',
);
console.log('-'.repeat(104));
for (const r of data) {
  if (r.v_numeric_ps === null) continue;
  console.log(
    `${String(r.id).padEnd(3)} ${(typeof r.v_numeric_ps).padEnd(10)} ${q(r.v_numeric_ps).padEnd(33)} ${(PG_NUMERIC_PS[r.id] ?? '—').padEnd(33)} ${ok(String(r.v_numeric_ps) === PG_NUMERIC_PS[r.id])}`,
  );
}

console.log('\nTEXT (control: mismo dígito a dígito que v_bigint)');
console.log('id  typeof     recibido                   intacto');
console.log('-'.repeat(104));
for (const r of data) {
  if (r.v_text === null || !PG_BIGINT[r.id]) continue;
  console.log(
    `${String(r.id).padEnd(3)} ${(typeof r.v_text).padEnd(10)} ${q(r.v_text).padEnd(26)} ${ok(r.v_text === PG_BIGINT[r.id])}`,
  );
}

console.log('\n' + '='.repeat(104));
console.log('E11 · ESCRITURA CON supabase-js');
console.log('='.repeat(104));

await sb.from('e11_writeback').delete().gte('id', 0);

const casos = [
  { id: 10, note: 'string', v_bigint: '9007199254740993' },
  { id: 11, note: 'string int64 max', v_bigint: '9223372036854775807' },
  { id: 12, note: 'Number() degradado', v_bigint: Number('9007199254740993') },
];
for (const c of casos) {
  const { error: e } = await sb.from('e11_writeback').insert(c);
  console.log(`  insert id=${c.id} (${c.note}) -> ${e ? 'ERROR ' + e.message : 'ok'}`);
}

// E4 aplicado a la frontera: ¿puede un BigInt nativo cruzar supabase-js?
try {
  const { error: e } = await sb
    .from('e11_writeback')
    .insert({ id: 13, note: 'BigInt nativo', v_bigint: 9007199254740993n });
  console.log(`  insert id=13 (BigInt nativo) -> ${e ? 'ERROR ' + e.message : 'ok'}`);
} catch (e) {
  console.log(`  insert id=13 (BigInt nativo) -> ${e.constructor.name}: ${e.message}`);
}

const { data: back } = await sb.from('e11_writeback').select('*').order('id');
console.log('\n  releído por supabase-js:');
for (const r of back ?? []) {
  console.log(
    `    id=${String(r.id).padEnd(3)} ${String(r.note).padEnd(20)} v_bigint=${q(r.v_bigint).padEnd(22)} (${typeof r.v_bigint})`,
  );
}
