/**
 * EL CATÁLOGO DE CATEGORÍAS, y por qué vive en `lib/`.
 *
 * `api.category` es un catálogo **global**: no pertenece al Modo Personal, sólo
 * lo estrenó allí. Un gasto compartido lleva categoría por el mismo motivo que
 * uno personal, y una feature no puede leer de otra — así que el modelo y sus
 * resolutores bajan aquí, que es donde los dos pueden verlos.
 *
 * Lo que NO baja es quién lo carga: `useEntryCategories` sigue en `features/`
 * porque monta estado de React y usa el respaldo sin conexión de esa feature.
 * Quien compone una pantalla con las dos cosas es su ruta, que sí puede.
 */
export {
  type CategoryCatalogue,
  type CategoryOption,
  type CategoryRow,
  categoryIcon,
  categoryName,
  categoryOptions,
  indexCategories,
  isSharedCategory,
  sharedCategories,
  SYSTEM_CATEGORY_COUNT,
  systemCategoryKey,
} from './category';
