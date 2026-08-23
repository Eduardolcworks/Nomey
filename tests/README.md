# Tests

```
tests/
├── domain/    lógica financiera pura (prioridad máxima)
├── vectors/   vectores compartidos: la única fuente de expectativas
└── rls/       aislamiento entre usuarios en Supabase (Fase 3.C)
```

## Runner

**Vitest**, elegido en la Fase 3.B. Se ejecuta con:

```bash
npm test
```

Se consideró `node --test`, que ejecuta TypeScript de forma nativa en Node 22 y
no habría añadido ninguna dependencia. Se descartó porque **obliga a escribir la
extensión en cada import** —`./money.ts`— y esa convención habría entrado en el
`tsconfig` raíz, quedando disponible para todo el proyecto. Dos convenciones de
import conviviendo cuestan más a largo plazo que una dependencia de desarrollo
que nunca entra en el bundle.

El typecheck de los tests está **separado** del de la aplicación
(`tests/tsconfig.json`), para que los globales del entorno de test no aparezcan
como válidos dentro del código React Native. `npm run typecheck` ejecuta los dos.

## Principio

Los tests de `domain/` **no son una fase posterior**. Se escriben en el mismo
PR que la lógica que verifican. Es matemática pura, cuesta minutos, y es donde
un error significa comunicar a una persona real una deuda equivocada.

## Vectores compartidos

`tests/vectors/` contiene ficheros **JSON**, no módulos TypeScript, y es
deliberado: la implementación autoritativa del servidor deberá consumir **los
mismos ficheros** para que cualquier divergencia entre las dos implementaciones
salte, como exige ADR-002 §7.

Reglas del formato:

- **Todos los valores exactos viajan como `string`.** Un número JSON grande se
  degrada al parsearse —medido en E11—, así que un fichero de vectores con
  números sería un fichero de vectores incorrecto.
- **Cada caso declara su fuente normativa** en `source`. Un vector sin regla
  detrás no demuestra nada.
- Un caso espera **o un resultado (`expect`) o un código de error
  (`expectError`)**. Los códigos de `DomainError` son parte del contrato entre
  las dos implementaciones; los mensajes humanos no.
- **Ninguna expectativa se escribe en el código de test.** Si hay que cambiar un
  resultado esperado, se cambia el vector.

| Fichero           | Qué cubre                                                       |
| ----------------- | --------------------------------------------------------------- |
| `currencies.json` | Definiciones monetarias, incluidas dos que comparten código ISO |
| `rounding.json`   | _half away from zero_, empates, negativos, más allá de 2^53     |
| `conversion.json` | Conversión exacta, cambios de escala, importes enormes          |
| `money.json`      | Aritmética, comparación y definiciones incompatibles            |
| `split.json`      | `equal`, `shares`, `exact_amounts`, indivisibilidad y errores   |
| `scenarios.json`  | Los escenarios de `data-model.md` §4                            |

Y dos suites que no consumen vectores porque comprueban otra cosa:
`properties.test.ts` verifica invariantes que deben cumplirse **siempre** —la
suma de un reparto, la simetría de signo, que una liquidación no mueve saldo—, y
`errors.test.ts` comprueba que todo código esperado por un vector existe en el
contrato de `DomainError`.

## Demostrar una regresión

Una suite que solo pasa no demuestra nada: hay que comprobar que **falla cuando
debe**. Procedimiento, reproducible en un minuto:

1. En `src/domain/split/split.ts`, invierte el desempate de `tieBreakPriority`
   devolviendo `index` en lugar de `-1` para el pagador.
2. `npm test`.
3. Deben caer **exactamente los vectores cuyo resultado depende del
   desempate**, no la suite entera. Medido el 2026-08-20: **3 de 110**, y son
   precisamente aquellos en los que el pagador **no** ocupa la primera posición
   de la lista — `equal-el-pagador-no-va-primero`,
   `equal-indivisible-pagador-en-medio` y `equal-resto-multiple` —. Los demás
   siguen pasando porque su pagador ya iba primero y el desempate no los
   distingue.
4. Revierte el cambio y vuelve a ejecutar: 110 de 110.

Si al romper la regla no falla nada, el vector que la cubría no existe.

## Tests de RLS

Verifican con dos usuarios reales que ninguno puede leer ni escribir los datos
del otro, y que **ningún rol cliente puede escribir efectos contables**, ni
siquiera los propios. Cubren lo que una revisión visual de las políticas no
alcanza a comprobar. Llegan en la **Fase 3.C**.
