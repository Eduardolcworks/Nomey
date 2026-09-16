# F11/ADR-002 — Tipo del día por moneda, fijación única y límite de antigüedad

- **Estado:** Aceptado
- **Fecha:** 2026-09-16
- **Supersede parcialmente:** [F11/ADR-001](ADR-001-fx-rate-resolution.md), y
  solo en estos puntos:
  - §3.2, la definición del tipo del día X;
  - §3.3, la fijación, incluida la cláusula «Publicación con retraso»;
  - §3.4, la frase «Nunca se usa un tipo más antiguo como sustituto»;
  - §3.5, «No se mezclan fechas»;
  - §5.1, el punto «Cobertura en la fecha»;
  - §6, la fila «Moneda no cubierta» y el paso 7 del orden de evaluación;
  - §9, la frase sobre «la fecha de referencia de la publicación usada».

  El resto de F11/ADR-001 sigue vigente y **no se reabre**. Eso incluye:
  - la fuente (§3.1) y la regla de otras fuentes (§3.6);
  - la fecha efectiva y lo que no la determina (§2), incluido el comienzo del
    día a las 00:00 de Fráncfort (§3.2);
  - las clases con moneda extranjera (§4) y la cobertura por definición y par,
    nunca por país (§5.1 y §5.2);
  - los códigos y estados de los resultados (§6), la derivación a escala 12
    (§7), la ausencia de tipo manual (§8) y la congelación (§9);
  - la base asumida al capturar (§10), la relación con Grupos (§11) y el reparto
    de bloques (§12).

## Contexto

F11/ADR-001 fija que el tipo del día X es **una publicación** del BCE: la de
fecha de referencia más reciente estrictamente anterior a X, con sus valores tal
como constan en la primera observación completa hecha después de las 00:00 de X
en hora de Fráncfort. Al preparar F11.B aparecieron dos problemas.

**1. §3.3 se contradice consigo mismo.** La regla operativa fija el día con «la
primera observación completa» posterior a las 00:00, y admite fijar con
observaciones más tardías cuando no hubo ninguna antes. La cláusula
«Publicación con retraso» dice, en cambio, que lo publicado después de las
00:00 no forma parte del día. Las dos solo coinciden si se observa antes de que
llegue el dato retrasado, y en una caída de la ingesta o en la carga inicial
eso es imposible.

**2. Una publicación puede llegar incompleta y completarse después.** Con
F11/ADR-001, la moneda ausente quedaba sin cobertura ese día (§5.1, §6). La
decisión de producto es otra: un retraso de una moneda **no** debe producir un
error.

**Medido el 2026-09-15** sobre las fuentes públicas del BCE:

- **El XML no trae marcas de tiempo.** Los ficheros `eurofxref-*.xml` no tienen
  ninguna marca por publicación ni por moneda. `Last-Modified` es del fichero y
  es la misma en los tres.
- **`VALID_FROM` no dice cuándo se publicó un dato.** El Data Portal
  (`EXR`, `includeHistory=true`) da un `VALID_FROM` por observación, pero:
  - las recargas lo reescriben: el 2022-07-19 se reselló de golpe todo junio y
    julio de 2022, y el tipo del 1999-01-04 lleva fecha de 2008-11-24;
  - las series de ILS se sellaron por meses completos entre 2016 y 2020;
  - desde 2016 no expone ni una sola versión sustituida.
- **Hay publicaciones incompletas que se completan después.** NOK del
  2025-10-23 apareció al día siguiente a las 14:50; seis divisas del 2023-09-13
  aparecieron al día siguiente a las 12:20. Las dos antes de la publicación del
  día hábil siguiente, que es el límite que el BCE se impone para republicar
  (F11/ADR-001 §3.1). El histórico XML de hoy muestra esas fechas completas: un
  fallo transitorio solo lo ve quien observaba en ese momento.
- **Las retiradas no se marcan.** En 7093 publicaciones y 41 divisas
  (1999–2026) no hay ningún hueco de un día. El único hueco es ISK, de
  2008-12-09 a 2018-02-01. Las series retiradas (BGN, RUB, HRK) simplemente
  terminan, con estado normal y sin ningún atributo de retirada; la retirada
  solo se anuncia en notas web.

