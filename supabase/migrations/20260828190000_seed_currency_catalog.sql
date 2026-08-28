-- Siembra del catalogo de definiciones monetarias.
--
-- Novena migracion real, y la PRIMERA de la Fase 6.A. Trae datos, no estructura:
-- las veinte definiciones con las que opera el Modo Personal. Va separada de la
-- migracion de provisioning a proposito —una es catalogo y la otra es privilegio
-- y funciones— y en el MISMO commit, porque el provisioning no puede resolver
-- ninguna moneda sin ella.
--
-- ADR-019. Lo que ADR-003 §3 ya fijaba y aqui solo se aplica:
--
--   «Monedas admitidas: las fiat activas de ISO 4217 para las que Nomey disponga
--    de una definicion monetaria valida y controlada. La escala NO es criterio
--    de admision: 0, 2, 3 decimales y cualquier otra escala valida. La metadata
--    que usa el dominio esta bajo control de Nomey y no depende en tiempo real
--    de una API externa.»
--
-- Por eso la escala se persiste aqui, versionada y revisable, y no se consulta a
-- nadie en ejecucion.
--
-- ======================= POR QUE LOS UUID SON LITERALES FIJOS ================
--
-- `core.currency_definition.id` ES la identidad monetaria (ADR-004); el codigo
-- ISO es un atributo visible que dos definiciones pueden compartir. Si local, CI
-- y produccion generasen UUID distintos para EUR, cada entorno tendria su propia
-- identidad para «lo mismo»: los importes seguirian cuadrando DENTRO de cada uno
-- y dejarian de ser comparables ENTRE ellos, sin que nada fallara.
--
-- Los identificadores son UUID v5 (SHA-1) reproducibles, sobre el namespace DNS
-- estandar de RFC 4122 y el nombre `currency.nomey.app/<CODIGO>`:
--
--   namespace = 6ba7b810-9dad-11d1-80b4-00c04fd430c8
--   nombre    = 'currency.nomey.app/EUR'
--   -> 830e6f7e-2e33-564e-9ea3-f6c2023af1fe
--
-- Cualquier implementacion estandar de UUIDv5 reproduce la tabla entera, asi que
-- son auditables y no hay que confiar en este fichero. Se escriben como
-- literales y no se calculan en ejecucion para no depender de una extension.
--
-- **NUNCA SE REGENERAN.** Anadir una moneda es anadir una fila con su UUID
-- calculado por la misma receta; cambiar uno existente es partir los entornos.
--
-- ============================== ESCALAS, VERIFICADAS ========================
--
-- Minor units de ISO 4217. Dos avisos que ahorran una discusion futura:
--
--   · HUF lleva escala 2 en ISO 4217 aunque el filler no circule en la practica.
--   · COP y ARS llevan 2 por la misma razon.
--   · JPY y CLP llevan 0, y estan en la lista A PROPOSITO: son las que hacen
--     fallar cualquier codigo que de por hechos dos decimales.
--
-- La lista es la aprobada por producto para la Fase 6. Ampliarla es aditivo y no
-- toca ninguna identidad existente; F11 lo hara cuando llegue la multimoneda.

insert into core.currency_definition (id, code, scale) values
  ('830e6f7e-2e33-564e-9ea3-f6c2023af1fe', 'EUR', 2),
  ('34cb8424-2243-52d8-be99-e2b7d22884b8', 'USD', 2),
  ('fe22eeff-f72b-50ce-9b37-6033833df95e', 'GBP', 2),
  ('c8483062-e215-5da5-850e-cd7bfda52eff', 'CHF', 2),
  ('f981b2f9-a022-5de8-aa6d-3af277d9dcd3', 'JPY', 0),
  ('6cfbf3ad-967d-50ba-9822-f1afbb10f7f5', 'CAD', 2),
  ('c9203a94-12aa-5d7f-8703-2ee17e524dca', 'AUD', 2),
  ('c3d5768c-33be-5ab8-896e-38203ac5cc48', 'NZD', 2),
  ('f725bdd8-5690-53a8-85c0-eabed7405c10', 'SEK', 2),
  ('f2fe8324-641c-548d-b3af-411db0d39448', 'NOK', 2),
  ('31f1a13d-3829-5af9-9b65-e5da1181b9ac', 'DKK', 2),
  ('a280144a-a4a0-55cd-98db-7b8acf25a638', 'PLN', 2),
  ('d281d5cf-cdd5-5207-93a5-df1f80e6de84', 'CZK', 2),
  ('8b951c59-bbd1-539b-9336-4174fbf47bdb', 'HUF', 2),
  ('8b33cd38-5e20-5145-bee9-c0b81c9a81ba', 'RON', 2),
  ('b500e177-a2ff-5a55-b0b6-868dc91a10f6', 'MXN', 2),
  ('50850a6c-39ff-5f35-85aa-afd6ea3732e6', 'BRL', 2),
  ('6cbdabc6-2d2f-5090-a063-3a366f9fd23d', 'ARS', 2),
  ('3304aa15-10b1-5eca-a6c8-3c149a9f91f1', 'COP', 2),
  ('a85ae854-0a0d-51de-bb34-4b7a20229bb9', 'CLP', 0);
