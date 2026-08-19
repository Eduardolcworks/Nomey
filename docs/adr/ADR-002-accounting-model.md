# ADR-002 — Modelo contable de Nomey

- **Estado:** Aceptado
- **Fecha:** 2026-08-18

## Contexto

Nomey se apoya en tres pilares: finanzas personales, gastos compartidos y
entrada de un movimiento en unos cinco segundos. El punto donde los tres se
tocan es el modelo contable, y es la decisión más cara de revertir del
proyecto: un modelo equivocado produce cifras plausibles y falsas que no lanzan
ningún error, y que solo se detectan cuando una persona reclama.

El problema de fondo está enunciado en `AGENTS.md` §2. Un gasto compartido no es
un hecho, son varios. Si alguien paga 120 por una cena a partes iguales entre
cuatro:

| Hecho                                   | Importe |
| --------------------------------------- | ------- |
| Movimiento de caja — salió de su ámbito | −120    |
| Gasto económico — lo que consumió       | −30     |
| Derecho — lo que los demás le deben     | +90     |

Confundirlos hace que quien paga las cenas parezca un manirroto y quien nunca
paga parezca un asceta. Ambas cifras son falsas y ninguna falla.

A esto se añade que Nomey maneja **tres ámbitos financieros** distintos —Modo
Personal, Grupos y Modo Pareja—, participantes que pueden no tener cuenta,
entrada sin conexión que se reintenta, y un cliente móvil que no es confiable.

**Ningún ADR aceptado gobierna esta materia.** ADR-001 trata licencias.

### Qué estaba decidido antes de este ADR

Invariantes de producto fijados en Fase 0 y Fase 1, que este ADR respeta y no
puede contradecir: la separación caja / gasto económico / deuda; que una
liquidación cancela una deuda y nunca es ingreso; representación exacta del
dinero con moneda explícita y escala según la moneda; reparto del resto
determinista; idempotencia de toda operación reintentable con garantía por
origen; participantes sin cuenta cuyo historial no se pierde al vincularlos; y
RLS como mecanismo principal de autorización a nivel de fila dentro de un
conjunto de capas.

## Decisión

Se adopta un modelo **centrado en la operación, con efectos explícitos,
versiones inmutables y frontera de escritura autoritativa en el servidor**. Sin
libro mayor de partida doble.

### 1. Operación y efecto

La distinción central del modelo:

| Concepto      | Qué representa                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Operación** | La intención del usuario. Unidad de identidad, idempotencia, versionado y relación entre todos los efectos que nacen de una misma acción |
| **Efecto**    | Un hecho concreto que cambia algo. Unidad de contabilidad, clasificación, estadísticas y visibilidad                                     |

Cada efecto tiene, como dimensiones conceptualmente separadas: ámbito afectado,
clase contable, importe, moneda, impacto sobre saldo, impacto
económico/estadístico, impacto sobre deuda y visibilidad.

**La clase contable de un efecto no determina qué dimensiones toca.** Puede
existir un `gasto` que alimente estadísticas sin cambiar ningún saldo, y una
`liquidación` que modifique una deuda sin tocar caja. En una operación simple
las dimensiones suelen coincidir; en una compuesta, no.

Sobre esto descansa el invariante de **representación única**:

> **Cada cambio de saldo de cada ámbito se representa exactamente una vez.** Una
> transferencia interna produce exactamente un efecto de salida en el ámbito
> origen y uno de entrada en el destino; una externa puede tener un único
> extremo interno. Ningún versionado, corrección, reintento, reparto,
> liquidación, importación ni conciliación puede duplicarlos.

### 2. Los tres ámbitos

**Modo Personal**, **Grupos** y **Modo Pareja** son ámbitos internos de Nomey,
conceptualmente distintos, cuyas estadísticas no se mezclan automáticamente.

**No son cuentas bancarias.** Una integración externa futura aporta procedencia
y conciliación; no cambia la naturaleza de los ámbitos. Un usuario tiene un
único ámbito financiero personal: Nomey no gestiona varios saldos internos
seleccionables.

### 3. Clases contables

`ingreso` · `gasto` · `transferencia` · `ajuste` · `liquidación`

