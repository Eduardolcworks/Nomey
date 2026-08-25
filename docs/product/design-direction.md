# Dirección visual de Nomey

> **Fuente de verdad única de la dirección estética de Nomey.** Gobierna la
> Fase 4 y **todas las fases posteriores que construyan UI o UX**. No se duplica
> en otros documentos: lo que necesiten, lo enlazan.
>
> **No es un ADR.** Registra una dirección de **producto e identidad**, no una
> decisión de arquitectura. Si en algún momento aplicarla exigiera una decisión
> arquitectónica —una dependencia de runtime nueva, código nativo, un cambio de
> plataforma—, **esa** decisión sí necesita su ADR, según
> [`AGENTS.md`](../../AGENTS.md).
>
> Fijada el 2026-08-25. **Una modificación material de esta dirección se
> documenta explícitamente aquí**, no se introduce en silencio desde una
> pantalla concreta.

---

## 1 · Dirección general

Nomey persigue una estética **minimalista, oscura, premium y muy legible**, con
**glassmorphism como recurso principal de profundidad** y **neumorfismo
únicamente como recurso táctil sutil**.

> **La aplicación no debe convertirse en una interfaz completamente glassmorphic
> ni neumórfica.** La prioridad, por delante de cualquier efecto, es que se
> comprenda con absoluta claridad la información financiera.

## 2 · Base visual

La mayor parte de la interfaz es **limpia, minimalista, funcional, de alto
contraste y con jerarquía clara**. La legibilidad es especialmente exigible en
**importes, movimientos, deudas, fechas y estados**.

> **Los efectos visuales nunca compiten con la información económica.**

## 3 · Paleta

Se mantiene la identidad ya definida:

| Papel                                                | Color                     |
| ---------------------------------------------------- | ------------------------- |
| Base predominante                                    | Negro y tonos casi negros |
| Acento                                               | El amarillo de Nomey      |
| Textos, superficies y separadores                    | Neutros                   |
| Identidad, selección, acciones importantes y énfasis | Amarillo, **selectivo**   |

**No se fijan aquí los HEX definitivos.** Hoy no existe fuente normativa de la
paleta: `app.config.ts` declara `#000000` como fondo y deja escrito que la
paleta exacta está pendiente, y [`assets/README.md`](../../assets/README.md)
recoge la identidad como «negro y amarillo» sin valores. **Los tokens concretos
corresponden a F4.**

## 4 · Glassmorphism

Es el **recurso de profundidad más reconocible de Nomey**, aplicado de forma
**selectiva**.

**Usos candidatos** —candidatos, no obligaciones—: barras de navegación · tab
bars · sheets · modales · menús flotantes · overlays · selectores contextuales ·
determinadas superficies destacadas.

**Características buscadas:** translucidez controlada · blur · capas · bordes o
reflejos sutiles · sensación de profundidad · buen comportamiento sobre fondos
oscuros.

> **Nunca se sacrifica contraste ni legibilidad para mantener el efecto.**

## 5 · Neumorfismo

**Solo como matiz táctil.** Usos candidatos: determinados botones · toggles ·
controles · inputs o selectores donde una ligera elevación o hundimiento
comunique interacción.

**Se evita expresamente:** neumorfismo fuerte estilo 2020 · grandes sombras
blandas · superficies excesivamente infladas · bajo contraste · hacer depender
la _affordance_ exclusivamente de una sombra.

> **El neumorfismo no es el lenguaje visual principal de Nomey.**

## 6 · Proporción conceptual

**No son porcentajes contractuales.** La orientación es:

```
interfaz limpia y minimalista   →   base
glassmorphism                    →   segunda capa de identidad y profundidad
neumorfismo                      →   detalles táctiles, reservado
```

## 7 · Inspiración y originalidad

Nomey puede inspirarse en **principios contemporáneos de interfaces
translúcidas y materiales con profundidad**, incluida la evolución visual de
plataformas como iOS. Con tres límites:

- **no copiar literalmente** componentes ni layouts de Apple;
- **no describir Nomey como una copia de iOS**;
- **adaptar** esos principios a la identidad negra y amarilla y a una aplicación
  financiera.

El objetivo es un **lenguaje reconociblemente propio de Nomey**.

## 8 · Accesibilidad — regla obligatoria

> **Si un recurso visual reduce el contraste, la legibilidad, la identificación
> de los elementos interactivos o la comprensión de la información financiera,
> se reduce o se elimina.**

Deben ser **inequívocos**: importes · positivos y negativos · deuda · saldo ·
moneda · fechas · estados · acciones destructivas · confirmaciones financieras.

**No se depende exclusivamente de color, blur, transparencia ni sombra** para
comunicar significado. Cada uno de esos recursos necesita un refuerzo que no sea
él mismo: texto, forma, icono, posición o etiqueta.

Esto se apoya en reglas que ya existen y no las sustituye: nunca se codifica el
símbolo de moneda ni el formato de fecha, y el valor monetario está separado de
su formateo (`AGENTS.md` §6).

## 9 · Aplicación por fases

**Esta dirección no cambia las responsabilidades del
[roadmap](roadmap.md).** Se aplica dentro del alcance que cada fase ya tiene.

| Fase                 | Qué le corresponde de esta dirección                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **F4**               | Convertirla en **principios visuales, arquitectura UX, wireframes, tokens iniciales, tema e infraestructura i18n** |
| **F6**               | El sistema de diseño **crece sobre casos reales** del Modo Personal, no sobre una biblioteca especulativa          |
| **F7**               | Aplicarla a **entrada rápida, estados optimistas, offline, sincronización y conflictos**                           |
| **F9 y posteriores** | Grupos, deudas, multimoneda, Modo Pareja, Premium e insights **amplían** el sistema sin cambiar la dirección base  |

Dos recordatorios que el roadmap ya fija y que esta dirección **no altera**:

- **F4 no implementa el Modo Personal**, y su alcance excluye expresamente la
  biblioteca de componentes completa y la consolidación del design system;
- **F6 es la primera feature completa y el primer hito enseñable**.

> **Una modificación material de esta dirección se documenta aquí,
> explícitamente.** Ampliar el sistema es esperable; cambiar la dirección en
> silencio desde una pantalla concreta, no.
