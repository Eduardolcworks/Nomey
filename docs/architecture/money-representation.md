# Representación del dinero — documento de trabajo

> ⚠️ **NO NORMATIVO.** La fuente normativa de esta materia es
> **[ADR-003 — Representación exacta del dinero](../adr/ADR-003-money-representation.md)**,
> en estado `Aceptado` desde el 2026-08-19, tras cumplir su puerta E11.
>
> Este documento es el **archivo de evidencia y del razonamiento** que precedió
> al ADR. Lee cada sección con su clasificación delante, porque no todas tienen
> el mismo peso:
>
> | Sección                              | Clasificación                                                           |
> | ------------------------------------ | ----------------------------------------------------------------------- |
> | **Confirmado**                       | Restricciones ya aceptadas en `AGENTS.md` y ADR-002. No se deciden aquí |
> | **Decisiones confirmadas de Fase 2** | `Decidido` — confirmadas por producto y **ya recogidas en ADR-003**     |
> | **Evidencia técnica verificada**     | Hechos medidos. No deciden nada por sí solos                            |
> | **Recomendaciones**                  | Propuestas del análisis. **No aceptadas**                               |
> | **Pendientes**                       | Sin decidir                                                             |
>
> **Que una decisión esté `Decidido` aquí no la convierte en normativa del
> repositorio.** Lo normativo es ADR-003, que **desde su aceptación sí es
> vinculante**. Este documento custodia el razonamiento para que no dependa del
> contexto de una conversación.
>
> Con ADR-003 ya aceptado, queda **pendiente de decidir** si este documento se
> conserva como historial de análisis o se retira.

Decisión que lo enmarca: [ADR-002](../adr/ADR-002-accounting-model.md).
Vocabulario: [glosario](../product/glossary.md).

---

## Confirmado

Restricciones ya aceptadas que cualquier propuesta debe respetar. Proceden de
`AGENTS.md` §1 y de ADR-002; **no se deciden aquí**.

- Los valores contables se representan de forma **exacta**, nunca mediante coma
  flotante binaria.
- **Todo importe lleva su moneda** ISO 4217.
- **La escala decimal depende de la moneda.** Nunca asumir dos decimales.
- **Cada ámbito tiene una moneda base**, inmutable tras su primera operación.
- El **tipo de cambio se congela** al registrar la operación y no se recalcula.
- **Cada cambio de saldo de cada ámbito se representa exactamente una vez.**
- El **reparto del resto** es determinista: mayor resto → truncado → mayor
  fracción descartada → empate al pagador → orden estable guardado.
- Un mismo cálculo debe producir **exactamente el mismo resultado** en cliente y
  servidor.
- El formateo no es lógica de dominio: vive en `lib/format`.

---

## Decisiones confirmadas de Fase 2

> **Clasificación: `Decidido`.** Confirmadas por producto el **2026-08-19**.
> Han dejado de ser recomendaciones. Ver la cabecera sobre qué significa
> `Decidido` en un documento no normativo.

### D1 — El importe declarado es el autoritativo · `Decidido`

**Verificado contra ADR-002 (Aceptado): sin contradicción.** ADR-002 §8 ya manda
conservar «importe y moneda originales y el tipo de cambio congelado»; D1 fija
cuál de los dos importes es la entrada y cuál el resultado derivado.

#### D1.1 · Importe declarado autoritativo

**El importe que introduce el usuario, junto con su moneda, es el importe
original y autoritativo de la operación.** Se conserva como hecho.

```
Grupo con moneda base EUR
el usuario registra        100 USD      <- hecho original, autoritativo
Nomey deriva                86,20 EUR   <- derivado, redondeado, almacenado
```

El importe en la moneda del ámbito es **derivado, redondeado según las reglas
monetarias, almacenado y usado para los efectos dentro de ese ámbito**.

> **Nunca se reconstruye el importe original a partir del derivado.** No es una
> recomendación de estilo: E13 mide que la reconstrucción falla en una de las
> dos direcciones, y E14 que dos cotizaciones publicadas del mismo par no son
> recíprocas.

#### D1.2 · Jerarquía en la interfaz

Decisión de producto y UX, además de consecuencia del modelo monetario. El
original es el valor principal; la conversión se muestra **visualmente
secundaria** —flecha pequeña, importe pequeño—:

```
100 USD
  -> 86,20 €
```

#### D1.3 · Moneda predeterminada de un Grupo

Cada Grupo tiene una moneda predeterminada. Durante la creación, **Nomey puede
proponer una moneda según el país configurado o elegido por el usuario, y el
creador puede cambiarla antes de crear el Grupo.** La moneda finalmente
seleccionada es la moneda predeterminada del Grupo.

> La heurística «país → moneda sugerida» es **ayuda de UX, no una dependencia
> contable**. La moneda del Grupo sigue gobernada por las reglas ya aceptadas
> sobre moneda base del ámbito (ADR-002 §8, invariante 12).

#### D1.4 · Moneda por defecto de un gasto

Al añadir un gasto, Nomey **selecciona por defecto la moneda del Grupo**. El
usuario no elige moneda en cada gasto.

#### D1.5 · Gasto individual en otra moneda

Desde el **formulario completo** de «Añadir gasto», el usuario puede cambiar la
moneda **solo para esa operación**.

```
Grupo EUR · gasto real 100 USD
importe original          = 100 USD
importe del efecto Grupo  =  86,20 EUR   (derivado)
```

**La moneda del Grupo no cambia porque un gasto individual esté denominado en
otra moneda.**

#### D1.6 · Orden de conversión y reparto

**Primero se convierte el importe completo a la moneda base del ámbito; después
se hacen los cálculos internos de ese ámbito.**

```
100 USD  ->  una conversión  ->  86,20 EUR  ->  reparto de 86,20 EUR
```

El reparto se efectúa **íntegramente en la moneda del ámbito**, con la
representación exacta y el algoritmo de mayor resto de ADR-002 §5.

**No:** repartir en USD y convertir cada parte por separado. Medido en **E12**:
ese orden hace que la suma de las participaciones convertidas difiera del total
convertido entre el 30 % y el 70 % de los casos según el número de
participantes.

#### D1.7 · Acción rápida y widget

Decisión de producto. El flujo rápido prioriza registrar un gasto en unos cinco
segundos. Por tanto:

- **no ofrecen selector de moneda**;
- usan automáticamente la **moneda predeterminada del Grupo**.

Para registrar en otra moneda hay que entrar al **formulario completo** dentro
de la app. **No se añade complejidad FX al flujo rápido.**

#### D1.8 · Transferencias entre usuarios con monedas distintas

Mismo principio, sin excepción.

```
Modo Personal A: EUR      Modo Personal B: USD
A registra «enviar 100 EUR»
  100 EUR       <- importe original de la operación, autoritativo
  -> 116,38 USD <- derivado y almacenado para el ámbito de B
```

No se intenta reconstruir los 100 EUR desde los 116,38 USD.

#### D1.9 · Una operación puede tener varias conversiones derivadas

**Corrige una precisión de la recomendación anterior.** No se asume que una
operación tenga un único tipo de cambio.

```
importe declarado:          JPY
Grupo:                      USD
Modo Personal del pagador:  EUR
```

El mismo importe original puede derivarse hacia **varias monedas base
distintas**.

> **Una operación tiene un único importe original y autoritativo, pero puede
> tener múltiples conversiones derivadas, cada una con el tipo exacto utilizado
> para esa derivación.**

Restricción conceptual registrada para que **ADR-003 no nazca suponiendo un
único tipo de cambio global por operación**. Esquema, tablas y columnas quedan
explícitamente fuera. Es coherente con ADR-002 §8, que está redactado **por
efecto** —«cada efecto se registra en la moneda base de su ámbito»—, no por
operación.

#### D1.10 · El redondeo FX no es un `ajuste`

**Corrige una idea de la recomendación anterior.** Una diferencia producida
normalmente al redondear una conversión a la unidad mínima de la moneda destino
**no genera un `ajuste` ni ningún otro efecto**.

```
100 EUR × tipo  ->  116,3842 USD  ->  116,38 USD     resultado válido
los 0,0042 USD descartados NO son un movimiento financiero
```

`ajuste` se reserva para una verdadera reconciliación o corrección de saldo
según el modelo contable de ADR-002 §3.

#### D1.11 · Cambiar la moneda o el importe de un gasto existente

Editar un gasto ya registrado —cambiar `100 USD` por `100 EUR`, o alterar
importe o moneda originales— **no es una mutación silenciosa del hecho
anterior**. Sigue el mecanismo de corrección por versionado ya aceptado:
conservar historial, registrar la versión nueva, recalcular los efectos
derivados correspondientes y mantener trazabilidad.

> **Verificado contra ADR-002 §6 y `data-model.md` §7: coherente.** ADR-002 §6
> dice que corregir crea una versión nueva y que la anterior nunca se muta;
> `data-model.md` §7 añade que saldos y estadísticas se derivan de la **versión
> vigente**, «sin operaciones de reversión separadas». Recalcular los efectos
> derivados de la versión nueva es exactamente ese mecanismo.

### Puntos que D1 deja abiertos

Se registran aquí para que no se pierdan. **No están decididos y nada los da por
resueltos.**

1. **Qué tipo de cambio aplica una corrección.** ADR-002 §8 dice que «la
   conversión no se recalcula después», referido a una versión ya registrada.
   Una corrección crea una versión **nueva**, que necesita un tipo: ¿hereda el
   congelado en la versión corregida, o congela uno nuevo al corregir? Si
   hereda, corregir una errata de descripción no puede mover el saldo derivado
   de otra persona; si no hereda, sí puede. **Ni ADR-002 ni D1 lo resuelven.**
2. **Hasta cuándo puede cambiarse la moneda de un Grupo.** D1.3 describe la
   elección durante la creación. ADR-002 §8 y el invariante 12 la fijan «tras su
   primera operación». Un Grupo creado y todavía sin operaciones cae entre ambas
   redacciones. **No es una contradicción** —D1.3 no afirma nada sobre ese
   intervalo—, pero conviene cerrarlo antes de ADR-003.

