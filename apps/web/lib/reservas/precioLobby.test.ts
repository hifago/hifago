import { describe, expect, it } from "vitest";
import { precioLobbyPorUnidad } from "./precioLobby";

describe("precioLobbyPorUnidad", () => {
  const precios = new Map([
    ["2026-11-06", 45_000],
    ["2026-11-07", 60_000],
  ]);

  it("la somme des nuits — semaine et week-end — pour une unité", () => {
    expect(precioLobbyPorUnidad(["2026-11-06", "2026-11-07"], (n) => precios.get(n))).toBe(105_000);
  });

  it("une nuit sans prix : non estimable, jamais un total partiel", () => {
    expect(precioLobbyPorUnidad(["2026-11-06", "2026-11-08"], (n) => precios.get(n))).toBeNull();
    expect(precioLobbyPorUnidad(["2026-11-06"], () => null)).toBeNull();
    expect(precioLobbyPorUnidad(["2026-11-06"], () => 0)).toBeNull();
  });

  it("aucune nuit : rien à estimer", () => {
    expect(precioLobbyPorUnidad([], () => 1)).toBeNull();
  });
});
