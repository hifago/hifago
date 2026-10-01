import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages } from "@/messages";
import { CheckoutForm, reserveNightsErrorKey } from "./CheckoutForm";

// `@/i18n/navigation` tire next-intl/navigation → next/navigation, irrésolu sous Vitest (même
// bouchon que BuscadorInicio.test.tsx).
const pushMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: pushMock }),
}));

// Le panier n'est pas le sujet : seul `refresh` (pastille du header) est appelé par le formulaire.
vi.mock("@/lib/cart/CartContext", () => ({ useCart: () => ({ refresh: vi.fn() }) }));

const createOrderMock = vi.fn();
let lectureJeton: { data: { access_token: string } | null; error: unknown } = {
  data: { access_token: "jeton-1" },
  error: null,
};
vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({
    rpc: (name: string) => (name === "create_order" ? createOrderMock() : Promise.reject(new Error(name))),
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => lectureJeton }),
      }),
    }),
  }),
}));

// Correctif minimal (P4a, décision « 2i ») : chaque échec de /api/pms/reserve-nights affiche le
// message de son `reason` / `released`. Avant, seul `released === false` était lu : un 504 sans
// corps ou une erreur de base affichaient « fechas liberadas » alors que rien n'avait été relâché,
// et un délai dépassé chez Lobby était présenté comme une indisponibilité.
describe("reserveNightsErrorKey — un message juste pour chaque réponse de reserve-nights", () => {
  it.each([
    // [cas, corps de la réponse, clé attendue]
    ["504 / 500 de la plateforme, corps illisible", null, "pms_unconfirmed_pending"],
    ["erreur de base (db_error)", { reason: "db_error", released: false }, "pms_unconfirmed_pending"],
    ["commande introuvable", { reason: "order_not_found", released: false }, "pms_unconfirmed_pending"],
    ["claim déjà tenu (double soumission)", { reason: "pms_claim_in_progress", released: false }, "pms_claim_in_progress"],
    ["refus Lobby, commande défaite", { reason: "pms_refused", released: true }, "pms_refused"],
    ["refus Lobby, relâchement impossible", { reason: "pms_refused", released: false }, "pms_refused_pending"],
    ["issue inconnue chez Lobby, commande défaite", { reason: "pms_unreachable", released: true }, "pms_unreachable"],
    ["issue inconnue, relâchement impossible", { reason: "pms_unreachable", released: false }, "pms_unconfirmed_pending"],
    ["connecteur coupé, commande défaite", { reason: "pms_unavailable", released: true }, "pms_unavailable"],
    ["commande déjà défaite (order_not_active)", { reason: "order_not_active", released: true }, "pms_unreachable"],
    ["corps sans `released` (400 invalid_body)", { reason: "invalid_body" }, "pms_unconfirmed_pending"],
  ] as const)("%s → %s", (_cas, corps, attendu) => {
    expect(reserveNightsErrorKey(corps)).toBe(attendu);
  });

  it.each(["es", "en"] as const)("chaque clé possible existe dans les messages %s", async (locale) => {
    const messages = (await loadMessages(locale)) as { CheckoutPage: { errors: Record<string, string> } };
    for (const key of [
      "pms_refused",
      "pms_refused_pending",
      "pms_unavailable",
      "pms_unreachable",
      "pms_unconfirmed_pending",
      "pms_claim_in_progress",
    ]) {
      expect(messages.CheckoutPage.errors[key], key).toBeTruthy();
    }
  });
});

