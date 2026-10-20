import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages, type Locale } from "@/messages";
import { GoogleButton, OAuthSection } from "./GoogleButton";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// CE QUE CE FICHIER EXISTE POUR TENIR, et qui n'est vérifiable QUE par un test : le `next` transmis
// à Supabase porte la LOCALE COURANTE. Personne ne peut le voir à l'œil — il part dans une
// redirection vers un domaine tiers, et aucun identifiant Google n'est configuré sur cette machine.
// Ce dépôt a déjà payé cette faute DEUX fois : `SignupForm.tsx` (« un anglophone y arrivait en
// espagnol ») et la spec 33 (les `back_urls` de paiement figées sur `/es`). La 3e rougit ici.
//
// Le rendu du bouton react-aria lui-même (focus, pending, cible tactile) appartient à
// `atoms/Button.test.tsx` et n'est pas retesté.

type AppelOAuth = { provider: string; options?: { redirectTo?: string } };
let appels: AppelOAuth[] = [];
let erreurOAuth: { message: string } | null = null;
// Panier anonyme courant, tel que `useCart()` le rendrait — vide par défaut (comportement inchangé
// des tests existants), écrasé par les tests du dépôt de panier avant Google (2026-09-14).
let lignesPanier: { id: string; productId: string; date: string; qty: number }[] = [];
let sessionAnonyme: { user: { id: string } } | null = { user: { id: "anon-1" } };
// Spec 42 : eventos notés courants, vides par défaut.
let eventosViaje: { id: string; productId: string; date: string }[] = [];

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: sessionAnonyme } }),
      signInWithOAuth: (input: AppelOAuth) => {
        appels.push(input);
        return Promise.resolve({ data: { url: null, provider: "google" }, error: erreurOAuth });
      },
    },
  }),
}));

// `useCart` neutralisé : le rendu du bouton react-aria et le préfixage de locale ne dépendent pas
// du panier — seuls les tests dédiés du dépôt sessionStorage (2026-09-14) le font varier.
// `PENDING_CART_MERGE_KEY` reste la VRAIE constante (jamais recopiée) : un import réel à côté du
// mock, pas une chaîne dupliquée qui pourrait diverger silencieusement.
const { PENDING_CART_MERGE_KEY: CLE_DEPOT_PANIER } = await vi.importActual<
  typeof import("@/lib/cart/CartContext")
>("@/lib/cart/CartContext");
vi.mock("@/lib/cart/CartContext", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/lib/cart/CartContext")>();
  return { ...reel, useCart: () => ({ lines: lignesPanier, tripEvents: eventosViaje }) };
});

function rendre(element: React.ReactElement, locale: Locale = "es") {
  const { container } = render(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
      {element}
    </NextIntlClientProvider>
  );
  return container;
}

async function presser(container: HTMLElement) {
  const bouton = container.querySelector("button") as HTMLButtonElement;
  await act(async () => {
    fireEvent.click(bouton);
  });
  return bouton;
}

/** Le `next` réellement transmis à Supabase, extrait du `redirectTo` du dernier appel. */
function nextTransmis() {
  const redirectTo = appels.at(-1)?.options?.redirectTo;
  if (!redirectTo) throw new Error("aucun redirectTo transmis à signInWithOAuth");
  return new URL(redirectTo);
}

beforeEach(() => {
  appels = [];
  erreurOAuth = null;
  lignesPanier = [];
  eventosViaje = [];
  sessionAnonyme = { user: { id: "anon-1" } };
  sessionStorage.clear();
});

