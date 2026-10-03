"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Price } from "@/components/atoms/Price";
import { Title } from "@/components/atoms/Title";
import { BackLink } from "@/components/atoms/BackLink";
import { EnlaceGo } from "@/components/atoms/EnlaceGo";
import { Image } from "@/components/atoms/Image";
import { PuceEstado } from "@/components/atoms/PuceEstado";
import { PhotoStrip } from "@/components/molecules/PhotoStrip";
import { AmenidadesList } from "@/components/molecules/AmenidadesList";
import { Aviso } from "@/components/molecules/Aviso";
import { BandeauPagina } from "@/components/organisms/BandeauPagina";
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
import { BarraReservaMovil } from "./BarraReservaMovil";

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
// ⚠️ ET IL PORTE LE `<h1>`, dans le bandeau or (`BandeauPagina`, plan 41, P3). `Card.Title` de
// HeroUI rend un `<h3>` : jusqu'à la spec 30, la fiche n'avait AUCUN titre de niveau 1. Le bandeau
// est rendu ICI et non par `page.tsx`, alors que le plan le permettait : le lien retour qu'il porte
// dépend d'un état client (`usePrefillUltimosCriterios`), et les puces du bandeau (couchage,
// capacité, horaires) sont calculées et traduites dans ce fichier. Le fil d'Ariane, lui, arrive
// déjà rendu par la page, qui en tire aussi le JSON-LD.
//
// PLAN 41, P3 (arbitrage D10 = A) — la mise en page :
//   - bandeau or à fond perdu : fil, retour, H1 sans point, « Ofrecido por » · adresse, puces ;
//   - à partir de `lg`, deux colonnes : la lecture à gauche, le PANNEAU DE RÉSERVATION collant à
//     droite (prix, formulaire, politique d'annulation) ;
//   - dessous, une colonne dans l'ordre galerie → prix → description → panneau → équipements →
//     programme → « Ofrecido por », plus une barre « prix · Reservar » collée en bas.
//   L'ordre mobile est obtenu SANS dupliquer le moindre nœud : les deux colonnes sont des
//   `display: contents` sous `lg`, et leurs enfants deviennent les éléments d'une seule colonne
//   flex, rangés par `order-*`. Un formulaire rendu deux fois aurait deux états à réconcilier, et
//   des `data-testid` en double.
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

/** La cible de la barre mobile : le panneau de réservation (défilement et observation). */
const ID_PANEL = "reservar";