- **Transferencia interna:** exactamente un efecto de salida en el ámbito
  origen y exactamente uno de entrada en el ámbito destino, ambos dentro de
  Nomey. Cuando ambos extremos son Modos Personales de usuarios distintos,
  **solo puede originarla el propietario del extremo de salida** (§10).
- **Transferencia externa:** puede tener un único extremo dentro de Nomey,
  cuando la contraparte no tiene ámbito representable en la operación —pagar a
  un participante sin usuario, o reflejar en tu propio Modo Personal un dinero
  recibido de alguien que no ha creado la transferencia interna correspondiente—.
  Afecta **solo** al ámbito de quien la registra. No requiere clase nueva.
- **Ajuste:** reconciliación manual del saldo declarado. La declaración inicial
  de dinero disponible es el primer ajuste; no existe un concepto separado de
  saldo inicial.

**Transferencia y liquidación son hechos distintos y no se fusionan.** Una
transferencia mueve saldo; una liquidación modifica una deuda. Una misma
operación puede contener ambas —«pagar deuda mediante transferencia»— pero eso
no implica que toda liquidación mueva caja.

### 4. Estadísticas: lista de admitidos

**Solo los efectos de clase `ingreso` y `gasto` alimentan las estadísticas de
ingresos y gastos. Todo lo demás queda fuera por defecto**, incluidas las clases
que se añadan en el futuro.

Se elige lista de admitidos y no de excluidos deliberadamente: una clase nueva
añadida dentro de un año debe producir «falta un dato», nunca «el dato miente».

### 5. Reparto de un gasto de grupo

Los participantes se seleccionan **por operación**, no por pertenencia al grupo.
Un pagador único, incluido siempre entre los participantes y con participación
mayor que cero.

Métodos: `equal`; `shares` con enteros positivos; y `exact_amounts`, cuya suma
debe coincidir exactamente con el total, sin corrección silenciosa.

**El gasto económico corresponde a todos los participantes**, con independencia
de quién pagó. En una cena de 120 entre cuatro, los cuatro tienen 30 de gasto
económico; el pagador tiene además el movimiento de caja y los derechos frente
a los demás. Sin esto, las estadísticas de quien no paga nunca reflejarían lo
que consumió.

**Se conservan intención y resultado.** El resultado solo no basta: un reparto
30/30/30/30 no distingue «a partes iguales entre cuatro» de «cuatro importes
fijos», y esa diferencia decide si una corrección posterior recalcula o no.

**Reparto del resto**, determinista: cuotas matemáticas, truncar a unidades
mínimas completas, repartir las restantes por mayor fracción descartada, empate
al pagador y, si persiste, orden estable guardado con la operación.

### 6. Correcciones

Los hechos son inmutables. Corregir crea una **versión nueva** que sustituye a
la anterior; la anterior nunca se muta. Qué cambió se obtiene diferenciando
versiones, sin un registro de cambios separado que pudiera derivar.

Elegibilidad de participantes en una corrección: los válidos **en la fecha
efectiva original** de la operación, tengan o no cuenta.

### 7. Frontera de confianza

La aplicación móvil es un cliente no confiable. Un conjunto de efectos bien
formado puede ser semánticamente falso, y la RLS acota a qué filas se llega, no
si lo que se afirma es cierto.

Por tanto: **el cliente envía la intención, no el resultado contable.** Una
función en el servidor valida autorización, coherencia e idempotencia, calcula
el reparto y genera los efectos atómicamente. **Los roles cliente no tienen
permisos de escritura sobre operaciones ni efectos.**

`domain/` conserva el mismo cálculo para la previsualización sin conexión. La
duplicación es consecuencia de dos requisitos ya decididos —cliente no confiable
y entrada offline—, no una elección de diseño, y se controla con vectores de
prueba compartidos.

### 8. Moneda

**Cada ámbito tiene una moneda base inmutable tras su primera operación.** Cada
efecto se registra en la moneda base de su ámbito, conservando importe y moneda
originales y el tipo de cambio congelado en el momento de registrar. La
conversión no se recalcula después.

