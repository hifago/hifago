import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ReconciliationList, type ReconciliationEntryRow } from "./ReconciliationList";

// Les dialogues parlent à Supabase : hors périmètre ici (RPC couvertes par pgTAP). Ce test prouve la
// LOGIQUE DE RENDU : quand l'écran propose Reintentar / Confirmar / Anular (demande bloquée), et que
// le dialogue reçoit la bonne action.
vi.mock("./ResolveEntryDialog", () => ({ ResolveEntryDialog: () => null }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const dialogue = vi.fn();
vi.mock("./ResolvePmsRequestDialog", () => ({
  ResolvePmsRequestDialog: (props: { action: string; requestId: string; lines: unknown[]; onSuccess: (a: string) => void }) => {
    dialogue(props);
    return (
      <button data-testid="dialogue-succes" onClick={() => props.onSuccess(props.action)}>
        succès
      </button>
    );
  },
}));

function row(overrides: Partial<ReconciliationEntryRow>): ReconciliationEntryRow {
  return {
    id: "e1",
    status: "open",
    attempts: 0,
    detail: "commande PAYÉE — Lobby a refusé — reloger ou rembourser à la main",
    orderId: "o1",
    orderLineId: "l1",
    holderName: "Ana",
    establishmentName: "Casa Kayam",
    pmsRequest: null,
    ...overrides,
  };
}

describe("ReconciliationList — reprise d'une commande payée bloquée", () => {
  it("propose les trois gestes seulement quand la demande de booking est bloquée", () => {
    render(
      <ReconciliationList
        rows={[
          row({ id: "bloquee", pmsRequest: { id: "r1", status: "failed", lines: [] } }),
          row({ id: "ordinaire", orderId: "o2", pmsRequest: null }),
        ]}
      />
    );
    expect(screen.getAllByTestId("pms-request-retry-button")).toHaveLength(1);
    expect(screen.getAllByTestId("pms-request-confirm-button")).toHaveLength(1);
    expect(screen.getAllByTestId("pms-request-cancel-button")).toHaveLength(1);
    // « Resolver » reste sur les deux entrées.
    expect(screen.getAllByTestId("resolve-entry-button")).toHaveLength(2);
  });

  it("ouvre le dialogue avec l'action cliquée, la demande et la ligne de l'entrée", () => {
    render(<ReconciliationList rows={[row({ pmsRequest: { id: "r1", status: "needs_human", lines: [] } })]} />);
    fireEvent.click(screen.getByTestId("pms-request-confirm-button"));
    expect(dialogue).toHaveBeenLastCalledWith(expect.objectContaining({ action: "confirm", requestId: "r1", lines: [] }));
  });

  it("après « Confirmar », SEULE l'entrée « Lobby a refusé » sort : « remise à saisir » reste affichée", () => {
    render(
      <ReconciliationList
        rows={[
          row({ id: "refus", pmsRequest: { id: "r1", status: "failed", lines: [] } }),
          row({ id: "remise", detail: "remise à saisir à la main dans Lobby : le booking 1 a été créé SANS le paiement", pmsRequest: { id: "r1", status: "failed", lines: [] } }),
          row({ id: "inconnue", detail: "commande PAYÉE — issue inconnue — booking PEUT-ÊTRE créé chez Lobby", pmsRequest: { id: "r1", status: "failed", lines: [] } }),
        ]}
      />
    );
    fireEvent.click(screen.getAllByTestId("pms-request-confirm-button")[0]);
    fireEvent.click(screen.getByTestId("dialogue-succes"));
    const restantes = screen.getAllByTestId("reconciliation-entry").map((e) => e.textContent ?? "");
    expect(restantes).toHaveLength(2);
    expect(restantes.some((t) => t.includes("remise à saisir"))).toBe(true);
    expect(restantes.some((t) => t.includes("issue inconnue"))).toBe(true);
    // Plus aucun bouton de reprise : la demande n'est plus bloquée.
    expect(screen.queryByTestId("pms-request-confirm-button")).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });

  it("après « Confirmar » ou « Anular », l'entrée sort de la file ; après « Reintentar », elle reste sans boutons", () => {
    const { unmount } = render(<ReconciliationList rows={[row({ pmsRequest: { id: "r1", status: "failed", lines: [] } })]} />);
    fireEvent.click(screen.getByTestId("pms-request-cancel-button"));
    fireEvent.click(screen.getByTestId("dialogue-succes"));
    expect(screen.queryAllByTestId("reconciliation-entry")).toHaveLength(0);
    unmount();

    render(<ReconciliationList rows={[row({ pmsRequest: { id: "r1", status: "needs_human", lines: [] } })]} />);
    fireEvent.click(screen.getByTestId("pms-request-retry-button"));
    fireEvent.click(screen.getByTestId("dialogue-succes"));
    const group = within(screen.getByTestId("reconciliation-actionable-group"));
    expect(group.getAllByTestId("reconciliation-entry")).toHaveLength(1);
    expect(screen.queryByTestId("pms-request-retry-button")).toBeNull();
  });
});
