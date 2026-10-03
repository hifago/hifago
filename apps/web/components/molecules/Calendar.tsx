"use client";

import { createContext, useContext, useMemo, type ComponentProps } from "react";
import {
  cn,
  DayPickerCalendar,
  DayPickerCalendarDayButton,
  localeCalendarioEn,
  localeCalendarioEs,
} from "@hifago/ui";
import { isoDateToLocalMidnight } from "@hifago/domain";

// Le calendrier de la vitrine, entré dans le design system le 2026-09-02 (vague 6).
//
// ⚠️ CE COMPOSANT NE CONNAÎT AUCUNE RÈGLE MÉTIER, et c'est sa raison d'être. Les règles de
// réservation — nuits à check-out EXCLUSIF, `min_stay` ancré sur la nuit d'arrivée, `lead_days` qui
// relève le plancher, interdiction d'enjamber une nuit pleine — restent où elles ont été écrites et
// prouvées : `app/[locale]/productos/[slug]/LodgingReservationForm.tsx` (journal des 2026-08-28 et
// 2026-08-29). Elles ne sont ni déplacées, ni recopiées, ni « généralisées » ici. L'anti-survente
// en dépend.
//
// La frontière est portée par le TYPE, pas par une consigne : ce composant reçoit `jours`, une
// liste de « pour cette date, voici son état et son étiquette ». Il ne reçoit JAMAIS de
// disponibilités à interpréter, et n'expose aucune prop qui lui permettrait de calculer un état.
// C'est aussi pour ça qu'`aujourdIso` est REQUIS : sans lui, react-day-picker prendrait
// `new Date()` du NAVIGATEUR (DayPicker.js:167) — exactement le bug du lot fuseau du 2026-08-28,
// que la règle eslint ne peut pas voir puisqu'il vit dans une dépendance.
//
// La brique reste `DayPickerCalendar` de `@hifago/ui`, INCHANGÉE — `apps/admin` l'utilise aussi.
// Le calendrier react-aria/HeroUI a été évalué deux fois (2026-08-17, 2026-08-29) et écarté sur le
// fond : le domaine est en nuits à sortie exclusive (CLAUDE.md §2 point 2). Sujet clos.
//
// `"use client"` obligatoire : react-day-picker est un composant client, et l'import passe par le
// barrel `@hifago/ui` (CLAUDE.md §11.16).

/**
 * Les trois états qu'un APPELANT déclare. Les quatre autres états visuels d'un jour —
 * sélectionné, dans la plage, aujourd'hui, hors du mois affiché — ne se déclarent pas : ils se
 * DÉDUISENT de `valeur`, d'`aujourdIso` et du mois affiché. Les mettre dans cette union aurait
 * permis de les contredire (un jour « sélectionné » hors de la sélection), donc de mentir.
 */
export type EtatJour = "disponible" | "complet" | "desactive";

export type JourCalendrier = {
  /** Date civile `yyyy-MM-dd`. Jamais un instant : un jour de calendrier n'en est pas un. */
  date: string;
  etat: EtatJour;
  /**
   * Court, affiché DANS la case — les places restantes aujourd'hui. Déjà traduit : une molecule
   * ne traduit rien elle-même. Rendu tel quel, à côté du numéro du jour.
   */
  etiquette?: string;
  /**
   * La même information en toutes lettres, pour un lecteur d'écran (« quedan 2 lugares »). Sans
   * elle, un « 2 » posé sous un numéro de jour n'est qu'un second nombre sans nom : le nom
   * accessible du bouton est construit ici, jamais deviné.
   */
  description?: string;
};

/** `fin` vaut `debut` au premier clic — react-day-picker pose `{from: X, to: X}` (2026-08-29). */
export type PlageCalendrier = { debut: string; fin: string | null };

/**
 * ⚠️ `selectionne` et `aujourdhui` ne sont pas décoratifs : react-day-picker écrit « Today, » et
 * « , selected » EN ANGLAIS EN DUR dans le nom accessible de chaque jour
 * (labels/labelDayButton.js), quelle que soit la locale. Les fournir est le seul moyen de ne pas
 * servir de l'anglais à un visiteur hispanophone.
 */
