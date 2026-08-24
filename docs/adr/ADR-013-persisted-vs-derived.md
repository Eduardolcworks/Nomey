# ADR-013 — Persistido frente a derivado, reparto contextual y proyección canónica

- **Estado:** Aceptado
- **Fecha:** 2026-08-24

## Contexto

[ADR-011](ADR-011-operation-version-model.md) fijó el modelo físico de
operaciones, versiones y comandos cliente, y **delegó aquí** cuatro cosas: la
forma física de los datos autoritativos de cada versión, el inventario de lo
persistido frente a lo derivado, **la proyección canónica de efectos vigentes**
y el **mecanismo de lock de la deuda**.

El traspaso no era una formalidad. ADR-011 §3 lo dejó escrito como el riesgo
dominante del modelo:

> Qué efectos son económicamente vigentes depende de la versión que seleccione
> `operation.current_version_id`. Si las consultas normales reimplementan a mano
> ese filtro, olvidarlo suma efectos históricos y actuales y produce **cifras
> infladas que no fallan**.

El caso mínimo:

```
Gasto V1 = 60 €  →  efectos de V1   (permanecen, históricos)
       corrección
Gasto V2 = 75 €  →  efectos de V2   (los únicos que cuentan hoy)
operation.current_version_id = V2
```

Una consulta que olvide el filtro responde 135. No lanza ningún error, no
aparece en ningún log y solo se detecta cuando alguien compara la cifra a mano.

Además, [ADR-012](ADR-012-participant-identity.md) cerró la identidad de los
participantes sin resolver dónde viven la intención declarada de un reparto y su
resultado resuelto, y [ADR-009](ADR-009-authoritative-write-boundary.md) §7
conservó el invariante que midió E15 —**la comprobación y el consumo de la deuda
pendiente deben serializarse atómicamente**— sin poder elegir el mecanismo,
porque dependía de si la deuda se materializa o se deriva.

**El experimento E19** midió los dos puntos que dependían de comportamiento real
de PostgreSQL: si la RLS sobrevive a una **cadena de dos vistas
`security_invoker`**, y si el catálogo permite **verificar** que nadie se salta
la proyección canónica. Evidencia en
[`supabase/e19/`](../../supabase/e19/README.md).

### Qué estaba decidido antes de este ADR

Los hechos son inmutables y corregir es versionar (ADR-002 §6) · saldos y
estadísticas se derivan de la versión vigente (`data-model.md` §7) · cada
operación tiene **exactamente un importe original autoritativo** y puede tener
varias conversiones derivadas (ADR-003 §1) · el tipo de cambio queda congelado y
corresponde a la fecha efectiva (ADR-003 §4, invariante 27) · la RLS de `core`
es la autoridad por fila a través de vistas `security_invoker` (ADR-006 §5,
ADR-007 §1) · el writer es no propietario y `NOBYPASSRLS`, y **sigue sometido a
RLS** (ADR-009 §5-§6, medido en E16) · los efectos referencian siempre al
participante (ADR-012 §3) · el participante es **contextual por ámbito** y los
de ámbitos distintos no se correlacionan (ADR-012 §1).

## Decisión

### 1. Tres capas de datos, y dos criterios que no se mezclan

| Capa                          | Contenido                      | Criterio                                                                       |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------------------------ |
| **Hechos autoritativos**      | Lo que se persiste             | El usuario lo declaró, **o** su recomputación futura podría dar otro resultado |
| **Proyecciones recuperables** | Lo que se calcula al preguntar | Se reconstruye exactamente desde los hechos                                    |
| **Cachés**                    | **Vacía en v1**                | Se persistiría solo por coste de lectura                                       |

> **«Persistir porque es verdad histórica» y «materializar porque calcular es
> caro» son criterios distintos y no se sustituyen.** El segundo **no justifica
> ninguna caché económica en v1**, y que la tercera capa esté vacía es una
> decisión, no un olvido.

**Persistido autoritativo:** `operation` · `operation_version` ·
`current_version_id` · el **importe original y su definición monetaria** · las
**conversiones aplicadas, congeladas** · la **cabecera de reparto** cuando
exista · la **intención declarada** del reparto · el **resultado resuelto** del
reparto · `effect` · la **versión de reglas económicas**.

**Derivado:** saldo de un ámbito · deuda · estadísticas · totales ·
`Disponible actual` · `Disponible tras saldar`.

