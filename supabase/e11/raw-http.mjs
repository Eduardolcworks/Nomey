// E11 · FRONTERA DIRECTA. Bytes crudos que devuelve PostgREST, antes de que
// ningún JS los toque. Solo la tabla directa: las fronteras alternativas se
// miden aparte, y solo si esta incumple algún invariante de ADR-003.
const URL_BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const KEY = process.env.SUPABASE_KEY;
if (!KEY) {
  console.error('Falta SUPABASE_KEY');
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function raw(label, path, init = {}) {
  const res = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: { ...H, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  console.log(`\n--- ${label}`);
  console.log(`    ${init.method ?? 'GET'} ${path}`);
  console.log(`    HTTP ${res.status}  content-type: ${res.headers.get('content-type')}`);
  console.log(`    bytes: ${Buffer.byteLength(text, 'utf8')}`);
  console.log(text);
  return text;
}

console.log('='.repeat(78));
console.log('E11 · FRONTERA DIRECTA — RESPUESTA HTTP CRUDA DE POSTGREST');
console.log('='.repeat(78));

await raw(
  'BIGINT · casos límite alrededor de 2^53',
  '/rest/v1/e11_probe?select=id,label,v_bigint,v_text&id=in.(1,2,3,4,5,6,7)&order=id',
);

await raw(
  'NUMERIC y NUMERIC(30,12)',
  '/rest/v1/e11_probe?select=id,label,v_numeric,v_numeric_ps,v_text&id=in.(1,8,9,10)&order=id',
);

console.log('\n' + '='.repeat(78));
console.log('E11 · IDA Y VUELTA DE ESCRITURA (HTTP crudo)');
console.log('='.repeat(78));

await raw('Limpiar destino', '/rest/v1/e11_writeback?id=gte.0', { method: 'DELETE' });

await raw('A · bigint enviado como STRING "9007199254740993"', '/rest/v1/e11_writeback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({
    id: 1,
    note: 'string',
    v_bigint: '9007199254740993',
    v_numeric_ps: '0.862034781245',
  }),
});

// Cuerpo construido a mano: si se usara JSON.stringify sobre un Number, el
// valor ya vendría degradado desde el propio JS y no mediría la frontera.
await raw('B · bigint enviado como NÚMERO JSON 9007199254740993', '/rest/v1/e11_writeback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: '{"id":2,"note":"numero JSON","v_bigint":9007199254740993,"v_numeric_ps":0.862034781245}',
});

const degradado = Number('9007199254740993');
await raw(`C · bigint tras pasar por Number() → ${degradado}`, '/rest/v1/e11_writeback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({
    id: 3,
    note: 'Number() degradado',
    v_bigint: degradado,
    v_numeric_ps: 0.862034781245,
  }),
});

await raw('D · int64 máximo como STRING', '/rest/v1/e11_writeback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ id: 4, note: 'int64 max string', v_bigint: '9223372036854775807' }),
});
