---
name: new-feature
description: Crear el andamiaje de una feature nueva en src/features/ respetando las fronteras de arquitectura de Nomey. Úsalo cuando haya que empezar un dominio funcional nuevo (auth, transactions, groups, shared-expenses, settlements, quick-entry...) o cuando el usuario pida crear o inicializar una feature.
---

# Crear una feature

El nombre de la feature llega como argumento. Si no se indica ninguno,
pregunta cuál antes de crear nada.

## Antes de escribir nada

1. Lee `src/features/README.md` y `AGENTS.md`.
2. Comprueba que la feature no existe ya y que su responsabilidad no solapa
   con otra. **Si solapa, dilo y para**: dos features que hacen lo mismo son
   peor que una mal colocada.

## Estructura

En `src/features/<nombre>/`:

```
components/    # UI específica de esta feature
hooks/         # hooks de esta feature
api.ts         # acceso a datos de este dominio
types.ts
index.ts       # API pública: nada externo importa por debajo de aquí
```

## Reglas que debes respetar

- **Prohibido importar de otra feature.** Si necesitas algo de otra, eso baja a
  `domain/`, `lib/` o `ui/`. ESLint lo bloquea por **ubicación real** del
  archivo, así que escribirlo como ruta relativa tampoco funciona.
- **Prohibido importar de `src/app`.**
- Dentro de la feature, imports relativos.
- **Nada de aritmética de dinero aquí**: vive en `domain/`, que es puro y
  testeado.
- Nada de textos visibles hardcodeados, símbolos de moneda ni formatos de fecha
  españoles.
- Archivos en kebab-case.

## Alcance

Crea los archivos **vacíos o mínimos**. No inventes lógica de negocio que no se
te haya pedido, y no presupongas un esquema de base de datos: el modelo de
datos aún no está decidido y es materia de ADR.

Al terminar, ejecuta `npm run verify`.