Las dos últimas quedan sujetas a la regla de agregación del glosario: si los
importes implicados pertenecen a definiciones monetarias distintas, **no hay
cifra que mostrar**.

**Una caché posterior es aditiva** y no compromete el modelo. Introducirla
exigirá medición, no previsión.

### 2. `operation` — conceptos transversales

Contiene **exclusivamente**: identidad estable · **clase de operación** ·
atribución inicial · instante de creación · `current_version_id`.

**No contiene ámbito**, y esto corrige expresamente una propuesta intermedia del
análisis. Una operación **alcanza varios ámbitos** —un gasto de Grupo toca el
Grupo y el Modo Personal del pagador; una transferencia interna toca dos Modos
Personales; una liquidación mediante transferencia toca tres—, así que no existe
un «ámbito de la operación» único para todas las clases. La pertenencia de cada
hecho a un ámbito la representa `effect`.

**No contiene importe.** El importe pertenece a la versión (§3).

**No contiene `client_operation_id`.** La unidad de idempotencia es el comando,
y vive en `core.client_command` (ADR-010, ADR-011 §5).

#### Visibilidad de la clase de operación

> **Un actor que puede ver al menos un efecto de una operación puede conocer la
> clase de operación que lo produjo.**

El motivo es que sin ella **el efecto propio queda sin interpretar**: un −80 € en
el Modo Personal significa cosas distintas según provenga de un gasto, de una
transferencia o de la financiación de un Modo Pareja, y ADR-002 §10 sustituye la
confirmación previa por atribución, historial y notificación — lo que exige que
el afectado pueda entender lo que ve.

**Esta regla no concede ningún otro acceso.** En particular **no** concede: el
ámbito contextual relacionado · su identidad ni su nombre · sus miembros · sus
participantes · sus otros efectos · su actividad · ninguna otra información que
ese ámbito proteja. La clase es **el tipo** de operación; no dice de qué ámbito,
ni quién está en él, ni cuántos son.

> **No se adopta ningún invariante que restrinja qué combinaciones de ámbitos
> podrá alcanzar una clase futura.** Una clase nueva que introduzca relaciones
> multiámbito distintas deberá demostrar que respeta las fronteras de
> visibilidad vigentes; este ADR **no** las prejuzga.

### 3. `operation_version` — la unidad histórica

Contiene: `version_no` · `supersedes_version_id` · atribución de **esta**
versión · instante de **esta** versión · **fecha efectiva** · **exactamente un
importe original** · **definición monetaria de ese importe** · **versión de
reglas económicas**.

**No contiene clase**, que se hereda de `operation` y no se duplica: dos sitios
para el mismo dato son dos sitios donde puede decir cosas distintas.

**No contiene ámbito**, por la misma razón que `operation`.

**No contiene método de reparto ni pagador**: pertenecen al reparto contextual
(§5).

El **signo del importe original no es transversal** —un ajuste negativo es
válido, un gasto de cero o negativo no—, así que su validación es por clase, en
la frontera autoritativa, y no una restricción única sobre la columna.

Todos los campos de esta relación son conocibles por cualquiera que pueda ver
alguno de sus efectos. En particular **el importe original y su definición
monetaria**, porque ADR-003 §1 los declara el valor principal de la interfaz y
prohíbe reconstruir el original desde un derivado: quien solo viera su derivado
no podría distinguir «100 USD convertidos» de «92 EUR», que es exactamente la
distinción que ADR-003 preserva.

### 4. Vigencia

> **`current_version_id` es estado autoritativo persistido.** ADR-011 §1 decide
> que el puntero **selecciona** qué versión cuenta; no es la caché de otra cosa.

Bajo el modelo lineal actual se cumple además:

```
current_version_id  ==  la versión de mayor version_no
```

Eso es **un invariante de integridad, una comprobación de consistencia y una vía
de reconstrucción**. **No es una segunda definición de vigencia.**

La diferencia no es semántica. Con la lectura correcta, insertar una versión no
cambia la contabilidad hasta que alguien mueve el puntero, y eso es lo que hace
significativa la restricción de ADR-011 §14, que reduce la superficie mutable
del modelo a ese único puntero. Con la lectura contraria, cualquier `INSERT` en
la tabla de versiones alteraría qué cuenta.

> Una **anulación o revocación** futura —que ADR-011 deja expresamente fuera de
> alcance— podría devolver la vigencia a una versión anterior y **hacer que ese
> invariante deje de cumplirse, sin cambiar el significado autoritativo de
> `current_version_id`**.

