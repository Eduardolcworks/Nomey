# Estado del proyecto

> **Memoria comprimida para una sesión nueva.** Describe **dónde está Nomey
> ahora**, no cómo llegó. No decide nada: si contradice un ADR,
> [`data-model.md`](architecture/data-model.md) o el
> [roadmap](product/roadmap.md), mandan ellos.
>
> **Léelo después de [`AGENTS.md`](../AGENTS.md).** Con esos dos, y la
> documentación específica de la fase en curso cuando exista, basta para empezar;
> el resto se consulta **bajo demanda**.
>
> **Cómo se mantiene:** [`runbooks/project-context.md`](runbooks/project-context.md).
> En una línea: **lo que deja de ser vigente se sustituye o se borra, nunca se
> apila debajo de lo nuevo.**

Actualizado el **2026-09-16**, al cerrar **F10.A3** (identidad permanente en
el grupo, F10/ADR-002; vínculo activo/histórico al salir y volver, F10/ADR-003;
modo Invitado real, F05/ADR-003); el siguiente bloque es **F10.B0**. La
**Fase 9** cerró el 2026-09-14. Incluye el cierre de **F11.A** (decisiones de
multimoneda, F11/ADR-001, sin implementación).

---

## Dónde estamos

|                         |                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Fases en curso**      | **Fase 8** (distribución interna: F8.A0 … F8.A5 cerrados, **F8.B** y **F8.C** pendientes) y **Fase 10** (ciclo de vida del vínculo: F10.A0 … F10.A3 cerrados; **F10.B0** es el siguiente, B1 … C0 pendientes). **Fase 11** abierta: **F11.A** cerrada (contrato, sin implementación) |
| **Última fase cerrada** | **Fase 9 — Grupos, gastos compartidos y deudas**, el 2026-09-14. **Validada en iPhone (Expo Go) y en el emulador Android**                                                                                                                                                           |
| **ADR aceptados**       | 46 de 47 (F00–F11; F00/ADR-001 sigue Propuesto), organizados por fase en docs/adr/FNN/                                                                                                                                                                                               |
| **Backend**             | Migrado y reconstruible desde cero, con CI verificándolo en cada PR. **50 migraciones**: las dos últimas dejan la identidad permanente (F10/ADR-002, retirando toda baja de vínculo) y el vínculo activo/histórico (F10/ADR-003: salir lo termina sin borrarlo)                      |
| **App visible**         | **Inicio escribe dinero real y funciona sin conexión**; **Grupos**: crear, invitar, gastos, saldos, pagos declarados, salir y volver                                                                                                                                                 |
| **Sesión**              | Email y contraseña, entrar, salir **y recuperar**; **modo Invitado** real (sesión anónima, convertible en cuenta sin cambiar de id; F05/ADR-003). **Faltan Google y Apple** (F8.B)                                                                                                   |

**La Fase 8 está ABIERTA.** F8.A0 aceptó
[F08/ADR-001](adr/F08/ADR-001-native-code-model.md) y
[F08/ADR-002](adr/F08/ADR-002-environments-and-variants.md) y partió la fase en tres
bloques trazables; **F8.A1 hizo ejecutable ese contrato**, **F8.A2 dejó la
cadena nativa lista**, **F8.A3 compiló, instaló y validó la primera build
propia de Android** , **F8.A4 demostró que esa build se comporta como
aplicación nativa completa** y **F8.A5 compiló el primer Staging independiente de
Metro y validó su canal**. **La Fase 8 NO está
cerrada ni puede estarlo todavía**, porque dos de sus cuatro criterios
originales siguen sin cumplirse; el estado criterio a criterio está en el
[roadmap](product/roadmap.md), Fase 8.

**La Fase 9 está CERRADA (2026-09-14).** Sus cinco criterios están
contrastados uno a uno en el [roadmap](product/roadmap.md) (Fase 9, «Estado de
cierre») y la evidencia, en el
[seguimiento de F9](architecture/phase-9-progress.md). Lo que dejó, y con qué
garantías:

- **Grupos con identidad generada por el cliente y provisioning atómico**
  (`api.create_group`, F09/ADR-001/033), edición del perfil
  (`api.update_group_profile`), invitación por enlace o QR con
  previsualización y canje (`create_group_invitation`, `preview_invitation`,
  `redeem_invitation`, `revoke_group_invitation`, F09/ADR-004).
- **Gasto de grupo con pagador único y participantes por operación**, reparto
  `equal` con resto determinista (los mismos 22 vectores en dominio y
  servidor), corrección y anulación versionadas; lecturas `group_operation`,
  `group_split_participant`, `group_summary`, `group_balance`,
  `group_pending_pair`, `group_reopened_pair`.
- **Pagos sugeridos y «Saldado» como pago declarado** (`record_group_payment`,
  F09/ADR-007): caja en los dos Personales y deuda, la declare el pagador o el
  receptor; CAS sobre la foto de netos que la pantalla enseñó; no se edita, se
  anula. **Salir exige neto cero** y la salida reasigna los pares compensados
  sin dinero (novación, F09/ADR-007 C8); **volver a entrar** conserva la identidad
  (F09/ADR-010); **asociar un fantasma a la propia cuenta** es fusión de lectura
  con caja histórica incorporada una vez (F09/ADR-009); **retirar** a un fantasma
  (F09/ADR-005). **La identidad en el grupo es permanente** (F10/ADR-002): no hay
  forma de deshacer un vínculo; dejar de participar es salir del grupo, y al
  salir el vínculo **termina** sin borrarse (F10/ADR-003): quien salió es
  historia —fuera de Saldos, del recuento y de las listas; con su nombre y su
  atribución— y vuelve como entonces o como un participante sin cuenta.
- **Avisos internos en la campana** (`core.group_notice`, siete `kind` en
  `core`: `edit`, `profile`, `departure`, `settlement`, `payment`,
  `payment_annulled`; F09/ADR-003 §7). **Por decisión de producto (2026-09-14)
  el alta de un gasto y la reincorporación NO avisan**; el invariante 15 de
  `data-model.md` quedó fijado así. No hay push.
- **Verificado al cerrar:** 46 migraciones reconstruidas desde cero en una
  pila aislada con la suite SQL completa (30/30; siete scripts de carrera en
  CI; los de asociación y reincorporación entraron en CI en F10.A2);
  `vitest` 130 ficheros / 3737 tests; `npm run verify` limpio; validación
  manual en iPhone (Expo Go) y emulador Android: gasto pagado por otro
  miembro con el mismo resultado, reparto idéntico en los dos aparatos,
  «Saldado» con un solo pago, propuesta caducada entre dos aparatos sin
  segundo pago.

**Lo que la Fase 9 deja fuera, a propósito:** conversión monetaria (**F11**:
`CURRENCY_CONVERSION_UNSUPPORTED`), roles dentro del ámbito (no existen;
`core.membership` no tiene columna de rol), el ciclo de vida del vínculo
propio, la cesión consentida y las fusiones pendientes (**F10**, ahora abierta:
ver abajo; la revocación del vínculo ajeno queda **prohibida**), la transferencia ordenada desde la app (F12,
invariante 14) y la «liquidación sólo deuda» del escenario 4.5, que sigue en
el writer (`record_debt_settlement`) sin superficie en la app. Trasladados
como tareas explícitas, no como funcionalidad: la **retirada técnica de
`api.settle_participant`** y la incidencia de **ParticipantField** (no
reproducida).

**La Fase 10 está ABIERTA (2026-09-14); F10.A0 … F10.A3 cerrados (A3 el
2026-09-16); el siguiente bloque es F10.B0, y B1 … C0 siguen pendientes.** Su alcance
original —invitación, prueba, reclamación retroactiva, fusión de duplicados— lo
cerró F9, así que la fase se reescribió en el [roadmap](product/roadmap.md)
(Fase 10); la reconciliación, las mediciones previas y los insumos de sus ADR
están en [`phase-10-opening.md`](architecture/phase-10-opening.md). El
contrato de la identidad lo fijan
[F10/ADR-001](adr/F10/ADR-001-link-instance-lifecycle.md) (Aceptado, 2026-09-14:
identidad y procedencia de cada instancia de vínculo, línea base bajo el
cerrojo), **[F10/ADR-002](adr/F10/ADR-002-permanent-identity.md) (Aceptado,
2026-09-15)**, que supera de ADR-001 todo lo relativo a **dejar** la
instancia, y **[F10/ADR-003](adr/F10/ADR-003-active-and-historical-link.md)
(Aceptado, 2026-09-15)**: el vínculo es **activo** o **histórico**. Lo que hay
que saber antes de tocar identidad:

- **Ninguna cuenta adjudica unilateralmente la identidad de otra.** No existe
  ni existirá en F10 revocación del vínculo ajeno, expulsión, roles ni soporte
  de disputas; la RLS vigente ya lo impone (políticas del provisioner sobre
  vínculo y membresía acotadas al propio actor) y F10 lo guarda en catálogo.
- **La identidad en el grupo es permanente.** Vincularse —crear el grupo,
  entrar como nuevo o reclamar— fija `participant ↔ user` para siempre en ese
  grupo: no hay `unclaim`, ni `unlink`, ni «Me equivoqué», ni «Dejar mi
  identidad», ni forma de devolver el participante a «sin cuenta». Reclamar
  pide confirmación diciéndolo («mientras formes parte del grupo, este será tu
  participante»). Dejar de participar es **Salir del grupo**, con la economía
  exacta de F9 (neto cero, novación de pares vivos, presencia cerrada,
  membresía borrada) y, desde F10/ADR-003, con el **vínculo conservado y
  terminado** (`ended_at`, `departure_id`): quien salió es **historia**, no un
  participante sin cuenta —no está en Saldos, en el recuento ni en las listas
  del presente (`api.group_participant.is_departed`); su nombre y su
  atribución siguen; nadie puede reclamarlo, retirarlo ni asociarlo—. Al
  volver con invitación elige **volver como entonces** (el mismo vínculo se
  reactiva; `link_id` y procedencia intactos) **o** un participante sin cuenta
  disponible; nunca «nuevo» (`REJOIN_REQUIRED`). Una sola identidad activa
  por cuenta y grupo (índice parcial). Un participante vinculado, activo o
  histórico, no es reclamable ni retirable por nadie.
- **Cada instancia de vínculo tiene identidad (`link_id`, interna: el cliente
  no la lee) y procedencia (`origin_command_id`, nula si no es demostrable)
  separadas** (F10/ADR-001 §1). Al nacer se escriben bajo el cerrojo su `S0` y
  su línea base (`core.link_baseline_subject`, `core.link_baseline`, §3):
  auditoría insert-only de lo que existía en ese momento, sin lector de
  producto; ningún timestamp es autoridad. La migración `20260917120000` retiró
  la superficie de la baja de F10.A2 (`api.unlink_participant`,
  `sec.unlink_instance`, el evaluador, `core.participant_unlink`, el `kind`
  `identity_released`) y el legado de F9 (`api.unclaim_participant`,
  `claim_command_id`, `sec.my_claim_command_id`).
- **La cesión A → B, si entra, es atómica con prueba de un solo uso**
  (`identity_handover`); componer «A deja la identidad → B la reclama» deja una
  ventana de apropiación y **no se acepta como producto**. Fantasma ↔ fantasma
  se decide en `F10/ADR-004` sobre su matriz económica (extingue las
  obligaciones entre ambos, consolida las de terceros, reversible por lectura).
