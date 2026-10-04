import { createClient } from "@hifago/supabase/server";
import { JoinForm } from "./JoinForm";

// Premier écran du portail socio (/partner) dans tout le projet. Cette app n'est pas localisée (cf.
// hifago/CLAUDE.md — i18n/next-intl ne vise qu'apps/web) : tout le texte de cet écran, y compris
// les messages d'erreur de JoinForm, est en français en dur, assumé.
export default async function PartnerJoinPage({
  searchParams,
}: PageProps<"/partner/join">) {
  const resolvedSearchParams = await searchParams;
  const tokenParam = resolvedSearchParams?.token;
  const token = typeof tokenParam === "string" ? tokenParam : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Un visiteur déjà authentifié (retour de GoogleButton via /auth/callback?next=/partner/join?
  // token=…, ou toute session existante) n'a pas besoin de recréer un compte email/mot de passe :
  // consume_partner_invitation ne s'appuie que sur auth.uid(), jamais sur le mode de connexion
  // (cf. JoinForm.tsx). Le nom Google (user_metadata) ne sert qu'à préremplir le champ, toujours
  // éditable — c'est le signataire déclaré, pas une donnée Google figée.
  const initialUser = user
    ? {
        email: user.email ?? "",
        fullName:
          typeof user.user_metadata?.full_name === "string"
            ? user.user_metadata.full_name
            : typeof user.user_metadata?.name === "string"
              ? user.user_metadata.name
              : "",
      }
    : null;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Únete a Hifago</h1>
      <JoinForm token={token} initialUser={initialUser} />
    </main>
  );
}