### 5. El reparto es contextual, no de la versión

Se separa en dos niveles:

```
operation_version
   └── cabecera de reparto  (versión, ámbito)
          └── participantes del reparto
```

**La cabecera de reparto** contiene: **ámbito** · **método de reparto** ·
**pagador contextual**, cuando la clase lo requiera.

**Cada fila de participante** contiene: **participante** · **ordinal** · **peso
declarado** cuando el método sea `shares` · **importe exacto declarado** cuando
sea `exact_amounts` · **resultado resuelto**.

**Por qué no viven en la versión.** Un reparto ocurre en **exactamente un
ámbito**, entre los participantes **de ese ámbito**, en **su moneda base**, y con
el orden estable **de esos participantes**. Todas sus entradas y todas sus
salidas son locales al ámbito. El pagador, además, es un `participant_id`, y
ADR-012 §1 fija que el participante es **contextual** y que los de ámbitos
distintos **nunca se correlacionan automáticamente**: un identificador
contextual colocado en una fila que no declara su contexto invita a leerlo,
compararlo o indexarlo fuera de él.

**Hay una consecuencia de autorización que es la razón de fondo.** Una política
RLS decide **qué filas** puede leer un rol; **no puede ocultar columnas de una
fila** para unos ámbitos y mostrarlas para otros. Con el método y el pagador
dentro de `operation_version` —una fila sin ámbito—, su protección dependería de
que ninguna clase futura alcance el ámbito de alguien ajeno al contexto: una
propiedad contingente. En una fila que **porta el ámbito**, su política es la
misma que la de `effect`, y la protección pasa a ser **estructural**.

No se resuelve esto con una vista de `api` que omita columnas. E19 midió que la
cadena `security_invoker` exige privilegio del invocante **sobre las relaciones
base**, de modo que si la RLS permite leer la fila hay que asumir que sus
columnas concedidas son alcanzables desde cualquier superficie legítima futura.
Los privilegios por columna de PostgreSQL tampoco sirven: son **por rol**, no
por ámbito, y no pueden expresar «visible para los miembros del ámbito X».

**Invariantes del reparto:**

- un participante figura **una sola vez** en un mismo reparto;
- el **ordinal es único** dentro del reparto;
- el participante se referencia mediante **clave foránea real**;
- el **pagador pertenece a ese reparto** cuando la clase requiere pagador;
- la **participación declarada es positiva** cuando el método la declara —el peso
  de `shares`, el importe de `exact_amounts`—;
- el **resultado resuelto puede ser cero** por indivisibilidad, y **los ceros
  resueltos se conservan**;
- **la deuda de cero puede seguir omitiéndose**, tal como hace el dominio.

**La definición monetaria del resultado resuelto no se persiste.** La determina
la **moneda base del ámbito** de la cabecera, que ADR-002 §8 y ADR-003 §7 hacen
**inmutable tras la primera operación** del ámbito. La determinación es
estructural e inequívoca, y duplicarla crearía un sitio donde pueda decir otra
cosa.

#### El reparto final del Modo Pareja

Reutiliza **`exact_amounts`** como primitivo de asignación. Un saldo común de
800 € repartido 500/300 se representa como total 800 con dos participaciones
exactas declaradas cuya suma coincide con el total, que es exactamente lo que
`exact_amounts` significa.

> **Reutilizar el primitivo técnico no convierte el cierre de un Modo Pareja en
> un gasto dividido.** Conceptualmente sigue siendo el **reparto de saldo durante
> el cierre**, con su bilateralidad (ADR-002 §9, invariante 17) y sus reglas
> propias. Lo que se reutiliza es la representación de «un total, unos
> participantes y unas asignaciones exactas que suman el total».

No se crea una estructura paralela para esos dos importes salvo que una
necesidad futura demuestre que `exact_amounts` es insuficiente.

### 6. Importe original y conversiones

> **Una operación/versión → exactamente un importe original → 0..n conversiones
> derivadas, una por ámbito alcanzado que lo requiera.**

Por cada conversión se congela: **ámbito** · **definición monetaria origen** ·
**definición monetaria destino** · **coeficiente exacto** · **escala** ·
**fecha efectiva para la que se resolvió** · **procedencia opcional**.

