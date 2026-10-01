import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { createClient } from "@hifago/supabase/server";
import { isRealAccount } from "@hifago/supabase/identity";
import { getCartLines } from "@/lib/cart/getCartLines";
import { getPendingOrdersForViewer } from "@/lib/orders/getPendingOrdersForViewer";
import { getPartnerAccountProfileFields } from "@/lib/account/getMyProfile";
import { CartSummary } from "@/components/organisms/CartSummary";
import { CheckoutForm } from "./CheckoutForm";
import { PendingOrdersNotice } from "../PendingOrdersNotice";
import type { Locale } from "@/messages";

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/pago">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "CheckoutPage" });
  // Un panier n'a rien d'indexable, et son contenu est propre à une session. noindex plutôt que
  // Disallow, pour la raison expliquée sur les écrans d'authentification (spec 26 §5.1).
  return { title: t("title"), robots: { index: false, follow: true } };
}

export default async function CheckoutPage({
  params,
}: PageProps<"/[locale]/pago">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("CheckoutPage");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Spec 32 (panier en base) : l'attribution est désormais capturée dans carts.attribution_code
  // dès le premier ajout au panier (CartContext, via /api/cart/attribution) — create_order la lit
  // lui-même côté serveur, plus besoin de relire le cookie hifago_ref ici pour la lui transmettre.
  const lines = await getCartLines(locale as Locale);

  // Feature 32 — pré-remplissage pour un client connecté (cahier des charges client §2 point 6) :
  // l'email vient toujours du compte auth (garanti dès l'inscription email/mot de passe). Nom/
  // téléphone : depuis la spec 35, le PROFIL (`partner_accounts.full_name`/`.phone`, existant
  // depuis le 2026-08-19) fait foi (décision ⑦) — la commande la plus récente n'est plus qu'un
  // REPLI, pour un compte qui n'a jamais édité son profil sur `/cuenta/perfil`. RLS déjà scopée à
  // account_id = auth.uid() (même garde que /cuenta/reservas) — un champ pré-rempli reste
  // éditable, jamais un verrou (CheckoutForm.tsx).
  //
  // ⚠️ Tout ou rien, jamais champ par champ : `full_name` vide veut dire « profil jamais édité »
  // (c'est la RPC d'édition qui l'exige non vide — `update_my_account_profile`), donc son absence
  // est un signal fiable pour retomber sur la commande. Un profil édité avec un téléphone laissé
  // vide, lui, ne retombe PAS sur celui d'une commande passée — mélanger les deux sources ferait
  // apparaître un numéro que le client a délibérément retiré de son profil.
  let initialHolderName = "";
  let initialHolderPhone = "";
  const initialHolderEmail = user?.email ?? "";
  if (user) {
    // Même lecture que `getMyProfile()` (`/cuenta/perfil`), factorisée — mais pas `getMyProfile()`
    // elle-même : elle rappellerait `getViewerAccount()`, donc un second `auth.getUser()` (un vrai
    // aller-retour réseau, `user` est déjà résolu ci-dessus), et une garde `isRealAccount` stricte
    // là où cet écran accepte aussi un invité (`if (user)`).
    const profile = await getPartnerAccountProfileFields(supabase, user.id);

    if (profile.fullName) {
      initialHolderName = profile.fullName;
      initialHolderPhone = profile.phone;
    } else {
      const { data: lastOrder, error: lastOrderError } = await supabase
        .from("orders")
        .select("holder_name, holder_phone")
        .eq("account_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      // Même règle que la lecture du profil juste au-dessus : une panne n'est jamais « aucune
      // commande passée ». Elle lève, l'écran d'erreur de la zone (tunnel) prend le relais, au lieu
      // d'un titulaire pré-rempli à vide sans le moindre signal.
      if (lastOrderError) throw lastOrderError;
      initialHolderName = lastOrder?.holder_name ?? "";
      initialHolderPhone = lastOrder?.holder_phone ?? "";
    }
  }

  // create_order vide cart_items dès qu'elle réussit (spec 32) : un panier vide peut donc cacher
  // une commande déjà réservée, pas encore payée. Lu SEULEMENT sur ce chemin déjà froid — jamais
  // sur le chemin chaud d'un panier normal. Ne réutilise pas `user` déjà résolu ci-dessus : deux
  // signatures différentes selon l'appelant auraient été la première divergence entre `/mi-viaje`
  // et `/pago`, qui n'a pas cet accès (cf. `getPendingOrdersForViewer.ts`).
  const pendingOrders = lines.length === 0 ? await getPendingOrdersForViewer() : [];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <CartSummary lines={lines} editable={false} locale={locale as Locale} />
      {lines.length > 0 ? (
        <CheckoutForm
          // ⚠️ Spec 33 — `isRealAccount`, jamais `Boolean(user)` seul. Depuis la spec 31 un invité
          // A une identité : le calcul d'origine masquait le lien « Iniciar sesión » du formulaire
          // (le seul du tunnel) à tous ceux qui en avaient justement besoin.
          isAuthenticated={isRealAccount(user)}
          initialHolderName={initialHolderName}
          initialHolderPhone={initialHolderPhone}
          initialHolderEmail={initialHolderEmail}
        />
      ) : null}
      <PendingOrdersNotice
        orders={pendingOrders}
        title={t("pendingOrdersTitle")}
        linkLabel={(reference) => t("pendingOrderLink", { reference })}
      />
    </main>
  );
}