describe("GoogleButton", () => {
  it("demande le provider google et revient par /auth/callback", async () => {
    await presser(rendre(<GoogleButton />));

    expect(appels.length).toBe(1);
    expect(appels[0].provider).toBe("google");
    expect(nextTransmis().pathname).toBe("/auth/callback");
  });

  it("PRÉFIXE le next de la locale lue — un anglophone ne doit pas revenir en espagnol", async () => {
    await presser(rendre(<GoogleButton next="/cuenta/reservas" />, "en"));

    expect(nextTransmis().searchParams.get("next")).toBe("/en/cuenta/reservas");
  });

  it("préfixe aussi la racine, sans produire de double slash", async () => {
    await presser(rendre(<GoogleButton />, "es"));

    expect(nextTransmis().searchParams.get("next")).toBe("/es");
  });

  it("annonce l'échec et REND LE BOUTON, au lieu de rester bloqué sur « Redirigiendo »", async () => {
    erreurOAuth = { message: "provider indisponible" };
    const container = rendre(<GoogleButton />);
    const bouton = await presser(container);

    const alerte = container.querySelector('[role="alert"]');
    expect(alerte?.textContent).toBe(loadMessages("es").Common.oauth.googleError);
    expect(alerte?.getAttribute("data-testid")).toBe("google-signin-button-error");
    expect(bouton.textContent).toContain(loadMessages("es").Common.oauth.google);
  });

  it("traduit son échec, comme tout le reste de la vitrine", async () => {
    erreurOAuth = { message: "provider indisponible" };
    const container = rendre(<GoogleButton />, "en");
    await presser(container);

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      loadMessages("en").Common.oauth.googleError
    );
  });

  // ⚠️ Le complément qui compte : en cas de SUCCÈS le navigateur est DÉJÀ en train de partir vers
  // Google. Rendre le bouton à son état normal ferait clignoter l'écran et inviterait un second
  // clic pendant la navigation.
  it("reste en cours après un succès — la page est en train de partir", async () => {
    const container = rendre(<GoogleButton />);
    const bouton = await presser(container);

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(bouton.textContent).toContain(loadMessages("es").Common.oauth.googleRedirecting);
  });

  // Retour Jérôme (2026-09-14) : un panier anonyme partait perdu à la connexion Google — aucun état
  // React ne survit à la redirection pleine page vers accounts.google.com, `sessionStorage` si
  // (consommé par CartContext.tsx au retour, voir son propre commentaire).
  describe("dépôt du panier avant la redirection (2026-09-14)", () => {
    it("dépose le panier anonyme dans sessionStorage AVANT de partir vers Google", async () => {
      lignesPanier = [{ id: "l1", productId: "p1", date: "2026-10-01", qty: 2 }];
      await presser(rendre(<GoogleButton />));

      const brut = sessionStorage.getItem(CLE_DEPOT_PANIER);
      expect(brut).not.toBeNull();
      expect(JSON.parse(brut!)).toEqual({ fromAccountId: "anon-1", lines: lignesPanier, events: [] });
    });

    it("spec 42 : dépose aussi les eventos notés, même sans aucune ligne de panier", async () => {
      eventosViaje = [{ id: "e1", productId: "evt-1", date: "2099-01-01" }];
      await presser(rendre(<GoogleButton />));

      const brut = sessionStorage.getItem(CLE_DEPOT_PANIER);
      expect(JSON.parse(brut!)).toEqual({
        fromAccountId: "anon-1",
        lines: [],
        events: [{ productId: "evt-1", date: "2099-01-01" }],
      });
    });

    it("ne dépose rien quand le panier anonyme est vide", async () => {
      await presser(rendre(<GoogleButton />));
      expect(sessionStorage.getItem(CLE_DEPOT_PANIER)).toBeNull();
    });

    it("ne dépose rien sans session lisible, même avec des lignes en mémoire", async () => {
      sessionAnonyme = null;
      lignesPanier = [{ id: "l1", productId: "p1", date: "2026-10-01", qty: 2 }];
      await presser(rendre(<GoogleButton />));
      expect(sessionStorage.getItem(CLE_DEPOT_PANIER)).toBeNull();
    });
  });
});

describe("OAuthSection", () => {
  it("rend le bouton et son séparateur traduit", async () => {
    const container = rendre(<OAuthSection next="/mi-viaje" />);

    expect(container.querySelector('[data-testid="google-signin-button"]')).not.toBeNull();
    expect(container.textContent).toContain(loadMessages("es").Common.oauth.separator);
  });

  // Le séparateur est décoratif : un lecteur d'écran qui annoncerait « o » entre un bouton et un
  // champ email n'apprend rien à personne, et `role="separator"` aurait de toute façon rendu son
  // contenu présentationnel. `aria-hidden` dit la même chose sans prétendre au contraire.
  it("masque le séparateur aux technologies d'assistance", () => {
    const container = rendre(<OAuthSection />);
    // Ciblé par la STRUCTURE et non par `[aria-hidden="true"]` : l'atome `Button` enveloppe déjà
    // son icône dans un span `aria-hidden`, qui vient avant dans le document — un querySelector
    // large rendrait le logo (textContent vide) et ce test passerait pour la mauvaise raison.
    const bloc = container.firstElementChild as HTMLElement;
    const separateur = bloc.lastElementChild as HTMLElement;

    expect(separateur.getAttribute("aria-hidden")).toBe("true");
    expect(separateur.textContent).toBe(loadMessages("es").Common.oauth.separator);
  });

  it("transmet le next au bouton", async () => {
    await presser(rendre(<OAuthSection next="/mi-viaje" />, "en"));

    expect(nextTransmis().searchParams.get("next")).toBe("/en/mi-viaje");
  });
});
