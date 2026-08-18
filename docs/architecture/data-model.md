# Modelo de datos de Nomey

> **Documento de mantenimiento obligatorio.** Un cambio de código que lo
> contradiga es un PR incompleto.
>
> Recoge el modelo **en términos de dominio**. Las tablas, columnas y tipos
> concretos no están decididos: pertenecen a las migraciones y a los ADR que
> las gobiernen. Si necesitas un nombre de tabla para avanzar, falta un ADR.

Decisión de referencia: [ADR-002](../adr/ADR-002-accounting-model.md).
Vocabulario: [glosario](../product/glossary.md).

---

## 1. Operación y efecto

Es la distinción de la que depende todo lo demás.

| Concepto      | Es la unidad de…                                           |
| ------------- | ---------------------------------------------------------- |
| **Operación** | intención del usuario, identidad, idempotencia, versionado |
| **Efecto**    | contabilidad, clasificación, estadísticas y visibilidad    |

Una operación agrupa todos los efectos nacidos de una misma acción del usuario.

Cada efecto tiene estas dimensiones **conceptualmente separadas**:

- ámbito afectado
- clase contable
- importe y moneda
- impacto sobre **saldo**
- impacto **económico** (estadísticas)
- impacto sobre **deuda**
- visibilidad

**La clase no determina qué dimensiones toca el efecto.** Existe `gasto` que no
mueve saldo, y `liquidación` que no toca caja. En una operación simple las
dimensiones coinciden; en una compuesta, no.

Los efectos de una operación válida **se aplican de inmediato**, sin estados
intermedios (§8).

---

## 2. Ámbitos financieros

Tres, conceptualmente distintos. **No son cuentas bancarias.**

| Ámbito            | Saldo                 | Deudas internas | Participantes            |
| ----------------- | --------------------- | --------------- | ------------------------ |
| **Modo Personal** | uno por usuario       | —               | solo su dueño            |
| **Grupo**         | no tiene saldo propio | sí              | con o sin cuenta         |
| **Modo Pareja**   | uno común             | **no**          | exactamente dos usuarios |

Sus estadísticas no se mezclan automáticamente. Transferir entre ellos sí es
posible y explícito.

Cada ámbito tiene una **moneda base inmutable tras su primera operación**.

---

## 3. Clases contables

| Clase           | Saldo | Estadísticas | Deuda |
| --------------- | :---: | :----------: | :---: |
| `ingreso`       |   ±   |    **sí**    |   —   |
| `gasto`         |   ±   |    **sí**    |   ±   |
| `transferencia` |   ±   |      no      |   —   |
| `ajuste`        |   ±   |      no      |   —   |
| `liquidación`   |   —   |      no      |   ±   |

**Solo `ingreso` y `gasto` alimentan estadísticas. Las otras tres quedan fuera
por defecto, igual que cualquier clase futura.** Lista de admitidos, no de
excluidos: si mañana se añade una clase y alguien olvida clasificarla, el
resultado debe ser «falta un dato», nunca «el dato miente».

### Transferencia interna y externa

- **Interna:** exactamente una salida en el ámbito origen y una entrada en el
  destino, ambos dentro de Nomey. Entre Modos Personales de usuarios distintos,
  **solo la origina el propietario del extremo de salida** (§8).
- **Externa:** un único extremo dentro de Nomey, cuando la contraparte no tiene
  ámbito representable en la operación —pagar a un participante sin usuario, o
  reflejar en tu propio Modo Personal un dinero recibido de quien no ha creado
  la transferencia interna—. **Afecta solo al ámbito de quien la registra.**

### Transferencia ≠ liquidación

Una transferencia mueve saldo. Una liquidación modifica una deuda. Son hechos
distintos y **no se fusionan**, aunque una misma operación pueda contener
ambos.

---

## 4. Escenarios resueltos

Todos verificados contra los invariantes. **Son la referencia directa para los
tests de dominio.**

Todos los efectos que aparecen se aplican de inmediato. Cuando una operación
afecta al Modo Personal de otro usuario, este recibe **notificación**, no una
petición de confirmación.

### 4.1 Gasto personal simple — 20 €

