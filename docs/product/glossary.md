# Glosario de Nomey

> **Documento de mantenimiento obligatorio.**
>
> En Nomey, «gasto» significa al menos tres cosas distintas y «saldo» cambia de
> sentido según el ámbito. Sin este documento, esa ambigüedad acaba en los
> nombres de las tablas, en la interfaz y en las conversaciones — y ahí ya no se
> arregla.
>
> Referencias: [ADR-002](../adr/ADR-002-accounting-model.md) ·
> [modelo de datos](../architecture/data-model.md).

---

## Los cuatro hechos que se confunden

Si alguien paga 120 € de una cena a partes iguales entre cuatro:

| Hecho                  | Importe | Qué responde                       |
| ---------------------- | ------- | ---------------------------------- |
| **Movimiento de caja** | −120 €  | ¿cuánto dinero salió de su ámbito? |
| **Gasto económico**    | −30 €   | ¿cuánto consumió realmente?        |
| **Deuda / derecho**    | +90 €   | ¿cuánto le deben?                  |
| **Liquidación**        | —       | ¿se ha extinguido esa obligación?  |

**Ninguno sustituye a otro.** Decir «gastaste 480 € este mes» sumando
movimientos de caja hace que quien paga las cenas parezca un manirroto y quien
nunca paga parezca un asceta. Las dos cifras son falsas y ninguna da error.

---

## Estructura

### Operación

La **intención del usuario**: lo que hizo. «Cena de 120 €, a partes iguales
entre cuatro». Unidad de identidad, idempotencia, versionado y agrupación de
efectos.

### Efecto

Un **hecho concreto que cambia algo**. Unidad de contabilidad, clasificación,
estadísticas y visibilidad.

Una operación genera uno o varios efectos, posiblemente en ámbitos distintos y
de clases distintas. **La clase de un efecto no determina qué dimensiones
toca**: hay `gasto` que no mueve saldo y `liquidación` que no toca caja.

Los efectos de una operación válida **se aplican de inmediato**. No existen
efectos pendientes ni estados de autorización.

---

## Ámbitos

Los tres son **internos de Nomey**. Ninguno es una cuenta bancaria.

### Modo Personal

El ámbito financiero de un usuario. **Uno solo por persona**, con un único
saldo y un único historial. No se elige «cuenta» al registrar un gasto.

También: _ámbito financiero personal_, _saldo personal_. **Nunca** «cuenta
personal» ni «cuenta de A».

### Grupo

Ámbito compartido para gastos entre varias personas. **No tiene saldo propio**:
tiene deudas entre participantes.

### Modo Pareja

Ámbito privado entre **exactamente dos usuarios**, con **dinero común**: un
único saldo compartido, sin deudas internas ni saldos individuales.

---

## Personas

| Término                    | Qué es                                                                       |
| -------------------------- | ---------------------------------------------------------------------------- |
| **Usuario**                | Alguien con cuenta en Nomey                                                  |
| **Participante**           | Quien puede figurar en un reparto. **Puede no tener cuenta**                 |
| **Usuario vinculado**      | La cuenta que reclamó un participante                                        |
| **Membresía activa**       | Relación vigente con un grupo: ver y crear actividad                         |
| **Participante histórico** | Figura en operaciones pasadas. Permanece siempre                             |
| **Acceso residual**        | Quien salió de un grupo con saldo pendiente: lectura acotada y liquidaciones |

**Reclamación:** vincular un participante con un usuario. Su historial se
incorpora a las finanzas personales **en las fechas originales**.

---

## Clases contables

> **Solo `ingreso` y `gasto` alimentan las estadísticas de ingresos y gastos.**
> Transferencias, ajustes y liquidaciones quedan fuera **por defecto**, igual que
> cualquier clase que se añada en el futuro. Es lista de admitidos, no de
> excluidos: un olvido debe producir «falta un dato», nunca «el dato miente».

### Ingreso

Dinero que entra y **es** una ganancia. Alimenta estadísticas.

### Gasto

Consumo económico real. Alimenta estadísticas. **Puede no mover saldo**: si paga
otra persona, hay gasto sin cambio de caja.

**Corresponde a todos los participantes de un gasto**, no solo a quien pagó. En
una cena de 120 € entre cuatro, los cuatro tienen 30 € de gasto económico.

### Transferencia

Movimiento de saldo que **no es ingreso ni gasto** y no genera deuda por sí
mismo.

- **Interna:** dos extremos dentro de Nomey — una salida en el ámbito origen y
  una entrada en el destino. Entre Modos Personales de dos usuarios, **solo la
  origina quien envía**: puedes declarar que has enviado valor propio, no que
  otro te lo ha enviado.
- **Externa:** un único extremo interno. La contraparte queda fuera de los
  ámbitos de Nomey en esa operación —un participante sin usuario, o alguien que
  no ha creado la transferencia interna correspondiente—. **Afecta solo al
  ámbito de quien la registra.**

> Si crees haber recibido dinero que la otra persona no ha registrado, lo
> reflejas en tu propio ámbito como transferencia **externa**. No se finge una
> transferencia interna que el otro no ha creado.