> **Se congela el valor, no una referencia.** Una fila de catálogo puede
> corregirse después, y leer la historia a través de ella la reinterpretaría en
> silencio, contra el invariante 22. **Nunca se reconstruye una conversión
> histórica desde un catálogo futuro.**

La **procedencia no es autoritativa**: sirve para auditar de dónde salió el tipo,
**nunca para calcular**.

**Que la fecha de resolución se persista es lo que hace verificable la regla de
correcciones**, porque debe coincidir con la fecha efectiva de su versión.

#### Correcciones

| Qué cambia la corrección                                              | Tipo de cambio             |
| --------------------------------------------------------------------- | -------------------------- |
| Solo nota o metadata                                                  | **Hereda** el FX congelado |
| Importe, con las mismas entradas de FX                                | **Hereda** el FX congelado |
| **Fecha efectiva**                                                    | **Nueva resolución**       |
| **Definición monetaria o ámbito** que invalide la conversión anterior | **Nueva resolución**       |

Esto precisa —no contradice— la regla de `data-model.md` §7 e invariante 27.
Ambos textos fijan que una corrección hereda el tipo histórico salvo que el tipo
sea el dato corregido, y ninguno contempla que la corrección cambie una
**entrada** de la que el tipo depende. En esos casos no hay herencia ni
corrección del tipo: hay **una resolución nueva, consecuencia de haber corregido
sus entradas**.

Heredar tras cambiar la fecha efectiva sería además **representacionalmente
imposible**: obligaría a almacenar una fecha de resolución distinta de la fecha
efectiva de la versión, es decir, un hecho falso.

> **La conversión nueva debe poder previsualizarse antes de confirmar la nueva
> versión.**

**No se decide aquí**, y ADR-003 lo deja expresamente fuera de alcance: el
proveedor · la fuente del tipo · el algoritmo de selección · el catálogo
histórico general · qué ocurre si no hay tipo exacto para una fecha.

### 7. Versión de reglas económicas

Se persiste en cada `operation_version` como **metadata inmutable de
auditoría**.

**Significa** una sola cosa: el **contrato de derivación** bajo el que se
produjeron los resultados de esa versión.

**No implica**: poder ejecutar reglas históricas · conservar implementaciones
antiguas · un dispatcher multiversión · recomputar versiones antiguas.

> **Los resultados congelados y los efectos persistidos son el histórico
> autoritativo.** Se leen; **no se re-derivan.**

**Correcciones:** una versión nueva se calcula con **las reglas vigentes en el
momento de crearla**, conservando la intención declarada que el usuario no haya
cambiado. **La versión anterior permanece intacta**, y la nueva registra las
reglas que realmente la produjeron.

> **Antes de confirmar debe poder mostrarse la previsualización del resultado
> nuevo.** Sin ella, un cambio de reglas podría mover un céntimo de desempate
> como efecto lateral de una corrección que no lo pedía. Con ella, deja de ser un
> efecto lateral y pasa a ser algo que el usuario acepta.

Se adopta una columna explícita en lugar de inferir el contrato por la fecha de
creación, por el mismo motivo que ADR-011 §9 adoptó `command_contract_version`:
inferirlo deja ambigüedad justo en la frontera de un despliegue.

**No se fija aquí el nombre físico de la columna.**

### 8. `effect` — cabecera y tres dimensiones

**Cabecera:** ámbito · clase contable · definición monetaria · versión a la que
pertenece.

**Tres dimensiones independientes**, tal como las enumeran ADR-002 §1 y
`data-model.md` §1:

| Dimensión     | Contenido                                                                           |
| ------------- | ----------------------------------------------------------------------------------- |
| **Saldo**     | importe con signo. **Ningún campo de identidad propio**: el ámbito es el del efecto |
| **Económica** | importe · **participante contextual, legítimamente nulo**                           |
| **Deuda**     | importe con signo · deudor · acreedor                                               |

> **Una única columna común de importe no representa correctamente un efecto.**
> Una misma fila puede contener dimensiones con **cantidades y signos
> distintos**: un gasto personal produce un efecto con saldo −20,00 y económica
> +20,00. Con una sola columna eso solo se representa mediante una convención de
> signo por clase contable que el lector tiene que recordar, y las convenciones
> que hay que recordar son el modo de fallo contra el que existe este modelo.

**Invariantes:**

