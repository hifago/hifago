import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages, type Locale } from "@/messages";
import { DeleteAccountSection } from "./DeleteAccountSection";

// Pas de @testing-library/jest-dom — assertions DOM natives (même règle que CancelLineButton.test.tsx).
//
// CE QUE CE FICHIER EXISTE POUR TENIR : la vérification d'email affichée ici NE PROTÈGE RIEN (le
// vrai contrôle est côté serveur, route.test.ts) — mais si elle ne bloquait plus l'envoi, `fetch`
// partirait pour n'importe quelle saisie, et personne ne le verrait avant un incident réel. Et la
// section bloquée par une capacité professionnelle ne doit JAMAIS afficher le flux de suppression,
// pas même déguisé derrière un clic supplémentaire — décision ⑪.

const EMAIL = "cliente@test.local";
let appelsSignOut = 0;
let signOutRejette = false;
let appelsRouterPush: string[] = [];

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signOut: async () => {
        appelsSignOut += 1;
        if (signOutRejette) throw new TypeError("Failed to fetch");
      },
    },
  }),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => { appelsRouterPush.push(href); },
    refresh: () => {},
  }),
}));

function rendre(hasProfessionalCapability: boolean, locale: Locale = "es") {
  const { container } = render(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
      <DeleteAccountSection email={EMAIL} hasProfessionalCapability={hasProfessionalCapability} />
    </NextIntlClientProvider>
  );
  return container;
}

/** Ouvre la confirmation, saisit un email et soumet — répété par trois des quatre tests. */
async function ouvrirSaisirEtSoumettre(container: HTMLElement, emailSaisi: string) {
  await act(async () => {
    fireEvent.click(container.querySelector('[data-testid="delete-account-button"]') as HTMLButtonElement);
  });
  const champ = container.querySelector('[data-testid="delete-account-email-input"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(champ, { target: { value: emailSaisi } });
    fireEvent.submit(container.querySelector('[data-testid="delete-account-confirm"]') as HTMLFormElement);
  });
}

describe("DeleteAccountSection", () => {
  beforeEach(() => {
    appelsSignOut = 0;
    signOutRejette = false;
    appelsRouterPush = [];
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("un compte professionnel ne voit JAMAIS le bouton de suppression", () => {
    const container = rendre(true);
    expect(container.querySelector('[data-testid="delete-account-button"]')).toBeNull();
    expect(container.querySelector('[data-testid="delete-blocked-capability"]')).not.toBeNull();
  });

  it("un email qui ne correspond pas bloque l'envoi — fetch n'est JAMAIS appelé", async () => {
    const container = rendre(false);
    await ouvrirSaisirEtSoumettre(container, "autre@test.local");

    expect(container.querySelector('[data-testid="delete-account-mismatch"]')).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(appelsSignOut).toBe(0);
  });

  it("un email qui correspond envoie la requête, puis déconnecte et redirige vers l'accueil", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
    const container = rendre(false);
    await ouvrirSaisirEtSoumettre(container, EMAIL.toUpperCase());

    expect(fetch).toHaveBeenCalledWith(
      "/api/account/delete",
      expect.objectContaining({ method: "POST" })
    );
    expect(appelsSignOut).toBe(1);
    expect(appelsRouterPush).toEqual(["/"]);
  });

  it("un échec serveur affiche une erreur et ne déconnecte PAS", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    const container = rendre(false);
    await ouvrirSaisirEtSoumettre(container, EMAIL);

    expect(container.querySelector('[data-testid="delete-account-error"]')).not.toBeNull();
    expect(appelsSignOut).toBe(0);
  });

  it("une panne réseau affiche l'erreur et rend la main — jamais un bouton bloqué en attente", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    const container = rendre(false);
    await ouvrirSaisirEtSoumettre(container, EMAIL);

    expect(container.querySelector('[data-testid="delete-account-error"]')).not.toBeNull();
    const non = container.querySelector('[data-testid="delete-account-confirm-no"]') as HTMLButtonElement;
    expect(non.disabled).toBe(false);
    expect(appelsSignOut).toBe(0);
  });

  it("une suppression réussie redirige vers l'accueil même si la déconnexion locale échoue", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
    signOutRejette = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const container = rendre(false);
    await ouvrirSaisirEtSoumettre(container, EMAIL);

    expect(appelsSignOut).toBe(1);
    expect(appelsRouterPush).toEqual(["/"]);
  });
});
