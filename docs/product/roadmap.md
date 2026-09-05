# Roadmap de Nomey

> **Qué es este documento.** El plan por fases acordado para llevar Nomey desde
> los cimientos del repositorio hasta el lanzamiento público de la versión 1.0.
> Es la referencia de **secuencia, dependencias y criterios de cierre**.
>
> **Qué no es.** No es un ADR y no decide arquitectura, semántica contable ni
> producto. Cuando menciona una regla, la **referencia**; no la reinterpreta.
>
> **Si este documento contradice un ADR aceptado, manda el ADR** y el roadmap
> está mal. Las decisiones normativas viven en [`docs/adr/`](../adr/README.md),
> en [`data-model.md`](../architecture/data-model.md) y en
> [`glossary.md`](glossary.md).

Decisiones de referencia: [ADR-002 — Modelo contable](../adr/ADR-002-accounting-model.md) ·
[ADR-003 — Representación exacta del dinero](../adr/ADR-003-money-representation.md).

---

## Categorías

| Categoría         | Qué significa                                                                |
| ----------------- | ---------------------------------------------------------------------------- |
| `FUNDAMENTO`      | Infraestructura o decisión que sostiene lo que viene después. No es producto |
| `PRODUCTO`        | Capacidad que una persona usa                                                |
| `INTEGRACIÓN`     | Depende de un tercero: tienda, proveedor externo, plataforma nativa          |
| `PRE-LANZAMIENTO` | Auditoría y publicación                                                      |

---

## Alcance de la versión 1.0

**Nomey 1.0 se publica con las capacidades de las fases 0 a 17.** El MVP técnico
es un **hito interno de validación**, no el alcance de publicación.

Reabrir ese alcance exige una razón técnica, regulatoria o de producto
explícita, y se hace de forma expresa — no por deriva.

---

## Hitos

| Hito                             | Fase                           | Qué significa                                                                                |
| -------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| **Primer hito enseñable**        | cierre de F6                   | Modo Personal funciona. Hay algo que demostrar, aunque sea en emulador                       |
| **Inicio de beta cerrada**       | tras F9, recomendable tras F10 | Distribución controlada a personas seleccionadas                                             |
| **MVP técnico interno**          | cierre de F12                  | La propuesta principal está demostrada y puede probarse en serio. **No implica publicación** |
| **v1.0 funcionalmente completa** | cierre de F17                  | Todas las capacidades previstas para 1.0 están presentes                                     |
| **Endurecimiento**               | F18                            | Auditoría del sistema completo, con todo el alcance ya construido                            |
| **Lanzamiento público**          | F19                            | App Store y Google Play                                                                      |

**Sobre la beta.** Es técnicamente posible tras F9, pero una beta de gastos
compartidos donde todos los participantes deben tener cuenta prueba un producto
distinto del que se quiere construir: invitar a alguien que no ha instalado la
app es el caso de uso central. Esperar a F10 hace que la beta mida lo relevante.

> **Y, mientras F8.B esté aplazada, la beta sólo puede correr en Android.** No
> contradice ninguna dependencia —el hito pide distribución controlada, no
> paridad de plataformas— pero sí estrecha la mitigación que este documento se
> da a sí mismo en §Riesgo asumido. Su canal es **F8.C**, activable en cuanto
> haya testers reales.

---

## Fases

### Fase 0 — Cimientos del repositorio

`FUNDAMENTO` · **cerrada**

**Objetivo.** Dejar el repositorio en condiciones de recibir decisiones
documentadas y código revisable.

**Alcance.** Estructura por capas, reglas operativas para personas y agentes
(`AGENTS.md`), CI, convenciones de commits y ramas, auditoría de dependencias y
versión de Node fijada.

**Dependencias.** Ninguna.

**Cierre.** CI en verde sobre cada PR · dirección de dependencias entre capas
impuesta por ESLint, no por convención · `README.md` por capa · ADR-001
redactado.

**Puertas.** Ninguna.

---

### Fase 1 — Modelo contable y reglas de dominio

`FUNDAMENTO` · **cerrada**

**Objetivo.** Fijar qué es un hecho financiero en Nomey antes de tocar ninguna
base de datos.

**Alcance.** Operación y efecto, los tres ámbitos, clases contables,
participantes, deudas, liquidaciones, corrección por versionado, frontera de
confianza y permisos entre usuarios.

**Dependencias.** F0.

**Cierre.** [ADR-002](../adr/ADR-002-accounting-model.md) en estado `Aceptado` ·
[`data-model.md`](../architecture/data-model.md) y [`glossary.md`](glossary.md)
escritos y marcados de mantenimiento obligatorio.

**Puertas.** Ninguna abierta.

---

### Fase 2 — Representación exacta del dinero

`FUNDAMENTO` · **cerrada**

**Objetivo.** Decidir cómo se representa el dinero antes de que exista una
columna.

**Alcance.** Importe declarado autoritativo, definiciones monetarias, monedas
admitidas, tipo de cambio, orden de conversión y reparto, redondeo,
serialización y comportamiento ante correcciones y entrada sin conexión.

**Dependencias.** F1.

**Cierre.** [ADR-003](../adr/ADR-003-money-representation.md) redactado en estado
`Propuesto` · evidencia E1–E15 registrada en
[`money-representation.md`](../architecture/money-representation.md), documento
de trabajo **no normativo**.

**Puertas.** ADR-003 **no pasa a `Aceptado`** hasta cumplir su puerta de
aceptación, que se ejecuta en F3.

---

### Fase 3 — Persistencia y frontera de datos

`FUNDAMENTO` · **CERRADA el 2026-08-27** · 3.A, 3.B y 3.C **cerradas**

**Objetivo.** Construir la primera capa de persistencia real, segura y
reproducible, y cerrar la puerta de aceptación de ADR-003.

**Alcance.** Se ejecuta en tres subfases.

**3.A — Entorno, E11 y resolución de ADR-003.**
Entorno Supabase local reproducible, `supabase init`, y el experimento **E11**
sobre la frontera `BIGINT` / `NUMERIC` → PostgREST → `supabase-js` → TypeScript.
Termina con ADR-003 aceptado, enmendado o sustituido.

