import type { Metadata } from "next";
import { redirect } from "@/i18n/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getMyOrders } from "@/lib/orders/getMyOrders";
import { viewerIsRealAccount } from "@/lib/auth/viewer";
import { PageShell } from "@/components/atoms/PageShell";
import { Title } from "@/components/atoms/Title";
import { LinkButton } from "@/components/atoms/LinkButton";
import { EstadoVacio } from "@/components/molecules/EstadoVacio";
import { Aviso } from "@/components/molecules/Aviso";
import { BandeauPagina } from "@/components/organisms/BandeauPagina";
import { OrderCard } from "./OrderCard";
import type { Locale } from "@/messages";

// « MIS RESERVAS » — la liste des réservations du compte (spec 34).
//
// ⚠️ CETTE ROUTE N'APPELLE PLUS SUPABASE ELLE-MÊME, et c'est le point du lot : elle était l'une des
// DEUX dernières exemptions de `scripts/check-data-layer.sh`, dont l'en-tête dit « cette liste doit
// RÉTRÉCIR à chaque lot, une ligne ajoutée est une régression ». La lecture vit dans
// `lib/orders/getMyOrders.ts`, la résolution de qui regarde dans `lib/auth/viewer.ts`, et
// l'exemption est retirée du script dans le même commit. Il n'en reste qu'une.
//
// ⚠️ LA GARDE REFUSE UNE IDENTITÉ ANONYME (décision ⑦, 2026-09-11), là où elle se contentait de
// `Boolean(user)`. Depuis la spec 31, `getUser()` rend un utilisateur pour une session anonyme —
// posée dès le premier ajout au panier — et cet écran lui était donc ouvert, ce que la spec 31
// nommait un gain voulu. Jérôme l'a renversé : un invité n'a pas d'espace compte. Le recul est
// théorique, aucun chemin de l'interface n'y menait un invité (`SiteMenu` lui affiche « Iniciar
// sesión », `/reserva/<jeton>` « Crear una cuenta ») — la garde ne fait qu'aligner la route sur ce
// que le chrome dit déjà.
//
// ⚠️ Cette garde-ci ne protège QUE cette route. La garde de ZONE vit dans `(cuenta)/layout.tsx`,
// qui appartient au lot `/cuenta/perfil` construit en parallèle : tant qu'elle n'y est pas posée,
// les autres écrans de la zone restent ouverts à un invité. Signalé à Jérôme, pas corrigé ici.
// Le refus vit aussi EN BASE (`list_my_orders` → `anonymous_session`), donc il tient même si une
// garde d'écran saute un jour.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("AccountOrdersPage");
  // Pas de `robots` ici : la zone entière est déjà `index: false` par son layout, et le
  // re-déclarer ferait rougir `scripts/check-seo.sh`.
  return { title: t("metaTitle") };
}

export default async function AccountOrdersPage({
  params,
}: PageProps<"/[locale]/cuenta/reservas">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("AccountOrdersPage");

  if (!(await viewerIsRealAccount())) {
    redirect({ href: "/entrar?next=/cuenta/reservas", locale });
  }

  const orders = await getMyOrders(locale as Locale);

  // Plan 41, P8 : le bandeau or `contenido` porte le seul `<h1>` (« Mis reservas● »), puis la page
  // passe au clair. Le contenu tient dans `max-w-3xl`, aligné à gauche sur le titre : une carte de
  // commande étirée sur les 960 px de la colonne écarterait ses montants de leur prestation.
  return (
    <PageShell variant="pagina" testId="mis-reservas-page">
      <BandeauPagina variante="contenido" titulo={t("title")} testId="mis-reservas-bandeau" />

      <div className="flex max-w-3xl flex-col gap-10">
        {orders === null ? (
          // L'erreur est rendue EN LIGNE et non en toast : `SiteToaster` n'est monté nulle part dans
          // `apps/web` (dette connue, signalée depuis le 2026-09-02) — un toast ne s'afficherait
          // jamais, et l'écran serait muet.
          <Aviso tono="error" rol="alert" testId="orders-load-error">
            {t("loadError")}
          </Aviso>
        ) : orders.upcoming.length === 0 && orders.past.length === 0 ? (
          // L'action « explorer » dans l'emplacement de l'état vide (plan 41, S8), au lieu d'un
          // bouton posé à côté : c'est elle qui relance le parcours.
          <EstadoVacio
            titulo={t("empty.titulo")}
            descripcion={t("empty.descripcion")}
            accion={<LinkButton href="/actividades">{t("emptyCta")}</LinkButton>}
            testId="no-orders"
          />
        ) : (
          <>
            {/* Une section vide n'est pas rendue — même règle que les sections de l'accueil. Le
                groupe vient de la base, ce fichier ne fait que le lire. */}
            {orders.upcoming.length > 0 ? (
              <section className="flex flex-col gap-4" data-testid="grupo-proximas">
                <Title as="h2" size="bloque">
                  {t("groupUpcoming")}
                </Title>
                {orders.upcoming.map((order) => (
                  <OrderCard key={order.id} order={order} locale={locale as Locale} />
                ))}
              </section>
            ) : null}

            {orders.past.length > 0 ? (
              <section className="flex flex-col gap-4" data-testid="grupo-pasadas">
                <Title as="h2" size="bloque">
                  {t("groupPast")}
                </Title>
                {orders.past.map((order) => (
                  <OrderCard key={order.id} order={order} locale={locale as Locale} />
                ))}
              </section>
            ) : null}
          </>
        )}
      </div>
    </PageShell>
  );
}
