// E14 · Que hace PostgREST con un argumento SQL `text`.
//
// La pregunta: ¿exige PostgREST que el valor llegue como JSON string, o acepta
// tambien un JSON number y lo coacciona a texto?
//
// **Los cuerpos van como cadenas literales, a proposito.** Construirlos con
// `JSON.stringify({ v: 9007199254740993 })` degradaria el valor ANTES de salir
// —eso se demuestra aparte, en 30-client-risk.mjs— y mediriamos otra cosa.
// Aqui controlamos los bytes exactos que viajan por el cable.
//
// Cero dependencias: fetch nativo de Node 22. NO ES UNA MIGRACION.

const BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const PUB = process.env.SUPABASE_PUBLISHABLE;

if (!PUB) {
  console.error('Falta SUPABASE_PUBLISHABLE. Lo imprime `npx supabase start`.');
  process.exit(1);
}

async function llamar(fn, cuerpoLiteral) {
  const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: PUB,
      Authorization: `Bearer ${PUB}`,
      'Content-Type': 'application/json',
    },
    body: cuerpoLiteral, // cadena literal, sin pasar por JSON.stringify
  });
  return { status: r.status, cuerpo: (await r.text()).replace(/\s+/g, ' ') };
}

async function caso(etiqueta, fn, cuerpoLiteral) {
  const { status, cuerpo } = await llamar(fn, cuerpoLiteral);
  console.log(`\n  ${etiqueta}`);
  console.log(`    enviado : ${cuerpoLiteral}`);
  console.log(`    HTTP    : ${status}`);
  console.log(`    recibido: ${cuerpo}`);
}

console.log('\n===== Parametro SQL `text` =====');
await caso('A · JSON string grande', 'e14_echo_text', '{"p_value":"9007199254740993"}');
await caso('B · JSON number grande', 'e14_echo_text', '{"p_value":9007199254740993}');
await caso('C · JSON number normal', 'e14_echo_text', '{"p_value":123}');
await caso('D1 · JSON number decimal', 'e14_echo_text', '{"p_value":1.5}');
await caso('D2 · JSON null', 'e14_echo_text', '{"p_value":null}');

console.log('\n===== Payload `jsonb`: el tipo JSON original SI es observable =====');
await caso('string', 'e14_echo_jsonb', '{"p_payload":{"v":"9007199254740993"}}');
await caso('number', 'e14_echo_jsonb', '{"p_payload":{"v":9007199254740993}}');
await caso('null', 'e14_echo_jsonb', '{"p_payload":{"v":null}}');

console.log(`
===== Lectura de los resultados =====

  Con parametro \`text\`, los cinco casos se aceptan con HTTP 200 y PostgREST
  conserva EXACTAMENTE los digitos que recibio. No degrada nada.

  Pero tampoco exige que el tipo JSON original fuese \`string\`: un number se
  coacciona a texto, y una vez convertido el parametro ya no puede distinguir
  de donde venia.

  Con payload \`jsonb\`, \`jsonb_typeof\` si distingue string, number y null sobre
  exactamente los mismos bytes.

  **Eso es un hecho medido, no una decision.** Que mecanismo use la frontera
  autoritativa de escritura para comprobar el tipo JSON pertenece a D7.
`);
