# F11/ADR-003 — Conversión y reparto de un gasto de grupo en moneda extranjera

- **Estado:** Aceptado
- **Fecha:** 2026-09-22
- **No supersede nada.** Precisa la integración que
  [F11/ADR-001](ADR-001-fx-rate-resolution.md) §4 y §11 dejan asignada a F11.D,
  y no reabre ninguna de sus decisiones: ni la fuente, ni la fecha efectiva, ni
  los resultados y códigos de §6, ni la derivación de §7, ni la congelación de
  §9, ni la base asumida de §10. Tampoco toca
  [F11/ADR-002](ADR-002-per-currency-daily-rate.md).

## Contexto

F11/ADR-001 §4 admite moneda extranjera en `group_expense` «al integrarse
Grupos (F9)», y dice que un gasto de grupo convierte «hacia **cada ámbito
alcanzado que lo requiera**: el del Grupo y, si su base difiere, el Modo
Personal del pagador». §11 añade que, si esa base no está cubierta en la fecha,
**se rechaza el gasto entero**, porque los efectos de una operación son
atómicos.

Lo que ninguna decisión aceptada cubre, y este ADR fija:

1. **En qué orden** se convierte y se reparte, y qué significa `exact_amounts`
   cuando lo declarado está en otra moneda.
2. **Qué ocurre con la cuota de cada participante** cuando la base de su Modo
   Personal no es la del grupo. F11/ADR-001 §4 enumera los ámbitos alcanzados
   por los **efectos**; la cuota de un participante no produce ningún efecto en
   su Personal, pero sí entra en sus estadísticas personales, que se expresan en
   la base de ese Personal.

El segundo punto es un defecto vivo, anterior a F11: `api.personal_statistics`
suma la cuota de un gasto compartido **en la moneda del grupo** sobre un total
en la base del Personal. Lo introdujo F9, F11.C lo identificó y lo dejó
explícitamente para este bloque.

## Decisión

### 1. Se convierte antes de repartir

El total del gasto se convierte **una sola vez** desde el importe original a la
moneda base del grupo, y **el reparto ocurre después**, en moneda del grupo.

La alternativa —repartir en la moneda original y convertir cada cuota— produce
tantos redondeos como participantes y una suma que no tiene por qué coincidir
con el total convertido. El invariante de F01/ADR-001 «si los saldos no cuadran
exactamente, es un error» no admite esa aproximación.

Queda, por construcción:

```
SUMA(resolved_amount) = total convertido a la base del grupo
```

### 2. `exact_amounts` bajo conversión: lo declarado son proporciones

Los importes declarados de un reparto exacto están en la **moneda original**,
que es la única en la que la persona los declaró.

- **La validación sigue siendo en esa moneda.** La suma de los declarados tiene
  que ser exactamente el total declarado, y `SPLIT_EXACT_AMOUNTS_MISMATCH` sigue
  existiendo con su significado. No hay corrección silenciosa.
- **El reparto es del total convertido, con los declarados como pesos**, con el
  mismo reparto proporcional, el mismo mayor resto y el mismo desempate
  determinista que `equal` y `shares` — el pagador primero, después el orden
  estable de la operación.

**Sin conversión, esto no cambia nada.** El total objetivo es el declarado y la
suma de los pesos es ese mismo total, así que el asignador devuelve los
declarados exactamente. Los vectores compartidos siguen valiendo.

**Consecuencia sobre el esquema:** el `CHECK` que exigía
`resolved_amount = declared_amount` en `exact_amounts` deja de ser cierto bajo
conversión, y **no puede expresarse en una fila**, que no sabe si su versión
convirtió. Se reclasifica como invariante de la frontera autoritativa, igual
que la cardinalidad mínima del reparto, y se comprueba con falsación. No se
sustituye por una versión debilitada.

### 3. Cada conversión sale del importe original

Un gasto de grupo alcanza varios ámbitos. **Cada uno convierte desde el importe
original declarado**, nunca desde el total ya convertido de otro:

- la base del grupo;
- la base del Modo Personal del **pagador**, para su caja;
- la base del Modo Personal de **cada participante**, para su cuota.

Encadenar `original → grupo → personal` redondearía dos veces sobre la misma
cifra, y el resultado dependería del orden de los ámbitos. F11/ADR-001 §7 fija
un único redondeo por conversión; esto lo preserva por ámbito.

La cuota personal de un participante es **el mismo reparto** —mismos pesos,
mismo desempate— aplicado al total convertido a **su** moneda. Cuando su base
es la del grupo, coincide con `resolved_amount`.

### 4. La cuota personal se persiste; no se materializa como efecto

La cuota convertida a la base personal de cada participante **se persiste junto
al reparto**, no como un `core.effect` en su Modo Personal.