- **Un grupo puede quedar sin ninguna cuenta miembro** (hecho heredado de F9,
  medido): con invitación viva cualquiera recupera el acceso y nadie puede
  revocarla; sin ella el grupo es inaccesible. F10 no lo cambia; queda
  registrado como consecuencia que merece decisión futura.

**F11.A está CERRADA, y es sólo contrato: la multimoneda todavía no existe en el
código.** [F11/ADR-001](adr/F11/ADR-001-fx-rate-resolution.md) fija lo que F11.B y F11.C
implementarán; hoy toda operación en una moneda distinta de la base sigue
respondiendo `CURRENCY_CONVERSION_UNSUPPORTED · 422`. Lo que una fase futura no
debe deducir por su cuenta:

- **El tipo del día X se resuelve por moneda y se fija una sola vez**, con la
  primera observación completa de Nomey posterior a las 00:00 de X en hora de
  Fráncfort ([F11/ADR-002](adr/F11/ADR-002-per-currency-daily-rate.md)). Cada
  moneda usa su tipo en R(X), la publicación del BCE más reciente anterior a X,
  o, si falta ahí, en la publicación anterior P(X), **nunca más atrás**: el
  límite se cuenta en publicaciones, no en días. Si falta en las dos, esa
  moneda da 422. Un dato que aparece después no recalcula ningún día fijado. La
  conversión es inmediata, y ni la hora de la operación ni el momento de
  sincronizar cambian el tipo.
- **Una moneda ausente no invalida la observación; un valor corrupto sí.** Un
  valor presente pero inválido deja el día sin fijar, y **503 queda sólo para un
  día sin fijar**, nunca para una moneda retrasada. Una retirada registrada en
  la cobertura curada prevalece sobre el límite y da 422, sin quitar la moneda
  del catálogo.