**3.B — Núcleo `domain/` y vectores de prueba.**
`Money`, `ExchangeRate`, reparto por mayor resto, balances y liquidación como
funciones puras, con runner de tests y los vectores derivados de
[`data-model.md`](../architecture/data-model.md) §4. La identidad de la
definición monetaria se trata como **opaca**: ligarla a una representación
concreta es una decisión de 3.C.

**3.C — Esquema, RLS y frontera de escritura.**
Esquema físico, migraciones, grants mínimos, políticas RLS, Auth técnico con
usuarios reales, función de escritura idempotente y tipos generados. El núcleo
—operación, efecto, ámbito, definición monetaria— se diseña sabiendo que hay
**tres** ámbitos; las tablas de Grupo y de Modo Pareja llegan en sus fases, por
migración.

**Dependencias.** F2 · Docker y entorno local operativo · aprobación explícita
para `supabase init`, exigida por `.claude/agents/data-architect.md`.

**Cierre.**

1. Desde un clon limpio y siguiendo solo el runbook, se levanta el stack y se
   reconstruye **todo** el esquema con migraciones, sin pasos manuales.
2. **E11 medido y publicado**, y ADR-003 en estado definitivo con justificación.
3. Ninguna tabla alcanzable desde el cliente sin RLS, verificado por consulta al
   catálogo y no por revisión visual.
4. Los tests de aislamiento pasan y **fallan** al relajar una política a
   propósito.
5. Ningún rol cliente tiene `INSERT`, `UPDATE` ni `DELETE` sobre operaciones ni
   efectos, y hay un test que lo demuestra.
6. El cálculo de reparto de `domain/` y el del servidor producen resultados
   idénticos sobre los vectores compartidos, como exige ADR-002 §7.
7. `src/types/database.ts` regenerado, nunca escrito a mano, y commiteado junto
   al SQL.
8. `npm run verify` en verde y CI ejecutando migraciones desde cero.
9. Cada concepto de `data-model.md` mapeado a: hecho persistido · derivable ·
   vista · temporal · o **decisión aplazada con su motivo**.

**Los nueve quedaron cumplidos el 2026-08-27**, con `main` en `3787901`:

| #   | Evidencia                                                                                           |
| --- | --------------------------------------------------------------------------------------------------- |
| 1   | Dos `db reset` consecutivos por la vía del runbook, resultado idéntico, sin pasos manuales          |
| 2   | [`supabase/e11/`](../../supabase/e11/README.md) · ADR-003 `Aceptado`, con ADR-015 superseding su §4 |
| 3   | `split-conversion.sql` A2 recorre **todas** las tablas de `core` por catálogo                       |
| 4   | Sección G de `split-conversion.sql` y las regresiones deliberadas de los checks del writer          |
| 5   | `authoritative-writer-debt.sql` A7, y el check HTTP comprueba además que `core` no tiene ruta       |
| 6   | **22/22** vectores de reparto y **19/20** escenarios; el restante, aplazado por diseño (§ FX)       |
| 7   | `src/types/database.ts` generado sobre `api`, con las siete funciones                               |
| 8   | `npm run verify` verde y CI reconstruyendo desde cero en cada PR                                    |
| 9   | [`model-coverage.md`](../architecture/model-coverage.md), la auditoría completa                     |

> **El criterio 6 se satisface con 19 ejecutables + 1 aplazado justificadamente,
> y no se presenta como 20/20.** El escenario restante exige una resolución
> autoritativa de FX que **ADR-003 §4 deja fuera de alcance y ADR-009 §8 declara
> decisión de producto pendiente**. La frontera lo **rechaza** explícitamente con
> `CURRENCY_CONVERSION_UNSUPPORTED · 422` en vez de resolverlo mal, y el check
> falla si el recuento deja de ser exactamente 19.

**Añadido al cerrar, y no estaba en la lista:** la frontera completa se ejerce
**por HTTP con JWT real** —Kong, GoTrue, PostgREST, `api`, writer y RLS— en
[`scripts/http-boundary-check.sh`](../../scripts/http-boundary-check.sh). Todo lo
demás simula la identidad con `set_config`, que no puede demostrar que un token
emitido por Auth resuelva a `authenticated`. Es la única razón por la que el
stack de CI dejó de excluir GoTrue.

**Puertas.**

- **3.A · E11 → ADR-003.** Puerta dura. **Cumplida el 2026-08-19**; ADR-003
  quedó `Aceptado`. Evidencia reproducible en
  [`supabase/e11/`](../../supabase/e11/README.md).
- **3.B · cerrada el 2026-08-20.** `src/domain/` implementado como
  implementación de referencia pura, con vectores compartidos en
  `tests/vectors/` y 110 tests en verde. **La frontera de escritura autoritativa
  de 3.C deberá reproducir esos vectores exactamente** (ADR-002 §7).
- **3.C · arranca con análisis del Data Architect, no con SQL.** Ver
  [`architecture/phase-3c-handoff.md`](../architecture/phase-3c-handoff.md).
- **3.C · las seis puertas están cerradas**, con ADR aceptado cada una:
  identidad de la definición monetaria (ADR-004) · esquema expuesto por la Data
  API (ADR-005, ADR-006 §6) · estrategia de `GRANT` (ADR-006) · comprobación de
  membresía en RLS (ADR-007) · mecanismo de idempotencia del **origen cliente**
  (ADR-010, ADR-011 §5) · **frontera textual** que hace cumplir T7 de ADR-003,
  que E11 dejó abierto y que ADR-008 §1-§2 resuelve como vista `security_invoker`
  de `api` que proyecta texto. Detalle en
  [`architecture/phase-3c-handoff.md`](../architecture/phase-3c-handoff.md) §2.
- **La entrada que quedaba sin conclusión ya la tiene.** E11 observó que `anon` y
  `authenticated` aparecen con `REFERENCES`, `TRIGGER` y `TRUNCATE` sobre tablas
  nuevas de `public` sin que se les conceda nada. **E12 lo midió**: proceden de
  los default privileges de Supabase, son **ejecutables**, y `MAINTAIN` es
  además **invisible para `information_schema`**. ADR-006 §7 fija su saneamiento
  explícito.
- **Cerrado el 2026-08-25 por ADR-014:** `public` **no** forma parte de los
  schemas expuestos. La lista queda `["api", "graphql_public"]`, y el cambio de
  `config.toml` se aplica **en el mismo commit que cree el schema `api`**,
  porque PostgREST no arranca si el schema no existe.

