import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EstablishmentStatusCell } from "./EstablishmentStatusCell";
import type { EstablishmentRow } from "./EstablishmentsList";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions sur des propriétés DOM natives
// (même convention que slot-rules-editor.test.tsx), pas de matchers jest-dom.
function baseRow(overrides: Partial<EstablishmentRow> = {}): EstablishmentRow {
  return {
    id: "estab-1",
    name: "Hostal de Prueba",
    partnerId: "partner-1",
    partnerName: "Partner de Prueba",
    status: "active",
    activitiesCount: 0,
    hasSharedResourceProducts: false,
    pendingProposal: null,
    operatorInactive: false,
    ...overrides,
  };
}

describe("EstablishmentStatusCell", () => {
  it("statut seul (pas de proposition, pas d'alerte) → un seul chip 'Activo'", () => {
    render(<EstablishmentStatusCell row={baseRow()} />);
    expect(screen.getByTestId("establishment-status-estab-1").textContent).toBe("Activo");
    expect(screen.queryByTestId("pending-proposal-badge-estab-1")).toBeNull();
    expect(screen.queryByTestId("operator-inactive-badge-estab-1")).toBeNull();
  });

  it("statut 'archived' → chip 'Archivado'", () => {
    render(<EstablishmentStatusCell row={baseRow({ status: "archived" })} />);
    expect(screen.getByTestId("establishment-status-estab-1").textContent).toBe("Archivado");
  });

  // `?entity=establishment` (2026-10-05) : sans lui, /admin/proposals/[id] cherche une proposition de
  // PRODUIT et répond 404 — même lien que l'e-mail de notification (notify_admin_new_proposal).
  it("proposition kind='edit' pending → badge 'Edición pendiente' cliquable vers la proposition d'établissement", () => {
    render(
      <EstablishmentStatusCell
        row={baseRow({ pendingProposal: { id: "proposal-1", kind: "edit" } })}
      />
    );
    const badge = screen.getByTestId("pending-proposal-badge-estab-1");
    expect(badge.textContent).toBe("Edición pendiente");
    expect(badge.getAttribute("href")).toBe("/admin/proposals/proposal-1?entity=establishment");
  });

  it("proposition kind='photos' pending → badge 'Fotos pendientes'", () => {
    render(
      <EstablishmentStatusCell
        row={baseRow({ pendingProposal: { id: "proposal-2", kind: "photos" } })}
      />
    );
    expect(screen.getByTestId("pending-proposal-badge-estab-1").textContent).toBe(
      "Fotos pendientes"
    );
    expect(screen.getByTestId("pending-proposal-badge-estab-1").getAttribute("href")).toBe(
      "/admin/proposals/proposal-2?entity=establishment"
    );
  });

  it("operatorInactive=true → badge 'Prestador no operativo'", () => {
    render(<EstablishmentStatusCell row={baseRow({ operatorInactive: true })} />);
    expect(screen.getByTestId("operator-inactive-badge-estab-1").textContent).toBe(
      "Prestador no operativo"
    );
  });

  it("les deux signaux à la fois → les 3 chips coexistent (indépendance des signaux)", () => {
    render(
      <EstablishmentStatusCell
        row={baseRow({
          pendingProposal: { id: "proposal-3", kind: "edit" },
          operatorInactive: true,
        })}
      />
    );
    expect(screen.getByTestId("establishment-status-estab-1").textContent).toBe("Activo");
    expect(screen.getByTestId("pending-proposal-badge-estab-1")).not.toBeNull();
    expect(screen.getByTestId("operator-inactive-badge-estab-1")).not.toBeNull();
  });

  it("le composant affiche ce que ses props portent sans re-décider selon le statut (operatorInactive=true + status='archived' → l'alerte s'affiche quand même ; ce cas n'arrive jamais en pratique côté RPC, la garde vit là-bas, pas ici)", () => {
    render(
      <EstablishmentStatusCell row={baseRow({ status: "archived", operatorInactive: true })} />
    );
    expect(screen.getByTestId("establishment-status-estab-1").textContent).toBe("Archivado");
    expect(screen.getByTestId("operator-inactive-badge-estab-1")).not.toBeNull();
  });
});
