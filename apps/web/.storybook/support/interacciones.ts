import { userEvent, waitFor } from "storybook/test";

// Gestes des `play` des stories d'écran (2026-10-01). Une page est un Server Component asynchrone :
// au premier passage du `play`, elle peut ne pas être encore rendue — d'où l'attente systématique
// de l'élément visé avant chaque geste, plutôt qu'un `querySelector` qui rendrait `null`.
//
// Les sélecteurs sont ceux des e2e Playwright (`data-testid`, `name=`) : ce sont déjà les contrats
// stables de l'écran, et un `play` qui casse signale le même changement que l'e2e casserait.

export async function esperar<T extends Element = HTMLElement>(raiz: HTMLElement, selector: string): Promise<T> {
  return waitFor(
    () => {
      const elemento = raiz.querySelector<T>(selector);
      if (!elemento) throw new Error(`Élément introuvable : ${selector}`);
      return elemento;
    },
    { timeout: 5000 }
  );
}

export async function escribir(raiz: HTMLElement, selector: string, texto: string) {
  const campo = await esperar<HTMLInputElement>(raiz, selector);
  await userEvent.clear(campo);
  await userEvent.type(campo, texto);
}

export async function pulsar(raiz: HTMLElement, selector: string) {
  await userEvent.click(await esperar(raiz, selector));
}

// Bouton « mois suivant » du calendrier (react-day-picker). Ses libellés sont ceux de la locale
// passée au calendrier — en anglais aujourd'hui, faute de locale (défaut connu, `Calendar.tsx`).
// Les deux langues sont acceptées pour que ce `play` survive au jour où la locale sera branchée.
const MES_SIGUIENTE = 'button[aria-label*="Next" i], button[aria-label*="siguiente" i]';

/**
 * Clique le jour `iso` du calendrier. Les fixtures datent RELATIVEMENT à aujourd'hui : en fin de
 * mois, le jour visé tombe sur le mois suivant — on avance alors d'un mois (deux au plus).
 */
export async function pulsarDia(raiz: HTMLElement, iso: string) {
  await esperar(raiz, "[data-date]");
  for (let intento = 0; intento < 3; intento += 1) {
    const dia = raiz.querySelector<HTMLElement>(`[data-date="${iso}"]`);
    if (dia) {
      await userEvent.click(dia);
      return;
    }
    await pulsar(raiz, MES_SIGUIENTE);
  }
  throw new Error(`Jour ${iso} introuvable dans le calendrier`);
}
