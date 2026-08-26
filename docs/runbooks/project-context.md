# Runbook · Protocolo de contexto del proyecto

> **Procedimiento operativo, no decisión de arquitectura.** Fija cómo se mantiene
> [`PROJECT_STATE.md`](../PROJECT_STATE.md) y cómo se carga contexto para
> trabajar en Nomey. Las decisiones que obedece viven en
> [`docs/adr/`](../adr/README.md).
>
> **Vale para cualquiera que trabaje en Nomey**, persona o agente. No describe
> ninguna herramienta concreta.

Escrito el 2026-08-27, al cerrar la Fase 3 y antes de empezar la Fase 4.

---

## 1 · Qué es `PROJECT_STATE.md`

**El estado vigente global de Nomey. Un snapshot, no un historial.**

Responde, y solo, a estas preguntas:

| Pregunta                                            |
| --------------------------------------------------- |
| ¿En qué fase estamos y cuál fue la última cerrada?  |
| ¿Cuál es la arquitectura vigente relevante?         |
| ¿Cuál es la superficie pública estable?             |
| ¿Qué invariantes transversales no se deben romper?  |
| ¿Qué limitaciones globales hay ahora mismo?         |
| ¿Qué decisiones aplazadas siguen siendo relevantes? |
| ¿Cuál es el siguiente objetivo?                     |
| ¿Dónde se busca más detalle si hace falta?          |

> **No registra cómo se llegó hasta ahí.** Ni el orden en que se decidió, ni qué
> se descartó, ni qué se intentó antes. Eso existe, y tiene sus sitios (§7).

**La prueba de si algo pertenece a este documento** es una sola pregunta:

> ¿Alguien que llega hoy, sin contexto previo, **necesita esto para entender el
> estado actual** de Nomey y no romperlo?

Si la respuesta es no, no entra — por interesante que sea.

---

## 2 · Sustitución, no acumulación

**Es la regla más importante de este runbook, y la más fácil de incumplir sin
darse cuenta.**

> **Cuando una información de `PROJECT_STATE.md` deja de ser vigente, se
> ELIMINA o se SUSTITUYE por la nueva. Nunca se conserva el estado anterior
> debajo del nuevo.**

Añadir es cómodo y borrar da reparo, así que la deriva natural de un documento
así es crecer hasta dejar de servir. **`PROJECT_STATE.md` nunca debe crecer por
acumulación histórica.**

Cómo se aplica, caso por caso:

| Cambia…                         | Qué se hace                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------- |
| La fase actual                  | La anterior **desaparece** como «actual». Como mucho queda como «última cerrada» |
| Una limitación se resuelve      | **Se borra** de las limitaciones vigentes. No se anota que existió               |
| Una decisión aplazada se cierra | **Se borra** de aplazadas. Solo queda su **estado vigente**, si es transversal   |
| Una API deja de existir         | **Se borra** de la superficie. No se marca como «retirada»                       |
| Un invariante se sustituye      | Se **reemplaza**. Nunca conviven el viejo y el nuevo                             |

**Ejemplo literal.** Si dice `Fase actual: F4` y se cierra F4:

```
ANTES                          DESPUÉS
Fase actual: F4        →       Última fase cerrada: F4
                               Fase actual: F5
```

Y no:

```
Fase actual: F5
Fase anterior: F4          ← acumulación
Antes de eso: F3           ← acumulación
Y antes: F2 ...            ← el documento ya no sirve
```

> **Llegar a F15 no debe implicar que `PROJECT_STATE.md` contenga el historial de
> F1 a F14.** Si a nadie le hace falta para trabajar hoy, no está ahí.

**Borrar no pierde nada.** El historial vive en Git, en los ADR, en los handoffs
y en el roadmap, y ninguno de esos se toca al limpiar el snapshot.

---

## 3 · Cuándo se actualiza

**No se actualiza mecánicamente.** Actualizarlo por rutina lo convierte en un
changelog, que es exactamente lo que no es.

**NO se actualiza tras:**

- una tarea, un commit, una rama o una PR;
- un bug menor o su corrección;
- tests nuevos;
- refactors internos;
- cambios de implementación sin impacto transversal.

**SÍ se actualiza cuando cambia el estado global relevante para el trabajo
futuro:**

- **empieza o termina una fase**;
- **cambia una superficie pública estable**;
- **cambia un invariante transversal**;
- se **acepta una decisión arquitectónica** con impacto futuro;
- una **decisión aplazada cambia de estado o de destino**;
- **aparece o desaparece una limitación técnica global** relevante.

Antes de tocarlo, las dos preguntas —y las dos se hacen siempre, porque la
segunda es la que se olvida:

