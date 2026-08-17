# Documentación de Nomey

Wiki técnica y de producto. **En español**; el código y los commits van en
inglés.

> Estado: el proyecto está al final de la **Fase 0** (cimientos del
> repositorio). La mayor parte de esta documentación aún no existe: se escribe
> en la Fase 1, antes de tocar la base de datos.

## Cómo se organiza

| Carpeta         | Qué contiene                                         | Estado     |
| --------------- | ---------------------------------------------------- | ---------- |
| `product/`      | Visión, glosario, roadmap                            | Fase 1     |
| `requirements/` | Reglas de negocio por pilar                          | Fase 1     |
| `architecture/` | Visión técnica, modelo de datos, estructura, offline | Fase 1     |
| `database/`     | Esquema, políticas RLS, migraciones                  | Fase 3     |
| `security/`     | Modelo de amenazas, tratamiento de datos             | Parcial    |
| `ux/`           | Design system, flujos                                | Fase 4     |
| `adr/`          | Architecture Decision Records                        | **Activa** |
| `runbooks/`     | Procedimientos operativos                            | Fase 1     |

## Documentos de mantenimiento obligatorio

Un cambio de código que los contradiga es un PR incompleto:

- `architecture/data-model.md`
- `architecture/code-structure.md`
- `database/rls-policies.md`
- `security/threat-model.md`
- `product/glossary.md`
- todos los ADR aceptados

## Los tres primeros a escribir (Fase 1)

1. **`architecture/data-model.md`** — la decisión más cara de revertir.
2. **`product/glossary.md`** — en Nomey, "gasto" significa tres cosas
   distintas: movimiento de caja, gasto real y deuda. Sin un glosario, esa
   ambigüedad acaba en los nombres de las tablas y en la UI.
3. **`runbooks/local-setup.md`** — de cero a la app corriendo.

## Dónde está lo demás

- Reglas operativas para agentes y personas: [`AGENTS.md`](../AGENTS.md)
- Restricciones por capa: `README.md` dentro de cada carpeta de `src/`
- Estado de los assets: [`assets/README.md`](../assets/README.md)
- Estrategia de tests: [`tests/README.md`](../tests/README.md)
- Riesgos abiertos en dependencias:
  [`security/dependency-risks.md`](security/dependency-risks.md)