export type CalendarLibelles = {
  /** Ajouté au nom d'un jour complet, et repris tel quel dans la légende sous la grille. */
  complet: string;
  selectionne: string;
  aujourdhui: string;
};

type LocaleCalendrier = ComponentProps<typeof DayPickerCalendar>["locale"];

type CalendarBase = {
  /** Les jours dont l'appelant a quelque chose à dire. Les autres prennent `etatParDefaut`. */
  jours: JourCalendrier[];
  /**
   * L'état d'une date ABSENTE de `jours`. Le défaut est `"disponible"` — mais un formulaire de
   * réservation choisit `"desactive"` : une nuit dont on n'a jamais reçu la disponibilité n'est pas
   * réservable (acquis du 2026-08-28, échec fermé). Ce choix appartient à l'appelant, pas ici.
   */
  etatParDefaut?: EtatJour;
  /** REQUIS — `todayInBogota()`, jamais l'heure du navigateur. Voir l'en-tête. */
  aujourdIso: string;
  libelles: CalendarLibelles;
  /**
   * Mois affiché piloté par l'appelant (il sert de clé de fetch dans le formulaire réel). Les deux
   * champs vont ENSEMBLE : un `month` sans `onMonthChange` fige la navigation en silence côté
   * react-day-picker, d'où un objet plutôt que deux props qu'on pourrait dépareiller. Omis, le
   * calendrier ouvre sur `aujourdIso` et navigue tout seul.
   */
  moisAffiche?: { valeur: string; onChange: (moisIso: string) => void };
  /** Bornes de NAVIGATION (les flèches disparaissent au-delà), pas de sélection. */
  premierMoisIso?: string;
  dernierMoisIso?: string;
  /**
   * Locale de la grille : `localeCalendrier(code)`, qui porte aussi les libellés d'accessibilité.
   * ⚠️ Omise, la grille est en ANGLAIS. Une locale date-fns nue traduit les mois, pas les libellés.
   */
  locale?: LocaleCalendrier;
  testId?: string;
};

export type CalendarProps = CalendarBase &
  (
    | { mode: "single"; valeur: string | null; onValeurChange: (valeur: string | null) => void }
    | {
        mode: "range";
        valeur: PlageCalendrier | null;
        onValeurChange: (valeur: PlageCalendrier | null) => void;
      }
  );

