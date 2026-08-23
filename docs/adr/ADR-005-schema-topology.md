# ADR-005 — Topología de schemas y frontera de la Data API

- **Estado:** Aceptado
- **Fecha:** 2026-08-23

## Contexto

Nomey habla directamente con PostgreSQL a través de la Data API de Supabase. No
hay servidor intermedio, así que **qué schemas quedan expuestos decide qué puede
alcanzar un cliente no confiable**, antes incluso de que entren en juego los
privilegios o la RLS.

Tres cosas ya decididas confluyen aquí:

- **[ADR-002](ADR-002-accounting-model.md) §7** — el cliente móvil no es la
  frontera autoritativa de escritura. Envía intención, no resultado contable, y
  **los roles cliente no tienen permisos de escritura sobre operaciones ni
  efectos**.
- **[ADR-003](ADR-003-money-representation.md) §6** — ningún importe monetario ni
  tipo de cambio cruza JSON como número.
- **`AGENTS.md` §4** — la autorización en base de datos es un conjunto de capas:
  schema expuesto, grants, RLS, privilegios de función y separación de claves. La
  RLS es la capa de fila, no el conjunto.

Y dos mediciones cambian el planteamiento de sitio:

- **E11** midió que exponer directamente una columna `BIGINT` o `NUMERIC` **no
  satisface la frontera exacta**: PostgreSQL y PostgREST conservan el valor, pero
  `JSON.parse` lo degrada en silencio, y lo determinante es el cast a texto y no
  el camino de acceso. Evidencia reproducible en
  [`supabase/e11/`](../../supabase/e11/README.md) y resultado normativo en
  ADR-003 §10.
- **E12**, la medición D4 de la Fase 3.C, encontró que una tabla creada en
  `public` nace con privilegios `TRUNCATE`, `REFERENCES`, `TRIGGER` y `MAINTAIN`
  para `anon` y `authenticated` sin que nadie los conceda, por una entrada de
  default privileges acotada a ese schema; una tabla creada en un schema propio
  nace sin ninguno. Evidencia en [`supabase/e12/`](../../supabase/e12/README.md).

De la primera se sigue una consecuencia que no depende de ninguna preferencia:
**si ninguna tabla de dominio puede exponerse tal cual, la superficie de la Data
API va a estar formada por vistas y funciones de todos modos.** En ese caso,
tener además las tablas dentro del schema expuesto no aporta nada, y sí aporta
superficie. La segunda refuerza por qué esa superficie conviene que no esté en
`public`.

## Decisión

**La persistencia del dominio vive fuera del schema expuesto, y la Data API se
alcanza únicamente a través de una superficie explícita.**

### 1. Topología

