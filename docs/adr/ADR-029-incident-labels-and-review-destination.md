# ADR-029 — Etiquetas visibles de la incidencia, y a dónde lleva «Revisar»

- **Estado:** Aceptado
- **Fecha:** 2026-09-04
- **Alcance:** cuatro decisiones de una misma corrección — la etiqueta
  afirmativa, el destino de `Revisar`, el importe tras un cambio de moneda y
  cuándo se resuelve la incidencia. Van juntas **a propósito y en un solo
  documento**: separarlas obligaría a leer cuatro ADR para entender una sola
  pantalla, y las cuatro corrigen la misma sección de ADR-028.
- **Supersede parcialmente:**
  [ADR-028](ADR-028-offline-command-queue-and-optimistic-projection.md), §15, y
  **sólo en esos cuatro puntos**: la etiqueta visible del botón afirmativo de la
  forma ordinaria, el destino concreto de `Revisar`, el importe que cruza —o
  no— un cambio de moneda, y el instante en que la incidencia se resuelve. Todo
  lo demás de ADR-028 sigue vigente y **no se reabre**: la taxonomía interna de §11, las dos formas
  visibles y ninguna tercera, la prohibición de vocabulario interno en pantalla,
  la semántica transaccional de la sustitución, que un transitorio no genera
  incidencia, que la campana es la única entrada y que **el estado terminal de
  la cola es la fuente durable** sin segundo almacén.

## Contexto

ADR-028 §15 cerró qué es una incidencia, cuáles son las dos formas visibles y
qué ocurre por dentro con cada una. Al llegar a programarla, dos cosas de esa
sección resultaron no estar decididas al nivel que hace falta para escribir
código sin inventar comportamiento de dinero.

**La primera es una etiqueta.** §15 dibuja el botón afirmativo como
`[ Reintentar ]`, y esa palabra pertenece exactamente al vocabulario que la
propia sección prohíbe: «reintento automático» está en su lista de términos que
no deben aparecer ni deducirse. Peor, describe lo que el sistema **no** hace —
por dentro no se reintenta nada, se crea una intención nueva— así que nombra la
maquinaria y la nombra mal. Lo que la persona decide es más simple: si quiere
volver a intentarlo o no.

**La segunda es un destino.** §15 dice dos cosas sobre `Revisar` que no llevan
al mismo sitio:

> «`Revisar` abre el movimiento precargado para que la persona decida
> conscientemente»

> «El texto dice que no se ha podido confirmar si el movimiento quedó
> registrado y **pide comprobarlo**»

Abrir una hoja precargada y pedir que se compruebe si algo ya existe son
acciones distintas, y la diferencia no es cosmética: la forma excepcional cubre
dos estados internos cuyo riesgo es opuesto, y elegir mal el destino reintroduce
justo el fallo que ADR-028 existe para impedir.

## Decisión

### 1. La forma ordinaria pregunta, y los botones responden

```
Gasto de 12,00 € en Restauración no realizado. ¿Quieres volver a intentarlo?
                                                      [ Sí ]      [ No ]
```

**La palabra «Reintentar» no aparece en la interfaz.** El texto ya formula una
pregunta; los botones la contestan. Dos palabras, ningún término técnico, y
ninguna promesa sobre qué ocurre por dentro.

**La semántica interna de §15 no cambia en nada.** `Sí` sigue siendo, en una
sola transacción local: crear una entrada nueva con `client_operation_id` nuevo,
estado inicial y `attempts` a cero, conservando **el mismo payload congelado**
—importe, concepto, tipo, fecha efectiva, hora, categoría y definición
monetaria—; eliminar la entrada rechazada con su incidencia; publicar el cambio
y despertar al worker una sola vez. `No` sigue resolviendo la incidencia y
eliminando la entrada rechazada sin llamar al servidor.

### 2. `Revisar` lleva a un sitio distinto según lo que se pueda demostrar

La etiqueta visible sigue siendo una —`Revisar`— porque la distinción
«demostrable» contra «no demostrable» es interna y §15 decidió no enseñarla. Lo
que cambia es a dónde lleva, y cambia porque el riesgo es distinto:

| Estado interno | Qué se sabe                     | Destino de `Revisar`                    |
| -------------- | ------------------------------- | --------------------------------------- |
| `conflict`     | la operación **no existe**      | la hoja de alta, **precargada**         |
| `review`       | la operación **podría existir** | la lista de movimientos, para comprobar |

**Para `conflict` la hoja precargada es segura**, porque la frontera respondió
`CURRENCY_CONVERSION_UNSUPPORTED` antes de escribir nada: repetir el movimiento
no puede duplicar. Lo que hacía falta era que la persona reconsiderase el
importe bajo la moneda vigente, y para eso la hoja es el sitio.