- **Moneda extranjera sólo en gasto e ingreso personales y en gasto de grupo**,
  sobre el contrato de F9. Las demás clases conservan su negativa a convertir.
  **Sin decidir, en F11.D:** si se convierte o se rechaza la caja que se
  incorpora al asociar un fantasma que pagó un gasto de grupo, y cómo se reparte
  un `exact_amounts` en moneda extranjera
  ([decisiones abiertas](architecture/phase-11-progress.md#decisiones-abiertas)).
  **Condición de seguridad, no decisión:** F11.B no habilita moneda extranjera
  en `record_group_expense`; se habilita en F11.D, después de decidir los dos
  casos. Habilitarla antes haría que `sec.incorporate_participant_cash`
  escribiera la caja de un gasto en USD como si fuera la base del Personal.
- **F11.B no se despliega sin F11.C** (dependencia de planificación, no una
  decisión monetaria): antes de habilitar en producción operaciones personales
  en moneda extranjera tienen que estar resueltas `api.personal_operation` y las
  lecturas y estadísticas afectadas, que hoy publicarían el importe original con
  la moneda del efecto
  ([seguimiento de F11](architecture/phase-11-progress.md#dependencia-de-planificación-f11b-no-se-despliega-sin-f11c)).
- **Liquidar entre bases distintas sigue sin poderse, y es conocido.** F9 ya lo
  restringe: quien tiene un Personal en otra moneda que la del grupo no puede
  declarar ni recibir un pago, y por eso tampoco salir con saldo. **No es un
  fallo de la integración F9 + F11, queda fuera del alcance de F11 y F11.B no
  lo implementa.** Detalle en el
  [seguimiento de F11](architecture/phase-11-progress.md#limitaciones-conocidas).
- **La cobertura es por moneda y par, nunca por país.** ARS, COP y CLP siguen en
  el catálogo y no se convierten, porque el BCE no las cubre.
- **No hay tipo manual**, y un tipo congelado no se toca.
- **Tres resultados que no se confunden:** `FX_CURRENCY_NOT_COVERED · 422`,
  `FX_RATE_NOT_YET_AVAILABLE · 503` y el conflicto de base, que conserva
  `CURRENCY_CONVERSION_UNSUPPORTED`.
- **El payload llevará la base asumida al capturar**
  (`expected_base_currency_definition_id`); `record_group_expense` la
  incorporará en una migración nueva sobre su cuerpo vigente de F9.

**F8.A1 dejó el contrato de entornos funcionando, y no hay ninguna build.** Las
tres variantes se resuelven, se comparan y se exportan. Lo que hay que saber
para usarlo está en [`runbooks/environments.md`](runbooks/environments.md), y en
una línea:

- **`APP_VARIANT` selecciona la identidad y pertenece al comando, nunca a
  `.env`.** Ausente resuelve `development`, desconocida **falla nombrando las
  válidas**, y **producción no se selecciona nunca sola**. `npm start` la nombra
  en voz alta; `node scripts/with-variant.mjs <variante> <args>` es la vía
  general, y funciona igual en Windows y en Linux sin dependencia añadida.
- **El proyecto de EAS existe: `@lcworks/nomey`.** `runtimeVersion` con política
  `appVersion` —no `fingerprint`, que sigue siendo experimental—, `version`
  `1.0.0`, `versionCode` 1 y `buildNumber` `"1"`. La consecuencia que muerde
  tarde: **una actualización sólo llega a un binario cuyo runtime coincide**, así
  que cualquier cambio nativo del que dependa el JavaScript exige subir
  `version` y compilar de nuevo. **No se ha publicado ninguna actualización**:
  todavía no existe la build de Staging que pudiera recibirla.
- **El canal viaja en el binario**, como cabecera `expo-channel-name`, porque
  Nomey no usa EAS Build y no hay perfil donde declararlo. **No hay `eas.json`**,
  y no lo habrá mientras nadie ejecute nada de él.
- **La configuración de Staging vive en el entorno EAS estándar `preview`**, con
  las tres variables del contrato y visibilidad `plaintext`, porque un APK sin
  Metro no tiene el `.env` de nadie. `scripts/eas-preview-sync.mjs` las escribe
  validando antes por la frontera real, y
  `eas env:exec preview "node scripts/staging-env-verify.mjs"` las comprueba sin
  dejar `.env` ni artefactos. **`production` y `development` no tienen ninguna.**
  **Hay que reejecutar el sync cuando cambie la URL LAN**, o Staging quedará
  apuntando a una dirección muerta — y eso no falla al publicar, falla en el
  aparato. **El canal `staging` todavía NO existe** y hay que crearlo antes de
  la primera publicación.
- **La guarda del bundle ya corre en CI, y sin un solo secreto de repositorio.**
  Las dos `EXPO_PUBLIC_` son configuración pública, así que CI las pone
  **ficticias** y revisa las tres variantes. Además **siembra un secreto a
  propósito para comprobar que la guarda falla**: una comprobación de ausencia
  que nunca se ha visto fallar no demuestra que sepa encontrar nada.
- **Staging todavía apunta al stack local**, alcanzado por la red local. Lo que
  lo separa de Development es la identidad, el artefacto sin Metro y el canal —
  **no el backend**. El criterio «un entorno distinto del local» sigue
  **pendiente**, y no se dará por cumplido renombrando nada.

**F8.A2 dejó la máquina capaz de generar el proyecto Android, y nada más.** No
compila, no instala y no arranca la app: eso es F8.A3. Lo reproducible está en
[`runbooks/android-build.md`](runbooks/android-build.md), y lo que conviene
saber es esto:

- **La cadena es JDK 17 + SDK Platform 36 + command-line tools**, con
  `JAVA_HOME` y `ANDROID_HOME` persistentes de usuario y `ANDROID_SDK_ROOT`
  **deliberadamente sin definir** —está obsoleta, y tener las dos es cómo
  acaban apuntando a sitios distintos—. **El JBR de Android Studio no sirve como
  JDK del proyecto**: es un OpenJDK 25 y la cadena espera 17.
- **`compileSdkVersion 36` no es una suposición**: es el valor por defecto de
  `expo-modules-core`, en `ProjectConfiguration.kt`. Por eso la 35 y la 37 que
  ya había instaladas no valían.
- **`prebuild --clean` de Development se ejecuta y se verifica**, con
  `scripts/android-project-check.mjs`: identidad `es.lcworks.nomey.dev`, **cero
  rastro de Staging o Producción**, updates apagadas y sin canal, plugins
  aplicados —incluidas las reglas de backup de F05/ADR-001—, colores del tema y
  ninguna credencial dentro. **No hizo falta ninguna edición manual**, que es lo
  que F08/ADR-001 exigía demostrar.
- **`/android` sigue ignorado y es un artefacto.** Se edita `app.config.ts` o un
  plugin y se regenera; una edición a mano sobrevive hasta el siguiente
  `--clean` y desaparece sin avisar.
- **El primer plano del icono adaptativo pasó de 512 a 1024**, que es un cambio
  de **resolución y no de geometría**: `scripts/icon-geometry-check.mjs` mide la
  fracción del lienzo que ocupa la marca, su aspecto y su centro, en vez de
  comparar bytes. Corre en CI, porque un PNG cambia entero en un diff y no dice
  nada. **La fracción vigente es 0.54, fijada en F8.A3**; el 0.5996 que dejó
  F8.A2 ya no es lo que hay.
- **Las dependencias están alineadas con SDK 57 y `npx expo-doctor` da 21/21.**
  Eran doce paquetes desalineados, **todos por versión de parche** dentro del
  mismo SDK; `npx expo install --fix` los alineó y `expo install --check` dice
  «up to date». **F8.A2 no se cierra con un check en rojo justo antes del primer
  Gradle**: un aviso de compatibilidad que ya estaba ahí es indistinguible de
  uno que aparece al compilar.

> **Una observación de `expo-image@57.0.4` para F8.B, no para ahora.** Esa
> versión trae un config plugin que Expo sugiere declarar, y que hace **una sola
> cosa**: fijar `expo-image.disable-libdav1d` en las propiedades del **Podfile de
> iOS**. **No toca Android en absoluto**, y sin él `expo-doctor` da 21/21 igual.
> Se decide cuando exista un proyecto de iOS que generar, no antes.

**F8.A3 puso Nomey en dos aparatos Android, fuera de Expo Go, y saldó la mitad
Android de la deuda visual de F4.** Lo reproducible está en
[`runbooks/android-build.md`](runbooks/android-build.md); lo que no conviene
volver a deducir es esto:

- **La development build es Nomey, no un contenedor ajeno.** `expo-dev-client`
  `~57.0.18` sólo añade la capacidad de cargar el JavaScript desde Metro; el
  binario es `es.lcworks.nomey.dev` con su icono, su splash y sus módulos.
  **Validada en el emulador `Pixel_7` (x86_64) y en un POCO X4 Pro 5G
  (arm64-v8a)**, con Metro sirviendo cuatro bundles —el inicial de 2112 módulos
  y tres recargas incrementales— y sin un solo crash nativo. **En el móvil Expo
  Go ni siquiera está instalada**, así que allí es imposible confundirlas.
- **La deuda visual de F4 queda saldada en Android.** Icono amarillo recortado
  por la máscara real de dos lanzadores distintos, icono monocromo verificado
  con «Iconos temáticos» del `Pixel_7`, splash negro con el símbolo amarillo, y
  **ausencia de destello blanco medida, no supuesta**: 50 fotogramas de un
  arranque en frío en el móvil, con luminancia media de **1,9 a 3,1 sobre 255**
  durante el splash y ningún fotograma claro. **La mitad iOS sigue pendiente, y
  es de F8.B.**
- **La marca del icono adaptativo ocupa 0.54 del lienzo, no 0.60.** La zona
  segura de Android permite 0.60, pero visto en un lanzador real el símbolo leía
  grande dentro de su círculo. **Una sola constante gobierna las dos capas** —
  primer plano y monocromo—, porque son el mismo icono en dos modos y separarlas
  haría que la marca cambiase de tamaño al alternar. Lo vigila
  `scripts/icon-geometry-check.mjs`, que corre en CI.
- **Gradle instala NDK y CMake 3.22.1 por su cuenta**, y F8.A2 se equivocó al
  decir que no harían falta: con `newArchEnabled=true` hay C++ que compilar. No
  se instalan a mano, y explican buena parte de los **35 min 42 s** de la primera
  compilación —las siguientes bajan a **2–3 min**—.
- **MIUI acota lo que se puede automatizar en un Xiaomi.** La **primera**
  instalación por ADB se rechaza con `INSTALL_FAILED_USER_RESTRICTED` y hay que
  hacerla a mano; **las actualizaciones posteriores sí pasan por ADB**.
  `adb shell input` está bloqueado, así que la interfaz del móvil no se pilota
  por software. Y **Metro se alcanza por `adb reverse tcp:8081 tcp:8081`**, no
  por LAN: el cortafuegos de Windows bloquea el puerto entrante.

**F8.A4 reprodujo dentro del binario propio la matriz que la Fase 7 validó en
Expo Go, y añadió lo que Expo Go no podía probar.** Dos actores desechables
sobre el emulador `Pixel_7` y el stack local; el detalle está en
[`runbooks/android-build.md`](runbooks/android-build.md) §12. Lo que no conviene
volver a deducir:

- **La sesión vive en SecureStore, y el aislamiento entre actores es real.**
  Sobrevive a un cierre en frío sin servidor, y un segundo actor no vio nada del
  primero: ámbitos disjuntos, y **cero ámbitos con efectos de dos actores**
  medido sobre la base.
- **Una operación remota por clave, sin duplicados.** Tres altas, tres claves,
  ninguna clave con más de una operación. La sincronización al volver el
  servidor fue **silenciosa y sin recargar nada**, y ninguna cifra saltó.
- **Un rechazo terminal no quema la clave.** Con la frontera respondiendo
  `CATEGORY_NOT_USABLE`, el censo se quedó igual —mismas operaciones y mismas
  claves—: la reclamación de F03/ADR-008 §13 vive dentro de la transacción que el
  rechazo aborta. Pulsar `Sí` en la incidencia tampoco creó ninguna.
- **La forma excepcional de F07/ADR-002 no tiene ruta manual, y sí tiene pruebas.**
  Sus dos disparos son condiciones que el cliente no puede producir: `conflict`
  exige una moneda distinta de la base del ámbito —hoy sólo EUR, e inmutable con
  efectos— y `review` exige reutilizar una clave, justo lo que el cliente evita.
  **Que no haya ruta desde la interfaz no significa que no esté probada**: la
  frontera produce los dos códigos y `scripts/offline-taxonomy-probe.sh` los
  mide contra el stack real, y presentación, persistencia y resolución están en
  `personal-incidents.test.ts` §10, §14, §3, §12, §8 y §11 y en
  `personal-incident-flows.test.ts` §1, §4 y §5. **No se traslada a ninguna
  fase.** Lo único que F8.A4 no afirma es haberla pulsado a mano en el aparato.
- **`Deudas` sale del snapshot cargado, y distingue tres cosas que se
  confundían.** Llevaba un marcador de interfaz fijo aplicado como parámetro por
  defecto, así que enseñaba `0,00 €` **siempre**, con servidor y sin él.
  **Cuidado con la corrección obvia**: quitar el marcador y dejar el defecto en
  `null` cambia un cero permanente por un desconocido permanente, que es
  igualmente falso. Ahora la prop **no tiene valor por defecto** —el compilador
  obliga a pasarla— y `homeDebt` resuelve desde `home.balance`: sin snapshot,
  no disponible; con snapshot y ninguna deuda, **cero conocido**; con deudas, su
  suma con signo. **`loaded` es «llegó el dato», nunca «hay red»**, y por eso un
  refresco que falla sobre un snapshot conservado no vuelve a desconocer nada.
  El cero de hoy es derivado, no supuesto: una dimensión de deuda sólo llega a un
  ámbito personal por `core.participant_user_link`, que en F8.A4 no tenía ruta
  de escritura y hoy la escriben `create_group`, `redeem_invitation` y
  `associate_participant` (F9). La lógica
  vive en `src/features/personal/debt-display.ts`, y un texto ilegible es
  desconocido y nunca cero — que es donde `toMinor` no sirve.
- **`supabase start` con éxito no demuestra que Kong esté en pie.** El stack
  puede quedarse con Postgres, GoTrue y PostgREST vivos y el gateway parado, y en
  ese estado la CLI sale con código 0 y `54321` no contesta. Lo comprueban ahora
  los tres scripts que hablan HTTP, con `exigir_frontera_http` de
  `scripts/local-db-guard.sh`, que **diagnostica y no toca ningún contenedor**.

**F8.A5 puso en un aparato el primer Staging que no depende de Metro, con su
canal.** Procedimiento en [`runbooks/environments.md`](runbooks/environments.md);
lo que no conviene volver a deducir:

- **Se compila con `npm run staging:build`, y ese comando carga `preview`
  siempre.** Un APK inlinea `EXPO_PUBLIC_*` al compilar: sin esas variables sale
  con la configuración vacía, no falla al compilar ni al instalar, y falla en el
  aparato. `scripts/gradle-release.mjs` lo exige antes de gastar Gradle.
- **La firma es la de depuración, y es estable.** El proyecto generado por CNG
  firma `release` con `debug.keystore`. Medido: **byte a byte idéntico** entre
  regeneraciones de `prebuild --clean`, y el APK lleva ese mismo certificado. Su
  certificado es **público y compartido** por cualquiera que use la plantilla de
  React Native, así que sirve para distribución interna y **no para Google Play**.
  La firma de producción se decide en **F8.C**.
- **Una build de release NO habla HTTP sin cifrar**, y eso no se ve venir: el
  `usesCleartextTraffic` de la plantilla vive **sólo** en el manifiesto de debug.
  Lo concede `plugins/with-local-http.js` —el primer config plugin local de
  Nomey, F08/ADR-001 §3— acotado a `127.0.0.1` y `localhost`, y **sólo para Staging**.
  Production no lo lleva, comprobado sobre su proyecto generado.
- **El ciclo de `expo-updates` son DOS arranques.** El primero descarga en
  segundo plano, el segundo arranca la actualización. Una prueba de un solo
  arranque concluye que no llegó.
- **`runtimeVersion` manda sobre el canal.** Una actualización publicada con
  `version` `1.0.1` **no llegó** al binario `1.0.0` ni tras dos ciclos, sin aviso
  ninguno. Cualquier cambio nativo del que dependa el JavaScript exige subir
  `version` y compilar de nuevo.
- **El criterio 2 de la Fase 8 sigue abierto.** Staging apunta al **mismo stack
  local** por `adb reverse`: independiente de la red, **no** de este ordenador ni
  del cable. F08/ADR-002 §4, que no se reinterpreta.

Cuatro cosas más que conviene tener claras antes de tocar cualquier cosa nativa:

- **El modelo de build es CNG, y ya no es una suposición.** `/ios` y `/android`
  son artefactos: no se versionan, no se editan y se regeneran sin pérdida. Lo
  nativo propio —incluidas las extensiones de F16— se expresa como **plugin
  local versionado** y se consume desde **un único punto de `src/lib/`**, nunca
  desde `features/`. Salir de CNG exige un ADR nuevo que **demuestre** una
  limitación material, no que la señale como incómoda.
- **Hay tres identidades instalables a la vez**, no dos: `Nomey Dev`
  (`es.lcworks.nomey.dev`, scheme `nomey-dev`), `Nomey Staging`
  (`es.lcworks.nomey.staging`, `nomey-staging`) y `Nomey`
  (`es.lcworks.nomey`, `nomey`). **El identificador de producción es
  definitivo**: es DNS inverso de `lcworks.es`, dominio que el propietario de
  Nomey controla, y que será la base de los enlaces universales, el correo de
  autenticación, el soporte y las páginas legales. **Hoy no hay ningún DNS ni
  servicio web configurado**, y no se configura en esta fase.
- **Se adopta EAS Update, no EAS Build.** Android se compila localmente. De ahí
  sale la regla que más tarde muerde: **EAS Update no añade recursos nativos**,
  así que un icono, un permiso o un módulo nuevo exigen binario nuevo.
- **Nomey llevará dos iconos, y los dos tienen que estar en el binario antes de
  publicar.** El amarillo es el predeterminado y el negro es el distintivo de
  Premium. El comportamiento —activarlo con la suscripción, alternarlo desde
  Ajustes, volver al amarillo al terminar, y **no** cambiar por ello la estética
  interior— es **trabajo de F14**; F08/ADR-001 §5 sólo fija que el modelo de build
  lo admite y cómo. No hay selector, ni entitlement, ni cambio de icono
  implementado.

**La Fase 7 está CERRADA, y con ella el tercer pilar del producto.** Un gasto se
registra sin conexión, aparece de inmediato como uno normal y se sincroniza solo
al volver la red, **sin duplicar dinero jamás**. Lo que entregó cada bloque, qué
se validó físicamente y qué queda fuera están en
[`phase-7-handoff.md`](architecture/phase-7-handoff.md).

Cuatro cosas de la Fase 7 que una fase futura tiene que conocer:

- **El alta sale por la cola y por ninguna otra puerta.** La escritura directa
  para altas ya no existe; `personal-service` la refuerza con una guarda.
  `useRecordMovement` se queda sólo con las correcciones, que tienen CAS propio
  y **no se encolan** (F07/ADR-001 §4).
- **La proyección optimista es una excepción acotada y una sola función.** Todas
  las superficies de Inicio leen `projectHome`, que reutiliza `src/domain/effects`
  para que cliente y frontera sean la misma aritmética. **No se persiste ningún
  agregado económico**: lo único duradero es el comando inmutable.
- **Una respuesta remota sólo es base si su ventana fue quieta.** `confirm_seq`
  reconcilia, pero no puede ver una escritura del servidor anterior a que el
  cliente se entere; por eso el envío se marca durablemente con `dispatch_seq`
  antes del transporte. Sin esa barrera, un movimiento se cuenta dos veces.
- **La campana es la única superficie visible de la cola**, con dos formas y
  ninguna palabra de la maquinaria en pantalla
  ([F07/ADR-002](adr/F07/ADR-002-incident-labels-and-review-destination.md)).

**La Fase 6 sigue CERRADA** y su handoff vigente:
[`phase-6-handoff.md`](architecture/phase-6-handoff.md).

**F6.A cerró la fundación de datos del Modo Personal**, sin pantalla y a
propósito: catálogo monetario sembrado con identidades fijas, un **tercer rol**
`nomey_provisioner`, y las funciones que crean el ámbito con su membresía y
eligen su moneda. La decisión es
[F06/ADR-001](adr/F06/ADR-001-personal-provisioning.md) y la evidencia,
[`supabase/e21/`](../supabase/e21/README.md).

> **Backend sí, app todavía no.** `api.ensure_personal_scope` existe, es segura e
> idempotente, y está verificada por HTTP con JWT real y bajo concurrencia. Pero
> **la aplicación no la invoca en ningún punto de su ciclo autenticado**, así que
> hoy una cuenta recién confirmada **sigue sin Modo Personal** hasta que alguien
> llama a la función. Ese cableado es de **F6.E**, antes de que Inicio consuma el
> ámbito.

**F6.G cerró la fase igualando Android con iOS.** No añadió pantallas: la
misma implementación se veía distinta en cada plataforma, porque **Android no
funde las capas de un `boxShadow`** —dibuja una silueta por entrada— mientras
que iOS compone la lista entera de una vez. De ahí salen **tres materiales de
Android**, definidos en `ui/theme/elevation.ts` y resueltos en `ui/theme/depth.ts`:
`control` (relleno `#1D1D1D`, rim base `0.20` y acento superior `0.08`, sin
sombras), `window` (gris plano `#191919` y rim continuo, para los paneles) y
`translucent-control` (conserva relleno y alfa, retira `inset` y proyección,
añade el rim). **iOS no conoce ninguno**: sus ficheros gemelos devuelven `null`,
así que su ruta de renderizado no cambió ni un nodo. Quedan deliberadamente
fuera las tarjetas de Inicio, el `+`, el cristal del dock y el donut.

El bloque corrigió además tres defectos visuales —la costura de un píxel del
toroide, el indicador del selector de intervalo que se salía en los extremos, y
los iconos de categoría grises en las tarjetas de flujo— y **abrió la categoría a
la corrección**, con la composición `importe | € | categoría` en una sola fila y
la ventana en su tamaño original. Ninguno de los tres tocó una regla de dominio,
y **no hizo falta ninguna migración**: `category_id` ya viajaba de punta a punta
desde F6.B. Los detalles, con sus causas medidas, están en el handoff.

**F6.F cerró la escritura, y con ella el Modo Personal se usa de verdad.**
Añadir un movimiento, corregirlo, anularlo y fijar el Disponible ocurren desde
la pantalla, cada uno por su función canónica —`record_personal_expense`,
`record_personal_income`, `record_adjustment` y `annul_operation`— y detrás de
los controles que F6.E ya había dejado puestos. Tres cosas que conviene saber
antes de tocarlo:

- **Corregir es una versión nueva, no un `UPDATE`.** El CAS viaja en
  `expected_version_id`, que la lista ya publicaba, y anular es terminal.
- **Después de escribir se refresca contra el servidor**, nunca se suma el
  importe en el cliente: el saldo y los totales los deriva la frontera, y una
  suma optimista sería una segunda aritmética. El optimismo con cola es de F7.
- **La categoría se elige en el menú nativo de la plataforma** —`Menu` de
  SwiftUI en iOS, `DropdownMenu` de Compose en Android—, con el catálogo vivo
  y la marca de selección del sistema. Su implementación de iOS está partida en
  dos capas a propósito, y el porqué está escrito en el propio componente.

**F6.E encendió la pantalla.** Inicio deja de ser un marcador de posición:
saldo real, selector de intervalo, ingresos y gastos desplegables, reparto por
categoría e historial con su «Editado». Y **la app por fin llama a**
`api.ensure_personal_scope`, que F6.A dejó lista y nadie invocaba — hasta
ahora una cuenta recién confirmada no tenía Modo Personal. Trajo además una
quinta superficie de lectura, `api.personal_statistics`, porque ninguna de las
cuatro de F06/ADR-007 agrega por intervalo y agregarlo en cliente habría dado una
cifra incompleta que no falla: medido, PostgREST 16.1 rechaza los agregados
con `PGRST123` y `max_rows` corta en 1000.
[F06/ADR-008](adr/F06/ADR-008-personal-statistics.md).

> Los controles que dejó como affordance —editar, eliminar y ajustar— son los
> mismos que F6.F conectó, sin rehacerlos.

**F6.D cerró la superficie de lectura**, y con ella el backend de la fase.
La **operación** es la unidad que se lee, no el efecto; una corrección deja
visible **qué había antes** —importe, concepto, categoría y hora, cada uno tal
como aquella versión lo declaró—; el **Disponible** se deriva y se entrega ya
agregado; y las **anuladas** no asoman por ninguna de las tres vistas. La
decisión es [F06/ADR-007](adr/F06/ADR-007-personal-read-surface.md).

> **Backend sí, app todavía no**, igual que A, B y C. Las consultas concretas
> del cliente y las pantallas son de F6.E y F6.F.

**F6.C cerró el saldo objetivo, la observación y la anulación**, también sin
pantalla. El cliente declara el saldo que dice tener y **el servidor deriva el
delta bajo lock**; cada escritura de saldo deja una **fotografía congelada** del
antes y el después que **nunca alimenta el Disponible**; y eliminar un
movimiento es una **versión sin efectos** que no borra nada. Las decisiones son
[F06/ADR-004](adr/F06/ADR-004-balance-target-and-serialization.md),
[F06/ADR-005](adr/F06/ADR-005-balance-observation.md) y
[F06/ADR-006](adr/F06/ADR-006-annulment.md); la evidencia de las carreras,
[`supabase/e22/`](../supabase/e22/README.md).

**F6.B dio anatomía al movimiento**, también sin pantalla: **concepto**
obligatorio, **categoría**, **hora efectiva**, y el **ingreso como clase real**
—la octava función, que el modelo contemplaba desde la Fase 1 sin ruta de
escritura—. Y cerró la obligación que dejó F6.A: **una clase ya no puede
corregir una operación de otra**. Las decisiones son
[F06/ADR-002](adr/F06/ADR-002-version-content-and-time.md) y
[F06/ADR-003](adr/F06/ADR-003-category-catalogue.md).

**La categoría es del gasto, y su icono es una clave semántica.** Con datos
reales en pantalla se vio que las tres categorías de ingreso no clasificaban
nada —parafraseaban el concepto que la persona ya había escrito—, así que
**F06/ADR-009** las retira junto a Suministros y Educación, deja diez de gasto y
saca la categoría de `core.movement_detail` a `core.expense_category`, una
relación propia con clave primaria sobre la versión. Tres cosas que conviene no
confundir después. **«Todo gasto tiene categoría» NO es una garantía
estructural**: la clave primaria da «como mucho una» y el `NOT NULL` más la FK
dan «la que hay es real», pero «al menos una» depende de `operation_class`, que
vive en otra tabla, y la sostienen la frontera autoritativa y el cierre de las
escrituras a `core` —medido: cero `CHECK` y cero triggers—. **Un ingreso con
`category_id` se rechaza por FORMA**, `PAYLOAD_INVALID · 400` antes de mirar a
qué apunta, lo que cambia su intención canónica y por tanto su idempotencia; se
acepta porque no hay producción. Y **el icono dejó de ser un nombre de SF
Symbol**: la base guarda una clave semántica de vocabulario cerrado y el cliente
resuelve el par `{ ios, android }`, porque un nombre de iOS dejaba Android sin
icono. [F06/ADR-009](adr/F06/ADR-009-expense-only-categories.md).

**La Fase 5 está cerrada**, con sus cuatro criterios del roadmap cumplidos y
verificados: se puede registrar, entrar, salir y recuperar el acceso; la sesión
sobrevive al reinicio y se renueva sola; las rutas protegidas son inaccesibles
sin sesión; y ninguna credencial privada de backend viaja en el bundle.

| Bloque    | Qué es                    | Estado                          |
| --------- | ------------------------- | ------------------------------- |
| **F5.A**  | Frontera y almacenamiento | **Cerrado**, validado en iPhone |
| **F5.B**  | Estado de sesión y rutas  | **Cerrado**, validado en iPhone |
| **F5.C1** | Email y contraseña        | **Cerrado**, validado en iPhone |
| **F5.C2** | Google y Apple            | **Diferido**, ver abajo         |
| **F5.D**  | Cierre de sesión y Perfil | **Cerrado**, validado en iPhone |
| **F5.E**  | Recuperación de acceso    | **Cerrado**, validado en iPhone |
| **F5.F**  | Cierre de fase            | **Cerrado**, validado en iPhone |

**Modo Invitado (F10.A3, [F05/ADR-003](adr/F05/ADR-003-guest-session.md),
Aceptado 2026-09-15).** «Entrar como invitado» en Entrar es una **sesión anónima
real de Supabase Auth** (`signInAnonymously`; `is_anonymous` en el usuario y
en el JWT, `role: authenticated`, el mismo `auth.users.id` que todo lo demás):
ningún estado propio, ninguna identidad paralela. El invitado aterriza en
Grupos y los usa como cualquier miembro —el servidor no lo distingue—; Inicio
es «Crea tu cuenta» (la única vía de cuenta: sin login dentro de la sesión) y
Perfil lleva el oblongo «CREAR CUENTA» → Inicio, los ajustes generales y un
«Cerrar sesión» discreto; el Personal interno se provisiona igual. **Crear cuenta desde un invitado conserva el
id** (`convertGuest` → `updateUser` con email, contraseña y nombre; el
correo se confirma fuera y el siguiente refresco trae la cuenta). **Entrar en
una cuenta existente desde un invitado falla cerrado** (`guestSignInBlocked`):
fusionar un invitado con una cuenta que ya existe no está resuelto y se
declara así. Local: `enable_anonymous_sign_ins = true`; **el proyecto alojado
tiene que activarlo en el Dashboard**, este repositorio no lo hace. Evidencia:
§14 de `scripts/http-boundary-check.sh`.

**Entrar con Google y con Apple queda diferido, y no bloqueó el cierre.** No
forma parte del alcance ni de los cuatro criterios de la Fase 5 en el roadmap:
se añadió como requisito de producto a mitad de fase. Sigue siendo una capacidad
de autenticación pendiente, y lo que la difiere es una dependencia real — el
login nativo de Google no funciona en Expo Go y exige un development build, y
Apple exige el programa de desarrollador.

**La Fase 8 no las implementa: las hace ejecutables**, que es lo que dice el
roadmap y manda sobre cualquier otra redacción. En concreto, **F8.A** deja
disponible el prerrequisito de Google —el development build de Android— y
**F8.B** el de Apple —la cuenta de desarrollador—. Implementar cada login es
trabajo posterior con su propio bloque, y no reabre la Fase 5.

**F5.F fue el cierre de fase**: verificar los cuatro criterios normativos,
validar la integración completa en un solo recorrido físico, añadir la evidencia
que faltaba sobre credenciales en el bundle, y dejar la documentación de estado
sin contradicciones.

---

## Arquitectura vigente

```
Expo SDK 57 (iOS + Android; web NO es objetivo)

src/app/  ->  src/features/  ->  src/domain/ + src/lib/ + src/ui/
                                  (dominio puro, sin React ni red)

cliente -> Kong -> GoTrue (JWT) -> PostgREST
                                     |
                        lectura      |      escritura
              api.<vista security_invoker>  api.record_*  (SECURITY DEFINER,
                        |                        |         owner nomey_writer)
                  core.current_effect            |
                        |                        v
                     core.*  <----- RLS, que tambien se aplica al writer
```

**Tres schemas.** `core` persiste · `api` es **la única** superficie expuesta ·
`sec` guarda los helpers internos. `public`, `core` y `sec` **no** están en
`api.schemas`; responden `406 PGRST106`.

**Tres owners, y ninguno intercambiable.** El writer contable es `nomey_writer`
—`NOLOGIN`, `NOBYPASSRLS`, no propietario de tablas— de modo que la RLS **sigue
aplicándose a la escritura**: es la segunda barrera, no un adorno.
`api.claimed_dimension()` es `postgres` porque debe **atravesar** la RLS para
recuperar lo reclamado. Y desde F6.A, `nomey_provisioner` —de la misma forma que
el writer— crea ámbitos y membresías, que es lo único que el escritor contable
**no** puede hacer. **Nunca unificar ninguno de los tres.**

---

## Superficie `api` disponible

**Escritura — nueve funciones de clase.** Una por clase de operación,
payload `jsonb` único, `GRANT EXECUTE` solo a `authenticated`:

```
record_adjustment          record_group_expense
record_personal_expense    record_debt_settlement
record_personal_income     record_settlement_by_transfer
record_external_transfer   record_group_payment
record_internal_transfer
```

**`record_group_payment` es sólo alta** (F09/ADR-007): un pago hecho fuera de la
app que declara el pagador o el receptor, con la foto de netos que la pantalla
enseñó (`expected_positions` → `SETTLEMENT_STALE` si cambió). El servidor lo
descompone sobre las obligaciones vigentes —par directo, caminos, novación— o
lo rehúsa (`PAYMENT_NOT_APPLICABLE`), mueve la caja de los dos Personales y
no escribe efecto económico. **No se edita** (`PAYMENT_NOT_EDITABLE`): se
anula —por cualquiera de las dos partes, tengan o no membresía— y se
registra otro. Las partes viven en `core.payment_detail` y lo que cerró o
reasignó, fila a fila, en `core.payment_allocation` (persistido al registrar;
se conserva al anular, porque los efectos superados no se leen: F03/ADR-010 §9).

Alta y corrección **comparten función**: las distingue `operation_id` +
`expected_version_id` en el payload.

**Y una décima de F9, `api.settle_participant`**, de la clase
`participant_settlement` (F09/ADR-003 §4), **sin UI desde F09/ADR-007 y con retirada
técnica pendiente y explícita** —revocar su `EXECUTE` y retirar el hook, con
los checks reescritos; F09/ADR-007 «Decisiones cerradas y pendientes» §4, cuya
condición ya se cumple en la base local—; mientras tanto: los miembros dan por resueltos TODOS los
pares pendientes de quien salió, en una operación con un efecto de deuda por
par, contra las cantidades que la confirmación enseñó (`SETTLEMENT_STALE` si
cambiaron) y con la retirada en `core.participant_retirement`. Sin pares no hay
operación: cero pendiente no es una liquidación de cero. Las dos liquidaciones
exigen desde entonces **ambos extremos activos**, sea cual sea la fecha
(`PARTICIPANT_INACTIVE`), y un retirado no vuelve a adquirir ni a alterar deuda
(`PARTICIPANT_RETIRED`).

**`api.retire_participant` es la misma retirada con otra guardia** —sin cuenta
en vez de inactivo— sobre `sec.retire_participant_core` (F09/ADR-005).

**No existe ninguna función que deshaga un vínculo** (F10/ADR-002): ni el
`unclaim_participant` de F9 ni el `unlink_participant` de F10.A2, retirados por
`20260917120000` junto con `sec.unlink_instance`, el evaluador económico por
instancia, `core.participant_unlink`, el `kind` `identity_released`,
`sec.my_claim_command_id`, `sec.my_link_id` y la columna
`participant_user_link.claim_command_id`. Salir del grupo es `api.leave_group`
tal como lo dejó F9. Se conservan `link_id` y `origin_command_id` en el vínculo
y la línea base de cada instancia como auditoría.

**Más `api.annul_operation`, que no es una clase.** Anular no deriva efectos, así
que una sola función vale para las ocho y no contradice «una por clase» de
F03/ADR-006 §1.

**El ajuste declara `delta` o `target_balance`, exactamente uno.** Con objetivo,
**el servidor deriva el delta bajo lock**: el cliente no calcula nada sobre una
lectura que puede haber caducado. `target_balance` es el saldo declarado **al
reconciliar**, y no hay reconstrucción `as-of`
— [F06/ADR-004](adr/F06/ADR-004-balance-target-and-serialization.md).

**Y una clase no corrige a otra.** La guarda vive en `sec.persist_version`, por
donde pasan las ocho para existir, y usa la clase que cada una ya le pasaba: no
hay parámetro que olvidar ni función que pueda quedarse fuera. Corre **después
del CAS**, así que no es un oráculo de la clase de una operación ajena.
`OPERATION_CLASS_MISMATCH · 422`. Allí vive también la guarda que hace la
**anulación terminal**: `OPERATION_ANNULLED · 409`.

**Provisioning — dos funciones más, de F6.A.** No son clases de operación: no
crean operación, ni versión, ni efecto, y **no usan `core.client_command`**.
Owner `nomey_provisioner`, idempotentes **por estado**:

```
ensure_personal_scope        crea ámbito + membresía, o devuelve el existente
set_personal_base_currency   cambia la moneda si el ámbito nunca tuvo un efecto
```

**Y las de Grupos, idempotentes por clave (F09/ADR-002):** `create_group`,
`update_group_profile`, desde F09/ADR-004 `create_group_invitation`,
`revoke_group_invitation` y `redeem_invitation` —más `preview_invitation`, un
definer de `postgres` que sólo publica lo necesario para elegir identidad—, y,
desde F09/ADR-003, `leave_group` —borra UNA membresía,
cierra la presencia con el día de salida EXCLUIDO, registra `core.group_departure`
y avisa a los que quedan; ni un efecto, ni una operación, ni el vínculo—, que
desde F09/ADR-007 C8 **sale a NETO cero**: con neto distinto de cero responde
`LEAVE_BLOCKED_DEBT` con el neto y los pares, bajo el cerrojo de identidad,
sin escribir nada; a cero con pares vivos, la salida los **reasigna** entre
los demás sin dinero (operación `departure_novation` del writer,
`sec.record_departure_novation`, sólo deuda, no anulable, procedencia en
`core.group_departure.novation_operation_id`). Y **`api.associate_participant`**
(F09/ADR-009) asocia un participante sin cuenta a la identidad propia: fusión de
lectura en `core.current_effect` (`core.participant_merge`), caja histórica
completada una sola vez por el writer (`sec.incorporate_participant_cash`)
sólo en el Personal del actor.

**Todo lo que lee o cambia identidad de grupo toma el cerrojo de rango 1**
(`sec.lock_participant_claims`, migración `20260912150000`): once funciones
desde `20260917120000`, entre ellas `annul_operation`,
`record_debt_settlement`, `record_group_payment`, `associate_participant`,
`create_group` —toda alta de instancia de vínculo escribe su línea base y su
`S0` bajo el cerrojo, F10/ADR-001 §3—; la guarda de catálogo
`group-identity-lock.sql` vigila las once. **Y la obligación de quien salió es intocable** (F09/ADR-008): un alta
retro-fechada, una corrección o una anulación de gasto que cambie lo que se
le atribuye —deuda por par, cuota o caja— se rehúsa entera con
`DEPARTED_OBLIGATION_CHANGED · 422`; concepto, categoría y cambios sólo entre
activos siguen permitidos.

**Lectura:**

| Objeto                           | Qué da                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `api.personal_operation`         | **La lista.** Una fila por operación, con su versión vigente                                                                |
| `api.personal_operation_version` | El **historial** de correcciones, una fila por versión                                                                      |
| `api.personal_balance`           | El **Disponible**, derivado. Una fila, y `0` si no hay nada                                                                 |
| `api.observed_balance(uuid[])`   | La observación de F06/ADR-005, **por lote**. Ilustrativa                                                                    |
| `api.personal_statistics(…)`     | Totales e reparto por categoría de un **intervalo**                                                                         |
| `api.personal_expense_share(…)`  | Mis **cuotas** de gastos compartidos del intervalo, con contexto: lo que el desglose de Gastos añade para explicar el total |
| `api.personal_effect`            | Saldo y económica **sin participante**. De aquí, estadísticas                                                               |
| `api.claimed_dimension()`        | Económica **con participante** y deuda, por vínculo                                                                         |
| `api.personal_scope`             | El ámbito del actor, con su moneda base y su escala                                                                         |
| `api.currency_definition`        | Las 20 definiciones sembradas, para el selector                                                                             |
| `api.category`                   | Categorías de sistema y **propias**. Ni ve las ajenas                                                                       |

**La unidad de lectura es la operación, y `api.personal_effect` no cambió.**
Conserva su propósito de F03/ADR-013 —atribución por dimensión, y con ella las
estadísticas de F01/ADR-001 §4— y no se convirtió en lista de movimientos. Tres
cosas más que conviene no volver a deducir, todas de
[F06/ADR-007](adr/F06/ADR-007-personal-read-surface.md):

- **Una página cuesta tres consultas, no 1+N.** La lista publica
  `previous_version_id` —no `version_no - 1`, que F03/ADR-008 §11 nunca hizo
  estructural— y la observación **toma un array**.
- **La observación sale por una FUNCIÓN y jamás por una vista.** La guarda de
  F06/ADR-005 sigue exigiendo **cero** vistas de `api` sobre ella; lo que se añadió
  es una guarda **nueva** que acota a una sola función, no una relajación.
- **La lista blanca de clases acota la LISTA, nunca el SALDO.** El `Disponible`
  se deriva de todos los efectos vigentes; en F6 coinciden porque sólo tres
  clases son alcanzables, y desde F9 no tienen por qué.

**Categorías — tres funciones más, de F6.B.** Tampoco son clases de operación, y
comparten owner con el provisioning porque `nomey_provisioner` es **la frontera
de las escrituras que no son contabilidad**:

```
create_custom_category   rename_custom_category   set_custom_category_active
```

**Errores.** Código propio en el cuerpo y estado HTTP, medidos por la ruta real:
`PAYLOAD_INVALID` 400 · `NOT_AUTHORIZED` 403 · `IDEMPOTENCY_KEY_REUSED` 409 ·
`VERSION_CONFLICT` 409 · `BASE_CURRENCY_LOCKED` 409 · `CATEGORY_NAME_TAKEN` 409 ·
`OPERATION_ANNULLED` 409 · `OPERATION_CLASS_MISMATCH` 422 · `CATEGORY_NOT_USABLE` 422 ·
`CURRENCY_CONVERSION_UNSUPPORTED` 422 · `CURRENCY_NOT_SUPPORTED` 422 ·
`CURRENCY_CODE_AMBIGUOUS` 422 · `LEAVE_BLOCKED_DEBT` 409 · `SETTLEMENT_STALE` 409 ·
`PAYMENT_NOT_EDITABLE` 422 · `PAYMENT_NOT_APPLICABLE` 422 ·
`DEPARTED_OBLIGATION_CHANGED` 422 · `PARTICIPANT_MERGED` 422/409 ·
`PARTICIPANT_LINKED` 409 · `UNCLAIM_BLOCKED_MERGE` 409 · y los códigos de dominio de
`src/domain/errors.ts`, también 422.

`src/types/database.ts` se **genera** sobre `api` y nunca se escribe a mano.

---

## Frontera de sesión en el cliente

**Lo que existe:** el cliente y el almacenamiento seguro (F5.A), el estado de
sesión con su restauración y las rutas protegidas (F5.B), el acceso con email y
contraseña (F5.C1), **el cierre de sesión con la Cuenta y el Perfil** (F5.D) y
**la recuperación de contraseña** (F5.E). **Lo que no: Google y Apple**, que
están diferidos hasta que existan sus prerrequisitos.

```
lib/env/              las dos EXPO_PUBLIC_, validadas al arrancar
lib/supabase/
├── bootstrap            el polyfill de URL, ANTES de createClient
├── client               db.schema 'api' · persistSession · autoRefreshToken
├── client-options       puro, para poder afirmarlo en un test
├── chunked-storage      troceado y manifiesto. PURO, inyectable
└── session-storage      la ÚNICA que nombra expo-secure-store
features/session/
├── session-state        la unión discriminada y sus predicados. PURO
├── session-lifecycle    suscripción, watchdog y AppState. PURO, inyectable
└── session-provider     el ÚNICO dueño del estado, y el único suscriptor
features/auth/
├── auth-service         signUp, signIn, signOut, forgetLocalSession y
│                        updateDisplayName, y las tres de recuperación.
│                        Lo ÚNICO que llama a supabase.auth
├── auth-errors          código de GoTrue -> clave i18n. PURO
├── credentials          normalización y «¿está vacío?». PURO
├── display-name         iniciales del avatar. PURO, sin React Native
├── submit-guard         un envío a la vez. PURO
├── sign-out-confirmation  el diálogo como dato, no como efecto. PURO
├── account-avatar       el hueco de la foto y su affordance
├── display-name-editor  el nombre y el lápiz que lo cambia
├── auth-screen          el andamio de teclado que comparten las pantallas
├── recovery-link        lee el enlace y rechaza todo lo demás. PURO
├── recovery-arrival     qué hacer cuando un enlace LLEGA. PURO, inyectable
├── recovery-state       la transacción y sus estados. PURO
├── recovery-controller  la transacción, sobre el cliente efímero
└── use-recovery-link    el ÚNICO dueño del deep link: una suscripción
lib/supabase/recovery-client   segunda instancia, en memoria y desechable
```

**Cuatro estados, no un booleano.** `restoring` · `signed-out` · `signed-in` ·
`unavailable`. Un `isAuthenticated: false` no distingue «hemos mirado y no hay
nadie» de «aún no hemos mirado», y esas dos pintan cosas distintas.

```
restoring   ->  NINGUNA rama se monta. El splash sigue puesto
signed-out  ->  (auth)
unavailable ->  (auth), con salida: error recuperable, no callejón
signed-in   ->  (tabs) · add · notifications · profile · account
                y, solo con __DEV__, diagnostics · states · session-probe
```

Lo que conviene no re-descubrir:

- **La frontera de credenciales tiene TRES capas, y ninguna sustituye a las
  otras**: `tests/infra/no-backend-secrets.test.ts` sobre el fuente versionado,
  `src/lib/env/supabase-env.ts` en ejecución, y
  [`scripts/bundle-secrets-check.sh`](../scripts/bundle-secrets-check.sh) sobre
  el artefacto exportado. **La URL pública y la clave publicable SÍ viajan en el
  bundle, y es correcto**: se diseñan para eso. Lo que no puede aparecer es una
  clave `sb_secret_`, un JWT heredado o una clave privada.

- **La identidad interna de Nomey es el `sub` del JWT.** No hay tabla de
  usuario, ni perfil, ni segunda identidad, y no se crea ninguna al añadir
  proveedores: Google y Apple producirán un usuario de Supabase y la identidad
  sigue siendo la misma.
- **La confirmación de correo es obligatoria.** Un alta **no** devuelve sesión;
  hay que confirmar y luego entrar. `scripts/http-boundary-check.sh` lo sabe:
  da de alta, confirma por SQL y pide el JWT con `grant_type=password`, y falla
  si el alta vuelve a emitir sesión.
- **Nada de `router.replace`, ni al entrar ni al salir.** El evento de auth
  mueve el árbol por sí solo, medido en dispositivo. Una navegación imperativa
  sería un segundo mecanismo compitiendo con el primero — y al salir dejaría
  historial: hoy la rama protegida **deja de existir** en vez de quedar tapada,
  así que no se puede volver atrás a Perfil.
- **Cerrar sesión es `signOut({ scope: 'local' })`, explícitamente.** El defecto
  de la librería es `'global'`, que cierra la sesión en **todos** los
  dispositivos; un toque en el móvil no debe echar a nadie de su tablet.
  `'local'` sí revoca en el servidor el refresh token **de este** dispositivo.
- **La purga normal del almacenamiento es de `auth-js`, y no se duplica.**
  `_signOut` borra la sesión a través del adaptador, que aquí es el troceado, y
  cuyo `removeItem` ya purga manifiesto y chunks. Escribir una segunda purga
  «por seguridad» sería reimplementar lo que posee F05/ADR-001.
- **Un error de `signOut` no significa «sigues dentro».** Medido: si falla la
  llamada remota, la librería borra la sesión local **primero** y devuelve el
  error después. Sólo hay un caso que deja dentro —token caducado y refresh
  inalcanzable—, y ahí el refresh token no fue **rechazado** sino no alcanzado,
  así que Nomey no puede demostrar que la sesión esté muerta. Para eso existe
  **«Cerrar sesión solo en este dispositivo»**: explícito, elegido por la
  persona, y con su coste dicho —la sesión sigue viva en el servidor hasta
  caducar—. **Nunca automático.**
- **`ScopeProvider` se resetea al cambiar la identidad**, en render y no en un
  efecto. El evento de salida tira la rama protegida en ese mismo commit, así
  que una limpieza que viviera dentro de ella no llegaría a ejecutarse; el
  provider está por encima del navegador y los hijos pintan ya con el valor
  inicial. La identidad se la pasa `app/_layout.tsx`, único sitio que ve los dos
  providers — `features/` no puede importar `features/`.
- **`display_name` se edita desde Perfil**, y se escribe donde siempre estuvo:
  `user_metadata`, vía `updateUser`. Nadie propaga el cambio a mano — `auth-js`
  guarda la sesión y emite `USER_UPDATED`, el suscriptor único lo mapea, y
  Perfil e Inicio se repintan porque **ya derivaban el nombre de la sesión**.
  La escritura **no es optimista**: el campo sólo se cierra con la respuesta del
  servidor.
- **El teclado de las pantallas de auth no lleva `KeyboardAvoidingView`.** El
  hueco lo hace `automaticallyAdjustKeyboardInsets`, y el contenido **no se
  centra**: centrarlo hacía que la posición de cada campo dependiera de la
  altura del contenedor, y eso realimentaba un bucle de recolocación.
- **El almacenamiento trocea siempre**, y su seguridad es una sola regla: el
  manifiesto se escribe el último y se borra el primero. Una escritura
  interrumpida degrada a _sin sesión_, jamás a media sesión.
  [F05/ADR-001](adr/F05/ADR-001-secure-session-storage.md).
- **React Native 0.86 no cumple el contrato `URL.protocol`** que exige
  `supabase-js`: su `URL` global no tiene setter de `protocol` y el constructor
  del cliente asigna a uno. Lo resuelve `react-native-url-polyfill` en un único
  punto de arranque. Quitarlo rompe la creación del cliente, no solo realtime.
- **No se llama a `getSession()`, y esto no es un olvido.** `auth-js` emite
  `INITIAL_SESSION` a cada suscriptor nuevo por su cuenta, **también cuando la
  restauración falló** —sesión ausente, refresh token muerto o fetch abortado
  llegan como sesión nula, no como cuelgue—. Una sola fuente ordenada, así que
  la carrera «restauración lenta pisa un evento nuevo» **no puede ocurrir**.
  Añadir un `getSession()` en paralelo la reintroduce.
- **Un watchdog de 10 s** cubre el único fallo sin salida: que la respuesta no
  llegue nunca. No es un plazo — la suscripción sigue viva y una respuesta
  tardía manda. `unavailable` cae en la rama **pública**, que es la dirección
  segura.
- **El refresco es de la librería.** `startAutoRefresh`/`stopAutoRefresh` atados
  a `AppState`, un solo listener, idempotente. **Nomey no escribe ningún timer**:
  un segundo bucle es cómo dos clientes compiten por el mismo refresh token.
- **`Stack.Protected` es navegación, no seguridad.** Sin sesión PostgREST
  responde `42501` pinte lo que pinte el cliente; la RLS sigue siendo la única
  frontera de autorización. Un test comprueba que ninguna pantalla queda
  registrada fuera de una guarda.
- **El token no sale del cliente.** El provider expone `userId`, `email` y
  `displayName`, nada más; quien llame a la API usa `supabase`, que adjunta y
  refresca él.
- **`display_name` es `user_metadata`, y solo presentación.** Lo edita el propio
  titular de la cuenta **desde Perfil**, así que **nunca** entra en RLS, ni
  resuelve una membresía o un ámbito, ni sustituye al `sub`. Su forma se valida
  en un único sitio: lo que no sea una cadena no vacía es `null`, y `null`
  significa saludar sin nombre — nunca un placeholder ni una suposición desde el
  email. **Las iniciales del avatar siguen la misma regla** y tampoco salen de
  la dirección: sin nombre se pinta una silueta.

**Validado en iPhone físico**, con `app/session-probe.tsx` bajo `__DEV__` —no es
una feature y no se expone al usuario—: SecureStore disponible, el cliente se crea
bajo Hermes, un arranque sin crash que aterriza en la rama pública **sin que
Inicio ni la barra aparezcan un instante**, y el recorrido completo de
email/contraseña de extremo a extremo, incluida la restauración tras cerrar y
reabrir Expo Go.

**F5.D también está validado en iPhone físico**: Perfil con su cabecera de
identidad, edición del nombre —cancelar, guardar, iniciales que cambian y el
saludo de Inicio actualizado—, el nombre conservado tras recargar, General con
sus tres opciones visibles, Planes y suscripciones, la confirmación de cierre de
sesión, la vuelta automática a la rama pública sin poder retroceder a Perfil, la
sesión ausente tras recargar y tras reabrir Expo Go, y el ámbito de vuelta en
Personal al entrar de nuevo.

**El splash propio no es verificable en Expo Go**, que sustituye el nativo por el
suyo; espera a **la primera build propia de cada plataforma** — Android en
**F8.A**, iOS en **F8.B**. El gate es React puro y sí está comprobado: aunque el
splash fallara, lo que se ve es el fondo de la app, nunca una pantalla.

### La recuperación de acceso, y por qué está fuera de la sesión

La rige **[F05/ADR-002](adr/F05/ADR-002-ephemeral-recovery-session.md)**, y su decisión
es una frontera, no un matiz: **una sesión nacida de un enlace de correo no es
una sesión ordinaria de Nomey, no se persiste y nunca se promociona.**

- **Se canjea con un cliente Auth propio y efímero** — `persistSession: false`,
  `autoRefreshToken: false`, `detectSessionInUrl: false` — que vive en memoria
  y muere con el proceso. **El `SessionProvider` principal no la ve nunca** y
  durante todo el flujo dice `signed-out`, que es literalmente cierto.
- **El deep link tiene un dueño único**: `getInitialURL()` para el arranque y un
  listener `url` para cada entrega posterior. `Linking.useURL()` NO se usa —
  retiene la última URL, y leer un valor retenido no es reaccionar a un evento.
  `app/+native-intent.tsx` impide además que el router trate `/auth/recovery`
  como pantalla: es una intención de autenticación, no un destino.
- **Una sesión ordinaria abierta bloquea el enlace sin canjearlo**, y `restoring`
  no decide nada: esa llegada queda retenida hasta que la sesión resuelve.
  `unavailable` **falla cerrado**. Ningún cambio de sesión canjea por su cuenta.
- **`attempted` impide dos canjes simultáneos del mismo hash**; **`spent` sólo se
  escribe cuando el servidor establece `consumed` o `dead`.** Un fallo no
  resuelto —transporte, 429, 500— no gasta la prueba: **una entrega explícita
  nueva del mismo enlace vuelve a intentarlo**, y ése es el único reintento.
- **Un fallo al guardar la contraseña se queda en el formulario**, en línea y con
  lo escrito intacto, porque para entonces el enlace ya está canjeado y la
  sesión efímera sigue siendo utilizable. Sólo se abandona la recuperación al
  terminar bien o al salir explícitamente.
- **Un recovery interrumpido no se reanuda.** No hay estado que restaurar: la
  app reabre en Entrar y se pide otro enlace.

### El tamaño real de la sesión, medido

**Medición resuelta**, sobre una sesión auténtica en iPhone físico:

```
2285 B  ·  2285 unidades UTF-16  ·  5 chunks  ·  máximo 512 B por chunk
```

**Supera el umbral histórico de ~2 KB que menciona la documentación de Expo**, así
que **el troceado de F05/ADR-001 queda validado contra una sesión real**: una sola
entrada habría estado en riesgo en iOS, y la decisión no era hipotética. Con esto
**la medición que F05/ADR-001 dejaba pendiente está RESUELTA**.

**F05/ADR-001 no se toca.** Un ADR aceptado es inmutable —`docs/adr/README.md`—, y el
estado y la evidencia actuales viven aquí. La decisión que registra sigue siendo
la misma: se trocea siempre, y la cifra la valida en vez de cambiarla.

---

## Invariantes que una fase futura no debe romper

1. **El cliente no escribe efectos.** Envía intención; el servidor deriva. Las
   nueve funciones de clase, más `annul_operation`, son la única entrada de
   escritura contable.
2. **Los importes son enteros exactos en unidad mínima y nunca cruzan JSON como
   número.** Entran como string, salen como texto.
3. **Todo importe lleva su definición monetaria**, cuya identidad es un `UUID`,
   no el código ISO. Dos importes solo se suman si la comparten.
4. **Caja, económica y deuda son tres dimensiones distintas** y no se sustituyen.
   Una liquidación no mueve saldo; un gasto de grupo no es una transferencia.
5. **Los hechos son inmutables.** Corregir crea una versión nueva; solo cuenta la
   vigente, y eso se consulta en `core.current_effect` — **nunca** se
   reimplementa el filtro de vigencia.
6. **Saldos, deudas, estadísticas y disponibles son derivados**, sin caché en v1.
7. **Toda escritura que pueda alterar el saldo o la deuda vigentes bloquea los
   ámbitos afectados**, en un **único** orden ascendente, **antes** de leer.
   Una serialización parcial no serializa nada. **La identidad de un grupo
   —membresía, vínculo, presencia, retiro— se lee y se cambia sólo bajo el
   cerrojo de identidad del grupo (`sec.lock_participant_claims`), tomado
   después de la clave de idempotencia y antes de las filas de ámbito**; un
   Modo Personal resuelto por vínculo sin ese cerrojo delante es un defecto,
   y `supabase/checks/group-identity-lock.sql` lo detecta en el catálogo.
8. **Idempotencia por comando**: el UUID lo genera el cliente, la comparación es
   solo del servidor, y el replay se resuelve **antes** de autorizar y del CAS.
9. **Los efectos referencian al participante contextual, nunca al usuario.**
10. **Ninguna tabla de `core` sin RLS**, y ninguna policy aplicable a `PUBLIC`.
11. **Ownership ≠ membresía.** `scope.owner_user_id` es atribución económica
    durable; `core.membership` es autorización actual y es lo que resuelve la
    RLS. Un Modo Personal necesita **las dos** filas.
12. **`core.membership` es presencia, no historial**, y `participant_period` es
    elegibilidad para figurar en una operación, **nunca** autorización.
13. **El tipo de cambio de una operación es el tipo del día de su fecha
    efectiva**, resuelto por moneda con un límite de una publicación de
    antigüedad y fijado una sola vez al comenzar ese día en hora de Fráncfort.
    No depende de la hora, de la sincronización ni del país, y nunca lo aporta
    el cliente (F11/ADR-001,
    [F11/ADR-002](adr/F11/ADR-002-per-currency-daily-rate.md)).

---

## Limitaciones técnicas vigentes

**El `Intl` de Hermes no es el de Node.** Hermes no empaqueta ICU: toma el
formateador de cada plataforma, así que **iOS no tiene
`Intl.NumberFormat.prototype.formatToParts` y descarta `signDisplay`**. Lo
primero revienta; lo segundo se ignora en silencio, que es peor. `src/lib/format`
solo usa `format()` y deriva la forma del locale con sondas, en una única vía
para todos los runtimes. **Nada que se ejecute en el dispositivo se da por
verificado porque pase en Vitest**, que corre sobre V8.

**Las estadísticas personales pueden sumar monedas distintas.** Es un defecto
**preexistente**, introducido por
`20260910120000_personal_statistics_shared_share.sql` (F9), y **no** por F11.
Medido el 2026-09-14 sobre las 46 migraciones: con base personal EUR y una cuota
de un grupo en JPY pagado por otra persona, `api.personal_statistics` devuelve
`expense_total = 3500` como EUR (10,00 EUR propios + 2500 JPY de cuota). La cuota
compartida se suma sin filtrar por moneda, y basta con **participar sin pagar**
en un grupo cuya base difiere de la del Personal: no hace falta ninguna
conversión. Contradice F02/ADR-001 §3. La deuda de Inicio **no** tiene este
problema: se niega a sumar monedas distintas. **Se resuelve en F11.C**
(estadísticas y lecturas): excluir, convertir o separar esas cuotas es una
decisión pendiente de ese bloque. Detalle en el
[seguimiento de F11](architecture/phase-11-progress.md#las-estadísticas-personales-suman-monedas-distintas).

---

## Decisiones aplazadas relevantes

Ninguna bloqueó el cierre de la Fase 5. El detalle completo, con motivo y
destino de cada una,
está en [`model-coverage.md`](architecture/model-coverage.md).

| Aplazado                                        | Dónde queda                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google**, requisito de producto               | Prerrequisito en **F8.A**; implementación, posterior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Apple**, requisito de producto                | Prerrequisito en **F8.B**; implementación, posterior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Entorno realmente distinto del local**        | Criterio 2 de F8, **pendiente**. Sin fecha                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Tester externo real**                         | Criterio 3 de F8, **pendiente**. Sin fecha                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Icono alternativo negro de Premium**          | **F14** — decidido en F08/ADR-001 §5, sin implementar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Cuenta de Apple, firma y TestFlight**         | **F8.B**, puerta obligatoria antes de F14                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Invitación pulsable desde WhatsApp**          | **F8.B**, con la build propia: enlace HTTPS sobre un dominio por acordar, Universal Links (iOS) y App Links (Android). Hasta entonces, QR y «Pegar enlace» (F09/ADR-004). Condiciones en el seguimiento de F9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Google Play e Internal Testing**              | **F8.C**, cuando exista una beta Android real                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Subida real de la foto de perfil**            | Bloque posterior, con decisión propia                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Timeout de las operaciones de autenticación** | Deuda abierta, sin ADR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Persistencia de la preferencia de idioma        | Con la UI de Ajustes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ~~Resolución autoritativa del FX~~              | **Decidida en F11.A** — F11/ADR-001; implementación en F11.B                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Cambio de divisa base con historia**          | **F11**, sin decidir: F11/ADR-001 no lo incluye y, con efectos, exigiría un sucesor de F01/ADR-001 §8 ([discrepancia anotada](architecture/phase-11-progress.md#discrepancias-documentales-anotadas)). Elegirla ya se puede (F6.A)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Provisioning** de Grupos                      | **HECHO** — `api.create_group`, F9 (F09/ADR-001)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ~~Unión por enlace o QR, y edición del perfil~~ | **HECHO** — `update_group_profile` (F09/ADR-001), `redeem_invitation` (F09/ADR-004); **Compartir grupo** con QR y hoja del sistema sobre la misma invitación                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Modo Pareja** completo, con su `Cierre`       | Su fase                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ~~Mecanismo de claim~~                          | **Cerrado por F09/ADR-004**: la invitación autoriza; reclamar = vincular                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Ciclo de vida del vínculo y fusiones            | **La identidad en el grupo es permanente** (F10/ADR-002, F10.A3): ningún vínculo se deshace; salir del grupo es la economía de F9 y, desde F10/ADR-003, termina el vínculo sin borrarlo (quien salió es historia: vuelve como entonces o como un sin cuenta). El `unclaim` de F09/ADR-006 y el `unlink` de F10.A2 se retiraron. **Asociar un fantasma a la propia cuenta: HECHO** — `api.associate_participant` (F09/ADR-009, Aceptado; validado en iPhone). **F10 (abierta)**: cesión consentida atómica o su aplazamiento, fantasma ↔ fantasma por decidir; **revocar el vínculo de otro está prohibido** ([`phase-10-opening.md`](architecture/phase-10-opening.md))                                                                                                                                                    |
| Notificación                                    | **Hecha en F9** — `core.group_notice`, una relación con siete `kind` (ediciones, perfil, salidas, liquidaciones, pagos, anulaciones y, desde F10.A2, identidad liberada, oculto a `api` hasta A3); campana del cliente (F09/ADR-003 §7). **Sin aviso por alta de gasto ni reincorporación** (decisión de producto, 2026-09-14); sin push                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ~~Acceso residual~~                             | **Cerrado por F09/ADR-003**: no existe. Quien sale conserva su Personal por vínculo y no ve nada más del grupo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Salir de un grupo y pagos registrados           | **HECHO** — `api.leave_group` a neto cero con novación de salida (F09/ADR-007 C8, `LEAVE_BLOCKED_DEBT`), `api.record_group_payment` (clase `group_payment`, sin edición, anulable por las partes), Pagos sugeridos «Los míos»/«Todos» con «Saldado» (F09/ADR-007, Aceptado); la obligación de quien salió es intocable (F09/ADR-008, Aceptado). `api.settle_participant` queda sin UI para el estado heredado. **Volver tras salir: HECHO** — `redeem_invitation` con `choice = 'rejoin'` recupera la identidad de entonces y abre un periodo desde hoy (F09/ADR-010, Aceptado; migración `20260914140000` aplicada a la base local y validada en el iPhone). La guarda de sobreliquidación sólo rehúsa lo que empeora el par (`20260914150000`, aplicada a la base local). **Pendiente:** validar en dispositivo lo demás |
| ~~Anulación, distinta de la corrección~~        | **Resuelta en F6.C** — F06/ADR-006                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Idempotencia de recurrencias e importaciones    | Abierto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Preflight de `btree_gist` en producción         | Antes del primer deploy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

> **La foto de perfil, y qué está hecho exactamente:** la **affordance** está
> terminada y aprobada en dispositivo —hueco circular con iniciales o silueta,
> insignia de cámara, e interacción que informa de que todavía no está
> disponible—. **La subida no existe, y eso es una función diferida, no un
> defecto de F5.D.** Hacerla real es un bloque posterior con su propia decisión
> sobre picker, Supabase Storage, bucket y ruta, RLS del bucket, reemplazo y
> borrado, y límites y compresión. Esa solución **no está diseñada** y no se
> improvisa aquí. Lo único ya descartado es meter la imagen en `user_metadata`:
> viajaría dentro del JWT y de la sesión guardada, que mide 2285 B en 5 chunks,
> y rompería el inicio de sesión en vez de sólo el avatar.

> **El timeout de autenticación, dicho entero porque su forma importa:** las
> operaciones de autenticación dependen hoy del timeout del transporte. Nomey
> **no** añade un timeout superficial mientras no pueda abortar de verdad la
> petición subyacente sin generar carreras ni resultados ambiguos. Un
> `Promise.race` dejaría la petición viva: en un registro, el usuario vería un
> fallo, reintentaría, y la primera llamada terminaría después — dos altas y una
> respuesta que nadie sabe interpretar.

> **Ya no queda provisioning sin ruta.** **El Modo Personal tiene ruta** desde
> F6.A, y la app la usa desde F6.E. **El Grupo también la tiene desde F9**:
> `api.create_group` crea ámbito, membresía, perfil, el participante del creador
> con su vínculo y el resto de participantes, en una sola transacción; la
> **reclamación** (`redeem_invitation`, F09/ADR-004) crea el vínculo de un
> participante con otra cuenta y las **presencias** las abren y cierran los
> comandos de F9. `record_group_expense`, `record_group_payment` y las dos
> liquidaciones son alcanzables de extremo a extremo por un cliente real; lo
> que F10 abre es el **ciclo de vida** del vínculo, no su creación.

---

## Fundación de interfaz

**La Fase 4 cerró en cuatro bloques**, todos validados en iPhone físico:
**F4.A** fundación visual y marca · **F4.B** i18n y formateo · **F4.C** app
shell y navegación · **F4.D** primitives y estados comunes. El detalle está en
[`ux/phase-4-plan.md`](ux/phase-4-plan.md).

**Lo visual.** Nomey es **dark-only**: `app.config.ts` fija
`userInterfaceStyle: 'dark'` y la paleta se resuelve en un único sitio,
`src/ui/theme/use-theme.ts`. El amarillo de marca es `#FDC506`, acento
minoritario. **Ningún color, rol tipográfico ni token de profundidad vive fuera
de `src/ui/theme/`**, y el contraste de la paleta está medido y anotado allí.
Los tokens de **glass y de profundidad táctil tienen consumidores reales** —la
barra, el botón de acción, el pulsador de ámbito, las cards y las sheets— y su
render **está validado en iPhone físico**. El suelo de opacidad del glass lo
comprueba un test.

**Idioma y formato se resuelven por separado, y son tipos distintos** —
`MessageLocale` y `FormatLocale`— para que confundirlos no compile.

- **Catálogo:** `es-ES` y `en`. Cualquier `es-*` va al español, cualquier `en-*`
  al inglés, y un idioma no soportado cae a `es-ES`.
- **Preferencia**, con tres estados —**Automático** (por defecto), Español,
  English—. Existe la API; **no está persistida ni expuesta en UI**, y ambas
  cosas llegan con Ajustes.
- **Formato regional:** sigue **siempre la Region real del dispositivo**, aunque
  el idioma se fuerce. Se **compone** desde `languageCode`, el script cuando
  exista y `regionCode` — nunca desde `languageTag`, que lleva la región del
  idioma y no la del ajuste Region.
- **La Region no toca el dinero.** Un `Money` en EUR sigue siendo EUR en México:
  la definición monetaria manda sobre código, escala y valor; la región solo
  sobre separadores, agrupación, posición del símbolo y convenciones de fecha.
- **La exactitud se conserva.** Los dígitos salen del `bigint`; `Intl` solo
  recibe sondas de magnitud fija.

**El shell vigente.** Dos destinos raíz y nada más: **Inicio** y **Grupos**.

- **`+` es una acción contextual, no navegación**: flota sobre los destinos,
  fuera de la barra, y añade al sitio donde estás — en Inicio al ámbito activo,
  en Grupos a un grupo, sin preseleccionar ninguno.
- **Personal y Pareja son contextos dentro de Inicio**, con un pulsador único y
  el estado por encima de las tabs, así que sobrevive a cambiar de destino.
  Visualmente son equivalentes; lo que falta de Pareja es funcionalidad, y se
  dice donde faltaría.
- **Perfil y Notificaciones cuelgan de la cabecera**, no de la barra, y ambos
  destinos raíz comparten ese grupo de acciones.
- **Crear un grupo sale del `+` de Grupos, y no de un botón dentro del
  contenido.** Desde F9 ese `+` abre un selector con dos opciones —crear un
  grupo o unirse a uno—; sólo la primera hace algo. El enunciado anterior
  —«crear un grupo vive en el contenido de Grupos»— describía el estado vacío de
  F4 y ya no es cierto.

**Glass y profundidad táctil ya tienen consumidores reales** —barra, botón de
acción, pulsador de ámbito, cards y sheets— y se validaron en iPhone físico.
El suelo de opacidad del glass lo comprueba un test.

**Las primitives son pocas y todas tienen consumidor**: `Icon`, `IconButton`,
`ActionButton`, `Section`, `GlassSurface`, `ThemedText` y `ThemedView`, más los
tres estados comunes —**carga, vacío y error**— reutilizables y ya consumidos
por Inicio, Grupos y Notificaciones. Un test falla si alguna deja de tener quien
la use.

**Dos pantallas viven fuera del producto**, alcanzables solo desde Perfil bajo
`__DEV__`: el diagnóstico de `Intl` de F4.B y la vista de estados comunes.
Ninguna es una feature.

**Antes de tocar UI, leer
[`design-direction.md`](product/design-direction.md)**: es la fuente de verdad de
la estética y su regla de accesibilidad es vinculante. F4 la convierte en
tokens; **no la redefine**.

**Pendiente de validar en dispositivo**, sin bloquear a nadie: el icono y el
splash **nativos**, que Expo Go sustituye por los suyos; y la tabla diagnóstica
de `Intl`, cuya **validación funcional sí se hizo** en iPhone —arranque, EUR,
JPY, fecha e importe de 21 dígitos— pero **no fila a fila**.

> **La comprobación nativa pendiente se parte, y no es iOS-only.** F4 la escribió
> como «la primera build iOS propia» porque entonces el iPhone era el único
> aparato físico disponible, no porque la comprobación fuera de iOS. Son cinco
> cosas —icono en la pantalla de inicio, máscara final, splash exacto,
> transición nativa previa al JS y ausencia de destello blanco— y **las cinco
> tienen mitad Android y mitad iOS**: la primera la salda **F8.A**, con el icono
> adaptativo y el monocromo temático de Android además; la segunda, **F8.B**.

Fuera de alcance de F4: biblioteca de componentes completa, design system
consolidado y el flujo detallado de entrada rápida, que se diseña en F7 contra
una feature escribible real.

---

## Qué consultar, y cuándo

| Necesitas…                                      | Lee                                                                                                                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reglas del repositorio y del agente             | [`AGENTS.md`](../AGENTS.md)                                                                                                                                                              |
| Semántica contable y escenarios                 | [`architecture/data-model.md`](architecture/data-model.md)                                                                                                                               |
| Dónde vive cada concepto del modelo             | [`architecture/model-coverage.md`](architecture/model-coverage.md)                                                                                                                       |
| Una decisión y su porqué                        | [`adr/README.md`](adr/README.md) — índice general y tabla de equivalencias con la numeración antigua                                                                                     |
| Secuencia de fases y criterios de cierre        | [`product/roadmap.md`](product/roadmap.md)                                                                                                                                               |
| Vocabulario                                     | [`product/glossary.md`](product/glossary.md)                                                                                                                                             |
| Estética, antes de cualquier UI                 | [`product/design-direction.md`](product/design-direction.md)                                                                                                                             |
| **Continuar la Fase 8**                         | [`product/roadmap.md`](product/roadmap.md), Fase 8 · F08/ADR-001 · F08/ADR-002                                                                                                           |
| **Continuar la Fase 10**                        | [`product/roadmap.md`](product/roadmap.md), Fase 10 · [`architecture/phase-10-opening.md`](architecture/phase-10-opening.md) · [F10/ADR-001](adr/F10/ADR-001-link-instance-lifecycle.md) |
| **Multimoneda: el contrato de F11**             | [`adr/F11/ADR-001-fx-rate-resolution.md`](adr/F11/ADR-001-fx-rate-resolution.md) · [`ADR-002`](adr/F11/ADR-002-per-currency-daily-rate.md) · roadmap, Fase 11                            |
| **Continuar la Fase 11**                        | [`architecture/phase-11-progress.md`](architecture/phase-11-progress.md): estado, contraste con F9 y limitaciones                                                                        |
| Cómo quedó la Fase 9, ya cerrada                | [`architecture/phase-9-progress.md`](architecture/phase-9-progress.md) · roadmap, Fase 9, «Estado de cierre»                                                                             |
| Cómo quedó la Fase 7, ya cerrada                | [`architecture/phase-7-handoff.md`](architecture/phase-7-handoff.md)                                                                                                                     |
| Cómo quedó la Fase 5, ya cerrada                | [`architecture/phase-5-handoff.md`](architecture/phase-5-handoff.md)                                                                                                                     |
| Cómo quedó la Fase 4, ya cerrada                | [`ux/phase-4-plan.md`](ux/phase-4-plan.md)                                                                                                                                               |
| Cómo se usan i18n y el formateo                 | [`src/lib/README.md`](../src/lib/README.md)                                                                                                                                              |
| Levantar el entorno, migrar, ejecutar checks    | [`runbooks/local-setup.md`](runbooks/local-setup.md)                                                                                                                                     |
| **Arrancar, resolver o verificar un entorno**   | [`runbooks/environments.md`](runbooks/environments.md)                                                                                                                                   |
| **Preparar la cadena nativa y generar Android** | [`runbooks/android-build.md`](runbooks/android-build.md)                                                                                                                                 |
| **Por qué** la Fase 3 quedó como quedó          | [`architecture/phase-3c-handoff.md`](architecture/phase-3c-handoff.md) — histórico                                                                                                       |

**Evidencia empírica:** `supabase/e11/` … `supabase/e22/`. Son sondas
desechables sobre maquetas y **nunca deben convertirse en migración**.

---

## Comandos

```bash
npm ci
npm test
npm run verify
```

La Supabase CLI se ejecuta **desde Ubuntu (WSL2)** con
`./scripts/supabase-cli.sh`, nunca desde Windows, y **nunca** se instalan
dependencias npm desde WSL sobre este checkout. El motivo está en el runbook.