Es una política común a los tres ámbitos y cubre gasto en otra moneda,
transferencia entre ámbitos de bases distintas y reparto final.

### 9. Modo Pareja

Ámbito privado entre exactamente dos usuarios, con **dinero común**: un único
saldo, sin deudas internas ni saldos individuales.

La procedencia de cada aportación se conserva por trazabilidad y **no confiere
propiedad, porcentaje ni derecho de recuperación**. Todo gasto declara su
**fuente de financiación** —saldo común, o personalmente por uno de los dos—,
concepto distinto de la procedencia o medio de pago.

La fuente de financiación determina qué saldos se mueven:

- **Saldo común:** el saldo del Modo Pareja baja, y se registra el gasto
  económico del ámbito.
- **Financiado personalmente por uno de los dos:** el saldo común **no cambia**,
  porque ese dinero nunca entró en él. Se registra el gasto económico del
  ámbito, su fuente, y el efecto de saldo en el Modo Personal de quien financió.

No se representa una entrada y una salida ficticias en el saldo común: sería
representar un movimiento que no ocurrió y contradiría el invariante de
representación única.

**Retiradas ordinarias.** Mientras el ámbito está **activo**, cualquiera de los
dos puede retirar del saldo común hacia su Modo Personal con **efecto inmediato**,
atribución, historial, notificación y posibilidad de corrección. No hay
confirmación previa: durante la vida normal del ámbito el dinero es común y
operativo, y exigir acuerdo en cada retirada cotidiana sería fricción sin
contrapartida.

**Ciclo de cierre:** cualquiera puede iniciarlo unilateralmente. Iniciarlo es
**una única transición lógica** que, en el mismo instante: registra quién lo
inició, notifica al otro, congela la actividad ordinaria, **bloquea las retiradas
unilaterales del saldo común** y abre el proceso de resolución.

Que el bloqueo sea simultáneo al cambio de estado es deliberado: evita la
carrera «veo que quiere cerrar, retiro todo antes».

Desde ese instante el saldo restante **solo puede salir** mediante el reparto
final bilateral o mediante las operaciones expresamente permitidas para resolver
el cierre. El reparto final **requiere confirmación bilateral**; un reparto
ejecutado es inmutable y se compensa con una transferencia bilateral entre Modos
Personales, sin reabrir el ámbito. Un Modo Pareja en `Cierre` **no cuenta como
activo**, de modo que nadie queda bloqueado por la falta de acuerdo del otro.

Entrar en `Cierre` **cambia las capacidades permitidas, no la titularidad
histórica** ni reescribe operación alguna. Las correcciones necesarias para
resolver el ámbito siguen disponibles según las reglas generales, pero **ninguna
puede usarse como vía indirecta para saltarse la protección**: si una corrección
altera el saldo común, se recalcula el disponible para reparto y cualquier
propuesta pendiente queda invalidada.

**Si uno nunca confirma el reparto**, el ámbito permanece en `Cierre` y el saldo
restante queda congelado: ninguno puede repartirlo unilateralmente. **No hay**
reparto automático a partes iguales, ni proporcional a lo aportado, ni
apropiación por transcurso de plazo. Ambos conservan el acceso necesario para
resolver el cierre y pueden acordarlo más adelante. Como el ámbito no cuenta
como activo, la situación no impide a ninguno crear un Modo Pareja nuevo.

### 10. Permisos y efectos sobre otros usuarios

> **Un usuario solo puede producir efectos sobre otro cuando la operación y el
> ámbito correspondiente le conceden ese derecho. Todo efecto es inmediato,
> atribuible, notificable y corregible.**

Cuando un usuario autorizado registra una operación válida, **sus efectos se
aplican de inmediato**, incluidos los que alcanzan el Modo Personal de otro
usuario cuando forman parte legítima de esa operación. No hay confirmación
previa, ni efectos pendientes, ni estados de autorización.

**Efecto inmediato no es acceso arbitrario.** Nadie puede escribir «Modo
Personal de B −500 €» sin contexto: el efecto sobre otro usuario debe nacer de
una operación válida del dominio —gasto de grupo, liquidación, transferencia
entre usuarios, gasto del Modo Pareja, reparto, corrección permitida— y los
permisos siguen dependiendo del tipo de operación y de la relación entre los
usuarios.