// ─────────────────────────────────────────────────────────────────────────────────────────────
// LE CALENDRIER À LA CHARTE — plan 41, item S10 (2026-10-03)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ CE QUE LE RENDU A MONTRÉ D'ABORD : les QUATRE formulaires de réservation de la fiche produit
// (`ReservationForm`, `SlotReservationForm`, `LodgingReservationForm`, `EventoReservationForm`)
// n'utilisent PAS ce wrapper — ils montent `DayPickerCalendar` de `@hifago/ui` directement, avec
// leurs propres prédicats métier (nuits à sortie exclusive, `min_stay` ancré sur l'arrivée…). D'où,
// mesuré en production : cases de 28 px, mois et libellés en anglais. Les faire passer par
// `Calendar` aurait déplacé ces prédicats, ce que le plan exclut (« aucun comportement métier ») et
// ce que l'anti-survente interdit. Les réglages de la charte sont donc des CONSTANTES exportées
// d'ici, posées à la fois par ce wrapper et par les quatre formulaires — une seule définition.
//
// `CLASSE_CALENDRIER` — la grille, partout :
//   - `--cell-size` 44 px (28 px dans legacy-calendar) : il dimensionne les boutons de mois et la
//     hauteur de l'en-tête. Les CASES, elles, se partagent la largeur (`min-w-0` sur le bouton) :
//     44 px dès que la place existe, mais le panneau de la fiche ne fait que 278 px à 360 de gabarit
//     et 308 à 390 (mesuré), où sept cases de 44 px déborderaient — elles y font 36 et 40 px ;
//   - `--cell-radius` = le rayon des boutons (D4, 8 px) : jour choisi, début et fin de plage ; les
//     autres cases et les flèches de mois aussi (leur `rounded-lg` rendait 4 px : deux rayons
//     mesurés), sauf le milieu de plage, qui reste une bande continue ;
//   - jour choisi (seul, début, fin) : l'or et le marine de legacy-calendar (`bg-accent`,
//     `text-accent-foreground`, 6,31:1), inchangés ; milieu de plage : bleu poudre et marine ;
//   - jours de la semaine : Poppins 600 12 px, majuscules, bleu moyen (`--link`) ;
//   - jour désactivé : lisible, en `--muted`, SANS les deux estompes empilées (voir plus bas,
//     `CLASSES_CASE`) ; jour complet : le barré que les formulaires posent sur la CASE est aussi
//     posé sur le BOUTON. Au rendu du 2026-10-03, Edge le propageait déjà jusqu'au chiffre ; la règle
//     ne dépend plus de cette propagation, que l'en-tête de ce fichier a vue échouer ailleurs. Leur
//     `opacity-60` est retiré pour la même raison de contraste que plus bas : avant, un jour
//     complet s'affichait à 0,3 d'opacité, et une fin de séjour sur une nuit complète en or
//     délavé ;
//   - aujourd'hui : souligné, comme dans ce wrapper ;
//   - prix et places sous le jour : 11 px, `--muted` hors sélection.
// `w-full` bat `w-fit` par tailwind-merge : react-day-picker joint `classNames.root` puis le
// `className` reçu (DayPicker.js:216), et `CalendarRoot` repasse le tout dans `cn()`.
// ⚠️ `max-w-sm` n'est PAS une largeur en dur, c'est un PLAFOND : sans lui, à 1280 px la grille
// occupait toute la page et `aspect-square` donnait des cases de 183 px de côté — mesuré.
// ⚠️ `String.raw` : un `_` dans une variante arbitraire de Tailwind est une ESPACE ; les classes
// `rdp-range_start`… s'écrivent donc `rdp-range\_start` (même forme que legacy-calendar).
export const CLASSE_CALENDRIER = String.raw`w-full max-w-sm [--cell-size:2.75rem] [--cell-radius:var(--rayon-bouton)] [&_button.rdp-day]:min-w-0 [&_button.rdp-day]:text-base [&_button.rdp-day:not([data-range-middle=true])]:rounded-[var(--rayon-bouton)] [&_.rdp-button\_previous]:rounded-[var(--rayon-bouton)] [&_.rdp-button\_next]:rounded-[var(--rayon-bouton)] [&_.rdp-weekday]:text-xs [&_.rdp-weekday]:font-semibold [&_.rdp-weekday]:uppercase [&_.rdp-weekday]:text-link [&_.rdp-button\_previous_svg]:size-5 [&_.rdp-button\_next_svg]:size-5 [&_td.rdp-disabled]:opacity-100 [&_td.rdp-disabled_button]:opacity-100 [&_td.line-through]:opacity-100 [&_td.line-through_button]:line-through [&_td[data-today=true]:not([data-selected=true])_button]:underline [&_td[data-today=true]:not([data-selected=true])_button]:decoration-2 [&_td[data-today=true]:not([data-selected=true])_button]:underline-offset-4 [&_button[data-range-middle=true]]:bg-[var(--default)] [&_button[data-range-middle=true]]:text-[var(--default-foreground)] [&_td.rdp-range\_start]:bg-[var(--default)] [&_td.rdp-range\_start]:after:bg-[var(--default)] [&_td.rdp-range\_end]:bg-[var(--default)] [&_td.rdp-range\_end]:after:bg-[var(--default)] [&_button.rdp-day>span]:text-[11px] [&_button.rdp-day>span]:opacity-100 [&_button.rdp-day:not([data-selected-single=true]):not([data-range-start=true]):not([data-range-end=true])>span]:text-muted`;

