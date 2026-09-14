/**
 * EL MODELO DE CATEGORÍA, reexportado desde su nuevo sitio.
 *
 * Se mudó a `lib/categories/` cuando el alta de un gasto compartido necesitó el
 * mismo catálogo: `api.category` es global —no del Modo Personal— y una feature
 * no puede importar de otra.
 *
 * **Se reexporta desde aquí a propósito.** Once ficheros de esta feature lo
 * importan de este módulo, y cambiarlos todos para mover uno habría convertido
 * una mudanza en una pasada de riesgo sobre pantallas aprobadas.
 */
export {
  type CategoryOption,
  type CategoryRow,
  categoryIcon,
  categoryName,
  categoryOptions,
  indexCategories,
  SYSTEM_CATEGORY_COUNT,
  systemCategoryKey,
} from '@/lib/categories/category';
