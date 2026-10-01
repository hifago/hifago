// Guatapé est à UTC−5 toute l'année (la Colombie n'a pas d'heure d'été), cf.
// packages/domain/src/time/bogotaDates.ts. L'offset est écrit en clair et JAMAIS calculé : on
// concatène ici deux chaînes déjà civiles (une date `yyyy-MM-dd` et une heure `HH:mm:ss` venues
// telles quelles de Postgres). Aucun objet Date n'est construit, donc aucune conversion de fuseau
// ne peut dériver — c'est précisément le mode de défaillance du lot du 2026-08-28.
const BOGOTA_UTC_OFFSET = "-05:00";

export type ProductJsonLdInput = {
  siteUrl: string;
  locale: string;
  slug: string;
  name: string;
  description?: string | null;
  imageUrls?: string[];
  /** `products.type` : lodging | activity | transport | camp | evento. */
  productType: string;
  /** `products.price_cop`. Nul uniquement pour un evento (contrainte SQL). */
  priceCop?: number | null;
  occurrenceDate?: string | null;
  startTime?: string | null;
  /** L'établissement qui accueille — `location` est requis par Google pour un Event. */
  location?: { name: string; address?: string | null } | null;
  /**
   * Faux pour un logement PMS à connecteur coupé (`DatosAlojamiento.reservableEnLinea`) : l'offre
   * garde son prix, mais `availability` est omise — annoncer `InStock` serait faux. Absent = vrai.
   */
  reservableEnLinea?: boolean;
};

/** `time` Postgres arrive en "HH:mm:ss" ; une valeur "HH:mm" reste possible côté saisie. */
function withSeconds(time: string): string {
  return time.length === 5 ? `${time}:00` : time;
}

/**
 * Données structurées d'une fiche produit.
 *
 * ⚠️ Un `evento` est un `Event`, JAMAIS un `Product` avec offre : `price_cop` y est nul par
 * contrainte (`products_price_cop_required_unless_evento`) et seul `price_label`, un texte libre
 * saisi par le partenaire, existe — il n'est pas parsable en prix. Annoncer une offre sans prix,
 * ou tenter d'en extraire un d'un texte libre, produirait une donnée fausse.
 *
 * ⚠️ Rien n'est émis sur la NOTATION (`aggregateRating`, `review`) : aucune table d'avis n'existe
 * dans ce schéma. Inventer une note déclenche une action manuelle Google, longue à lever.
 */
export function buildProductJsonLd(input: ProductJsonLdInput): Record<string, unknown> {
  const url = `${input.siteUrl}/${input.locale}/productos/${input.slug}`;

  const common = {
    "@context": "https://schema.org",
    name: input.name,
    url,
    inLanguage: input.locale,
    ...(input.description ? { description: input.description } : {}),
    ...(input.imageUrls?.length ? { image: input.imageUrls } : {}),
  };

  // Un Event sans date n'est pas un Event exploitable : on retombe alors sur un Product nu
  // (sans offre, faute de prix) plutôt que d'émettre un nœud incomplet.
  if (input.productType === "evento" && input.occurrenceDate) {
    const startDate = input.startTime
      ? `${input.occurrenceDate}T${withSeconds(input.startTime)}${BOGOTA_UTC_OFFSET}`
      : input.occurrenceDate;

    return {
      "@context": common["@context"],
      "@type": "Event",
      name: common.name,
      ...(input.description ? { description: input.description } : {}),
      ...(input.imageUrls?.length ? { image: input.imageUrls } : {}),
      url,
      inLanguage: input.locale,
      startDate,
      ...(input.location
        ? {
            location: {
              "@type": "Place",
              name: input.location.name,
              ...(input.location.address
                ? {
                    address: {
                      "@type": "PostalAddress",
                      streetAddress: input.location.address,
                      addressCountry: "CO",
                    },
                  }
                : {}),
            },
          }
        : {}),
    };
  }

  return {
    "@context": common["@context"],
    "@type": "Product",
    name: common.name,
    ...(input.description ? { description: input.description } : {}),
    ...(input.imageUrls?.length ? { image: input.imageUrls } : {}),
    url,
    inLanguage: input.locale,
    // Le slug est stable et jamais modifié (dérivé du nom par trigger à la création) : c'est le
    // seul identifiant public durable d'un produit.
    sku: input.slug,
    ...(typeof input.priceCop === "number"
      ? {
          offers: {
            "@type": "Offer",
            price: input.priceCop,
            // Codée en dur, exactement comme packages/domain/src/format/formatCop.ts : aucune
            // colonne `currency` n'existe dans ce schéma.
            priceCurrency: "COP",
            url,
            // « En vente », et non « disponible à telle date » : pour un logement adossé au PMS,
            // la disponibilité d'une nuit donnée vit chez LobbyPMS et se demande en direct. On ne
            // prétend rien de plus que ce que `sellable` garantit.
            ...(input.reservableEnLinea === false
              ? {}
              : { availability: "https://schema.org/InStock" }),
          },
        }
      : {}),
  };
}
