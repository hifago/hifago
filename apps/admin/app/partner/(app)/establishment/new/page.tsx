import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { RejectionNotice } from "@/components/rejection-notice";
import { NewEstablishmentProposalForm } from "./NewEstablishmentProposalForm";

export default async function NewEstablishmentProposalPage({
  searchParams,
}: PageProps<"/partner/establishment/new">) {
  const { corregir } = (await searchParams) ?? {};

  // Migration 20261104130000 : `?corregir=<proposition>` rouvre une proposition REFUSÉE, remplie
  // de ce qu'elle contenait. RLS : un partenaire ne lit que les siennes.
  if (typeof corregir === "string") {
    const supabase = await createClient();
    const { data: proposal } = checkedRead(
      await supabase
        .from("establishment_proposals")
        .select("id, payload, rejection_reason")
        .eq("id", corregir)
        .eq("kind", "create")
        .eq("status", "rejected")
        .maybeSingle(),
      "establishment_proposals",
    );
    if (!proposal) {
      redirect("/partner/establishment");
    }

    return (
      <div className="flex flex-col gap-6">
        <h1 className="titre-page">Corregir tu propuesta de establecimiento</h1>
        <RejectionNotice title="Un administrador rechazó esta propuesta" reason={proposal.rejection_reason}>
          Cambia solo lo que no estaba bien y vuelve a enviarla: todo lo demás ya está guardado. Los
          servicios rechazados junto con el establecimiento volverán a revisión con él.
        </RejectionNotice>
        <NewEstablishmentProposalForm correction={{ proposalId: proposal.id, payload: proposal.payload }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="titre-page">Proponer un nuevo establecimiento</h1>
      <p className="text-sm text-muted">
        Un admin revisará tu propuesta antes de que el establecimiento aparezca en el registro.
      </p>
      <NewEstablishmentProposalForm />
    </div>
  );
}