**Para `review` la hoja precargada sería peligrosa.** `IDEMPOTENCY_KEY_REUSED`
significa que la clave se usó, y una intención nueva sobre una operación que
**podría existir** es dinero duplicado — el fallo que toda esta familia de
decisiones existe para impedir. Un botón que abre un formulario relleno invita a
confirmarlo sin mirar. Llevar a la lista invierte el orden: primero se mira, y
si el movimiento no está, se registra por la vía normal, que es exactamente la
misma que cualquier otro gasto. **Ninguna pulsación desde una incidencia
`review` puede crear una clave nueva.**

### 3. El importe no cruza un cambio de moneda

Cuando `Revisar` abre la hoja precargada tras un `conflict`, entran el concepto,
la categoría, la fecha y la hora. **El importe no.** Queda vacío para que se
escriba bajo la definición vigente.

Es la lectura estricta de [ADR-003](ADR-003-money-representation.md) §7 y de
ADR-028 §14: llevar el `12` de una definición a otra lo convierte en doce de
algo distinto sin que nadie haya convertido nada. Que lo confirme una persona no
lo hace una conversión; lo hace una reinterpretación con testigo. Un campo vacío
obliga a declarar la cifra en la moneda que hay, que es lo único que el cliente
puede hacer honestamente mientras el FX del servidor sea de F11.

### 4. La incidencia se resuelve al confirmar, nunca al abrir

`Revisar` **no borra nada por abrirse**. Si la persona confirma el movimiento en
la hoja, la entrada terminal y su incidencia se eliminan **en la misma
transacción** que crea la entrada nueva — el mismo mecanismo que `Sí`. Si cierra
sin confirmar, todo queda como estaba y la incidencia sigue esperando.

Resolver al abrir habría perdido un aviso sin que nadie decidiera nada, y no
resolver nunca habría dejado un aviso colgando junto al movimiento ya rehecho.

`Descartar` no cambia: resuelve la incidencia y elimina la entrada local **sin
tocar el servidor**. Sigue siendo seguro incluso sin poder demostrar ausencia de
efectos, por el motivo que §15 ya escribió: no borra nada de allí, y si la
operación existiera seguiría en la lista, porque la autoridad es el snapshot.

## Alternativas consideradas

**A · Dejar `Reintentar`.** Es la palabra que ADR-028 dibujó, y cambiarla obliga
a este documento. Descartada porque la propia §15 prohíbe el vocabulario del que
esa palabra forma parte, y porque describe mal lo que ocurre: no hay reintento,
hay una intención nueva.

**B · Un destino único para `Revisar`.** Más simple de programar y de explicar.
Descartada en las dos direcciones: la hoja siempre convierte `review` en un
generador de claves nuevas sobre operaciones que podrían existir; la lista
siempre deja a quien tuvo un conflicto monetario sin ningún camino, teniendo la
certeza de que su movimiento no se escribió.

**C · Precargar también el importe en `conflict`.** Menos fricción. Descartada
por §3: es reinterpretación, aunque sea explícita.

**D · Una tercera forma visible que distinga demostrable de no demostrable.**
Es lo que ADR-028 §15 ya descartó, y sigue descartado: la distinción es interna
y las dos situaciones piden lo mismo a la persona.

## Consecuencias

### A favor

- Ninguna palabra de la maquinaria llega a la pantalla, que era el objetivo
  declarado de §15 y su dibujo incumplía.
- El camino que puede duplicar dinero deja de existir: desde una incidencia
  `review` no hay ninguna pulsación que cree una clave.
- El importe no cruza definiciones monetarias en ninguna ruta.
- La resolución al confirmar reutiliza la misma transacción de `Sí`, así que no
  hay un segundo mecanismo que mantener.

### En contra

- **Una etiqueta con dos destinos.** `Revisar` lleva a sitios distintos según un
  estado que la persona no ve. Es deliberado —la distinción es interna— pero
  significa que dos incidencias de aspecto igual se comportan distinto, y eso
  hay que recordarlo al leer el código.
- **`Revisar` sobre `review` no deja nada hecho.** Lleva a mirar y punto; si el
  movimiento no está, hay que registrarlo a mano. Es el precio de no ofrecer un
  atajo que podría duplicar.
- **Un campo vacío en la hoja precargada** se puede leer como un fallo de la
  precarga. Lo compensa el texto de la incidencia, que dice por qué.

## Invariantes que introduce

1. La palabra «Reintentar» **no aparece en ninguna cadena visible**.
2. Desde una incidencia en estado `review` **no existe ninguna acción que cree
   un `client_operation_id` nuevo**.
3. El importe de una entrada en `conflict` **nunca se precarga** en un
   formulario cuya definición monetaria vigente sea otra.
4. Una entrada terminal y su incidencia se eliminan **sólo** en la misma
   transacción que crea su sustituta, o por una resolución explícita —`No` o
   `Descartar`—. Abrir `Revisar` no resuelve nada.
