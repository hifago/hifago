import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { loadMessages, type Locale } from "@/messages";
import { CancelLineButton } from "./CancelLineButton";
import { CancellationOutcomesProvider } from "./CancellationOutcomes";

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

const routeur = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => routeur,
}));

beforeEach(() => {
  routeur.refresh.mockClear();
  reponse.valeur = { data: { ok: true, remaining_active_lines: 0 }, error: null };
});

type Options = { locale?: Locale; cancellable?: boolean; depositRetained?: boolean };

function bouton(isLastActiveLine: boolean, { cancellable = true, depositRetained = true }: Options = {}) {
  return (
    <CancelLineButton
      lineId="11111111-1111-4111-8111-111111111111"
      productName="Kayak Guatapé"
      dateLabel="2026-11-01"
      isLastActiveLine={isLastActiveLine}
      cancellable={cancellable}
      depositRetained={depositRetained}
      testId="cancel-line-x"
    />
  );
}

/** La page : le fournisseur au-dessus, le bouton dans le groupe « à venir » ou « passées ». */
function page(contenu: React.ReactNode, locale: Locale = "es") {
  return (
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
      <CancellationOutcomesProvider>{contenu}</CancellationOutcomesProvider>
    </NextIntlClientProvider>
  );
}

function element(isLastActiveLine: boolean, options: Options = {}) {
  return page(<section data-testid="grupo-proximas">{bouton(isLastActiveLine, options)}</section>, options.locale);
}

function rendre(isLastActiveLine: boolean, options: Options = {}) {
  return render(element(isLastActiveLine, options)).container;
}

async function confirmer(container: HTMLElement) {
  await ouvrirLaConfirmation(container);
  const oui = container.querySelector('[data-testid="cancel-line-x-yes"]') as HTMLButtonElement;
  await act(async () => {
    fireEvent.click(oui);
  });
}

