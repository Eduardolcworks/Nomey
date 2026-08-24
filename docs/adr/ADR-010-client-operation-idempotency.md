# ADR-010 — Idempotencia de las operaciones originadas por el cliente

- **Estado:** Aceptado
- **Fecha:** 2026-08-24

## Contexto

El invariante 19 de [`data-model.md`](../architecture/data-model.md) exige que
toda operación monetaria reintentable sea idempotente, **con garantía efectiva
para su origen**, y `AGENTS.md` §3 añade que **cada origen puede necesitar un
mecanismo distinto**.

El caso que lo motiva es cotidiano: el móvil registra un gasto, el servidor lo
guarda **correctamente**, y la respuesta se pierde. El cliente **no puede
distinguir «no llegó» de «llegó pero no me enteré»**, así que reintenta. Sin
idempotencia aparecen dos gastos y una deuda del doble.

> **Alcance de este ADR: exclusivamente el origen «entrada desde el cliente».**
> Recurrencias, importaciones bancarias y operaciones originadas en backend
> **quedan abiertas** y no se prejuzgan. Aplicarles este mecanismo sin
> analizarlas sería inventar.

**E15** midió el comportamiento concurrente de los patrones candidatos.
Evidencia en [`supabase/e15/`](../../supabase/e15/README.md).

## Decisión

### 1. El identificador lo genera el cliente

El cliente **genera un UUID de operación**, **lo persiste antes del primer
intento** y **reutiliza exactamente el mismo** en los reintentos de esa
intención.

El cliente **no** calcula huellas, **no** canonicaliza y **no** decide
equivalencia de intenciones.

> Persistir el identificador **antes** de intentar el envío no es un detalle de
> implementación: si el cliente lo regenera en cada reintento, **no hay
> idempotencia**. Es una obligación del contrato de cliente.

### 2. Ámbito de unicidad

La unicidad conceptual es **`(created_by, client_operation_id)`**, y **abarca
todas las clases de operación originadas por cliente**. **No existe un namespace
distinto por endpoint.**

El actor sale de la identidad de la petición autenticada
([ADR-009](ADR-009-authoritative-write-boundary.md) §3), **nunca del payload**,
de modo que no puede falsearse.

Consecuencia directa: **la misma clave usada en otra clase de operación produce
conflicto.**

### 3. La comparación ocurre solo en el servidor

| Caso                                                | Resultado              |
| --------------------------------------------------- | ---------------------- |
| Misma clave + **misma clase** + **misma intención** | **Replay idempotente** |
| Misma clave + **clase distinta**                    | **Conflicto**          |
| Misma clave + **intención distinta**                | **Conflicto**          |

**Nunca**: sobrescribir · crear una segunda operación · ignorar el problema en
silencio.

Devolver el original en silencio ante una intención distinta sería lo peor de
las tres opciones: si el cliente reutilizó la clave por un defecto, **una
operación real desaparecería sin rastro** y el usuario vería un importe que no
introdujo.

**No se cierra aquí** si físicamente se compara un `jsonb` normalizado, un hash
calculado en el servidor, o ambos: **lo elige D9**. Lo que sí queda fijado es
que **si algún día existe un hash, el cliente nunca lo calcula**, y que debe
distinguir la clase de operación además de la intención.

Que la comparación viva solo en el servidor **elimina una clase entera de
fallo**: mantener una canonicalización idéntica en dos implementaciones
produciría falsos conflictos cuando divergieran.

### 4. Concurrencia

**La unicidad se protege con una restricción o índice de base de datos.**
**No se usa un `SELECT` previo como garantía**: `comprobar y después insertar`
tiene una carrera clásica, porque dos reintentos simultáneos pueden comprobar
ambos antes de que ninguno inserte.

E15 midió **dos** patrones sobre transacciones concurrentes reales:
`INSERT ... ON CONFLICT DO NOTHING` y `INSERT` con captura de
`unique_violation`. **Los dos son correctos**: ambos crean exactamente una fila,
ambos hacen esperar al competidor hasta que la primera transacción confirma, y
ambos permiten leer después la fila original.

> **No se declara ninguno obligatorio.** La elección puede hacerse cuando aporte
> una ventaja concreta, en D9.

La medición se hizo con el nivel de aislamiento por defecto, `READ COMMITTED`.
Con un aislamiento más estricto habría que repetirla.

### 5. Replay tras una pérdida posterior de autorización

Hay que distinguir dos casos, y **no aplicarles la misma regla**:

**Operación nueva.** Requiere **la autorización actual completa** antes de
producir ningún hecho contable.

**Intención ya procesada.** Si coinciden **actor autenticado**,
**`client_operation_id`**, **clase** e **intención semántica**, puede devolverse
un **envelope idempotente mínimo** aunque el actor haya perdido después el
acceso al ámbito.

