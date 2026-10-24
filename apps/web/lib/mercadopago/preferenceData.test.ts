// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import {
  aggregatedItem,
  buildPayerIdentity,
  buildPreferenceItems,
  categoryForProductType,
  splitHolderName,
  sumOfItems,
  toMercadoPagoPhone,
  type PreferenceLine,
} from "./preferenceData";

// Bug anti-fraude du 2026-10-23 (`cc_rejected_high_risk`) : la préférence partait presque vide. Ces
// tests gardent DEUX choses — que les données de l'acheteur et du produit partent bien, et surtout
// que le montant facturé ne bouge jamais (Σ items = payments.amount_cop), faute de quoi le webhook
// refuserait le paiement en `amount_mismatch`.

const PAYMENT_ID = "44444444-4444-4444-8444-444444444444";

function ligne(overrides: Partial<PreferenceLine> = {}): PreferenceLine {
  return {
    id: "line-1",
    productName: { es: "Kayak al amanecer", en: "Sunrise kayak" },
    productType: "activity",
    establishmentName: { es: "Casa Kayam" },
    date: "2026-11-12",
    endDate: null,
    durationDays: null,
    slotStartTime: "09:00:00",
    qty: 2,
    acompteCop: 40000,
    status: "reserved",
    ...overrides,
  };
}

describe("splitHolderName", () => {
  it("premier mot = prénom, le reste = nom", () => {
    expect(splitHolderName("Camila Andrea Gómez")).toEqual({ name: "Camila", surname: "Andrea Gómez" });
    expect(splitHolderName("Camila Gómez")).toEqual({ name: "Camila", surname: "Gómez" });
  });

  it("un seul mot → name seul, jamais un surname vide ou inventé", () => {
    expect(splitHolderName("Camila")).toEqual({ name: "Camila" });
    expect(splitHolderName("Camila")).not.toHaveProperty("surname");
  });

  it("ignore les espaces en trop et rend {} pour un nom vide ou absent", () => {
    expect(splitHolderName("  Camila   Gómez  ")).toEqual({ name: "Camila", surname: "Gómez" });
    expect(splitHolderName("   ")).toEqual({});
    expect(splitHolderName("")).toEqual({});
    expect(splitHolderName(null)).toEqual({});
    expect(splitHolderName(undefined)).toEqual({});
  });
});

describe("toMercadoPagoPhone", () => {
  it("numéro colombien → indicatif 57 et numéro national", () => {
    expect(toMercadoPagoPhone("+573001234567")).toEqual({ area_code: "57", number: "3001234567" });
  });

  it("numéro étranger → son propre indicatif, pas celui de la Colombie", () => {
    expect(toMercadoPagoPhone("+33612345678")).toEqual({ area_code: "33", number: "612345678" });
  });

  it("numéro invalide, illisible, vide ou nul → null (le champ est omis)", () => {
    expect(toMercadoPagoPhone("+57300")).toBeNull(); // analysable mais invalide
    expect(toMercadoPagoPhone("abc")).toBeNull();
    expect(toMercadoPagoPhone("+")).toBeNull();
    expect(toMercadoPagoPhone("")).toBeNull();
    expect(toMercadoPagoPhone("   ")).toBeNull();
    expect(toMercadoPagoPhone(null)).toBeNull();
    expect(toMercadoPagoPhone(undefined)).toBeNull();
  });
});

