import { NewInvitationForm } from "./NewInvitationForm";

export default function NewInvitationPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="titre-page">Nueva invitación</h1>
      <NewInvitationForm />
    </div>
  );
}