- **el importe determina la presencia** de cada dimensión;
- **al menos una dimensión debe existir**;
- **participante económico nulo es válido**: el Modo Personal no nomina
  participante, así que la presencia de la dimensión **no se infiere del
  participante**;
- la dimensión de deuda es **todos o ninguno** para importe, deudor y acreedor;
- **`debtor <> creditor`**, que el dominio ya exige;
- **no se prohíben globalmente los importes cero**;
- **se conservan los efectos económicos de cero** cuando el dominio los produce
  —una participación calculada en cero por indivisibilidad sigue siendo una
  participación—;
- **no se inventa deuda de cero** cuando el dominio la omite: una participación
  en cero no genera obligación que registrar.

**No se duplica `operation_id` en `effect`.** La ruta normalizada es
`effect → operation_version → operation`, y una redundancia que solo ahorra un
salto de join es una optimización sin evidencia. Podría reconsiderarse con
medición; hoy no la hay.

### 9. La proyección canónica de efectos vigentes

Se adopta una **vista simple `security_invoker`** en `core` como proyección
canónica de los efectos económicamente vigentes.

> **La regla de vigencia vive en esa proyección, y no se replica en ningún
> consumidor.** Balances, deudas, estadísticas, totales y las superficies de
> lectura de `api` se construyen sobre ella.

**Simple y no materializada.** Una vista materializada no se mantiene sola con
cada escritura: conservar la frescura que el producto necesita —ver el saldo
correcto justo después de registrar un gasto— obligaría a refrescarla de forma
explícita y coordinada en cada transacción autoritativa, añadiendo coste,
bloqueo y una segunda mecánica que la vista simple no necesita. No se descarta
por imposibilidad técnica.

**La proyección es un límite de privilegio.** E19 midió que en una cadena de dos
vistas **lo que decide es el eslabón más cercano a las tablas**: con la vista
interna `security_invoker`, una vista externa ejecutada como propietario **no**
reintrodujo el bypass; con la vista interna ejecutada como propietario, una
vista externa `security_invoker` **no la rescató**, y se filtraron filas de otro
ámbito **incluso sin sesión alguna**. Por tanto:

> **La proyección canónica se declara `security_invoker`. Omitirlo hace que todo
> el camino de lectura pierda la RLS y siga devolviendo cifras creíbles.**

**Se adopta una guarda estructural para vistas.** E19 midió que las dependencias
que registra el catálogo son **directas, no transitivas**, de modo que una vista
que pasa por la proyección y otra que la evita se distinguen. La regla:

> **La única relación que puede depender directamente de la tabla de efectos es
> la proyección canónica.** Cualquier otra vista que dependa de ella es una
> violación.

La comprobación se dirige a **vistas de lectura**, no a «todo objeto que dependa
de la tabla»: índices, restricciones y políticas quedan fuera por construcción.

**Para funciones la garantía es más débil, y se dice.** E19 midió que un cuerpo
`language sql` con `BEGIN ATOMIC` **sí deja dependencias analizables** en el
catálogo, mientras que los cuerpos textuales —SQL entre delimitadores y
PL/pgSQL— **no dejan ninguna**. Por tanto:

- las **funciones de lectura** económicas se escriben con cuerpo `BEGIN ATOMIC`,
  y quedan cubiertas por la misma guarda estructural;
- las **funciones autoritativas de escritura** seguirán siendo PL/pgSQL —
  necesitan control de flujo y `RAISE` (ADR-009 §9)— y quedan cubiertas por
  **revisión dirigida sobre las definiciones, tests de integración y una
  whitelist explícita**.

Una regla por subcadena sobre el texto de la función **no** es sustituto: el
nombre de la proyección canónica contiene el de la tabla base, de modo que una
comprobación ingenua marcaría precisamente a la función correcta.

### 10. RLS de `operation` y `operation_version`

#### Lectura del rol cliente

| Relación            | Predicado                                                                   |
| ------------------- | --------------------------------------------------------------------------- |
| `effect`            | **membresía del ámbito**, mediante el helper de ADR-007 §2                  |
| `operation_version` | visible si **existe al menos un efecto visible de esa versión**             |
| `operation`         | visible si **existe al menos un efecto visible de alguna de sus versiones** |

No hay recursión: la política de la operación consulta los efectos, la de los
efectos resuelve la membresía mediante un helper `SECURITY DEFINER` que rompe la
cadena —el motivo por el que ADR-007 §2 lo eligió—, y los efectos no referencian
la operación.

