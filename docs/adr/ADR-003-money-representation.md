# ADR-003 — Representación exacta del dinero

- **Estado:** Aceptado
- **Fecha:** 2026-08-19
- **Aceptado el:** 2026-08-19, tras cumplir su puerta de aceptación: el
  experimento **E11** sobre la frontera PostgreSQL → PostgREST → cliente (§10).
  **E11 no falsificó la estrategia de este ADR**: confirmó sus supuestos de
  almacenamiento y demostró que T8 es necesaria para hacer cumplir T7.

> El análisis extenso, las mediciones completas y el rastro de cómo se llegó
> aquí viven en [`architecture/money-representation.md`](../architecture/money-representation.md),
> que es **no normativo**. Este ADR es la fuente normativa; aquel, el archivo de
> evidencia.

## Contexto

`AGENTS.md` §1 fija invariantes de producto sobre el dinero —representación
exacta, moneda explícita, escala por moneda, reparto determinista— y deja
abierta **la representación concreta**, con el encargo explícito de verificar
empíricamente cómo sobrevive cada tipo numérico al viaje hasta el cliente.

[ADR-002](ADR-002-accounting-model.md) fijó el modelo contable y dejó
pendiente, en otros ADR, «representación exacta del importe» y «origen y ajuste
del tipo de cambio».

El problema es que **el dinero mal representado no falla: produce cifras
plausibles**. La coma flotante binaria pierde precisión en silencio, un entero
grande se degrada al cruzar JSON como número, y una conversión de moneda pierde
información en una dirección y no en la otra. Todo eso está **medido** en el
documento de trabajo (E1–E15) y no se repite aquí.

Nomey es **multi-moneda por diseño** aunque su interfaz muestre una sola, y
admite entrada sin conexión que se sincroniza días después. Ambas cosas obligan
a decidir no solo cómo se guarda un importe, sino **qué importe manda** cuando
hay dos, y **qué momento manda** cuando hay dos.

## Decisión

### 1. El importe declarado es el autoritativo

**Cada operación tiene exactamente un importe original**, el que el usuario
introdujo, con su moneda. Todo importe expresado en la moneda base de un ámbito
es **derivado, redondeado, almacenado** y usado para los efectos de ese ámbito.

> **Nunca se reconstruye el importe original a partir de un derivado.** La
> reconstrucción falla en una de las dos direcciones y los tipos publicados
> recíprocos no son inversos exactos.

La interfaz refleja esa jerarquía: el original es el valor principal y la
conversión se muestra de forma **visualmente secundaria**.

**Una operación tiene un único importe original, pero puede tener varias
conversiones derivadas**, cada una con el tipo exacto usado para esa derivación.
No existe un tipo de cambio global por operación.

### 2. Representación exacta

**Los importes monetarios se representan como enteros en la unidad mínima de su
definición monetaria.**

```
86,20 EUR  ->  8620          100 JPY  ->  100          1,234 BHD  ->  1234
```

- En TypeScript: `bigint`.
- En PostgreSQL, cuando se diseñe el esquema: `BIGINT`, cuyo rango es suficiente
  para el dominio previsto.
- **`number` de JavaScript queda prohibido para valores monetarios contables.**
- **`NUMERIC` no es la representación principal de un importe.**

**`Money` encapsula, como mínimo, la cantidad exacta en unidades mínimas y la
identidad de la definición monetaria aplicable.**

```
Money { minor: bigint, currencyDefinition }
```

La moneda **no es un string libre**. Las operaciones de dominio deben impedir
sumar definiciones incompatibles, comparar cantidades incompatibles y hacer
aritmética monetaria con `number`. La API concreta no se decide aquí.

### 3. La definición monetaria, no el código

**Cada definición monetaria usada por hechos financieros tiene una identidad
interna estable e inmutable**, que representa la definición aplicada al hecho y
no solo el código ISO visible. Una definición conoce al menos su **código
visible**, su **escala o unidad mínima** y esa **identidad estable**.

> **El significado monetario de un hecho histórico es inmutable.** Un cambio
> posterior en la metadata de una moneda nunca lo reinterpreta. Si `1000`
> significaba `10,00` al registrarse, sigue significándolo.

