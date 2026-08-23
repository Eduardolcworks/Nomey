# Traspaso de Fase 3.B a Fase 3.C

> ⚠️ **NO NORMATIVO.** Es una nota de traspaso entre fases. No decide nada: las
> decisiones normativas viven en [`docs/adr/`](../adr/README.md), en
> [`data-model.md`](data-model.md) y en [`glossary.md`](../product/glossary.md);
> la secuencia de fases, en [`product/roadmap.md`](../product/roadmap.md).
> Si esta nota los contradice, mandan ellos.
>
> Existe para que una sesión nueva reconstruya el estado del proyecto leyendo el
> repositorio, sin depender de ninguna conversación previa.

Escrito al cerrar **3.B**, el 2026-08-20.

---

## Estado de entrada

|               |                                                                              |
| ------------- | ---------------------------------------------------------------------------- |
| **Fase 3.A**  | **Cerrada.** Entorno Supabase local, experimento E11 y resolución de ADR-003 |
| **Fase 3.B**  | **Cerrada.** Núcleo `domain/` y vectores de prueba compartidos               |
| **ADR-002**   | `Aceptado` · inmutable                                                       |
| **ADR-003**   | `Aceptado` · su puerta E11 se cumplió contra un stack real                   |
| **Siguiente** | **3.C** — esquema, grants, RLS y frontera de escritura                       |

**Supabase local disponible y reproducible.** `supabase/config.toml` versionado.
El experimento **E11 se repite entero** siguiendo
[`supabase/e11/README.md`](../../supabase/e11/README.md): sondeo, HTTP crudo,
medición con `supabase-js`, alternativas, generación de tipos y teardown. **No
son migraciones** y no forman parte del esquema.

**`src/domain/` es la implementación de referencia**: funciones puras, sin React
Native, sin Supabase, sin red y sin disco. Comprobado transitivamente: ningún
import escapa de `src/domain` y el grafo no alcanza **ningún paquete externo**.

**`tests/vectors/` es la única fuente de expectativas**, en JSON y con los
importes como string. Cada caso cita su fuente normativa.

> **La frontera de escritura autoritativa que se construya en 3.C deberá
> reproducir esos vectores exactamente.** Es el requisito de ADR-002 §7, y la
> razón de que los vectores sean JSON y no un módulo TypeScript.

**Verificaciones al cierre de 3.B:** 110 tests en verde (7 ficheros) ·
`npm run verify` —typecheck de aplicación y de tests por separado, lint y
formato— en verde · CI ejecuta también `npm test`.

---

## Lo que no debe reabrirse sin evidencia

Todo esto está decidido y documentado. **Enlace, no copia**: si hay duda, la
fuente manda.

### Decididas antes de 3.B

Modelo contable, operación y efecto, tres ámbitos, clases contables, reparto
por mayor resto, correcciones por versionado y frontera de confianza →
[ADR-002](../adr/ADR-002-accounting-model.md).

Representación exacta del dinero, definición monetaria, tipo de cambio, orden de
conversión y reparto, redondeo y serialización →
[ADR-003](../adr/ADR-003-money-representation.md).

### Decididas **durante** 3.B

Son decisiones de producto posteriores a ADR-002 y **no deben atribuírsele**.
Cada una está registrada como tal en su documento.

| Decisión                                                                                                                                          | Dónde                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Una participación **calculada** puede terminar en `0` por indivisibilidad                                                                         | [`data-model.md` §5](data-model.md)                          |
| En `shares`, los pesos **declarados** son estrictamente positivos                                                                                 | `data-model.md` §5 y §9                                      |
| En `exact_amounts`, quien declara importe `0` **no es participante** de esa operación                                                             | `data-model.md` §5                                           |
| La exigencia de participación positiva del pagador se refiere a la **declarada**, no al resultado calculado                                       | `data-model.md` §5                                           |
| **Una liquidación nunca supera la deuda pendiente**; el sobrepago no crea deuda inversa, el exceso es una **transferencia** separada              | `data-model.md` §3 · [`glossary.md`](../product/glossary.md) |
| El **pagador de un gasto de Grupo puede no tener Modo Personal**; su ausencia significa que no hay efecto de caja interno, no que no pagara nadie | `data-model.md` §5                                           |
| Una identidad monetaria estable identifica **una única definición coherente**; misma identidad con metadatos contradictorios es un dato corrupto  | `data-model.md` §10 · `glossary.md`                          |

**La identidad de definición monetaria es opaca en el dominio.** `domain/` la
transporta y la compara; **nunca la interpreta**. No implica UUID, ni entero, ni
código ISO. Elegir su representación física es trabajo de 3.C.

### Deliberadamente fuera de 3.B

**No son omisiones.** Modo Pareja ([F13 del roadmap](../product/roadmap.md)) · autorización y
bilateralidad · idempotencia · versionado y selección de la versión vigente ·
catálogo de monedas · notificación, atribución e historial · frontera textual de
E11 · **minimización del número de pagos para saldar un grupo**, que queda fuera
porque ADR-002 no fija ningún algoritmo normativo e inventar una heurística
acoplaría cliente y servidor a algo no decidido.

---