**El resultado financiero no depende de quién registre.** Que B registre «yo
pagué 120 €» o que A registre «B pagó 120 €» produce exactamente los mismos
efectos. Lo único que difiere es la autoría y a quién se notifica. Esto elimina
una fuente entera de asimetría del modelo.

### Dónde está la protección

No en pedir confirmación previa, sino en cinco capas que operan a la vez:

| Capa                    | Qué aporta                                           |
| ----------------------- | ---------------------------------------------------- |
| **Permisos del ámbito** | Qué operaciones puedes registrar y sobre quién       |
| **Atribución**          | Quién hizo qué, siempre registrado                   |
| **Historial**           | Versionado completo, sin sobrescritura silenciosa    |
| **Notificación**        | El afectado se entera en el momento                  |
| **Corrección**          | El mecanismo ordinario de versionado repara el error |

Toda operación que produzca efectos financieros relevantes sobre otro usuario
**queda atribuida y genera notificación**. El dominio conserva quién hizo qué,
sobre qué ámbito, cuándo, qué importes cambiaron y qué correcciones posteriores
hubo.

### Quién puede originar una transferencia directa entre usuarios

La transferencia directa es un primitivo especialmente potente: modifica **dos**
Modos Personales sin necesitar un Grupo ni un Modo Pareja que le dé contexto.
Por eso se restringe quién puede crearla.

> **Solo puedes iniciar una transferencia desde tu propio Modo Personal hacia el
> de otro usuario.** El destinatario no puede originar una salida en el Modo
> Personal del remitente.

Quien envía puede declarar que ha enviado **valor propio**. Quien recibe no
puede declarar unilateralmente que otro le ha enviado valor y generar con ello
una salida en el Modo Personal de ese tercero. Sin esta restricción existiría
una primitiva directa de apropiación: bastaría registrar «B me transfirió 500 €»
para vaciar el ámbito de B.

**Esto no impide reflejar dinero recibido.** Quien crea haber recibido algo
puede registrar un movimiento sobre **su propio** Modo Personal —una
transferencia externa— que no toca el ámbito del otro y no finge una
transferencia interna que el otro no ha creado.

**No se generaliza esta restricción.** En un ámbito compartido, el efecto sobre
otro nace de una operación válida del grupo o del Modo Pareja, y sigue siendo
inmediato: si A tiene derecho a registrar «cena de 120 €, pagó B», los efectos
sobre B se aplican con atribución, historial, notificación y corrección. La
diferencia es que la transferencia directa **carece de ese contexto compartido**.

Aplicado a pagar una deuda: puede iniciarlo **el deudor**, que es el origen del
saldo. El acreedor no puede provocar una salida en el Modo Personal del deudor
por esta vía; conserva «marcar deuda como saldada», que modifica la deuda sin
mover ningún saldo.

### La única familia de operaciones bilaterales

El reparto final del saldo común del Modo Pareja y las compensaciones que
modifiquen posteriormente ese acuerdo constituyen **la única familia de
operaciones que exige bilateralidad**. Son dos situaciones con **motivos
distintos**, y conviene no confundirlos:

**A · Crear la asignación — el reparto final.** El acuerdo asigna individualmente
un saldo común que hasta ese momento no está atribuido a nadie en proporción
determinada. No hay hecho previo que afirmar: los importes nacen del acuerdo.

**B · Modificar esa asignación — la corrección de un reparto ya ejecutado.**
**No hereda el motivo de A.** Para entonces el saldo común ya se distribuyó y el
dinero está en los Modos Personales: ha dejado de ser valor común sin titularidad
determinada. Es bilateral porque **modifica un acuerdo que se tomó entre dos**, y
deja constancia de que ambos comparten la nueva distribución.

El criterio completo:

> **La bilateralidad se exige cuando el propio acuerdo crea la asignación
> individual de valor común todavía no atribuido, y también cuando se modifica o
> compensa posteriormente una asignación creada mediante un acuerdo bilateral
> previo.**

