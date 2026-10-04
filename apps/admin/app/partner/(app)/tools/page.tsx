import { redirect } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { PartnerCodeEntry } from "./PartnerCodeEntry";

// /r/[code] vit dans apps/web (vitrine), pas dans cette app — le lien de parrainage doit donc
// pointer vers l'origine publique d'apps/web (NEXT_PUBLIC_WEB_APP_URL), jamais vers l'origine de
// la requête courante (ce serait l'origine d'apps/admin depuis la scission monorepo web/admin du
// 2026-08-14). Locale en dur "es" (routing.defaultLocale d'apps/web) : cette app n'est pas
// localisée par next-intl, elle ne connaît pas la locale courante d'un visiteur de la vitrine.
const LOCALE = "es";
// process.env.NEXT_PUBLIC_* est inliné au build : un `!` silencieux produirait ici un lien
// "undefined/es/r/<code>" plutôt qu'une erreur — échec explicite au premier chargement de cette
// page si la variable manque, pas une chaîne cassée distribuée à un socio.
if (!process.env.NEXT_PUBLIC_WEB_APP_URL) {
  throw new Error("NEXT_PUBLIC_WEB_APP_URL manquante — requise pour le lien de parrainage.");
}
const WEB_APP_URL = process.env.NEXT_PUBLIC_WEB_APP_URL;

export default async function PartnerToolsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/partner/tools");
  }

  // partner_id_for_account (même RPC que partner/products/page.tsx et partner/commissions/page.tsx).
  // Chaque lecture LÈVE sur une panne (lib/supabase/checkedRead.ts) : lue comme une absence, elle
  // affichait « aucun code » à un référent qui en a.
  const { data: partnerId } = checkedRead(
    await supabase.rpc("partner_id_for_account", { uid: user.id }),
    "partner_id_for_account",
  );

  // partner_codes_select_public (lecture déjà publique, Tranche 1) — scopée ici au partenaire
  // connecté (pas tous les codes existants, cf. plan feature 18). active=true seulement : un
  // partenaire ne doit distribuer que des codes qui résolvent réellement une attribution, même
  // filtre que /r/[code] et que create_order côté résolution.
  // Sans organisation, rien à lire — jamais un filtre sur un identifiant vide, qui échouerait.
  const { data: codes } = checkedRead(
    partnerId
      ? await supabase
          .from("partner_codes")
          .select("code")
          .eq("partner_id", partnerId)
          .eq("active", true)
          .order("code")
      : { data: [] as { code: string }[], error: null },
    "partner_codes",
  );

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Mi enlace y QR</h1>
        <p className="text-sm text-muted">
          Comparte tu código, tu enlace o tu código QR — toda reserva hecha a través de ellos
          queda atribuida a ti.
        </p>
      </div>

      {codes && codes.length > 0 ? (
        <div className="flex flex-col gap-6">
          {codes.map((row) => (
            <PartnerCodeEntry
              key={row.code}
              code={row.code}
              link={`${WEB_APP_URL}/${LOCALE}/r/${row.code}`}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">Todavía no tienes ningún código.</p>
      )}
    </div>
  );
}
