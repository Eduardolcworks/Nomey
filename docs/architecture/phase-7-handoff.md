# Punto de entrada — Fase 7 · Entrada rápida, offline y sincronización

> **Documento vivo de la fase, y NO normativo.** Recoge qué entregó la Fase 7
> bloque a bloque, qué se validó físicamente y qué queda deliberadamente fuera.
> Las decisiones viven en [`docs/adr/`](../adr/README.md), en
> [`data-model.md`](data-model.md) y en el [roadmap](../product/roadmap.md); si
> este documento los contradice, mandan ellos.

Antes de nada, y en este orden: [`AGENTS.md`](../../AGENTS.md) ·
[`PROJECT_STATE.md`](../PROJECT_STATE.md) · este documento.

---

## 1 · Dónde está la fase

| Bloque   | Qué es                                           | Estado                            |
| -------- | ------------------------------------------------ | --------------------------------- |
| **F7.A** | Taxonomía de errores y contrato de la cola       | **Cerrado**                       |
| **F7.B** | Almacenamiento durable de la cola                | **Cerrado**                       |
| **F7.C** | Worker de sincronización, planificador y backoff | **Cerrado**                       |
| **F7.D** | Activación y proyección optimista                | **Cerrado y validado en Android** |
| **F7.E** | Incidencias visibles · **cierre de fase**        | **Cerrado y validado en Android** |

**iOS no está validado físicamente en esta fase.** Nada de lo que entra es
específico de plataforma —la cola es `expo-sqlite`, el worker es TypeScript puro
y la pantalla usa los mismos componentes que F6 aprobó en los dos sistemas—,
pero **no se ha ejecutado en un dispositivo iOS** y no se declara como tal.

---

## 2 · Qué promete la Fase 7

El tercer pilar del producto: registrar un gasto ordinario en un recorrido
**corto y continuo**, con **aparición inmediata**, que funcione sin conexión y
que **no duplique dinero jamás**.

La decisión que lo sostiene entera es
[ADR-028](../adr/ADR-028-offline-command-queue-and-optimistic-projection.md), con
dos precisiones posteriores en
[ADR-029](../adr/ADR-029-incident-labels-and-review-destination.md).

> **«En el orden de cinco segundos» era el concepto, no un umbral.** El roadmap
> lo dice desde el cierre: cronometrarlo habría medido el teclado del aparato,
> no el recorrido. Lo que se exige es lo comprobable — sin pasos de más, sin
> esperar a la red, y el movimiento en pantalla al guardarse.

---

## 3 · Qué entregó cada bloque

### F7.A · La taxonomía

Siete clases de resultado, y la columna que decide el tratamiento **no es la
gravedad sino si se puede demostrar que la operación no produjo efectos**.
Cualquier respuesta inclasificable cae en la fila más conservadora que le
aplique: si el resultado es desconocido, se reintenta con la misma clave.

### F7.B · La cola durable

`expo-sqlite`, migrada con `PRAGMA user_version`, aislada por actor en **todas**
las sentencias. La clave de idempotencia se persiste **antes del primer
intento**, que es lo que [ADR-010](../adr/ADR-010-client-operation-idempotency.md)
exigía y no se cumplía.

### F7.C · El worker

Serie, una petición en vuelo, FIFO por actor, con plazo y cancelación real,
backoff exponencial y un coordinador que une `onSettled → reschedule` con
`onDue → wake` bajo **un** temporizador. Una fila `sending` en disco se relee
siempre como `queued` y se reenvía **con la misma clave**: el cliente no puede
distinguir «no llegó» de «llegó y no me enteré», y no lo intenta.

### F7.D · Activación y proyección optimista

El alta pasa a salir **por la cola y por ninguna otra puerta**; la hoja se cierra
sólo si la intención quedó en disco. Inicio pinta
`snapshot confirmado + comandos locales no reconciliados` desde **una función
pura compartida** por el Disponible, los totales, el donut, su leyenda y la
lista, reutilizando `src/domain/effects` para que cliente y frontera sean la
misma aritmética. **Sin etiquetas de pendiente**: la confirmación es
visualmente silenciosa.

Tres correcciones de calado salieron de la revisión de este bloque:

- **La barrera durable de envíos.** `confirm_seq` no puede ver una escritura del
  servidor anterior a que el cliente se entere, así que el **envío** se marca:
  `queue_entry.dispatch_seq`, escrito antes del transporte y en la misma
  sentencia que `state = 'sending'`, y nunca borrado mientras la entrada vive.
  Una respuesta remota sólo es base si su ventana fue quieta.
- **Una definición monetaria distinta no borra la fila.** Se pinta con su
  importe y su moneda, y no entra en ningún agregado (ADR-028 §14).
- **Un refresco fallido no destruye una base válida.** Lo que califica un bloque
  como base es haber salido de una ventana quieta, no que el último intento
  funcionara.