### D2 — El significado monetario de un hecho histórico es inmutable · `Decidido`

Confirmada por producto el **2026-08-19**.

#### D2.1 · La regla de dominio

> **El significado monetario de un hecho histórico queda congelado en el momento
> en que se registra. Un cambio posterior en la metadata de una moneda nunca
> puede reinterpretar ese hecho.**

```
un valor almacenado como 1000 significaba 10,00
porque la definición monetaria aplicable al registrarlo tenía escala 2

-> debe seguir significando 10,00, históricamente y para siempre

una modificación posterior de la metadata monetaria NO puede hacer
que ese mismo hecho pase a significar 1000
```

#### D2.2 · Lo que D2 **no** decide

**D2 decide la inmutabilidad del significado monetario histórico, no la
estructura con la que se persiste.** En particular, **no** queda decidido que
haya que almacenar físicamente `scale = 2` junto a cada importe: eso es **una
implementación posible**, no la decisión de dominio.

Lo que D2 sí impone sobre ADR-003 es un **requisito**, no un mecanismo:

> **ADR-003 debe exigir que la definición monetaria utilizada por un hecho pueda
> reconstruirse exactamente y de forma inmutable.**

Cómo se consiga queda abierto, y podrá decidirse más adelante entre —o
combinando— estas vías:

- escala congelada en el propio hecho;
- versión de la definición monetaria;
- referencia a metadata versionada;
- una combinación de ellas.

#### D2.3 · Caso 1 — cambio real de la moneda

Cuando una moneda cambia legítimamente de escala, se redenomina o cambia su
definición monetaria:

- los **hechos antiguos mantienen su significado histórico**;
- los **hechos nuevos** utilizan la definición nueva;
- el cambio **no reinterpreta** operaciones anteriores.

#### D2.4 · Caso 2 — error de Nomey en la metadata

Cuando la equivocada era **nuestra propia metadata**:

- corregir la tabla **no modifica en silencio** el significado de hechos ya
  registrados;
- corregir los hechos afectados, si procede, es **explícito y trazable** según
  el modelo de corrección y versionado de ADR-002 §6.

**Son dos casos distintos y no se tratan igual.** Un cambio legítimo de la
moneda y una errata nuestra producen la misma diferencia numérica y exigen
respuestas opuestas: en el primero los hechos antiguos son correctos y deben
quedarse como están; en el segundo son incorrectos y hay que corregirlos uno a
uno, con historial.

#### D2.5 · La regla transversal

> **Editar una tabla de referencia nunca cambia retrospectivamente saldos,
> gastos ni deudas sin operación ni historial.**

Es la forma general de las dos anteriores, y la razón por la que D2 existe: sin
ella, modificar una fila de configuración sería una vía para alterar
contabilidad sin dejar rastro, sin atribución y sin notificación.

#### Coherencia con ADR-002

**Verificado: sin contradicción, y con precedente de la misma forma.**

- **§6** — «los hechos son inmutables; corregir crea una versión nueva». D2
  extiende esa inmutabilidad al **significado** del hecho, no solo a sus cifras.
  Un importe cuyo significado depende de una tabla mutable **no es todavía un
  hecho inmutable**.
- **§8 e invariante 12** — la moneda base de un ámbito es inmutable tras su
  primera operación. D2 es la pieza que faltaba: fija la moneda **y** lo que esa
  moneda significaba.
- **Invariante 21** — «un cambio de plan o entitlement nunca reescribe hechos
  contables históricos». D2 es exactamente el mismo principio aplicado a la
  metadata monetaria en lugar de a la comercial.
- **D1.1** — el importe declarado es un hecho que no se reconstruye desde nada.
  Un número sin su definición monetaria no es un hecho completo: `1000` no
  significa nada hasta saber si son 10,00 o 1.000.

### Punto que D2 deja abierto, y que arrastra a D3

**Conservar el significado histórico no resuelve por sí solo qué ocurre cuando
una misma moneda tiene dos definiciones distintas a lo largo del tiempo.**

Queda pendiente, para D3 o para una decisión relacionada:

> **Cómo identifica Nomey una definición monetaria, y cuándo dos definiciones
> históricas deben considerarse monetariamente distintas aunque procedan de la
> misma moneda.**

**No está resuelto y no debe darse por resuelto.** En particular, **no se asume
que baste con comparar el código ISO textual**: dos hechos con el mismo código
pueden pertenecer a definiciones monetarias distintas, y dos códigos distintos
podrían corresponder a la misma.

Mientras eso no se decida, sigue abierto qué significa sumar dos importes
«de la misma moneda» registrados a uno y otro lado de un cambio de definición.

### D3 — Monedas soportadas en la v1 · `Decidido`

Confirmada por producto el **2026-08-19**.

#### D3.1 · Qué monedas admite Nomey

> **Las monedas fiat activas de ISO 4217 para las que Nomey disponga de una
> definición monetaria válida y controlada.**

**No se usa una lista blanca artificialmente corta** de EUR/USD/GBP y poco más.
El objetivo de Nomey incluye gastos compartidos y viajes: impedir registrar la
moneda real de un país soportado por ISO 4217 sería una limitación de producto
innecesaria.

#### D3.2 · La escala no determina la admisión

**El número de decimales de una moneda no decide si Nomey la admite.** Deben
soportarse correctamente monedas de:

- **0 decimales** (JPY, KRW);
- **2 decimales** (EUR, USD);
- **3 decimales** (BHD, KWD);
- **cualquier otra escala válida** contemplada por una definición monetaria
  admitida por Nomey.

Las monedas de tres decimales **no quedan excluidas por diseño**.

> **El límite de `number` de JavaScript no se usa como argumento para restringir
> monedas.** Precisamente la Fase 2 debe elegir una representación que **no
> dependa de `number`** para importes contables. Ver la corrección registrada en
> E2.

#### D3.3 · No se admiten monedas arbitrarias

El usuario **no puede escribir un código de moneda cualquiera**. No puede teclear
`ABC` y hacer que Nomey lo trate como moneda.

> **Una moneda debe tener una definición monetaria conocida y controlada por
> Nomey para poder usarse en hechos contables.**

Es la contrapartida directa de D2: un hecho cuya definición monetaria no
controlamos **no es reconstruible**, que es exactamente lo que D2.2 exige.

#### D3.4 · Fuera del alcance inicial

**D3 se refiere a monedas fiat activas** soportadas por el modelo monetario de
Nomey. **No** entran automáticamente en esta decisión:

- criptomonedas;
- tokens;
- monedas históricas retiradas;
- unidades de cuenta especiales;
- activos financieros que no sean moneda fiat normal del producto.

Podrán decidirse más adelante. **No están admitidas ni excluidas por D3**:
simplemente quedan fuera de lo que D3 decide.

#### D3.5 · UX ≠ soporte contable

Soportar muchas monedas **no significa mostrar una lista enorme** al registrar un
gasto. La interfaz debe poder priorizar, conceptualmente:

1. moneda predeterminada del ámbito;
2. moneda asociada al país o configuración del usuario;
3. monedas utilizadas recientemente;
4. monedas frecuentes;
5. búsqueda entre el resto de monedas soportadas.

**Es una decisión de UX y no modifica qué monedas puede representar el dominio.**
Coherente con D1.4 —el gasto arranca en la moneda del ámbito— y con D1.7 —el
flujo rápido no ofrece selector—.

#### D3.6 · La metadata monetaria está bajo control de Nomey

Soportar las monedas ISO 4217 activas **no implica depender en tiempo real de una
API externa** para conocer escala, definición, identidad histórica u otras
propiedades contables.

> **La metadata utilizada por el dominio está bajo control de Nomey y debe poder
> cumplir D2:** un cambio posterior de metadata nunca puede reinterpretar en
> silencio un hecho histórico.

El **mecanismo exacto** de versionado e identidad de esa definición **sigue
pendiente** y corresponde a ADR-003 (D2.2).

#### Alternativas descartadas en D3

Se conservan con su razón, por ser arquitectónicamente relevantes.

| Alternativa                                                        | Por qué se descarta                                                                                                                                                                             |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lista blanca corta** (EUR/USD/GBP/CHF/JPY y poco más), ampliable | Limita un pilar del producto —gastos compartidos en viajes— y obliga a registrar importes aproximados en monedas no cubiertas, metiendo cifras inventadas en un modelo diseñado para ser exacto |
| **Excluir de la v1 las monedas de 3 decimales**                    | Se apoyaba en una lectura errónea del techo de `number` (ver corrección en E2) y en un juicio de riesgo no medido. La escala no es criterio de admisión (D3.2)                                  |
| **Sin lista: cualquier código que el usuario escriba**             | Sin definición monetaria controlada no hay escala fiable, y sin escala fiable no se cumplen D1 ni D2. Descartada también por producto (D3.3)                                                    |

#### Coherencia con ADR-002 y `AGENTS.md`

**Verificado: sin contradicción.**

- `AGENTS.md` §1 — «Nomey es multi-moneda por diseño aunque la UI muestre una» y
  «la escala decimal depende de la moneda; nunca hardcodear 2 decimales». **D3.2
  es la aplicación directa de esa regla**, no una excepción a ella.
- **ADR-002 §8** — no limita el conjunto de monedas; fija que cada ámbito tiene
  una moneda base inmutable tras su primera operación. D3 no lo toca.
- **D2** — D3 **amplía la superficie** de la obligación de D2: más monedas
  admitidas son más definiciones que deben ser reconstruibles de forma exacta e
  inmutable. Eso hace el pendiente de **identidad de la definición monetaria**
  más urgente, no menos.
- **D1.4 y D1.7** — la priorización de D3.5 es compatible: el ámbito propone su
  moneda por defecto y el flujo rápido no ofrece selector.