> **Para lo que se quiere añadir:** ¿es necesario para entender correctamente el
> estado **actual** de Nomey? Si no → **no se añade**.
>
> **Para lo que ya está:** ¿sigue vigente y sigue siendo necesario? Si no →
> **se elimina**.

> **La segunda pregunta se aplica a TODO el documento, no solo a la parte que se
> viene a tocar.** Una actualización es también una oportunidad de podar.

---

## 4 · Tamaño y densidad

**Compacto a propósito.** No hay límite artificial de líneas, pero **todo
crecimiento debe estar justificado por estado vigente adicional, nunca por la
antigüedad del proyecto**.

**No se duplica** aquí lo que ya vive en otro sitio:

| No se copia                      | Se referencia       |
| -------------------------------- | ------------------- |
| ADR                              | El ADR              |
| Handoffs                         | El handoff          |
| Roadmap y criterios de cierre    | El roadmap          |
| Changelog                        | Git                 |
| Detalles internos de migraciones | La migración        |
| Resultados históricos de tests   | CI y Git            |
| Conversaciones y razonamientos   | El ADR o el handoff |

**Cuidado con los contadores.** Un número que cambia con cada test o cada fichero
—«116 tests», «8 checks»— **envejece en silencio** y obliga a actualizar el
documento por cosas que §3 dice expresamente que no lo justifican. Si un dato solo
se puede mantener incumpliendo §3, ese dato no pertenece a este documento.

Lo que sí pertenece es lo **estructural**: qué existe, qué garantiza y qué no se
puede romper.

---

## 5 · Cómo se carga contexto

**La forma canónica de orientarse en Nomey, en este orden:**

1. **`AGENTS.md`** — las reglas del repositorio.
2. **`docs/PROJECT_STATE.md`** — dónde está el proyecto.
3. **La documentación específica del bloque o fase en curso**, si existe.

**A partir de ahí se amplía solo según la necesidad concreta:**

| Necesitas…                     | Vas a…                                         |
| ------------------------------ | ---------------------------------------------- |
| Una decisión normativa         | El **ADR** correspondiente                     |
| Cómo se persiste algo concreto | La **migración** y las tablas implicadas       |
| Comportamiento de dominio      | El **módulo** y sus **vectores**               |
| Por qué CI hace algo           | El **workflow** o el **check** correspondiente |
| Una regla de producto          | La **sección** de `data-model.md`              |

> **No se cargan familias enteras de documentación «por si acaso».** Leer de más
> no es prudencia: consume atención, mezcla lo vigente con lo histórico y hace
> más probable actuar sobre una decisión ya superada.

En particular, **no hace falta leer de forma general**: todos los ADR · todas las
migraciones · todos los checks · todo `src/domain/` · todos los vectores · todos
los handoffs históricos.

**Salvo que la tarea sea transversal y lo exija explícitamente** — una auditoría
del modelo, una revisión de privilegios, un cambio que atraviese capas. Entonces
sí, y se dice por qué.

---

## 6 · Handoffs y fases cerradas

**Un handoff es documentación histórica y de consulta.** Explica **por qué** un
bloque quedó como quedó, y eso sigue teniendo valor — pero **deja de formar parte
del contexto inicial en cuanto su fase se cierra**.

**Al cerrar una fase:**

1. **registrar el cierre** donde corresponda —roadmap, y el propio handoff—;
2. **actualizar `PROJECT_STATE.md` sustituyendo** el estado anterior (§2);
3. **conservar el handoff** como evidencia histórica, marcado como tal;
4. dejar vigente **únicamente el punto de entrada de la fase siguiente**.

> **Las decisiones antiguas que sigan condicionando el proyecto aparecen
> CONDENSADAS en `PROJECT_STATE.md`, o referenciadas desde él.** Nunca se copia
> el handoff entero: si algo sigue siendo vigente, se dice en una línea; si hace
> falta el detalle, se va al handoff.

---

## 7 · Fuente de verdad

**Cada cosa tiene un sitio, y `PROJECT_STATE.md` no sustituye a ninguno:**

| Fuente                         | Qué es                                                |
| ------------------------------ | ----------------------------------------------------- |
| **ADR aceptado**               | La **decisión normativa**                             |
| **Código, migraciones, tests** | La **implementación** y el comportamiento verificable |
| **`PROJECT_STATE.md`**         | El **resumen del estado global vigente**              |
| **Handoff**                    | Evidencia y contexto detallado de un bloque           |
| **Git**                        | El **historial**                                      |

> **Si hay discrepancia entre el resumen y una fuente normativa, el resumen está
> mal.** No se modifica el ADR, la migración ni el test para que coincidan con
> `PROJECT_STATE.md`: se corrige el resumen, o se abre la discusión donde
> corresponda.

Una discrepancia es además una señal útil: casi siempre significa que algo
cambió y **no se sustituyó** en el snapshot (§2).
