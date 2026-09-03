# Documentación de Nomey

Wiki técnica y de producto. **En español**; el código y los commits van en
inglés.

> **Estado: Fase 6 — Modo Personal. CERRADA el 2026-09-03 (bloques A … G),
> aprobada físicamente por el usuario en iOS y en Android.**
>
> - **Fases 0, 1, 2, 3, 4 y 5:** cerradas. **ADR-001 … ADR-024 aceptados.**
> - **F6.A** trajo la fundación de datos del Modo Personal: catálogo monetario
>   con identidades fijas, el tercer rol `nomey_provisioner` y el provisioning
>   del ámbito con su membresía. **Cerrado como fundamento backend**: la función
>   existe y es segura, y **la app todavía no la invoca** —ese cableado es de
>   F6.E—. La decisión es [ADR-019](adr/ADR-019-personal-provisioning.md); el
>   estado y las obligaciones de cada bloque,
>   [`architecture/phase-6-handoff.md`](architecture/phase-6-handoff.md).
> - **F6.B** dio anatomía al movimiento: concepto obligatorio, categorías con
>   catálogos separados de gasto e ingreso, hora efectiva, y el **ingreso como
>   clase real** —la octava función—. Cerró además la corrección cruzada de
>   clase. Decisiones: [ADR-020](adr/ADR-020-version-content-and-time.md) y
>   [ADR-021](adr/ADR-021-category-catalogue.md).
> - **F6.C** cerró el saldo objetivo, la observación histórica y la anulación:
>   el servidor deriva el delta bajo lock, cada escritura de saldo deja una
>   fotografía congelada que nunca alimenta el Disponible, y eliminar es una
>   versión sin efectos que no borra nada. Decisiones:
>   [ADR-022](adr/ADR-022-balance-target-and-serialization.md),
>   [ADR-023](adr/ADR-023-balance-observation.md) y
>   [ADR-024](adr/ADR-024-annulment.md).
> - **La Fase 5 cerró con sus cuatro criterios cumplidos**: registrarse, entrar,
>   salir y recuperar el acceso; sesión que sobrevive al reinicio y se renueva
>   sola; rutas protegidas inaccesibles sin sesión; y ninguna credencial privada
>   de backend en el bundle. **Entrar con Google y con Apple queda diferido**
>   hasta que existan sus prerrequisitos —development builds y cuentas de
>   desarrollador—, que introduce la Fase 8. Lo que la Fase 6 hereda está en
>   [`architecture/phase-5-handoff.md`](architecture/phase-5-handoff.md).
> - **Para reconstruir el estado del proyecto, empieza por
>   [`PROJECT_STATE.md`](PROJECT_STATE.md)**, que es la memoria comprimida: fase
>   actual, arquitectura vigente, superficie `api`, invariantes que no se deben
>   romper y decisiones aplazadas. Con `AGENTS.md` y ese documento basta para
>   empezar; el resto se consulta bajo demanda.
> - La auditoría que cerró el criterio 9 —cada concepto del modelo mapeado a
>   persistido, derivable, proyección, runtime o aplazado con su motivo— está en
>   [`architecture/model-coverage.md`](architecture/model-coverage.md).
>
> El plan por fases, con sus hitos y criterios de cierre, está en
> [`product/roadmap.md`](product/roadmap.md).
>
> Buena parte de esta documentación **todavía no existe**. Las tablas de abajo
> distinguen lo que hay de lo que está previsto.

## Cómo se organiza

| Carpeta         | Qué contiene                                         | Estado     |
| --------------- | ---------------------------------------------------- | ---------- |
| `product/`      | Visión, glosario, roadmap, dirección visual          | Parcial    |
| `requirements/` | Reglas de negocio por pilar                          | Fase 1     |
| `architecture/` | Visión técnica, modelo de datos, estructura, offline | Parcial    |
| `database/`     | Esquema, políticas RLS, migraciones                  | Fase 3     |
| `security/`     | Modelo de amenazas, tratamiento de datos             | Parcial    |
| `ux/`           | Design system, flujos                                | **Activa** |
| `adr/`          | Architecture Decision Records                        | **Activa** |
| `runbooks/`     | Procedimientos operativos                            | Parcial    |