// `CLASSE_CADRE_CALENDRIER` — le cadre d'un calendrier POSÉ DANS UNE PAGE (les formulaires) : blanc,
// bordure marine de 1 px, 16 px d'arrondi, 12 puis 16 px de marge. Pas dans ce wrapper : il vit
// dans le popover de `DateRangeField`, qui est déjà un cadre — deux bordures s'y emboîteraient.
export const CLASSE_CADRE_CALENDRIER = "rounded-[16px] border border-[var(--border)] bg-surface p-3 sm:p-4";

// Le mois en rôle `titre-bloc` (Anton, 20 → 22 px), majuscule initiale (« octubre 2026 » en
// espagnol). ⚠️ `classNames.caption_label` REMPLACE celui de legacy-calendar (il n'est pas fusionné) :
// `rdp-caption_label` est remis pour garder le crochet de la bibliothèque.
export const CLASSNAMES_CALENDRIER = {
  caption_label: "rdp-caption_label titre-bloc capitalize select-none",
};

/**
 * La locale de la grille pour une langue de la vitrine : mois, jours, premier jour de semaine ET
 * libellés d'accessibilité (« Ir al mes anterior »), que la locale date-fns seule laisse en anglais.
 */
export function localeCalendrier(codigo: string): LocaleCalendrier {
  return codigo === "en" ? localeCalendarioEn : localeCalendarioEs;
}

// ⚠️ « Aujourd'hui » et « au milieu de la plage » peignent le MÊME `bg-surface-secondary` dans
// legacy-calendar — l'un sur le `<td>`, l'autre sur le `<button>`. Sur une plage du 16 au 19 avec
// aujourd'hui au 15, la bande claire court donc du 15 au 19 et la sélection paraît commencer un
// jour trop tôt (vu en capture, pas déduit). On n'enlève pas le fond de la brique partagée — il
// faudrait parier sur l'ordre des utilitaires dans la feuille générée — on ajoute une marque qui
// ne dépend d'aucune couleur, sur le bouton, seul endroit où vit le numéro du jour.
const CLASSE_AUJOURDHUI = "font-bold underline decoration-2 underline-offset-4";

// ⚠️ LE POINT LE PLUS IMPORTANT DE CE FICHIER, et il contredit ce que fait la production.
//
// Un jour complet est `disabled` ET `complet` : react-day-picker empile donc DEUX opacités sur deux
// éléments emboîtés — `opacity-50` sur le `<td>` (son modificateur `disabled`, cf. BASE_CLASS_NAMES)
// et `opacity-50` sur le `<button>` (le `disabled:opacity-50` de `navButtonClassName`). Elles se
// MULTIPLIENT : 0,25. Le chiffre du jour, la seule information que ce calendrier doit absolument
// faire passer, s'affiche donc au quart de son opacité. Mesuré, pas déduit.
//
// ⚠️ Et le `line-through` que `LodgingReservationForm` pose sur la case NE BARRE RIEN : le numéro du
// jour vit dans le `<button>`, et un navigateur ne propage pas la décoration de texte à l'intérieur
// d'un contrôle de formulaire. C'est pour ça que le barré est posé ici sur le BOUTON — le
// modificateur, lui, ne peut atteindre que le `<td>` (piège du 2026-08-21).
//
// ⚠️ L'ESTOMPE EST RETIRÉE POUR LES DEUX ÉTATS NON CLIQUABLES, y compris « désactivé », et c'est
// une décision mesurée, pas un oubli. Sur les cinq pistes × deux modes, le numéro d'un jour barré
// ou passé vaut 1,36 à 1,70 contre son fond avec l'estompe empilée ; 2,25 à 3,05 avec une seule
// des deux ; 6,20 à 8,74 sans aucune, `--muted` faisant seul le travail pour lequel ce jeton
// existe. AUCUNE valeur intermédiaire ne passe 4,5 (mesuré à 0,5 / 0,6 / 0,7 / 0,8, sur
// `--muted` comme sur `--foreground`). Un jour dont on ne peut pas LIRE le numéro rend la grille
// inutilisable : WCAG 1.4.3 exempte les contrôles inactifs, mais l'exemption porte sur la couleur
// d'un bouton, pas sur la date qu'il faut savoir lire pour se repérer dans un mois.
const CLASSES_CASE: Record<"complet" | "desactive", string> = {
  complet: "opacity-100 text-foreground",
  desactive: "opacity-100",
};
const CLASSES_BOUTON: Record<EtatJour, string> = {
  disponible: "",
  // `disabled:opacity-100` bat `disabled:opacity-50` par tailwind-merge (même variante, même
  // groupe, le nôtre passé après) ; `text-foreground` défait le `text-muted` du `<td>`. Un texte
  // barré dit déjà « pas disponible » : le griser en plus ne dit rien de neuf et coûte le contraste.
  complet: "line-through text-foreground disabled:opacity-100",
  // Le `text-muted` du modificateur `disabled` reste : c'est lui qui distingue un jour éteint d'un
  // jour ouvert, et il est fait pour ça.
  desactive: "disabled:opacity-100",
};

