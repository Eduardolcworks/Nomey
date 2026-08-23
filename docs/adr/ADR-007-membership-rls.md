# ADR-007 — Comprobación de membresía y estrategia de RLS

- **Estado:** Aceptado
- **Fecha:** 2026-08-24

## Contexto

[ADR-002](ADR-002-accounting-model.md) dejó pendiente, en otro ADR, el
**mecanismo de comprobación de membresía**. `AGENTS.md` §4 lo describe como una
decisión abierta entre un helper `SECURITY DEFINER`, una política
reestructurada que evite el join, y claims en el JWT — tres opciones que
difieren en rendimiento, superficie de escalada y **frescura de permisos**.
[ADR-005](ADR-005-schema-topology.md) §4 la volvió a dejar abierta, y
[ADR-006](ADR-006-privilege-model.md) §5 fijó que las lecturas del cliente
atraviesan vistas `security_invoker` y que **la RLS de `core` es la autoridad
por fila**. Falta decidir cómo esa RLS resuelve la pertenencia.

**El problema, en concreto.** Una política sobre una tabla de dominio necesita
saber si `auth.uid()` pertenece al ámbito de la fila, y esa información está en
la tabla de membresía. El peligro no es hacer un join: es **que una política
consulte la tabla que protege**. Medido: una política que se consulta a sí misma
falla con `42P17 · infinite recursion detected in policy for relation`. Falla
ruidosamente, que es lo bueno; lo peligroso es «arreglarlo» relajando la
política, que `AGENTS.md` §4 califica de peor que el bug.

La forma sin helper funciona mientras la política de la tabla de membresía pueda
mirar solo su propia columna. **Nomey no puede quedarse ahí**: repartos, deudas
y nombres exigen que un miembro vea a los demás miembros de su grupo, y en ese
momento la política pasa a ser «filas de los ámbitos a los que pertenezco», que
sí es una consulta sobre la propia tabla.

El experimento **E13** midió las opciones contra un modelo mínimo con dos
usuarios reales de GoTrue. Evidencia en
[`supabase/e13/`](../../supabase/e13/README.md).

## Decisión

### 1. La autoridad por fila

**La RLS de `core`, evaluada bajo la identidad del usuario real** a través de
las vistas de `api` declaradas `security_invoker` (ADR-006 §5).

Medido en E13: `auth.uid()` dentro de la consulta devuelve el `sub` del JWT; el
usuario miembro ve su fila; el que no es miembro no la ve; la vista
`security_invoker` **no salta la RLS**; y una vista ejecutada como su
propietario devolvió **todas** las filas incluso sin JWT, por lo que no es el
camino normal de lectura.

### 2. El helper de membresía

Se adopta un helper reducido, `sec.is_member(scope)`, como **mecanismo normal**
para resolver la pertenencia en las políticas que la necesiten.

Características **obligatorias**:

- `SECURITY DEFINER`;
- `STABLE`;
- `SET search_path = ''`, con **referencias totalmente cualificadas**;
- usa `auth.uid()` **internamente**;
- acepta el ámbito necesario;
- **no acepta un `user_id` arbitrario como parámetro**;
- devuelve **únicamente la decisión mínima**, idealmente `boolean`;
- **no se convierte en una API genérica de lectura de membresías.**

Que no acepte identidad ajena no es cosmética: `is_member(scope, user)` sería un
oráculo de pertenencia gratuito para cualquiera que pueda invocarlo.

`search_path = ''` y no `= core` es deliberado, porque el `extra_search_path` de
la Data API incluye `public` siempre.

### 3. Privilegios del helper

Se adopta el patrón que E13 midió:

- `GRANT EXECUTE` sobre el helper a `authenticated`;
- **sin `USAGE`** sobre el schema `sec`.

Medido: **la política almacenada puede usar el helper**, mientras el usuario
**no puede invocarlo directamente por nombre** a través de esa superficie
—`permission denied for schema`—. Se obtiene la función sin regalar el oráculo.

Se mantiene además `REVOKE EXECUTE ... FROM PUBLIC` (ADR-006 §4) y `sec` fuera
de los schemas expuestos y de los search paths de las superficies API (ADR-006
§6).

**Esta propiedad deberá quedar respaldada por tests de aislamiento**, no por
confianza en la configuración.

### 4. Consecuencia sobre la tabla de membresía

E13 midió una ventaja que no estaba prevista: **usando el helper en la política,
`authenticated` no necesita `SELECT` directo sobre la tabla de membresía** para
que otras políticas comprueben pertenencia.

Por tanto:

- **No se concede `SELECT` sobre la tabla de membresía al rol cliente**, salvo
  que una funcionalidad concreta lo requiera y lo haga mediante una superficie
  autorizada.
