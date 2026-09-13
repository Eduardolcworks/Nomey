# Revisión manual — pagos registrados y salida sin pendientes (F09/ADR-007 / F09/ADR-008)

Guía para comprobar en dispositivo lo que la evidencia automática ya mide en la
base. Cada caso dice qué hacer y **qué tiene que verse**. Si algo no coincide,
anota el caso y lo que salió; no marques nada como visto sin haberlo visto.

## Antes de empezar

- **Base local limpia** (2026-09-13): sin movimientos ni grupos; quedan las dos
  cuentas —`eduardo@lcworks.es` («Edu») y `aitor@lcworks.es` («Aitor»)— con su
  contraseña de siempre, su Personal a cero y 15 categorías de sistema. Hay una
  copia de lo borrado en el scratchpad de la sesión (`backup-core-auth-*.dump`).
- **Stack y Metro en pie**: Kong en `192.168.8.105:54321`, Metro en
  `192.168.8.105:8081` (variante `development`, `--lan --dev-client`).
- **Dispositivo**: el iPhone con la development build actual. La build Android
  del 2026-09-04 no vale (le falta `expo-clipboard`) y no está autorizada.
- **Dos cuentas en un solo teléfono**: se alterna con Perfil → cerrar sesión →
  entrar con la otra. Donde haga falta la simultaneidad real (caso 8) se dice.
- Convención: «Edu» es quien crea; «Aitor» es quien reclama; «Marta» y «Dani»
  son participantes **sin cuenta**.

## 0 · Punto de partida

Entrar como Edu. Esperado: Inicio con Disponible `0,00 €`, sin movimientos;
Grupos vacío; campana sin avisos. Cerrar sesión, entrar como Aitor: lo mismo.

## 1 · Grupo de prueba y reclamación

1. Edu → Grupos → Crear grupo: nombre **Prueba**, emoji cualquiera, divisa EUR,
   participantes: Edu (tú), **Aitor**, **Marta**, **Dani**. Guardar.
2. Edu → tarjeta del grupo → Compartir → copiar el enlace (o enseñar el QR).
3. Cerrar sesión; entrar como Aitor → Grupos → Únete → Pegar enlace (o
   escanear) → «Soy Aitor» → confirmar.
   - Esperado: Aitor ve el grupo Prueba en su lista. Dentro, en Saldos, todos a
     `0,00 €`; Aitor con borde amarillo y «Con cuenta».
4. Entrar como Edu: en Saldos, Aitor aparece con borde amarillo y «Con
   cuenta» (reclamar no genera aviso en la campana).

## 2 · Gasto que crea deuda

Edu → Prueba → `+` → **Cena**, `30,00 €`, pagado por Edu, reparto igual entre
Edu, Aitor y Marta (Dani fuera del reparto). Guardar.

- Esperado en Saldos: `Edu +20,00` · `Aitor −10,00` · `Marta −10,00` ·
  `Dani 0,00`. Resumen del grupo: total `30,00`, tu parte `10,00`.
- Inicio de Edu: fila «Cena · Prueba» `−30,00 €` (caja); Deudas de Personal
  `+20,00`.

## 3 · «Los míos», «Todos» y «Saldado» (registrar el pago)

Entrar como Aitor → Prueba → Saldos → **Pagos sugeridos**.

- Esperado: se abre con «Número mínimo de transferencias» y las pestañas
  **Los míos** (elegida) / **Todos**.
  - Los míos: `Aitor → Edu 10,00 €` con el botón amarillo **Saldado**.
  - Todos: además `Marta → Edu 10,00 €` **sin** botón (Marta no tiene cuenta).
- Pulsar **Saldado**. Esperado: alerta «Registrar pago» con «Aitor pagó 10,00 €
  a Edu fuera de la app…» y «Un pago no se edita…». Cancelar no hace nada.
- Confirmar. Esperado, sin salir de la pantalla:
  - Saldos: `Edu +10,00` · `Aitor 0,00` · `Marta −10,00`.
  - Pagos sugeridos: Los míos dice «Ninguna propuesta te nombra…»; Todos:
    `Marta → Edu 10,00 €`.
  - Movimientos: bloque **Pagos registrados** con la fila `Aitor → Edu ·
Pago · <hoy> · 10,00 €`, encima de «Cena».
- Inicio de Aitor: fila **«Pago a Edu»**, debajo «Prueba», `−10,00 €`;
  Disponible `−10,00 €`; Deudas `0,00`. Al desplegarla: Grupo, «Con: Edu»,
  «Un pago no se edita: elimínalo y registra otro», papelera **sin lápiz**.
- Entrar como Edu: Inicio con **«Pago de Aitor»** `+10,00 €` (verde),
  Disponible `−20,00 €` (pagó 30, recibió 10); Deudas `+10,00`; campana con
  **«Pago registrado con Aitor»** (abre el grupo y se marca leído).

## 4 · Desplegable del pago

Edu → Prueba → Movimientos → tocar `Aitor → Edu`.

- Esperado: «Declarado por: Aitor», rótulo **Cerró** y la línea
  `Aitor → Edu   10,00 €`, y la papelera. Sin lápiz.
- Deslizar la fila a la izquierda descubre la misma papelera.

## 5 · Eliminar el pago (por la otra parte)

Edu pulsa la papelera del pago → «Eliminar pago» → Eliminar.