export function FichaProducto({
  ficha,
  etiquetas,
  locale,
  migas,
}: {
  ficha: DatosFicha;
  etiquetas: EtiquetasFicha;
  locale: Locale;
  /** Le fil d'Ariane, déjà rendu par la page (qui en tire le JSON-LD). */
  migas?: ReactNode;
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
  ].filter((fait): fait is string => Boolean(fait));

  // TRANSPORT — la fenêtre de départs, les places annoncées et le trajet. Tout est INFORMATIF : ces
  // lignes ne changent rien au formulaire de réservation rendu plus bas (un transport reste réservé
  // par DATE), elles répondent juste à « à quelle heure, d'où, vers où » avant que le visiteur
  // choisisse sa date. Demande Jérôme du 2026-09-16.
  const transporte = ficha.transporte;
  // DEUX clés distinctes, jamais une clé construite dynamiquement : `t()` ne vérifierait plus
  // l'existence de la clé (même raison que `etiquetaCouchage` ci-dessus). `primeraSalida ===
  // ultimaSalida` est le cas NORMAL d'un transfert à heure fixe, pas un cas dégradé — d'où le `>=`
  // du CHECK en base. Une PUCE par partie dans le bandeau (plan 41, P3).
  const partesHorario = transporte
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
      ].filter((parte): parte is string => Boolean(parte))
    : [];
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

  const pmsNoReservable = ficha.modoReserva === "lodging" && alojamiento !== null && !alojamiento.reservableEnLinea;

  // LE FORMULAIRE, selon le mode de réservation — logique inchangée, seulement nommée pour être
  // posée dans le panneau. `null` = rien à réserver ici (un evento sans lien, cul-de-sac nommé par
  // la spec 30 §10.5) : ni panneau d'action, ni barre mobile.
  const accionReserva: ReactNode =
    ficha.modoReserva === "evento_bookable" && ficha.eventoReservable ? (
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
        <BotonContacto href={ficha.urlExterna} etiqueta={t("reserveExternal")} testId="vitrina-contact-link" />
      ) : null
    ) : pmsNoReservable ? (
      // Logement PMS à connecteur coupé : `create_order` le refuserait (`pms_unavailable`) et
      // sa disponibilité ne peut pas être demandée. Aucun calendrier : la fiche le dit et
      // renvoie vers l'établissement, dont la page porte le contact. Sans bordure : à partir de
      // `lg` le panneau est déjà la carte, une seconde l'emboîterait.
      <section className="flex flex-col gap-2" data-testid="pms-no-reservable">
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
    );

  // Aucun suffixe sur un evento : son prix est un libellé libre (`price_label`), auquel « por
  // persona » ne s'applique pas.
  // ⚠️ `vitrina` RETIRÉ de cette exclusion le 2026-09-17. Depuis que tout transport est en mode
  // vitrine (son contact est garanti, cf. `lib/catalog/producto.ts`), l'exclure faisait perdre « por
  // persona » / « por trayecto » sur CHAQUE transport — or c'est exactement ce que le texte legacy
  // qu'on remplace insistait à dire (« El precio es por pasajero, ida y vuelta »). Un suffixe d'unité
  // accompagne un prix CHIFFRÉ ; il n'a jamais rien eu à voir avec la façon de réserver.
  const sufijoVisible = ficha.modoReserva !== "evento" ? sufijoUnidad : null;
  const montoPrecio = ficha.precio ? (
    ficha.precio.tipo === "texto" ? ficha.precio.label : <Price amountCop={ficha.precio.cop} locale={locale} />
  ) : null;

  // Aucun prix connu → AUCUN bloc. Jamais « 0 COP », qui prétendrait la gratuité d'une offre dont le
  // prix se négocie. Un evento gratuit (is_free) EST l'exception délibérée : ficha.precio vaut alors
  // null (contrainte DB price_cop null quand is_free), donc sans cette puce RIEN ne s'afficherait —
  // un evento réellement gratuit se distingue d'un prix simplement inconnu par ce statut
  // indépendant, jamais par un prix à 0. Puce « exito » : le ton fixé par S7 pour « Gratis ».
  const esGratis = ficha.eventoReservable?.isFree === true;
  const precio = esGratis ? (
    <PuceEstado tono="exito" testId="evento-free-badge">
      {t("free")}
    </PuceEstado>
  ) : montoPrecio ? (
    <p data-testid="product-price">
      <span className="prix-fort">{montoPrecio}</span>
      {sufijoVisible ? <span className="ml-1.5 text-sm font-medium text-muted">{sufijoVisible}</span> : null}
    </p>
  ) : null;

  // Payable sur place (evento réservable) : le solde entier se règle à l'établissement, jamais en
  // ligne — même modèle que le solde du système d'acompte 17/10/7, appliqué à la totalité du prix.
  const notaPagoEnSitio =
    ficha.eventoReservable?.paymentMode === "on_site" ? (
      <p className="text-sm text-muted" data-testid="evento-pay-on-site-note">
        {t("payOnSiteNote")}
      </p>
    ) : null;

  const politica = (
    <Aviso tono="info" compacto testId="politica-cancelacion">
      {tCommon("cancellationPolicy")}
    </Aviso>
  );

  const conPanel = precio !== null || accionReserva !== null;
  // Pas de barre « Reservar » vers un panneau qui dit justement qu'on ne réserve pas en ligne.
  const conBarra = accionReserva !== null && !pmsNoReservable;

  // LE BANDEAU, sous le H1 : « Ofrecido por » · adresse, puis une puce par fait disponible.
  // ⚠️ Chaque groupe garde le `data-testid` de la ligne qu'il remplace, en `display: contents` pour
  // que ses puces s'alignent avec les autres dans la même rangée : les tests et les e2e lisent
  // `product-lodging-facts`, `evento-occurrence`, `transport-schedule`. Chaque puce est FACULTATIVE,
  // et la rangée entière disparaît quand il n'y a rien — plus de séparateur orphelin possible.
  // `multilinea` : une occurrence (« Los martes, cada 7 días, hasta el… ») ne tient pas à 360 px, et
  // une ellipse en cacherait la fin.
  const establecimiento = ficha.establecimiento;
  const ofrecidoPor = establecimiento ? (
    <p className="basis-full text-sm font-medium" data-testid="product-ofrecido-por">
      {t.rich("ofrecidoPor", {
        nombre: establecimiento.nombre,
        enlace: (chunks) =>
          establecimiento.slug ? (
            <Link
              href={`/establecimientos/${establecimiento.slug}`}
              className="text-link underline underline-offset-4 hover:decoration-2"
            >
              {chunks}
            </Link>
          ) : (
            chunks
          ),
      })}
      {establecimiento.direccion ? (
        <>
          <span aria-hidden="true"> · </span>
          {establecimiento.direccion}
        </>
      ) : null}
    </p>
  ) : null;
  const puces = [
    faits.length > 0 ? (
      <span key="faits" className="contents" data-testid="product-lodging-facts">
        {faits.map((fait) => (
          <PuceEstado key={fait} tono="neutro" multilinea>
            {fait}
          </PuceEstado>
        ))}
      </span>
    ) : null,
    // ⚠️ L'OCCURRENCE EST INDÉPENDANTE DU MODE DE RÉSERVATION : c'est une propriété du TYPE, elle
    // s'affiche pour tout evento.
    etiquetas.ocurrencia ? (
      <PuceEstado key="ocurrencia" tono="neutro" multilinea testId="evento-occurrence">
        {etiquetas.ocurrencia}
      </PuceEstado>
    ) : null,
    partesHorario.length > 0 ? (
      <span key="horario" className="contents" data-testid="transport-schedule">
        {partesHorario.map((parte) => (
          <PuceEstado key={parte} tono="neutro" multilinea>
            {parte}
          </PuceEstado>
        ))}
      </span>
    ) : null,
  ].filter(Boolean);
  const meta =
    ofrecidoPor || puces.length > 0 ? (
      <>
        {ofrecidoPor}
        {puces}
      </>
    ) : undefined;

  return (
    <>
      <BandeauPagina
        variante="contenido"
        migas={migas}
        volver={
          // ⚠️ CE LIEN N'EST PAS UN DOUBLON DU FIL D'ARIANE, et il faut dire pourquoi avant que
          // quelqu'un le supprime en le prenant pour tel.
          // `Migas` rend des `<a href>` NATIFS : `Breadcrumbs.Item` de HeroUI étend le `Link` de
          // react-aria, pas le `Link` de `@/i18n/navigation` (c'est écrit dans le composant, et c'est
          // pour ça que le préfixe de langue y est posé à la main). Cliquer le fil provoque donc une
          // navigation COMPLÈTE — qui vide le panier, tenu en mémoire par `CartContext`.
          // Mesuré le 2026-09-08 : retirer ce lien fait échouer `cart-multi-establishment.spec.ts`,
          // dont le commentaire dit déjà « un page.goto() direct réinitialiserait le panier ».
          // Deux corrections de fond existent, aucune ne relève de ce lot : brancher un
          // `RouterProvider` react-aria (absent de la version installée), ou rendre le panier
          // persistant — ce que le cahier §2b.6 décide depuis le 2026-09-07 et que le backlog porte
          // déjà. Ce lien disparaîtra avec la seconde.
          <BackLink href={hrefRetorno} label={t("backToCatalog")} testId="volver-al-catalogo" />
        }
        // Un nom propre : pas de point (plan 41, P3).
        titulo={ficha.nombre}
        tituloTestId="product-name"
        conPunto={false}
        meta={meta}
        testId="ficha-bandeau"
      />

      {/* Le contenu clair, et la barre mobile dans la MÊME zone de grille (`row-start-1` pour les
          deux) : un élément collant ne sort jamais de son bloc conteneur, et celui d'un élément de
          grille est sa cellule. Rangée seule, la barre ne collerait à rien ; posée sur la zone du
          contenu (`self-end`), elle colle au bas de l'écran tant que le contenu défile, puis se pose
          à sa fin, au-dessus du pied de page. `pb-20` réserve sa hauteur sous le contenu : elle ne
          cache jamais la fin de la page (et les toasts sont en haut, C4). */}
      <div data-bleed="" className="col-span-full grid grid-cols-subgrid">
        <div
          className={["col-start-2 row-start-1 min-w-0 pt-2 sm:pt-4", conBarra ? "pb-20 lg:pb-0" : ""].join(
            " "
          )}
        >
          {/* Deux colonnes à partir de `lg` : la lecture, et le panneau à 360 px. Pas le tiers du
              plan (≈ 307 px) : 360 px moins 2 × 24 de padding laissent aux sept cases du calendrier
              leurs 44 px (S10 l'avait renvoyé ici), au lieu de 36. La lecture garde 560 px. */}
          <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:items-start lg:gap-x-10">
            <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-10">
              {/* `PhotoStrip` et non un emballage local : la molécule gère en plus le cas ZÉRO photo
                  — l'aplat, au bon ratio, plutôt qu'un trou. `sizes` : la colonne de lecture (560 px
                  à partir de `lg`), sinon la colonne de la page (gouttières de 20 puis 32 px). */}
              <div className="order-1">
                <PhotoStrip
                  photos={ficha.fotos.map((foto, index) => ({
                    id: `${ficha.slug}-${index}`,
                    // Le `alt` est composé ICI, jamais dans la couche de données : il se traduit.
                    alt: t("fotoAlt", { nombre: ficha.nombre, indice: index + 1, total: ficha.fotos.length }),
                    url: foto.url,
                  }))}
                  loading="priority"
                  sizes="(min-width: 1024px) 560px, (min-width: 640px) calc(100vw - 4rem), calc(100vw - 2.5rem)"
                  testId="product-photos"
                />
              </div>

              {ficha.descripcion ? (
                <p className="order-3 max-w-prose text-base leading-[1.55] lg:text-[17px]">{ficha.descripcion}</p>
              ) : null}

              {/* Le trajet et son lien, après la description : « d'où, vers où » se lit avant de
                  choisir une date. Les horaires sont montés dans le bandeau, en puces. Même
                  discipline que les faits : chaque ligne est FACULTATIVE, et le bloc entier
                  disparaît si le transport ne porte rien. Rien à voir avec `establishment-address`
                  plus bas : celle-là est l'adresse du VENDEUR. */}
              {transporte && (lineaRuta || enlaceMapa) ? (
                <div className="order-3 flex flex-col items-start gap-3" data-testid="transport-info">
                  {lineaRuta ? (
                    <p className="text-base" data-testid="transport-route">
                      {lineaRuta}
                    </p>
                  ) : null}
                  {enlaceMapa ? (
                    <LinkButton
                      href={enlaceMapa}
                      external
                      newTabLabel={t("transportMapsNewTab")}
                      color="neutral"
                      testId="transport-maps-link"
                    >
                      {t("transportMapsLink")}
                    </LinkButton>
                  ) : null}
                </div>
              ) : null}

              {/* Équipements structurés (migration 20260917110000, décision Jérôme du 2026-09-17) —
                  référentiel fermé, résolu dans la locale par la couche de données. Section entière
                  absente si `amenidades` est vide. */}
              {alojamiento && alojamiento.amenidades.length > 0 ? (
                <section className="order-5 flex flex-col gap-3" data-testid="product-amenities">
                  <Title as="h2" size="bloque">
                    {tCommon("amenitiesTitle")}
                  </Title>
                  <AmenidadesList grupos={alojamiento.amenidades} testId="product-amenities-list" />
                </section>
              ) : null}

              {/* ⚠️ HORS de la branche `modoReserva`, délibérément : un camp servi en vitrine
                  (external_booking_url) ou non réservable en ligne garde son programme — le déroulé
                  des journées ne dépend pas de la façon dont on réserve. */}
              {ficha.programa ? (
                <div className="order-6">
                  <ProgramaCamp
                    programa={ficha.programa}
                    salidaIso={salidaIso}
                    locale={locale}
                    titulo={t("programTitle")}
                    etiquetaDia={(dia) => t("programDay", { dia })}
                    etiquetaDiaConFecha={(dia, fecha) => t("programDayWithDate", { dia, fecha })}
                  />
                </div>
              ) : null}

              {/* « Ofrecido por » : une carte (la seule de la colonne, bordure marine de 1 px,
                  jamais imbriquée — F6). Photo ronde de 72 px, nom en `titre-bloc` (un `<h2>` : ce
                  bloc est le frère des équipements, sous le `<h1>`), description sur deux lignes —
                  la fiche établissement la donne en entier —, adresse, « GO → ». */}
              {establecimiento ? (
                <section
                  className="order-7 flex gap-4 rounded-[16px] border border-border bg-surface p-5 sm:p-6"
                  data-testid="establishment-info"
                >
                  {establecimiento.fotos[0] ? (
                    <div className="size-[72px] shrink-0 overflow-hidden rounded-full">
                      <Image
                        src={establecimiento.fotos[0].url}
                        alt=""
                        sizes="72px"
                        loading="lazy"
                        ratio="1/1"
                        testId="establishment-photo"
                      />
                    </div>
                  ) : null}
                  <div className="flex min-w-0 flex-col items-start gap-1.5">
                    <p className="etiquette text-muted">{t("ofrecidoPorTitulo")}</p>
                    <Title as="h2" size="bloque" testId="establishment-name">
                      {establecimiento.slug ? (
                        <Link href={`/establecimientos/${establecimiento.slug}`} className="hover:underline">
                          {establecimiento.nombre}
                        </Link>
                      ) : (
                        establecimiento.nombre
                      )}
                    </Title>
                    {establecimiento.descripcion ? (
                      <p className="line-clamp-2 text-sm text-muted">{establecimiento.descripcion}</p>
                    ) : null}
                    {establecimiento.direccion ? (
                      <p className="text-sm text-muted" data-testid="establishment-address">
                        {establecimiento.direccion}
                      </p>
                    ) : null}
                    {establecimiento.slug ? (
                      <EnlaceGo
                        href={`/establecimientos/${establecimiento.slug}`}
                        label={t("verEstablecimiento", { nombre: establecimiento.nombre })}
                        tamano="normal"
                        testId="establishment-go"
                      />
                    ) : null}
                  </div>
                </section>
              ) : null}

              {/* Sans panneau (rien à réserver ni à chiffrer), la politique reste lisible. */}
              {conPanel ? null : <div className="order-7">{politica}</div>}
            </div>

            {/* LE PANNEAU — carte blanche bordée de marine, collante sous le header (64 + 16 px) à
                partir de `lg`. Dessous, `display: contents` : le prix monte juste après la galerie
                (`order-2`), le formulaire vient après la description (`order-4`), sans carte autour
                — le calendrier y garde son propre cadre (S10), une seconde bordure l'emboîterait. */}
            {conPanel ? (
              <div className="contents lg:sticky lg:top-20 lg:flex lg:flex-col lg:gap-6 lg:rounded-[16px] lg:border lg:border-border lg:bg-surface lg:p-6">
                {precio || notaPagoEnSitio ? (
                  <div className="order-2 flex flex-col items-start gap-1">
                    {precio}
                    {notaPagoEnSitio}
                  </div>
                ) : null}
                {accionReserva ? (
                  // La cible de la barre mobile : `tabIndex={-1}` pour y poser le focus, `scroll-mt`
                  // pour ne pas finir sous le header collant.
                  <div id={ID_PANEL} tabIndex={-1} className="order-4 flex scroll-mt-20 flex-col gap-6 outline-none">
                    {accionReserva}
                    {politica}
                  </div>
                ) : (
                  <div className="order-4">{politica}</div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {conBarra ? (
          <BarraReservaMovil
            objetivoId={ID_PANEL}
            precio={
              esGratis ? (
                <span className="text-lg font-bold">{t("free")}</span>
              ) : montoPrecio ? (
                <p className="leading-tight">
                  <span className="text-lg font-bold tabular-nums">{montoPrecio}</span>
                  {sufijoVisible ? <span className="ml-1 text-sm text-muted">{sufijoVisible}</span> : null}
                </p>
              ) : null
            }
            etiqueta={t("barraReservar")}
            testId="barra-reserva"
          />
        ) : null}
      </div>
    </>
  );
}
