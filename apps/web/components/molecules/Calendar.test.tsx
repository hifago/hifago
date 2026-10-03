import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import {
  Calendar,
  CLASSE_CADRE_CALENDRIER,
  CLASSNAMES_CALENDRIER,
  localeCalendrier,
  type CalendarLibelles,
  type CalendarProps,
  type JourCalendrier,
  type PlageCalendrier,
} from "./Calendar";

// Pas de @testing-library/jest-dom dans ce monorepo — assertions DOM natives uniquement.
//
// Ce que ces tests protègent, et pourquoi ça ne peut pas être « rien » (CLAUDE.md §6.5) : la
// frontière métier / interface. Le composant ne doit JAMAIS décider qu'un jour est complet ni quel
// jour est aujourd'hui — s'il se mettait à le déduire, rien à l'écran ne changerait, et les règles
// de réservation prouvées dans LodgingReservationForm auraient un second juge silencieux.
//
// ⚠️ PIÈGE VÉRIFIÉ DE CE DÉPÔT (2026-08-21) : un modificateur de react-day-picker s'applique au
// `<td>`, jamais au `<button>`. Un test qui cherche la classe « nuit pleine » sur le bouton ne la
// trouve jamais. Ce fichier vise donc explicitement l'un ou l'autre — et c'est ce qui a révélé que
// le `line-through` posé par le formulaire de production ne barre rien du tout (le numéro du jour
// vit dans le bouton, et la décoration de texte ne traverse pas un contrôle de formulaire).

const AUJOURDHUI = "2026-09-15";
const LIBELLES: CalendarLibelles = {
  complet: "Completo",
  selectionne: "seleccionado",
  aujourdhui: "hoy",
};

function jours(): JourCalendrier[] {
  return [
    { date: "2026-09-21", etat: "complet" },
    { date: "2026-09-10", etat: "desactive" },
    { date: "2026-09-17", etat: "disponible", etiquette: "2", description: "quedan 2 lugares" },
  ];
}

// ⚠️ UN seul cast, à l'endroit où l'union discriminée de `CalendarProps` se réunifie. La version
// d'avant castait les SURCHARGES en `Record<string, never>` — « un objet sans aucune propriété » —
// ce qui faisait taire l'erreur du spread mais aussi n'importe quelle faute de frappe de test.
function rendu(props: Partial<CalendarProps> = {}) {
  const base = {
    mode: "range",
    valeur: null,
    onValeurChange: () => {},
    jours: jours(),
    aujourdIso: AUJOURDHUI,
    libelles: LIBELLES,
    moisAffiche: { valeur: "2026-09-01", onChange: () => {} },
    testId: "cal",
  };
  const { container } = render(<Calendar {...({ ...base, ...props } as CalendarProps)} />);
  const td = (iso: string) => container.querySelector<HTMLElement>(`td[data-day="${iso}"]`)!;
  const bouton = (iso: string) => td(iso).querySelector("button")!;
  return { container, td, bouton };
}

describe("Calendar — l'appelant décide de l'état de chaque jour", () => {
  it("désactive exactement les jours que l'appelant a déclarés non disponibles", () => {
    const { bouton } = rendu();
    expect(bouton("2026-09-21").disabled).toBe(true); // complet
    expect(bouton("2026-09-10").disabled).toBe(true); // désactivé
    expect(bouton("2026-09-17").disabled).toBe(false); // disponible
    expect(bouton("2026-09-23").disabled).toBe(false); // absent de `jours` → etatParDefaut
  });

  it("applique `etatParDefaut` aux dates dont l'appelant n'a rien dit (échec fermé possible)", () => {
    const { bouton } = rendu({ jours: [], etatParDefaut: "desactive" });
    expect(bouton("2026-09-23").disabled).toBe(true);
    expect(bouton("2026-09-17").disabled).toBe(true);
  });

  it("ne rend jamais un jour complet sélectionnable, même au clic", () => {
    const onValeurChange = vi.fn();
    const { bouton } = rendu({ onValeurChange });
    fireEvent.click(bouton("2026-09-21"));
    expect(onValeurChange).not.toHaveBeenCalled();
    fireEvent.click(bouton("2026-09-17"));
    expect(onValeurChange).toHaveBeenCalledTimes(1);
  });
});

