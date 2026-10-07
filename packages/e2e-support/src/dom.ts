import type { Locator, Page } from "@playwright/test";

/**
 * Helpers pour les particularités DOM de HeroUI v3 (react-aria-components), différentes de
 * l'ancien socle base-ui/shadcn — centralisées ici pour ne pas ré-découvrir ces trois points par
 * fichier de spec au fil de la migration.
 */

// La valeur affichée d'un Select HeroUI — à utiliser pour toute assertion de contenu scopée au
// statut sélectionné. Le <select> natif cf. gardé par HeroUI (fallback accessibilité/formulaire)
// liste TOUJOURS le texte de toutes les options possibles : une assertion `toContainText`/
// `hasText` sur la ligne ou le composant entier matche n'importe quel statut, sélectionné ou non.
export function selectValue(scope: Locator) {
  return scope.locator('[data-slot="select-value"]');
}

// Le vrai <input type="checkbox" role="switch"> d'un Switch HeroUI est visuellement masqué
// (clip-path) et niché dans un <label> piloté par usePress (react-aria) — pas par le transfert
// natif label→input. locator.isChecked()/toBeChecked() exigent de cibler cet input directement.
export function switchInput(scope: Locator) {
  return scope.locator("input");
}

// Le clic, lui, vise `Switch.Content` (data-slot="switch-content", le SwitchButton react-aria : le
// <label> pressable qui porte la commande visible). Depuis HeroUI 3.2, la racine du Switch — celle
// qui reçoit le data-testid — est un SwitchField, une <div> de champ qui n'est PAS pressable :
// l'ancien `scope.click({ force: true })` frappait le centre de cette div, à côté du label, et la
// bascule n'avait jamais lieu (onChange jamais appelé, aucune requête — diagnostic du 2026-10-07 sur
// admin-partner-registry). Clic normal, sans `force` : Playwright vérifie que la commande est
// visible et reçoit bien le clic, au lieu de frapper à l'aveugle.
export async function toggleSwitch(scope: Locator) {
  await scope.locator('[data-slot="switch-content"]').click();
}

// Piège distinct du Switch ci-dessus (constaté 2026-08-14, feature 26 — admin-partner-create.
// spec.ts) : le Checkbox HeroUI v3 n'enregistre un clic QUE sur son <input> réel — cliquer le
// wrapper racine (même avec { force: true }, ce qui suffit pour Switch) laisse l'état inchangé
// SANS lever d'erreur Playwright, un piège silencieux facile à manquer si le test n'affirme pas
// l'état obtenu côté serveur après coup. Toujours cibler .locator("input") pour le clic lui-même,
// pas seulement pour l'assertion.
export function checkboxInput(scope: Locator) {
  return scope.locator("input");
}

export async function toggleCheckbox(scope: Locator) {
  await scope.locator("input").click({ force: true });
}

// Assistant par étapes (docs/specs/40) — `ProductForm`/`NewEstablishmentForm` affichent un vrai
// wizard en création : avancer d'étape n'existait pas avant ce chantier, centralisé ici plutôt que
// répété dans chaque spec produit/établissement.
export async function goToNextWizardStep(page: Page) {
  await page.getByTestId("wizard-next-button").click();
}

// Écran de confirmation (docs/specs/40 §4) — remplace l'ancien `toast.success` + redirect
// immédiat : le clic sur son action déclenche maintenant le `router.push` différé. `testId` est
// celui passé à `<ActionConfirmation testId="…">` par l'appelant (ex. "product-form-confirmation",
// "establishment-form-confirmation").
export async function confirmAndContinue(page: Page, testId: string) {
  await page.getByTestId(`${testId}-action`).click();
}
