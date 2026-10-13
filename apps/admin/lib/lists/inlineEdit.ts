import { toast, type DataListRowChange, type DataListSaveResult } from "@hifago/ui";

// Édition en ligne des listes admin (2026-10-13) — ce que les quatre listes éditables ont en
// commun au moment d'enregistrer : une écriture par ligne modifiée, un toast par ligne refusée
// (avec le nom de la ligne, sinon l'admin ne sait pas laquelle), un seul toast de succès.

/**
 * Enregistre chaque ligne modifiée par `saveRow`, qui rend `null` si tout est écrit, sinon le
 * message à afficher. Rend les lignes en échec : la liste leur garde leur brouillon.
 *
 * Les lignes partent en parallèle — elles sont indépendantes, chacune est atomique côté base.
 */
export async function saveInlineChanges<Row>(
  changes: DataListRowChange<Row>[],
  labelOf: (row: Row) => string,
  saveRow: (change: DataListRowChange<Row>) => Promise<string | null>
): Promise<DataListSaveResult> {
  const outcomes = await Promise.all(
    changes.map(async (change) => {
      try {
        return { change, error: await saveRow(change) };
      } catch (cause) {
        // Une panne réseau ne doit pas laisser la barre bloquée sur « Guardando… ».
        console.error("Enregistrement en ligne en échec", cause);
        return { change, error: "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo." };
      }
    })
  );

  const failures = outcomes.filter((outcome) => outcome.error !== null);
  for (const { change, error } of failures) {
    toast.danger(`${labelOf(change.row)}: ${error}`);
  }
  const savedCount = outcomes.length - failures.length;
  if (savedCount > 0) {
    toast.success(savedCount === 1 ? "1 fila guardada." : `${savedCount} filas guardadas.`);
  }
  return { failedRowIds: failures.map(({ change }) => change.rowId) };
}

/**
 * Refus métier rendus par `admin_update_product_inline` (`reason`, migration 20261013145629) →
 * texte pour l'écran. `inlineEdit.contract.test.ts` vérifie que chaque motif que la base peut
 * rendre a son texte ici.
 */
export const PRODUCT_INLINE_REFUSALS: Readonly<Record<string, string>> = {
  not_found: "Esta ficha ya no existe.",
  invalid_name: "El nombre es obligatorio (200 caracteres como máximo).",
  invalid_price: "El precio debe ser un número entero mayor que 0.",
  invalid_type: "Tipo no válido.",
  establishment_not_found: "El establecimiento ya no existe.",
  price_has_tiers: "El precio se define por tramos: edítalo en la ficha.",
  price_free_evento: "Un evento gratuito no tiene precio.",
  must_unpublish_first:
    "Para cambiar el tipo o el establecimiento, pásala primero a «Borrador», guarda, y vuelve a intentarlo.",
  has_orders: "Ya tiene reservas: su tipo y su establecimiento no se pueden cambiar.",
  pms_linked: "Está vinculada a LobbyPMS: su tipo y su establecimiento no se pueden cambiar.",
  pending_proposal: "Tiene una propuesta pendiente: revísala antes de cambiar el tipo o el establecimiento.",
  has_capacity_config: "Tiene cupos, horarios o tarifas por fecha: su tipo no se puede cambiar.",
  camp_needs_duration: "Un campamento necesita su duración: créalo desde «Nueva actividad».",
  evento_needs_date: "Un evento necesita su fecha: créalo desde «Nueva actividad».",
  type_needs_price: "Este tipo necesita un precio.",
};

/** Refus de `admin_rename_establishment` / `admin_rename_partner`. */
export const RENAME_REFUSALS: Readonly<Record<string, string>> = {
  not_found: "Este registro ya no existe.",
  invalid_name: "El nombre es obligatorio (200 caracteres como máximo).",
};

/** `{ ok, reason }` rendu par une RPC d'édition en ligne → `null` si écrit, sinon le texte. */
export function inlineRefusal(
  data: unknown,
  refusals: Readonly<Record<string, string>>,
  fallback: string
): string | null {
  const result = data as { ok?: boolean; reason?: string } | null;
  if (result?.ok) return null;
  const reason = result?.reason;
  return reason && Object.hasOwn(refusals, reason) ? refusals[reason] : fallback;
}
