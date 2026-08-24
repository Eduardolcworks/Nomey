// E19-A · La cadena de dos vistas vista desde fuera, con JWT reales.
//
// Dos preguntas distintas, que no se deben fundir:
//   a) atravesar dos niveles `security_invoker` por HTTP, ¿sigue aislando?
//   b) tener los privilegios SQL que esa cadena exige —incluido SELECT sobre
//      las tablas de `core`— ¿abre por si solo una ruta HTTP hacia `core`?
//
// E13 respondio (b) para UN nivel. Aqui se comprueba que anadir un nivel no
// cambia la respuesta.
//
// Ni `e19_core` ni `e19_api` estan en `config.toml`, asi que ninguna de las dos
// deberia ser alcanzable: el contraste util es que los privilegios existen y la
// ruta no.
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

const corta = (s, n = 220) => s.replace(/\s+/g, ' ').slice(0, n);

async function rest(nombre, ruta, { token, perfil } = {}) {
  const h = { apikey: PUB, Authorization: `Bearer ${token ?? PUB}` };
  if (perfil) h['Accept-Profile'] = perfil;
  const r = await fetch(`${BASE}/rest/v1${ruta}`, { headers: h });
  console.log(`  ${r.status}  ${nombre}\n        ${corta(await r.text())}`);
}

console.log('\n===== La superficie e19_api no esta expuesta =====\n');
await rest('e19_api.effect_v con JWT de A', '/effect_v?select=*', {
  token: TOKEN_A,
  perfil: 'e19_api',
});
await rest('e19_api.effect_v sin Accept-Profile', '/effect_v?select=*', { token: TOKEN_A });

console.log('\n===== Intento de alcanzar e19_core directamente =====\n');
console.log('  `authenticated` TIENE SELECT sobre estas relaciones tras 20-chain.sql.\n');
for (const rel of ['effect', 'current_effect', 'operation', 'operation_version', 'membership']) {
  await rest(`e19_core.${rel} con JWT de A y Accept-Profile`, `/${rel}?select=*`, {
    token: TOKEN_A,
    perfil: 'e19_core',
  });
}

console.log('\n===== Sin sesion y con usuario B, por si la ruta existiera =====\n');
await rest('e19_core.effect con clave publicable', '/effect?select=*', { perfil: 'e19_core' });
if (TOKEN_B) {
  await rest('e19_api.effect_v con JWT de B', '/effect_v?select=*', {
    token: TOKEN_B,
    perfil: 'e19_api',
  });
}
