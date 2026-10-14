import { createClient } from "@hifago/supabase/server";
import { JoinForm } from "./JoinForm";
import { LogoHifago } from "@/components/logo-hifago";

// Premier écran du portail socio (/partner) dans tout le projet. Cette app n'est pas localisée (cf.
// hifago/CLAUDE.md — i18n/next-intl ne vise qu'apps/web) : tout le texte de cet écran, y compris
// les messages d'erreur de JoinForm, est en espagnol en dur, assumé.
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

  // Invitation envoyée PAR E-MAIL : l'inscription exige cette même adresse (arbitrage de Gabriel,
  // au nom de Jérôme). `check_partner_invitation` la rend (`invited_email`) ; le formulaire verrouille
  // alors le champ. Panne, invitation refusée ou base sans le champ : champ libre, comme avant — la
  // base refuse de toute façon un autre e-mail à la consommation (`email_mismatch`), ce verrou n'est
  // qu'une aide à la saisie.
  let invitedEmail: string | null = null;
  if (token) {
    const { data, error } = await supabase.rpc("check_partner_invitation", { p_token: token });
    if (error) {
      console.error("partner/join : lecture de l'invitation impossible", error.message);
    } else {
      const check = data as { ok?: boolean; invited_email?: unknown } | null;
      if (check?.ok === true && typeof check.invited_email === "string" && check.invited_email.trim() !== "") {
        invitedEmail = check.invited_email;
      }
    }
  }

  // Retour du callback quand un compte Google tout neuf ne porte pas l'adresse de l'invitation
  // (auth/callback/route.ts) : seul ce motif connu est relayé, jamais un texte libre de l'URL.
  const initialError = resolvedSearchParams?.error === "email_mismatch" ? "email_mismatch" : null;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-8">
      <LogoHifago variante="clair" hauteur="h-16" />
      <h1 className="titre-page">Únete a Hifago</h1>
      <JoinForm
        token={token}
        initialUser={initialUser}
        invitedEmail={invitedEmail}
        initialError={initialError}
      />
    </main>
  );
}