> **La visibilidad del historial se deriva de los efectos históricos, no solo de
> los vigentes.** La RLS de los efectos filtra por ámbito, no por vigencia, de
> modo que una versión superada sigue siendo visible para quien podía ver sus
> efectos. Es lo que ADR-011 pretende al decir que el historial es consultable
> sin estructuras adicionales.

**Estas políticas son necesarias aunque la proyección canónica ya parta de los
efectos.** Con RLS activada y sin política el resultado es denegación total; y
el rol cliente **posee `SELECT`** sobre esas relaciones, porque E19 midió que la
cadena `security_invoker` lo exige. Ese privilegio es ejercitable desde
cualquier superficie futura legítima, así que la garantía no puede depender de
que todas las consultas empiecen por la tabla correcta.

#### Escritura

**Solo el writer autoritativo escribe.** Los roles cliente quedan **sin grants
de escritura y sin políticas de escritura** sobre operaciones, versiones y
efectos (ADR-002 §7).

El writer conserva sus atributos de ADR-009 §5 —`NOLOGIN`, no propietario,
`NOBYPASSRLS`— y recibe **políticas específicas dirigidas a ese rol**. Es seguro
porque las políticas permisivas se combinan con `OR` **solo entre las aplicables
al rol actual**: una política dirigida al writer **no amplía** lo que puede el
rol cliente (ADR-011 §15, medido en E17).

La separación **por comando y por rol** no es una comodidad. Un predicado
derivado de la existencia de efectos es **insatisfacible** al insertar la
operación y la versión, porque en ese instante todavía no hay efectos, y **las
políticas RLS no son diferibles**: el recurso que ADR-011 §4 usa para el puntero
—clave foránea diferida— no tiene equivalente. Además, E16 midió que
**`auth.uid()` no es invocable por el writer**, de modo que una política única
para ambos roles serviría a uno y no al otro.

**La autorización funcional vive en dos sitios que no se sustituyen:**

1. **dentro de la frontera autoritativa**, antes de escribir — primera barrera;
2. **la RLS**, aplicable también al writer — segunda barrera.

**No se crea:** ninguna **tabla de visibilidad derivada** —ADR-007 §6 la rechazó
por cambiar superficie de escalada por una segunda fuente de verdad, y una
relación operación↔ámbito sería exactamente eso, porque su contenido es
derivable de los efectos— · ninguna política aplicable a **`PUBLIC`** · ninguna
política **`RESTRICTIVE`**.

> **El `WITH CHECK` definitivo del writer sobre los efectos no se fija aquí.**
> Corresponde a **E20**, antes de escribir migraciones. Lo que sí queda fijado es
> que el aislamiento por ámbito **no** puede ser ese predicado: ADR-002 §10
> permite deliberadamente que una operación produzca efectos sobre el ámbito de
> otro usuario, así que «el actor es miembro del ámbito del efecto» rechazaría
> escrituras legítimas.

### 11. Serialización de la deuda

> **Toda escritura autoritativa que pueda crear, modificar o consumir deuda
> vigente de un ámbito participa en el mismo protocolo de serialización sobre
> ese ámbito.** La pertenencia se decide por **qué efectos produce**, no por el
> nombre de la clase.

1. determinar los **ámbitos cuya deuda puede cambiar**, a partir de la intención
   validada, que los nombra;
2. **adquirir el lock** sobre sus filas estables;
3. si son varios, **en orden determinista por identificador**;
4. **leer la deuda vigente después** de adquirir los locks;
5. **validar**;
6. insertar operación, versión y efectos;
7. mover `current_version_id` cuando corresponda;
8. **commit**, que libera los locks.

Participan: crear un gasto que produce deuda · **corregir una operación de forma
que altere la deuda** · **eliminar deuda mediante una versión nueva** · liquidar
parcial o totalmente · liquidar mediante transferencia · cualquier clase futura
que altere deuda vigente. **No participa** una operación cuyos efectos no tocan
ninguna dimensión de deuda.

> **Una serialización parcial no serializa nada.** Si solo la liquidación toma el
> lock, una corrección concurrente que reduzca el gasto que originaba la deuda no
> espera a nadie, y el resultado es el mismo sobrepago que E15 midió sin ningún
> lock. El invariante no es «la liquidación se serializa»: es que **la
> comprobación y el consumo se serialicen**, y quien altera el consumible
> participa igual que quien lo consume.

