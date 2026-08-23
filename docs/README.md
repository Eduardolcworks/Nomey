# Documentación de Nomey

Wiki técnica y de producto. **En español**; el código y los commits van en
inglés.

> **Estado: Fase 3 — persistencia y frontera de datos.** En curso.
>
> - **Fases 0, 1 y 2:** cerradas.
>   [ADR-002](adr/ADR-002-accounting-model.md) está **aceptado**, y
>   `architecture/data-model.md` y `product/glossary.md` existen.
> - **Fase 3:** abierta, con **3.A y 3.B cerradas**.
>   [ADR-003](adr/ADR-003-money-representation.md) está **aceptado**: su puerta
>   **E11** se cumplió contra un stack Supabase local real, y `src/domain/` ya
>   contiene la implementación de referencia con sus vectores compartidos.
> - **En curso: 3.C** —esquema, grants, RLS y frontera de escritura—, que
>   arranca con análisis y no con SQL. Ver
>   [`architecture/phase-3c-handoff.md`](architecture/phase-3c-handoff.md) y el
>   análisis en curso, no normativo, de
>   [`architecture/phase-3c-design.md`](architecture/phase-3c-design.md).
>   Ya han salido de él dos decisiones aceptadas:
>   [ADR-004](adr/ADR-004-currency-definition-identity.md) —identidad física de
>   la definición monetaria— y [ADR-005](adr/ADR-005-schema-topology.md)
>   —topología de schemas—. **Todavía no se ha autorizado SQL definitivo.**
>
> El plan por fases, con sus hitos y criterios de cierre, está en
> [`product/roadmap.md`](product/roadmap.md).
>
> Buena parte de esta documentación **todavía no existe**. Las tablas de abajo
> distinguen lo que hay de lo que está previsto.

## Cómo se organiza

| Carpeta         | Qué contiene                                         | Estado     |
| --------------- | ---------------------------------------------------- | ---------- |
| `product/`      | Visión, glosario, roadmap                            | Parcial    |
| `requirements/` | Reglas de negocio por pilar                          | Fase 1     |
| `architecture/` | Visión técnica, modelo de datos, estructura, offline | Parcial    |
| `database/`     | Esquema, políticas RLS, migraciones                  | Fase 3     |
| `security/`     | Modelo de amenazas, tratamiento de datos             | Parcial    |
| `ux/`           | Design system, flujos                                | Fase 4     |
| `adr/`          | Architecture Decision Records                        | **Activa** |
| `runbooks/`     | Procedimientos operativos                            | Fase 1     |

## Documentos de mantenimiento obligatorio

Un cambio de código que los contradiga es un PR incompleto. **La obligación
aplica desde que el documento existe**; los marcados como previstos todavía no
se han escrito.

| Documento                        | Estado                                |
| -------------------------------- | ------------------------------------- |
| `architecture/data-model.md`     | Existe                                |
| `product/glossary.md`            | Existe                                |
| `architecture/code-structure.md` | **Previsto**                          |
| `database/rls-policies.md`       | **Previsto**                          |
| `security/threat-model.md`       | **Previsto**                          |
| Todos los ADR **aceptados**      | ADR-002 · ADR-003 · ADR-004 · ADR-005 |

## Documentos de trabajo — no normativos

Recogen un análisis en curso y **no obligan a nadie**. No son fuente normativa:
lo es el ADR correspondiente, cuando se acepta.

| Documento                                                                      | Fase | Qué es                                                                                                           |
| ------------------------------------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------- |
| [`architecture/money-representation.md`](architecture/money-representation.md) | 2    | Evidencia medida, decisiones confirmadas y alternativas descartadas que preceden a **ADR-003**. **No normativo** |
| [`architecture/phase-3c-handoff.md`](architecture/phase-3c-handoff.md)         | 3    | Traspaso de 3.B a 3.C: estado de entrada, decisiones cerradas y pendientes de 3.C. **No normativo**              |
| [`architecture/phase-3c-design.md`](architecture/phase-3c-design.md)           | 3    | Análisis de 3.C por bloques: D1–D11, evidencia E12 y alternativas. **No normativo**, también para lo ya aprobado |

Al aceptarse el ADR que lo cierra, se decide si el documento se conserva como
historial de análisis o se retira.

## Qué falta por escribir

- **`runbooks/local-setup.md`** — de cero a la app corriendo. Previsto desde la
  Fase 1 y todavía sin escribir.
- **`architecture/code-structure.md`**, **`database/rls-policies.md`** y
  **`security/threat-model.md`** — de mantenimiento obligatorio en cuanto
  existan.
- **ADR-003 ya está aceptado**, así que `architecture/data-model.md` y
  `product/glossary.md` deben incorporar el vocabulario de **definición
  monetaria** y las reglas de agregación y de moneda base que el ADR fija.

## Dónde está lo demás

- Plan por fases, hitos y criterios de cierre:
  [`product/roadmap.md`](product/roadmap.md)
- Reglas operativas para agentes y personas: [`AGENTS.md`](../AGENTS.md)
- Restricciones por capa: `README.md` dentro de cada carpeta de `src/`
- Estado de los assets: [`assets/README.md`](../assets/README.md)
- Estrategia de tests: [`tests/README.md`](../tests/README.md)
- Riesgos abiertos en dependencias:
  [`security/dependency-risks.md`](security/dependency-risks.md)
