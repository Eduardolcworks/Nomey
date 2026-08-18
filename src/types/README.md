# `src/types`

Tipos compartidos por más de una capa.

Reglas:

- Los tipos de una feature viven en esa feature (`features/<x>/types.ts`), no
  aquí.
- Los tipos generados de la base de datos irán en `database.ts`, producidos por
  `supabase gen types`. **Archivo generado: no editar a mano**, y regenerar en
  cada migración dentro del mismo commit.

Vacío por ahora.