---

### Fase 4 — Arquitectura UX e internacionalización

`FUNDAMENTO`

**Objetivo.** Fijar el marco visual, de navegación y de textos antes de la
primera pantalla de producto, sin construir un design system especulativo.

**Dirección visual.** La estética de Nomey —minimalista, oscura, premium, con
glassmorphism como recurso de profundidad y neumorfismo solo como matiz táctil—
está fijada en [`design-direction.md`](design-direction.md), que es su **fuente
de verdad única**. F4 la convierte en principios, wireframes, tokens y tema; **no
la redefine**.

**Alcance.** Arquitectura de navegación y jerarquía principal · flujos
fundamentales derivados de [`data-model.md`](../architecture/data-model.md) §4 ·
estructura de las pantallas principales a nivel de wireframe · principios
visuales y tokens de tema, sobre el `src/ui/theme` existente · estados de carga,
vacío y error · infraestructura de i18n en español e inglés.

**Fuera de alcance.** Biblioteca de componentes completa, consolidación del
design system y el flujo detallado de entrada rápida, que se diseña contra una
feature escribible real en F7.

**Dependencias.** Ninguna sobre F3: puede ejecutarse en paralelo con 3.C.

**Cierre.**

1. El esqueleto de navegación compila y navega.
2. Los estados de carga, vacío y error renderizan y son reutilizables.
3. Ninguna cadena visible está incrustada en lógica ni en componentes; todas son
   extraíbles, según `AGENTS.md` §6.
4. Ningún símbolo de moneda ni formato de fecha está hardcodeado.

**Puertas.** Ninguna.

---

### Fase 5 — Identidad y sesión

`FUNDAMENTO`

**Objetivo.** Que la app sepa quién es el usuario, sobre el Auth técnico que ya
existe desde 3.C.

**Alcance.** Registro, inicio de sesión, recuperación, perfil, ciclo de vida de
la sesión sobre almacenamiento seguro y rutas protegidas.

**Dependencias.** F3.C (Auth técnico y RLS) · F4 (esqueleto y textos).

**Cierre.**

1. Un usuario puede registrarse, entrar, salir y recuperar el acceso.
2. La sesión sobrevive al reinicio de la app y se renueva sola.
3. Las rutas protegidas son inaccesibles sin sesión.
4. Ninguna credencial de backend está presente en el bundle, según `AGENTS.md`
   §7.

**Los cuatro quedaron cumplidos el 2026-08-28:**

| #   | Evidencia                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Recorrido físico completo en iPhone, sobre un solo build: alta, confirmación, login, cierre de sesión y recuperación                                                                                                                                                                                                          |
| 2   | Dos evidencias distintas: la **persistencia y su restauración**, validada físicamente matando y reabriendo la app sin cerrar sesión; y la **renovación automática**, cubierta por `tests/lib/session-lifecycle.test.ts` —«refresco atado al AppState»— y por `tests/lib/supabase-client.test.ts`, que fija `autoRefreshToken` |
| 3   | `tests/infra/route-guards.test.ts`, y en dispositivo: sin sesión la rama protegida deja de existir, no queda tapada                                                                                                                                                                                                           |
| 4   | Tres capas: fuente versionada, validación en ejecución y [`scripts/bundle-secrets-check.sh`](../../scripts/bundle-secrets-check.sh) sobre el artefacto exportado                                                                                                                                                              |

> **Entrar con Google y con Apple queda DIFERIDO, y no es criterio de cierre de
> esta fase.** Se añadió como requisito de producto a mitad de fase y **no forma
> parte de su alcance ni de sus cuatro criterios**, así que no se incorpora
> retroactivamente como un quinto. Sigue siendo una capacidad de autenticación
> pendiente, no descartada.
>
> Lo que la difiere es una dependencia real: **el inicio de sesión nativo de
> Google no funciona en Expo Go y exige un development build**, y Apple exige el
> programa de desarrollador. Las dos capacidades —**development builds** y
> **cuentas de desarrollador**— las introduce **F8**. Se ejecutará cuando esos
> prerrequisitos existan, sin reabrir la Fase 5.

**Puertas.** Ninguna.

---

### Fase 6 — Modo Personal

`PRODUCTO` · **primer hito enseñable**

**Objetivo.** El primer ámbito completo y usable.

**Alcance.** Ingresos, gastos, categorías, listado e historial, corrección por
versionado del propio registro, y saldo derivado. El sistema de diseño crece
aquí, a partir de un caso real.

**Dependencias.** F5.

**Cierre.**

1. Registrar, consultar y corregir un ingreso y un gasto de principio a fin.
2. La corrección crea una versión nueva y **no muta** la anterior, según ADR-002
   §6.
3. El saldo y las estadísticas se **derivan** de la versión vigente; no hay saldo
   almacenado como segunda fuente de verdad.
4. Solo `ingreso` y `gasto` alimentan estadísticas, según ADR-002 §4.
5. Los tests de dominio de los importes implicados están escritos en el mismo PR
   que la lógica, según [`tests/README.md`](../../tests/README.md).

**Puertas.** Ninguna.

---

### Fase 7 — Entrada rápida, offline y sincronización

`PRODUCTO`

**Objetivo.** Cumplir el tercer pilar del producto y validar el diseño de
idempotencia mientras la superficie de escritura es todavía una sola.

**Alcance.** Un recorrido de alta **corto y continuo, con aparición inmediata**
dentro de la app, interfaz optimista, cola de escritura sin conexión, reintentos
sobre la clave de idempotencia definida en 3.C, y el conflicto de sincronización
descrito en ADR-003 §7.

> **«En el orden de cinco segundos» era una descripción del concepto**, no un
> umbral de aceptación. Cronometrarlo habría medido el teclado del aparato y la
> longitud del concepto que a alguien le apeteciera escribir, no si el recorrido
> es bueno. Lo que sí se exige es lo que se puede comprobar mirando: que no haya
> pasos de más, que nada espere a la red y que el movimiento aparezca en cuanto
> se guarda.

**Dependencias.** F6 · mecanismo de idempotencia decidido en 3.C.

**Cierre.**

1. Un gasto ordinario se registra **en un recorrido corto y continuo**: se abre
   la hoja, se escribe la cantidad, se elige la categoría y se guarda, sin pasos
   intermedios y **sin esperar a la red**. Hay una prueba funcional del
   recorrido, y el movimiento **aparece de inmediato** al guardarse.
