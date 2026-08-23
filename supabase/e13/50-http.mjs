// E13 · Superficies HTTP: PostgREST y GraphQL.
//
// La pregunta que responde: tener el privilegio SQL minimo que exige una vista
// `security_invoker` —incluido SELECT sobre una tabla de `core`— ¿crea por si
// solo una ruta HTTP hacia `core`?
//
// Son dos afirmaciones distintas y no se deben fundir:
//   a) un rol POSEE un privilegio;
//   b) existe una ruta HTTP capaz de ejercerlo.
//
// Cero dependencias: fetch nativo de Node 22. NO ES UNA MIGRACION.

const BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const PUB = process.env.SUPABASE_PUBLISHABLE;
const TOKEN_A = process.env.TOKEN_A;
const TOKEN_B = process.env.TOKEN_B;

if (!PUB) {
  console.error('Falta SUPABASE_PUBLISHABLE.');
  process.exit(1);
}

const corta = (s, n = 200) => s.replace(/\s+/g, ' ').slice(0, n);

async function rest(nombre, ruta, { token, perfil } = {}) {
  const h = { apikey: PUB, Authorization: `Bearer ${token ?? PUB}` };
  if (perfil) h['Accept-Profile'] = perfil;
  const r = await fetch(`${BASE}/rest/v1${ruta}`, { headers: h });
  console.log(`  ${r.status}  ${nombre}\n        ${corta(await r.text())}`);
}

async function gql(nombre, query, { token } = {}) {
  const r = await fetch(`${BASE}/graphql/v1`, {
    method: 'POST',
    headers: {
      apikey: PUB,
      Authorization: `Bearer ${token ?? PUB}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  console.log(`  ${r.status}  ${nombre}\n        ${corta(await r.text(), 400)}`);
}

console.log('\n===== PostgREST · intento de alcanzar e13_core directamente =====\n');
await rest('e13_core.item con JWT de A y Accept-Profile', '/item?select=*', {
  token: TOKEN_A,
  perfil: 'e13_core',
});
await rest('e13_core.membership con JWT de A y Accept-Profile', '/membership?select=*', {
  token: TOKEN_A,
  perfil: 'e13_core',
});
await rest('e13_core.item con JWT de A, sin Accept-Profile', '/item?select=*', { token: TOKEN_A });
await rest('e13_core.item con clave publicable', '/item?select=*', { perfil: 'e13_core' });

console.log('\n===== PostgREST · la superficie e13_api tampoco esta expuesta =====\n');
await rest('e13_api.item_v con JWT de A', '/item_v?select=*', {
  token: TOKEN_A,
  perfil: 'e13_api',
});

console.log('\n===== GraphQL · estado de la superficie =====\n');
await gql('introspeccion minima', '{ __schema { queryType { name } } }', { token: TOKEN_A });

console.log('\n===== GraphQL · intento de alcanzar e13_core =====\n');
for (const nombre of ['item', 'itemCollection', 'e13_coreItemCollection']) {
  await gql(`consulta ${nombre}`, `{ ${nombre} { __typename } }`, { token: TOKEN_A });
}

if (TOKEN_B) {
  console.log('\n===== GraphQL · usuario B, por si la superficie existiera =====\n');
  await gql('itemCollection con JWT de B', '{ itemCollection { __typename } }', { token: TOKEN_B });
}
