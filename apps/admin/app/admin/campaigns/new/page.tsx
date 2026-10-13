import { NewCampaignForm } from "./NewCampaignForm";

export default function NewCampaignPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="titre-page">Nueva campaña</h1>
      <NewCampaignForm />
    </div>
  );
}