- **La lectura visible de los miembros de un grupo se hace por la superficie de
  `api` correspondiente**, con su política y su autorización, **no por acceso
  directo** a la tabla.

El helper no solo rompe la recursión: **reduce los privilegios necesarios**.

### 5. Claims en el JWT

**No se usan claims de membresía en 3.C.**

**Motivo, y es de producto, no técnico:** la autorización de grupo debe
reaccionar **inmediatamente** a una expulsión o a una pérdida de acceso. Con la
lista de ámbitos dentro del token, expulsar a alguien no surte efecto hasta que
su token se refresca; en este stack `jwt_expiry = 3600`, es decir hasta **una
hora** de acceso residual a un ámbito compartido. Para una aplicación de
finanzas compartidas entre personas que se conocen —y que a veces se dejan de
conocer— esa ventana no es un detalle de rendimiento.

Esto **no prohíbe** usar claims más adelante para información **no
autoritativa**, o para capacidades donde la eventualidad sea aceptable.

### 6. Tabla de visibilidad derivada

**No se crea en 3.C.** Solo podrá reconsiderarse si una medición futura
demuestra que la estrategia normal tiene un problema real de rendimiento. **No
se introduce una segunda fuente de verdad preventivamente.**

## Alternativas consideradas

**A · Join directo con la tabla de membresía protegida por una política sobre sí
misma.** **Descartada por incorrecta**: recursa, y falla con `42P17`. Se recoge
porque es la forma ingenua y conviene que quede escrito por qué no funciona.

**B · Política reestructurada que evita el join sobre sí misma**, protegiendo la
tabla de membresía con una condición que solo mira su propia columna.

Es correcta, no necesita `SECURITY DEFINER` y no añade superficie de escalada.
**Descartada como forma general** por dos razones. La primera es de alcance:
deja de funcionar en cuanto un miembro deba ver a los demás miembros, que es un
requisito real de Nomey. La segunda la midió E13: con esta forma, el rol cliente
**necesita `SELECT` sobre la tabla de membresía**, mientras que con el helper no
lo necesita. Resulta que la opción «sin superficie nueva» es la que **más**
privilegio exige.

**C · Claims en el JWT.** Técnicamente es la más rápida —cero consultas por
fila— y esa ventaja es real. **Descartada** por la ventana de acceso residual
descrita en §5. Es una decisión de producto tomada con el coste técnico sobre la
mesa, no un descarte técnico.

**D · Tabla de visibilidad desnormalizada**, mantenida por la frontera de
escritura, con una política trivial.

Evita el `SECURITY DEFINER` y probablemente rinde bien. **Descartada** porque
cambia superficie de escalada por una **segunda fuente de verdad** que hay que
mantener transaccionalmente, y una derivación almacenada que se desincroniza
produce autorizaciones incorrectas en silencio. Queda como opción a reconsiderar
**si** hay medición que lo justifique.

## Consecuencias

### A favor

- **Expulsión inmediata**: el siguiente `SELECT` ya no ve el ámbito, sin esperar
  a ningún refresco de token.
- **Superficie de escalada reducida a una función auditable**, que devuelve un
  `boolean` y no acepta identidad ajena.
- **Menos privilegios que la alternativa sin helper**: el cliente no necesita
  leer la tabla de membresía.
- **Sin segunda fuente de verdad.**
- El usuario no puede invocar el helper por su cuenta, medido.

### En contra

- **Una consulta a la tabla de membresía por fila evaluada.** Depende del índice
  adecuado, y **el rendimiento con volumen no está medido**. Si resulta
  insuficiente, la vía es medir y reconsiderar la alternativa D, no relajar la
  política.
- **Un `SECURITY DEFINER` en el sistema**, que por definición salta la RLS y hay
  que revisar como frontera de privilegio en cada cambio.
- **Riesgo de que alguien «arregle» un `42P17` relajando una política.** Es el
  fallo que `AGENTS.md` §4 llama peor que el bug, y la única defensa real es que
  los tests de aislamiento comprueben **el caso positivo y el negativo**: una
  política relajada a permitir todo debe romper el test negativo.
- **Riesgo de que el helper crezca.** Un `SECURITY DEFINER` que hoy devuelve
  `boolean` y mañana devuelve filas es otra cosa, y por eso §2 lo acota
  explícitamente.
- **Se renuncia a la opción más rápida** por una razón de producto. Si esa razón
  cambiara, cambiarla exige un ADR sucesor.

## Fuera de alcance

- **Qué columnas proyecta cada vista y dónde ocurre el cast a texto** (**D6**).
- **Las funciones autoritativas de escritura** y cómo autorizan (**D7**).
- **Si la membresía se ancla al usuario o al participante**, que depende de la
  decisión sobre participantes sin cuenta (**D10**).
- **La forma concreta de los tests de aislamiento**, más allá de exigir que
  cubran el caso positivo y el negativo.