```
Modo Personal → saldo −20 · económico +20 gasto
```

`Disponible actual` −20 · estadísticas de gasto +20.

### 4.2 · Escenario A — gasto de Grupo registrado por el propio pagador

Cena de 120 € entre cuatro, a partes iguales. Paga A y **registra A**.

```
Grupo           → económico +30 gasto a A, B, C y D    ← todos consumieron
Grupo           → B, C y D deben 30 € a A
Grupo           → pagador declarado: A
Modo Personal A → saldo −120
```

|             | `Disponible actual` | Derechos / deudas | `Disponible tras saldar` |
| ----------- | ------------------- | ----------------- | ------------------------ |
| **A**       | −120                | +90               | **−30**                  |
| **B, C, D** | sin cambios         | −30 cada uno      | **−30** cada uno         |

Los cuatro varían su `Disponible tras saldar` exactamente en su gasto económico.
**El gasto económico es de todos los participantes, no solo del pagador.**

> No se descompone el pago en −30 `gasto` y −90 `transferencia`: sería
> representar un único cambio de caja con dos efectos de saldo.

### 4.3 · Escenario B — el mismo gasto registrado por otro miembro

La misma cena, pero la registra B indicando que pagó A.

```
Grupo           → económico +30 gasto a A, B, C y D
Grupo           → B, C y D deben 30 € a A
Grupo           → pagador declarado: A
Modo Personal A → saldo −120
```

**Los efectos financieros son idénticos a 4.2.** La única diferencia es la
autoría —queda registrado que la operación la creó B— y que **A recibe una
notificación** indicándole que se ha reflejado un movimiento de −120 € en su
Modo Personal.

A no confirma nada. Si el dato era incorrecto, se corrige por versionado (§7).

### 4.4 Perspectiva de quien no paga

Marta pagó, A participa con 30 €.

```
Grupo → económico +30 gasto a A     ← gasto SIN ningún cambio de saldo
Grupo → A debe 30 € a Marta
```

`Disponible actual` de A: sin cambios. `Disponible tras saldar`: −30.

**Este escenario es la prueba de que separar saldo y economía es necesario**, no
cómodo: hay un gasto económico real que no mueve ninguna caja.

### 4.5 · Escenario E — marcar una deuda como saldada

```
Grupo → deuda −30 · liquidación
```

**Solo deuda. Ningún efecto de saldo, en ningún Modo Personal.**

El `Disponible tras saldar` de ambas partes queda desfasado hasta que cada uno
registre su propio movimiento de caja. **Es correcto**: Nomey es un registro
manual, y un movimiento real todavía sin anotar es su estado normal — la misma
razón por la que existe el `ajuste`.

### 4.6 · Escenario F — pagar una deuda mediante transferencia

A debe 30 € a B y registra «pagar deuda».

```
Modo Personal A → saldo −30 · transferencia
Modo Personal B → saldo +30 · transferencia
Grupo           → deuda −30 · liquidación
```

Los tres efectos se aplican **de inmediato y atómicamente**. B recibe
notificación.

Estadísticas: 0 — el gasto económico ya se contó al registrar la cena.

**Solo puede iniciarlo A**, que es el origen del saldo. B no puede registrar «A
me ha pagado 30 €» y provocar con ello una salida en el Modo Personal de A; B
conserva la vía de 4.5, que modifica la deuda sin mover saldo.

Contraste con 4.5: aquí se mueve saldo **y** se modifica la deuda; allí solo la
deuda. Siguen siendo hechos distintos.

### 4.7 Liquidar con un participante sin usuario

A paga 30 € a Marta, que no tiene cuenta en Nomey.

```
Modo Personal A → saldo −30 · transferencia EXTERNA
Grupo           → deuda −30 · liquidación
```

No hay segundo Modo Personal: Marta no tiene usuario. Un único extremo interno.

### 4.8 · Escenario D — transferencia entre usuarios

A registra una transferencia de 100 € a B.

```
Modo Personal A → saldo −100 · transferencia
Modo Personal B → saldo +100 · transferencia
```

Efectos inmediatos en ambos Modos Personales. B recibe notificación. Sin deuda y
sin estadísticas.