**Todo lo demás es inmediato**, por alguna de estas tres razones:

- **Se dispone de valor propio** — una transferencia entre usuarios, que además
  solo puede originar el propietario del extremo de salida.
- **Se afirma un hecho sobre una obligación ya determinada** — una liquidación.
- **Se opera sobre un ámbito compartido cuyas reglas conceden ese derecho** — un
  gasto de grupo, o la **retirada ordinaria del saldo común mientras el Modo
  Pareja está activo**, que es precisamente lo que significa dinero común
  operativo.

Nótese el papel del estado del ámbito en el tercer caso: una retirada ordinaria
también saca valor común hacia un Modo Personal, y aun así es inmediata porque la
relación compartida continúa y sigue habiendo corrección. Es al entrar en
`Cierre`, cuando esa relación termina, cuando la disposición unilateral del
saldo común deja de estar permitida.

La regla de origen de las transferencias directas no degrada esta bilateralidad:
el acuerdo de ambos es una exigencia mayor, no menor.

### 11. Monetización

**Fuera de este ADR.** El dominio financiero conoce ámbitos, operaciones,
efectos y cierres; no conoce planes comerciales. Una capa independiente de
capacidades **invoca** operaciones del dominio; el dominio **nunca consulta**
capacidades.

Único principio que se preserva: **un cambio de plan o entitlement nunca
reescribe, elimina ni modifica retrospectivamente hechos contables.** El estado
`Cierre` pertenece al ciclo de vida del Modo Pareja y no está ligado a ningún
plan.

## Alternativas consideradas

### A. Transacción única con tipos y repartos

Una fila por operación con un discriminador, más filas hijas de reparto.

Es la más rápida de construir y la más fácil de consultar, y en un producto sin
la separación caja/gasto/deuda sería la elección correcta. **Descartada** porque
deja esa separación como convención; porque el discriminador convierte la fila
en una unión de formas distintas con columnas válidas solo para algunos valores;
y porque la corrección —frecuente en este producto— degrada la auditabilidad
desde el primer mes.

### B. Hechos separados y relacionados

Una entidad por hecho, unidas por referencias.

**Descartada** porque paga su precio en el caso más común: registrar un gasto
personal cuesta varios hechos, la relación entre ellos hay que imponerla, y la
idempotencia de una operación multifila es notablemente más difícil. Obtiene el
coste de un modelo de asientos sin su garantía estructural.

### C. Libro mayor de partida doble

Cabecera de asiento y líneas con signo sobre cuentas reales y virtuales, donde
toda operación suma cero.

Es la alternativa seria, y se sostuvo durante varias rondas de análisis. Sus
ventajas son reales: la reconciliación deja de ser convención y pasa a ser
propiedad de los datos, y «una liquidación no es un ingreso» se vuelve
estructuralmente imposible de violar en lugar de ser una regla que alguien debe
recordar.

**Descartada por desproporción**, con estas razones:

- Los tres hechos ya son derivables de la operación y sus efectos. La
  reconciliación no es peor: es la misma propiedad expresada un nivel más
  arriba.
- Aproximadamente el doble de filas por operación, conservando participaciones
  **y** líneas.
- Carga conceptual de partida doble permanente para un equipo pequeño, y
  superficie adicional de RLS sobre las líneas.
- PostgreSQL no admite `CHECK` que referencie otras filas, así que «las líneas
  suman cero» exige un trigger o una función que sea el único camino de
  escritura. Es un coste estructural, no un detalle.
  <https://www.postgresql.org/docs/17/ddl-constraints.html>

**Un argumento que se usó y se retiró por incorrecto:** se sostuvo que el libro
mayor obligaría a generar asientos retroactivos al reclamar un participante sin
cuenta. Es falso —las cuentas virtuales pueden anclarse al participante y no al
usuario— y la decisión no se apoya en él.

**Consecuencia asumida:** «una liquidación no es un ingreso» y «caja no es
gasto» pasan de imposibles a convenciones sostenidas por derivaciones nombradas
y por tests. Se acepta porque el coste de la alternativa es una capa entera, y
porque **la elección es reversible en un solo sentido**: las líneas contables
son una derivación determinista de las operaciones, de modo que un libro mayor
puede construirse encima más adelante sin migrar el modelo de intención.
Empezar por el libro mayor y simplificarlo después, no.

