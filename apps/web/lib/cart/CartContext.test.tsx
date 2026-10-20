import { StrictMode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CartProvider, PENDING_CART_MERGE_KEY, useCart, type AddToCartInput } from "./CartContext";

// Invariants 1/2 de la spec 31 (docs/specs/31-identite-anonyme.md) — le point précis qui a motivé
// ce test : signInAnonymously() n'est PAS idempotent (POST /signup inconditionnel), donc l'appeler
// sans vérifier d'abord qu'une session existe déjà déconnecterait un client réellement connecté au
// premier clic sur « Ajouter au panier ». Rien d'autre dans ce fichier ne le protégeait.
//
// Depuis spec 32 (panier en base) : `addLine` écrit réellement dans `cart_items` (RLS directe),
// plus un simple `setLines` local — le mock ci-dessous simule cette table en mémoire, dans l'ordre
// d'insertion (`refresh()` la relit après chaque ajout). `refresh()` rappelle lui-même
// `getSession()` (pour tout appelant qui n'a pas de session déjà en main) — `getSession` doit donc
// refléter la session posée par `signInAnonymously()`, comme le fait le vrai client Supabase (son
// cache de session interne), sans quoi le second appel verrait encore « aucune session » et
// `refresh()` viderait `lines` juste après que `addLine` les ait remplies.
let currentSession: { user: { id: string } } | null = null;
const getSession = vi.fn(() => Promise.resolve({ data: { session: currentSession } }));
const signInAnonymously = vi.fn();

type Row = {
  id: string;
  product_id: string;
  date: string;
  end_date: string | null;
  slot_start_time: string | null;
  qty: number;
};
let rows: Row[] = [];

// Spec 42 : `trip_events` en mémoire. `gte` honore réellement la borne reçue (le filtre « à venir »
// est donc prouvé, pas supposé), et l'unicité (compte, produit, date) rend 23505 comme la base.
type FilaEvento = { id: string; account_id: string; product_id: string; date: string };
let filasEventos: FilaEvento[] = [];

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession, signInAnonymously },
    from: (table: string) => {
      if (table === "trip_events") {
        return {
          insert: (row: Omit<FilaEvento, "id">) => {
            const doublon = filasEventos.some(
              (f) => f.account_id === row.account_id && f.product_id === row.product_id && f.date === row.date
            );
            if (doublon) return Promise.resolve({ error: { code: "23505" } });
            filasEventos.push({ id: `evt-${filasEventos.length + 1}`, ...row });
            return Promise.resolve({ error: null });
          },
          select: () => ({
            gte: (_col: string, desde: string) => ({
              order: () =>
                Promise.resolve({ data: filasEventos.filter((f) => f.date >= desde), error: null }),
            }),
          }),
        };
      }
      if (table !== "cart_items") throw new Error(`table inattendue dans ce mock : ${table}`);
      type NouvelleLigne = {
        product_id: string;
        date: string;
        end_date: string | null;
        slot_start_time: string | null;
        qty: number;
      };
      return {
        // Accepte une ligne seule (addLine) OU un tableau (fusion du panier anonyme au login,
        // 2026-09-14, LoginForm.tsx/CartContext.tsx) — même mock des deux côtés.
        insert: (input: NouvelleLigne | NouvelleLigne[]) => {
          const nouvelles = Array.isArray(input) ? input : [input];
          for (const row of nouvelles) rows.push({ id: `row-${rows.length + 1}`, ...row });
          return Promise.resolve({ error: null });
        },
        select: () => ({
          order: () => Promise.resolve({ data: rows, error: null }),
        }),
      };
    },
  }),
}));

const LIGNE: AddToCartInput = {
  productId: "p1",
  date: "2028-01-01",
  qty: 1,
};

function Sonde() {
  const { lines, addLine, tripEvents, addTripEvent } = useCart();
  const [resultadoEvento, setResultadoEvento] = useState("");
  return (
    <div>
      <button onClick={() => addLine(LIGNE)}>ajouter</button>
      <button
        onClick={async () =>
          setResultadoEvento(String((await addTripEvent({ productId: "evt-p1", date: "2099-01-01" })).ok))
        }
      >
        noter
      </button>
      <span data-testid="count">{lines.length}</span>
      <span data-testid="eventos">{tripEvents.length}</span>
      <span data-testid="resultado-evento">{resultadoEvento}</span>
    </div>
  );
}