**Solo A puede crear esta operación**, porque su Modo Personal es el extremo de
salida. B **no** puede registrar «A me transfirió 100 €» para provocar una salida
en el ámbito de A: sería una primitiva directa de apropiación.

Si B cree haber recibido dinero que A no ha registrado, puede reflejarlo en su
propio ámbito como **transferencia externa** (§3) — afecta solo a B y no finge
una transferencia interna que A no ha creado.

La operación conserva autor, origen, destino, importe, moneda, fecha e
historial.

> Nomey registra un movimiento financiero **dentro de su propio modelo**. No es
> ejecución bancaria.
>
> Consecuencia consciente: un regalo registrado así no aparece como gasto de A
> ni como ingreso de B. Quien quiera reflejar el hecho económico lo registra
> aparte en su ámbito.

### 4.9 Gasto de pareja con saldo común — 100 €

```
Modo Pareja → saldo −100 · económico +100 gasto
Modo Pareja → fuente de financiación: saldo común
```

Ningún Modo Personal cambia.

### 4.10 · Escenario C — gasto de pareja financiado personalmente

B registra «Supermercado 80 €, financiado personalmente por A».

```
Modo Pareja     → económico +80 gasto
Modo Pareja     → fuente de financiación: A
Modo Pareja     → saldo común: SIN CAMBIOS
Modo Personal A → saldo −80
```

Efecto inmediato aunque lo registre B. A recibe notificación.

Estadísticas de pareja: 80 de gasto. Estadísticas personales de A: **0**. No
nace ninguna deuda de B hacia A. Dinero real que sale: 80, una sola vez.

> **El saldo común no se toca.** Ese dinero nunca entró en él, así que no se
> representa una entrada de +80 seguida de una salida de −80: sería inventar un
> movimiento que no ocurrió y contradiría el invariante 4.

### 4.11 Ajuste y declaración inicial

```
Modo Personal → saldo ±X · ajuste
```

La declaración inicial de dinero disponible es **el primer ajuste**. No existe
un concepto separado de saldo inicial. Fuera de estadísticas: encontrar 50 € más
de los esperados no es haberlos ganado.

### 4.12 Retirada ordinaria del saldo común — ámbito activo

Saldo común 800 €. A retira 100 € hacia su Modo Personal.

```
Modo Pareja     → saldo −100 · transferencia
Modo Personal A → saldo +100 · transferencia
```

Saldo común restante: **700 €**. Efecto inmediato, sin confirmación de B, que
recibe notificación.

Mientras el ámbito está **activo**, el dinero es común y operativo: cualquiera
de los dos puede retirar. La protección es atribución, historial, notificación y
corrección — no un acuerdo previo en cada retirada cotidiana.

**En cuanto el ámbito entra en `Cierre`, esta operación deja de estar
disponible** (§4.13).

### 4.13 Reparto final del Modo Pareja — bilateral

```
Modo Pareja     → saldo −500 · transferencia    ┐ una operación,
Modo Personal A → saldo +500 · transferencia    │ dos transferencias
Modo Pareja     → saldo −300 · transferencia    │ internas
Modo Personal B → saldo +300 · transferencia    ┘
```

**El único flujo que requiere acuerdo bilateral** (§8).

Al iniciarse el `Cierre` —acto unilateral— se bloquean en el mismo instante las
retiradas unilaterales del saldo común. Desde entonces los 800 € permanecen
congelados y solo pueden salir por este reparto o por operaciones expresamente
permitidas para resolver el cierre. Si nadie confirma, el saldo sigue congelado
indefinidamente y el ámbito, al no contar como activo, no impide crear otro Modo
Pareja.

### 4.14 Corrección de un reparto ya ejecutado

El reparto original **permanece inmutable** y el Modo Pareja no se reabre:

```
Modo Personal A → saldo −100 · transferencia   ┐ operación bilateral,
Modo Personal B → saldo +100 · transferencia   ┘ vinculada al reparto original
```

Conserva la bilateralidad porque modifica una asignación creada bilateralmente.

---

## 5. Reparto de un gasto de grupo