### F7.E · Las incidencias, y el cierre

La **única superficie visible** de la cola: la campana contigua a Perfil, con un
punto discreto cuando hay algo sin resolver, y ninguna palabra de la maquinaria
en pantalla.

- **Forma ordinaria** (`rejected`, ausencia de efectos demostrada): «Gasto de
  12,00 € en Restauración no realizado. ¿Quieres volver a intentarlo?», con
  **Sí** y **No**. `Sí` crea una intención nueva con clave nueva y el mismo
  payload congelado, y elimina la anterior **en una sola transacción**.
- **Forma excepcional** (`review` y `conflict`): **Revisar** y **Descartar**,
  nunca `Sí`. `Revisar` lleva a la hoja precargada **sin el importe** cuando la
  moneda se movió, y a la lista de movimientos cuando el resultado es
  desconocido — desde ahí **ninguna pulsación puede crear una clave**.
- **Un transitorio no es una incidencia.** Sin red, 5xx, 408, 429 o timeout, el
  movimiento sigue proyectado, conserva su clave y se reintenta solo.

---

## 4 · Qué se validó físicamente

**Android, Expo Go, contra el stack local**, con un actor desechable creado por
el mecanismo de `scripts/http-boundary-check.sh`:

| Qué                                                      | Resultado                                             |
| -------------------------------------------------------- | ----------------------------------------------------- |
| Base confirmada 100,00 € y gasto de 12,00 € sin servidor | Disponible 88,00 €, Gastos −12,00 €, categoría, donut |
| La fila sin marca de pendiente                           | Idéntica a una confirmada                             |
| Cerrar y abrir sin servidor                              | La intención sobrevive; agregados no disponibles      |
| Reintento automático al volver el servidor               | Confirmación silenciosa, ninguna cifra salta          |
| Servidor                                                 | **Una clave, una operación.** Ningún duplicado        |
| Incidencia ordinaria, Sí y No                            | _(F7.E — ver sección 7)_                              |

---

## 5 · Obligaciones que la Fase 7 deja

- **iOS sin validar físicamente.** Antes de cualquier distribución, la misma
  secuencia en un dispositivo iOS. **Desde el 2026-09-04 esa obligación tiene
  destino: F8.B**, junto con la cuenta de Apple y la firma, y es puerta
  obligatoria antes de F14.
- **La idempotencia de recurrencias, importaciones y operaciones de backend
  sigue abierta.** ADR-010 y ADR-028 cerraron **el origen cliente** y nada más.
- **Un drenaje largo retrasa la base.** Cada envío mueve el contador, así que
  con varias entradas encoladas Inicio no incorpora nada del servidor hasta que
  la cola queda quieta. Es la elección conservadora y está medida.
- **La `queued` heredada ambigua** de la migración 2→3: un proceso que muriera
  entre revivir un `blocked_session` y reintentarlo dejaría una fila que sí
  salió y ninguna columna del esquema 2 la distingue. Acotado y escrito en la
  migración; F7.C nunca se publicó, así que no existe en ningún aparato.

---

## 6 · Fuera de la Fase 7, y conviene que se vea

- **Widgets, Siri y el Action Button.** El tercer pilar los nombra; la fase
  entrega la entrada **dentro de la app**. Compartir la base con extensiones
  exige App Groups y código nativo, y es de F16.
- **Notificaciones push.** La campana es una notificación **interna**: no hay
  integración nativa ni permiso que pedir.
- **Correcciones y anulaciones encoladas.** Siguen fuera de la cola (ADR-028
  §4): tienen CAS propio y una corrección encolada podría quedar obsoleta antes
  de drenar.
- **Conversión monetaria.** Un conflicto se revisa, no se convierte: el FX
  resuelto por el servidor es de F11.

---

## 7 · Cómo se verifica

```bash
npm run verify          # typecheck + lint + formato
npx vitest run          # la suite entera

# la frontera completa por HTTP con JWT real, si se toca el backend
./scripts/http-boundary-check.sh
```

Las pruebas que sostienen la fase, por si hay que releerlas:

| Fichero                                      | Qué demuestra                                |
| -------------------------------------------- | -------------------------------------------- |
| `tests/lib/offline-queue-store.test.ts`      | La cola sobre SQLite real, aislada por actor |
| `tests/lib/offline-worker.test.ts`           | Serie, una en vuelo, FIFO                    |
| `tests/lib/offline-local-failure.test.ts`    | Qué pasa cuando la base falla, por etapa     |
| `tests/lib/personal-projection.test.ts`      | La proyección, incluida la moneda distinta   |
| `tests/lib/personal-snapshot-window.test.ts` | Las carreras, con barreras y sin relojes     |
| `tests/lib/offline-legacy-dispatch.test.ts`  | La migración 2→3 preserva el significado     |
| `tests/lib/personal-incidents.test.ts`       | Las incidencias y sus dos formas             |