Por qué no un efecto:

- **Un gasto de grupo sigue siendo una entidad del grupo.** Su dimensión
  económica vive en el ámbito del grupo, con el participante nombrado. Añadir un
  efecto económico en cada Personal duplicaría ese hecho.
- **Cambiaría la atribución de [F03/ADR-013](../F03/ADR-013-economic-attribution.md)**,
  que distingue la dimensión económica _con_ participante —de quien esté
  vinculado— de la que _no_ lo lleva, que es del propietario del ámbito.
- **El Disponible se deriva de los efectos vigentes.** Un efecto económico
  nuevo no lo movería, pero sí obligaría a que toda lectura personal supiera
  excluirlo, que es exactamente la clase de regla que produce errores callados.

Persistirla es necesario porque **una lectura no puede convertir**: F11.C fijó
que las superficies no resuelven tipos ni vuelven a redondear. La cifra tiene
que existir escrita, con su moneda, en el momento de la escritura.

### 5. El gasto es atómico

Si el tipo de **cualquier** ámbito alcanzado no se puede resolver —moneda no
cubierta, o día todavía sin fijar— se rechaza **el gasto entero**, con los
códigos y estados que F11/ADR-001 §6 ya define, y no queda ninguna fila.

Es la misma regla que §11 fija para el pagador, extendida a los ámbitos que la
cuota personal alcanza. Un participante cuya moneda bloquee el gasto es
visible y corregible; un gasto registrado a medias, no.

### 6. Lo que no cambia

- **Las liquidaciones, los pagos declarados, las transferencias y los ajustes
  siguen sin convertir.** Conservan `sec.assert_no_conversion`. Las dos únicas
  llamadas que se retiran son las del writer del gasto de grupo.
- **El grupo sigue siendo net-zero en su moneda base.** Cuotas y deudas se
  expresan en ella; la conversión ocurre antes del reparto y nunca dentro.
- **Las guardas de F9 y F10 siguen intactas**: retirados, salidos,
  sobreliquidación, cerrojo de identidad y orden de cerrojos. Una corrección que
  cambie la deuda de quien salió se sigue rechazando, y **no se introduce
  ninguna excepción por FX**.
- **Una corrección hereda o resuelve como en F11.B**: misma fecha efectiva y
  misma moneda original reutilizan la conversión congelada; cambiar cualquiera
  de las dos resuelve de nuevo. Nunca se modifica una conversión ya congelada.

### 7. La caja incorporada de un participante sin cuenta

Al asociar a la propia cuenta un participante sin cuenta que pagó gastos
(F09/ADR-009), la caja que se incorpora **no es el importe declarado de la
versión**: es el importe del gasto **en la moneda del ámbito** al que entra.

No se resuelve ningún tipo en ese momento: se lee el reparto ya persistido, cuya
suma es el total en la moneda del grupo. La negativa preexistente cuando la base
del grupo difiere de la del Personal **se conserva**; levantarla es otra
decisión y no la toma este ADR.

## Alternativas consideradas

- **Repartir en la moneda original y convertir cada cuota.** Rechazada: N
  redondeos y una suma que no cuadra con el total.
- **Convertir la cuota del grupo hacia cada Personal.** Rechazada: encadena dos
  redondeos sobre la misma cifra.
- **Materializar la cuota personal como `core.effect`.** Rechazada por §4.
- **Excluir de las estadísticas personales las cuotas en otra moneda.**
  Rechazada como regla general: es lo que se hace con las filas anteriores a
  este bloque, que no tienen conversión congelada y para las que inventar una
  sería peor, pero no puede ser el comportamiento de lo que se escribe a partir
  de ahora.

## Consecuencias

### A favor

- Una cuota compartida deja de sumarse en una moneda distinta de la del total
  que la contiene, que era un error silencioso.
- Toda cifra publicada lleva su moneda: el declarado la suya, la cuota del grupo
  la del grupo y la cuota personal la del Personal.
- No hay una segunda política de FX: el resolver, la conversión, la congelación
  y la procedencia son los de F11.B.

### En contra

- **`exact_amounts` cambia de significado bajo conversión**, y la interfaz
  tendrá que explicarlo: lo declarado exacto pasa a ser una proporción.
- **Un gasto de grupo puede ser rechazado por la moneda de un participante**,
  que es una dependencia nueva entre personas del mismo grupo.
- **El writer resuelve tantos tipos como monedas personales distintas haya**,
  y bloquea sus ámbitos para leer sus bases.
- **Las filas anteriores a este bloque cuya base personal difiera de la del
  grupo desaparecen de las estadísticas personales** en lugar de sumarse mal.
  Es el único tratamiento posible sin inventar una conversión histórica.
