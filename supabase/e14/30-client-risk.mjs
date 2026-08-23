// E14 · Donde ocurre realmente la degradacion en la escritura.
//
// No hace falta red ni base de datos: el fallo sucede entero dentro del cliente,
// antes de que ningun byte salga.
//
// **Ni PostgreSQL ni PostgREST tienen parte en esto.** 20-http.mjs mide que
// PostgREST conserva exactamente los digitos que recibe. Si lo que recibe ya
// esta mal, los conserva igual de bien.
//
// Cero dependencias. NO ES UNA MIGRACION.

const EXACTO = '9007199254740993'; // 2^53 + 1

console.log('\n===== La degradacion ocurre en el cliente =====\n');

// Un cliente que trata el importe como number de JavaScript.
const cuerpoMal = JSON.stringify({ v: 9007199254740993 });
console.log(`  JSON.stringify({ v: 9007199254740993 })`);
console.log(`    -> ${cuerpoMal}`);

// Un cliente que lo trata como cadena, que es lo que exige ADR-003 §6.
const cuerpoBien = JSON.stringify({ v: EXACTO });
console.log(`\n  JSON.stringify({ v: '${EXACTO}' })`);
console.log(`    -> ${cuerpoBien}`);

const salioIntacto = cuerpoMal.includes(EXACTO);

console.log(`
  ¿Los bytes del primer caso contienen el valor exacto? ${salioIntacto ? 'SI' : 'NO'}

  El servidor recibiria "9007199254740992": una cadena perfectamente exacta
  DEL VALOR EQUIVOCADO, indistinguible de un valor legitimo. Ningun cast del
  lado servidor puede recuperarlo, porque la perdida ya ocurrio.

  Por eso la garantia de ADR-003 §6 tiene que cubrir tambien la salida del
  cliente, y no solo la entrada.
`);

// Que el sondeo falle si algun dia esto dejara de ser cierto.
if (salioIntacto) {
  console.error('INESPERADO: el number no se degrado. Revisar el runtime.');
  process.exit(1);
}
