# `src/lib` — infraestructura transversal

Todo lo que habla con el mundo exterior o resuelve una preocupación técnica
compartida. No contiene reglas de negocio.

## Reglas

- No importa de `features/`, `app/` ni `ui/` (impuesto por ESLint).
- Puede importar de `domain/`.

## Contenido previsto

| Módulo     | Responsabilidad                                                 |
| ---------- | --------------------------------------------------------------- |
| `supabase` | Cliente, tipos generados, adaptador de sesión sobre SecureStore |
| `query`    | Configuración de react-query                                    |
| `offline`  | Cola de escritura e idempotencia por `client_id`                |
| `format`   | Formateo dependiente de locale: moneda, fechas, números         |
| `env`      | Variables de entorno validadas con Zod                          |

## Nota sobre `format`

El formateo monetario depende del locale y por eso vive aquí, no en `domain/`.
`domain` opera con `{ amountMinor, currency }`; `lib/format` lo convierte en
`"1.234,56 €"` o `"$1,234.56"` según el idioma activo.

Nada implementado todavía.