describe("buildPayerIdentity", () => {
  it("assemble prénom, nom et téléphone", () => {
    expect(buildPayerIdentity("Camila Gómez", "+573001234567")).toEqual({
      name: "Camila",
      surname: "Gómez",
      phone: { area_code: "57", number: "3001234567" },
    });
  });

  it("omet le téléphone illisible, garde le nom", () => {
    const identity = buildPayerIdentity("Camila Gómez", "no-es-un-telefono");
    expect(identity).toEqual({ name: "Camila", surname: "Gómez" });
    expect(identity).not.toHaveProperty("phone");
  });

  it("rend {} quand on ne sait rien", () => {
    expect(buildPayerIdentity(null, null)).toEqual({});
  });

  // Hifago ne collecte ni document ni adresse : les fabriquer serait pire qu'une absence.
  it("n'invente jamais identification, address ni date_created", () => {
    const identity = buildPayerIdentity("Camila Gómez", "+573001234567");
    for (const champ of ["identification", "address", "date_created", "email"]) {
      expect(identity).not.toHaveProperty(champ);
    }
  });
});

describe("categoryForProductType", () => {
  it("hébergement et transport → travels", () => {
    for (const type of ["lodging", "hotel", "camp", "transport"]) {
      expect(categoryForProductType(type)).toBe("travels");
    }
  });

  it("activités, tours et événements → tickets", () => {
    for (const type of ["activity", "tour", "evento"]) {
      expect(categoryForProductType(type)).toBe("tickets");
    }
  });

  it("type inconnu ou absent → services", () => {
    expect(categoryForProductType("autre")).toBe("services");
    expect(categoryForProductType(null)).toBe("services");
    expect(categoryForProductType(undefined)).toBe("services");
  });
});

describe("buildPreferenceItems — le détail des lignes", () => {
  it("un item par ligne reserved, au montant de son acompte", () => {
    const items = buildPreferenceItems({
      paymentId: PAYMENT_ID,
      amountCop: 70000,
      reference: "HFG-000042",
      lines: [
        ligne({ id: "a", acompteCop: 40000 }),
        ligne({ id: "b", acompteCop: 30000, productType: "lodging", date: "2026-11-20", endDate: "2026-11-23", slotStartTime: null }),
      ],
    });
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(items.map((item) => item.category_id)).toEqual(["tickets", "travels"]);
    expect(items.every((item) => item.quantity === 1 && item.currency_id === "COP")).toBe(true);
    expect(items.map((item) => item.unit_price)).toEqual([40000, 30000]);
  });

  it("titre = « Anticipo – produit · établissement », description = dates et quantité", () => {
    const [item] = buildPreferenceItems({
      paymentId: PAYMENT_ID,
      amountCop: 40000,
      lines: [ligne()],
    });
    expect(item.title).toBe("Anticipo – Kayak al amanecer · Casa Kayam");
    expect(item.description).toBe("2026-11-12 · a las 09:00 · cantidad 2");
  });

  it("décrit un séjour par ses deux dates et un camp par sa durée", () => {
    const [sejour] = buildPreferenceItems({
      paymentId: PAYMENT_ID,
      amountCop: 40000,
      lines: [ligne({ endDate: "2026-11-15", slotStartTime: null, qty: 1 })],
    });
    expect(sejour.description).toBe("2026-11-12 al 2026-11-15 · cantidad 1");
    const [camp] = buildPreferenceItems({
      paymentId: PAYMENT_ID,
      amountCop: 40000,
      lines: [ligne({ productType: "camp", durationDays: 5, slotStartTime: null, qty: 1 })],
    });
    expect(camp.description).toBe("2026-11-12 · 5 días · cantidad 1");
  });

  it("n'omet l'établissement du titre que s'il n'en a pas", () => {
    const [item] = buildPreferenceItems({
      paymentId: PAYMENT_ID,
      amountCop: 40000,
      lines: [ligne({ establishmentName: null })],
    });
    expect(item.title).toBe("Anticipo – Kayak al amanecer");
  });

  it("ne retient QUE les lignes reserved — annulées, expirées et remplacées n'entrent pas", () => {
    const items = buildPreferenceItems({
      paymentId: PAYMENT_ID,
      amountCop: 40000,
      lines: [
        ligne({ id: "vivante" }),
        ligne({ id: "annulee", status: "cancelled_by_client", acompteCop: 25000 }),
        ligne({ id: "expiree", status: "expired", acompteCop: 25000 }),
        ligne({ id: "remplacee", status: "superseded", acompteCop: 25000 }),
        ligne({ id: "honoree", status: "fulfilled", acompteCop: 25000 }),
      ],
    });
    expect(items.map((item) => item.id)).toEqual(["vivante"]);
    expect(sumOfItems(items)).toBe(40000);
  });

  it("omet une ligne à acompte nul sans changer la somme (un unit_price de 0 ferait refuser la préférence)", () => {
    const items = buildPreferenceItems({
      paymentId: PAYMENT_ID,
      amountCop: 40000,
      lines: [ligne({ id: "payante" }), ligne({ id: "gratuite", acompteCop: 0, productType: "evento" })],
    });
    expect(items.map((item) => item.id)).toEqual(["payante"]);
  });

  it("résout les noms en espagnol, avec repli sur la première langue disponible", () => {
    const [espagnol] = buildPreferenceItems({
      paymentId: PAYMENT_ID,
      amountCop: 40000,
      lines: [ligne({ productName: { es: "Kayak", en: "Kayak EN" }, establishmentName: { en: "Only EN place" } })],
    });
    expect(espagnol.title).toBe("Anticipo – Kayak · Only EN place");
    const [repli] = buildPreferenceItems({
      paymentId: PAYMENT_ID,
      amountCop: 40000,
      lines: [ligne({ productName: { en: "Sunrise kayak" }, establishmentName: {} })],
    });
    expect(repli.title).toBe("Anticipo – Sunrise kayak");
  });

  it("borne la longueur du titre et de la description, sans couper un caractère en deux", () => {
    const [item] = buildPreferenceItems({
      paymentId: PAYMENT_ID,
      amountCop: 40000,
      lines: [ligne({ productName: { es: "😀".repeat(300) }, establishmentName: null })],
    });
    expect(Array.from(item.title).length).toBeLessThanOrEqual(100);
    expect(item.title.endsWith("…")).toBe(true);
    expect(item.title).not.toMatch(/[\uD800-\uDBFF]$/);
    expect((item.description ?? "").length).toBeLessThanOrEqual(256);
  });
});

