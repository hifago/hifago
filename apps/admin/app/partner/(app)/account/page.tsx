import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { LogoutButton } from "@/components/LogoutButton";
import { ProfileBlock } from "./ProfileBlock";
import { EmailBlock } from "./EmailBlock";
import { PasswordBlock } from "./PasswordBlock";
import { PayoutAccountBlock } from "./PayoutAccountBlock";
import { payoutAccountSuffix } from "@/lib/payout/payoutAccountSuffix";

// Server Component qui fait le fetch et passe des données déjà sérialisées à des sous-composants
// "use client" (idiome hifago/CLAUDE.md §2 point 3a) — les 3 blocs touchent des ressources
// distinctes (partner_accounts, auth.users email, mot de passe) et sont donc des composants
// séparés plutôt qu'un unique formulaire.
export default async function PartnerAccountPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/partner/account");
  }

  // Chaque lecture LÈVE sur une panne (app/error.tsx, 2026-10-01) : un profil lu vide serait
  // écrasé au premier enregistrement, et un bloc de paiement masqué dirait « rien à régler ».
  const { data: account, error: accountError } = await supabase
    .from("partner_accounts")
    .select("full_name, phone, partner_id")
    .eq("id", user.id)
    .maybeSingle();
  if (accountError) {
    throw new Error(`Lecture du compte impossible (partner_accounts) : ${accountError.message}`);
  }

  // La cuenta de pago n'a de sens que pour une identité referrer (elle seule reçoit une
  // commission) — un operator pur n'a rien à y faire, cf. partner_payout_accounts (spec 19
  // §10 point 7). N'importe quel statut ('active' ou 'suspended'), même raisonnement que
  // hasOperatorCapability dans nav-items.ts. `.limit(1)` : seule la présence compte, et
  // `maybeSingle()` sur plusieurs lignes serait une erreur.
  const { data: referrerCapability, error: capabilityError } = account?.partner_id
    ? await supabase
        .from("partner_capabilities")
        .select("id")
        .eq("partner_id", account.partner_id)
        .eq("role", "referrer")
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };
  if (capabilityError) {
    throw new Error(`Lecture des capacités impossible (partner_capabilities) : ${capabilityError.message}`);
  }

  // Le compte complet est lu ICI, côté serveur, et seul son suffixe part au navigateur (cahier
  // socio, décision du 2026-08-11 : « jamais la donnée en clair après saisie »).
  const { data: payoutAccount, error: payoutError } = account?.partner_id
    ? await supabase
        .from("partner_payout_accounts")
        .select("mercadopago_account")
        .eq("partner_id", account.partner_id)
        .maybeSingle()
    : { data: null, error: null };
  if (payoutError) {
    throw new Error(`Lecture du compte de paiement impossible (partner_payout_accounts) : ${payoutError.message}`);
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Mi cuenta</h1>

      <ProfileBlock
        initialFullName={account?.full_name ?? ""}
        initialPhone={account?.phone ?? ""}
      />
      <EmailBlock initialEmail={user.email ?? ""} />
      <PasswordBlock />
      {referrerCapability ? (
        <PayoutAccountBlock registeredSuffix={payoutAccountSuffix(payoutAccount?.mercadopago_account)} />
      ) : null}

      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-lg font-medium">Cerrar sesión</h2>
        <p className="text-sm text-muted">Cierra tu sesión en este dispositivo.</p>
        <LogoutButton data-testid="logout-button-page" />
      </section>
    </div>
  );
}
