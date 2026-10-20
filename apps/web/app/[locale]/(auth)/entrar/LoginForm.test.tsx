import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages, type Locale } from "@/messages";
import { LoginForm } from "./LoginForm";

// Retour Jérôme (2026-09-14) : un panier ajouté en visiteur (session anonyme) disparaissait après
// connexion vers un compte réel déjà existant — cart_items est scopé par account_id, et
// signInWithPassword bascule auth.uid() sur une identité totalement différente, sans aucun
// rattrapage (contrairement aux commandes déjà passées, rattachées elles à l'INSCRIPTION par
// attach_orders_to_account). Ce fichier prouve que LoginForm lit le panier AVANT de basculer
// d'identité et le réinsère APRÈS, sous le nouveau compte.

const ANON_LINES = [
  { product_id: "p1", date: "2026-10-01", end_date: null, slot_start_time: "09:00:00", qty: 2 },
];

let cartItemsSelectResult: { data: typeof ANON_LINES | null; error: unknown } = {
  data: ANON_LINES,
  error: null,
};
let signInResult: { error: unknown } = { error: null };
let sessionAfterSignIn: { user: { id: string } } | null = { user: { id: "compte-reel-1" } };
let insertCalls: unknown[][] = [];
// Spec 42 : les eventos notés suivent le panier. `gte` reçoit la borne « à venir ».
const ANON_EVENTS = [
  { product_id: "evt-1", date: "2099-01-01" },
  { product_id: "evt-2", date: "2099-02-01" },
];
let tripEventsSelectResult: { data: typeof ANON_EVENTS | null; error: unknown } = { data: [], error: null };
let tripEventsGte: string | null = null;
let eventInsertCalls: unknown[] = [];

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) =>
      table === "trip_events"
        ? {
            select: () => ({
              gte: (_col: string, desde: string) => {
                tripEventsGte = desde;
                return Promise.resolve(tripEventsSelectResult);
              },
            }),
            insert: (row: unknown) => {
              eventInsertCalls.push(row);
              return Promise.resolve({ data: null, error: null });
            },
          }
        : {
            select: () =>
              Promise.resolve(table === "cart_items" ? cartItemsSelectResult : { data: [], error: null }),
            insert: (rows: unknown[]) => {
              insertCalls.push(rows);
              return Promise.resolve({ data: null, error: null });
            },
          },
    auth: {
      signInWithPassword: () => Promise.resolve(signInResult),
      getSession: () => Promise.resolve({ data: { session: sessionAfterSignIn } }),
    },
  }),
}));

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Le bouton Google a ses propres dépendances (OAuth, icônes) et n'est pas le sujet ici — même
// raisonnement de neutralisation que ReservationForm.test.tsx pour ses composants voisins.
vi.mock("@/components/molecules/GoogleButton", () => ({ OAuthSection: () => null }));

function rendre(locale: Locale = "es") {
  const { container } = render(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
      <LoginForm next="/cuenta/reservas" />
    </NextIntlClientProvider>
  );
  return container;
}

async function soumettre(container: HTMLElement) {
  const email = container.querySelector('input[name="email"]') as HTMLInputElement;
  const password = container.querySelector('input[name="password"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(email, { target: { value: "gabriel@test.local" } });
    fireEvent.change(password, { target: { value: "secret1234" } });
  });
  await act(async () => {
    fireEvent.submit(container.querySelector("form")!);
  });
}

describe("LoginForm — transfert du panier anonyme au login", () => {
  beforeEach(() => {
    cartItemsSelectResult = { data: ANON_LINES, error: null };
    signInResult = { error: null };
    sessionAfterSignIn = { user: { id: "compte-reel-1" } };
    insertCalls = [];
    tripEventsSelectResult = { data: [], error: null };
    tripEventsGte = null;
    eventInsertCalls = [];
    pushMock.mockClear();
    refreshMock.mockClear();
  });

  it("réinsère les lignes lues AVANT signInWithPassword, sous le NOUVEAU compte", async () => {
    const container = rendre();
    await soumettre(container);

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toEqual([{ ...ANON_LINES[0], account_id: "compte-reel-1" }]);
    expect(pushMock).toHaveBeenCalledWith("/cuenta/reservas");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("n'insère rien quand le panier anonyme était vide — jamais une ligne fantôme", async () => {
    cartItemsSelectResult = { data: [], error: null };
    const container = rendre();
    await soumettre(container);

    expect(insertCalls).toHaveLength(0);
    expect(pushMock).toHaveBeenCalledWith("/cuenta/reservas");
  });

  it("un échec de connexion n'insère rien et ne navigue pas", async () => {
    signInResult = { error: { message: "invalid_credentials" } };
    const container = rendre();
    await soumettre(container);

    expect(insertCalls).toHaveLength(0);
    expect(pushMock).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="login-error"]')).not.toBeNull();
  });

  it("n'insère rien si la session n'est plus lisible juste après signInWithPassword", async () => {
    sessionAfterSignIn = null;
    const container = rendre();
    await soumettre(container);

    expect(insertCalls).toHaveLength(0);
    // La connexion elle-même n'est jamais bloquée par ce filet best-effort.
    expect(pushMock).toHaveBeenCalledWith("/cuenta/reservas");
  });

  it("spec 42 : recopie les eventos notés à venir, UN insert par evento, même sans panier", async () => {
    cartItemsSelectResult = { data: [], error: null };
    tripEventsSelectResult = { data: ANON_EVENTS, error: null };
    const container = rendre();
    await soumettre(container);

    expect(tripEventsGte).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(insertCalls).toHaveLength(0);
    expect(eventInsertCalls).toEqual([
      { account_id: "compte-reel-1", product_id: "evt-1", date: "2099-01-01" },
      { account_id: "compte-reel-1", product_id: "evt-2", date: "2099-02-01" },
    ]);
  });
});