describe("buildPreferenceItems — event_date", () => {
  afterEach(() => {
    delete process.env.TZ;
  });

  it("date de la prestation à l'heure de Guatapé, avec décalage explicite", () => {
    const [item] = buildPreferenceItems({ paymentId: PAYMENT_ID, amountCop: 40000, lines: [ligne()] });
    expect(item.category_descriptor).toEqual({ event_date: "2026-11-12T09:00:00.000-05:00" });
  });

  it("minuit quand il n'y a pas de créneau", () => {
    const [item] = buildPreferenceItems({
      paymentId: PAYMENT_ID,
      amountCop: 40000,
      lines: [ligne({ slotStartTime: null })],
    });
    expect(item.category_descriptor).toEqual({ event_date: "2026-11-12T00:00:00.000-05:00" });
  });

  // Règle des tests de fuseau : forcer un TROISIÈME fuseau, ni celui du dev (Bogota) ni celui de
  // Vercel (UTC). Le décalage vient de la base de fuseaux, pas de l'horloge de la machine.
  it("ne dépend pas du fuseau de la machine", () => {
    process.env.TZ = "Europe/Paris";
    const [item] = buildPreferenceItems({
      paymentId: PAYMENT_ID,
      amountCop: 40000,
      lines: [ligne({ date: "2026-12-31", slotStartTime: "23:30" })],
    });
    expect(item.category_descriptor).toEqual({ event_date: "2026-12-31T23:30:00.000-05:00" });
  });

  it("omet event_date d'une date illisible plutôt que d'en inventer une", () => {
    const [item] = buildPreferenceItems({
      paymentId: PAYMENT_ID,
      amountCop: 40000,
      lines: [ligne({ date: "12/11/2026" })],
    });
    expect(item).not.toHaveProperty("category_descriptor");
  });
});

