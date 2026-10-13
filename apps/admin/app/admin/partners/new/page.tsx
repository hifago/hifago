import { NewPartnerForm } from "./NewPartnerForm";

export default function NewPartnerPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="titre-page">Nuevo partner</h1>
      <NewPartnerForm />
    </div>
  );
}