## Pendientes de 3.C

Ninguna está decidida. Varias son de **baja reversibilidad**.

1. **Identidad física de una definición monetaria.** UUID, entero, código más
   versión u otra cosa. Toca cada fila con dinero: la de peor reversibilidad de
   la lista.
2. **Schemas expuestos por la Data API.** `public` frente a un esquema dedicado
   que exponga solo vistas y funciones.
3. **Estrategia de `GRANT`** por rol, explícita y mínima.
4. **Privilegios inesperados observados en E11.** `anon` y `authenticated`
   aparecen con `REFERENCES`, `TRIGGER` y `TRUNCATE` sobre tablas nuevas de
   `public` a las que no se concedió nada. Hay que **determinar empíricamente de
   dónde proceden**, cuáles son efectivos y qué debe revocarse. E11 lo registró
   sin sacar conclusión.
5. **Mecanismo de comprobación de membresía para RLS.** ADR-002 dejó tres vías
   abiertas —`SECURITY DEFINER`, política reestructurada sin join, claims en el
   JWT— que difieren en rendimiento, superficie de escalada y **frescura de
   permisos**. La tercera es una decisión de producto disfrazada de técnica.
6. **Mecanismo concreto de la frontera textual** que hace cumplir T7 de ADR-003.
   E11 midió que **lo determinante es el cast a texto, no el camino de acceso**:
   un RPC que devuelve `bigint` sin castear falla igual que una tabla directa.
   Vista, RPC, adaptador de cliente o combinación: sin decidir.
7. **Frontera de escritura autoritativa.** ADR-002 §7 exige que el cliente envíe
   intención y que una función del servidor valide y genere los efectos
   atómicamente, sin permisos de escritura para los roles cliente. Es el objeto
   de mayor riesgo del sistema: salta la RLS por diseño y `AGENTS.md` §4
   recuerda que **la RLS no aplica a funciones**.
8. **Idempotencia.** Invariante 19. Debe estar en la primera función de
   escritura: añadirla después obliga a migrar todos los caminos de escritura.
9. **Persistencia del versionado.** Corregir es versionar, y saldos y
   estadísticas se derivan de la **versión vigente**. Cómo se representa la
   cadena de versiones no está decidido.
10. **Participantes con y sin usuario**, sin implementar F10. El dominio ya
    admite un pagador sin Modo Personal; el esquema debe poder representar un
    participante sin cuenta **sin** que 3.C aborde invitación, reclamación,
    prueba de autorización ni fusión.
11. **Persistido frente a derivado.** Saldos, deudas y estadísticas se derivan
    hoy de los efectos. Almacenarlos crearía una segunda fuente de verdad; una
    caché posterior es aditiva y no compromete el modelo.
12. **Cómo ejecutar `tests/vectors/` también contra el servidor.** Es lo que
    convierte los vectores en garantía y no en decoración. Sin esto, las dos
    implementaciones pueden divergir sin que nada lo detecte.
13. **Auth técnico para los tests de RLS.** Dos usuarios reales con JWT reales.
    No es Auth de producto —registro, login, recuperación—, que es F5.
14. **Orden de migraciones y tests de aislamiento.** Ninguna tabla alcanzable
    desde el cliente sin su política **en la misma migración**. Los tests deben
    comprobar además que **ningún rol cliente puede escribir efectos**, ni
    siquiera los propios.

### Cómo debe empezar 3.C

> **3.C comienza con el análisis del Data Architect, no con SQL.**
>
> **No se escriben migraciones definitivas hasta presentar y aprobar las
> decisiones de baja reversibilidad**, señaladamente la identidad monetaria, el
> schema expuesto, los grants, el mecanismo de membresía y la idempotencia.

Un orden razonable, no obligatorio: resolver primero 1, 2, 3 y 5 porque
condicionan todo lo demás · después 6 y 7, que definen cómo llegan y salen los
datos · después 8 y 9, que deben estar en la primera escritura · y solo entonces
migraciones, tipos generados y tests de aislamiento.

---

## Trampas conocidas

Cosas que ya costaron una corrección y conviene no repetir.

- **Los tipos generados por Supabase no son una frontera segura.**
  `supabase gen types typescript` produce `number` para `int8` y para `numeric`,
  justo lo que ADR-003 prohíbe. Siguen siendo válidos como referencia
  estructural. **`src/types/database.ts` no se escribe a mano** para taparlo.
- **La denegación por RLS es silenciosa.** Una tabla con `GRANT` y RLS sin
  política responde `200 []`, indistinguible de «no hay filas». Un `GRANT`
  ausente, en cambio, grita `401`. Un test que solo compruebe «no veo datos
  ajenos» pasaría igual con la tabla vacía: hay que comprobar también el caso
  positivo.
- **Vitest no comprueba tipos.** El typecheck de `tests/` es una invocación
  aparte de `tsc` y ya ha cazado un uso obsoleto que la suite no veía.
- **La suite debe poder fallar.** El procedimiento de regresión deliberada está
  en [`tests/README.md`](../../tests/README.md): romper el desempate del reparto
  debe tumbar exactamente 3 vectores, no la suite entera ni ninguno.
