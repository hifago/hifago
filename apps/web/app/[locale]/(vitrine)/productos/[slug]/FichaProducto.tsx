"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@hifago/ui";
import { Price } from "@/components/atoms/Price";
import { Title } from "@/components/atoms/Title";
import { BackLink } from "@/components/atoms/BackLink";
import { PhotoStrip } from "@/components/molecules/PhotoStrip";
import { AmenidadesList } from "@/components/molecules/AmenidadesList";
import { Link } from "@/i18n/navigation";
import { escribirCriterios } from "@/lib/catalog/criterios";
import { usePrefillUltimosCriterios } from "@/lib/reservas/usePrefillUltimosCriterios";
import type { FichaProducto as DatosFicha } from "@/lib/catalog/tipos";
import type { Locale } from "@/messages";
import { BotonContacto } from "./BotonContacto";
import { LinkButton } from "@/components/atoms/LinkButton";
import { enlaceItinerarioGoogleMaps } from "@/lib/products/enlaceGoogleMaps";
import { ReservationForm } from "./ReservationForm";
import { ProgramaCamp } from "./ProgramaCamp";
import { LodgingReservationForm } from "./LodgingReservationForm";
import { SlotReservationForm } from "./SlotReservationForm";
import { EventoReservationForm } from "./EventoReservationForm";

// LE CORPS DE LA FICHE PRODUIT (spec 30 §5a). Ex-`ProductDetailView`, réécrit sur le socle.
//
// ⚠️ « use client » n'est pas un choix : un Server Component de ce dépôt ne peut pas importer
// `@hifago/ui` (le barrel tire app-nav-shell/lucide-react et fait planter `next build` —
// CLAUDE.md §11.16). Ce fichier reste donc le seul point d'entrée HeroUI de la route.
//
// ⚠️ IL NE POSE PLUS DE `<main>` : c'est `PageShell` qui le fait, une fois, depuis la page. Le
// `<main>` écrit à la main ici portait un `gap-4 p-8` que l'en-tête de `PageShell` qualifie
// nommément de « dérive, pas une décision » — soit 64 px de marge horizontale sur un téléphone de
// 390 px, un sixième de la largeur.
//
// ⚠️ ET IL PORTE ENFIN UN `<h1>`. `Card.Title` de HeroUI rend un `<h3>` : la fiche n'avait donc
// AUCUN titre de niveau 1, et sa hiérarchie mesurée en réel était h3 → h2 → h3. L'invariant 9 de
// la spec 27 était violé sur cette page depuis le début, et rien ne le vérifiait.
//
// ⚠️ Le lien « retour au catalogue » est CONSERVÉ à côté du fil d'Ariane — ce n'est pas un doublon,
// et cet en-tête a affirmé le contraire jusqu'au 2026-09-09. La raison est écrite UNE SEULE FOIS,
// juste au-dessus du `BackLink` dans le corps : ne pas la recopier ici, deux énoncés de la même
// décision finissent par diverger — c'est exactement ce qui s'est passé.

/** Ce que la page a dû composer elle-même, parce que ça se traduit. */
export type EtiquetasFicha = {
  /** La date ou la récurrence d'un evento, déjà mise en phrase. `null` hors evento. */
  ocurrencia: string | null;
};