Los pasos 2 y 4 **no se pueden invertir**: leer antes de bloquear reintroduce
exactamente la carrera.

**El advisory lock por par de deuda queda como posible escalada futura**, si
alguna medición muestra contención de ámbito. **No es el diseño de v1**: es más
fino, y exige canonicalizar la dirección del par y aceptar colisiones de hash.

## Alternativas consideradas

**A · Derivarlo todo, incluida la versión vigente**, calculándola como el mayor
`version_no` por operación. Más pura, y sin ninguna derivación materializada.
**Descartada** porque pone un agregado correlacionado por operación en la ruta
caliente de la pantalla principal, y porque convertiría cualquier `INSERT` de
versión en un cambio de contabilidad sin que nadie moviera el puntero, vaciando
de sentido la restricción de ADR-011 §14.

**B · Materializar saldos y deudas**, con una fila de deuda actual mantenida
transaccionalmente. Da una fila natural que bloquear y lecturas de coste
constante. **Descartada** por la segunda fuente de verdad clásica: una deuda
almacenada que se desincroniza de sus efectos produce cifras incorrectas en
silencio, cada corrección abre las cuatro preguntas de recálculo, delta,
reemplazo y drift, y desmaterializar después es caro. El único argumento serio a
su favor —«hace falta una fila que bloquear»— se responde sin ella (§11).

**C · Modelo híbrido**, con la deuda derivada y una copia materializada.
**Descartada**: exige declarar cuál de las dos es la autoridad, y sin esa frase
escrita no es un diseño sino una ambigüedad. Hereda el drift de B sin eliminar
el coste de A.

**D · Vista materializada como proyección canónica.** **Descartada** por §9: no
se mantiene sola con cada escritura, y coordinar el refresco añade coste,
bloqueo y una mecánica que la vista simple no necesita.

**E · Tabla de efectos vigentes mantenida por el writer.** **Descartada**:
duplica cada efecto y crea la segunda fuente de verdad justo en el punto donde
más caro sale.

**F · Ámbito en `operation` o en `operation_version`.** Simplificaría las
políticas y ahorraría un semi-join. **Descartada** por §2: una operación alcanza
varios ámbitos y no existe uno único para todas las clases, así que la columna
exigiría inventar una semántica normativa que ningún documento respalda.

**G · Relación explícita operación↔ámbito o versión↔ámbito**, para dar a la RLS
un predicado directo. **Descartada** por tres motivos que se acumulan: su
contenido es **derivable** de los efectos, luego es una derivación almacenada —
exactamente lo que ADR-007 §6 y su alternativa D rechazaron—; **no puede
crearse** antes que los efectos, que se insertan después de la operación y de la
versión, de modo que padece el mismo problema de orden que motivó la separación
de políticas; y lo único que aporta sobre una política por rol y comando es un
join más barato, que es rendimiento no medido.

**H · No aplicar RLS a `operation` y `operation_version`.** **Descartada** en sus
dos variantes. Con RLS activada y sin política, la denegación es total y la
proyección canónica devuelve cero filas para todo el mundo. Con RLS desactivada,
el rol cliente —que **posee `SELECT`** porque la cadena lo exige— alcanzaría la
tabla entera desde cualquier superficie legítima futura, exponiendo el importe
original, su moneda, la fecha efectiva y la atribución de **todas** las
operaciones del sistema. Que `core` no esté expuesto por la Data API protege
frente a PostgREST, no frente a una vista de `api` o una función con acceso
legítimo.

**I · Método de reparto y pagador en `operation_version`.** Es la forma que
proponía el análisis previo. **Descartada** por §5: son datos locales a un
ámbito en una fila sin ámbito, y la RLS no puede ocultar columnas, de modo que su
protección dependería de una propiedad contingente en vez de la estructura.

**J · Ocultar columnas mediante una vista de `api`, o mediante privilegios por
columna.** **Descartadas** como mecanismo de autorización: E19 midió que la
cadena `security_invoker` exige privilegio sobre las relaciones base, y los
privilegios por columna son por rol y no pueden expresar una condición por
ámbito. Trasladarían el problema a cada superficie futura en lugar de
resolverlo.

## Consecuencias

### A favor

- **Una sola fuente de verdad para todo lo contable.** Es imposible que un saldo
  almacenado contradiga sus efectos, porque no hay saldo almacenado.