// C5 (audit 2026-09-28) : le bouton était rendu dès le retour de create_order, AVANT l'appel à Lobby
// (jusqu'à une minute). Un second clic relançait create_order sur un panier déjà vidé et affichait
// « empty_cart » pendant que la première commande se confirmait encore.
describe("CheckoutForm — le bouton reste tenu jusqu'à la fin de reserve-nights", () => {
  let repondreLobby: (response: Response) => void;
  const fetchMock = vi.fn();

  beforeEach(() => {
    pushMock.mockClear();
    lectureJeton = { data: { access_token: "jeton-1" }, error: null };
    createOrderMock.mockReset();
    createOrderMock.mockResolvedValue({ data: { ok: true, order_id: "commande-1" }, error: null });
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          repondreLobby = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function rendre() {
    const { container } = render(
      <NextIntlClientProvider locale="es" messages={loadMessages("es")}>
        <CheckoutForm
          isAuthenticated
          initialHolderName="Ana Pérez"
          initialHolderPhone="+573001234567"
          initialHolderEmail="ana@test.local"
        />
      </NextIntlClientProvider>
    );
    const form = container.querySelector("form")!;
    const bouton = container.querySelector('[data-testid="submit-order-button"]') as HTMLButtonElement;
    return { container, form, bouton };
  }

  it("désactivé pendant l'attente de Lobby : un second clic ne relance pas create_order", async () => {
    const { form, bouton } = rendre();
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bouton.disabled).toBe(true);
    expect(bouton.textContent).toBe(loadMessages("es").CheckoutPage.submitting);

    // Le second clic du client pendant l'attente. Bouton désactivé : aucune soumission (et la touche
    // Entrée non plus — un formulaire dont le bouton par défaut est désactivé ne se soumet pas).
    await act(async () => {
      fireEvent.click(bouton);
    });
    expect(createOrderMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      repondreLobby(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
    expect(pushMock).toHaveBeenCalledWith("/reserva/jeton-1");
    expect(bouton.disabled).toBe(true); // la page part : rien à rendre
  });

  // create_order a vidé le panier : rendre le bouton n'offrirait qu'« empty_cart » au clic suivant.
  it("reste éteint après un échec de Lobby, avec le message du motif", async () => {
    const { container, form, bouton } = rendre();
    await act(async () => {
      fireEvent.submit(form);
    });
    await act(async () => {
      repondreLobby(
        new Response(JSON.stringify({ ok: false, reason: "pms_refused", released: true }), { status: 409 })
      );
    });
    expect(bouton.disabled).toBe(true);
    expect(bouton.textContent).toBe(loadMessages("es").CheckoutPage.submit);
    expect(container.querySelector('[data-testid="checkout-error"]')?.textContent).toBe(
      loadMessages("es").CheckoutPage.errors.pms_refused
    );
    // Commande défaite : rien à reprendre.
    expect(container.querySelector('[data-testid="resume-order-link"]')).toBeNull();
  });

  it.each([
    ["claim tenu ailleurs", { ok: false, reason: "pms_claim_in_progress", released: false }, 409, true],
    ["504 sans corps", null, 504, true],
    ["refus, relâchement impossible", { ok: false, reason: "pms_refused", released: false }, 409, false],
  ] as const)("%s : lien de reprise %s", async (_cas, corps, status, lienAttendu) => {
    const { container, form } = rendre();
    await act(async () => {
      fireEvent.submit(form);
    });
    await act(async () => {
      repondreLobby(new Response(corps === null ? "" : JSON.stringify(corps), { status }));
    });
    expect(container.querySelector('[data-testid="resume-order-link"]') !== null).toBe(lienAttendu);
  });

  it("réseau coupé pendant l'appel à Lobby : commande non libérée, on ne propose pas de réessayer", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));
    const { container, form, bouton } = rendre();
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(container.querySelector('[data-testid="checkout-error"]')?.textContent).toBe(
      loadMessages("es").CheckoutPage.errors.pms_unconfirmed_pending
    );
    expect(bouton.disabled).toBe(true);
    expect(pushMock).not.toHaveBeenCalled();
    // La commande vit encore : le chemin pour la reprendre est donné, puisque le bouton ne l'est plus.
    expect(container.querySelector('[data-testid="resume-order-link"]')?.getAttribute("href")).toBe("/mi-viaje");
  });

  it("jeton illisible après l'accord de Lobby : message, aucune redirection, bouton éteint", async () => {
    lectureJeton = { data: null, error: { message: "réseau" } };
    const { container, form, bouton } = rendre();
    await act(async () => {
      fireEvent.submit(form);
    });
    await act(async () => {
      repondreLobby(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
    // Lobby a accepté et la commande existe : ni « inténtalo de nuevo » (une seconde commande ferait
    // un second booking), ni silence — le chemin vers la commande.
    expect(container.querySelector('[data-testid="checkout-error"]')?.textContent).toBe(
      loadMessages("es").CheckoutPage.errors.order_placed_unreadable
    );
    expect(container.querySelector('[data-testid="resume-order-link"]')).not.toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
    expect(bouton.disabled).toBe(true);
  });

  it("rendu après un refus de create_order", async () => {
    createOrderMock.mockResolvedValue({ data: { ok: false, reason: "empty_cart" }, error: null });
    const { form, bouton } = rendre();
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(bouton.disabled).toBe(false);
  });
});