2. Sin red, la operación se encola y se sincroniza al recuperar conexión.
3. **Reproducir la misma operación no crea un segundo registro**, verificado con
   un test, según el invariante 19 de `data-model.md`.
4. Una operación creada bajo una configuración monetaria anterior **no se
   reinterpreta en silencio**, según ADR-003 §7.
5. Un rechazo demostrado se resuelve **desde la campana y sin vocabulario
   interno**, y un fallo transitorio no genera aviso ninguno.

**Puertas.** Ninguna.

---

### Fase 8 — Distribución interna y entornos

`FUNDAMENTO`

**Objetivo.** Poder poner la app en un dispositivo real, de forma repetible, y
fijar el modelo de build antes de que condicione todo lo demás.

**Alcance.** EAS, entornos de desarrollo y staging, firma, cuentas de
desarrollador, TestFlight y Play Internal Testing, y development builds.

**Desbloquea, además, algo ya diferido.** Los development builds y las cuentas
de desarrollador son los prerrequisitos del inicio de sesión nativo con Google y
Apple, diferido en F5. Esta fase no lo implementa: lo hace ejecutable.

**Por qué aquí y no al final.** Las notificaciones de F9 requieren un
development build; no funcionan completas en Expo Go. Y resolver cuentas, firma
y revisión con meses de margen elimina el riesgo de descubrirlo en la semana del
lanzamiento.

**Dependencias.** F6, para tener algo que distribuir.

**Cierre.** Los cuatro criterios son los originales de la fase y **no se
reescriben ni se reinterpretan**:

1. Un build de desarrollo se instala en un dispositivo físico Android y en uno
   iOS.
2. Existe al menos un entorno distinto del local, y el cambio entre entornos es
   configuración, no código.
3. Un tester externo recibe una build por el canal correspondiente.
4. Ninguna clave de backend viaja en el bundle.

**Puertas.**

- ~~**ADR de código nativo:** CNG con config plugins, o prebuild versionado.~~
  **Resuelta el 2026-09-04 por [ADR-030](../adr/ADR-030-native-code-model.md):
  CNG con config plugins**, sin versionar `/ios` ni `/android`, con el código
  nativo propio expresado como plugin local versionado. Abandonar el modelo
  exige un ADR nuevo que demuestre una limitación material.

#### La fase se ejecuta en tres bloques, y no cierra con el primero

La cuenta de desarrollador de Apple **se contrata al terminar F13 y antes de
empezar F14**, porque es Premium quien necesita la integración real con las
tiendas. Esa secuencia parte la fase, y la partición es de **ejecución**: los
cuatro criterios siguen siendo los de arriba.

| Bloque   | Qué contiene                                                                                                                              | Cuándo                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **F8.A** | Decisiones, contrato de entornos, toolchain, build propia de Android, Staging actualizable y validación funcional en Android              | **Ahora**                           |
| **F8.B** | Apple Developer, firma y credenciales de iOS, registro del dispositivo, build en el iPhone, TestFlight o ad hoc, y las deudas físicas iOS | **Puerta obligatoria antes de F14** |
| **F8.C** | Google Play y canal de beta de Android                                                                                                    | Cuando exista una beta real         |

##### F8.A, bloque a bloque

La subdivisión F8.A0–F8.A5 se formalizó durante F8.A4 para hacer explícita la
secuencia de entrega. **A0–A3 describen trabajo ya fusionado; A4 y A5 delimitan
el trabajo pendiente.**

| Sub-bloque | Qué es                                                     | Estado      |
| ---------- | ---------------------------------------------------------- | ----------- |
| **F8.A0**  | Decisiones: ADR-030 y ADR-031, y la partición A/B/C        | **Cerrado** |
| **F8.A1**  | Contrato de entornos ejecutable y EAS Update               | **Cerrado** |
| **F8.A2**  | Cadena nativa, CNG y assets técnicos                       | **Cerrado** |
| **F8.A3**  | Primera development build de Android, instalada y validada | **Cerrado** |
| **F8.A4**  | Validación funcional dentro de la development build        | **Cerrado** |
| **F8.A5**  | Primera build de Staging y su canal                        | **Cerrado** |

**F8.A0 — decisiones.** [ADR-030](../adr/ADR-030-native-code-model.md), que
cumple la puerta de código nativo de esta fase, y
[ADR-031](../adr/ADR-031-environments-and-variants.md), el contrato de entornos.
Partió la fase en A/B/C sin reescribir los cuatro criterios.

**F8.A1 — contrato ejecutable.** Las tres variantes en `app.config.ts` con su
identidad y su canal, `runtimeVersion` con política `appVersion`, el selector
multiplataforma de variante, la configuración de Staging en el entorno EAS
`preview`, y la guarda del bundle corriendo en CI sobre las tres variantes con
un secreto sembrado que la hace fallar.

**F8.A2 — cadena nativa.** JDK 17, SDK Platform 36 y command-line tools con sus
variables persistentes; `prebuild` de Development verificado sin edición manual;
y los assets de icono medidos por geometría en vez de por hash.

**F8.A3 — la build propia.** `expo-dev-client`, compilación local con Gradle
—nunca EAS Build— para x86_64 y arm64-v8a, instalada y ejecutada **fuera de Expo
Go** en el emulador y en un Android físico, con Metro conectada y recarga
demostrada. Saldó la mitad Android de la comprobación visual que F4 dejó
pendiente. Detalle en
[`runbooks/android-build.md`](../runbooks/android-build.md).

**F8.A4 — validación funcional.** Demostrar que la development build se comporta
como aplicación nativa completa, no volver a validar compilación, icono ni
splash. Su alcance se apoya en
[`phase-7-handoff.md`](../architecture/phase-7-handoff.md) **§4** —la matriz que
F7 validó en Expo Go y que aquí se reproduce dentro del binario propio— y en las
obligaciones de su **§5**. Cubre, además de esa matriz:

1. Alta, acceso y sesión de un actor local desechable, con la sesión
   sobreviviendo a un cierre en frío por **SecureStore** y no por memoria.
2. **Cierre de sesión** y reapertura, comprobando que las credenciales se
   eliminan de verdad.
3. Gasto e ingreso conectados, con sus cifras, filas, orden, categorías y
   persistencia contra el servidor.