### D. Híbrido con líneas balanceadas almacenadas

Operación como modelo de escritura, más líneas balanceadas generadas y
almacenadas.

**Descartada** por la misma desproporción que C: añade la capa de líneas sin
aportar ninguna derivación que el modelo de efectos no dé ya.

### E. Descomponer el pago del pagador en dos efectos de saldo

Se consideró representar el pago de 120 del ejemplo como −30 de clase `gasto`
más −90 de clase `transferencia`.

**Descartada:** representa un único cambio de caja mediante dos efectos de
saldo, lo que contradice el invariante de representación única. La
representación adoptada separa las **dimensiones** del efecto en lugar de partir
el importe.

## Consecuencias

### A favor

- Los tres hechos quedan distinguidos por construcción, y la separación entre
  cambio de saldo e impacto económico evita duplicar caja en operaciones
  compuestas.
- El modelo cubre los tres ámbitos con el mismo vocabulario, sin reglas de
  moneda ni de corrección distintas por ámbito.
- La reclamación retroactiva de un participante es un cambio de visibilidad, no
  una migración de datos.
- Las liquidaciones parciales no necesitan máquina de estados: la deuda es un
  saldo continuo.
- La idempotencia vive en la unidad natural, la operación.
- **El resultado financiero no depende de quién registre la operación.** Elimina
  una asimetría entera del modelo y simplifica tanto la implementación como los
  tests.
- Registro inmediato en todos los flujos ordinarios: cero fricción en la ruta
  crítica de los cinco segundos.
- Monetización y contabilidad quedan desacopladas en una sola dirección.

### En contra

- El cálculo del reparto existe dos veces: servidor autoritativo y `domain/`
  para la previsualización sin conexión. Se mitiga con vectores de prueba
  compartidos; no se elimina.
- Una función con privilegios elevados como frontera de escritura, que debe
  fijar `search_path` y revisarse como frontera de privilegio.
- Corregir es versionar, no editar: más trabajo de interfaz.
- Un usuario autorizado puede alterar el Modo Personal de otro sin que este lo
  confirme. Es la contrapartida deliberada de la política de efecto inmediato,
  y descansa por completo en atribución, notificación y corrección.
- El reparto final del Modo Pareja queda como el **único** flujo bilateral, lo
  que lo convierte en un caso singular que hay que sostener aparte.
- Historial y notificación dejan de ser comodidades y pasan a ser **parte de la
  garantía**: si fallan, no queda ninguna protección efectiva.
- Tres de las cinco clases quedan fuera de las estadísticas, lo que exige
  disciplina sostenida en las derivaciones.

### Riesgos que el modelo no cierra, y no debe pretender cerrar

Nomey es una herramienta colaborativa de registro financiero entre personas que
se conocen, no un notario. Un usuario autorizado puede registrar información
incorrecta, atribuir mal un pagador, declarar una liquidación que no ocurrió o
aplicar una corrección equivocada — y esos efectos alcanzarán el Modo Personal
de otro de inmediato.

**Se consideró exigir confirmación previa de todo efecto que alcanzara el Modo
Personal de otro usuario, y se descartó.** No elimina el problema —un usuario
autorizado sigue pudiendo registrar datos falsos dentro del ámbito compartido—
y a cambio introduce fricción en todas las operaciones, efectos pendientes,
estados de autorización y una máquina de estados adicional.

**Decisión de producto:** Nomey prioriza **registro inmediato, historial,
atribución, notificación y corrección** frente a la confirmación preventiva de
cada movimiento.

Es un riesgo social conocido y aceptado. Queda escrito para que nadie intente
después cerrarlo con complejidad estructural.

### Pendiente en otros ADR

Representación exacta del importe · mecanismo de comprobación de membresía ·
esquema expuesto y política de grants · mecanismos de idempotencia para
recurrencias y backend · origen y ajuste del tipo de cambio · conciliación entre
un movimiento importado y la pata personal de una operación compuesta.
