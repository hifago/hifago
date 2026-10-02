"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/atoms/Card";
import { Price } from "@/components/atoms/Price";
import { PhotoStrip } from "@/components/molecules/PhotoStrip";
import type { Locale } from "@/messages";
import type { TarjetaOferta as OfertaTarjeta } from "@/lib/catalog/tipos";

// La carte d'une offre dans l'accueil-résultats (2026-09-08, lot D — spec 28 §5, Tranche 1).
//
// Elle n'invente rien : elle CÂBLE trois briques déjà construites — `Card` (2026-09-02),
// `PhotoStrip` (2026-09-04) et `Price` (2026-09-01) — sur une ligne de `search_catalog` telle que
// `lib/catalog/buscar.ts` la sert. Son existence tient à trois décisions qu'il fallait bien poser
// QUELQUE PART, et qui ne peuvent tenir ni dans un atome ni dans la couche de données :
//
//   1. ⚠️ LE TEXTE ALTERNATIF EST CALCULÉ ICI (spec 28 §6, corrigé à l'implémentation le
//      2026-09-07). `product_media` ne porte aucune colonne de texte alternatif — il est donc
//      calculé, « <nom de l'offre>, foto <i> de <n> ». Mais c'est du texte d'INTERFACE : le mettre
//      dans `lib/catalog/` y ferait entrer next-intl et rendrait la couche de données intestable
//      sans contexte i18n. La carte reçoit déjà `nombre` et connaît le rang de chaque photo — elle
//      a tout ce qu'il faut. C'est la raison pour laquelle cette molécule appelle `useTranslations`
//      là où un atome ne traduirait rien (components/README.md, « Traductions »).
//
//   2. LE PRIX A QUATRE FORMES, et une seule est un montant. `PrecioTarjeta` distingue `monto`,
//      `desde`, `texto` et `null` (spec 28 §0). ⚠️ `texto` n'est JAMAIS formaté en COP : un evento
//      porte un `price_label` en texte libre (règle métier du cahier admin §3c, déjà écrite dans
//      l'en-tête de l'atome `Price`, qui refuse explicitement de connaître ce cas). Et `null` ne
//      rend AUCUN bloc — jamais « desde 0 », jamais un conteneur vide qui laisserait un écart sous
//      le titre.
//
//   3. `sizes` DÉPEND DE LA VARIANTE, et personne d'autre ne peut le savoir. `PhotoStrip` exige
//      `sizes` et `loading` par le type, précisément parce qu'une bande ne connaît pas la largeur
//      du conteneur qui l'accueille. Ici on la connaît : la grille de `SeccionOfertas` (1 colonne,
//      2 dès `md`, 3 dès `lg`) pour `grilla`, la vignette de 64 px de `Card layout="row"` pour
//      `lista`. `prioridad` suit la même logique d'un cran plus haut : UNE seule carte de la page
//      la reçoit, la première de la première section — c'est elle le LCP (spec 28 §0, invariant 6).
//
// `"use client"` obligatoire : ce fichier appelle `useTranslations` et rend `Card` et `PhotoStrip`,
// qui importent le barrel `@hifago/ui` — dont le graphe casse `next build` dès qu'il atteint un
// Server Component (CLAUDE.md §11.16).
//
// ⚠️ CE QU'ELLE NE RÉSOUT PAS, et c'est volontaire : en variante `lista`, le visuel de `Card` fait
// 64 px — dimensionné pour la ligne produit d'une fiche établissement, trop petit pour un
// carrousel. C'est le point ouvert de la spec 28 §10 (agrandir le visuel de la variante `row`,
// renoncer au carrousel sur cette variante, ou faire de la carte d'activité une molécule à part),
// une décision VISUELLE qui modifie un atome partagé — donc un lot à part, après arbitrage.
// La carte est rendue telle quelle en attendant.

export type TarjetaOfertaProps = {
  oferta: OfertaTarjeta;
  /**
   * "grilla" = carte empilée (photos à fleur de carte) ; "lista" = Card layout="row" ; "carrusel" =
   * même carte qu'en "grilla", mais à largeur fixe dans une ligne qui défile horizontalement
   * (`SeccionOfertas.tsx`).
   */
  variante: "grilla" | "lista" | "carrusel";
  /** UNE SEULE carte de la page la reçoit : la première de la première section (le LCP). */
  prioridad?: boolean;
  locale: Locale;
};

