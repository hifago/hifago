import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getOrderByToken } from "@/lib/orders/getOrderByToken";
import { viewerIsRealAccount } from "@/lib/auth/viewer";
import { PageShell } from "@/components/atoms/PageShell";
import { Title } from "@/components/atoms/Title";
import { OrderResult } from "./OrderResult";
import type { Locale } from "@/messages";

// L'ÉCRAN DE RÉSULTAT D'UNE COMMANDE (spec 33 §5) — l'adresse propre à une réservation, décidée
// au cahier client §2b.9 le 2026-09-07.
//
// ⚠️ ZONE VITRINE, PAS TUNNEL, et c'est une décision (⑦ du 2026-09-10) : en-tête et pied de page
// complets. Le paiement est terminé, il n'y a plus rien à protéger d'une fuite — et un client qui
// rouvre ce lien trois mois plus tard depuis son email doit trouver un site autour de sa
// réservation, pas le cul-de-sac qu'est la coquille du tunnel (un seul lien « Hifago », ni menu ni
// pied de page).
//
// ⚠️ AUCUN `robots: { index: false }` ICI, et ce n'est pas un oubli. `.claude/rules/seo.md` règle 5 :
// « Disallow empêche le crawl, noindex l'indexation — jamais les deux sur la même page ». Ce qu'on
// veut ici, c'est empêcher le CRAWL : un robot ne doit jamais CHARGER une page qui porte le nom, le
// téléphone et l'email d'un client. Un noindex exigerait au contraire qu'il la charge pour lire la
// balise. D'où `/es/reserva/`, `/en/reserva/` dans le Disallow de `app/robots.ts` — et rien ici.
// C'est l'inverse de `/pago` et `/mi-viaje`, qui ont raison de faire l'inverse : rien de personnel
// n'y est rendu.
//
// Cette route n'appelle pas Supabase elle-même (`scripts/check-data-layer.sh`) : `lib/orders/` lit
// la commande, `lib/auth/` résout qui regarde.

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/reserva/[token]">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "OrderResultPage" });
  // Titre générique : le numéro de réservation n'a rien à faire dans un titre d'onglet, qui se
  // retrouve dans l'historique du navigateur et les captures d'écran partagées.
  return { title: t("metaTitle") };
}

export default async function OrderResultPage({
  params,
  searchParams,
}: PageProps<"/[locale]/reserva/[token]">) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("OrderResultPage");

  // Les deux lectures sont indépendantes — les enchaîner ajoutait un aller-retour réseau complet
  // sur le chemin CHAUD de cet écran : au retour de Mercado Pago le visiteur a une session (posée
  // au premier ajout au panier, spec 31), donc `getUser()` interroge réellement Supabase. Sans
  // session — le lien ouvert depuis l'email — il rend immédiatement, et le seul coût du parallèle
  // est un appel inutile sur un jeton invalide, c'est-à-dire sur un 404.
  const [order, isRealAccount] = await Promise.all([
    getOrderByToken(token, locale as Locale),
    viewerIsRealAccount(),
  ]);

  // Jeton inconnu, malformé, ou commande absente : la RPC ne distingue jamais les trois, et cet
  // écran non plus — 404, sans message qui trahirait laquelle des trois situations est la bonne.
  // Une PANNE n'arrive jamais ici : `getOrderByToken` lève, l'écran d'erreur de la zone prend le
  // relais (500), et le client peut réessayer au lieu de croire sa commande perdue.
  if (!order) notFound();

  // `?payment=` posé par les back_urls Mercado Pago (create/route.ts) ou par le simulateur de dev
  // (mock-confirm/route.ts) — jamais consulté pour DÉCIDER de l'état de la commande (dérivé de la
  // base par `deriveOrderState`), seulement pour dire à `OrderResult` qu'il vient d'être redirigé
  // depuis un paiement rejeté, un aller-retour qu'un simple rechargement de page ne reproduit pas.
  const resolvedSearchParams = await searchParams;
  const paymentParam = resolvedSearchParams?.payment;
  const paymentOutcome =
    paymentParam === "approved" || paymentParam === "pending" || paymentParam === "rejected"
      ? paymentParam
      : null;

  return (
    <PageShell variant="narrow" testId="order-result-page">
      <Title as="h1">{t("title", { reference: order.reference })}</Title>
      <OrderResult
        order={order}
        locale={locale as Locale}
        isRealAccount={isRealAccount}
        paymentOutcome={paymentOutcome}
      />
    </PageShell>
  );
}
