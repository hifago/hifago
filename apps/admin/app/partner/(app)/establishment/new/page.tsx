import { NewEstablishmentProposalForm } from "./NewEstablishmentProposalForm";

export default function NewEstablishmentProposalPage() {
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