// Chaînes littérales complètes, jamais construites : Tailwind ne les compile pas, mais `sizes` est
// lu par le navigateur et une valeur fausse sert l'image la plus grande à un téléphone.
//
// `SIZES_GRILLA` est repris tel quel de la spec 28 §5 (« `sizes` suit la grille ») et correspond
// aux points de rupture de `SeccionOfertas`. `SIZES_LISTA` est la largeur EXACTE de la vignette de
// `Card layout="row"` (`w-16`), donc 64 px — voir la réserve de l'en-tête : si le visuel de la
// variante `row` est agrandi par le lot d'arbitrage, cette valeur doit bouger avec lui.
const SIZES_GRILLA = "(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw";
const SIZES_LISTA = "64px";
// ⚠️ Doit rester synchronisé avec `CLASE_CARTA_CARRUSEL` de `SeccionOfertas.tsx`, qui a cessé
// d'être une largeur fixe le 2026-10-01 : depuis la refonte sur la référence de Jérôme, une rangée
// montre EXACTEMENT trois cartes à partir de `md` (un tiers du conteneur) et une carte presque
// pleine en dessous. La valeur suit donc le viewport, comme la grille — mais à ses propres
// proportions, parce que le conteneur bleu poudre est en retrait des bords de l'écran.
const SIZES_CARRUSEL = "(min-width: 768px) 32vw, 82vw";

// Une table plutôt qu'une cascade de ternaires : c'est ce qui fait qu'ajouter une variante casse la
// COMPILATION ici (le Record doit être exhaustif) au lieu de retomber silencieusement sur la
// branche `grilla` par défaut.
const SIZES_POR_VARIANTE: Record<TarjetaOfertaProps["variante"], string> = {
  grilla: SIZES_GRILLA,
  lista: SIZES_LISTA,
  carrusel: SIZES_CARRUSEL,
};

// Le RATIO de la photo, même raisonnement que `sizes` juste au-dessus : la carte est seule à savoir
// quelle forme le conteneur attend d'elle. `1/1` en carrusel — les cartes carrées de la référence
// fournie par Jérôme le 2026-10-01 ; `4/3` (le défaut de l'atome `Image`) partout ailleurs, donc
// grille et liste sont inchangées. Record exhaustif pour la même raison : ajouter une variante doit
// casser la compilation ici, pas retomber en silence sur une forme qui ne lui va pas.
const RATIO_POR_VARIANTE: Record<TarjetaOfertaProps["variante"], "4/3" | "1/1"> = {
  grilla: "4/3",
  lista: "4/3",
  carrusel: "1/1",
};

// Même raison que les deux tables ci-dessus : exhaustive, pour qu'une variante ajoutée casse la
// compilation ici plutôt que de retomber en silence sur la carte empilée.
const LAYOUT_POR_VARIANTE: Record<TarjetaOfertaProps["variante"], "stack" | "row" | "overlay"> = {
  grilla: "stack",
  lista: "row",
  carrusel: "overlay",
};