// ⚠️ `[&>span]:opacity-70` vient de `dayButtonBaseClassName` (legacy-calendar) et s'applique à
// l'étiquette, qui est précisément le texte le plus petit de la grille. Neutralisé ici par
// tailwind-merge (même variante, même groupe, le nôtre est passé après).
const CLASSE_BOUTON_JOUR = "[&>span]:opacity-100";

/**
 * Date de grille → clé civile. Même format que `CalendarDay.isoDate`, donc que `data-day`.
 *
 * ⚠️ Construite à la main plutôt que par `format(date, "yyyy-MM-dd")`, et c'est mesuré :
 * react-day-picker réévalue le matcher `disabled` ET chaque modificateur pour les 42 cases à chaque
 * rendu (`createGetModifiers`, sans mémoïsation), soit ~170 appels par rendu — 0,24 ms avec date-fns
 * contre 0,013 ms ici. C'est déjà le choix fait pour cette raison exacte dans
 * `packages/ui/src/components/legacy-calendar.tsx` (`toIsoDate`).
 *
 * ⚠️ Composants LOCAUX, jamais `toISOString()`, qui décalerait la date d'un jour à Bogotá.
 */
function cle(date: Date): string {
  const annee = date.getFullYear();
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${annee}-${mois}-${jour}`;
}

/**
 * ⚠️ LA PARADE AU REMONTAGE DE LA GRILLE, et elle tient au fait que `BoutonJour` est écrit ICI, au
 * niveau du module.
 *
 * react-day-picker DÉMONTE et remonte les 42 cases dès que le TYPE du composant `DayButton` change
 * (documenté par `dateTaggedDayButtonComponents` dans legacy-calendar.tsx). La première version le
 * définissait DANS `Calendar`, mémoïsé sur `[parJour, etatParDefaut]` — une parade qui dépendait de
 * l'appelant, donc pas une parade : `DateRangeField` construit son tableau `jours` en ligne, il est
 * donc neuf à chaque rendu, `parJour` avec lui, et la grille entière était démontée puis remontée à
 * chaque frappe du formulaire englobant.
 *
 * Hissé au module, le type ne peut plus changer, quoi que fasse l'appelant. La donnée par jour lui
 * parvient alors par contexte — et pas par un `ref` écrit pendant le rendu, que la règle
 * `react-hooks/refs` du dépôt interdit, à raison.
 */
type DonneesJour = { parJour: Map<string, JourCalendrier>; etatParDefaut: EtatJour };

const ContexteJours = createContext<DonneesJour>({
  parJour: new Map(),
  etatParDefaut: "disponible",
});

// `boutonProps` et non `props` : le composant appelant a déjà une variable de ce nom, et l'ombrer
// rendrait illisible la ligne qui décide de la marque « aujourd'hui ».
function BoutonJour(boutonProps: ComponentProps<typeof DayPickerCalendarDayButton>) {
  const { parJour, etatParDefaut } = useContext(ContexteJours);
  // ⚠️ `day.isoDate`, pas `cle(day.date)` : `CalendarDay` calcule et stocke DÉJÀ cette clé au même
  // format à sa construction. 42 conversions par rendu, purement gratuites à supprimer.
  const iso = boutonProps.day.isoDate;
  const jour = parJour.get(iso);
  const etat = jour?.etat ?? etatParDefaut;
  const { modifiers } = boutonProps;
  return (
    <DayPickerCalendarDayButton
      {...boutonProps}
      data-date={iso}
      // Cible stable pour un test ou un e2e : l'état DÉCLARÉ, pas une classe à déchiffrer.
      data-etat={etat}
      className={cn(
        CLASSE_BOUTON_JOUR,
        CLASSES_BOUTON[etat],
        modifiers.today && !modifiers.selected && CLASSE_AUJOURDHUI
      )}
    >
      {boutonProps.children}
      {jour?.etiquette ? <span>{jour.etiquette}</span> : null}
    </DayPickerCalendarDayButton>
  );
}

// Constante de module : `components` ne peut donc pas non plus changer d'identité.
const COMPOSANTS = { DayButton: BoutonJour };

export function Calendar(props: CalendarProps) {
  const {
    jours,
    etatParDefaut = "disponible",
    aujourdIso,
    libelles,
    moisAffiche,
    premierMoisIso,
    dernierMoisIso,
    locale,
    testId,
  } = props;
  const { complet: libelleComplet, selectionne, aujourdhui } = libelles;
  const codeLocale = locale?.code;

  const parJour = useMemo(() => {
    const par = new Map<string, JourCalendrier>();
    for (const jour of jours) par.set(jour.date, jour);
    return par;
  }, [jours]);

  // ⚠️ PAS mémoïsés, contrairement à `composants` et `libellesRdp` juste en dessous — la différence
  // n'est pas un oubli. `disabled` et `modifiers` sont consommés par `createGetModifiers`
  // (DayPicker.js:138), une fonction ORDINAIRE rappelée à chaque rendu : leur identité n'est lue
  // nulle part. `components` et `labels`, eux, sont dans les dépendances du `useMemo` de tête de
  // DayPicker — d'où la mémoïsation, là et seulement là.
  const etatDe = (iso: string) => parJour.get(iso)?.etat ?? etatParDefaut;
  // Un seul prédicat pour les deux états non cliquables : « disponible » est le seul qui le soit.
  const nonSelectionnable = (date: Date) => etatDe(cle(date)) !== "disponible";
  const modificateurs = {
    complet: (date: Date) => etatDe(cle(date)) === "complet",
    desactive: (date: Date) => etatDe(cle(date)) === "desactive",
  };

  const donneesJour = useMemo(
    () => ({ parJour, etatParDefaut }),
    [parJour, etatParDefaut]
  );

  // Le nom accessible d'un jour, reconstruit entièrement. C'est le seul point d'entrée : un
  // `aria-label` sur un `<button>` remplace son contenu, donc un `sr-only` glissé dans la case
  // n'aurait jamais été lu.
  // ⚠️ UN formateur, pas quarante-deux. `labelDayButton` est appelé par react-day-picker une fois
  // par case, dans sa boucle de rendu ; `date.toLocaleDateString(code, options)` y instanciait un
  // formateur ICU à CHAQUE appel — 1,92 ms par rendu de grille, mesuré, de loin le poste le plus cher
  // du fichier. La chaîne produite est IDENTIQUE (la spec définit `toLocaleDateString(l, o)` comme
  // `new Intl.DateTimeFormat(l, o).format(this)`), `codeLocale` indéfini compris. 0,28 ms.
  const formatNomJour = useMemo(
    () =>
      new Intl.DateTimeFormat(codeLocale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    [codeLocale]
  );

  const libellesRdp = useMemo(
    () => ({
      labelDayButton: (date: Date, modifiers: Record<string, boolean | undefined>) => {
        const jour = parJour.get(cle(date));
        const morceaux = [formatNomJour.format(date)];
        if (modifiers.today) morceaux.push(aujourdhui);
        if (modifiers.selected) morceaux.push(selectionne);
        if (jour?.description) morceaux.push(jour.description);
        else if (jour?.etat === "complet") morceaux.push(libelleComplet);
        return morceaux.join(", ");
      },
    }),
    [parJour, formatNomJour, aujourdhui, selectionne, libelleComplet]
  );

  const communs = {
    today: isoDateToLocalMidnight(aujourdIso),
    month: moisAffiche ? isoDateToLocalMidnight(moisAffiche.valeur) : undefined,
    onMonthChange: moisAffiche ? (mois: Date) => moisAffiche.onChange(cle(mois)) : undefined,
    defaultMonth: moisAffiche ? undefined : isoDateToLocalMidnight(aujourdIso),
    startMonth: premierMoisIso ? isoDateToLocalMidnight(premierMoisIso) : undefined,
    endMonth: dernierMoisIso ? isoDateToLocalMidnight(dernierMoisIso) : undefined,
    disabled: nonSelectionnable,
    modifiers: modificateurs,
    // ⚠️ Ces classes atterrissent sur le `<td>`, JAMAIS sur le `<button>` (piège du 2026-08-21) —
    // c'est ce qui rend `modifiersClassNames` incapable de barrer un numéro de jour, et pourquoi
    // `CLASSES_BOUTON` existe à côté. Elles s'ajoutent à celles du modificateur `disabled` de
    // react-day-picker, et passent après, donc elles gagnent.
    modifiersClassNames: { complet: CLASSES_CASE.complet, desactive: CLASSES_CASE.desactive },
    components: COMPOSANTS,
    labels: libellesRdp,
    locale,
    className: CLASSE_CALENDRIER,
    classNames: CLASSNAMES_CALENDRIER,
  };

  // La légende n'apparaît que si elle a quelque chose à expliquer. Un mois sans nuit pleine ne
  // gagne rien à porter le mot « complet » sous sa grille.
  const aUnJourComplet = jours.some((jour) => jour.etat === "complet");

  return (
    // Le fournisseur porte la donnée par jour jusqu'à `BoutonJour`, hissé au module ci-dessus.
    <ContexteJours.Provider value={donneesJour}>
      <div className="flex w-full flex-col gap-2" data-testid={testId}>
      {props.mode === "range" ? (
        <DayPickerCalendar
          {...communs}
          mode="range"
          selected={
            props.valeur
              ? {
                  from: isoDateToLocalMidnight(props.valeur.debut),
                  to: props.valeur.fin ? isoDateToLocalMidnight(props.valeur.fin) : undefined,
                }
              : undefined
          }
          onSelect={(plage: { from?: Date; to?: Date } | undefined) =>
            props.onValeurChange(
              plage?.from ? { debut: cle(plage.from), fin: plage.to ? cle(plage.to) : null } : null
            )
          }
        />
      ) : (
        <DayPickerCalendar
          {...communs}
          mode="single"
          selected={props.valeur ? isoDateToLocalMidnight(props.valeur) : undefined}
          onSelect={(jour: Date | undefined) => props.onValeurChange(jour ? cle(jour) : null)}
        />
      )}
      {aUnJourComplet ? (
        <p
          className="flex items-center gap-2 px-2 text-sm"
          data-testid={testId ? `${testId}-legende` : undefined}
        >
          {/* Le motif lui-même, pas un jour d'exemple : un « 15 » barré en légende sous une grille
              où le 15 existe et n'est pas complet se lit comme une date, pas comme un échantillon. */}
          <span aria-hidden className="inline-block h-px w-5 bg-current" />
          {libelleComplet}
        </p>
      ) : null}
      </div>
    </ContexteJours.Provider>
  );
}