4. Registro **sin conexión** con proyección inmediata y sin marcas de pendiente,
   que sobrevive a cerrar y reabrir la aplicación sin servidor.
5. **Sincronización** al volver el servidor sin que ninguna cifra salte, ninguna
   fila desaparezca o se duplique, y con **una sola operación remota por clave**.
6. **Aislamiento entre actores**: cambiar de actor no contamina snapshot, cola ni
   proyección.
7. **Incidencias** de
   [ADR-029](../adr/ADR-029-incident-labels-and-review-destination.md), con
   regreso a un estado estable. La forma **ordinaria** —`Sí` y `No`— se ejercita
   a mano dentro de la build; la **excepcional** no, y conviene separar por qué.

   **La forma excepcional no tiene ruta desde la interfaz, y eso es correcto.**
   Sus dos disparos son condiciones del servidor que el cliente no puede
   producir: `conflict` nace de `CURRENCY_CONVERSION_UNSUPPORTED`, que exige una
   definición monetaria distinta de la del ámbito —el cliente sólo ofrece EUR, y
   la moneda base es inmutable en cuanto hay efectos (ADR-013, FK compuesta)—; y
   `review` nace de `IDEMPOTENCY_KEY_REUSED`, que exige reutilizar una clave,
   precisamente lo que el cliente evita generando un UUID nuevo por intención.

   **Pero «sin ruta manual» no es «sin probar», y aquí sí está probada.** La
   cadena entera está cubierta y es verificable:

   | Eslabón                         | Dónde                                                                                   |
   | ------------------------------- | --------------------------------------------------------------------------------------- |
   | La frontera produce los códigos | `scripts/offline-taxonomy-probe.sh`, contra el stack real: `409` y `422` medidos        |
   | El cliente los clasifica        | `tests/lib/offline-response.test.ts` → `review` y `conflict`                            |
   | Presentación                    | `tests/lib/personal-incidents.test.ts` §10 y §14 — forma, frases y destino de `Revisar` |
   | Persistencia                    | ídem §3 —la incidencia **es** la fila— y §12, por actor                                 |
   | Resolución                      | ídem §8 y §11; `tests/lib/personal-incident-flows.test.ts` §1, §4 y §5                  |

   **No se traslada a ninguna fase**, y en particular **no a F11**: el alcance de
   F11 es multimoneda —tipos, conversión, jerarquía visual y conflicto de moneda
   base— y ninguno de sus cinco criterios de cierre habla de las formas de la
   incidencia. Asignárselo sería darle trabajo nuevo por conveniencia. Lo único
   que F8.A4 no afirma es haberla pulsado a mano en el aparato.

No entra: Staging, su canal, EAS Update, la distribución a nadie, y cualquier
cosa de iOS.

**F8.A5 — Staging.** La primera build de Staging **independiente de Metro**, su
canal `staging` y su entorno EAS `preview`. Cierra con:

1. APK de **release** con la identidad de Staging —`Nomey Staging`,
   `es.lcworks.nomey.staging`, `nomey-staging`—, compilado **localmente**: ADR-031
   §5 descarta EAS Build, así que no hay cola, cuota ni coste.
2. Instalado **junto a** Nomey Dev, sin sustituirla, y arrancando **con Metro
   detenido**: alta, lectura y una operación real contra el stack local.
3. El canal `staging` existe y apunta sólo a su rama.
4. Una actualización **compatible** llega al binario sin reinstalarlo, y
   **persiste** al cerrar y reabrir.
5. Una actualización de **runtime incompatible** —`1.0.1` contra un binario
   `1.0.0`— **no se aplica**, y no en silencio: sencillamente no la recibe.
6. **Development no recibe nada** de ese canal: no lo declara.
7. El bundle no lleva secretos ni valores de otro entorno.

**Lo que NO cierra, y sigue escrito como pendiente.** El backend de Staging es el
**mismo stack local**, alcanzado por `adb reverse` sobre `127.0.0.1`. Eso lo hace
independiente de la red pero **no** de este ordenador, así que el **criterio 2 de
la Fase 8 sigue abierto** — ADR-031 §4, que no se reinterpreta.

**La firma tampoco es de producción.** El APK va firmado con el **keystore de
depuración** que genera la plantilla, cuyo certificado es público y compartido
por cualquiera que use CNG. Sirve para distribución interna y **no** para Google
Play; la firma del paquete de producción se decide en **F8.C**, y el paquete
`.staging` es independiente del de producción.

**F8.A puede cerrarse como bloque parcial. La Fase 8 sigue abierta** mientras
queden criterios originales sin cumplir. Estado por criterio:

| Criterio | Estado                                                                                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**    | **Mitad Android CUMPLIDA** desde F8.A3: build propia instalada y validada en un POCO X4 Pro 5G y en el emulador. **La mitad iOS es de F8.B**                           |
| **2**    | **Pendiente.** Staging apunta provisionalmente al stack local, que **no** es un entorno distinto del local — [ADR-031](../adr/ADR-031-environments-and-variants.md) §4 |
| **3**    | **Pendiente.** Se marcará cuando exista un tester externo real; no se da por hecho con una entrega simulada                                                            |
| **4**    | **Cubierto en Android** por F8.A, con las tres capas ya existentes. Se revalida en F8.B sobre el artefacto de iOS                                                      |

**F8.B no es opcional y no puede desaparecer.** Es puerta de F14 por la
dependencia que esa fase ya declara —«F8, por las cuentas de tienda»— y absorbe
dos deudas anteriores: la mitad iOS de la comprobación pendiente de F4 —icono,
máscara, splash, transición nativa y ausencia de destello— y la obligación que
F7 dejó escrita, reproducir su secuencia completa en un dispositivo iOS.

**Lo que F8.B no bloquea.** F9 a F13 no declaran ninguna dependencia de iOS, de
una cuenta de desarrollador ni de una tienda, y ninguno de sus criterios de
cierre las nombra. Pueden avanzar con F8.B aplazada. Dos avisos, escritos para
que la decisión sea consciente y no una omisión:

- **La puerta de F9 puede adelantar F8.B.** Si «notificación» se resuelve como
  push, iOS necesita APNs y APNs necesita la cuenta de Apple. Esa puerta debe
  resolverse sabiendo que F8.B está aplazada.