describe("CartContext — invariants 1/2 (session anonyme au premier ajout)", () => {
  beforeEach(() => {
    getSession.mockClear();
    signInAnonymously.mockReset();
    currentSession = null;
    rows = [];
    filasEventos = [];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
  });

  it("invariant 2 : une session déjà active (connectée ou déjà anonyme) → signInAnonymously JAMAIS appelé", async () => {
    currentSession = { user: { id: "u1" } };
    render(
      <CartProvider>
        <Sonde />
      </CartProvider>,
    );
    fireEvent.click(screen.getByText("ajouter"));
    await screen.findByText("1");
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it("invariant 1 : aucune session → signInAnonymously appelé une seule fois, la ligne rejoint le panier", async () => {
    signInAnonymously.mockImplementation(() => {
      currentSession = { user: { id: "u1" } };
      return Promise.resolve({ data: { session: currentSession }, error: null });
    });
    render(
      <CartProvider>
        <Sonde />
      </CartProvider>,
    );
    fireEvent.click(screen.getByText("ajouter"));
    await screen.findByText("1");
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("échec fermé : signInAnonymously échoue → la ligne n'entre JAMAIS dans le panier (jamais de commande orpheline)", async () => {
    signInAnonymously.mockResolvedValue({ data: { session: null }, error: new Error("réseau indisponible") });
    render(
      <CartProvider>
        <Sonde />
      </CartProvider>,
    );
    fireEvent.click(screen.getByText("ajouter"));
    // Laisse la promesse se résoudre — aucune assertion positive à attendre ici, on vérifie
    // l'ABSENCE d'effet, donc pas de findBy possible : un délai court et déterministe suffit,
    // la résolution de la chaîne getSession → signInAnonymously ne dépend d'aucun timer réel.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId("count").textContent).toBe("0");
  });
});

// Retour Jérôme (2026-09-14) : un panier anonyme partait perdu à la connexion Google. GoogleButton.tsx
// dépose le panier dans sessionStorage juste avant de partir vers Google ; ce bloc prouve que
// CartProvider le consomme correctement au montage suivant — celui de la page d'atterrissage de
// /auth/callback, quelle qu'elle soit.
describe("CartContext — consommation du panier déposé avant une redirection OAuth (2026-09-14)", () => {
  beforeEach(() => {
    currentSession = null;
    rows = [];
    filasEventos = [];
    sessionStorage.clear();
  });

  it("fusionne les lignes déposées quand l'identité a réellement changé (OAuth réussi)", async () => {
    currentSession = { user: { id: "compte-reel" } };
    sessionStorage.setItem(
      PENDING_CART_MERGE_KEY,
      JSON.stringify({
        fromAccountId: "anon-avant-google",
        lines: [{ id: "l1", productId: "p1", date: "2026-10-01", qty: 2 }],
      })
    );

    render(
      <CartProvider>
        <Sonde />
      </CartProvider>
    );

    await screen.findByText("1");
    expect(rows).toEqual([
      {
        id: "row-1",
        account_id: "compte-reel",
        product_id: "p1",
        date: "2026-10-01",
        end_date: null,
        slot_start_time: null,
        qty: 2,
      },
    ]);
  });

  it("ne fusionne rien si l'identité n'a PAS changé — jamais une ligne dupliquée sous le même anonyme", async () => {
    currentSession = { user: { id: "anon-1" } };
    sessionStorage.setItem(
      PENDING_CART_MERGE_KEY,
      JSON.stringify({
        fromAccountId: "anon-1", // la MÊME identité : signInWithOAuth n'a jamais réellement abouti.
        lines: [{ id: "l1", productId: "p1", date: "2026-10-01", qty: 2 }],
      })
    );

    render(
      <CartProvider>
        <Sonde />
      </CartProvider>
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rows).toHaveLength(0);
  });

  it("retire la clé sessionStorage immédiatement — jamais un retry qui dupliquerait au prochain montage", async () => {
    currentSession = { user: { id: "compte-reel" } };
    sessionStorage.setItem(
      PENDING_CART_MERGE_KEY,
      JSON.stringify({ fromAccountId: "anon-avant-google", lines: [{ id: "l1", productId: "p1", date: "2026-10-01", qty: 2 }] })
    );

    render(
      <CartProvider>
        <Sonde />
      </CartProvider>
    );
    await screen.findByText("1");

    expect(sessionStorage.getItem(PENDING_CART_MERGE_KEY)).toBeNull();
  });

  it("aucune clé déposée → aucun appel superflu, comportement identique à avant ce lot", async () => {
    currentSession = { user: { id: "compte-reel" } };
    render(
      <CartProvider>
        <Sonde />
      </CartProvider>
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rows).toHaveLength(0);
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  // ⚠️ CE TEST EST CELUI QUI AURAIT ATTRAPÉ LE BUG RÉEL (retour Jérôme, 2026-09-14) : un premier
  // essai posait une garde `annule` au démontage, invisible en rendu normal (comme les tests
  // ci-dessus, qui passaient tous). Seul React.StrictMode (actif par défaut en dev sur l'App
  // Router, jamais activé par défaut par `render()` de Testing Library) monte/démonte/remonte un
  // composant une fois au premier rendu — exactement ce qui faisait passer `annule` à `true` avant
  // que `getSession()` ait fini de résoudre, et silencieusement avorter la fusion en vrai navigateur
  // alors que CE MÊME test, sans StrictMode, restait vert. Mutation : réintroduire la garde
  // `annule`/`return () => { annule = true }` fait rougir CE test précis, aucun des précédents.
  it("fusionne quand même sous React.StrictMode (mount → unmount → remount immédiat du dev)", async () => {
    currentSession = { user: { id: "compte-reel" } };
    sessionStorage.setItem(
      PENDING_CART_MERGE_KEY,
      JSON.stringify({
        fromAccountId: "anon-avant-google",
        lines: [{ id: "l1", productId: "p1", date: "2026-10-01", qty: 2 }],
      })
    );

    render(
      <StrictMode>
        <CartProvider>
          <Sonde />
        </CartProvider>
      </StrictMode>
    );

    await screen.findByText("1");
    expect(rows).toHaveLength(1);
  });
});

// Spec 42 — les eventos non réservables notés dans Mi viaje (`trip_events`).
describe("CartContext — eventos notés sans réservation (spec 42)", () => {
  beforeEach(() => {
    getSession.mockClear();
    signInAnonymously.mockReset();
    currentSession = null;
    rows = [];
    filasEventos = [];
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
  });

  it("aucune session → UNE session anonyme, puis l'evento est noté sous elle", async () => {
    signInAnonymously.mockImplementation(() => {
      currentSession = { user: { id: "anon-evt" } };
      return Promise.resolve({ data: { session: currentSession }, error: null });
    });
    render(
      <CartProvider>
        <Sonde />
      </CartProvider>
    );
    fireEvent.click(screen.getByText("noter"));
    await screen.findByText("true");
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
    expect(filasEventos).toEqual([
      { id: "evt-1", account_id: "anon-evt", product_id: "evt-p1", date: "2099-01-01" },
    ]);
    expect(screen.getByTestId("eventos").textContent).toBe("1");
  });

  it("le même evento à la même date une seconde fois : un succès, jamais une seconde ligne", async () => {
    currentSession = { user: { id: "u1" } };
    filasEventos = [{ id: "evt-0", account_id: "u1", product_id: "evt-p1", date: "2099-01-01" }];
    render(
      <CartProvider>
        <Sonde />
      </CartProvider>
    );
    fireEvent.click(screen.getByText("noter"));
    await screen.findByText("true");
    expect(filasEventos).toHaveLength(1);
  });

  it("un evento déjà passé (date de Guatapé) n'est ni lu ni compté", async () => {
    currentSession = { user: { id: "u1" } };
    filasEventos = [
      { id: "evt-passe", account_id: "u1", product_id: "evt-p1", date: "2000-01-01" },
      { id: "evt-futur", account_id: "u1", product_id: "evt-p1", date: "2099-01-01" },
    ];
    render(
      <CartProvider>
        <Sonde />
      </CartProvider>
    );
    await screen.findByText("1", { selector: "[data-testid=eventos]" });
  });

  it("fusion post-OAuth : les eventos déposés suivent, même sans aucune ligne de panier", async () => {
    currentSession = { user: { id: "compte-reel" } };
    sessionStorage.setItem(
      PENDING_CART_MERGE_KEY,
      JSON.stringify({
        fromAccountId: "anon-avant-google",
        lines: [],
        events: [{ productId: "evt-p1", date: "2099-01-01" }],
      })
    );
    render(
      <CartProvider>
        <Sonde />
      </CartProvider>
    );
    await screen.findByText("1", { selector: "[data-testid=eventos]" });
    expect(rows).toHaveLength(0);
    expect(filasEventos).toEqual([
      { id: "evt-1", account_id: "compte-reel", product_id: "evt-p1", date: "2099-01-01" },
    ]);
  });
});