**Decisiones de producto del 2026-09-15** que este ADR formaliza:

1. **Manda la observación de Nomey.** El tipo se decide con la primera
   observación completa de Nomey posterior a las 00:00 de X. No se reconstruye
   cuándo estuvo disponible cada dato en el BCE. `VALID_FROM`, `Last-Modified` y
   `ETag` pueden guardarse como evidencia, **nunca como autoridad**.
2. **Cada moneda se resuelve por separado.** Para una fecha efectiva X se usa el
   último tipo válido de esa moneda anterior a X, con un límite de antigüedad
   de **una publicación**. Un tipo más reciente que aparezca después **no
   modifica** ninguna fijación ya hecha, y la hora de escritura de la operación
   nunca determina el tipo.
3. **No se usan tipos manuales ni sustituciones arbitrarias.**
4. **Un 503 no aparece porque una moneda se retrase.** Se mantiene solo para un
   día todavía no fijado o una observación inválida.
5. **La cobertura curada de Nomey es la autoridad sobre retiradas conocidas.**
   Una moneda retirada sigue en el catálogo.
6. **Una moneda ausente no invalida un documento; un valor corrupto sí.** Un
   valor presente pero inválido, o un documento corrupto, invalidan la
   observación entera: el día no se fija y se responde 503 hasta que llega una
   observación válida.

## Decisión

### 1. Definiciones

- **Publicación.** Una fecha de referencia para la que la fuente publica al
  menos un tipo. Una misma fecha puede tener varias **versiones** —enmiendas o
  divisas añadidas después— y cada una se identifica por su contenido.
- **Observación.** Una lectura de la fuente hecha por Nomey, con su instante de
  servidor.
- **Observación completa.** Ver §2.
- **R(X).** La fecha de referencia más reciente estrictamente anterior a X entre
  las publicaciones de la observación que fija X, sea cual sea la moneda.
- **P(X).** La publicación inmediatamente anterior a R(X) en esa misma
  observación. **Es la publicación anterior, no el día natural anterior.** Si
  R(X) es la primera publicación de la fuente, P(X) no existe.

### 2. Observación completa

**Se valida el documento, nunca las monedas.** Una descarga de la fuente es una
**observación completa** si cumple **todas** estas condiciones:

1. **Llegó bien.** Respuesta satisfactoria de la URL oficial configurada, sin
   error de red y con contenido.
2. **El documento está entero y bien formado.** Se lee hasta el cierre de su
   elemento raíz y es un documento de la fuente: espacio de nombres esperado y
   remitente del BCE. Una página de error no lo es, aunque llegue con éxito.
3. **Las fechas son coherentes:**
   - cada fecha de referencia es una fecha válida y aparece una sola vez;
   - ninguna es posterior al día de la observación en hora de Fráncfort ni
     anterior a la primera publicación de la fuente;
   - cada fecha contiene al menos un tipo.
4. **Todos los tipos presentes son válidos.**
   - **Código:** tres letras mayúsculas, sin repetirse dentro de su fecha.
   - **Valor:** decimal escrito en positivo y **estrictamente mayor que cero**.

   **Un solo valor presente pero inválido invalida la observación entera**, sea
   o no de una moneda cubierta. Ejemplos: `N/A`, un negativo, cero o un formato
   decimal incorrecto. No se trata como ausencia de esa moneda: no se confía
   parcialmente en un documento con datos financieros corruptos.

5. **No deja huecos respecto a lo guardado.**
   - **Condición:** la fecha más antigua del documento es igual o anterior a la
     fecha de referencia más reciente que Nomey ya tenga guardada.
   - **Dentro de la ventana:** la ausencia de una fecha significa que ese día no
     hubo publicación.
   - **Sin nada guardado:** el documento debe empezar en la primera publicación
     de la fuente.
6. **No es más viejo que lo guardado.**
   - **Fecha más reciente:** no puede ser anterior a la más reciente ya
     guardada.
   - **Fechas ya vistas:** no puede faltar ninguna fecha que Nomey ya haya visto
     dentro de su ventana.
