import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { toTagOptions } from "@/lib/tags/proposedTags";
import { NewEstablishmentProposalForm } from "./NewEstablishmentProposalForm";

export default async function NewEstablishmentProposalPage() {
  const supabase = await createClient();

  // Étiquettes et équipements (migration 20261015004421) : proposables dès la création, comme le
  // reste de la fiche. Une panne LÈVE (lib/supabase/checkedRead.ts) : lue comme une absence, elle
  // afficherait deux listes vides sans rien dire.
  const [tagsResult, amenitiesResult] = await Promise.all([
    supabase.from("catalog_tags").select("id, label").order("slug"),
    supabase.from("catalog_amenities").select("id, label").order("category_key").order("sort_order"),
  ]);
  const { data: tags } = checkedRead(tagsResult, "catalog_tags");
  const { data: amenities } = checkedRead(amenitiesResult, "catalog_amenities");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="titre-page">Proponer un nuevo establecimiento</h1>
      <p className="text-sm text-muted">
        Un admin revisará tu propuesta antes de que el establecimiento aparezca en el registro.
      </p>
      <NewEstablishmentProposalForm availableTags={toTagOptions(tags)} availableAmenities={toTagOptions(amenities)} />
    </div>
  );
}
