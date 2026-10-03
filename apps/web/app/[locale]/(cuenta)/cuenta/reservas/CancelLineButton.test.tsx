import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages, type Locale } from "@/messages";
import { CancelLineButton } from "./CancelLineButton";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// CE QUE CE FICHIER EXISTE POUR TENIR, et rien d'autre : la confirmation annonce que TOUTE la
// réservation sera annulée quand c'est la dernière prestation active, et se tait sinon. C'est un
// état dérivé d'une prop, invisible au typecheck, et c'est une exigence explicite de la décision ⑤
// — un client qui croit retirer une activité et annule son séjour entier n'aurait aucun recours
// (une annulation n'est ni remboursée ni réversible).
//
// Le reste du composant est de l'affichage et appartient à `atoms/Button.test.tsx` : le rendu du
// bouton react-aria, `isPending`, la cible tactile. Non retesté ici (règle de proportionnalité,
// .claude/rules/tests.md).
//
// ⚠️ Une assertion de plus est gardée, et une seule : que la confirmation ne CHIFFRE jamais le
// montant (décision ⑧). Elle ne vaudrait rien si elle relisait la chaîne du fichier de messages —
// elle vérifie donc l'absence de tout chiffre suivi d'un séparateur de milliers dans le bloc rendu.

// La réponse de la RPC, réglable par test (`vi.hoisted` : le mock est remonté avant les imports).
const reponse = vi.hoisted(() => ({
  valeur: { data: { ok: true, remaining_active_lines: 0 } as unknown, error: null as unknown },
}));

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({
    rpc: () => Promise.resolve(reponse.valeur),
  }),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

function rendre(isLastActiveLine: boolean, locale: Locale = "es") {
  const { container } = render(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
      <CancelLineButton
        lineId="11111111-1111-4111-8111-111111111111"
        productName="Kayak Guatapé"
        dateLabel="2026-11-01"
        isLastActiveLine={isLastActiveLine}
        testId="cancel-line-x"
      />
    </NextIntlClientProvider>
  );
  return container;
}

async function ouvrirLaConfirmation(container: HTMLElement) {
  const bouton = container.querySelector('[data-testid="cancel-line-x"]') as HTMLButtonElement;
  await act(async () => {
    fireEvent.click(bouton);
  });
}

describe("CancelLineButton", () => {
  it("prévient que toute la réservation sera annulée quand c'est la dernière prestation active", async () => {
    const container = rendre(true);
    await ouvrirLaConfirmation(container);
    expect(container.querySelector('[data-testid="cancel-line-x-last-line"]')).not.toBeNull();
  });

  it("ne le prévient PAS quand d'autres prestations restent actives", async () => {
    const container = rendre(false);
    await ouvrirLaConfirmation(container);
    expect(container.querySelector('[data-testid="cancel-line-x-last-line"]')).toBeNull();
  });

  it("n'affiche aucune confirmation tant que le bouton n'a pas été pressé", () => {
    const container = rendre(true);
    expect(container.querySelector('[data-testid="cancel-line-x-confirm"]')).toBeNull();
  });

  // Décision ⑧ : on dit que l'acompte n'est pas remboursé, on ne chiffre pas la perte.
  it("ne chiffre jamais le montant perdu dans la confirmation", async () => {
    const container = rendre(false);
    await ouvrirLaConfirmation(container);
    const bloc = container.querySelector('[data-testid="cancel-line-x-confirm"]') as HTMLElement;
    // Un montant COP rendu porterait forcément un séparateur de milliers (Intl, es-CO) : « 13.600 ».
    expect(/\d[.\s ]\d{3}/.test(bloc.textContent ?? "")).toBe(false);
  });

  // Le bloc remplace le bouton à sa place : sans rôle d'alerte, un lecteur d'écran ne dirait rien.
  it("annonce la confirmation (role=alert) et la retire quand on répond « No »", async () => {
    const container = rendre(false);
    await ouvrirLaConfirmation(container);
    const bloc = container.querySelector('[data-testid="cancel-line-x-confirm"]') as HTMLElement;
    expect(bloc.getAttribute("role")).toBe("alert");

    const non = container.querySelector('[data-testid="cancel-line-x-no"]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(non);
    });
    expect(container.querySelector('[data-testid="cancel-line-x-confirm"]')).toBeNull();
    expect(container.querySelector('[data-testid="cancel-line-x"]')).not.toBeNull();
  });

  // Défaut connu n° 4, corrigé par le plan 41, P8 : l'échec ne s'affichait qu'après « No ». Il
  // doit apparaître dès la réponse, la confirmation restant ouverte pour réessayer.
  it("affiche l'échec dès la réponse, sans qu'il faille répondre « No »", async () => {
    reponse.valeur = { data: { ok: false, reason: "line_not_active" }, error: null };
    try {
      const container = rendre(false);
      await ouvrirLaConfirmation(container);
      const oui = container.querySelector('[data-testid="cancel-line-x-yes"]') as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(oui);
      });
      expect(container.querySelector('[data-testid="cancel-line-x-confirm"]')).not.toBeNull();
      const erreur = container.querySelector('[data-testid="cancel-line-x-error"]');
      expect(erreur?.getAttribute("role")).toBe("alert");
    } finally {
      reponse.valeur = { data: { ok: true, remaining_active_lines: 0 }, error: null };
    }
  });
});