describe("buildPreferenceItems — INVARIANT Σ items = payments.amount_cop", () => {
  const lignes = [ligne({ id: "a", acompteCop: 40000 }), ligne({ id: "b", acompteCop: 30000 })];

  it("la somme des items égale le montant facturé quand le détail tombe juste", () => {
    const items = buildPreferenceItems({ paymentId: PAYMENT_ID, amountCop: 70000, lines: lignes });
    expect(items).toHaveLength(2);
    expect(sumOfItems(items)).toBe(70000);
  });

  it("repli sur UN item agrégé, au montant facturé, quand le détail diverge", () => {
    // Une ligne annulée entre la création de l'intent et la lecture : 70000 facturés, 40000 lus.
    const items = buildPreferenceItems({
      paymentId: PAYMENT_ID,
      amountCop: 70000,
      reference: "HFG-000042",
      lines: [ligne({ id: "a", acompteCop: 40000 }), ligne({ id: "b", acompteCop: 30000, status: "cancelled_by_client" })],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: PAYMENT_ID, unit_price: 70000, quantity: 1, currency_id: "COP" });
    expect(sumOfItems(items)).toBe(70000);
  });

  it("repli agrégé aussi quand le détail dépasse le montant facturé", () => {
    const items = buildPreferenceItems({ paymentId: PAYMENT_ID, amountCop: 50000, lines: lignes });
    expect(items).toHaveLength(1);
    expect(sumOfItems(items)).toBe(50000);
  });

  it("repli agrégé sur un acompte non entier — le COP n'a pas de centimes à arrondir", () => {
    const items = buildPreferenceItems({
      paymentId: PAYMENT_ID,
      amountCop: 40000,
      lines: [ligne({ acompteCop: 39999.5 }), ligne({ id: "b", acompteCop: 0.5 })],
    });
    expect(items).toHaveLength(1);
    expect(items[0].unit_price).toBe(40000);
  });

  it("repli agrégé quand les lignes manquent (null, undefined, vide, aucune reserved)", () => {
    for (const sansDetail of [null, undefined, [], [ligne({ status: "expired" })]]) {
      const items = buildPreferenceItems({ paymentId: PAYMENT_ID, amountCop: 40000, lines: sansDetail });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ id: PAYMENT_ID, unit_price: 40000 });
    }
  });

  it("l'item agrégé garde le titre d'avant ce lot et porte la référence quand on la connaît", () => {
    expect(aggregatedItem({ paymentId: PAYMENT_ID, amountCop: 40000, reference: "HFG-000042" })).toEqual({
      id: PAYMENT_ID,
      title: "Anticipo de reserva Hifago",
      description: "Reserva HFG-000042",
      category_id: "travels",
      quantity: 1,
      currency_id: "COP",
      unit_price: 40000,
    });
    expect(aggregatedItem({ paymentId: PAYMENT_ID, amountCop: 40000 })).not.toHaveProperty("description");
  });
});

describe("buildPreferenceItems — aucun champ inventé", () => {
  const CHAMPS_ITEM = ["id", "title", "description", "category_id", "quantity", "currency_id", "unit_price", "category_descriptor"];

  it("un item ne porte que des champs de l'API de préférences, et rien sur l'identité de l'acheteur", () => {
    const items = [
      ...buildPreferenceItems({ paymentId: PAYMENT_ID, amountCop: 70000, lines: [ligne({ acompteCop: 40000 }), ligne({ id: "b", acompteCop: 30000 })] }),
      ...buildPreferenceItems({ paymentId: PAYMENT_ID, amountCop: 70000, lines: null }),
    ];
    for (const item of items) {
      for (const champ of Object.keys(item)) expect(CHAMPS_ITEM).toContain(champ);
      for (const interdit of ["picture_url", "warranty", "type"]) expect(item).not.toHaveProperty(interdit);
    }
  });
});
