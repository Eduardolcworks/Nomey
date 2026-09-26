# F11/ADR-004 — Orden de producto del catálogo de divisas

- **Estado:** Aceptado
- **Fecha:** 2026-09-26
- **Fase:** F11 (bloque de cierre de la experiencia multimoneda)
- **Supersede:** nada. Es una decisión **nueva** sobre una pregunta que ningún
  ADR anterior había respondido: hasta ahora el orden no estaba decidido, sólo
  implementado.

---

## Contexto

[F11/ADR-001](ADR-001-fx-rate-resolution.md) §6 decidió que el catálogo se
publica **entero**, tenga o no cobertura de cambio una divisa, porque qué par
se puede convertir un día dado lo decide la frontera y además cambia cada día
hábil. Esa decisión sigue intacta y este ADR no la toca.

Lo que nadie decidió es **en qué orden se ofrecen**. La implementación de
F11.C ordenó por código ISO —`code.localeCompare`— por ser lo más neutral que
se podía escribir sin abrir una discusión de producto. Con las veinte divisas
reales en pantalla eso da:

```
ARS · AUD · BRL · CAD · CHF · CLP · COP · CZK · DKK · EUR · GBP …
```

Tres consecuencias medidas al abrir el selector:

- **`EUR` sale la décima.** La divisa base de la inmensa mayoría de las cuentas
  queda a media lista, en un menú que hay que recorrer.
- **`ARS`, `COP` y `CLP` encabezan.** Son precisamente las tres que hoy **no**
  tienen cobertura de la fuente: quien las elija recibirá
  `FX_CURRENCY_NOT_COVERED`. Encabezar la lista con ellas es ofrecer primero lo
  que menos va a funcionar.
- **`USD`, `GBP` y `JPY`** —las tres que acompañan a `EUR` en casi todo viaje—
  caen dispersas entre la vigésima parte y el final.

Y el fondo del asunto: **ordenar por el código no es una decisión neutral.**
Parece que no elige, y elige — elige el alfabeto latino aplicado a un
identificador técnico. La alternativa honesta no es no decidir, es decidir a la
vista.

## Decisión

### §1 · El orden es de producto, y está congelado

```
EUR · USD · GBP · JPY · CHF
CAD · AUD · NZD
SEK · NOK · DKK
PLN
MXN · BRL
CZK · HUF · RON
ARS · COP · CLP
```

El criterio, en este orden de prioridad:

1. **La base de Nomey primero.** `EUR` es la divisa base de casi todos los
   ámbitos que existen hoy.
2. **Las de mayor uso después.** `USD`, `GBP`, `JPY` y `CHF` son las que
   acompañan a un gasto en el extranjero con más frecuencia.
3. **El resto, por regiones**, para que la lista se recorra por bloques
   reconocibles y no como veinte elementos sueltos.
4. **Las tres sin cobertura de la fuente, al final.** No se ocultan —§2— pero
   tampoco encabezan.

### §2 · Ordenar no es filtrar, y la distinción es normativa

**Ninguna divisa se retira de la lista por este ADR.** `ARS`, `COP` y `CLP`
siguen ofreciéndose exactamente igual que antes, aunque hoy la frontera las
rechace con `FX_CURRENCY_NOT_COVERED`. La razón es la de F11/ADR-001 §6 y no ha
cambiado: **qué par se convierte un día dado lo decide el servidor**, la
cobertura cambia cada día hábil, y fabricar esa regla en el cliente sería
mantener una copia que se desincroniza sola.

Esta distinción está guardada en `tests/infra/fx-ui-surface.test.ts`: los
códigos sólo pueden aparecer dentro del propio orden, y el camino del selector
no admite ningún `filter` por código.

### §3 · Una divisa que el orden no conoce cae detrás, nunca fuera

Si el catálogo del servidor crece con una divisa que esta lista no nombra,
**se ofrece igual**, detrás de todas las conocidas y entre ellas por código.
Añadir una al catálogo sin tocar esta lista degrada el orden; nunca la lista.

Esto es lo que impide que el orden se convierta en un filtro por descuido, que
es el modo en que una lista de presentación se estropea.

### §4 · Vive en el cliente, no en el esquema

El orden es **presentación**, y `AGENTS.md` §1 ya separa la aritmética del
dominio de su formateo. No se añade ninguna columna a
`core.currency_definition` ni a `api.currency_definition`, y no hay migración.

Consecuencia asumida y dicha: cambiar el orden exige publicar una versión del
cliente. Se acepta porque el orden es una decisión de producto estable —lo
contrario de la cobertura de cambio, que es un dato que cambia a diario y por
eso sí vive en el servidor.

Vive además en **su propio módulo sin dependencias**
(`src/lib/currency/order.ts`), separado del catálogo que lee de Supabase, para
que su comportamiento —ordena, no descarta; es total; es estable— se pueda
comprobar sin arrastrar infraestructura.

## Alternativas consideradas

**Dejar el orden alfabético.** Es lo que había, y es lo que pone las tres sin
cobertura delante y `EUR` la décima. Su única virtud —parecer que no decide— es
falsa.

**Ordenar por cobertura: primero las convertibles hoy.** Descartada, y es la
más tentadora. El orden de la lista pasaría a depender de un dato que cambia
cada día hábil y que el cliente no tiene sin preguntar; el menú cambiaría solo
de un día para otro sin que nadie lo hubiera tocado; y acercaría peligrosamente
la lista a un filtro, que es justo lo que F11/ADR-001 §6 prohíbe.

**Ordenar por uso real de cada cuenta.** Es mejor idea que las anteriores y
queda **fuera de F11**: exige medir qué divisas usa cada persona, guardarlo en
algún sitio y decidir qué pasa la primera vez. Nada de eso está decidido, y un
orden que se mueve solo necesita antes una decisión sobre cuándo puede moverse.
Si algún día se hace, este ADR es la línea base sobre la que se compara.

**Ponerlo en el servidor, como columna de orden.** Permitiría cambiarlo sin
publicar. Se descarta porque convierte una decisión de presentación en esquema
—y en migración, y en un dato más que mantener sincronizado con el diseño— a
cambio de una flexibilidad que un orden estable no necesita.

## Consecuencias

### A favor

- `EUR` es lo primero que se ve, y las cuatro siguientes son las que de verdad
  se eligen.
- Lo que hoy no funciona deja de encabezar la lista, sin dejar de ofrecerse.
- El orden es total, estable y comprobable por comportamiento, no por lectura.

### En contra

- **Cambiarlo exige publicar.** Dicho arriba y aceptado.
- **Es un juicio de producto, no un hecho medido.** «De mayor uso» se apoya en
  el uso previsto de Nomey, no en telemetría, que no existe. Si algún día
  existe, este orden es una hipótesis que se podrá falsar.
- **Una divisa nueva del catálogo se coloca al final** hasta que alguien toque
  esta lista, y nada avisa de ello.

### Evidencia que exige este ADR

1. Las veinte divisas del catálogo salen ordenadas exactamente como §1, y son
   veinte: ordena y no descarta.
2. `ARS`, `COP` y `CLP` están en la lista.
3. Una divisa que el orden no conoce sale detrás de todas y no desaparece.
4. El orden es estable: ordenar dos veces no lo mueve.
5. El camino del selector no contiene ningún filtro por código.

Las cinco están en `tests/lib/fx-ui.test.ts` y
`tests/infra/fx-ui-surface.test.ts`.