Dos casos que **no se tratan igual**:

- **Cambio real de la moneda** —redenominación, cambio de definición—: los
  hechos antiguos mantienen su significado, los nuevos usan la definición nueva.
- **Error de Nomey en la metadata**: corregir la tabla no cambia en silencio el
  significado de hechos ya registrados; corregirlos es **explícito y trazable**
  por el versionado de ADR-002 §6.

> **Editar una tabla de referencia nunca cambia retrospectivamente saldos,
> gastos ni deudas sin operación ni historial.**

**Regla de agregación:** dos importes solo pueden sumarse directamente si
**pertenecen a la misma definición monetaria**. El código ISO visible por sí
solo no lo demuestra.

```
10 EUR + 20 EUR      = 30 EUR
100 ABC antiguos + 100 ABC nuevos   =/=  200 ABC
EUR + USD            -> conversión explícita previa, no hay suma directa
```

**Importes de definiciones distintas nunca se agregan automáticamente como si
fueran homogéneos**, aunque compartan código, símbolo o nombre visible. Si no
son comparables, **Nomey no genera un total falso**.

**Monedas admitidas:** las **fiat activas de ISO 4217 para las que Nomey
disponga de una definición monetaria válida y controlada**. La escala **no** es
criterio de admisión: 0, 2, 3 decimales y cualquier otra escala válida. **No se
admiten códigos arbitrarios.** La metadata que usa el dominio **está bajo
control de Nomey** y no depende en tiempo real de una API externa.

### 4. Tipo de cambio

**El tipo de cambio no es `Money`.** Es un tipo separado, `ExchangeRate`,
representado como **decimal exacto, nunca coma flotante binaria**, mediante
**coeficiente entero y escala decimal**:

```
0,862034781245   ->   coefficient = 862034781245   scale = 12
```

El coeficiente puede usar `bigint`.

**La escala admitida tiene una cota máxima declarada.** Su valor concreto se
fija con el diseño del esquema, pero la cota debe existir: sin ella, ninguna
columna de precisión finita puede garantizar la preservación exigida abajo.

En PostgreSQL, **`NUMERIC` es la representación del valor decimal exacto de un
tipo de cambio**. No se fija aquí `NUMERIC(p, s)`. Sí se fija que debe:

- ser **exacto** — **nunca `REAL` ni `DOUBLE PRECISION`**;
- **preservar sin pérdida** la precisión de los tipos admitidos por Nomey;
- estar **acotado y validado**;
- **no admitir en silencio valores especiales o inválidos**.

**La garantía se formula así:**

> **La persistencia deberá validar explícitamente que un tipo de cambio sea un
> decimal finito, positivo y válido para el dominio.**

En concreto, no se admiten `NaN`, `Infinity`, `-Infinity`, ni tipos cero o
negativos si el dominio los considera inválidos.

> **No se confía únicamente en la declaración `NUMERIC(p, s)` para
> garantizarlo.** El tipo `numeric` de PostgreSQL admite los valores especiales
> `Infinity`, `-Infinity` y `NaN`; la documentación restringe **las
> infinidades** a un `numeric` sin precisión finita, porque exceden cualquier
> límite de precisión, y **no enuncia esa misma limitación para `NaN`**. Apoyar
> la exclusión en la precisión declarada sería, por tanto, apoyarla en algo que
> la documentación no afirma.

El `CHECK` concreto no se diseña aquí: pertenece al esquema.

**Momento que fija el tipo.** El tipo corresponde a la **fecha efectiva del
hecho financiero**, no al momento de sincronización. Una operación creada sin
conexión el lunes y sincronizada el jueves se convierte con referencia al lunes:
**la falta de cobertura no modifica el valor económico del gasto**.

El cliente puede llevar un tipo en caché para previsualización y estimación,
pero **ese valor no es autoritativo**: el tipo definitivo lo resuelve **el
servidor** al recibir la operación, coherente con ADR-002 §7.