export function TarjetaOferta({ oferta, variante, prioridad, locale }: TarjetaOfertaProps) {
  const t = useTranslations("HomePage");

  // `id` = le rang, et non l'URL : `search_catalog` peut servir deux fois la même photo (une carte
  // groupée reprend les médias du premier couchage), et le `Carousel` a besoin de clés distinctes.
  const fotos = oferta.fotos.map((foto, indice) => ({
    id: String(indice),
    url: foto.url,
    alt: t("fotoAlt", {
      nombre: oferta.nombre,
      indice: indice + 1,
      total: oferta.fotos.length,
    }),
  }));

  // Suite d'`if` plutôt qu'une chaîne de ternaires : les quatre formes du prix sont une règle
  // métier, elles se lisent mieux à plat. `undefined` (et non `null`) parce que c'est ce que `Card`
  // teste pour ne PAS ouvrir de `Card.Content` — un bloc vide laisserait un écart sous le titre.
  const { precio } = oferta;
  let contenido: ReactNode = undefined;

  if (precio?.tipo === "monto") {
    contenido = (
      <Price amountCop={precio.cop} locale={locale} testId={`${oferta.testId}-precio`} />
    );
  } else if (precio?.tipo === "desde") {
    // Le libellé et le montant dans UN SEUL élément : c'est le prix complet, pas deux informations
    // voisines — un lecteur d'écran doit lire « Desde 180.000 COP » d'une traite.
    contenido = (
      <span className="font-medium" data-testid={`${oferta.testId}-precio`}>
        {t("precioDesde")} <Price amountCop={precio.cop} locale={locale} />
      </span>
    );
  } else if (precio?.tipo === "texto") {
    // ⚠️ Le label tel quel, JAMAIS `formatCop` : c'est un texte libre saisi par le partenaire
    // (« Entrada libre », « Consultar »), pas un nombre. Le passer à `Price` rendrait « 0 COP ».
    contenido = (
      <span className="font-medium" data-testid={`${oferta.testId}-precio`}>
        {precio.label}
      </span>
    );
  }

  // La CAPACITÉ, sur les seules cartes qui la portent — les chambres d'une fiche établissement
  // (« photo · nom · capacité · prix », entretien du 2026-09-07). `search_catalog` ne la rend pas,
  // donc elle est `null` sur l'accueil et les listings et la ligne n'y apparaît jamais.
  //
  // Sous le prix et non à sa place : les deux se lisent ensemble pour choisir une chambre.
  const contenidoCompleto =
    oferta.capacidad !== null ? (
      <span className="flex flex-col gap-0.5">
        {contenido}
        <span className="text-sm font-normal text-muted" data-testid={`${oferta.testId}-capacidad`}>
          {t("capacidadPersonas", { count: oferta.capacidad })}
        </span>
      </span>
    ) : (
      // ⚠️ Une offre "vitrina" pure (external_booking_url sans price_cop ni price_label, ex. un
      // cours réservé par WhatsApp) laisse `contenido` à `undefined` — `Card` n'ouvre alors AUCUN
      // `Card.Content`, et sa carte devient plus basse qu'une carte voisine qui affiche un prix,
      // dans la même ligne de grille. Un placeholder invisible réserve la même hauteur qu'une
      // ligne de prix réelle, sans rien annoncer à l'assistance.
      // En `carrusel` la carte est CARRÉE (`layout="overlay"`) : sa hauteur ne dépend plus de son
      // texte, et ce placeholder y peindrait une pastille de prix vide sur la photo.
      (contenido ?? (variante === "carrusel" ? undefined : (
        <span className="invisible" aria-hidden="true">
          &nbsp;
        </span>
      )))
    );

  return (
    <Card
      href={oferta.href}
      title={oferta.nombre}
      titleAs="h3"
      // ⚠️ LE DÉCOMPTE PREND LA PLACE DU SOUS-TITRE, et les deux ne peuvent pas se disputer : une
      // carte GROUPÉE représente l'établissement lui-même, donc `search_catalog` lui pose
      // `establecimiento = null` (branche `es_establecimiento`), et c'est la seule qui porte
      // `nAlojamientos`. Toute autre carte a l'inverse. Mutuellement exclusifs par construction,
      // pas par convention.
      //
      // Le rendu reproduit littéralement ce que le front d'août affichait — « Casa Kayam ·
      // 6 alojamientos » (journal du 2026-08-15) — que la refonte avait perdu : sans lui, une
      // carte unique qui représente six chambres ne dit pas qu'elle en représente six.
      subtitle={
        oferta.establecimiento ??
        (oferta.nAlojamientos !== null
          ? t("conteoAlojamientos", { count: oferta.nAlojamientos })
          : undefined)
      }
      // `overlay` en carrusel : la carte carrée de la référence de Jérôme (2026-10-01) — la photo
      // remplit la carte, nom et établissement dans un cartouche par-dessus, prix en pastille.
      layout={LAYOUT_POR_VARIANTE[variante]}
      titleSize={variante === "carrusel" ? "md" : undefined}
      testId={oferta.testId}
      media={
        // Rendue même sans photo : `PhotoStrip` pose alors le substitut de l'atome `Image`, au même
        // ratio — la carte garde sa forme au lieu de se tasser (spec 28 §0, « Offre sans photo »).
        <PhotoStrip
          photos={fotos}
          loading={prioridad ? "priority" : "lazy"}
          sizes={SIZES_POR_VARIANTE[variante]}
          ratio={RATIO_POR_VARIANTE[variante]}
          testId={`${oferta.testId}-fotos`}
        />
      }
    >
      {contenidoCompleto}
    </Card>
  );
}