### Ajuste

Reconciliación manual del saldo declarado. **La declaración inicial de dinero
disponible es el primer ajuste.** Encontrar 50 € más de los esperados no es
haberlos ganado: fuera de estadísticas.

### Liquidación

Extingue total o parcialmente una deuda. **No mueve saldo por definición.**
Admite pagos parciales: pagar 30 de 100 deja 70.

**Nunca supera el importe pendiente.** Sobre una deuda de 30, pagar 31 es
inválido: el exceso no es una liquidación sino una **transferencia entre
usuarios**. Tampoco se liquida una deuda que no existe ni en la dirección
contraria a la existente.

> **Transferencia ≠ liquidación.** Una mueve saldo, la otra modifica una deuda.
> Una misma operación puede contener ambas —«pagar deuda mediante
> transferencia»— pero eso no implica que toda liquidación mueva caja.

---

## Moneda e importe

Referencia: [ADR-003](../adr/ADR-003-money-representation.md).

### Definición monetaria

La unidad de identidad monetaria. **No es el código ISO**: es el código junto a
su escala y a una **identidad estable e inmutable** que permite saber qué
significaba un importe cuando se registró.

Dos hechos con el mismo código pueden pertenecer a definiciones distintas —si la
moneda redenominó, o si se corrigió un error en la metadata—, y entonces **no son
directamente comparables**.

A la inversa: **una identidad identifica una única definición coherente**. Dos
valores con la misma identidad que se contradigan en escala o código no son
definiciones distintas, son un dato corrupto, y operar con ellos es inválido.

> **El significado monetario de un hecho histórico es inmutable.** Cambiar la
> metadata de una moneda nunca reinterpreta un hecho ya registrado.

### Importe original

El que introdujo el usuario, con su moneda. Es **el único autoritativo** de la
operación.

### Importe derivado

El mismo valor expresado en la moneda base de un ámbito. Se calcula, se redondea
y **se almacena**, y **nunca se usa para reconstruir el original**.

Una operación puede tener **varios** importes derivados, uno por ámbito
alcanzado, cada uno con el tipo de cambio exacto que se usó. **No hay un tipo de
cambio único por operación.**

### Moneda base

La moneda de un ámbito. **Inmutable tras su primera operación.** Antes de esa
primera operación, el creador de un Grupo todavía puede cambiarla.

### Tipo de cambio

Valor decimal exacto, **distinto de un importe**. Corresponde a la **fecha
efectiva del hecho**, no al momento de sincronización; lo resuelve el servidor;
y una vez registrado **queda congelado**. Corregir una operación **hereda** el
tipo histórico, salvo que el tipo sea justamente el dato que se corrige.

### Agregación

> **Dos importes solo se suman si comparten definición monetaria.**

Importes de definiciones distintas **no se agregan automáticamente**, aunque
compartan código, símbolo o nombre. Si no son comparables, Nomey **no muestra un
total**: hace falta una conversión explícita a una definición común.

### Residuo de conversión

Lo que se descarta al redondear una conversión a la unidad mínima de la moneda
destino. **No es un movimiento financiero y no genera ningún efecto** — en
particular, **no es un `ajuste`**.

---

## Reparto

| Término             | Qué es                                                   |
| ------------------- | -------------------------------------------------------- |
| **Pagador**         | Quien pagó. **Único**, y siempre entre los participantes |
| **Participación**   | El importe exacto atribuido a una persona                |
| **`equal`**         | A partes iguales entre los seleccionados                 |
| **`shares`**        | Por partes, con enteros positivos                        |
| **`exact_amounts`** | Importes exactos, cuya suma debe cuadrar con el total    |
| **Mayor resto**     | Regla de reparto del céntimo sobrante                    |

**Se guardan intención y resultado.** Un 30/30/30/30 no distingue «a partes
iguales entre cuatro» de «cuatro importes fijos», y esa diferencia decide si una
corrección posterior recalcula.

**Mayor resto:** cuotas matemáticas → truncar → repartir las unidades restantes
por mayor fracción descartada → empate al pagador → si persiste, orden estable
guardado con la operación. 10 € entre tres: **3,34 / 3,33 / 3,33**.

---

## Modo Pareja

| Término                    | Qué es                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Saldo común**            | El único saldo del ámbito. No se divide                                                                                                    |
| **Aportación**             | Transferencia hacia el ámbito. **No confiere propiedad**                                                                                   |
| **Retirada**               | Transferencia desde el ámbito. Inmediata mientras está activo; **bloqueada en `Cierre`**                                                   |
| **Fuente de financiación** | De dónde salió **económicamente** el dinero: saldo común, o A, o B                                                                         |
| **Procedencia / medio**    | Qué instrumento originó **físicamente** el pago                                                                                            |
| **`Cierre`**               | Estado tras iniciarse el cierre. Congela la actividad ordinaria y **bloquea las retiradas unilaterales**. **No cuenta como ámbito activo** |
| **Reparto final**          | Distribución del saldo restante. **Requiere acuerdo bilateral**                                                                            |