- **La beta cerrada queda sólo en Android** mientras F8.B no se ejecute. No
  contradice ninguna dependencia, pero **debilita la mitigación** que este
  roadmap se da a sí mismo en §Riesgo asumido.

**Decidido en F8.A y ejecutado más adelante.** ADR-030 §5 deja fijado que Nomey
llevará **dos iconos de aplicación** —el amarillo por defecto y el negro como
distintivo de Premium—, que los dos son recursos nativos y que **tienen que
estar dentro del binario antes de la primera publicación**, porque EAS Update no
añade recursos nativos. **El selector, los entitlements y el cambio de icono son
trabajo de F14**, no de esta fase.

---

### Fase 9 — Grupos, gastos compartidos y deudas

`PRODUCTO` · _beta cerrada posible desde aquí_

**Objetivo.** El segundo pilar, en su forma básica y ya utilizable.

**Alcance.** Grupos · miembros con cuenta · gasto con pagador único y
participantes seleccionados **por operación**, no por pertenencia · reparto
`equal` con reparto del resto · deudas derivadas · marcar deuda saldada con
pagos parciales · **atribución, historial y notificación**.

**Sobre la notificación.** No es una comodidad: el invariante 15 de
`data-model.md` la exige para toda operación con efectos financieros sobre otro
usuario, y ADR-002 la incluye entre las cinco capas que sustituyen a la
confirmación previa. Un grupo sin notificación es el modelo de efecto inmediato
sin su contrapeso.

**Dependencias.** F7 · **F8.A**, por el development build que las
notificaciones necesitan. F8.B no bloquea esta fase salvo que su puerta se
resuelva como push, porque entonces iOS necesitaría APNs y la cuenta de Apple.

**Cierre.**

1. Los escenarios 4.2 a 4.5 de `data-model.md` se reproducen en la app y
   coinciden con lo documentado.
2. El resultado financiero **no depende de quién registre** la operación, según
   el invariante 10.
3. El gasto económico corresponde a **todos** los participantes, no solo al
   pagador, según el invariante 9.
4. Toda operación con efectos sobre otro usuario queda atribuida y genera
   notificación.
5. El reparto del resto es determinista y reproducible en dos dispositivos
   distintos.

**Puertas.**

- **Qué significa «notificación»:** si basta con avisar dentro de la app o exige
  notificación push. ADR-002 dice que el afectado _se entera en el momento_, y de
  esa lectura depende si entra una infraestructura más.

---

### Fase 10 — Participantes sin cuenta

`PRODUCTO` · _beta cerrada recomendable desde aquí_

**Objetivo.** Que un grupo funcione con gente que todavía no ha instalado
Nomey, sin abrir un agujero de seguridad.

**Alcance.** Invitación, prueba de autorización, reclamación retroactiva sin
pérdida de historial, y fusión de participantes duplicados.

**Dependencias.** F9 · **ADR propio**: `AGENTS.md` §5 fija tres invariantes y
deja abierto **todo** el mecanismo, y `docs/adr/README.md` califica este tema
como el de mayor riesgo de seguridad del producto.

**Cierre.**

1. Un participante puede figurar en gastos antes de existir como usuario.
2. Al vincularlo con una cuenta, **no se pierde ningún** gasto, participación,
   deuda ni registro anterior.
3. Reclamar un participante exige prueba de autorización; una coincidencia de
   nombre o de correo no verificado **no basta**.
4. Existe un test que intenta una reclamación no autorizada y falla.

**Puertas.** El ADR de invitación y reclamación debe estar aceptado antes de
implementar.

---

### Fase 11 — Multimoneda operativa

`PRODUCTO`

**Objetivo.** Que un viaje con gastos en otra moneda funcione de verdad.

**Alcance.** Fuente de tipos de cambio con **histórico consultable por fecha
efectiva** · conversión en la app · jerarquía visual del importe original frente
al derivado · conflicto de sincronización cuando cambia la moneda base.

**Dependencias.** F9 · ADR-003 aceptado · proveedor de tipos contratado o
elegido. **El hilo de selección de proveedor conviene abrirlo en F9**, porque es
una dependencia externa.

**Cierre.**

1. Un gasto declarado en otra moneda conserva su importe original y muestra el
   derivado de forma secundaria, según ADR-003 §1.
2. La conversión ocurre **una vez** y el reparto se calcula después, en la moneda
   del ámbito.
3. El tipo aplicado corresponde a la **fecha efectiva** del hecho, no al momento
   de sincronización.
4. Un tipo congelado no se actualiza solo; cambiarlo exige corrección explícita.
5. No se agregan importes de definiciones monetarias distintas sin conversión
   explícita previa.

**Puertas.**

- **Proveedor de tipos de cambio.** Su granularidad y su histórico condicionan
  la política de selección que ADR-003 dejó abierta.

---

### Fase 12 — Capacidades compartidas avanzadas

`PRODUCTO` · **MVP técnico interno**

**Objetivo.** Cubrir la cola larga del modelo compartido.

**Alcance.** `shares` · `exact_amounts` · transferencia entre usuarios ·
pagar deuda mediante transferencia · correcciones en ámbito compartido con
elegibilidad de participantes en la fecha efectiva original · bajas de miembros
con saldo pendiente y acceso residual · participante histórico.

**Dependencias.** F10 · F11.

**Cierre.**

1. Los escenarios 4.6, 4.7 y 4.8 de `data-model.md` se reproducen en la app.
2. **Solo el emisor** puede originar una transferencia directa entre Modos
   Personales, y existe un test que demuestra que el destinatario no puede,
   según el invariante 14.
3. Una corrección en ámbito compartido respeta la elegibilidad de participantes
   en la fecha efectiva original.
4. Quien sale de un grupo con saldo distinto de cero conserva acceso residual
   acotado.

**Deja.** El modelo avanzado de **Modo Personal y Grupos completo**, y la
infraestructura común —operación, efecto, ámbito, corrección, notificación—
preparada para implementar el tercer ámbito.

> **ADR-002 no está implementado en todos sus ámbitos hasta cerrar F13.** Modo
> Pareja forma parte del modelo que ADR-002 fija y llega en la fase siguiente.

**Puertas.** Ninguna.

---

### Fase 13 — Modo Pareja

`PRODUCTO`

**Objetivo.** El tercer ámbito, y con él la implementación funcional completa
del modelo de ADR-002.

