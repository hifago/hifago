import { createClient } from "@hifago/supabase/server";
import type { PreferenceLine } from "@/lib/mercadopago/preferenceData";

// Lecture du DÉTAIL d'une commande pour enrichir la préférence Mercado Pago (bug anti-fraude du
// 2026-10-23, spec 19 §0 Tranche 1). Même rôle et même garde que `getOrderByToken.ts`, dont elle
// copie le patron : la RPC `get_order_by_token` est `security definer`, son garde est le jeton, et
// la lecture passe par le client de SESSION.
//
// ⚠️ Jamais d'embed `order_lines(…)` sur une lecture de `payments`/`orders`, ni `.from("order_lines")` :
// une session n'a plus le SELECT sur `order_lines` depuis 20260922210000, et
// `scripts/check-order-lines-access.sh` l'interdit — la lecture avalée en silence est précisément
// l'incident qui l'a fait naître.
//
// ⚠️ AU MIEUX, JAMAIS BLOQUANTE : le détail enrichit la préférence, il ne conditionne pas le paiement.
// Toute panne (RPC en erreur, délai dépassé, jeton inconnu, réponse inattendue) rend `null` et la
// route retombe sur l'item agrégé au même montant. Un client ne perd jamais sa réservation parce que
// le détail de ses lignes n'a pas pu être lu.

type RpcLine = {
  id: string;
  product_name: unknown;
  product_type: string | null;
  establishment_name: unknown;
  date: string;
  end_date: string | null;
  duration_days: number | null;
  slot_start_time: string | null;
  qty: number;
  acompte_cop: number;
  status: string;
};

type RpcResult = { ok?: boolean; order?: { lines?: RpcLine[] } } | null;

/**
 * Les lignes de la commande portée par `accessToken`, ou `null` si elles n'ont pas pu être lues dans
 * le délai. `timeoutMs` borne TOUT l'aller-retour (corps compris) : la route l'ajoute à son budget
 * de durée.
 */
export async function getOrderLinesForPreference(
  accessToken: string,
  timeoutMs: number
): Promise<PreferenceLine[] | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("get_order_by_token", { p_token: accessToken })
      .abortSignal(AbortSignal.timeout(timeoutMs));
    if (error) {
      console.error("payments/create : détail de la commande illisible, item agrégé", error);
      return null;
    }
    const result = data as RpcResult;
    if (!result?.ok || !Array.isArray(result.order?.lines)) return null;
    return result.order.lines.map((line) => ({
      id: line.id,
      productName: line.product_name,
      productType: line.product_type,
      establishmentName: line.establishment_name,
      date: line.date,
      endDate: line.end_date,
      durationDays: line.duration_days,
      slotStartTime: line.slot_start_time,
      qty: line.qty,
      acompteCop: line.acompte_cop,
      status: line.status,
    }));
  } catch (error) {
    console.error("payments/create : détail de la commande illisible, item agrégé", error);
    return null;
  }
}