| Schema   | Papel                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core`   | **Persistencia real del dominio.** Todas las tablas de hechos contables                                                                                |
| `api`    | **Superficie explícita expuesta mediante la Data API**, para lecturas y escrituras autorizadas                                                         |
| `sec`    | **Helpers internos** de seguridad y autorización                                                                                                       |
| `public` | **No contiene la persistencia ni las tablas de dominio de Nomey**, ni su superficie de Data API, que pertenece a `api`. Sigue existiendo para el stack |

### 2. La regla que sostiene la topología

> **Las tablas contables reales no se exponen directamente mediante PostgREST.**

Cualquier acceso del cliente a datos de Nomey ocurre contra un objeto de `api`
creado a propósito para ello, y **no** contra una tabla de `core`.

### 3. Qué garantiza estructuralmente

- **ADR-002 §7** deja de depender de que los grants estén bien puestos sobre cada
  tabla: si la tabla no está en un schema expuesto, no hay ruta de escritura
  directa que revisar.
- **ADR-003 §6** deja de depender de la disciplina de quien escriba cada
  consulta: no existe una tabla expuesta capaz de emitir un `BIGINT` sin castear.
- **Los privilegios heredados de `public` medidos en E12 no alcanzan a las
  tablas de dominio**, porque ninguna vive en `public`. La contrapartida es
  simétrica y conviene enunciarla: **cualquier objeto que sí se coloque en
  `public` los heredará**, así que ponerlo ahí exige tratarlos de forma
  explícita.

### 4. Alcance exacto de esta decisión

**Este ADR cierra la topología y nada más.** Lo siguiente **no queda decidido**,
y sigue pendiente del diseño de la Fase 3.C:

- **Qué privilegios exactos reciben `authenticated`, `anon` u otros roles sobre
  `core`**, si es que reciben alguno.
- **Si las lecturas de `api` usan vistas con `security_invoker`.**
- **Si el mecanismo es de vistas, de funciones, de roles intermediarios o de otra
  forma.** La combinación «vistas `security_invoker` más cero privilegios de
  cliente sobre `core`» es una propuesta, no una decisión.
- **Cómo se resuelve la comprobación de membresía y la RLS.**
- **La estrategia concreta de `GRANT`** por rol y por tipo de objeto.
- **El mecanismo concreto de la frontera textual** que hace cumplir ADR-003 §6
  —vista, función, adaptador o combinación—.
- **Si `public` permanece o no dentro de `api.schemas`** en la configuración de
  PostgREST.
- **Si algún objeto técnico futuro de Nomey —una extensión, un artefacto de
  herramienta o de migración— puede vivir en `public`.** Lo que este ADR decide
  es dónde vive la **persistencia del dominio** y dónde vive la **superficie de
  la Data API**; **no** establece una prohibición universal sobre cualquier
  clase de objeto en `public`. Un caso así se juzga cuando exista, contra la
  topología y contra la herencia de privilegios de la §3.

> Una recomendación todavía abierta **no se convierte en decisión normativa** por
> aparecer en el análisis que precede a este ADR. Los puntos de arriba se
> deciden después, y si alguno resulta incompatible con esta topología, lo que
> corresponde es un ADR sucesor y no una lectura extensiva de este.

## Alternativas consideradas

**A · Todo en `public`, con grants estrictos y RLS.**

Es lo que deja preparado la plantilla del CLI y lo que hace la mayoría de los
proyectos Supabase. Sus ventajas son reales y cotidianas: el cliente funciona sin
configurar schema, la generación de tipos apunta a `public` por defecto, Studio
muestra las tablas donde uno las busca, y no hay que mantener ninguna superficie
intermedia.

**Descartada** porque no evita el trabajo que pretende evitar. Como ninguna tabla
con importes puede exponerse sin violar ADR-003 §6, la superficie de vistas y
funciones hay que escribirla igualmente; lo único que se conserva de propina son
las tablas dentro del schema expuesto, los privilegios heredados que E12 midió,
la posibilidad de un `GRANT` accidental y la tentación de leer la tabla directa
«solo para este caso».

**B · Híbrido: tablas en `public` con RLS, y vistas en un schema aparte solo para
lo monetario.**

Es la opción que aparece al querer la frontera textual sin pagar la mudanza.

**Descartada** porque conserva expuestas precisamente las tablas que la decisión
pretende sacar de la superficie, y además reparte el criterio: unas cosas se leen
por vista y otras por tabla, según qué columnas tengan. Un criterio que depende
del contenido de cada tabla se aplica mal en cuanto el esquema evoluciona.

**C · Dos schemas en vez de tres**, fundiendo los helpers de seguridad dentro de
`core`.

Es más simple y no cambia lo que el cliente alcanza. **Descartada** porque los
helpers de autorización son, por naturaleza, candidatos a `SECURITY DEFINER`, y
`AGENTS.md` §4 exige revisar cada uno como frontera de privilegio. Tenerlos en un
schema propio hace que **enumerar las fronteras de privilegio sea una consulta al
catálogo** en vez de una revisión de nombres dentro de un schema lleno de tablas.
El coste de la separación es un `create schema`.

## Consecuencias

### A favor

- **Las tablas reales quedan fuera de la superficie directa de PostgREST**, y eso
  no depende de que ningún grant esté bien puesto.
- **La Data API pasa a ser explícita y enumerable**: se puede listar y auditar por
  consulta al catálogo, que es lo que exige el criterio de cierre de la fase
  —comprobación por catálogo y no por revisión visual—.
- **Separa la persistencia del contrato externo.** Reorganizar una tabla interna
  no rompe al cliente mientras la superficie se mantenga.
- **Facilita garantizar ADR-002 y ADR-003 estructuralmente** en vez de por
  disciplina sostenida.
- **Reduce el riesgo de acceso accidental directo a tablas**, incluido el que
  llega por privilegios que nadie concedió.

### En contra

- **Aumenta el trabajo explícito**: cada vista y cada función hay que escribirla.
  Una tabla nueva no aparece sola en la superficie, y eso es deliberado pero
  cuesta.
- **La generación de tipos y el uso de `supabase-js` requerirán configuración**
  para apuntar a `api` en vez de a `public`. Hoy no cuesta nada porque la
  aplicación todavía no usa el cliente; es una obligación futura que queda
  anotada.
- **Depurar es menos directo.** Studio mira `public` por defecto, y las consultas
  manuales necesitan cualificar el schema.
- **El mecanismo seguro de `api` hacia `core` todavía debe diseñarse**, y es la
  parte con más riesgo de la decisión: una vista mal declarada puede saltarse la
  RLS de las tablas subyacentes sin que nadie lo advierta. Que este ADR no lo
  cierre es intencionado, pero significa que la topología por sí sola **no basta**
  para dar por segura la frontera.
