import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { asLocalizedField, formatCop, resolveLocalizedField } from "@hifago/domain";
import { COMMISSION_STATE_LABELS } from "../commissionStateLabels";

// Fiche minimale (migration vers DataList, 2026-08-20, docs/specs/22-vue-referent-restreinte.md
// addendum) — nécessaire parce que DataList pointe TOUJOURS sa 1re colonne vers
// `${basePath}/${id}` sans échappatoire (packages/ui/src/components/data-list.tsx), pas parce
// qu'un référent a besoin d'un écran séparé : tous les champs affichés ici sont déjà visibles sur
// la ligne de liste, aucune donnée supplémentaire. Jamais un `Chip`/composant `@hifago/ui` importé
// ici (piège hifago/CLAUDE.md §11.16 : un Server Component qui importe quoi que ce soit du barrel
// `@hifago/ui` plante `next build` depuis que le barrel embarque AppNavShell) — état affiché en
// texte brut, même patron que `admin/tags/[id]/page.tsx` (fiche minimale existante, `<dl>` nu).
export default async function PartnerCommissionDetailPage({
  params,
}: PageProps<"/partner/commissions/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  // Même RPC que la liste (partner_commissions_list, 20260930211348), filtrée sur l'id : la fiche
  // n'affiche que des colonnes déjà présentes sur la ligne de liste. Le périmètre (le partenaire
  // du compte connecté, entrées `referrer` seulement) est calculé DANS la RPC depuis `auth.uid()` :
  // un référent qui devine l'id d'une entrée qui n'est pas la sienne obtient zéro ligne, donc 404.
  // Une ERREUR, elle, lève : avant ce correctif, l'embed `order_lines` refusé depuis le revoke du
  // 2026-09-22 finissait en 404 sur TOUTES les fiches, indiscernable d'un id inconnu.
  const { data: entries, error } = await supabase.rpc("partner_commissions_list", {
    p_entry_id: id,
    p_limit: 1,
  });
  if (error) {
    // 22P02 = `id` de l'URL qui n'est pas un uuid : une adresse inconnue, donc 404 comme avant,
    // jamais une panne.
    if (error.code === "22P02") notFound();
    throw new Error(`Lecture de la commission impossible (partner_commissions_list) : ${error.message}`);
  }
  const entry = entries[0];
  if (!entry) {
    notFound();
  }

  const productName = resolveLocalizedField(asLocalizedField(entry.product_name), "es") ?? "—";
  const establishmentName = resolveLocalizedField(asLocalizedField(entry.establishment_name), "es") ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/partner/commissions" className="text-sm text-muted hover:underline">
          ← Volver a Mis comisiones
        </Link>
        <h1 className="text-2xl font-semibold" data-testid="commission-detail-product">
          {productName}
        </h1>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <div>
          <dt className="text-muted">Fecha</dt>
          <dd>{entry.date}</dd>
        </div>
        <div>
          <dt className="text-muted">Establecimiento</dt>
          <dd>{establishmentName}</dd>
        </div>
        <div>
          <dt className="text-muted">Cliente</dt>
          <dd>{entry.holder_name}</dd>
        </div>
        <div>
          <dt className="text-muted">Monto total</dt>
          <dd>{formatCop(entry.total_cop)}</dd>
        </div>
        <div>
          <dt className="text-muted">% referido</dt>
          <dd>{Math.round(entry.referrer_pct * 100)}%</dd>
        </div>
        <div>
          <dt className="text-muted">Comisión referente</dt>
          <dd data-testid="commission-detail-amount">{formatCop(entry.amount_cop)}</dd>
        </div>
        <div>
          <dt className="text-muted">Estado</dt>
          <dd data-testid="commission-detail-state">
            {COMMISSION_STATE_LABELS[entry.status] ?? entry.status}
          </dd>
        </div>
      </dl>
    </div>
  );
}