### P1 — Tipo de cambio utilizado al corregir una operación · `Decidido`

Confirmada por producto el **2026-08-19**. Abierta por D1.11.

#### P1.0 · La regla general

> **Corregir una operación histórica no provoca una revalorización automática
> con el tipo de cambio actual.** Una versión nueva conserva por defecto las
> conversiones históricas aplicables al hecho que se está corrigiendo.

**Nomey no consulta automáticamente el tipo de cambio actual solo porque se haya
creado una versión nueva.**

#### P1.1 · Correcciones no monetarias

Si se corrige la descripción, la categoría, una nota, los participantes o
cualquier otro dato que **no** modifique el importe original ni el tipo
aplicado, **el tipo congelado de la operación histórica se conserva**.

> Una corrección no monetaria **no puede cambiar en silencio** importes
> derivados, saldos ni deudas únicamente porque el mercado FX se haya movido
> desde el registro original.

#### P1.2 · Corrección del importe original

```
versión original       100 USD × 0,862 (tipo histórico congelado) = 86,20 EUR
se descubre que eran   120 USD
versión nueva          120 USD × 0,862  <- el MISMO tipo histórico
```

**No** se usa el tipo disponible en el momento de corregir. Se está corrigiendo
el importe de un hecho ocurrido entonces, **no revalorizando el hecho a precios
actuales**.

#### P1.3 · Corrección explícita del tipo de cambio

Única excepción conceptual: **si lo que se corrige explícitamente es el propio
tipo de cambio**, la versión nueva usa el tipo corregido.

```
tipo registrado originalmente   0,862
tipo correcto para aquel hecho  0,871   <- corrección explícita
```

La versión nueva recalcula los efectos derivados con `0,871`. Ese cambio queda
**versionado, atribuido, en historial y sujeto a las reglas de notificación y
corrección ya aceptadas**.

> **No se confunde con obtener automáticamente «el tipo de hoy».** Corregir el
> tipo es afirmar cuál era el tipo aplicable al hecho, no traer el del mercado
> actual.

#### P1.4 · La regla, resumida

> **Una corrección hereda el tipo de cambio histórico de la versión anterior,
> salvo que el propio tipo de cambio sea el dato explícitamente corregido.**

**No hace falta mantener una clasificación de todos los campos.** El único caso
especial relevante para FX es una pregunta binaria:

```
¿se está corrigiendo explícitamente el tipo de cambio?
  No  -> conservar el tipo histórico
  Sí  -> utilizar el tipo corregido
```

#### P1.5 · Se aplica a cada conversión, no a un tipo global

Por **D1.9**, una operación puede generar **varias conversiones** hacia monedas
base distintas, cada una con su propio tipo.

> **Esta política se aplica a cada conversión histórica afectada, no a un
> supuesto tipo global único de la operación.**

Si una corrección modifica explícitamente **solo una** de esas conversiones,
**no se asume que las demás cambien**.

La estructura de persistencia sigue sin diseñarse.

#### P1.6 · Relación con P3 — no resuelto aquí

P1 decide el comportamiento **del tipo de cambio**. **P3 sigue pendiente**: la
identidad y la definición histórica de la moneda.

> Cuando P3 se resuelva, una corrección que conserva el tipo histórico deberá
> conservar también **la definición monetaria histórica** necesaria para
> interpretar correctamente esa conversión.

**P1 no resuelve P3 ni lo prejuzga.**

#### P1.7 · El caso offline NO queda resuelto

**P1 no responde** a esta pregunta, y no debe interpretarse como si lo hiciera:

> Si una operación se crea sin conexión y se sincroniza días después, ¿qué
> momento determina el **tipo de cambio inicial**: el de la creación o el de la
> sincronización?

Es una decisión **distinta**, registrada como **P4** en «Pendientes».

#### Alternativa descartada en P1

| Alternativa                                                                  | Por qué se descarta                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Clasificar todos los campos** y decidir el comportamiento FX campo a campo | Innecesario: basta una pregunta binaria (P1.4). Una clasificación de campos hay que mantenerla, y la implementación puede equivocarse en ella **en silencio**, que es justo el tipo de fallo que P1 evita                                                  |
| **Congelar un tipo nuevo en cada versión**                                   | Corregir una errata movería importes derivados, saldos y deudas de otras personas sin que nadie lo pidiera. Choca con ADR-002 §10, donde el efecto sobre otro usuario nace de una operación válida del dominio, no del efecto colateral de editar un texto |

#### Coherencia con ADR-002

**Verificado: sin contradicción, y cierra un hueco que ADR-002 dejaba abierto.**

- **§8** — «el tipo de cambio congelado en el momento de registrar; la conversión
  no se recalcula después». P1 extiende ese principio a la **versión nueva**, que
  §8 no cubría, en la dirección coherente: heredar, no refrescar.
- **§6 y `data-model.md` §7** — corregir es versionar, y saldos y estadísticas se
  derivan de la versión vigente. P1.2 y P1.3 recalculan los efectos de la versión
  nueva, que es exactamente ese mecanismo.
- **§10 e invariante 15** — todo efecto sobre otro usuario es atribuible y
  notificable. P1.3 lo exige explícitamente para la corrección del tipo; P1.1
  evita que ocurra un efecto **no** solicitado sobre otro usuario.
- **D1.9** — P1.5 respeta que puede haber varias conversiones, cada una con su
  tipo.

#### Objeción registrada contra esta decisión

Heredar el tipo **perpetúa un tipo erróneo** mientras nadie lo advierta: todas
las versiones posteriores lo arrastran. P1.3 da la vía para corregirlo, pero
solo funciona si alguien puede **ver** qué tipo se aplicó. Es una implicación
para la interfaz, no una objeción a la regla.

### P2 — Cambio de la moneda base de un Grupo antes de su primera operación · `Decidido`

Confirmada por producto el **2026-08-19**.

#### P2.0 · La regla general

> **El creador del Grupo puede cambiar la moneda base mientras el Grupo no tenga
> ninguna operación financiera registrada.**

**No es necesario que esté solo en el Grupo.** Puede haber participantes ya
unidos, invitaciones pendientes y configuración no financiera, y el creador
sigue pudiendo corregir la moneda base mientras no exista ninguna operación
financiera.

#### P2.1 · Quién puede cambiarla

**Solo el creador del Grupo**, durante el período previo a la primera operación.
**Los demás participantes no pueden.**

#### P2.2 · Cuándo queda bloqueada

En el momento en que exista la **primera operación financiera válida** del
Grupo, la moneda base queda **bloqueada definitivamente**.

Es exactamente el invariante de ADR-002 §8 e invariante 12 —«moneda base
inmutable tras su primera operación»—, del que P2 solo aclara el intervalo
anterior.

> **P2 no redefine qué cuenta como operación financiera.** Usa el concepto de
> operación de ADR-002 tal cual. Si algún día hiciera falta afinarlo, será otra
> decisión, no una lectura de ésta.

#### P2.3 · Participantes e invitaciones no bloquean el cambio

La existencia de participantes, invitaciones o aceptaciones del Grupo **no
convierte por sí sola la moneda base en inmutable**.

La razón es sustantiva, no de comodidad: **todavía no existe ningún hecho
financiero cuyo significado pueda alterarse**. Lo que la inmutabilidad protege
son hechos, y aquí no los hay.

**No se obliga al usuario a borrar y recrear el Grupo** solo por haber invitado
a otras personas.

#### P2.4 · No genera notificación

> **Cambiar la moneda base antes de la primera operación NO genera notificación
> a los demás participantes.**

Nomey minimiza las notificaciones. No deben generarse por cambios de
configuración que todavía no alteran saldos, gastos, deudas, liquidaciones,
transferencias ni ningún otro hecho financiero ya registrado. Se reservan para
eventos que realmente las requieren.

> **Alcance limitado.** Esto **no es** la política global de notificaciones de
> Nomey; es la decisión aplicable a P2. Esa política, si llega a escribirse,
> corresponde a otro sitio.

#### P2.5 · Caso offline — el invariante que P2 sí deja

**P2 no resuelve P4.** Pero deja este invariante, que P4 deberá respetar:

> **Una operación creada bajo una configuración monetaria anterior nunca puede
> reinterpretarse en silencio tras un cambio de moneda base.**

```
1. Grupo en EUR
2. un usuario crea una operación sin conexión
3. antes de que sincronice, el creador cambia la moneda del Grupo a JPY
4. la operación llega después al servidor
```

**Nomey no puede tratarla en silencio como si se hubiera creado bajo JPY.**

La resolución concreta —rechazo, conflicto de sincronización, revisión u otra—
**pertenece a P4 y no se decide aquí**.

> Es la misma forma que **D2.5**: cambiar una configuración nunca reinterpreta
> hechos ya producidos. D2.5 lo aplica a la metadata de una moneda; P2.5, a la
> moneda base de un ámbito.

#### P2.6 · Resumen

|                                  | Regla                                                     |
| -------------------------------- | --------------------------------------------------------- |
| **Quién**                        | Solo el creador del Grupo                                 |
| **Cuándo**                       | Mientras haya **0 operaciones financieras**               |
| **Participantes e invitaciones** | **No bloquean** el cambio                                 |
| **Notificación**                 | **Ninguna**                                               |
| **Primera operación financiera** | **Bloqueo definitivo**                                    |
| **Operaciones offline previas**  | **Nunca se reinterpretan en silencio** (resolución en P4) |

#### Alternativas descartadas en P2

| Alternativa                                            | Por qué se descarta                                                                                                                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exigir además que el creador esté solo** en el Grupo | Obligaría a borrar y recrear el Grupo por haber invitado a alguien, con fricción real y sin nada que proteger: sin hechos financieros no hay significado que alterar (P2.3)         |
| **Inmutable desde la creación**, sin intervalo         | Demasiado duro para un producto que prioriza la rapidez: equivocarse en un desplegable de la pantalla de creación es normal, y la protección no aporta nada mientras no haya hechos |
| **Notificar el cambio** a los participantes            | Contradice la filosofía de producto de minimizar notificaciones. Un cambio que no altera ningún hecho financiero no justifica interrumpir a nadie (P2.4)                            |

