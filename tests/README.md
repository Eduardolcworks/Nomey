# Tests

```
tests/
├── domain/   # lógica financiera pura (prioridad máxima)
└── rls/      # aislamiento entre usuarios en Supabase
```

## Todavía no hay runner instalado

Es deliberado: la Fase 0 no añade dependencias de runtime ni de testing más
allá de linting. El runner se elige e instala en la **Fase 2**, cuando exista
la primera lógica de dominio que testear.

## Principio

Los tests de `domain/` **no son una fase posterior**. Se escriben en el mismo
PR que la lógica que verifican. Es matemática pura, cuesta minutos, y es donde
un error significa comunicar a una persona real una deuda equivocada.

Casos que deben estar cubiertos desde el primer día:

- reparto con resto (100 € entre 3) y determinismo de a quién le toca el céntimo
- monedas con escala distinta de 2 decimales
- balances netos con pagos cruzados
- minimización del número de pagos de una liquidación
- idempotencia: repetir la misma clave no produce dos movimientos

## Tests de RLS

Verifican con dos usuarios reales que ninguno puede leer los datos del otro.
Es la única garantía real de que las políticas funcionan; una revisión visual
no lo es. Llegan en la Fase 3.
