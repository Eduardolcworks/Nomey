# Documentación de Nomey

Wiki técnica y de producto. **En español**; el código y los commits van en
inglés.

> **Estado: Fase 2 — representación del dinero.**
>
> - **Fase 0** (cimientos del repositorio) y **Fase 1** (modelo contable):
>   cerradas. [ADR-002](adr/ADR-002-accounting-model.md) está **aceptado**, y
>   `architecture/data-model.md` y `product/glossary.md` existen.
> - **Fase 2:** análisis completado.
>   [ADR-003](adr/ADR-003-money-representation.md) está en **`Propuesto`**, con
>   una puerta de aceptación explícita que no puede cumplirse hasta conectar
>   Supabase.
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

| Documento                        | Estado       |
| -------------------------------- | ------------ |
| `architecture/data-model.md`     | Existe       |
| `product/glossary.md`            | Existe       |
| `architecture/code-structure.md` | **Previsto** |
| `database/rls-policies.md`       | **Previsto** |
| `security/threat-model.md`       | **Previsto** |
| Todos los ADR **aceptados**      | ADR-002      |

## Documentos de trabajo — no normativos

Recogen un análisis en curso y **no obligan a nadie**. No son fuente normativa:
lo es el ADR correspondiente, cuando se acepta.

| Documento                                                                      | Fase | Qué es                                                                                                           |
| ------------------------------------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------- |
| [`architecture/money-representation.md`](architecture/money-representation.md) | 2    | Evidencia medida, decisiones confirmadas y alternativas descartadas que preceden a **ADR-003**. **No normativo** |

Al aceptarse el ADR que lo cierra, se decide si el documento se conserva como
historial de análisis o se retira.

## Qué falta por escribir

- **`runbooks/local-setup.md`** — de cero a la app corriendo. Previsto desde la
  Fase 1 y todavía sin escribir.
- **`architecture/code-structure.md`**, **`database/rls-policies.md`** y
  **`security/threat-model.md`** — de mantenimiento obligatorio en cuanto
  existan.
- Cuando **ADR-003** pase a `Aceptado`, `architecture/data-model.md` y
  `product/glossary.md` deberán incorporar el vocabulario de **definición
  monetaria** y las reglas de agregación y de moneda base que el ADR fija. **No
  antes**: mientras esté en `Propuesto` no es normativo.

## Dónde está lo demás

- Reglas operativas para agentes y personas: [`AGENTS.md`](../AGENTS.md)
- Restricciones por capa: `README.md` dentro de cada carpeta de `src/`
- Estado de los assets: [`assets/README.md`](../assets/README.md)
- Estrategia de tests: [`tests/README.md`](../tests/README.md)
- Riesgos abiertos en dependencias:
  [`security/dependency-risks.md`](security/dependency-risks.md)
