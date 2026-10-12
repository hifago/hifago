import { describe, expect, it } from "vitest";
import { resolveActiveNavTitle } from "@hifago/ui";
import { EXTRA_TITLE_ROUTES, getNavItems } from "./nav-items";

describe("resolveActiveNavTitle", () => {
  const items = [
    { href: "/partner", label: "Inicio" },
    { href: "/partner/establishment", label: "Mi establecimiento y servicios" },
    { href: "/partner/reservations", label: "Mis reservas" },
  ];

  it("correspondance exacte sur la racine", () => {
    expect(resolveActiveNavTitle("/partner", items, "Hifago socio")).toBe("Inicio");
  });

  it("ne confond pas la racine avec une sous-route (préfixe strict, pas un simple startsWith)", () => {
    expect(resolveActiveNavTitle("/partner/establishment", items, "Hifago socio")).not.toBe("Inicio");
  });

  it("correspondance par préfixe pour une route imbriquée", () => {
    expect(resolveActiveNavTitle("/partner/reservations/abc-123", items, "Hifago socio")).toBe("Mis reservas");
  });

  it("le préfixe le plus long gagne quand deux items matchent", () => {
    const withNested = [...items, { href: "/partner/establishment/new", label: "Nuevo establecimiento" }];
    expect(resolveActiveNavTitle("/partner/establishment/new", withNested, "Hifago socio")).toBe(
      "Nuevo establecimiento"
    );
  });

  it("retombe sur le titre par défaut si aucune route ne correspond", () => {
    expect(resolveActiveNavTitle("/partner/unknown", items, "Hifago socio")).toBe("Hifago socio");
  });

  it("résout un titre pour toutes les routes /partner/products/*, absentes de la nav elle-même (EXTRA_TITLE_ROUTES)", () => {
    const allItems = [...getNavItems(true), ...EXTRA_TITLE_ROUTES];
    const productsRoutes = [
      "/partner/products",
      "/partner/products/new",
      "/partner/products/abc-123/edit",
      "/partner/products/abc-123/availability",
      "/partner/products/abc-123/slot-availability",
    ];
    for (const pathname of productsRoutes) {
      expect(resolveActiveNavTitle(pathname, allItems, "Hifago socio")).toBe(
        "Mi establecimiento y servicios"
      );
    }
  });

  it("résout un titre non générique pour chacune des routes de nav réelles (référent complet)", () => {
    const allItems = [...getNavItems(true), ...EXTRA_TITLE_ROUTES];
    for (const item of getNavItems(true)) {
      expect(resolveActiveNavTitle(item.href, allItems, "Hifago socio")).toBe(item.label);
    }
  });
});