Los participantes se eligen **por operación**, no por pertenencia al grupo.

- **Pagador único**, siempre entre los participantes, con participación > 0.
- Métodos: `equal` · `shares` (enteros positivos) · `exact_amounts` (suma
  exacta, sin corrección silenciosa).
- **Se conservan intención y resultado.** Un 30/30/30/30 no distingue «a partes
  iguales entre cuatro» de «cuatro importes fijos», y esa diferencia decide si
  una corrección posterior recalcula.

**Reparto del resto**, determinista y reproducible en cualquier dispositivo:

1. cuotas matemáticas
2. truncar a unidades mínimas completas
3. repartir las restantes por mayor fracción descartada
4. empate → prioridad al pagador
5. si persiste → orden estable guardado con la operación

10 € entre tres: **3,34 · 3,33 · 3,33**, con 3,34 para el pagador.

---

## 6. Participantes y ciclo de vida

Cinco conceptos que **no deben colapsarse**:

| Concepto                   | Qué es                                               |
| -------------------------- | ---------------------------------------------------- |
| **Participante del grupo** | Puede figurar en repartos. Existe con o sin usuario  |
| **Usuario vinculado**      | La cuenta que reclamó ese participante, si la hay    |
| **Membresía activa**       | Relación vigente: ver y crear actividad              |
| **Participante histórico** | Figura en operaciones pasadas. Permanece siempre     |
| **Acceso residual**        | Salió con saldo ≠ 0: lectura acotada y liquidaciones |

**Reclamación retroactiva:** al vincular un participante con un usuario, todo su
historial se incorpora a sus finanzas personales **en las fechas originales**.
No hay migración de datos: los efectos ya apuntaban al participante.

---

## 7. Correcciones

Los hechos son inmutables. Corregir crea una **versión nueva**; la anterior
nunca se muta ni se borra en silencio. Qué cambió se obtiene diferenciando
versiones.

Los saldos y las estadísticas se derivan de la **versión vigente** de cada
operación, de modo que corregir deja de aplicar los efectos de la versión
anterior y aplica los de la nueva, sin operaciones de reversión separadas.

- Elegibilidad de participantes: los válidos **en la fecha efectiva original**.
- Quien corrige: cualquier integrante, sobre operaciones posteriores a su
  incorporación o anteriores en las que ya figuraba como participante.
- Un **reparto final ejecutado** es inmutable: se compensa, no se edita, y la
  compensación conserva la bilateralidad.
- Toda corrección queda atribuida y notificada a los afectados.

---

## 8. Permisos y efectos sobre otros usuarios

> **Un usuario solo puede producir efectos sobre otro cuando la operación y el
> ámbito correspondiente le conceden ese derecho. Todo efecto es inmediato,
> atribuible, notificable y corregible.**

**No hay confirmaciones, efectos pendientes ni estados de autorización.** Una
operación válida registrada por quien tiene derecho aplica todos sus efectos al
instante, incluidos los que alcanzan el Modo Personal de otro usuario.

**Efecto inmediato no es acceso arbitrario.** El efecto sobre otro debe nacer de
una operación válida del dominio: gasto de grupo, liquidación, transferencia
entre usuarios, gasto del Modo Pareja, reparto o corrección permitida. Los
permisos siguen dependiendo del tipo de operación y de la relación entre los
usuarios.

**El resultado financiero no depende de quién registre.** «Yo pagué 120 €»
registrado por B y «B pagó 120 €» registrado por A producen los mismos efectos.
Solo cambian la autoría y a quién se notifica.

| Acción                              | Efectos                                 | Autorización                              |
| ----------------------------------- | --------------------------------------- | ----------------------------------------- |
| Gasto de grupo                      | económicos + deudas + saldo del pagador | inmediata                                 |
| Marcar deuda saldada                | solo deuda                              | inmediata                                 |
| Transferencia entre usuarios        | saldo en ambos Modos Personales         | inmediata · **solo la origina el emisor** |
| Pagar deuda mediante transferencia  | saldo en ambos + deuda                  | inmediata · **solo la origina el deudor** |
| Gasto de pareja financiado por otro | económico del ámbito + saldo personal   | inmediata                                 |
| Retirada del saldo común (activo)   | saldo común → Modo Personal             | inmediata                                 |
| Retirada del saldo común (`Cierre`) | —                                       | **bloqueada**                             |
| **Reparto final del Modo Pareja**   | saldo común → Modos Personales          | **bilateral**                             |
| **Corrección de un reparto final**  | saldo entre Modos Personales            | **bilateral**                             |