#### Coherencia con ADR-002

**Verificado: sin contradicción.**

- **§8 e invariante 12** — «moneda base inmutable tras su primera operación».
  P2.2 es literalmente ese invariante; P2.0 solo resuelve el intervalo anterior,
  que ADR-002 no cubría.
- **Invariante 15** — «toda operación con efectos financieros relevantes sobre
  otro usuario queda atribuida y **genera notificación**». **P2.4 no lo
  contradice**: el invariante condiciona la notificación a que haya **efectos
  financieros**, y cambiar la moneda base de un Grupo sin operaciones **no
  produce ninguno**. No se está creando una excepción al invariante; es que el
  supuesto no se da.
- **§10** — la protección descansa en permisos del ámbito, atribución,
  historial, notificación y corrección. P2.1 aporta el permiso —solo el
  creador— y el cambio sigue siendo atribuible; lo que decae es únicamente la
  notificación, y solo mientras no haya hechos.
- **D2.5** — misma forma de invariante, aplicada a la moneda base en lugar de a
  la metadata monetaria. P2.5 lo hace explícito.

#### Objeción registrada contra esta decisión

La condición «0 operaciones financieras» **es una foto que la cola sin conexión
puede dejar obsoleta**: el servidor puede leer «cero» mientras una operación de
ayer viaja hacia él. P2.5 impide que el resultado sea silencioso, pero **no
elimina la carrera**; solo garantiza que se detecte. Cerrarla del todo depende de
**P4**.

### P3 — Identidad de una definición monetaria · `Decidido`

Confirmada por producto el **2026-08-19**. Abierta por D2 y agrandada por D3.

#### P3.0 · La regla de dominio

> **Dos importes solo pueden sumarse directamente si pertenecen a la misma
> definición monetaria. El código ISO visible por sí solo no basta para
> demostrarlo.**

En el caso normal esto es exactamente lo que el usuario ya espera:

```
EUR + EUR  ->  sí          10 EUR + 20 EUR = 30 EUR
EUR + USD  ->  no, salvo conversión explícita previa
```

#### P3.1 · El caso histórico excepcional

P3 protege además la situación en la que dos hechos **aparentan** la misma
moneda pero pertenecen a **definiciones monetarias históricas distintas**.

```
100 ABC antiguos  +  100 ABC nuevos   =/=  200 ABC
```

Si la moneda cambió de definición entre ambos hechos, **no se convierten
automáticamente en 200 ABC**. Aunque el código visible sea `ABC`, Nomey debe
saber internamente que **no son cantidades directamente homogéneas**.

#### P3.2 · Prohibición de la agregación silenciosa

> **Importes pertenecientes a definiciones monetarias distintas nunca se agregan
> automáticamente como si fueran homogéneos.**

Aplica **aunque compartan** código ISO, símbolo o nombre visible.

**Si no son directamente comparables, Nomey no genera un total falso.** Es la
prohibición central de P3, y la única cosa que P3 prohíbe.

#### P3.3 · Monedas realmente distintas

Para monedas distintas —`EUR + USD`— **tampoco existe suma directa**. Debe haber
una **conversión explícita a una definición monetaria común** antes de poder
agregarlas.

> **Cómo se presenta esa conversión en estadísticas o vistas consolidadas queda
> sin decidir.** P3 no lo aborda.

#### P3.4 · Relación con D2

P3 **complementa** D2. No lo repite ni lo modifica.

|        | Qué decide                                                                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **D2** | El significado monetario de un hecho histórico es **inmutable**                                                                               |
| **P3** | Conservar ese significado **individualmente no basta**: tampoco pueden agregarse hechos con definiciones incompatibles como si fueran iguales |

> **D2 protege cada hecho. P3 protege las operaciones entre varios hechos.**

Sin P3, D2 seguiría cumpliéndose hecho a hecho mientras un total los sumara y
mostrara una cifra sin significado. Eran dos agujeros distintos.

#### P3.5 · Lo que P3 **no** decide

P3 es **únicamente la regla de dominio**. **No** decide:

- estructura de tablas;
- `currency_definition_id` ni ningún otro identificador;
- códigos monetarios internos;
- cómo se versiona la metadata;
- si una redenominación genera una identidad interna nueva;
- cómo se representan las versiones en PostgreSQL;
- cómo se migra una moneda;
- cómo se presenta al usuario un caso histórico excepcional.

> **Opciones del tipo `ARS_v1` / `ARS_v2` no son arquitectura aceptada.** Son
> una forma imaginable de cumplir P3, entre otras, y no están elegidas.

Es la misma separación que hizo **D2.2**: la regla se decide, el mecanismo se
deja abierto para ADR-003.

#### P3.6 · Mecanismos explícitos posteriores

Si dos definiciones no son directamente sumables, más adelante **podrá** existir
un mecanismo explícito de conversión, redenominación, migración o corrección.

**P3 no decide ese mecanismo. Lo único prohibido es la agregación silenciosa.**

#### Alternativa descartada en P3

| Alternativa                                 | Por qué se descarta                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **El código ISO es la identidad monetaria** | Basta para el caso normal y falla en tres reales: mismo código tras una redenominación, códigos distintos con continuidad real, y —el más probable— dos definiciones del mismo código creadas al corregir una errata nuestra (D2.4). En los tres, Nomey sumaría importes no homogéneos y mostraría un total falso **sin avisar**, que es justo lo que D2 existía para impedir a nivel de hecho |

#### Coherencia con ADR-002 y con D2

**Verificado: sin contradicción.**

- **ADR-002 §8 e invariante 12** — cada ámbito tiene una moneda base inmutable
  tras su primera operación. En el caso normal todos los efectos de un ámbito
  comparten definición y P3 no cambia nada. P3 solo actúa cuando esa definición
  **cambió a lo largo del tiempo**, un supuesto que ADR-002 no aborda.
- **ADR-002 §4 y §5** — estadísticas y reparto. P3 no altera qué clases alimentan
  las estadísticas ni el algoritmo de mayor resto; **restringe cuándo una suma
  es lícita**, que es una capa distinta.
- **D1.6** — «convertir una vez, repartir después, en la moneda del ámbito». P3
  es la generalización natural: **agregar exige una definición común**, y en D1.6
  esa definición común se consigue convirtiendo antes de calcular.
- **D2** — complementario, no solapado. Ver P3.4.
- **D3.1** — admitir todas las monedas fiat activas multiplica las definiciones
  en circulación, así que P3 no es un caso de laboratorio: es la contrapartida
  directa del alcance que D3 eligió.

#### Objeción registrada contra esta decisión

**P3 prohíbe sin ofrecer alternativa.** Dice que Nomey no puede mostrar un total
cuando las definiciones difieren, pero no dice qué muestra en su lugar, y esa
pantalla existe. La respuesta correcta no es relajar P3 —un total falso es peor
que un total ausente— sino resolver el hueco donde corresponde: en el mecanismo
de P3.6 y en la presentación de P3.3, ambos abiertos.

### P4 — Tipo de cambio de una operación creada sin conexión · `Decidido`

Confirmada por producto el **2026-08-19**. Cierra además el conflicto que P2.5
dejó planteado.

#### P4.1 · El momento que determina el tipo

> **Una operación creada sin conexión usa el tipo de cambio correspondiente a la
> fecha efectiva del hecho financiero, no al momento de sincronización.**

```
gasto realizado           lunes
apuntado sin conexión     lunes
sincronizado              jueves
tipo aplicable            el del LUNES
```

**La falta de cobertura no puede modificar el valor económico del gasto.**

#### P4.2 · El cliente no decide el tipo

El cliente **puede** tener un tipo en caché para previsualización, estimación
visual y UX sin conexión. **Ese valor no es autoritativo.**

> **El tipo definitivo que entra en el hecho contable lo resuelve el servidor al
> recibir la operación.**

Coherente con ADR-002 §7: el cliente envía **intención**, el servidor valida y
genera los efectos.

#### P4.3 · Una vez resuelto, el tipo queda congelado

Cuando el servidor determina el tipo histórico aplicable y registra la
operación, **ese tipo queda congelado**. No se actualiza automáticamente después
porque:

- aparezca un dato más reciente;
- cambie la cotización del proveedor;
- se cierre el día;
- otro proveedor publique otra cifra.

**No hay revalorizaciones automáticas posteriores.**

#### P4.4 · Nada de autocorrecciones silenciosas

> **Se rechaza** la propuesta de usar provisionalmente «el mejor tipo
> disponible» y **corregirlo automáticamente** después, cuando aparezca un tipo
> definitivo.

Generaría cambios de saldo, versiones nuevas, historial y notificaciones **sin
que nadie haya corregido nada explícitamente**. La filosofía de Nomey sigue
siendo minimizar los cambios y las notificaciones automáticas innecesarias
—misma línea que P2.4—.

Si más adelante se determina que el tipo congelado era incorrecto, **se usa P1**:
corrección explícita y versionada del tipo (P1.3). **No existe actualización FX
automática de un hecho ya registrado.**

#### P4.5 · Qué pasa si no hay un tipo exacto para esa fecha

**P4 no decide** el proveedor, la fuente concreta, la granularidad temporal, el
cierre diario, si se usa el último tipo anterior, un promedio diario, un tipo
intradía ni ninguna otra política de selección. Se definirá más adelante.

Lo que P4 **sí** fija sobre esa política futura:

> **Debe buscar un tipo correspondiente conceptualmente al momento efectivo del
> hecho, y debe ser determinista.**

> Una regla como «último tipo publicado anterior» es **una candidata, no una
> decisión**.

---

### Cierre del conflicto de P2.5 · `Decidido`

Cambio de la moneda base de un Grupo mientras una operación sin conexión está en
vuelo.