## Documentos de mantenimiento obligatorio

Un cambio de código que los contradiga es un PR incompleto. **La obligación
aplica desde que el documento existe**; los marcados como previstos todavía no
se han escrito.

| Documento                        | Estado            |
| -------------------------------- | ----------------- |
| `PROJECT_STATE.md`               | Existe            |
| `architecture/data-model.md`     | Existe            |
| `architecture/model-coverage.md` | Existe            |
| `product/glossary.md`            | Existe            |
| `product/design-direction.md`    | Existe            |
| `architecture/code-structure.md` | **Previsto**      |
| `database/rls-policies.md`       | **Previsto**      |
| `security/threat-model.md`       | **Previsto**      |
| Todos los ADR **aceptados**      | ADR-001 a ADR-024 |

## Documentos de trabajo — no normativos

Recogen un análisis en curso y **no obligan a nadie**. No son fuente normativa:
lo es el ADR correspondiente, cuando se acepta.

| Documento                                                                      | Fase | Qué es                                                                                                           |
| ------------------------------------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------- |
| [`architecture/money-representation.md`](architecture/money-representation.md) | 2    | Evidencia medida, decisiones confirmadas y alternativas descartadas que preceden a **ADR-003**. **No normativo** |
| [`architecture/phase-3c-handoff.md`](architecture/phase-3c-handoff.md)         | 3    | Continuidad de 3.C y **el porqué** de cada pieza. **Histórico** desde el cierre de F3, y no normativo            |
| [`architecture/phase-3c-design.md`](architecture/phase-3c-design.md)           | 3    | Análisis de 3.C por bloques: D1–D11, evidencia E12 y alternativas. **No normativo**, también para lo ya aprobado |
| [`ux/phase-4-plan.md`](ux/phase-4-plan.md)                                     | 4    | Bloques de F4, decisiones que la abren y dirección **provisional** de navegación. **No normativo**               |
| [`architecture/phase-5-handoff.md`](architecture/phase-5-handoff.md)           | 5    | Lo que la Fase 6 hereda de la 5: qué existe, qué no se reabre y qué invariantes no romper. **No normativo**      |
| [`architecture/phase-6-handoff.md`](architecture/phase-6-handoff.md)           | 6    | Estado de la Fase 6 bloque a bloque, y las obligaciones que cada uno deja al siguiente. **No normativo**         |

Al aceptarse el ADR que lo cierra, se decide si el documento se conserva como
historial de análisis o se retira.

## Qué falta por escribir

- **`architecture/code-structure.md`**, **`database/rls-policies.md`** y
  **`security/threat-model.md`** — de mantenimiento obligatorio en cuanto
  existan.
- **ADR-003 ya está aceptado**, así que `architecture/data-model.md` y
  `product/glossary.md` deben incorporar el vocabulario de **definición
  monetaria** y las reglas de agregación y de moneda base que el ADR fija.

## Dónde está lo demás

- Plan por fases, hitos y criterios de cierre:
  [`product/roadmap.md`](product/roadmap.md)
- Dirección visual y estética, fuente de verdad única:
  [`product/design-direction.md`](product/design-direction.md)
- Montaje del entorno local y comando estándar de la Supabase CLI:
  [`runbooks/local-setup.md`](runbooks/local-setup.md)
- Reglas operativas para agentes y personas: [`AGENTS.md`](../AGENTS.md)
- Restricciones por capa: `README.md` dentro de cada carpeta de `src/`
- Estado de los assets: [`assets/README.md`](../assets/README.md)
- Estrategia de tests: [`tests/README.md`](../tests/README.md)
- Riesgos abiertos en dependencias:
  [`security/dependency-risks.md`](security/dependency-risks.md)