describe("Calendar — « complet » se voit sans la couleur", () => {
  it("pose le modificateur sur le <td> ET le barré sur le <button>", () => {
    const { td, bouton } = rendu();
    // Le modificateur : sur la CASE. C'est tout ce que react-day-picker sait atteindre.
    expect(td("2026-09-21").className).toContain("opacity-100");
    expect(td("2026-09-21").className).toContain("text-foreground");
    // ⚠️ LE point de non-régression : le barré doit être sur le BOUTON, parce que c'est lui qui
    // contient le numéro du jour. Posé sur la case, il ne barre rien — c'est ce que fait
    // aujourd'hui `LodgingReservationForm` (`modifiersClassNames.unavailable`).
    expect(bouton("2026-09-21").className).toContain("line-through");
    expect(td("2026-09-21").className).not.toContain("line-through");
    expect(bouton("2026-09-17").className).not.toContain("line-through");
  });

  it("annule l'estompe empilée qui rendait le numéro d'un jour éteint illisible", () => {
    const { td, bouton } = rendu();
    // 0,5 (le `<td>` du modificateur `disabled`) × 0,5 (le `disabled:opacity-50` du bouton) = 0,25.
    // Mesuré à 1,36–1,70:1 de contraste avant correctif, sur les cinq pistes.
    for (const iso of ["2026-09-21", "2026-09-10"]) {
      expect(td(iso).className).toContain("opacity-100");
      expect(bouton(iso).className).toContain("disabled:opacity-100");
    }
  });

  it("n'affiche la légende que lorsqu'un jour complet existe", () => {
    expect(rendu().container.querySelector('[data-testid="cal-legende"]')?.textContent).toContain(
      "Completo"
    );
    expect(
      rendu({ jours: [{ date: "2026-09-21", etat: "disponible" }] }).container.querySelector(
        '[data-testid="cal-legende"]'
      )
    ).toBeNull();
  });

  it("affiche l'étiquette dans la case et la reprend en toutes lettres dans le nom accessible", () => {
    const { bouton } = rendu();
    expect(bouton("2026-09-17").querySelector("span")?.textContent).toBe("2");
    // ⚠️ Un « 2 » sous un numéro de jour n'est qu'un second nombre pour un lecteur d'écran : le
    // nom accessible doit porter la phrase, pas le chiffre.
    expect(bouton("2026-09-17").getAttribute("aria-label")).toContain("quedan 2 lugares");
    expect(bouton("2026-09-21").getAttribute("aria-label")).toContain("Completo");
  });
});

describe("Calendar — les libellés viennent de l'appelant, jamais de la bibliothèque", () => {
  it("remplace les « Today, » et « , selected » que react-day-picker écrit en dur en anglais", () => {
    const { bouton } = rendu({ valeur: { debut: "2026-09-16", fin: "2026-09-19" } });
    const aujourdhui = bouton(AUJOURDHUI).getAttribute("aria-label")!;
    expect(aujourdhui).toContain("hoy");
    expect(aujourdhui).not.toContain("Today");
    const selectionne = bouton("2026-09-16").getAttribute("aria-label")!;
    expect(selectionne).toContain("seleccionado");
    expect(selectionne).not.toContain("selected");
  });
});

describe("Calendar — la date du jour est une PROP, pas l'horloge de la machine", () => {
  it("marque comme aujourd'hui la date reçue, et elle seule", () => {
    const { td } = rendu({ aujourdIso: "2026-09-03" });
    expect(td("2026-09-03").getAttribute("data-today")).toBe("true");
    expect(td(AUJOURDHUI).getAttribute("data-today")).toBe(null);
  });
});

describe("Calendar — la frontière est en dates civiles ISO, jamais en objets Date", () => {
  it("rend la plage sélectionnée puis renvoie des chaînes yyyy-MM-dd", () => {
    function Harnais() {
      const [valeur, setValeur] = useState<PlageCalendrier | null>({
        debut: "2026-09-16",
        fin: "2026-09-19",
      });
      return (
        <>
          <Calendar
            mode="range"
            valeur={valeur}
            onValeurChange={setValeur}
            jours={jours()}
            aujourdIso={AUJOURDHUI}
            libelles={LIBELLES}
            moisAffiche={{ valeur: "2026-09-01", onChange: () => {} }}
          />
          <output data-testid="valeur">{JSON.stringify(valeur)}</output>
        </>
      );
    }
    const { container } = render(<Harnais />);
    const bouton = (iso: string) =>
      container.querySelector<HTMLButtonElement>(`td[data-day="${iso}"] button`)!;
    expect(bouton("2026-09-16").getAttribute("data-range-start")).toBe("true");
    expect(bouton("2026-09-19").getAttribute("data-range-end")).toBe("true");
    expect(bouton("2026-09-17").getAttribute("data-range-middle")).toBe("true");

    // ⚠️ Cliquer APRÈS une plage complète l'ÉTEND, il ne la recommence pas : c'est `addToRange` de
    // react-day-picker, le comportement déjà relevé le 2026-08-29 (« le reclic sur plage complète
    // que addToRange ré-étend »). Le composant ne le corrige pas — décider qu'un clic doit
    // re-ancrer est une règle de réservation, elle appartient à l'appelant. Ce test l'ancre pour
    // qu'un futur « correctif » bien intentionné ne le change pas en silence.
    fireEvent.click(bouton("2026-09-23"));
    expect(container.querySelector('[data-testid="valeur"]')!.textContent).toBe(
      JSON.stringify({ debut: "2026-09-16", fin: "2026-09-23" })
    );
  });

  it("pose `fin` égale à `debut` au tout premier clic, jamais null", () => {
    // Acquis du 2026-08-29 : react-day-picker écrit `{from: X, to: X}` dès le premier clic, donc
    // un appelant qui testerait `!fin` pour reconnaître « arrivée posée, sortie à venir » ne
    // verrait jamais ce cas. La forme renvoyée le dit telle qu'elle est.
    const onValeurChange = vi.fn();
    const { bouton } = rendu({ valeur: null, onValeurChange });
    fireEvent.click(bouton("2026-09-23"));
    expect(onValeurChange).toHaveBeenCalledWith({ debut: "2026-09-23", fin: "2026-09-23" });
  });

  it("renvoie une chaîne ISO en mode jour unique", () => {
    const onValeurChange = vi.fn();
    const { bouton } = rendu({ mode: "single", valeur: null, onValeurChange });
    fireEvent.click(bouton("2026-09-23"));
    expect(onValeurChange).toHaveBeenCalledWith("2026-09-23");
  });
});