```
día 1   Grupo base = EUR
        un usuario registra sin conexión: 3.000 JPY
día 2   el creador cambia la moneda base: EUR -> USD
día 3   la operación sin conexión llega al servidor
```

#### La regla

> **La operación nunca se reinterpreta en silencio bajo la nueva moneda base del
> Grupo.**

El importe original permanece **3.000 JPY** y su fecha efectiva también
permanece. Pero como la configuración monetaria del ámbito cambió desde que se
creó la intención:

> **La operación entra en conflicto y requiere revisión antes de convertirse en
> una operación financiera válida del Grupo.**

#### UX conceptual del conflicto

La interfaz debe poder explicar algo equivalente a:

> «La moneda del Grupo cambió de EUR a USD desde que registraste este gasto.
> Revisa el importe antes de añadirlo.»

**El copy definitivo no se fija ahora.**

Nomey puede mostrar la derivación correspondiente a la configuración actual,
usando la política histórica de P4.1 para la fecha efectiva del gasto:

```
3.000 JPY
  -> XX,XX USD
```

**El usuario revisa y confirma antes de que la operación produzca efectos
válidos.**

#### Lo que no debe ocurrir

- interpretar automáticamente el gasto como si se hubiera creado bajo USD;
- cambiar el importe original;
- cambiar su moneda original;
- alterar su fecha efectiva;
- aceptar en silencio el resultado;
- generar efectos financieros antes de resolver el conflicto.

#### Relación con P2

P2 sigue vigente sin cambios: el creador puede cambiar la moneda base mientras
no haya operaciones financieras válidas, y la primera la bloquea.

> **Una intención sin conexión, todavía no sincronizada, no es una operación
> financiera ya registrada** y no bloquea nada.

Lo que sí crea es un **conflicto de sincronización**, que este cierre resuelve
mediante **revisión obligatoria**. ADR-002 no se modifica para reflejarlo.

#### Alternativas descartadas en P4

| Alternativa                                                   | Por qué se descarta                                                                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Usar el tipo del momento de sincronización**                | El importe del gasto dependería de cuándo se recuperó cobertura. Dos personas que apuntan el mismo gasto a la vez obtendrían cifras distintas si una sincroniza antes          |
| **Usar el tipo que el cliente llevaba en caché**              | Metería en un hecho contable un dato decidido por un cliente no confiable, contra ADR-002 §7, y dos móviles con cachés distintas darían importes distintos para el mismo gasto |
| **«Mejor tipo disponible» + corrección automática posterior** | Produce versiones, historial y notificaciones sin que nadie haya corregido nada. Rechazada en P4.4; la vía correcta es la corrección explícita de P1.3                         |
| **Rechazar la operación en conflicto de P2.5**                | Perdería una intención legítima del usuario. La revisión conserva el hecho y le devuelve la decisión a quien lo registró                                                       |

#### Coherencia con ADR-002

**Verificado: sin contradicción.**

- **§7 y `data-model.md` §9** — «el cliente envía la intención, no el resultado
  contable». P4.2 es literalmente eso: la fecha efectiva es intención, el tipo lo
  pone el servidor, igual que el reparto.
- **§8** — el tipo se congela al registrar y la conversión no se recalcula
  después. P4.3 lo aplica al caso sin conexión, y P4.4 impide que la
  sincronización se convierta en una vía de recálculo encubierto.
- **§6 y P1.3** — la única forma de cambiar un tipo congelado sigue siendo una
  corrección explícita y versionada. P4 no abre una segunda vía.
- **Invariante 10** — «el resultado financiero de una operación no depende de
  quién la registre». P4.1 extiende la misma idea: **tampoco depende de cuándo
  se recuperó la cobertura**.
- **P2** — sin cambios. Una intención en vuelo no es una operación registrada y
  no bloquea la moneda base.

> **Punto que merece argumentarse, porque roza un límite de ADR-002.** ADR-002
> §10 y `data-model.md` §8 dicen que **«no hay confirmaciones, efectos
> pendientes ni estados de autorización»**. La revisión obligatoria del conflicto
> podría leerse como un efecto pendiente, y **no lo es**, por dos razones:
>
> 1. Esa regla de ADR-002 condiciona la inmediatez a que la operación sea
>    **válida**. Aquí la operación **todavía no lo es**: la configuración
>    monetaria bajo la que se creó la intención ya no existe en el ámbito.
> 2. Lo que ADR-002 descarta es la **confirmación de un tercero** antes de que
>    los efectos le alcancen. Aquí no confirma un tercero: resuelve **quien
>    registró la intención**, sobre su propia intención, y nadie más queda a la
>    espera.
>
> Si en el futuro esta revisión se generalizase a operaciones ya válidas, sí
> contradiría ADR-002 y exigiría un ADR sucesor.

### Decisiones técnicas T1–T12 · `Decidido`

Aprobadas el **2026-08-19**, delegadas por producto en la segunda revisión
arquitectónica. Son la materia que ADR-003 debe recoger como normativa.

#### T1 · Representación de importes

**Enteros en la unidad mínima de su definición monetaria.**

```
86,20 EUR  -> 8620
100 JPY    -> 100
1,234 BHD  -> 1234
```

En TypeScript, `bigint`. En PostgreSQL, cuando se diseñe el esquema, `BIGINT`.
El rango de `BIGINT` es suficiente para el dominio previsto.

- **`number` de JavaScript queda prohibido** para valores monetarios contables.
- **`NUMERIC` no es la representación principal de `Money`.**

#### T2 · `Money`

`Money` encapsula, como mínimo, **cantidad exacta en unidades mínimas** e
**identidad de la definición monetaria aplicable**.

```
Money { minor: bigint, currencyDefinition }
```

**La moneda no es un string libre.** La API concreta no se diseña aquí. Las
operaciones de dominio deben **impedir**:

- sumar definiciones monetarias incompatibles;
- comparar cantidades incompatibles;
- hacer aritmética monetaria con `number`.

**P3 gobierna cuándo dos `Money` son directamente homogéneos.**

#### T3 · Definición monetaria

Para cumplir **D2** y **P3**: cada definición monetaria usada por hechos
financieros tiene una **identidad interna estable e inmutable**, que representa
**la definición aplicada al hecho**, no solo el código ISO visible.

Conceptualmente, una definición conoce al menos: **código visible · escala o
unidad mínima aplicable · identidad estable**.

Si la definición cambia de forma que alteraría el significado monetario de los
hechos, **los hechos anteriores siguen vinculados a la definición histórica que
usaron**.

> **No se decide** nombre de tabla, columnas, UUID u otro identificador, esquema
> SQL, formas como `EUR_v1` ni convenciones de IDs visibles. **El identificador
> es interno; el usuario sigue viendo EUR, USD, JPY.** Las exclusiones de P3.5
> siguen vigentes.

**T3 es el mecanismo que cumple el requisito de D2.2, al nivel conceptual.** El
mecanismo concreto sigue abierto.

#### T4 · Corrección de metadata

Una definición monetaria usada por hechos históricos **no se modifica de forma
que reinterprete esos hechos**. Ante un cambio real de definición, una
redenominación o una corrección de metadata que afectaría al significado, debe
poder existir **una definición nueva** aplicable a los hechos nuevos, **o** un
mecanismo explícito de corrección. El flujo de migración no se diseña aquí.

#### T5 · Representación del tipo de cambio

**El tipo de cambio no es `Money`.** Existe un tipo conceptual separado,
`ExchangeRate`, representado como **decimal exacto, nunca coma flotante
binaria**, mediante **coeficiente entero + escala decimal**:

```
0,862034781245   ->   coefficient = 862034781245
                      scale       = 12
                      valor       = 862034781245 / 10^12
```

El coeficiente puede usar `bigint`. Permite calcular la conversión completa con
aritmética entera o racional **hasta el único redondeo final**. El núcleo
financiero no depende de `number`.

#### T6 · PostgreSQL para tipos de cambio

`NUMERIC` es la representación decidida para el valor decimal exacto de un tipo
de cambio, con restricciones explícitas que impidan valores inválidos.

**No se fija `NUMERIC(p, s)` ahora**, por no haber evidencia suficiente para
elegir precisión y escala definitivas. ADR-003 establece que debe ser **exacto**,
**nunca `REAL` ni `DOUBLE PRECISION`**, **preservar sin pérdida** la precisión de
los tipos admitidos, estar **acotado y validado**, y **no admitir en silencio
valores especiales o inválidos**. La precisión concreta se cierra con el diseño
del esquema.

**Cómo se garantiza:**

> **La persistencia deberá validar explícitamente que un tipo de cambio sea un
> decimal finito, positivo y válido para el dominio.**

No se admiten `NaN`, `Infinity`, `-Infinity`, ni tipos cero o negativos si el
dominio los considera inválidos. **No se confía únicamente en la declaración
`NUMERIC(p, s)`** para garantizarlo: `numeric` admite esos valores especiales, y
la restricción documentada a un `numeric` sin precisión finita afecta a **las
infinidades**, no a `NaN` (E10). El `CHECK` concreto pertenece al esquema y no se
diseña aquí.

#### T7 · Serialización

**Ningún importe monetario ni tipo de cambio cruza JSON como número.**

```
importe   8620n                  ->  "8620"
tipo      0,862034781245         ->  "0.862034781245"
```

En la entrada al dominio: **validar, parsear, construir** `Money` o
`ExchangeRate`. En la salida: **serializar de forma exacta**. **Aplica también al
almacenamiento sin conexión.**

#### T8 · PostgREST y E11

**No se altera el orden de fases** para resolver E11. En su lugar, **E11 se
convierte en una puerta explícita de aceptación de ADR-003**.

Al comenzar la fase de infraestructura y base de datos: prueba empírica real ·
comprobar `BIGINT` · comprobar `NUMERIC` · comprobar el cliente JS · comprobar
Supabase y PostgREST reales · verificar que la frontera elegida garantiza
strings sin pérdida.