Ese envelope confirma **únicamente información de su propia petición**,
conceptualmente `operation_id` y `already_processed`. **No puede devolver**
importes · participantes · miembros · saldos · deudas · detalles actuales del
ámbito · **ni nada que la lectura normal ya no permitiría**.

**Toda lectura del contenido sigue pasando por `api → RLS`.**

> **Consecuencia aceptada, y se escribe para que nadie la descubra después:** un
> antiguo miembro **puede confirmar que una intención que él mismo originó llegó
> a procesarse**, pero no obtiene por ello acceso persistente al contenido del
> grupo.

Aplicar la autorización actual también al replay **rompería la idempotencia**:
el reintento fallaría, el cliente seguiría sin saber si la operación se procesó,
y podría acabar generando una intención nueva — exactamente el duplicado que
este ADR existe para impedir.

### 6. Compatibilidad con la entrada sin conexión

El mecanismo **no cierra la puerta** a los reintentos tras perder conexión, a
una cola sin conexión, ni al reenvío posterior de la misma intención: el
identificador se genera y se persiste en el cliente **antes** del primer envío,
sin necesitar red.

Tampoco cierra la puerta a otros orígenes: una operación originada en otro sitio
puede llevar el actor que le corresponda y su propia clave, con el mecanismo que
su análisis determine.

## Alternativas consideradas

**A · Huella del contenido, sin identificador.** Deduplicar comparando la
intención. **Descartada**: dos gastos idénticos legítimos —dos cafés de 1,20 € el
mismo día— **colapsarían en uno**. El fallo es silencioso y borra un hecho real.

**B · Identificador pedido al servidor antes de operar.** Da control al
servidor. **Descartada**: exige conexión **precisamente cuando no la hay**, y
rompe la entrada sin conexión, que es el caso que motiva todo el mecanismo.

**C · Ventana temporal de deduplicación.** «Ignorar lo idéntico durante cinco
minutos». **Descartada**: es una heurística y **falla en los dos sentidos** —
descarta operaciones legítimas y deja pasar duplicados tardíos.

**D · Unicidad global de la clave**, sin el actor. **Descartada**: un usuario
podría **quemar una clave ajena** y bloquear la operación de otro, y una
colisión revelaría que la clave existe. El vector es pequeño pero real, y se
evita sin coste incluyendo el actor.

**E · Unicidad por ámbito.** **Descartada por incorrecta**: una operación alcanza
**varios** ámbitos —una transferencia toca dos, un gasto de grupo toca el grupo y
el Modo Personal—, así que no hay un ámbito al que anclarla.

**F · Namespace de claves por endpoint.** Cada clase de operación con su propio
espacio. **Descartada**: la misma clave podría crear una operación en cada clase,
que es justo lo que la idempotencia debe impedir, y un cliente que reintentase
contra el endpoint equivocado por un defecto **no fallaría**, duplicaría.

**G · Huella calculada también por el cliente.** Era la propuesta inicial del
análisis. **Descartada** por su propio riesgo declarado: obliga a mantener una
canonicalización idéntica en dos implementaciones, y cuando divergen aparecen
**conflictos falsos** sobre operaciones legítimas.

## Consecuencias

### A favor

- **Cero configuración para el cliente** más allá de generar y guardar un UUID.
- **Aislamiento entre usuarios por construcción**, con un actor que no se puede
  falsear.
- **Libre de la carrera medida**, con dos patrones válidos entre los que elegir.
- **El reintento tras un `timeout` es indistinguible del éxito**, que es lo que
  hace segura la entrada sin conexión.
- **La expulsión sigue siendo inmediata** para el contenido, sin romper la
  idempotencia.

### En contra

- **Depende de que el cliente persista la clave** antes del primer intento. Si
  no lo hace, no hay idempotencia, y el servidor no puede detectarlo.
- **Un cliente que reutilice claves por un defecto verá conflictos en lugar de
  duplicados.** Es el modo de fallo correcto, pero **hay que diseñar qué hace la
  interfaz** con ese error, y ese trabajo no existía antes.
- **El replay revela la existencia** de una operación propia a quien ya perdió
  acceso al ámbito. Está acotado y aceptado, pero es información.
- **La comparación de intenciones tiene que definirse bien.** Que viva solo en el
  servidor elimina la divergencia entre implementaciones, no la dificultad de
  decidir qué dos intenciones son «la misma».
- **Reversibilidad baja en la práctica**: debe estar en la primera función de
  escritura. Añadirla después obliga a migrar todos los caminos y deja un hueco
  histórico sin garantía.

## Fuera de alcance

Delegado a **D9**:

- la **ubicación física** de `client_operation_id`;
- si se almacena **intención normalizada, hash, o ambos**;
- la **forma física del envelope** de replay y de los resultados;
- las **restricciones y relaciones** definitivas.

Sigue abierto, y **no se prejuzga**: la idempotencia de **recurrencias,
importaciones bancarias y operaciones originadas en backend**.