describe("Calendar — la cible tactile de 44 px ne peut pas disparaître en silence", () => {
  it("porte le jeton qui la produit", () => {
    // jsdom ne calcule aucune mise en page : la mesure réelle est faite au navigateur (44,0 px à
    // 320 px de large, 46,6 px sous PageShell à 390 px, 52,6 px au-delà de 768 px). Ce test garde
    // le seul geste qui la produit — sans lui, `--cell-size` retombe aux 28 px de legacy-calendar
    // et les cases passent sous le seuil sans qu'aucun test ne s'en aperçoive.
    const racine = rendu().container.querySelector('[data-slot="calendar"]')!;
    expect(racine.className).toContain("[--cell-size:2.75rem]");
    expect(racine.className).toContain("max-w-sm");
  });
});

// ── Plan 41, S10 : la grille de la charte, partout ──────────────────────────────────────────────
describe("Calendar — la charte et la langue (plan 41, S10)", () => {
  it("pose la grille de la charte et le mois au rôle titre-bloc", () => {
    const { container } = rendu();
    const racine = container.querySelector('[data-slot="calendar"]')!;
    // Le rayon des boutons (D4) pour le jour choisi, et des cases qui se partagent la largeur.
    expect(racine.className).toContain("[--cell-radius:var(--rayon-bouton)]");
    expect(racine.className).toContain("[&_button.rdp-day]:min-w-0");
    expect(container.querySelector(".rdp-caption_label")?.className).toContain("titre-bloc");
    expect(CLASSNAMES_CALENDRIER.caption_label).toContain("capitalize");
  });

  // Le wrapper vit dans le popover de `DateRangeField`, déjà un cadre : pas de second contour.
  it("garde le cadre (bordure marine, 16 px, blanc) pour les calendriers posés dans une page", () => {
    expect(CLASSE_CADRE_CALENDRIER).toContain("rounded-[16px]");
    expect(CLASSE_CADRE_CALENDRIER).toContain("border-[var(--border)]");
    const racine = rendu().container.querySelector('[data-slot="calendar"]')!;
    expect(racine.className).not.toContain("rounded-[16px]");
  });

  // Une locale date-fns nue traduit les mois, pas les libellés de react-day-picker : un visiteur
  // hispanophone entendait « Go to the Previous Month ».
  it("donne la locale de la grille avec ses libellés d'accessibilité traduits", () => {
    const es = localeCalendrier("es");
    expect(es?.code).toBe("es");
    expect(es && "labels" in es ? (es.labels as { labelPrevious?: string }).labelPrevious : null).toBe(
      "Ir al mes anterior"
    );
    expect(localeCalendrier("en")?.code).toBe("en-US");
  });

  it("rend la navigation en espagnol avec la locale es", () => {
    const { container } = rendu({ locale: localeCalendrier("es") });
    expect(container.querySelector(".rdp-button_previous")?.getAttribute("aria-label")).toBe(
      "Ir al mes anterior"
    );
  });

  // ⚠️ LA CAUSE DU DÉFAUT D'ORIGINE : les quatre formulaires de la fiche montent `DayPickerCalendar`
  // directement, sans ce wrapper — d'où des cases de 28 px en anglais en production. Ils doivent
  // poser la grille, le cadre et la locale ; vérifié sur le TEXTE, parce qu'aucun rendu de ce
  // fichier ne les monte (CLAUDE.md §11.20).
  it.each(["ReservationForm", "SlotReservationForm", "LodgingReservationForm", "EventoReservationForm"])(
    "%s pose la grille de la charte, son cadre et la locale",
    (formulaire) => {
      const ici = dirname(fileURLToPath(import.meta.url));
      const source = readFileSync(
        join(ici, "../../app/[locale]/(vitrine)/productos/[slug]", `${formulaire}.tsx`),
        "utf8"
      );
      expect(source).toContain("className={`${CLASSE_CALENDRIER} ${CLASSE_CADRE_CALENDRIER}`}");
      expect(source).toContain("classNames={CLASSNAMES_CALENDRIER}");
      expect(source).toContain("locale={localeCalendrier(locale)}");
    }
  );
});