Si el comportamiento por defecto de PostgREST no garantiza esa frontera, se
introducirá **una capa de transporte que la garantice** —adapter, RPC, vista con
cast u otro mecanismo—. **Cuál, no se decide ahora.**

> **El modelo de dominio no dependerá de que PostgREST casualmente serialice un
> tipo de una forma concreta.**

#### T9 · Estado de ADR-003

`ADR-003 — Representación exacta del dinero` se redactó en estado **`Propuesto`**,
con la aceptación condicionada únicamente a E11.

> **Cumplido.** E11 se ejecutó el 2026-08-19 contra un stack Supabase local real
> y no falsificó ninguna premisa. **ADR-003 pasó a `Aceptado` ese mismo día.**
> Ver E11 más abajo y §10 del ADR.

#### T10 · Redondeo FX

**Una única operación de redondeo**, al final de la conversión, al llegar a la
unidad mínima de la definición monetaria destino. **Sin redondeos intermedios.**

Modo: **half away from zero**, definido **sobre la magnitud absoluta**, aplicando
el signo después, para evitar diferencias de comportamiento entre runtimes. Para
cantidades positivas equivale al redondeo habitual de mitad hacia arriba. **El
algoritmo se documenta de forma independiente del runtime.**

#### T11 · Mayor resto y signo

El mayor resto trabaja con **enteros exactos** y **no depende de `%` con
operandos negativos**.

> **El reparto se calcula sobre una magnitud monetaria no negativa. El signo
> financiero pertenece al efecto que usa ese reparto, no al algoritmo de
> asignación.**

Cuotas, divisiones, restos y comparación de restos se calculan sobre **enteros
no negativos**. Elimina la ambigüedad de **E6**.

#### T12 · Conversión exacta

Una conversión se expresa **mediante enteros hasta el final**. Dados importe
origen en unidades mínimas enteras, tipo como coeficiente entero sobre potencia
de diez, y escalas de origen y destino conocidas, **el resultado previo al
redondeo se mantiene como cociente racional exacto**. Solo al producir las
unidades mínimas de destino se aplica **T10**.

**No se usan `Number()`, `parseFloat`, `Math.round` ni equivalentes binarios
dentro de esta matemática.**

#### Verificación de T1–T12 contra la evidencia y las decisiones

**Comprobado contra E1–E15 y contra D1–D3 · P1–P4: sin contradicción.** Detalle
de lo relevante:

| Decisión | Contrastada con | Resultado                                                                                                                                             |
| -------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1       | E2, E5, E9      | El techo de `BIGINT` sobra en todas las escalas admitidas por D3                                                                                      |
| T1       | E4              | `bigint` no serializa, y por eso existe T7                                                                                                            |
| T1       | E10             | `NUMERIC` es la recomendación idiomática de PostgreSQL para dinero. Se decide en contra a conciencia; la objeción sigue registrada                    |
| T2       | D1, P3          | `currencyDefinition` sustituye a la marca nominal de moneda que se había propuesto: es más fuerte, porque P3 exige comparar definiciones y no códigos |
| T3       | D2.2, P3.5      | Cumple el requisito de D2.2 al nivel conceptual sin violar las exclusiones de P3.5                                                                    |
| T5, T12  | E7, E13, E14    | La aritmética entera con un único redondeo final es exactamente lo medido en E7                                                                       |
| T7       | E3, E4          | E3 mide la pérdida al viajar como número JSON; T7 la evita por construcción                                                                           |
| T10      | E10             | _half away from zero_ coincide con cómo redondea `numeric` de PostgreSQL                                                                              |
| T11      | E6              | E6 midió que `BigInt` trunca hacia cero; T11 elimina el problema en lugar de tratarlo                                                                 |

#### Tres consecuencias que ADR-003 debe resolver por escrito

Detectadas al verificar T1–T12. **Ninguna bloquea**, las tres exigen una frase
explícita en el ADR.

1. **T6 necesita decir con qué mecanismo excluye los valores inválidos.** No
   puede ser la precisión declarada: `numeric` admite `Infinity`, `-Infinity` y
   `NaN`, y la restricción documentada a un `numeric` sin precisión finita
   afecta a **las infinidades**, no a `NaN` (E10). El mecanismo es **validación
   explícita** —decimal finito, positivo y válido para el dominio—, y el ADR
   debe enunciarla o la exigencia «no admitir valores especiales» queda sin
   mecanismo.
2. **La escala del tipo de cambio necesita una cota declarada.** T5 permite
   cualquier escala; T6 exige preservar sin pérdida. Si la escala no tiene tope,
   **ninguna columna `NUMERIC` puede garantizar la preservación**. ADR-003 debe
   exigir que exista **una cota máxima declarada**, aunque su número concreto se
   fije con el esquema.
3. **T11 introduce una restricción implícita que ADR-002 no enuncia:** que el
   total de un reparto sea no negativo. **Se ha buscado y no se ha encontrado
   ningún caso aceptado en ADR-002 que exija repartir directamente una cantidad
   negativa** —las correcciones son versiones, no importes negativos (§6), y las
   participaciones son positivas (§5)—. Pero ADR-002 tampoco lo prohíbe de forma
   explícita, así que ADR-003 lo enuncia como **restricción propia**, no como
   lectura de ADR-002.

#### Objeciones registradas contra T1–T12

- **`bigint` no serializa (E4).** Fricción real en cada frontera. T7 la convierte
  en una regla, no la elimina.
- **`NUMERIC` es la recomendación idiomática de PostgreSQL para dinero (E10).**
  Elegir `BIGINT` es un juicio sobre estados irrepresentables, no una
  demostración.
- **Todo descansa en que los importes viajen como string, y E11 sigue sin
  verificar.** Es precisamente por eso que T8 y T9 existen.

#### Objeción registrada contra esta decisión

**P4.1 obliga a disponer de tipos por fecha, no solo del tipo de hoy.** De dónde
vienen los tipos seguía anotado como pendiente fuera del alcance de ADR-003, y
esta decisión lo convierte en un requisito con forma: histórico, consultable por
fecha efectiva y determinista (P4.5). No invalida P4, pero **la dependencia es
real y no estaba en el plan**.

---

## Evidencia técnica verificada

Todo lo de esta sección está **medido**, no recordado.

| Campo         | Valor                  |
| ------------- | ---------------------- |
| Fecha         | 2026-08-19, ~13:22 UTC |
| Node          | 22.23.2                |
| Referencia PG | PostgreSQL 17 (docs)   |

### E1 · La coma flotante binaria falla de forma silenciosa

```
0.1 + 0.2            = 0.30000000000000004
0.1 + 0.2 === 0.3    = false
1.005 * 100          = 100.49999999999999   -> redondear a 2 dec da 1.00, no 1.01
```

### E2 · Límites concretos por escala

Enteros de 64 bits frente al entero seguro de JavaScript (2^53−1):

| Escala | Ejemplos | Máximo con `int64`         | Máximo con `number` de JS |
| :----: | -------- | -------------------------- | ------------------------- |
|   0    | JPY, KRW | 9 223 372 036 854 775 807  | 9 007 199 254 740 991     |
|   2    | EUR, USD | **92 233 720 368 547 758** | 90 071 992 547 409        |
|   3    | BHD, KWD | **9 223 372 036 854 775**  | 9 007 199 254 740         |

`int64` con 2 decimales admite ~92 mil billones de unidades monetarias: sobra
holgadamente. Con 3 decimales, `number` baja a **~9 billones** de unidades
monetarias —9 007 199 254 740,991 exactamente—, tres órdenes de magnitud menos
que con 2 decimales, pero sigue siendo un techo altísimo.

> **Corrección de una interpretación anterior (2026-08-19).** Una redacción
> previa leía esa cifra como «~9 mil millones» y la calificaba de «límite
> peligroso». Es falso: son ~9 **billones** europeos.
>
> **Las cifras de la tabla siempre fueron correctas; la lectura que se hacía de
> ellas, no.** La medición se conserva intacta.
>
> Y la conclusión que se apoyaba en esa lectura tampoco se sostiene: **el techo
> de `number` no es argumento para restringir qué monedas admite Nomey** (D3.2).
> `number` queda descartado para importes contables por **pérdida silenciosa de
> precisión** (E1, E3), no por su límite superior.

### E3 · Pérdida de precisión al cruzar JSON

```
entero 9007199254740993 como número JSON  ->  9007199254740992   PERDIDO
el mismo como string JSON                 ->  9007199254740993   intacto
numeric 12345678901234567890.123456
  como número JSON                        ->  12345678901234567000   PERDIDO
  como string JSON                        ->  12345678901234567890.123456   intacto
```

Afecta **por igual** a enteros grandes y a `numeric` grande: el problema no es el
tipo de origen, es viajar como número JSON.

### E4 · `BigInt` no serializa

```
JSON.stringify({ v: 1234n })
  -> TypeError: Do not know how to serialize a BigInt
```

Falla ruidosamente, lo cual es preferible a fallar en silencio — pero obliga a
convertir explícitamente en cada frontera.

### E5 · El mayor resto no necesita coma flotante

La «fracción descartada» se obtiene como **módulo entero**:

```
base_i  = (total × peso_i) / Σpesos      división entera
resto_i = (total × peso_i) % Σpesos      ES la fracción descartada, como entero
```

Comparar `resto_i` entre sí ordena por mayor fracción sin dividir nunca.
Resultados medidos, todos con suma exacta:

| Caso                  | Resultado             |
| --------------------- | --------------------- |
| 10,00 EUR / 3         | 3,34 · 3,33 · 3,33    |
| 100 JPY / 3 (0 dec)   | 34 · 33 · 33          |
| 1,000 BHD / 3 (3 dec) | 0,334 · 0,333 · 0,333 |
| 0,010 BHD / 3         | 0,004 · 0,003 · 0,003 |
| 100,00 EUR en 1:2:3   | 16,67 · 33,33 · 50,00 |

