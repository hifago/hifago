// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildProductJsonLd } from "./product";

const base = {
  siteUrl: "https://hifago.co",
  locale: "es",
  slug: "tour-lancha",
  name: "Tour en lancha",
  productType: "activity",
  priceCop: 60000,
};

describe("buildProductJsonLd — produit vendable", () => {
  it("émet un Product avec son offre en pesos colombiens", () => {
    expect(buildProductJsonLd(base)).toMatchObject({
      "@type": "Product",
      name: "Tour en lancha",
      url: "https://hifago.co/es/productos/tour-lancha",
      sku: "tour-lancha",
      inLanguage: "es",
      offers: { "@type": "Offer", price: 60000, priceCurrency: "COP" },
    });
  });

  it("omet l'image quand la fiche n'en a aucune, plutôt que d'émettre un tableau vide", () => {
    expect(buildProductJsonLd({ ...base, imageUrls: [] })).not.toHaveProperty("image");
  });

  it("n'émet JAMAIS de notation — aucune table d'avis n'existe dans ce schéma", () => {
    const json = JSON.stringify(buildProductJsonLd({ ...base, imageUrls: ["https://x/a.webp"] }));
    expect(json).not.toMatch(/aggregateRating|ratingValue|reviewCount|"review"/);
  });
});

describe("buildProductJsonLd — evento", () => {
  const evento = {
    ...base,
    productType: "evento",
    priceCop: null,
    occurrenceDate: "2026-09-13",
    startTime: "20:00:00",
  };

  it("émet un Event daté, jamais un Product avec offre", () => {
    const result = buildProductJsonLd(evento);
    expect(result["@type"]).toBe("Event");
    expect(result).not.toHaveProperty("offers");
  });

  it("date l'événement à l'heure de Guatapé, pas en UTC", () => {
    // 20 h à Guatapé, c'est 20:00−05:00 — jamais 20:00Z, qui serait 15 h sur place.
    expect(buildProductJsonLd(evento).startDate).toBe("2026-09-13T20:00:00-05:00");
  });

  it("accepte une heure sans secondes", () => {
    expect(buildProductJsonLd({ ...evento, startTime: "20:00" }).startDate).toBe(
      "2026-09-13T20:00:00-05:00"
    );
  });

  it("se limite à la date quand aucune heure n'est saisie", () => {
    expect(buildProductJsonLd({ ...evento, startTime: null }).startDate).toBe("2026-09-13");
  });

  it("porte le lieu, requis par Google pour un Event", () => {
    const result = buildProductJsonLd({
      ...evento,
      location: { name: "Casa Kayam", address: "Vereda La Peña, Guatapé" },
    });
    expect(result.location).toMatchObject({
      "@type": "Place",
      name: "Casa Kayam",
      address: { "@type": "PostalAddress", streetAddress: "Vereda La Peña, Guatapé", addressCountry: "CO" },
    });
  });

  it("retombe sur un Product sans offre quand l'evento n'a pas de date", () => {
    // Un Event sans startDate n'est pas exploitable : mieux vaut un nœud plus pauvre que faux.
    const result = buildProductJsonLd({ ...evento, occurrenceDate: null });
    expect(result["@type"]).toBe("Product");
    expect(result).not.toHaveProperty("offers");
  });
});

// Un logement PMS à connecteur coupé reste en vente au sens du catalogue mais n'est pas réservable
// en ligne : annoncer `InStock` serait faux. L'offre (le prix) reste, sa disponibilité est omise.
describe("buildProductJsonLd — fiche non réservable en ligne", () => {
  const base = {
    siteUrl: "https://hifago.co",
    locale: "es",
    slug: "dormitorio",
    name: "Dormitorio",
    productType: "lodging",
    priceCop: 60000,
  };

  it("annonce InStock par défaut", () => {
    const offre = buildProductJsonLd(base).offers as Record<string, unknown>;
    expect(offre.availability).toBe("https://schema.org/InStock");
  });

  it("omet availability quand la fiche n'est pas réservable en ligne, prix conservé", () => {
    const offre = buildProductJsonLd({ ...base, reservableEnLinea: false }).offers as Record<string, unknown>;
    expect(offre).not.toHaveProperty("availability");
    expect(offre.price).toBe(60000);
  });
});