> **Fuente de financiación y procedencia son cosas distintas** y no se colapsan
> en un solo atributo.

**Aportación ≠ saldo individual ≠ porcentaje de propiedad ≠ deuda interna.** Se
conserva quién aportó qué, por trazabilidad; eso **no** otorga derecho sobre el
saldo restante.

**El estado del ámbito cambia qué se puede hacer con el saldo común.** Estando
activo, cualquiera retira con efecto inmediato: es dinero común operativo.
Iniciar el `Cierre` —acto unilateral— bloquea en el mismo instante las retiradas
unilaterales, para que nadie pueda vaciar el ámbito antes del reparto. Desde
entonces el saldo solo sale por el reparto final bilateral o por operaciones
expresamente permitidas para resolver el cierre.

---

## Magnitudes

### Disponible actual

Dinero que existe **ahora** en un ámbito, según lo registrado. No simula el
cobro ni el pago de deudas pendientes.

### Disponible tras saldar

`Disponible actual` + lo que te deben − lo que debes. **Es una proyección**, no
dinero líquido.

El saldo del Modo Pareja **no entra**: al no existir porcentajes de propiedad,
ningún miembro tiene una parte determinable de él.

**Ambas magnitudes están sujetas a la regla de agregación**: si los importes
implicados pertenecen a definiciones monetarias distintas, no se suman sin una
conversión explícita, y sin ella **no hay cifra que mostrar**.

---

## Permisos y efectos sobre otros

| Término          | Qué significa                                                         |
| ---------------- | --------------------------------------------------------------------- |
| **Inmediato**    | El efecto se aplica al registrarse. Es la regla general               |
| **Atribución**   | Quién registró la operación, siempre conservado                       |
| **Notificación** | Aviso al usuario afectado por una operación que otro registró         |
| **Bilateral**    | Requiere acuerdo de ambas partes. **Solo el reparto final de pareja** |
| **Emisor**       | Único que puede originar una transferencia directa entre usuarios     |

**Regla general:**

> Un usuario solo puede producir efectos sobre otro cuando la operación y el
> ámbito correspondiente le conceden ese derecho. Todo efecto es inmediato,
> atribuible, notificable y corregible.

**No hay confirmaciones.** Si otro usuario registra algo que alcanza tu Modo
Personal, se aplica y recibes notificación; si es incorrecto, se corrige por
versionado.

**Efecto inmediato no es acceso arbitrario:** el efecto sobre otro debe nacer de
una operación válida del dominio, y los permisos siguen dependiendo del tipo de
operación y de la relación entre los usuarios.

**El resultado financiero no depende de quién registre.** Solo cambian la
autoría y a quién se notifica.

**Excepción, por ser un primitivo sin contexto compartido:** una transferencia
directa entre usuarios **solo la origina el emisor**. Quien recibe no puede
declarar unilateralmente que otro le ha enviado valor y generar una salida en el
ámbito de ese tercero. Igual al pagar una deuda: la inicia el deudor; el
acreedor conserva «marcar deuda como saldada», que no mueve saldo.

La protección está en cinco capas: **permisos del ámbito · atribución ·
historial · notificación · corrección**.

### La única familia bilateral

> **La bilateralidad se exige cuando el propio acuerdo crea la asignación
> individual de valor común todavía no atribuido, y también cuando se modifica o
> compensa posteriormente una asignación creada mediante un acuerdo bilateral
> previo.**

Dos operaciones, **con motivos distintos**:

- **Reparto final del Modo Pareja** — **crea** la asignación individual de un
  saldo común que no pertenece a nadie en proporción determinada.
- **Corrección de un reparto ya ejecutado** — **modifica un acuerdo bilateral
  previo**. Para entonces el dinero ya está en los Modos Personales y ha dejado
  de ser saldo común, así que **no** es bilateral por el mismo motivo que el
  reparto.

Lo demás es inmediato: una transferencia porque dispones de valor propio; una
liquidación porque la obligación ya existe y solo afirmas que se extinguió; una
retirada ordinaria porque el Modo Pareja **activo** es dinero común operativo — y
deja de serlo al entrar en `Cierre`.

---

## Términos que no usamos

| ❌ No decir                     | ✅ Decir                                    |
| ------------------------------- | ------------------------------------------- |
| «cuenta personal de A»          | Modo Personal de A                          |
| «transferencia entre cuentas»   | transferencia entre Modos Personales        |
| «multicuenta»                   | —                                           |
| «gasto» sin decir cuál          | movimiento de caja **o** gasto económico    |
| «saldo» sin decir de qué ámbito | saldo del Modo Personal / del Modo Pareja   |
| «el usuario debe» en un grupo   | el **participante** debe                    |
| «la moneda» cuando importa cuál | la **definición monetaria**                 |
| «el importe» sin decir cuál     | importe **original** o importe **derivado** |

Los ámbitos de Nomey **no son cuentas bancarias**. Una integración externa
futura aporta procedencia y conciliación; no cambia su naturaleza.