En el primer caso los restos son `1 · 1 · 1`: empate triple, y el céntimo va al
pagador según la regla de ADR-002.

### E6 · `BigInt` trunca hacia cero, no hacia −∞

```
-7n / 2n = -3n      -7n % 2n = -1n
```

**Con importes negativos el mayor resto necesita tratamiento explícito del
signo.** Es exactamente el tipo de detalle que produce un céntimo de diferencia.

### E7 · FX con un único redondeo al final

```
123,45 USD × 0,8592340000  ->  106,07 EUR
  producto exacto sin redondear: 106072437300000 / 1e12
  en float:                      106.0724373
123,45 USD -> JPY (0 dec) a 157,8912345678  ->  19492 JPY
```

Manteniendo el producto en enteros hasta el último paso, el redondeo ocurre una
sola vez, al llegar a la unidad mínima de la moneda destino.

### E8 · Una conversión FX **no es reversible**

Barrido de 200 000 importes por tipo, convirtiendo y reconvirtiendo:

| Tipo aplicado    | Fallos de ida y vuelta | Ejemplo            |
| ---------------- | ---------------------- | ------------------ |
| 1,1638420000     | 0 de 200 000           | —                  |
| **0,8592340000** | **28 153 de 200 000**  | 0,04 → 0,03 → 0,03 |
| 1,0000000001     | 0 de 200 000           | —                  |
| 3,3333333333     | 0 de 200 000           | —                  |

Es aritmética de redondeo, no un defecto de implementación: **ninguna
representación lo evita**. Obligó a decidir qué extremo es autoritativo: es la
evidencia de partida de **D1**, hoy decidida. Ver E13, que matiza esta tabla —la
irreversibilidad tiene dirección— y E14, que aísla una segunda causa.

### E9 · Deriva por acumulación

1 000 000 de operaciones de 0,01:

```
enteros ->  10 000,00 EUR          exacto
float   ->  10000.0000001719       deriva de 1,719e-7
```

### E10 · PostgreSQL (documentación oficial, no medido aquí)

Fuente: <https://www.postgresql.org/docs/17/datatype-numeric.html>

- `bigint`: −9 223 372 036 854 775 808 … +9 223 372 036 854 775 807, 8 bytes.
- `numeric`: _«Calculations with numeric values yield exact results where
  possible»_ y _«especially recommended for storing monetary amounts»_.
- Pero: _«calculations on numeric values are very slow compared to the integer
  types»_.
- **`numeric` redondea empates alejándose del cero**; `double precision` redondea
  al par.
- `numeric` admite tres **valores especiales**: `Infinity`, `-Infinity` y `NaN`.
- **Las infinidades** solo pueden almacenarse en un `numeric` **sin precisión
  finita declarada**, porque exceden cualquier límite de precisión.

> **Corrección de una afirmación anterior (2026-08-19).** Una redacción previa de
> E10 decía que **`NaN` solo puede almacenarse en un `numeric` sin precisión
> declarada**. **Es incorrecta:** la documentación establece esa restricción para
> **las infinidades**, no para `NaN`.
>
> El resto de E10 —exactitud de `numeric`, su lentitud relativa, el redondeo de
> empates alejándose del cero y la existencia de valores especiales— **sigue
> siendo válido y no se toca**.
>
> **Si `NaN` entra o no en un `NUMERIC(p, s)` no está medido**, y no hace falta
> medirlo para la Fase 2: T6 exige **validación explícita** y no se apoya en la
> precisión declarada para excluir nada.

### E11 · Verificado — serialización de PostgREST

**No se pudo confirmar en documentación oficial** cómo serializa PostgREST
`int8` y `numeric` hacia el cliente: ni la página de _resource representation_ ni
la documentación de Supabase lo especifican. Por eso hubo que medirlo.

> **Medido el 2026-08-19** contra Supabase local: PostgreSQL 17.6, PostgREST
> v16.1, Supabase CLI 2.115.0, `@supabase/supabase-js` 2.112.3, Node 22.23.2.
>
> - PostgreSQL almacena `BIGINT` y `NUMERIC` **exactamente**, con su escala.
> - PostgREST emite los **bytes JSON exactos**.
> - La degradación la produce **`JSON.parse`**, al convertirlos en `number`.
> - `BIGINT` por encima de 2^53 pierde precisión **en silencio**, con HTTP 200.
> - `NUMERIC` cruza también como `number`: pierde exactitud decimal y escala.
> - `supabase gen types typescript` produce `number` para `int8` y `numeric`.
> - Un cast explícito a `text` conserva valor y escala, y genera `string`.
> - Un RPC que devuelve `bigint` **sin cast falla igual** que una tabla directa.
>
> **Lo determinante es el cast, no el camino de acceso.** Scripts reproducibles
> en [`supabase/e11/`](../../supabase/e11/README.md); resultado normativo en
> §10 de [ADR-003](../adr/ADR-003-money-representation.md).

### E12 · El orden entre repartir y convertir cambia el resultado

Medido 2026-08-19, Node 22.23.2, aritmética entera con `BigInt` y redondeo
_half away from zero_.

Cena de 15 000 JPY entre tres, grupo con moneda base EUR, tipo JPY→EUR
0,0061234567:

```
repartir en JPY y convertir cada parte:  30,62 + 30,62 + 30,62 = 91,86 EUR
convertir el total y repartir en EUR:                            91,85 EUR
descuadre:                                                        0,01 EUR
```

Barrido de todos los totales del rango, contando en cuántos difieren ambos
órdenes:

| Conversión                    | 2 part. | 3 part. | 4 part. | 5 part. |
| ----------------------------- | ------: | ------: | ------: | ------: |
| JPY→EUR 0,0061234567 (20 000) |   6 122 |   9 877 |  12 099 |  13 512 |
| EUR→USD 1,1638420000 (50 000) |  20 905 |  29 689 |  35 451 |       — |

**Consecuencia medida:** si el reparto se calcula en la moneda declarada y luego
se convierte cada parte, la suma de las partes deja de coincidir con el total del
ámbito. Para que un reparto cuadre de forma exacta, la conversión debe ocurrir
**una sola vez** y el reparto debe calcularse **después**, ya dentro de la moneda
base del ámbito.

### E13 · La irreversibilidad del FX tiene dirección

Definiendo el **factor de expansión en unidades mínimas**:

```
k = tipo × 10^(escala_destino − escala_origen)
```

Barrido de 200 000 importes, convirtiendo y devolviendo con **la misma tasa
congelada** (multiplicar y luego dividir):

| Conversión                        |     k | No vuelven |
| --------------------------------- | ----: | ---------: |
| EUR(2)→USD(2) tipo 1,1638420000   | 1,164 |          0 |
| USD(2)→EUR(2) tipo 0,8592340000   | 0,859 |     28 153 |
| EUR(2)→JPY(0) tipo 157,8912345678 | 1,579 |          0 |
| JPY(0)→EUR(2) tipo 0,0063335000   | 0,633 |     73 330 |
| EUR(2)→BHD(3) tipo 0,4100000000   | 4,100 |          0 |
| BHD(3)→EUR(2) tipo 2,4390243902   | 0,244 |    151 220 |

Comprobación en el entorno de k = 1, con monedas de 2 decimales:

| k     | No vuelven de 200 000 |
| ----- | --------------------: |
| 0,99  |                 2 000 |
| 0,999 |                   200 |
| 1,000 |                     0 |
| 1,001 |                     0 |
| 1,010 |                     0 |

**Criterio observado, no demostrado:** en todos los casos medidos, `k ≥ 1`
conserva la información y `k < 1` la destruye. Se ha medido, no probado en
general.

**Matiza E8.** Los 28 153 fallos de E8 corresponden a un caso con `k < 1`; la
misma conversión en sentido contrario da 0. La irreversibilidad **no es
simétrica**: hay un extremo que puede reconstruir al otro y un extremo que no.

### E14 · Dos tipos publicados inversos no son inversos exactos

```
1,1638420000 × 0,8592340000 = 1,000012617028      (no 1)
```

EUR→USD→EUR sobre 200 000 importes:

| Vuelta calculada con…                    | No vuelven |
| ---------------------------------------- | ---------: |
| la **inversa exacta** del tipo congelado |          0 |
| el **par de tipos publicados**           |    160 354 |

**Son dos causas independientes de irreversibilidad**: el redondeo (E13) y el
hecho de que dos cotizaciones publicadas del mismo par no son recíprocas. Un
análisis que las mezcle atribuye al redondeo un error que no es suyo.

### E15 · Corolario: declarar en la moneda equivocada no cierra una deuda

Deuda registrada en EUR, Modo Personal del pagador en USD. Si el importe
autoritativo es el que el pagador teclea **en USD**, la reducción de la deuda es
derivada y sobre 200 000 deudas:

- con el par de tipos publicados: **160 354** no llegan exactamente a cero
  (ejemplo: deuda 58,99 EUR → 68,66 USD → la deuda baja 59,00 EUR, residuo
  −0,01, deuda sobrepagada);
- con la inversa exacta del tipo congelado y `k ≥ 1`: 0.

El resultado depende por completo de la dirección (E13) y del par de tipos
(E14). Declarar el importe **en la moneda en la que está expresada la
restricción de exactitud** —aquí, la moneda de la deuda— cierra la deuda por
construcción.

> **Nota de vigencia.** Una redacción anterior de esta evidencia añadía que el
> residuo «se traslada al lado de la caja, donde `ajuste` ya existe como
> mecanismo». **Esa interpretación queda superada por D1.10:** el residuo de un
> redondeo FX no genera `ajuste` ni ningún otro efecto. La medición no cambia;
> la lectura que se hacía de ella, sí.

---

## Recomendaciones — superadas por T1–T12

> **Esta sección ya no propone nada.** El 2026-08-19 se aprobaron **T1–T12**, que
> deciden la materia que aquí estaba abierta. Se conserva la correspondencia
> porque documenta qué se propuso, qué se aceptó y qué cambió.

