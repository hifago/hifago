import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { asLocalizedField, resolveLocalizedField } from "@hifago/domain";
import { NewEstablishmentForm } from "./NewEstablishmentForm";

export default async function NewEstablishmentPage({
  searchParams,
}: PageProps<"/admin/establishments/new">) {
  const supabase = await createClient();

  // RLS (partners_select) : l'admin voit tous les partenaires, nécessaire pour le sélecteur.
  // Chaque lecture LÈVE sur une panne (lib/supabase/checkedRead.ts) : une liste de partenaires
  // vide rendrait le formulaire inutilisable sans dire pourquoi.
  const { data: partners } = checkedRead(
    await supabase.from("partners").select("id, display_name").order("display_name"),
    "partners",
  );

  // Équipements structurés (migration 20260917110000, décision Jérôme du 2026-09-17) — stagés à la
  // création comme le reste du formulaire (contrairement aux tags, qui n'ont aucun équivalent ici :
  // demande explicite, pas un réemploi du gating existant). Chargé inconditionnellement, un
  // établissement est TOUJOURS éligible (même raisonnement que EstablishmentAmenitiesBlock).
  const { data: amenitiesRaw } = checkedRead(
    await supabase
      .from("catalog_amenities")
      .select("id, label, category_key")
      .order("category_key")
      .order("sort_order"),
    "catalog_amenities",
  );
  const allAmenities = (amenitiesRaw ?? []).map((amenity) => ({
    id: amenity.id,
    label: resolveLocalizedField(asLocalizedField(amenity.label), "es") ?? amenity.id,
  }));

  // ?partner_id= optionnel (docs/specs/05-invitations-onboarding-dashboard-partenaire.md §5.6) —
  // préremplit le partner propriétaire depuis le badge « Falta establecimiento » de
  // /admin/invitations, sans changer le comportement par défaut (aucun param = formulaire vide).
  const resolvedSearchParams = await searchParams;
  const partnerIdParam = resolvedSearchParams?.partner_id;
  const defaultPartnerId = typeof partnerIdParam === "string" ? partnerIdParam : null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Nuevo establecimiento</h1>
      <NewEstablishmentForm
        partners={partners ?? []}
        defaultPartnerId={defaultPartnerId}
        allAmenities={allAmenities}
      />
    </div>
  );
}