export function FichaProducto({
  ficha,
  etiquetas,
  locale,
}: {
  ficha: DatosFicha;
  etiquetas: EtiquetasFicha;
  locale: Locale;
}) {
  const t = useTranslations("ProductPage");
  const tCommon = useTranslations("Common");

  // Défaut `"/"` identique au rendu serveur (`sessionStorage` indisponible) : aucun risque
  // d'hydratation, lu une seule fois après montage — par le MÊME hook que les quatre formulaires de
  // réservation, jamais un second lecteur « au montage » de la même mémoire (la clé, le repli et le
  // moment de lecture n'ont qu'un propriétaire). Bug Jérôme du 2026-09-16 : revenir au catalogue
  // depuis une fiche effaçait la recherche en cours. `escribirCriterios` directement, jamais
  // `hrefRetornoCarrito` : celle-ci pose toujours `desdeCarrito=1`, le drapeau de réordonnancement
  // réservé à un ajout au panier réel (page.tsx) — un simple clic « retour » ne doit pas le
  // déclencher.
  // Salida sélectionnée, pour DATER le programme du camp (spec 37). ⚠️ Ce n'est pas un second état
  // à réconcilier : ReservationForm reste seul propriétaire de la sélection, il se contente de la
  // notifier ici (miroir en écriture unique). L'initialiser avec `primeraSalidaIso`, calculé côté
  // serveur, fait que le HTML initial porte déjà de vraies dates — pour un crawler comme pour un
  // visiteur qui n'a encore rien cliqué.
  const [salidaIso, setSalidaIso] = useState<string | null>(ficha.primeraSalidaIso);
  const [hrefRetorno, setHrefRetorno] = useState("/");
  usePrefillUltimosCriterios(
    useCallback((criterios) => setHrefRetorno(`/${escribirCriterios(criterios)}`), [])
  );

  const alojamiento = ficha.alojamiento;

  // `unidad` est une unité de PRIX — à ne pas confondre avec `lodgingKind`, qui est une nature de
  // couchage. `per_two` reste délibérément SANS suffixe : « por dos personas » n'ajoute rien à un
  // prix de chambre que la fiche décrit déjà.
  const sufijoUnidad =
    ficha.unidad === "per_person"
      ? t("perPerson")
      : ficha.unidad === "per_house"
        ? t("perHouse")
        : null;

  // Table explicite plutôt qu'une clé i18n construite dynamiquement : next-intl ne vérifierait plus
  // l'existence de la clé, et une valeur inattendue afficherait son propre nom brut au visiteur.
  const etiquetaCouchage =
    alojamiento?.lodgingKind === "dorm"
      ? t("lodgingKindDorm")
      : alojamiento?.lodgingKind === "private"
        ? t("lodgingKindPrivate")
        : alojamiento?.lodgingKind === "whole_house"
          ? t("lodgingKindWholeHouse")
          : null;

  const faits = [
    etiquetaCouchage,
    alojamiento?.capacity != null ? t("lodgingCapacity", { count: alojamiento.capacity }) : null,
    alojamiento?.unitCount != null ? t("lodgingUnitCount", { count: alojamiento.unitCount }) : null,
  ].filter(Boolean);

  // TRANSPORT — la fenêtre de départs, les places annoncées et le trajet. Tout est INFORMATIF : ces
  // lignes ne changent rien au formulaire de réservation rendu plus bas (un transport reste réservé
  // par DATE), elles répondent juste à « à quelle heure, d'où, vers où » avant que le visiteur
  // choisisse sa date. Demande Jérôme du 2026-09-16.
  const transporte = ficha.transporte;
  // DEUX clés distinctes, jamais une clé construite dynamiquement : `t()` ne vérifierait plus
  // l'existence de la clé (même raison que `etiquetaCouchage` ci-dessus). `primeraSalida ===
  // ultimaSalida` est le cas NORMAL d'un transfert à heure fixe, pas un cas dégradé — d'où le `>=`
  // du CHECK en base.
  const lineaHorario = transporte
    ? [
        transporte.primeraSalida
          ? transporte.primeraSalida === transporte.ultimaSalida
            ? t("transportDepartureSingle", { hora: transporte.primeraSalida })
            : t("transportDepartureRange", {
                desde: transporte.primeraSalida,
                hasta: transporte.ultimaSalida ?? "",
              })
          : null,
        transporte.plazasPorSalida != null
          ? t("transportSeatsPerDeparture", { count: transporte.plazasPorSalida })
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const lineaRuta = transporte
    ? [
        transporte.salida.direccion ? t("transportFrom", { lugar: transporte.salida.direccion }) : null,
        transporte.llegada.direccion ? t("transportTo", { lugar: transporte.llegada.direccion }) : null,
      ]
        .filter(Boolean)
        .join(" → ")
    : "";
  // `null` dès qu'une extrémité n'a pas ses coordonnées : un itinéraire à une seule borne n'existe
  // pas. Les adresses restent affichées dans ce cas — seul le lien disparaît.
  const enlaceMapa = transporte
    ? enlaceItinerarioGoogleMaps(transporte.salida, transporte.llegada)
    : null;

  return (
    <>
      {/* ⚠️ CE LIEN N'EST PAS UN DOUBLON DU FIL D'ARIANE, et il faut dire pourquoi avant que
          quelqu'un le supprime en le prenant pour tel.
          `Migas` rend des `<a href>` NATIFS : `Breadcrumbs.Item` de HeroUI étend le `Link` de
          react-aria, pas le `Link` de `@/i18n/navigation` (c'est écrit dans le composant, et c'est
          pour ça que le préfixe de langue y est posé à la main). Cliquer le fil provoque donc une
          navigation COMPLÈTE — qui vide le panier, tenu en mémoire par `CartContext`.
          Mesuré le 2026-09-08 : retirer ce lien fait échouer `cart-multi-establishment.spec.ts`,
          dont le commentaire dit déjà « un page.goto() direct réinitialiserait le panier ».
          Deux corrections de fond existent, aucune ne relève de ce lot : brancher un
          `RouterProvider` react-aria (absent de la version installée), ou rendre le panier
          persistant — ce que le cahier §2b.6 décide depuis le 2026-09-07 et que le backlog porte
          déjà. Ce lien disparaîtra avec la seconde. */}
      <BackLink href={hrefRetorno} label={t("backToCatalog")} testId="volver-al-catalogo" />

      <Card>
        <Card.Header>
          {/* Le titre VISIBLE de la page. `Title as="h1"` et non `Card.Title`, qui rend un h3. */}
          <Title as="h1" testId="product-name">
            {ficha.nombre}
          </Title>
          {ficha.descripcion ? <Card.Description>{ficha.descripcion}</Card.Description> : null}
        </Card.Header>

        <Card.Content className="flex flex-col gap-6">
          {/* `PhotoStrip` et non un emballage local : `ProductPhotos` faisait exactement la même
              chose (le même `Carousel`, la même variante `gallery`) en codant son conteneur et son
              `next/image` à la main. Le README l'interdit et cite ce cas précis. La molécule gère
              en plus le cas ZÉRO photo — l'aplat gris, au bon ratio, plutôt qu'un trou. */}
          <PhotoStrip
            photos={ficha.fotos.map((foto, index) => ({
              id: `${ficha.slug}-${index}`,
              // Le `alt` est composé ICI, jamais dans la couche de données : il se traduit.
              alt: t("fotoAlt", { nombre: ficha.nombre, indice: index + 1, total: ficha.fotos.length }),
              url: foto.url,
            }))}
            loading="priority"
            sizes="(min-width: 768px) 768px, 100vw"
            testId="product-photos"
          />

          {/* Aucun prix connu → AUCUNE ligne. Jamais « 0 COP », qui prétendrait la gratuité d'une
              offre dont le prix se négocie. Un evento gratuit (is_free) EST l'exception délibérée :
              ficha.precio vaut alors null (contrainte DB price_cop null quand is_free), donc sans ce
              badge RIEN ne s'afficherait — un evento réellement gratuit se distingue justement d'un
              prix simplement inconnu par ce statut indépendant, jamais par un prix à 0. */}
          {ficha.eventoReservable?.isFree ? (
            <p className="text-lg font-medium" data-testid="evento-free-badge">
              {t("free")}
            </p>
          ) : ficha.precio ? (
            <p className="text-lg font-medium" data-testid="product-price">
              {ficha.precio.tipo === "texto" ? (
                ficha.precio.label
              ) : (
                <Price amountCop={ficha.precio.cop} locale={locale} />
              )}
              {/* Aucun suffixe sur une vitrine ni sur un evento : leur prix est un libellé libre,
                  pas un tarif à l'unité. */}
              {/* ⚠️ `vitrina` RETIRÉ de cette exclusion le 2026-09-17. Depuis que tout transport
                  est en mode vitrine (son contact est garanti, cf. `lib/catalog/producto.ts`),
                  l'exclure faisait perdre « por persona » / « por trayecto » sur CHAQUE transport —
                  or c'est exactement ce que le texte legacy qu'on remplace insistait à dire (« El
                  precio es por pasajero, ida y vuelta », « por trayecto (solo ida) y por
                  vehículo »). Un suffixe d'unité accompagne un prix CHIFFRÉ ; il n'a jamais rien
                  eu à voir avec la façon de réserver. `evento` reste exclu : son prix est un
                  libellé libre (`price_label`), auquel « por persona » ne s'applique pas. */}
              {ficha.modoReserva !== "evento" && sufijoUnidad ? (
                <span className="ml-1 text-sm font-normal text-muted">{sufijoUnidad}</span>
              ) : null}
            </p>
          ) : null}

          {/* Payable sur place (evento réservable) : le solde entier se règle à l'établissement,
              jamais en ligne — même modèle que le solde du système d'acompte 17/10/7 existant,
              appliqué ici à la totalité du prix plutôt qu'à son reliquat. */}
          {ficha.eventoReservable?.paymentMode === "on_site" ? (
            <p className="text-xs text-muted" data-testid="evento-pay-on-site-note">
              {t("payOnSiteNote")}
            </p>
          ) : null}

          {/* Chaque moitié est FACULTATIVE et rendue séparément : un produit peut porter l'une sans
              l'autre, et la plupart n'ont ni l'une ni l'autre — la ligne entière disparaît alors,
              plutôt que d'afficher un séparateur orphelin. `unitCount` est libellé « en total » et
              jamais « disponibles » : c'est le parc du type, pas ce qui reste libre cette nuit. */}
          {faits.length > 0 ? (
            <p className="text-sm text-muted" data-testid="product-lodging-facts">
              {faits.join(" · ")}
            </p>
          ) : null}

          {/* Équipements structurés (migration 20260917110000, décision Jérôme du 2026-09-17) —
              référentiel fermé, résolu dans la locale par la couche de données. Section entière
              absente si `amenidades` est vide, même discipline que `faits` juste au-dessus. */}
          {alojamiento && alojamiento.amenidades.length > 0 ? (
            <section className="flex flex-col gap-3" data-testid="product-amenities">
              <Title as="h2">{tCommon("amenitiesTitle")}</Title>
              <AmenidadesList grupos={alojamiento.amenidades} testId="product-amenities-list" />
            </section>
          ) : null}

          {/* ⚠️ L'OCCURRENCE EST INDÉPENDANTE DU MODE DE RÉSERVATION. Elle était rendue dans la
              seule branche `evento`, comme si la date d'un événement dépendait de la façon dont on
              le réserve. C'est une propriété du TYPE : elle s'affiche pour tout evento. */}
          {etiquetas.ocurrencia ? (
            <p data-testid="evento-occurrence" className="text-sm text-muted">
              {etiquetas.ocurrencia}
            </p>
          ) : null}

          {/* ⚠️ Même discipline que `faits` juste au-dessus : chaque ligne est FACULTATIVE et rendue
              séparément, et le bloc entier disparaît si le transport ne porte rien — plutôt qu'un
              séparateur orphelin. Placé AVANT le formulaire de réservation, parce que « à quelle
              heure, d'où, vers où » se lit avant de choisir une date, pas après.
              Rien à voir avec `establishment-address` plus bas : celle-là est l'adresse du VENDEUR. */}
          {transporte && (lineaHorario || lineaRuta) ? (
            <div className="flex flex-col items-start gap-1" data-testid="transport-info">
              {lineaHorario ? (
                <p className="text-sm text-muted" data-testid="transport-schedule">
                  {lineaHorario}
                </p>
              ) : null}
              {lineaRuta ? (
                <p className="text-sm text-muted" data-testid="transport-route">
                  {lineaRuta}
                </p>
              ) : null}
              {enlaceMapa ? (
                // Marge négative pour aligner le TEXTE du bouton sur celui des deux paragraphes
                // au-dessus : un bouton `ghost` garde son padding horizontal (12px), qui décalait
                // sinon son libellé vers la droite — mesuré sur le rendu réel aux deux largeurs.
                // Alignement optique ; `LinkButton` n'accepte pas de `className`, délibérément.
                <div className="-ml-3">
                  <LinkButton
                    href={enlaceMapa}
                    external
                    newTabLabel={t("transportMapsNewTab")}
                    variant="ghost"
                    color="neutral"
                    size="sm"
                    testId="transport-maps-link"
                  >
                    {t("transportMapsLink")}
                  </LinkButton>
                </div>
              ) : null}
            </div>
          ) : null}

          {ficha.modoReserva === "evento_bookable" && ficha.eventoReservable ? (
            <EventoReservationForm
              productId={ficha.id}
              minQty={ficha.minQty}
              maxQty={ficha.eventoReservable.maxQty}
              capacityMode={ficha.eventoReservable.capacityMode}
              occurrences={ficha.eventoReservable.occurrences}
            />
          ) : ficha.modoReserva === "vitrina" || ficha.modoReserva === "evento" ? (
            // La vitrine : le calendrier laisse SA PLACE au bouton de contact, sans bandeau ni
            // texte explicatif (cahier §2e). ⚠️ Un evento SANS url n'affiche donc rien ici — un
            // cul-de-sac, inchangé depuis toujours et désormais nommé (spec 30 §10.5).
            ficha.urlExterna ? (
              <BotonContacto
                href={ficha.urlExterna}
                etiqueta={t("reserveExternal")}
                testId="vitrina-contact-link"
              />
            ) : null
          ) : ficha.modoReserva === "lodging" && alojamiento && !alojamiento.reservableEnLinea ? (
            // Logement PMS à connecteur coupé : `create_order` le refuserait (`pms_unavailable`) et
            // sa disponibilité ne peut pas être demandée. Aucun calendrier : la fiche le dit et
            // renvoie vers l'établissement, dont la page porte le contact.
            <section
              className="flex flex-col gap-2 rounded-lg border border-default-200 p-4"
              data-testid="pms-no-reservable"
            >
              <Title as="h2">{t("pmsNoReservableTitle")}</Title>
              <p className="text-sm text-muted">{t("pmsNoReservableText")}</p>
              {ficha.establecimiento?.slug ? (
                <Link href={`/establecimientos/${ficha.establecimiento.slug}`} className="text-sm underline">
                  {t("pmsNoReservableContact", { establecimiento: ficha.establecimiento.nombre })}
                </Link>
              ) : null}
            </section>
          ) : ficha.modoReserva === "lodging" && alojamiento ? (
            <LodgingReservationForm
              productId={ficha.id}
              priceCop={ficha.precio?.tipo === "monto" ? ficha.precio.cop : 0}
              priceTiers={alojamiento.priceTiers as never}
              maxQty={alojamiento.maxQty}
              lodgingKind={alojamiento.lodgingKind as never}
              isPmsBacked={alojamiento.esPmsBacked}
              availability={ficha.disponibilidad}
              restrictedNights={ficha.restriccionesPms}
              rates={ficha.tarifas}
            />
          ) : ficha.modoReserva === "slot" ? (
            <SlotReservationForm
              productId={ficha.id}
              slots={ficha.franjas}
              minQty={ficha.minQty}
              maxQty={ficha.maxQty}
            />
          ) : (
            <ReservationForm
              productId={ficha.id}
              availability={ficha.disponibilidad}
              durationDays={ficha.duracionDias ?? undefined}
              minQty={ficha.minQty}
              maxQty={ficha.maxQty}
              groupDiscount={ficha.descuentoGrupo ?? undefined}
              precio={ficha.precio}
              unidad={ficha.unidad}
              locale={locale}
              onSalidaChange={setSalidaIso}
            />
          )}

          {/* ⚠️ HORS de la branche `modoReserva` ci-dessus, délibérément : la leçon est écrite en
              majuscules plus haut dans ce fichier à propos de l'occurrence d'un evento (« L'OCCURRENCE
              EST INDÉPENDANTE DU MODE DE RÉSERVATION »). Un camp servi en vitrine
              (external_booking_url) ou non réservable en ligne garde son programme : le déroulé des
              journées ne dépend pas de la façon dont on réserve. */}
          {ficha.programa ? (
            <ProgramaCamp
              programa={ficha.programa}
              salidaIso={salidaIso}
              locale={locale}
              titulo={t("programTitle")}
              etiquetaDia={(dia) => t("programDay", { dia })}
              etiquetaDiaConFecha={(dia, fecha) => t("programDayWithDate", { dia, fecha })}
            />
          ) : null}

          <p className="text-xs text-muted">{tCommon("cancellationPolicy")}</p>
        </Card.Content>
      </Card>

      {ficha.establecimiento ? (
        <Card data-testid="establishment-info">
          <Card.Header>
            <Card.Title data-testid="establishment-name">
              {ficha.establecimiento.slug ? (
                <Link
                  href={`/establecimientos/${ficha.establecimiento.slug}`}
                  className="hover:underline"
                >
                  {ficha.establecimiento.nombre}
                </Link>
              ) : (
                ficha.establecimiento.nombre
              )}
            </Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-4">
            <PhotoStrip
              photos={ficha.establecimiento.fotos.map((foto, index) => ({
                id: `est-${ficha.establecimiento?.slug ?? ficha.slug}-${index}`,
                alt: t("fotoAlt", {
                  nombre: ficha.establecimiento?.nombre ?? "",
                  indice: index + 1,
                  total: ficha.establecimiento?.fotos.length ?? 0,
                }),
                url: foto.url,
              }))}
              loading="lazy"
              sizes="(min-width: 768px) 768px, 100vw"
              testId="establishment-photos"
            />
            {ficha.establecimiento.descripcion ? (
              <p className="text-sm text-muted">{ficha.establecimiento.descripcion}</p>
            ) : null}
            {ficha.establecimiento.direccion ? (
              <p className="text-sm text-muted" data-testid="establishment-address">
                {ficha.establecimiento.direccion}
              </p>
            ) : null}
          </Card.Content>
        </Card>
      ) : null}
    </>
  );
}