**Una vez resuelto, el tipo queda congelado.** No se actualiza automáticamente
porque aparezca un dato más reciente, cambie la cotización del proveedor, se
cierre el día o publique otro proveedor. **No hay revalorización automática ni
autocorrección silenciosa.**

**Corrección.** Una corrección **hereda el tipo histórico de la versión
anterior, salvo que el propio tipo sea el dato explícitamente corregido.**

```
¿se está corrigiendo explícitamente el tipo de cambio?
  No  -> conservar el tipo histórico
  Sí  -> usar el tipo corregido
```

Corregir el importe original re-deriva **con el mismo tipo histórico**: se
corrige un hecho de entonces, no se revaloriza a precios de hoy. Corregir el
tipo queda **versionado, atribuido, en historial y notificado** según ADR-002.
La política se aplica **a cada conversión afectada**, no a un tipo global; si
una corrección modifica solo una, no se asume que las demás cambien.

**Política de selección por fecha.** Proveedor, fuente, granularidad, cierre
diario y regla de selección quedan fuera de este ADR. Lo que sí se exige: **debe
corresponder conceptualmente al momento efectivo del hecho y debe ser
determinista**.

### 5. Aritmética

**Convertir una vez, calcular después.** La conversión ocurre **una sola vez**,
en la frontera de entrada a cada ámbito. Todo cálculo sujeto a una restricción
de exactitud —que un reparto sume el total, que una deuda llegue a cero, que un
saldo común se vacíe— se hace **después**, íntegramente en la moneda base del
ámbito y con aritmética entera.

```
100 USD  ->  una conversión  ->  86,20 EUR  ->  reparto de 86,20 EUR
```

**No** se reparte en la moneda declarada para convertir cada parte después: la
suma de las partes convertidas deja de coincidir con el total convertido.

**Conversión exacta.** Dados importe origen en unidades mínimas enteras, tipo
como coeficiente entero sobre potencia de diez y escalas de origen y destino
conocidas, **el resultado previo al redondeo se mantiene como cociente racional
exacto**. No se usan `Number()`, `parseFloat`, `Math.round` ni equivalentes
binarios dentro de esta matemática.

**Redondeo.** **Una única operación de redondeo**, al final, al llegar a la
unidad mínima de la definición monetaria destino. **Sin redondeos intermedios.**
Modo **half away from zero**, definido **sobre la magnitud absoluta** y
aplicando el signo después, para que no dependa del runtime. El algoritmo se
documenta de forma independiente del runtime.

**El residuo de un redondeo FX no genera un `ajuste` ni ningún otro efecto.** De
`100 EUR × tipo → 116,3842 USD` el resultado válido es `116,38 USD`; los
`0,0042` descartados no son un movimiento financiero. `ajuste` se reserva para
una reconciliación real de saldo, según ADR-002 §3.

**Mayor resto.** El algoritmo de ADR-002 §5 trabaja con **enteros exactos** y no
depende del operador módulo con operandos negativos.

> **El reparto se calcula sobre una magnitud monetaria no negativa. El signo
> financiero pertenece al efecto que usa ese reparto, no al algoritmo de
> asignación.**

Es una **restricción que introduce este ADR**, no una lectura de ADR-002:
ADR-002 no enuncia que el total de un reparto sea no negativo, aunque tampoco
describe ningún caso que exija repartir directamente una cantidad negativa.

### 6. Serialización

**Ningún importe monetario ni tipo de cambio cruza JSON como número.**

```
importe   8620n            ->  "8620"
tipo      0,862034781245   ->  "0.862034781245"
```

En la entrada al dominio: **validar, parsear y construir** `Money` o
`ExchangeRate`. En la salida: **serializar de forma exacta**. **Aplica también
al almacenamiento sin conexión.**

**Esta garantía no se obtiene de forma automática.** E11 midió que el
comportamiento por defecto de PostgREST y de la Data API entrega estos valores
como números JSON, que JavaScript convierte a `number` (§10).

> **Debe existir una frontera explícita que garantice la representación textual
> antes de que el valor sea interpretado como `number` por JavaScript.**

La regla es la garantía, no un mecanismo: **qué** frontera la produce se decide
al diseñar el esquema (T8), y este ADR no la elige.