- Esperado en el grupo: la fila sigue, con la cifra **tachada** y «Anulado ·
  <hoy>», sin papelera; desplegada dice **«Había cerrado (vuelve a estar
  pendiente)»** con `Aitor → Edu 10,00 €`. Saldos vuelve a `Edu +20 / Aitor −10
/ Marta −10`. Pagos sugeridos vuelve a proponer `Aitor → Edu`.
- Inicio de Edu: el «Pago de Aitor» desaparece; Disponible `−30,00`.
- Entrar como Aitor: campana **«Pago eliminado con Edu»**; Inicio sin «Pago a
  Edu», Disponible `0,00`, Deudas `−10,00`.

## 6 · Salir bloqueado con deuda, y salir a cero

1. Aitor → Grupos → menú de la tarjeta Prueba → Salir del grupo → Salir.
   - Esperado: alerta **«Tienes pendientes en este grupo»** con «Cerrar» e
     **«Ir al grupo»** (lleva a Prueba). Aitor sigue en el grupo.
2. Aitor → Prueba → Pagos sugeridos → Saldado sobre `Aitor → Edu 10,00 €` →
   confirmar. Saldos: Aitor `0,00`.
3. Aitor → Grupos → Salir del grupo → Salir.
   - Esperado: sale; Prueba desaparece de su lista; Inicio conserva «Pago a
     Edu» `−10,00`; Deudas `0,00` (ya no es miembro).
4. Entrar como Edu: en Saldos, Aitor aparece **«Inactivo»**, sin borde
   amarillo, con `0,00`; **no** hay botón «Saldado» en su fila; campana «Aitor
   ha salido del grupo». Pagos sugeridos (Todos): `Marta → Edu 10,00 €`.

## 7 · Anular tras la salida: aviso y deuda reabierta acotada

Edu → Prueba → Movimientos → papelera del pago vigente `Aitor → Edu` →
Eliminar.

- Esperado en Edu: fila tachada/«Anulado»; Saldos `Aitor −10,00` (sigue
  inactivo, **no** readmitido); Pagos sugeridos dice que no puede proponer
  mientras haya saldo pendiente de quien salió (nombra a Aitor).
- Entrar como Aitor: campana con un segundo **«Pago eliminado con Edu»**
  aunque ya no sea miembro (de Prueba sólo ve avisos de pago: ni «ha salido»
  ni ediciones); Inicio sin «Pago a Edu»,
  Disponible `0,00`, **Deudas `−10,00`** —exactamente lo que ese pago había
  cerrado— y Grupos sigue vacío (no ve el grupo).
- Comprobación negativa: Edu añade otro gasto `Cena 2`, `20,00 €`, entre Edu y
  Marta. Esperado: Deudas de Aitor **no cambia** (`−10,00`): la excepción está
  acotada a sus pagos anulados.

## 8 · Propuesta desactualizada (`SETTLEMENT_STALE`)

Necesita dos sesiones a la vez (dos teléfonos, o el iPhone y un segundo
aparato compatible). Preparación: un gasto nuevo de Edu entre Edu y Aitor
(Aitor tiene que estar dentro: repítelo con un grupo nuevo si ya salió).

1. En los dos aparatos, con Edu y Aitor, abrir Pagos sugeridos: los dos ven
   `Aitor → Edu X`.
2. Edu pulsa Saldado y confirma (registra el pago).
3. Aitor, con la propuesta vieja en pantalla, pulsa Saldado y confirma.
   - Esperado en Aitor: alerta **«Los saldos han cambiado — No se ha
     registrado nada…»**; al cerrar, la pantalla se ha releído: Saldos a cero,
     propuesta desaparecida, **un solo** pago en Pagos registrados.

Si sólo hay un aparato, este caso queda cubierto por la evidencia automática
(carrera 3 de `scripts/group-payment-race-evidence.sh`).

## 9 · Opcional: novación (reasignación) en el desplegable

Grupo nuevo **Ruta** (Edu, Aitor, Marta, Dani), Aitor reclama. Gastos:

- Marta paga `20,00` entre Aitor y Marta → `Aitor → Marta 10`.
- Edu paga `20,00` entre Edu y Dani → `Dani → Edu 10`.

Aitor → Pagos sugeridos → Los míos: `Aitor → Edu 10,00 €` (no hay par directo
ni camino). Saldado → confirmar.

- Esperado al desplegar el pago: **Cerró** `Aitor → Marta 10,00 €`,
  `Dani → Edu 10,00 €` y **`Dani → Marta 10,00 €` marcada «nueva»** (la
  obligación reasignada). Saldos: Edu `0`, Aitor `0`, Marta `+10`, Dani `−10`.
  Los saldos de Marta y Dani no cambian con el pago; sólo cambia entre quién
  queda la deuda.

## 10 · Errores que deben verse en castellano (sin códigos)

- Saldado con la red apagada: «No se ha podido registrar el pago — No se ha
  registrado nada. Inténtalo de nuevo.» Al recuperar la red, el mismo botón
  registra **un solo** pago (misma clave).
- Eliminar un pago ajeno no es posible desde la interfaz (sin papelera); si
  ocurriera por otra vía: «Sólo quien pagó o quien cobró puede eliminar este
  pago.»

## Qué anotar

Por cada caso: visto / no visto / distinto (con lo que salió). Los casos 1–7 son
los del bloque; 8 sólo con dos aparatos; 9 y 10, si hay tiempo.