- **Corregir no cuesta nada.** Insertar la versión nueva, sus efectos y mover el
  puntero. No hay recálculo, ni delta, ni reemplazo, ni drift, porque no hay
  copia que mantener.
- **El filtro de vigencia deja de poder olvidarse por descuido en una vista**, y
  la guarda es una consulta al catálogo, no una revisión visual.
- **La intención declarada del reparto gana integridad referencial** y un sitio
  donde el orden estable es un dato en vez de una convención.
- **Los datos locales a un ámbito quedan protegidos por su propia fila**, de modo
  que la garantía es estructural y no depende de qué clases existan mañana.
- **La reversibilidad es alta** para la parte que más presión recibirá: añadir una
  caché de saldos es aditivo y no toca el modelo.

### En contra

- **Cada lectura de saldo agrega**, y no está medido. Sin índices adecuados se
  notará con volumen.
- **Los efectos de versiones antiguas ocupan espacio para siempre.** Es el precio
  del historial, ya asumido por ADR-011.
- **Las políticas de lectura de `operation` y `operation_version` añaden un
  semi-join sobre los efectos** en la ruta caliente. Tampoco está medido.
- **Dos relaciones más** para el reparto contextual, frente a dos columnas en la
  versión.
- **La segunda barrera es más débil en la escritura que en la lectura**, y lo es
  por una decisión de producto: ADR-002 §10 permite efectos sobre el ámbito de
  otro, así que la RLS no puede expresar el aislamiento por ámbito al escribir.
- **Una columna de reglas económicas que en v1 no lee nadie**, y la tentación de
  creer que registrar el contrato implica poder reejecutarlo.
- **La guarda estructural no cubre las funciones de escritura**, que quedan con
  revisión dirigida, tests y whitelist.

### Riesgo que se mitiga estructuralmente

El modo de fallo dominante que ADR-011 §3 dejó señalado —sumar historia y
vigente y obtener una cifra inflada que no falla— deja de depender de que cada
autor de consulta recuerde un filtro. Pasa a depender de una vista que lo aplica
una vez y de una comprobación de catálogo que detecta a quien la evita.

## Compatibilidad con ADR anteriores

Este ADR **no contradice ninguno**. Precisa cuatro puntos que quedaron
delegados:

- **ADR-011 §2** delegó la forma física de los datos autoritativos de la versión:
  §3 y §5 la fijan, sacando el reparto de la versión.
- **ADR-011 §3** exigió una proyección canónica: §9 la fija.
- **ADR-011 §16** y **ADR-009 §7** dejaron abierto el mecanismo de lock de la
  deuda: §11 lo fija.
- **ADR-009 §6** delegó la forma concreta de las políticas del writer: §10 fija
  la separación por comando y por rol, y delega el `WITH CHECK` de los efectos a
  E20.

Además **precisa sin sustituir** la regla de herencia del tipo de cambio de
`data-model.md` §7 e invariante 27, que no contemplaban una corrección que
cambiara una entrada del tipo (§6).

## Fuera de alcance

**No se decide aquí, y no se prejuzga:** el `WITH CHECK` definitivo del writer
sobre los efectos, que corresponde a **E20** antes de las migraciones · la forma
definitiva de las vistas de lectura y qué columnas proyecta cada una · los
índices, que deben seguir a la medición y no precederla · una caché de saldos ·
los nombres físicos de tablas y columnas.

**Sigue abierto en otros lugares:** el **acceso residual** de quien sale de un
ámbito con saldo pendiente, que ADR-012 §12 deja sin representación física · el
mecanismo de **prueba del claim**, la **revocación** y la **fusión** de
participantes, delegados a F10 · el **proveedor, la fuente y la regla de
selección del tipo de cambio** · la **anulación o cancelación** como concepto
distinto de la corrección · la **idempotencia** de recurrencias, importaciones y
backend · **retención y purga** · **Modo Pareja**, **Open Banking** y
**recurrencias** como fases de producto posteriores.

**Requisito previo a la implementación, no parte de este ADR:** los vectores
compartidos de corrección que ADR-011 ya reclamaba —V1 = 60, V2 = 75, V1
histórica, solo V2 económicamente vigente— exigen extender
`tests/vectors/scenarios.json`, que hoy **no tiene noción de versión**. El
**replay de una corrección sin crear una tercera versión** y la **corrección
obsoleta dando conflicto** pertenecen a los tests de integración de la frontera
de escritura, no a los vectores compartidos.