7. **Permite aplicar el límite de antigüedad al día que fija.** Para cada día X
   que vaya a fijar, contiene R(X) y P(X), salvo que R(X) sea la primera
   publicación de la fuente.

**Que falten una o varias monedas en una fecha no hace incompleta la
observación.** Cada moneda ausente se resuelve por separado según §3.

**Una observación que no es completa no fija ningún día.** Si el día X todavía
no estaba fijado, sigue sin fijar y responde 503 hasta la primera observación
completa. **Un día ya fijado no se ve afectado.**

Una observación completa hecha **antes** de las 00:00 de X no fija X. Un
documento con una sola fecha puede guardarse como evidencia, pero no fija días
que necesiten P(X) ni garantiza la condición 5.

### 3. El tipo del día X, por moneda

> **Para cada moneda C cubierta, el tipo del día X es su tipo en la publicación
> más reciente con fecha de referencia menor o igual que R(X) que contenga C,
> con el valor que consta en la observación que fija X, siempre que esa fecha
> sea R(X) o P(X).**

Llamamos r(C, X) a esa fecha de referencia.

- **Límite de antigüedad K = 1.** r(C, X) solo puede ser R(X) o P(X). Si el
  último tipo de C es anterior a P(X), o no existe ninguno, C **no tiene tipo el
  día X**.
- **Nunca se usa una publicación con fecha X o posterior.** Como R(X) < X, la
  regla de F11/ADR-001 §3.2 —solo publicaciones estrictamente anteriores a X—
  se mantiene para cada moneda.
- **EUR es el pivote**, con valor 1, y tiene tipo siempre que R(X) exista.
- **Los fines de semana y los cierres de TARGET no tienen regla propia.** R(X)
  y P(X) se cuentan en publicaciones, no en días.

### 4. Fijación única

> **Nomey fija el día X una sola vez, en la primera observación completa hecha
> después de las 00:00 de X en hora de Fráncfort.** En esa misma observación
> queda fijado, para cada moneda cubierta, su tipo del día X o la constancia de
> que no lo tiene. **Una vez fijado, no cambia.**

- **Una versión posterior no altera el día fijado.** Ni una moneda que aparece
  después, ni una enmienda, ni una publicación retrasada cambian el día X ni
  ninguna conversión congelada. Solo pueden formar parte de los días que se
  fijen después.
- **El tipo del día depende solo de lo guardado.** Se obtiene de las versiones y
  de la cobertura curada que constaban al fijar. Nunca de la hora a la que se
  crea, sincroniza o escribe una operación.
- **Días sin observación y carga inicial.** Se fijan con la primera observación
  completa posterior y con esta misma regla. Esto sustituye a la cláusula
  «Publicación con retraso» de F11/ADR-001 §3.3.
- **Enmiendas.** Una enmienda que llega entre las 00:00 y la observación que
  fija forma parte del día; una que llega después queda como historia. Es el
  margen que F11/ADR-001 §3.3 ya aceptaba.

### 5. Cobertura curada

La cobertura de una moneda por la fuente es un dato **curado por Nomey**:

- correspondencia versionada entre la definición monetaria y el código de la
  fuente (F11/ADR-001 §5.1);
- uno o varios **intervalos de fechas de referencia**, cada uno con inicio y un
  fin opcional, con la base del cambio y el enlace a la nota de la fuente.

Solo se modifica de forma explícita y trazable, y nunca se deduce de los datos.

**Cómo interviene en el día X:**

- **Sin correspondencia con la fuente** (hoy ARS, COP y CLP): la moneda no está
  cubierta en ningún día.
- **R(X) fuera de todo intervalo**, antes del inicio o después del fin: la
  moneda no tiene tipo el día X, **aunque K = 1 permitiera usar P(X)**. Una
  retirada registrada corta el límite de antigüedad.
- **r(C, X) anterior al inicio del intervalo que contiene R(X)**: la moneda no
  tiene tipo. Por ejemplo, RON nunca usa un tipo de ROL.
