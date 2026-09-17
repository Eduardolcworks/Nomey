# Ingesta local de los tipos del BCE

> **Qué es esto.** El procedimiento para cargar y mantener, **en la base
> local**, los tipos de referencia del Banco Central Europeo que usa la
> multimoneda (F11.B). La regla que aplica la base está en
> [F11/ADR-002](../adr/F11/ADR-002-per-currency-daily-rate.md); aquí solo se
> explica cómo ejecutarla.

## Alcance

- **Solo local.** La ingesta de un entorno real espera al entorno verificado de
  F8 ([`phase-11-progress.md`](../architecture/phase-11-progress.md)). El script
  se niega a escribir en una base que no sea la local de desarrollo
  (`scripts/local-db-guard.sh`).
- **CI no descarga nada.** Los checks usan documentos sintéticos y fuentes de
  fixture; la red y la disponibilidad del BCE no deciden si CI pasa.
- **Escribe de forma permanente** en la fuente real `ecb`. Nada de lo que
  escribe se borra: las observaciones, las versiones y los días fijados son
  insert-only.

## Uso

Desde Ubuntu (WSL2), con el stack local levantado:

```bash
./scripts/fx-ingest.sh
```

Descarga `eurofxref-hist-90d.xml`. Si la base todavía no tiene nada del BCE,
si hay un hueco desde lo guardado o si quedan días sin fijar que la ventana no
alcanza, repite automáticamente con el histórico completo
(`eurofxref-hist.xml`, unos 8 MB).

Para forzar el histórico completo, por ejemplo en la carga inicial:

```bash
./scripts/fx-ingest.sh --full
```

Medido el 2026-09-17 sobre una pila local aislada, con el histórico
descargado el 2026-09-15: la carga inicial fijó 10 118 días y 163 066 tipos
en unos 16 s; una segunda ingesta del documento de 90 días tardó menos de
0,1 s y no escribió nada más que la observación.

## Qué devuelve

Una línea JSON de `sec.fx_ingest`:

| Campo                            | Significado                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `complete`                       | Si la observación cumple las siete condiciones de F11/ADR-002 §2               |
| `reason`                         | Si no las cumple, cuál falló. Nada más se escribe                              |
| `versions_new`                   | Versiones de fechas de referencia que no estaban guardadas (incluye enmiendas) |
| `days_fixed` · `day_rates_fixed` | Días X fijados por esta observación y tipos por moneda de esos días            |
| `days_unfixed`                   | Días desde la primera publicación hasta hoy (Berlín) que siguen sin fijar      |

Una observación incompleta termina con código distinto de cero. **No se
reintenta con otro tipo ni se corrige a mano**: los días sin fijar responden
«todavía no disponible» hasta que llegue una observación completa, y los ya
fijados no cambian.

## Qué hacer si…

- **`reason: http_not_ok` o fallo de red.** El BCE no respondió bien. Se vuelve
  a ejecutar más tarde.
- **`reason: not_well_formed`, `not_source_document` o `unexpected_structure`.**
  Llegó algo que no es un documento del BCE (una página de error, un documento
  truncado). Se vuelve a ejecutar más tarde; si persiste, se revisa la URL
  oficial antes de tocar nada.
- **`reason: rate_*` o `currency_code_*`.** El BCE publicó un valor que Nomey no
  acepta. Por F11/ADR-002 §2 invalida la observación entera. No se edita el
  documento: se espera a que la fuente lo corrija.
- **`reason: older_than_stored` o `stored_date_missing`.** Llegó un documento
  más viejo que lo guardado, típicamente de una caché. Se vuelve a ejecutar.
- **`days_unfixed` distinto de cero tras el histórico completo.** No debería
  ocurrir: se investiga antes de seguir.

## Cobertura: registrar una retirada o una moneda nueva

La cobertura (`core.fx_coverage`) **solo cambia con una migración**, nunca con
este script ni a mano:

- **Retirada:** una migración que cierra el intervalo abierto de esa moneda
  (`valid_until` = última fecha de referencia publicada, incluida) con su base
  (`valid_until_basis`) y la nota del BCE (`valid_until_evidence`).
- **Moneda nueva o reincorporada:** una migración que inserta un intervalo con
  su inicio, su base y su evidencia.

La moneda sigue en el catálogo monetario en todos los casos. Los días ya
fijados no cambian (F11/ADR-002 §5).

## Evidencia y cita

Cada observación guarda la URL, el estado HTTP, `Last-Modified` y `ETag`, el
tamaño y el sha256 del documento. Son **evidencia**, nunca autoridad: el tipo
de un día lo decide la primera observación completa de Nomey posterior a las
00:00 de ese día en Fráncfort.

Los datos son del Banco Central Europeo y se citan como tal
(F11/ADR-001, Evidencia: condiciones de uso).