### Dónde está la protección

No en la confirmación previa, sino en cinco capas simultáneas: **permisos del
ámbito · atribución · historial · notificación · corrección**.

Toda operación con efectos financieros relevantes sobre otro usuario queda
atribuida y **genera notificación**. El dominio conserva quién hizo qué, sobre
qué ámbito, cuándo, qué importes cambiaron y qué correcciones hubo después.

### Quién puede originar una transferencia directa

La transferencia directa modifica **dos** Modos Personales sin que ningún ámbito
compartido le dé contexto. Por eso se restringe su origen:

> **Solo puedes iniciar una transferencia desde tu propio Modo Personal hacia el
> de otro usuario.** El destinatario no puede originar una salida en el Modo
> Personal del remitente.

Quien envía declara que ha enviado **valor propio**. Quien recibe no puede
declarar que otro le envió valor y generar así una salida en el ámbito de ese
tercero — sería una primitiva directa de apropiación.

**No se generaliza.** En un ámbito compartido el efecto sobre otro nace de una
operación válida del grupo o del Modo Pareja y sigue siendo inmediato. La
diferencia es que la transferencia directa carece de ese contexto.

### El saldo común y el estado del ámbito

Mientras el Modo Pareja está **activo**, cualquiera de los dos puede retirar del
saldo común con efecto inmediato: es dinero común operativo, y la protección son
atribución, historial, notificación y corrección.

**Iniciar el `Cierre` es una única transición lógica** que registra al autor,
notifica, congela la actividad ordinaria y **bloquea las retiradas unilaterales**
en el mismo instante. Es deliberado: evita la carrera «veo que quiere cerrar,
retiro todo antes».

Entrar en `Cierre` cambia **las capacidades permitidas**, no la titularidad
histórica ni las operaciones ya registradas. Las correcciones siguen
disponibles, pero ninguna puede usarse como vía indirecta para saltarse la
protección: si una corrección altera el saldo común, se recalcula el disponible
y cualquier propuesta de reparto pendiente queda invalidada.

### La única familia de operaciones bilaterales

> **La bilateralidad se exige cuando el propio acuerdo crea la asignación
> individual de valor común todavía no atribuido, y también cuando se modifica o
> compensa posteriormente una asignación creada mediante un acuerdo bilateral
> previo.**

Dos situaciones, **con motivos distintos**:

|       | Operación                             | Por qué es bilateral                                                                                                                 |
| ----- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **A** | Reparto final del Modo Pareja         | El acuerdo **crea** la asignación individual de un saldo común no atribuido. Los importes nacen del acuerdo                          |
| **B** | Corrección de un reparto ya ejecutado | **Modifica un acuerdo bilateral previo.** Para entonces el dinero ya está en los Modos Personales y **ha dejado de ser saldo común** |

B **no hereda el motivo de A**: cuando se corrige, ya no se está repartiendo
valor común.

**Todo lo demás es inmediato** porque quien actúa dispone de valor propio —una
transferencia—, afirma un hecho sobre una obligación ya determinada —una
liquidación—, u opera sobre un ámbito compartido cuyas reglas le conceden ese
derecho, incluida la **retirada ordinaria mientras el Modo Pareja está activo**.

Esa última merece atención: también saca valor común hacia un Modo Personal, y
aun así es inmediata, porque la relación compartida continúa y sigue habiendo
corrección. Es al entrar en `Cierre` cuando deja de permitirse.

---

## 9. Frontera de escritura

El cliente móvil no es confiable: un conjunto de efectos bien formado puede ser
semánticamente falso, y la RLS acota a qué filas se llega, no si lo afirmado es
cierto.