La forma canónica del tipo de cambio preserva su **valor** exacto; la escala
interna es un detalle de representación y no altera el resultado de la
conversión.

### 7. Moneda base de un ámbito

Cada ámbito tiene una moneda base **inmutable tras su primera operación**
(ADR-002 §8). Este ADR resuelve el intervalo anterior:

**El creador de un Grupo puede cambiar la moneda base mientras el Grupo no tenga
ninguna operación financiera registrada.** Solo el creador. **Participantes e
invitaciones no bloquean el cambio**, porque todavía no existe ningún hecho
financiero cuyo significado pueda alterarse. **La primera operación financiera
válida la bloquea definitivamente.**

**Ese cambio no genera notificación.** No es una excepción al invariante 15 de
ADR-002: ese invariante condiciona la notificación a que haya **efectos
financieros**, y aquí no los hay. La regla es local a este caso y no constituye
la política de notificaciones de Nomey.

**Conflicto de sincronización.** Una operación creada sin conexión bajo la
moneda base anterior, que llega después del cambio, **nunca se reinterpreta en
silencio**. Conserva su importe original, su moneda original y su fecha
efectiva, y **entra en conflicto: requiere revisión antes de convertirse en
operación financiera válida** del Grupo. La interfaz muestra la derivación
correspondiente a la configuración actual, calculada con la política histórica
para la fecha efectiva, y el usuario revisa y confirma antes de que la operación
produzca efectos.

No debe ocurrir: interpretarla automáticamente bajo la moneda nueva, cambiar su
importe, su moneda o su fecha efectiva, aceptarla en silencio, ni generar
efectos antes de resolver el conflicto.

> **Esto no contradice ADR-002 §10** —«no hay confirmaciones, efectos pendientes
> ni estados de autorización»— por dos razones: esa regla condiciona la
> inmediatez a que la operación sea **válida**, y aquí todavía no lo es; y lo
> que ADR-002 descarta es la confirmación **de un tercero**, mientras que aquí
> resuelve quien registró la intención, sobre su propia intención. Generalizar
> esta revisión a operaciones ya válidas **sí** exigiría un ADR sucesor.

## Alternativas consideradas

**A · `NUMERIC` como representación principal del importe.** Es la
recomendación idiomática de PostgreSQL para dinero, y la documentación oficial
lo dice con esas palabras. **Descartada** porque la escala se necesita de todos
modos como dato de primera clase, y en cuanto existe, el entero hace
**irrepresentable** el estado inválido `12,345 EUR`, que el decimal solo puede
prohibir por convención. Se asume la contrapartida: es un juicio sobre estados
irrepresentables, no una demostración de superioridad.

**B · `number` de JavaScript, con cuidado.** **Descartada** sin matices: la
pérdida de precisión es silenciosa y acumulativa. El límite superior de
`number` —del orden de 9 billones de unidades con 3 decimales— **no es el
argumento**; el argumento es que `0.1 + 0.2 !== 0.3` y que un millón de sumas de
`0,01` derivan.

**C · El código ISO como identidad monetaria.** Basta en el caso normal y falla
en tres reales: mismo código tras una redenominación, códigos distintos con
continuidad real, y —el más probable— dos definiciones del mismo código creadas
al corregir una errata nuestra. **Descartada** porque en los tres Nomey sumaría
importes no homogéneos y mostraría un total falso sin avisar.

**D · Lista blanca corta de monedas.** **Descartada:** limita un pilar del
producto —gastos compartidos en viajes— y empuja al usuario a registrar importes
aproximados en monedas no cubiertas, metiendo cifras inventadas en un modelo
diseñado para ser exacto.

**E · Excluir las monedas de 3 decimales.** **Descartada:** se apoyaba en una
lectura errónea del techo de `number` y en un juicio de riesgo no medido.

**F · El importe del destino como autoritativo.** **Descartada:** en una
transferencia directa nadie está en posición de declararlo —solo el emisor
origina la operación— y rompe las restricciones de exactitud: una deuda pagada
declarando el importe en la moneda del pagador no llega exactamente a cero en la
mayoría de los casos medidos.

