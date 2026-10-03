import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PageShell } from "@/components/atoms/PageShell";
import {
  Calendar,
  localeCalendrier,
  type CalendarLibelles,
  type CalendarProps,
  type JourCalendrier,
  type PlageCalendrier,
} from "./Calendar";

// Le calendrier était jusqu'ici le seul élément d'interface important de la vitrine qu'on ne
// pouvait voir qu'en montant un tunnel de réservation complet : une fiche produit, un logement
// PMS-backed, une réponse LobbyPMS. Ces stories existent pour le juger sans rien de tout ça.
//
// ⚠️ Toutes les dates sont FIGÉES sur septembre 2026, et « aujourd'hui » est passé en prop. Ce
// n'est pas une commodité de test : le composant refuse de calculer la date du jour lui-même (voir
// son en-tête), donc une story qui dériverait de l'horloge de la machine montrerait un mois
// différent chaque jour, et le mois entièrement complet cesserait de l'être le 1er octobre.

const MOIS = "2026-09";
const AUJOURDHUI = "2026-09-15";

/** `2026-09-07`. Les stories raisonnent en numéros de jour, pas en arithmétique de dates. */
function j(numero: number): string {
  return `${MOIS}-${String(numero).padStart(2, "0")}`;
}

const LIBELLES: Record<"es" | "en", CalendarLibelles> = {
  es: { complet: "Completo", selectionne: "seleccionado", aujourdhui: "hoy" },
  en: { complet: "Full", selectionne: "selected", aujourdhui: "today" },
};

/** L'étiquette telle que la produirait le formulaire réel : le nombre de places restantes. */
function restantes(
  langue: "es" | "en",
  nombre: number
): Pick<JourCalendrier, "etiquette" | "description"> {
  return {
    etiquette: String(nombre),
    description: langue === "es" ? `quedan ${nombre} lugares` : `${nombre} places left`,
  };
}

const TOUS_LES_JOURS = Array.from({ length: 30 }, (_, index) => index + 1);

// Le mois de référence : chaque état visuel y est représenté une fois, et une seule story suffit
// donc à juger la grille. Les quatre états NON déclarés (sélectionné, dans la plage, aujourd'hui,
// hors du mois affiché) apparaissent par construction — la sélection initiale du 16 au 19, la prop
// `aujourdIso` au 15, et les jours d'août/octobre que react-day-picker affiche en débord.
function joursDeReference(langue: "es" | "en"): JourCalendrier[] {
  return TOUS_LES_JOURS.map((numero) => {
    const date = j(numero);
    if (numero < 15) return { date, etat: "desactive" as const };
    if (numero === 21 || numero === 22 || numero === 28) return { date, etat: "complet" as const };
    if (numero === 24) return { date, etat: "complet" as const, ...restantes(langue, 0) };
    if (numero === 17) return { date, etat: "disponible" as const, ...restantes(langue, 2) };
    if (numero === 25) return { date, etat: "disponible" as const, ...restantes(langue, 1) };
    return { date, etat: "disponible" as const };
  });
}

const MOIS_ENTIEREMENT_COMPLET: JourCalendrier[] = TOUS_LES_JOURS.map((numero) => ({
  date: j(numero),
  etat: "complet",
}));

/** La locale et les libellés suivent le sélecteur de langue de la barre d'outils. */
function contexte(globals: Record<string, unknown>) {
  const langue = globals.locale === "en" ? "en" : "es";
  return { langue, locale: localeCalendrier(langue), libelles: LIBELLES[langue] } as const;
}

// ⚠️ Composant NOMMÉ, jamais un `render` qui appellerait `useState` : un `render` de story n'est
// pas monté comme un composant, les hooks y sont illégaux. Le calendrier est CONTRÔLÉ — c'est ce
// qui garantit que l'appelant décide de tout — donc une story qui se clique a besoin d'un état.
// `valeur` de la story sert d'état INITIAL ; la modifier depuis le panneau ne rejoue pas le
// montage, d'où son contrôle désactivé plus bas.
function Demo(props: CalendarProps) {
  const [mois, setMois] = useState(`${MOIS}-01`);
  const [plage, setPlage] = useState<PlageCalendrier | null>(
    props.mode === "range" ? props.valeur : null
  );
  const [jour, setJour] = useState<string | null>(props.mode === "single" ? props.valeur : null);
  const moisAffiche = { valeur: mois, onChange: setMois };

  return props.mode === "range" ? (
    <Calendar
      {...props}
      mode="range"
      valeur={plage}
      onValeurChange={setPlage}
      moisAffiche={moisAffiche}
    />
  ) : (
    <Calendar
      {...props}
      mode="single"
      valeur={jour}
      onValeurChange={setJour}
      moisAffiche={moisAffiche}
    />
  );
}