const texte = (container: HTMLElement, testId: string) =>
  container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? null;

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
  it("panne : l'échec s'affiche dès la réponse, la confirmation reste ouverte pour réessayer", async () => {
    reponse.valeur = { data: null, error: { message: "fetch failed" } };
    const container = rendre(false);
    await confirmer(container);
    expect(container.querySelector('[data-testid="cancel-line-x-confirm"]')).not.toBeNull();
    const erreur = container.querySelector('[data-testid="cancel-line-x-error"]');
    expect(erreur?.getAttribute("role")).toBe("alert");
    expect(erreur?.textContent).toBe("No se pudo anular. Inténtalo de nuevo.");
  });

  // Un texte par motif de refus de cancel_order_line, au lieu de l'erreur générique.
  it.each([
    ["line_not_found", "No encontramos esta prestación en tu cuenta."],
    ["not_authenticated", "Tu sesión expiró. Vuelve a iniciar sesión para anular."],
    ["anonymous_session", "Tu sesión expiró. Vuelve a iniciar sesión para anular."],
    ["motif_inconnu", "No se pudo anular. Inténtalo de nuevo."],
  ])("refus %s : son texte", async (reason, message) => {
    reponse.valeur = { data: { ok: false, reason }, error: null };
    const container = rendre(false);
    await confirmer(container);
    expect(texte(container, "cancel-line-x-error")).toBe(message);
  });

  it("statut changé entre-temps (line_not_active) : le dit, ferme la confirmation et relit la base", async () => {
    reponse.valeur = { data: { ok: false, reason: "line_not_active" }, error: null };
    const container = rendre(false);
    await confirmer(container);
    expect(texte(container, "cancel-line-x-error")).toBe("Esta prestación ya no se puede anular: su estado cambió.");
    expect(container.querySelector('[data-testid="cancel-line-x-confirm"]')).toBeNull();
    expect(routeur.refresh).toHaveBeenCalledTimes(1);
  });

  // « L'acompte payé n'est pas rendu » n'est vrai que s'il a été encaissé.
  it("commande encaissée : la confirmation dit que l'acompte n'est pas rendu", async () => {
    const container = rendre(false, { depositRetained: true });
    await ouvrirLaConfirmation(container);
    expect(texte(container, "cancel-line-x-no-refund")).toBe("El anticipo pagado no se devuelve.");
  });

  it("commande impayée : la confirmation ne parle d'aucun acompte", async () => {
    const container = rendre(false, { depositRetained: false });
    await ouvrirLaConfirmation(container);
    expect(container.querySelector('[data-testid="cancel-line-x-no-refund"]')).toBeNull();
    expect(texte(container, "cancel-line-x-confirm")).not.toContain("anticipo");
  });

  it("ligne non annulable (décidé en base) : aucun bouton", () => {
    const container = rendre(false, { cancellable: false });
    expect(container.querySelector('[data-testid="cancel-line-x"]')).toBeNull();
    expect(container.textContent).toBe("");
  });

  // Décision de Gabriel : le client doit savoir que l'annulation a eu lieu — et le message doit
  // survivre au rafraîchissement, où la ligne devient non annulable.
  it("annulation faite : message de confirmation, qui reste quand la ligne devient non annulable", async () => {
    reponse.valeur = { data: { ok: true, remaining_active_lines: 2 }, error: null };
    const rendu = render(element(false));
    await confirmer(rendu.container);
    expect(texte(rendu.container, "cancel-line-x-done")).toBe("Anulaste « Kayak Guatapé » del 2026-11-01.");
    expect(rendu.container.querySelector('[data-testid="cancel-line-x-done"]')?.getAttribute("role")).toBe("status");
    expect(routeur.refresh).toHaveBeenCalledTimes(1);

    rendu.rerender(element(false, { cancellable: false }));
    expect(texte(rendu.container, "cancel-line-x-done")).toBe("Anulaste « Kayak Guatapé » del 2026-11-01.");
    expect(rendu.container.querySelector('[data-testid="cancel-line-x"]')).toBeNull();
  });

  it("dernière prestation annulée : le message dit qu'il n'en reste aucune en attente", async () => {
    reponse.valeur = { data: { ok: true, remaining_active_lines: 0 }, error: null };
    const container = rendre(true);
    await confirmer(container);
    expect(texte(container, "cancel-line-x-done")).toContain("Ya no queda ninguna prestación pendiente en esta reserva.");
  });

  it("autre prestation encore active : le message ne parle que de celle-ci", async () => {
    reponse.valeur = { data: { ok: true, remaining_active_lines: 1 }, error: null };
    const container = rendre(false);
    await confirmer(container);
    expect(texte(container, "cancel-line-x-done")).not.toContain("ninguna prestación pendiente");
  });

  // La commande dont la dernière prestation à venir est annulée passe dans le groupe « passées » :
  // sa carte est démontée et remontée ailleurs. Le message doit survivre au déplacement.
  it("la carte change de groupe après l'annulation : le message survit au remontage", async () => {
    reponse.valeur = { data: { ok: true, remaining_active_lines: 0 }, error: null };
    const rendu = render(page(<section data-testid="grupo-proximas">{bouton(true)}</section>));
    await confirmer(rendu.container);
    rendu.rerender(
      page(
        <>
          <section data-testid="grupo-proximas" />
          <section data-testid="grupo-pasadas">{bouton(true, { cancellable: false })}</section>
        </>
      )
    );
    const pasadas = rendu.container.querySelector('[data-testid="grupo-pasadas"]') as HTMLElement;
    expect(texte(pasadas, "cancel-line-x-done")).toContain("Anulaste « Kayak Guatapé »");
  });

  it("sans le fournisseur de la page : erreur au rendu, jamais un message perdu en silence", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <NextIntlClientProvider locale="es" messages={loadMessages("es")}>
          {bouton(false)}
        </NextIntlClientProvider>
      )
    ).toThrow(/CancellationOutcomesProvider/);
    vi.restoreAllMocks();
  });
});