- **Una retirada registrada no modifica los días ya fijados**, como en §4. Su
  fin no puede ser anterior a la última fecha de referencia de esa moneda que
  ya haya usado alguna fijación.
- **Una moneda retirada o sin cobertura sigue en el catálogo monetario.**

### 6. Resultados

Los códigos y estados de F11/ADR-001 §6 no cambian. Cambian las condiciones:

| Situación                                                                                         | Resultado                         |
| ------------------------------------------------------------------------------------------------- | --------------------------------- |
| La definición no tiene correspondencia con la fuente                                              | `FX_CURRENCY_NOT_COVERED · 422`   |
| El día X no está fijado: todavía no ha habido una observación completa posterior a las 00:00 de X | `FX_RATE_NOT_YET_AVAILABLE · 503` |
| No existe R(X): no hay ninguna publicación anterior a X                                           | `FX_CURRENCY_NOT_COVERED · 422`   |
| R(X) está fuera de la cobertura curada de C                                                       | `FX_CURRENCY_NOT_COVERED · 422`   |
| El último tipo de C es anterior a P(X), o no existe                                               | `FX_CURRENCY_NOT_COVERED · 422`   |
| C tiene tipo el día X                                                                             | Resuelto                          |

- **La ausencia de una moneda en R(X) no produce ningún error** si C está en
  P(X).
- **Una observación que no es completa no fija nada** (§2): documento
  truncado, mal formado, vacío, con fechas incoherentes, con un valor inválido,
  con huecos o más viejo que lo guardado. Mientras no llegue una completa, el día
  sigue sin fijar y responde 503. **Un día ya fijado no cambia.**
- **Los 422 de esta tabla no cambian con el tiempo para esa fecha**, porque el
  día queda fijado una sola vez.
- **Orden de evaluación.** El paso 7 de F11/ADR-001 §6, «Cobertura en la
  fecha», pasa a ser: _la moneda de origen y la de destino tienen tipo el día X
  según §3 y §5_. Los pasos 1 a 6 y 8 no cambian. La cobertura de la definición
  (paso 5) se sigue comprobando antes que el día fijado (paso 6): un gasto en
  ARS no espera a nada.

### 7. Conversión y procedencia

- **Cada conversión toma sus dos tipos del día X.** Los tipos del origen y del
  destino pueden tener **fechas de referencia distintas**, dentro del límite de
  §3. Esto sustituye a «No se mezclan fechas» de F11/ADR-001 §3.5. **Nunca se
  mezclan fuentes.**
- **La derivación no cambia.** Sigue siendo `tipo(O → D) = q_D / q_O`, un único
  cociente racional exacto redondeado una vez a escala 12 (F11/ADR-001 §7), con
  q_O y q_D tomados de §3.
- **Procedencia.** Es no autoritativa y se guarda por conversión, con **la fecha
  de referencia y la versión usadas para el origen y para el destino**, la
  fuente y el método. Esto sustituye a «la fecha de referencia de la
  publicación usada» de F11/ADR-001 §9. `resolved_for_date` sigue siendo la
  fecha efectiva X.
- **La congelación no cambia** (F11/ADR-001 §9).
- **Las correcciones no cambian** (F03/ADR-010 §6). Si fecha, moneda y ámbito son
  los mismos, se copia el tipo congelado; si cambian, se resuelve con la fijación
  del día nuevo.

### 8. Qué se mantiene de F11/ADR-001 §3.4

**Un día no fijado no se resuelve con el día anterior.** Una operación con fecha
X anterior a su fijación —fecha futura, primeras horas en zonas adelantadas a
Fráncfort o ingesta caída— recibe 503. El único tipo antiguo admitido es el de
§3, dentro de un día ya fijado.

## Alternativas consideradas

**Decidir el tipo por la disponibilidad real en la fuente.** Se usaría solo lo
que ya estaba publicado en el BCE a las 00:00 de X. **Descartada:** ninguna
fuente del BCE dice cuándo estuvo disponible un dato (medido).

- `VALID_FROM` se reescribe con las recargas.
- No se exponen versiones sustituidas.
- En la carga inicial o tras una caída no hay forma de calcularlo.