const meta = {
  title: "Saisie/Calendar",
  component: Calendar,
  parameters: { layout: "padded" },
  args: {
    mode: "range",
    aujourdIso: AUJOURDHUI,
    jours: [],
    valeur: null,
    onValeurChange: () => {},
    libelles: LIBELLES.es,
    testId: "calendrier",
  },
  // ⚠️ `CalendarProps` est une union discriminée sur `mode`, et react-docgen ne sait pas en tirer
  // des contrôles : sans ce rappel, `mode` et `etatParDefaut` s'affichaient en champ libre. Même
  // correctif que pour l'atome `Field` (vague 3).
  argTypes: {
    mode: { control: "select", options: ["single", "range"] },
    etatParDefaut: { control: "select", options: ["disponible", "complet", "desactive"] },
    valeur: { control: false },
    onValeurChange: { control: false },
    moisAffiche: { control: false },
    locale: { control: false },
  },
  // Un seul `render` pour toutes les stories : il branche l'état et fait suivre la langue de la
  // barre d'outils (locale date-fns ET libellés). Sans lui, la grille resterait en anglais quoi
  // qu'on choisisse — c'est justement ce que fait la production aujourd'hui, cf. §5 du rapport.
  render: (args, { globals }) => {
    const { locale, libelles } = contexte(globals);
    return <Demo {...args} locale={locale} libelles={libelles} />;
  },
} satisfies Meta<typeof Calendar>;

export default meta;
type Story = StoryObj<typeof meta>;

// LA story de jugement : tous les états d'un coup, dans un seul mois.
export const TousLesEtats: Story = {
  // ⚠️ Pas de `jours` dans les args : le `render` ci-dessous les reconstruit dans la langue
  // courante de la barre d'outils, donc une valeur d'args ne serait jamais celle affichée.
  args: { valeur: { debut: j(16), fin: j(19) } },
  render: (args, { globals }) => {
    const { langue, locale, libelles } = contexte(globals);
    return <Demo {...args} jours={joursDeReference(langue)} locale={locale} libelles={libelles} />;
  },
};

// La plage part du 28 septembre et sort du mois. react-day-picker affiche les jours d'octobre en
// débord : on voit donc la plage franchir la frontière sans changer de mois, puis on peut naviguer
// pour retrouver sa fin. C'est le cas qui casse une grille mal fichue — la case du 30 doit rester
// ouverte à droite, pas arrondie comme une fin de plage.
export const PlageSurDeuxMois: Story = {
  args: { valeur: { debut: j(28), fin: "2026-10-03" } },
  render: TousLesEtats.render,
};

// Le cas limite le plus laid : trente nuits barrées. C'est là qu'on voit si « complet » reste
// lisible, ou si la grille devient un bloc gris.
export const MoisComplet: Story = { args: { jours: MOIS_ENTIEREMENT_COMPLET } };

// Et son opposé : rien n'est contraint, aucune étiquette, aucune légende.
export const MoisLibre: Story = { args: { jours: [] } };

// Les places restantes sur chaque jour — l'information qu'un jour porte au-delà de sa date.
// ⚠️ Le formulaire réel ne les affiche QUE lorsqu'elles contraignent le choix ; les imprimer
// partout est justement ce qu'il évite. Cette story montre à quoi ressemble la densité maximale.
export const PlacesRestantes: Story = {
  render: (args, { globals }) => {
    const { langue, locale, libelles } = contexte(globals);
    const jours = TOUS_LES_JOURS.map((numero) =>
      numero % 7 === 0
        ? { date: j(numero), etat: "complet" as const }
        : { date: j(numero), etat: "disponible" as const, ...restantes(langue, (numero % 4) + 1) }
    );
    return <Demo {...args} jours={jours} locale={locale} libelles={libelles} />;
  },
};

// Le mode jour unique. Deux des trois formulaires de réservation de l'app ne sont pas en plage.
export const JourUnique: Story = {
  args: { mode: "single", valeur: j(18) },
  render: TousLesEtats.render,
};

// ⚠️ Échec FERMÉ : `etatParDefaut="desactive"` rend non réservable toute nuit dont l'appelant n'a
// rien dit. C'est la règle du 2026-08-28 (une nuit jamais récupérée n'est pas une nuit libre), et
// elle appartient à l'appelant — le composant ne la choisit pas, il la rend possible.
export const AucuneDonnee: Story = { args: { jours: [], etatParDefaut: "desactive" } };

// Sous une vraie coquille de page, à la largeur d'une fiche produit : c'est là qu'on voit si la
// grille tient, et à 390 px c'est le gabarit le plus contraint du projet.
export const DansUneCoquille: Story = {
  parameters: { layout: "fullscreen" },
  args: { valeur: { debut: j(16), fin: j(19) } },
  render: (args, { globals }) => {
    const { langue, locale, libelles } = contexte(globals);
    return (
      <PageShell variant="narrow">
        <h2 className="text-sm font-medium">Disponibilidad</h2>
        <Demo {...args} jours={joursDeReference(langue)} locale={locale} libelles={libelles} />
      </PageShell>
    );
  },
};