**G · Repartir en la moneda declarada y convertir cada parte.**
**Descartada:** la suma de las partes convertidas difiere del total convertido
entre el 30 % y el 70 % de los casos según el número de participantes.

**H · «Mejor tipo disponible» con corrección automática posterior.**
**Descartada:** produciría versiones nuevas, historial y notificaciones sin que
nadie haya corregido nada explícitamente. La vía correcta es la corrección
explícita.

**I · El tipo del momento de sincronización, o el que el cliente lleva en
caché.** **Descartadas:** la primera hace que el importe dependa de cuándo se
recuperó cobertura; la segunda mete en un hecho contable un dato decidido por un
cliente no confiable, contra ADR-002 §7.

## Consecuencias

### A favor

- Los estados inválidos dejan de ser representables: no existe `12,345 EUR` ni
  un importe sin definición monetaria.
- Un hecho histórico no cambia de significado por editar una tabla, y una
  agregación imposible **falla en lugar de mentir**.
- La aritmética es determinista y reproducible en cliente y servidor, requisito
  ya impuesto por ADR-002 §7 para la previsualización sin conexión.
- El producto no queda limitado a un puñado de monedas, que era una restricción
  incompatible con los viajes.
- Corregir nunca revaloriza, y ninguna corrección de un campo no monetario mueve
  el saldo de otra persona.

### En contra

- **`bigint` no serializa con `JSON.stringify`.** Falla ruidosamente, lo cual es
  preferible a fallar en silencio, pero obliga a convertir explícitamente **en
  cada frontera**, incluida la de almacenamiento sin conexión.
- **Se elige contra la recomendación idiomática de PostgreSQL** para importes.
  Si la práctica lo desmiente, corregirlo exige un ADR sucesor y una migración.
- **Aparece una dependencia que no estaba en el plan:** tipos de cambio
  **históricos**, consultables por fecha efectiva. La fuente sigue fuera de
  alcance, pero el requisito ya no lo está.
- **Una capa conceptual más:** la definición monetaria deja de ser un código y
  pasa a ser una entidad con identidad propia, presente en todo importe.
- **Un flujo nuevo de conflicto** en la sincronización sin conexión, con su
  interfaz, que antes no existía.
- **Todo descansa en que los importes viajen como string**, y el
  comportamiento por defecto **no lo garantiza**: hace falta una frontera
  explícita (§10). Es coste permanente de mantenimiento, no un ajuste puntual.
- **Los tipos generados por Supabase no son por sí solos una frontera segura.**
  `supabase gen types typescript` produce `number` para `int8` y para `numeric`,
  precisamente los tipos que este ADR prohíbe representar así. Siguen siendo
  válidos como **referencia estructural** de la base de datos, pero **cualquier
  superficie que el cliente use para importes o decimales exactos debe producir
  el tipo TypeScript correcto en la frontera final**. **`database.ts` no se
  escribe a mano para arreglarlo**: es un archivo generado, y corregirlo a mano
  ocultaría el problema en lugar de resolverlo.

## Invariantes

1. Todo importe de registro es un entero en unidades mínimas, con su definición
   monetaria. `number` no participa en aritmética monetaria contable.
2. Cada operación tiene **un único importe original autoritativo**; los importes
   de ámbito son derivados y almacenados, y nunca se usan para reconstruirlo.
3. Una operación puede tener **varias conversiones derivadas**, cada una con su
   tipo. No existe un tipo global por operación.
4. El significado monetario de un hecho histórico es **inmutable**.
5. Dos importes solo se suman si comparten **definición monetaria**. El código
   ISO no lo demuestra.
6. La conversión ocurre **una vez**; los cálculos con restricción de exactitud
   se hacen después, en la moneda del ámbito, con enteros.
7. **Un único redondeo**, al final, _half away from zero_ sobre la magnitud
   absoluta. Su residuo **no genera ningún efecto**.
8. El reparto por mayor resto opera sobre **magnitud no negativa**; el signo
   pertenece al efecto.
9. El tipo de cambio corresponde a la **fecha efectiva** del hecho, lo resuelve
   el **servidor**, y una vez congelado **no se actualiza automáticamente**.
