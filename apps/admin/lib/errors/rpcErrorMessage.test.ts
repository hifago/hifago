// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { rpcErrorMessage } from "./rpcErrorMessage";

// Le texte d'une erreur de RPC est écrit pour un développeur (souvent en français, avec des noms de
// fonctions, de tables, de colonnes) : il ne s'affiche jamais. Ce fichier prouve que l'écran reçoit
// toujours un texte écrit pour lui, et que le détail part au journal du navigateur.

afterEach(() => vi.restoreAllMocks());

describe("rpcErrorMessage", () => {
  it("sans erreur : le texte de repli du dialogue", () => {
    expect(rpcErrorMessage(null, "No se pudo cambiar el estado.")).toBe("No se pudo cambiar el estado.");
  });

  it("refus de droits (42501) : un message de permission", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(rpcErrorMessage({ code: "42501", message: "accès réservé aux admins" }, "repli")).toBe(
      "No tienes permiso para esta acción."
    );
  });

  it("toute autre erreur : le texte de repli, jamais le message SQL", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const message = rpcErrorMessage(
      { code: "P0001", message: "transition interdite : cancelled_by_client → fulfilled" },
      "No se pudo actualizar la reserva."
    );
    expect(message).toBe("No se pudo actualizar la reserva.");
    expect(message).not.toContain("transition");
  });

  it("le détail part au journal du navigateur, pour le diagnostic", () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcErrorMessage({ code: "P0001", message: "transition interdite" }, "repli");
    expect(journal).toHaveBeenCalledWith(expect.any(String), "P0001", "transition interdite");
  });
});