**Alcance.** Dinero común · aportaciones · fuente de financiación frente a
procedencia · retiradas ordinarias · ciclo de cierre · reparto final bilateral y
su corrección.

**Dependencias.** F12.

**Cierre.**

1. Los escenarios 4.9, 4.10, 4.12, 4.13 y 4.14 de `data-model.md` se reproducen
   en la app.
2. Un gasto financiado personalmente **no mueve** el saldo común, según el
   invariante 4.
3. Iniciar el cierre **bloquea en el mismo instante** las retiradas
   unilaterales, según el invariante 18.
4. El reparto final exige confirmación bilateral y, sin ella, el saldo queda
   congelado sin reparto automático de ningún tipo.
5. **El dominio no consulta en ningún punto una capacidad comercial**, según
   ADR-002 §11.

**Puertas.** Ninguna.

---

### Fase 14 — Premium y entitlements

`INTEGRACIÓN`

**Objetivo.** Monetizar sin contaminar la contabilidad.

**Alcance.** Capa de capacidades que **invoca** operaciones del dominio,
suscripciones, y facturación de App Store y Google Play.

**La restricción que gobierna la fase.** ADR-002 §11: _el dominio financiero
conoce ámbitos, operaciones, efectos y cierres; no conoce planes comerciales. Una
capa independiente de capacidades invoca operaciones del dominio; el dominio
nunca consulta capacidades._

**Dependencias.** F13, porque la capa de capacidades solo puede regular
capacidades que existen · **F8.B**, por las cuentas de tienda, que es la puerta
que esta fase no puede saltarse.

**Trae, además, el icono alternativo.** ADR-030 §5 dejó decidido que Nomey
lleva dos iconos y que los dos viajan en el binario. Aquí se implementa el
comportamiento: al activarse Premium se habilita y selecciona el icono negro,
respetando la confirmación que exija el sistema; desde Ajustes la persona
suscrita alterna entre amarillo y negro; al terminar Premium vuelve el amarillo.
**Elegir un icono no cambia la estética interior de la aplicación.**

**Cierre.**

1. Un usuario puede suscribirse, restaurar la compra y perder el acceso al
   caducar.
2. **Ninguna comprobación de plan aparece dentro de la función de escritura ni
   en `domain/`**, verificado por revisión y por test.
3. Un cambio de plan **no reescribe, elimina ni modifica** ningún hecho contable
   histórico, según el invariante 21.

**Puertas.** Ninguna técnica. La revisión de las tiendas es un riesgo externo,
no una decisión.

---

### Fase 15 — Presupuestos e insights

`PRODUCTO`

**Objetivo.** Herramientas de comprensión financiera sobre los hechos ya
registrados.

**Alcance.** Presupuestos por categoría y periodo, estadísticas, evolución y
análisis de gasto.

**Por qué después de F13 y no antes.** Construirlos antes de multimoneda los ata
a una sola moneda; construirlos antes de Modo Pareja deja fuera un ámbito cuyo
saldo el glosario excluye expresamente del `Disponible tras saldar`. Después de
F13 no queda ningún ámbito ni ninguna moneda por incorporar, y se construyen una
sola vez.

**Dependencias.** F13.

**Cierre.**

1. Un presupuesto refleja el consumo derivado de los efectos, no un contador
   propio.
2. Corregir una operación pasada actualiza los insights sin operaciones de
   reversión.
3. Ninguna vista agrega importes de definiciones monetarias distintas sin
   conversión explícita.
4. Si se añade caché o vistas materializadas por rendimiento, son **derivación**
   y no una segunda fuente de verdad.

**Puertas.**

- **Presentación de agregaciones entre definiciones monetarias.** ADR-003 la
  dejó explícitamente sin decidir y esta fase la fuerza.

---

### Fase 16 — Superficies nativas

`INTEGRACIÓN`

**Objetivo.** Sacar la entrada rápida fuera de la app.

**Alcance.** Widgets, App Intents, Siri y Botón de Acción. El Botón de Acción no
es trabajo separado: invoca un atajo que invoca un App Intent, así que llega con
ellos.

**Dependencias.** F7, porque un widget que registra un gasto debe escribir en la
cola sin conexión, lo que en iOS implica almacenamiento compartido entre app y
extensión · **[ADR-030](../adr/ADR-030-native-code-model.md), ya aceptado**, que
obliga a expresar las extensiones como **plugin local versionado** y no abriendo
`/ios`.

**Cierre.**

1. Un gasto registrado desde el widget llega a la app con la misma garantía de
   idempotencia que uno registrado dentro.
2. La app sigue construyéndose con el modelo de build decidido en F8, sin
   configuración manual.
3. Existe paridad declarada entre iOS y Android, o una asimetría documentada y
   aceptada.

**Puertas.** ~~El ADR de código nativo debe estar aceptado; si no lo está, la
fase no arranca.~~ **Cumplida el 2026-09-04** —
[ADR-030](../adr/ADR-030-native-code-model.md). Lo que la puerta deja en su
lugar es una restricción: las superficies nativas se implementan bajo CNG, como
plugin local versionado y detrás de una frontera nativa explícita.

---

### Fase 17 — Integración bancaria

`INTEGRACIÓN` · **cierre del alcance de 1.0**

**Objetivo.** Registro parcialmente automático mediante importación de
movimientos.

**Alcance.** Agregador externo, importación, conciliación con operaciones
existentes, e idempotencia propia de importación.

**La restricción que gobierna la fase.** ADR-002 §2 ya establece que los ámbitos
**no son cuentas bancarias** y que una integración externa _aporta procedencia y
conciliación; no cambia la naturaleza de los ámbitos_. En consecuencia:

> **Un movimiento importado es evidencia, nunca un efecto.** Propone una
> conciliación; el usuario confirma; el hecho resultante es una operación normal
> de Nomey con su propia idempotencia. **La integración bancaria no es fuente de
> verdad del dominio financiero.**

**Dependencias.** F12, por las correcciones · F11, por las divisas · **ADR de
conciliación** entre un movimiento importado y la pata personal de una operación
compuesta, ya declarado pendiente en ADR-002 · contrato con el agregador.

> **El hilo de proveedor, contrato y requisitos regulatorios debe abrirse en F9**,
> aunque el código llegue aquí. Es aprovisionamiento, no ingeniería, y no se
> acelera programando.