10. Una corrección **hereda** el tipo histórico salvo que el tipo sea lo
    corregido.
11. Ningún importe ni tipo cruza JSON como número, tampoco hacia el
    almacenamiento sin conexión.
12. Una operación creada bajo una configuración monetaria anterior **nunca se
    reinterpreta en silencio**.

## Puerta de aceptación — E11, cumplida

`AGENTS.md` §1 exige verificar **empíricamente** cómo sobrevive cada tipo
numérico al viaje hasta el cliente, porque la documentación oficial no lo
especifica. Ese experimento —**E11**— se ejecutó contra un stack Supabase local
real. Sus scripts se conservan en [`supabase/e11/`](../../supabase/e11/README.md)
como evidencia reproducible; **no son migraciones y no forman parte del esquema
de Nomey**.

### Versiones medidas

| Componente                               | Versión |
| ---------------------------------------- | ------- |
| PostgreSQL                               | 17.6    |
| PostgREST                                | v16.1   |
| Supabase CLI                             | 2.115.0 |
| `@supabase/supabase-js` / `postgrest-js` | 2.112.3 |
| Node                                     | 22.23.2 |

### Resultado

- **PostgreSQL almacena `BIGINT` y `NUMERIC` exactamente**, incluida la escala
  declarada y sus ceros finales.
- **PostgREST emite los valores exactos en los bytes JSON.** El body HTTP es
  correcto en todos los casos medidos.
- **La degradación aparece cuando JavaScript interpreta esos números como
  `number`.** No la produce PostgREST: la produce `JSON.parse`.
- **`BIGINT` por encima de `Number.MAX_SAFE_INTEGER` pierde precisión en
  silencio**, sin error y con HTTP 200.
- **`NUMERIC` cruza igualmente como `number`**, perdiendo la garantía decimal
  exacta y la escala declarada.
- **La generación de tipos de Supabase produce `number` para `int8` y para
  `numeric`.**
- **Un cast explícito a `text` conserva valor y escala**, y genera `string` en
  los tipos.
- **Un RPC que devuelve `bigint` sin cast falla igual que una tabla directa.**

> **Lo relevante es el cast, es decir la frontera explícita, no si el acceso se
> realiza mediante tabla, vista o RPC.**

### Qué significa para este ADR

**E11 no falsificó ninguna premisa.** Confirmó T1 y T6 en almacenamiento,
reforzó que `NUMERIC` no sirve como representación principal del importe —cruza
la frontera igual de mal que `int8`—, y demostró que **T7 no se cumple sola**.

Con ello **se activó exactamente la contingencia que T8 anticipaba**: el
comportamiento por defecto no garantiza la frontera, luego hace falta una capa
de transporte que sí lo haga. **Cuál —vista, RPC, adaptador de cliente o
combinación— sigue sin decidirse aquí**, y se resuelve al diseñar el esquema,
junto con el schema expuesto, los grants y la frontera de escritura.

> **El modelo de dominio no depende de que PostgREST casualmente serialice un
> tipo de una forma concreta.** Ese fue el criterio con el que se juzgó la
> prueba, y se sostiene.

## Fuera de alcance

Pertenecen a otras decisiones y **no quedan resueltos ni prejuzgados**:

- **Esquema, tablas, columnas y migraciones**, incluido el identificador
  concreto de una definición monetaria y los `NUMERIC(p, s)` finales.
- **Origen, proveedor, granularidad y frecuencia** de los tipos de cambio, y la
  regla de selección cuando no hay tipo exacto para una fecha.
- **Mecanismos explícitos** de conversión, redenominación, migración o
  corrección entre definiciones monetarias.
- **Presentación**: qué muestra Nomey cuando una agregación es imposible, cómo
  se presenta una conversión explícita en estadísticas o vistas consolidadas, y
  el texto del conflicto de sincronización.
- **Criptomonedas, tokens, monedas retiradas y unidades de cuenta especiales**:
  ni admitidas ni excluidas.
- **Formateo por locale**, que vive en `lib/format` y no es lógica de dominio.
- **La política general de notificaciones** de Nomey.