**El cliente envía la intención, no el resultado contable.** Una función en el
servidor valida y genera los efectos atómicamente. **Los roles cliente no tienen
permisos de escritura sobre operaciones ni efectos.**

Validaciones que le corresponden: pagador único y participante con parte > 0 ·
participantes válidos en la fecha efectiva · `shares` enteros positivos ·
`exact_amounts` de suma exacta · idempotencia según origen · derecho de
corrección · límites del acceso residual · **que quien registra tenga derecho a
producir los efectos que la operación alcanza** · bilateralidad del reparto
final y de su corrección.

`domain/` conserva el mismo cálculo para la previsualización sin conexión, con
**vectores de prueba compartidos** que detecten cualquier deriva entre ambas
implementaciones.

---

## 10. Invariantes

1. Los valores contables se representan de forma exacta, nunca mediante coma
   flotante binaria. Escala según la moneda.
2. Todo importe lleva su moneda ISO 4217.
3. Redondeo y reparto del resto deterministas y documentados.
4. **Cada cambio de saldo de cada ámbito se representa exactamente una vez.**
   Una transferencia interna produce una salida en origen y una entrada en
   destino; una externa puede tener un único extremo interno. Ningún
   versionado, corrección, reintento, reparto, liquidación, importación ni
   conciliación puede duplicarlos.
5. Un gasto económico no produce por sí mismo un nuevo efecto de saldo si ese
   movimiento ya está representado.
6. Una liquidación no mueve saldo por definición.
7. Solo `ingreso` y `gasto` alimentan las estadísticas correspondientes.
8. Caja, gasto o ingreso económico, deuda y liquidación son dimensiones
   distintas y no se sustituyen entre sí.
9. **El gasto económico corresponde a todos los participantes de un gasto**, con
   independencia de quién pagó.
10. **El resultado financiero de una operación no depende de quién la registre.**
11. Los hechos son inmutables; corregir es versionar o compensar. Saldos y
    estadísticas se derivan de la versión vigente.
12. Cada ámbito tiene una moneda base inmutable tras su primera operación.
13. **Un usuario solo produce efectos sobre otro cuando la operación y el ámbito
    le conceden ese derecho.** Todo efecto es inmediato, atribuible, notificable
    y corregible.
14. **Una transferencia interna directa entre usuarios solo puede originarla el
    propietario del Modo Personal que constituye el extremo de salida.** El
    destinatario no puede originar una salida en el Modo Personal del remitente.
15. **Toda operación con efectos financieros relevantes sobre otro usuario queda
    atribuida y genera notificación.**
16. La trazabilidad de una aportación al Modo Pareja no confiere propiedad,
    porcentaje ni derecho de recuperación; el saldo es común.
17. **El reparto final del saldo común del Modo Pareja y las compensaciones que
    modifiquen ese acuerdo son la única familia de operaciones que exige
    bilateralidad.** El reparto la exige porque **crea** la asignación individual
    de un saldo común no atribuido; su corrección la **hereda** porque modifica
    un acuerdo bilateral previo, no porque siga repartiendo valor común.
18. **Iniciado el `Cierre` de un Modo Pareja, ninguna operación unilateral puede
    reducir el saldo común en beneficio individual de uno de sus miembros.** El
    saldo solo sale individualmente mediante una asignación permitida por el
    proceso de cierre. Mientras el ámbito está activo, las retiradas ordinarias
    sí son inmediatas y unilaterales.
19. Toda operación monetaria reintentable es idempotente, con garantía efectiva
    **para su origen**.
20. El cliente no escribe efectos contables directamente.
21. Un cambio de plan o entitlement nunca reescribe hechos contables
    históricos.

---

## 11. Fuera de este documento

**Monetización.** El dominio conoce ámbitos, operaciones, efectos y cierres; no
conoce planes. La capa de capacidades **invoca** al dominio; el dominio **nunca
consulta** capacidades.

**Pendiente en otros ADR:** representación exacta del importe · comprobación de
membresía · esquema expuesto y grants · idempotencia de recurrencias y backend ·
origen y ajuste del tipo de cambio · conciliación entre un movimiento importado
y la pata personal de una operación compuesta.