**Cierre.**

1. Ningún movimiento importado produce efectos contables sin confirmación
   explícita.
2. Reimportar el mismo periodo **no duplica** nada.
3. Existe `docs/security/threat-model.md`, que esta fase vuelve exigible por el
   tipo de dato que entra.
4. Un fallo o una caída del proveedor degradan la funcionalidad sin corromper
   ningún hecho registrado.

**Puertas.** ADR de conciliación aceptado · contrato y viabilidad regulatoria
confirmados.

---

### Fase 18 — Endurecimiento global

`PRE-LANZAMIENTO`

**Objetivo.** Auditar el sistema completo con todas las capacidades de 1.0 ya
presentes.

**Alcance.** E2E global · seguridad · rendimiento · observabilidad ·
recuperación ante fallos · migraciones · comportamiento sin conexión ·
sincronización · integraciones externas · regresiones · accesibilidad ·
preparación para carga real.

**Qué no es.** No es donde aparecen la seguridad, el logging, la accesibilidad,
los tests, el manejo de errores ni el rendimiento razonable. Eso es **disciplina
continua desde F6**, en cada PR. Esta fase **audita**; no estrena.

**Dependencias.** F17.

**Cierre.**

1. Suite E2E cubriendo los recorridos principales de los tres ámbitos.
2. Revisión de seguridad completa, con especial atención a RLS, grants y a la
   función de escritura con privilegios elevados.
3. Ningún registro contiene importes ni descripciones de transacciones, según
   `AGENTS.md` §8.
4. Las migraciones se aplican desde cero y sobre una base con datos, sin
   pérdida.
5. Revisión de accesibilidad superada.

**Puertas.** Ninguna.

---

### Fase 19 — Producción y lanzamiento

`PRE-LANZAMIENTO`

**Objetivo.** Publicar Nomey 1.0.

**Alcance.** Infraestructura productiva, privacidad, términos, analítica, fichas
de tienda, despliegue y operación.

**Dependencias.** F18.

**Cierre.**

1. Nomey publicado en App Store y Google Play.
2. Entorno de producción separado, con credenciales separadas, y ninguna clave
   de backend en el bundle.
3. Política de privacidad y términos publicados y coherentes con los datos que
   se tratan.
4. Procedimiento de despliegue y de reversión documentado y ejecutado al menos
   una vez.

**Puertas.** Revisión de las tiendas.

---

## Trabajo paralelizable

| Trabajo                                                     | En paralelo con |
| ----------------------------------------------------------- | --------------- |
| Runner de tests y vectores de prueba derivados de ADR-002   | 3.A             |
| Arquitectura UX e i18n (F4 completa)                        | 3.C             |
| Cuentas de desarrollador y firma (**F8.B**)                 | antes de F14    |
| **Proveedor, contrato y viabilidad del agregador bancario** | **desde F9**    |
| Selección de proveedor de tipos de cambio                   | desde F9        |
| Configuración de productos de suscripción en las tiendas    | desde F12       |

---

## Dependencias externas que pueden alterar calendario o arquitectura

Ordenadas por riesgo.

1. **Agregador bancario (F17).** Contrato, verificación de la empresa y posibles
   requisitos regulatorios. Plazos ajenos a la ingeniería. Es la razón de abrir
   el hilo en F9.
2. ~~**ADR de código nativo (F8).**~~ **Resuelto el 2026-09-04 como CNG con
   config plugins** — [ADR-030](../adr/ADR-030-native-code-model.md). `/ios` y
   `/android` siguen git-ignorados, así que el riesgo de calendario que este
   punto describía desaparece. En su lugar entra una dependencia externa nueva y
   menor: **la cuenta de Expo que EAS Update necesita** para actualizar Staging
   — [ADR-031](../adr/ADR-031-environments-and-variants.md) §5.
3. **Revisión de App Store y Google Play (F14 y F19).** Las suscripciones tienen
   reglas propias y rechazos frecuentes en la primera vuelta.
4. **Proveedor de tipos de cambio (F11).** Su granularidad y su histórico
   condicionan la política de selección que ADR-003 dejó abierta.
5. **Infraestructura de notificaciones push (F9).** Depende de cómo se resuelva
   la puerta de esa fase.
6. **Comportamiento de PostgREST (3.A).** Puede obligar a introducir una capa de
   transporte explícita.

---

## Puertas de decisión, resumen

| Fase | Puerta                                                                                      |
| ---- | ------------------------------------------------------------------------------------------- |
| 3.A  | **E11 → ADR-003.** Si contradice una premisa, la fase se detiene                            |
| 3.C  | Identidad de la definición monetaria · esquema expuesto · grants · membresía · idempotencia |
| 8    | ~~ADR de código nativo~~ · **cumplida: [ADR-030](../adr/ADR-030-native-code-model.md)**     |
| 9    | Qué significa «notificación»: en la app, o push                                             |
| 10   | ADR de invitación y reclamación de participantes sin cuenta                                 |
| 11   | Proveedor de tipos de cambio con histórico                                                  |
| 15   | Presentación de agregaciones entre definiciones monetarias                                  |
| 16   | ~~ADR de código nativo aceptado~~ · **cumplida: ADR-030**                                   |
| 17   | ADR de conciliación · contrato y viabilidad regulatoria                                     |

---

## Riesgo asumido de esta estrategia

El plan llega al lanzamiento **sin usuarios públicos por el camino**, lo que
alarga el tiempo hasta el primer contraste real. El riesgo no es de calendario
sino de dirección: cuanto más se construye sin usuarios, más se construye sobre
supuestos.

La mitigación está dentro del propio roadmap y es la razón por la que la
distribución interna sube a F8: **la beta cerrada desde F10 es lo que impide que
ese riesgo se materialice.** Si la beta se retrasa o se queda en muy pocas
personas, el riesgo vuelve entero.

**Aplazar F8.B a antes de F14 estrecha esa mitigación, y es un coste aceptado.**
La beta cerrada queda limitada a Android hasta que exista la cuenta de Apple, de
modo que el contraste con usuarios reales se obtiene sobre una sola plataforma.
La alternativa era contratar la cuenta varias fases antes de necesitarla; se
eligió esto. Adelantar F8.B es la palanca si el contraste en iOS resulta
necesario antes.

Queda escrito para que la decisión sea consciente, no por omisión.