| Propuesta original                                                      | Qué pasó                                                                                                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Importe: entero en unidad mínima, `bigint` / `BIGINT`                   | **Aceptada** en T1                                                                                                                                  |
| Moneda: ISO 4217 aparte, tabla propia versionada como fuente de escala  | **Sustituida** por T3: la unidad es la **definición monetaria con identidad interna estable**, no el código                                         |
| Tipo de cambio: decimal exacto con escala declarada                     | **Aceptada y precisada** en T5: coeficiente entero + escala                                                                                         |
| Serialización: string siempre                                           | **Aceptada** en T7, extendida al almacenamiento sin conexión                                                                                        |
| Dominio TS: `Money { minor, currency }` con marca nominal de moneda     | **Sustituida** por T2: `Money { minor, currencyDefinition }`. La marca nominal de **moneda** no bastaría, porque P3 exige comparar **definiciones** |
| Modo de redondeo: _half away from zero_                                 | **Aceptada y precisada** en T10: definido sobre la magnitud absoluta, signo después                                                                 |
| Reparto: mayor resto con enteros, signo negativo tratado explícitamente | **Sustituida** por T11: el reparto opera sobre magnitud **no negativa**; el signo pertenece al efecto. Elimina el problema en vez de tratarlo       |

### Por qué entero y no decimal

La escala ya se necesita como dato de primera clase para formatear y validar. En
cuanto existe, el entero hace **irrepresentable** el estado inválido
`12,345 EUR`, que el decimal solo puede prohibir por convención.

### Cómo se impediría el error, sin depender de disciplina

1. `Money` con **marca nominal de definición monetaria** (T2): sumar
   definiciones incompatibles no compila.
2. Sin `valueOf` ni `toJSON` que devuelvan número.
3. Campo interno privado, accesible solo por métodos de `Money`.
4. Regla ESLint que prohíba `Number()`, `parseFloat` y aritmética directa fuera
   de `domain/money`.

### Objeciones registradas contra la propia recomendación

- `bigint` no serializa (E4): fricción real en cada frontera.
- Si alguien convierte a `number`, se pierde precisión **en silencio** (E1, E3).
  Es el fallo más probable. El techo no es el problema —~9 billones de unidades
  con 3 decimales (E2)—; la pérdida de precisión sí.
- `NUMERIC` es la recomendación idiomática de PostgreSQL para dinero (E10); la
  preferencia por `BIGINT` es un juicio sobre estados irrepresentables, no una
  demostración.
- Todo descansa en que los importes viajen como string, y **E11 sigue sin
  verificar**.

---

## Pendientes

> **D1, D2, D3, P1, P2, P3 y P4 dejaron de estar aquí el 2026-08-19.** Están
> decididas: ver
> «Decisiones confirmadas de Fase 2». La evidencia que las sostiene —E2, E8,
> E12, E13, E14, E15— permanece intacta en su sección.
>
> **Recomendaciones superadas que no deben reintroducirse:**
>
> - D2 — «congelar la escala junto al importe». D2 decidió la **regla de
>   dominio** y dejó el **mecanismo** abierto (D2.2).
> - D3 — «lista blanca inicial corta, ampliable» y «excluir las monedas de 3
>   decimales». Ambas **descartadas**; la razón queda en «Alternativas
>   descartadas en D3».
> - P1 — «no hace falta ningún caso especial». **Matizada**: la decisión
>   conserva **un** caso especial explícito, corregir el propio tipo (P1.3). Lo
>   descartado es la clasificación de todos los campos, no la excepción única.
> - P2 — «solo puede cambiarla si está solo en el Grupo». **Descartada**:
>   participantes e invitaciones no bloquean el cambio (P2.3). La razón queda en
>   «Alternativas descartadas en P2».
> - P3 — «tratar cada definición como una moneda nueva, tipo `ARS_v1` / `ARS_v2`».
>   **No aceptada.** Se decidió la **regla de dominio** y el mecanismo quedó
>   abierto (P3.5). No es arquitectura aceptada y no debe tratarse como tal.
> - P4 — «usar el mejor tipo disponible y corregirlo automáticamente después».
>   **Descartada** en P4.4: produciría versiones, historial y notificaciones sin
>   corrección explícita. La vía correcta es P1.3.

**No queda ninguna decisión de dominio abierta en Fase 2.** Lo que sigue son
mecanismos y detalles, clasificados abajo.

### Otros pendientes

**Decisiones técnicas: ya no están pendientes.** Se aprobaron el 2026-08-19 como
**T1–T12**. Lo que queda de ellas para más adelante es el detalle de esquema:

- `NUMERIC(p, s)` concretos para el tipo de cambio (T6), y la **cota máxima de
  escala** que ADR-003 debe exigir aunque no fije su número.
- Nombre de tabla, columnas e identificador concreto de una definición monetaria
  (T3), que siguen fuera por P3.5.
- La capa de transporte que garantice la frontera de strings, si E11 revela que
  PostgREST no la garantiza por defecto (T8).

**Pendientes que ADR-003 puede dejar fuera:**

- **Presentación de una agregación imposible** — qué muestra Nomey cuando P3.2
  impide el total, y cómo se presenta la conversión explícita de P3.3 en
  estadísticas y vistas consolidadas. Es UX.
- **Mecanismos explícitos de conversión, redenominación, migración o corrección
  entre definiciones** (P3.6).
- **Política de selección de tipo por fecha** (P4.5) — proveedor, fuente,
  granularidad, cierre diario, último tipo anterior, promedio o intradía. P4 solo
  exige que corresponda al momento efectivo del hecho y que sea **determinista**.
- **Origen y frecuencia de los tipos de cambio.** P4.1 lo convierte en un
  requisito con forma —histórico consultable por fecha efectiva— aunque la fuente
  concreta siga fuera del alcance de ADR-003.
- **Copy definitivo** del conflicto de sincronización.
- **Criptomonedas, tokens, monedas retiradas y unidades de cuenta especiales**:
  fuera de D3.4, sin admitir ni excluir.

**Verificación empírica pendiente:**

- **E11**: serialización de PostgREST para `int8` y `numeric`, al conectar
  Supabase. **Ninguna decisión debería depender de que la respuesta sea una en
  concreto.**

---

## Alcance propuesto para ADR-003

**Debe recoger, ya decidido (D1):** el importe declarado como autoritativo y el
del ámbito como derivado y almacenado · la prohibición de reconstruir el
original desde el derivado · una conversión por ámbito y reparto posterior en la
moneda del ámbito · varias conversiones derivadas por operación, cada una con su
tipo · que el redondeo FX no genera `ajuste` · corrección por versionado al
cambiar importe o moneda.

**Debe recoger, ya decidido (P4):** que el tipo lo fija la **fecha efectiva** del
hecho, no la sincronización · que el tipo cacheado del cliente no es autoritativo
y lo resuelve el servidor · que una vez resuelto queda congelado, sin
revalorización automática · que no hay autocorrección silenciosa y la vía es
P1.3 · que la política de selección por fecha debe ser **determinista** · y que
una operación sin conexión que llega tras un cambio de moneda base **entra en
conflicto y requiere revisión**, sin reinterpretarse en silencio.

**Debe recoger, ya decidido (P3):** que dos importes solo se suman si comparten
definición monetaria · que el código ISO no basta para demostrarlo · la
prohibición de agregar en silencio importes de definiciones distintas aunque
compartan código, símbolo o nombre · y que `EUR + USD` exige conversión explícita
previa.

**Debe recoger, ya decidido (P2):** que el creador puede cambiar la moneda base
mientras el Grupo no tenga operaciones financieras · que participantes e
invitaciones no bloquean el cambio · que no genera notificación · que la primera
operación financiera la bloquea definitivamente · y el invariante de que una
operación creada bajo una configuración monetaria anterior nunca se reinterpreta
en silencio.

**Debe recoger, ya decidido (P1):** que corregir no revaloriza · que una versión
nueva hereda las conversiones históricas · que corregir el importe original
re-deriva con el tipo histórico · que la única excepción es corregir
explícitamente el propio tipo, versionada, atribuida y notificada · y que la
política se aplica **a cada conversión**, no a un tipo global de la operación.

**Debe recoger, ya decidido (D3):** las monedas fiat activas de ISO 4217 con
definición monetaria válida y controlada · que la escala no es criterio de
admisión, incluidas las de 3 decimales · que no se admiten códigos arbitrarios ·
que cripto, tokens, monedas retiradas y unidades de cuenta quedan fuera · que la
metadata que usa el dominio está bajo control de Nomey y no depende en tiempo
real de una API externa.

**Debe recoger, ya decidido (D2):** que el significado monetario de un hecho
histórico es inmutable · que un cambio de metadata monetaria nunca reinterpreta
hechos anteriores · la distinción entre cambio real de la moneda y errata de
Nomey · que editar una tabla de referencia nunca altera saldos, gastos o deudas
sin operación ni historial · y **el requisito** de que la definición monetaria
usada por un hecho sea reconstruible de forma exacta e inmutable.

**Debe decidir:** representación del importe, sin depender de `number` · **con
qué mecanismo se cumple el requisito de D2.2** —escala congelada en el hecho,
versión de la definición, referencia a metadata versionada o combinación— · **el
mecanismo de identidad monetaria que P3.5 dejó abierto**, incluidas la
identificación, el versionado y la migración de una definición ·
representación del tipo de cambio · política de serialización por frontera ·
tipos de dominio y qué garantías ofrecen · **modo** de redondeo · tratamiento del
signo negativo en el mayor resto · **P4**, qué momento fija el tipo de una
operación creada sin conexión, y cómo se resuelve el conflicto que P2.5 deja
planteado.

**Debe dejar fuera:** origen y frecuencia de los tipos de cambio · esquema,
tablas y migraciones · elección de librería concreta si acabara haciendo falta ·
la metadata de monedas en sí · el formateo por locale.