**Fijar el día entero solo cuando la publicación esté completa.** Una moneda
retrasada dejaría a todas las demás en 503. **Descartada.** Con el caso medido
de NOK, todas las conversiones habrían esperado unas 15 horas, y un retraso en
viernes las bloquearía todo el fin de semana.

**Dejar solo la moneda retrasada en 503.** **Descartada por decisión de
producto:** un retraso de publicación no debe producir un error.

**Usar el último tipo de la moneda sin límite.** **Descartada.** Una moneda
retirada y todavía sin registrar seguiría convirtiéndose con cifras cada vez más
antiguas, que además quedarían congeladas para siempre. Es el riesgo que
F11/ADR-001 §5.1 ya señalaba con el rublo.

**Límite en días naturales.** **Descartada.** Un fin de semana o un festivo
contarían como antigüedad aunque la fuente no hubiera fallado.

**Límite de cero publicaciones.** Solo se aceptaría R(X). **Descartada:** cada
retraso de una moneda sería un error.

**Límite de dos o más publicaciones.** **Descartada.** Todos los retrasos
medidos se resolvieron antes de la publicación siguiente, y cada publicación
extra alarga el tiempo que una retirada sin registrar se sigue convirtiendo con
un tipo viejo.

**Actualizar el día X cuando llega un tipo más reciente.** **Descartada:** dos
operaciones con la misma fecha efectiva tendrían tipos distintos según la hora
de escritura, contra F11/ADR-001 §2.

**Deducir las retiradas de los datos.** **Descartada.** La fuente no las marca
(medido): un retraso largo y una retirada son indistinguibles hasta que se
anuncian.

**Tratar un valor corrupto como ausencia de esa moneda** y aplicarle el límite
de antigüedad. **Descartada por decisión de producto:** un documento con un dato
financiero corrupto no merece confianza parcial. En 7093 publicaciones
históricas no hay ningún valor así (medido), así que el coste esperado es
mínimo.

**Usar las series indicativas del Data Portal** para las monedas sin tipo de
referencia, como ARS. **Descartada:** son otra fuente (F11/ADR-001 §3.6).

## Consecuencias

### A favor

- **Un retraso de una moneda no produce errores ni bloquea a las demás.**
- **El tipo sigue siendo reproducible.** Sale de datos guardados e inmutables y
  no depende de la hora de escritura ni de sincronización.
- **Las retiradas conocidas se aplican de forma explícita y trazable**, y las
  monedas no desaparecen del catálogo.
- **Sin tipos manuales ni sustituciones sin límite.**
- **Se elimina la contradicción interna de F11/ADR-001 §3.3.**

### En contra

- **Una moneda retrasada va una publicación por detrás.** Con una publicación
  normal ya va una por detrás (F11/ADR-001, Consecuencias); para esa moneda, ese
  día, van dos.
- **Una conversión cruzada puede combinar fechas de referencia distintas**, y la
  procedencia tiene que mostrarlas por separado.
- **Dos publicaciones seguidas sin una moneda dan un 422 definitivo** para los
  días fijados en ese estado, aunque después se publique el tipo. Es posible que
  un día dé 422 y el siguiente se resuelva. Por ejemplo: NOK falta el jueves y
  el viernes, el sábado se fija sin NOK y el domingo se fija después de llegar
  NOK del viernes.
- **Una retirada sin registrar sigue convirtiéndose durante una publicación**
  con el último tipo, y a partir de ahí da 422. Un corte largo de una moneda y
  una retirada no se distinguen hasta que se registran: los días de un corte
  largo quedan en 422 y no se reintentan.
- **La cobertura curada es trabajo recurrente.** Hay que registrar inicios,
  retiradas y reincorporaciones como ISK, con su evidencia.
- **Hay que guardar una fijación por día y moneda**, además de qué versiones
  contenía cada observación.
- **Un solo valor corrupto deja sin fijar el día para todas las monedas** hasta
  la siguiente observación completa, aunque las demás sean correctas.
- **F11.C** tiene que mostrar la fecha de referencia de cada moneda y citar al
  BCE.
