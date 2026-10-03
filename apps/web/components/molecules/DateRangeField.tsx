"use client";

import type { ReactNode } from "react";
import { addDaysIso } from "@hifago/domain";
import { Popover } from "@hifago/ui";
import { Button } from "@/components/atoms/Button";
import {
  Calendar,
  type CalendarLibelles,
  type CalendarProps,
  type JourCalendrier,
  type PlageCalendrier,
} from "./Calendar";

// Le filtre « dates » du bloc de recherche (2026-09-02, vague 8) : un déclencheur qui ouvre un
// popover contenant le calendrier de la vitrine en mode plage.
//
// `"use client"` obligatoire : ce fichier importe le barrel `@hifago/ui` (CLAUDE.md §11.16).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. POURQUOI UN POPOVER ICI, ALORS QUE `LanguageSwitcher` LE REFUSE
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ À lire avant de « corriger » ce fichier. `organisms/LanguageSwitcher.tsx` écarte délibérément
// `Popover`/`Dropdown` de HeroUI, sur une mesure du 2026-09-02 : un popover fermé ne contient
// AUCUN de ses enfants dans le HTML rendu côté serveur. Ce sélecteur-là contient des LIENS que
// Googlebot doit voir, donc le popover l'aurait rendu invisible à l'indexation.
//
// Ce filtre-ci ne contient ni lien ni contenu indexable : une grille de dates n'a rien à dire à un
// moteur de recherche. La règle ne s'applique donc pas, et le popover est le bon outil — avec tout
// ce que react-aria donne gratuitement et que `LanguageSwitcher` a dû écrire à la main (Échap,
// clic extérieur, retour du focus sur le déclencheur).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. LE CALENDRIER EST CELUI QUI EXISTE, ET IL N'EST PAS TOUCHÉ
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// `molecules/Calendar` en `mode="range"`, pas une seconde grille et pas `RangeCalendar` de HeroUI :
// le calendrier react-aria a été évalué deux fois et écarté sur le fond (CLAUDE.md §2 point 2), et
// `Calendar` a déjà payé ses corrections MESURÉES — cases remontées de 28 à 44 px, double opacité
// qui affichait le numéro d'un jour à 25 %, libellés « Today, » / « , selected » que
// react-day-picker écrit en anglais en dur. Une seconde grille les réintroduirait toutes.
//
// ⚠️ `Calendar` ne connaît AUCUNE règle métier — c'est écrit dans son en-tête et c'est sa raison
// d'être. « Le passé n'est pas sélectionnable » est donc une règle d'APPELANT, et cette enveloppe
// est l'appelant. Elle la tient en deux gestes, tous deux vérifiés au rendu :
//   • `premierMoisIso={aujourdIso}` — la flèche « mois précédent » devient inerte ;
//   • les jours antérieurs à `aujourdIso` énumérés en `desactive` (voir `joursPasses`).
//
// ⚠️ Un seul mois affiché. Une plage se choisit souvent sur deux mois côte à côte, mais `Calendar`
// est figé à un mois (`w-full max-w-sm`, `[--cell-size:2.75rem]`) et ce lot ne lui ajoute pas de
// prop. Signalé comme suite possible, pas fait.

/**
 * 31 : le plus long mois. Il faut éteindre les jours du mois courant antérieurs à `aujourdIso`, et
 * ce plafond les couvre quelle que soit la date.
 *
 * ⚠️ J'avais d'abord mis 37, pour couvrir en plus les jours DÉBORDANTS du mois précédent —
 * `legacy-calendar.tsx:132` pose `showOutsideDays = true`, et ces jours-là seraient restés
 * `disponible`, donc cliquables, donc une plage commençant dans le passé. La mesure a dit
 * l'inverse : avec `premierMoisIso` posé sur le mois courant, react-day-picker ne rend AUCUN jour
 * avant le 1er du mois (première case de la grille de septembre 2026 : `2026-09-01`, vérifié). Le
 * débord ne subsiste qu'en FIN de grille — 4 jours d'octobre ici — et ceux-là sont dans le futur,
 * donc sélectionnables à juste titre. Le nombre est ramené à ce qui est réellement nécessaire
 * plutôt qu'à une marge fondée sur une hypothèse fausse.
 */
const JOURS_PASSES_ENUMERES = 31;

/**
 * Les jours strictement antérieurs à `aujourdIso`, éteints. Arithmétique sur des dates CIVILES via
 * `addDaysIso` — jamais un `Date` du navigateur, même règle que partout ailleurs dans ce dépôt
 * (eslint.rules.mjs, lot fuseau du 2026-08-28).
 */
export function joursPasses(aujourdIso: string): JourCalendrier[] {
  return Array.from({ length: JOURS_PASSES_ENUMERES }, (_, index) => ({
    date: addDaysIso(aujourdIso, -(index + 1)),
    etat: "desactive" as const,
  }));
}

type LocaleCalendrier = CalendarProps["locale"];

/**
 * Le libellé affiché quand une plage est choisie. ⚠️ `Intl.DateTimeFormat.formatRange` et pas une
 * chaîne de traduction : l'ordre des éléments, le séparateur et l'abréviation du mois changent
 * avec la langue, et c'est exactement ce que cette API sait faire. Aucune clé de messages n'est
 * donc nécessaire — mesuré : « 3–7 sept » en es, « Sep 3 – 7 » en en, et le cas `fin === debut`
 * s'effondre tout seul en une seule date (« 3 sept »).
 *
 * ⚠️ Sans locale, `Intl` retombe sur celle du NAVIGATEUR, pas sur celle de la page : un visiteur
 * en français verrait « 3–7 sept. » sous une interface espagnole. Mesuré, signalé — la prop est
 * optionnelle sur `Calendar`, elle l'est donc ici aussi, mais l'appelant a tout intérêt à la
 * passer.
 */
export function formatPlage(plage: PlageCalendrier, codeLocale?: string): string {
  const format = new Intl.DateTimeFormat(codeLocale, { day: "numeric", month: "short" });
  const debut = new Date(`${plage.debut}T00:00:00`);
  if (!plage.fin) return format.format(debut);
  return format.formatRange(debut, new Date(`${plage.fin}T00:00:00`));
}

function IconeCalendrier() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      className="size-3.5 shrink-0"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 11h18" />
    </svg>
  );
}

/**
 * LE DÉCLENCHEUR PARTAGÉ PAR LES DEUX FILTRES.
 *
 * ⚠️ Il vit ici, et `PeopleField` l'importe. Ce n'est pas l'endroit idéal — un lecteur qui cherche
 * « le déclencheur des filtres » ne le devinera pas dans le fichier des dates — mais le lot a figé
 * la liste des fichiers à trois, et l'alternative était d'en écrire DEUX COPIES qui divergeraient
 * au premier ajustement. À sortir dans son propre fichier quand le coordinateur rouvrira le
 * dossier ; signalé au rapport.
 *
 * ⚠️ Le nom accessible inclut la VALEUR COURANTE. « Fechas » seul ne dit pas à un lecteur d'écran
 * que le 3 au 7 sont déjà choisis — c'est la faute classique du motif déclencheur-plus-popover.
 * Le préfixe est en `sr-only` plutôt qu'en `aria-label` : le texte visible reste court (la place
 * manque à 390 px avec deux déclencheurs côte à côte), et surtout un `aria-label` REMPLACERAIT le
 * contenu, donc la valeur affichée disparaîtrait du nom au lieu de s'y ajouter.
 */
export function FilterTrigger({
  icon,
  fieldLabel,
  value,
  placeholderLabel,
  isDisabled,
  testId,
}: {
  icon: ReactNode;
  /** Le nom du filtre, lu avant la valeur. Déjà traduit. */
  fieldLabel: string;
  /** Le texte à afficher quand une valeur est choisie. `null` = rien de choisi. */
  value: string | null;
  placeholderLabel: string;
  isDisabled?: boolean;
  testId?: string;
}) {
  return (
    // `size="md"` : 44 px de cible tactile à toute largeur, exigés par components/README.md — ces deux
    // déclencheurs restent visibles sur mobile, contrairement au bouton « Buscar » de la barre.
    // (`lg` mesure 48 px depuis le plan 41, item F4 : il est réservé aux CTA de conversion.)
    //
    // ⚠️ L'APPARENCE DE LA MAQUETTE DE L'ACCUEIL (Jérôme, 2026-10-01) : plus de pilule bordée ni de
    // chevron — l'icône dans une pastille bleu poudre, le libellé en Poppins à côté, rien d'autre.
    // `ghost` garde le fond au survol et l'anneau de focus : c'est toujours un bouton, il le montre
    // dès qu'on l'approche. Les deux filtres ne vivent que sur l'accueil (`SearchPanel`), d'où un
    // changement d'apparence ici plutôt qu'une variante de plus.
    <Button variant="ghost" color="neutral" size="md" shape="pill" isDisabled={isDisabled} testId={testId}>
      {/* La pastille : bleu poudre de la charte, glyphe BLANC comme sur la maquette. Décorative — le
          libellé écrit à côté porte l'information. `text-white` reste constant sur cette forme. */}
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--default)] text-white"
      >
        {icon}
      </span>
      {/* `font-medium` : une PUCE de filtre, pas une action — elle garde la graisse 500 validée sur
          l'accueil, quand les boutons passent à 600 (plan 41, item F4). */}
      <span className="font-medium">
        {value === null ? (
          placeholderLabel
        ) : (
          <>
            <span className="sr-only">{`${fieldLabel} : `}</span>
            {value}
          </>
        )}
      </span>
    </Button>
  );
}

export type DateRangeFieldProps = {
  /**
   * La plage choisie. Réutilise le type exporté par `Calendar` — une seule forme de plage dans
   * toute l'app. `fin` vaut `debut` au premier clic (acquis du 2026-08-29).
   */
  value: PlageCalendrier | null;
  onChange: (value: PlageCalendrier | null) => void;
  /** REQUIS. `todayInBogota()`, jamais l'heure du navigateur — même raison que `Calendar`. */
  aujourdIso: string;
  /** Ce qu'affiche le déclencheur quand aucune date n'est choisie. Déjà traduit. */
  placeholderLabel: string;
  /** Les libellés que `Calendar` exige (complet / selectionne / aujourdhui). Déjà traduits. */
  calendarLabels: CalendarLibelles;
  /**
   * Locale date-fns, passée telle quelle à `Calendar`. ⚠️ Son `.code` sert AUSSI au formatage de
   * la plage : une seule prop pour deux notions (objet date-fns d'un côté, étiquette BCP-47 de
   * l'autre), pour qu'elles ne puissent pas se contredire.
   */
  locale?: LocaleCalendrier;
  isDisabled?: boolean;
  testId?: string;
};

export function DateRangeField({
  value,
  onChange,
  aujourdIso,
  placeholderLabel,
  calendarLabels,
  locale,
  isDisabled,
  testId,
}: DateRangeFieldProps) {
  const sousId = (suffixe: string) => (testId ? `${testId}-${suffixe}` : undefined);

  return (
    <Popover>
      <FilterTrigger
        icon={<IconeCalendrier />}
        fieldLabel={placeholderLabel}
        value={value ? formatPlage(value, locale?.code) : null}
        placeholderLabel={placeholderLabel}
        isDisabled={isDisabled}
        testId={sousId("trigger")}
      />
      <Popover.Content>
        {/* ⚠️ La largeur est posée ICI, et c'est obligatoire. `Calendar` vaut `w-full max-w-sm`,
            soit 384 px de plafond — mais `w-full` se résout contre le popover, dont la largeur est
            dictée par son contenu : personne ne la contraint. À 390 px de gabarit, la grille plus
            le padding du popover DÉPASSENT l'écran, et le README interdit tout défilement
            horizontal. `calc(100vw-3rem)` laisse 24 px de marge de chaque côté ; `max-w-sm` garde
            le plafond de `Calendar` sur grand écran. Vérifié au rendu aux deux gabarits. */}
        <Popover.Dialog aria-label={placeholderLabel} className="w-[calc(100vw-3rem)] max-w-sm">
          <Calendar
            mode="range"
            valeur={value}
            onValeurChange={onChange}
            // Le passé, en deux gestes — voir l'en-tête §2.
            jours={joursPasses(aujourdIso)}
            premierMoisIso={aujourdIso}
            aujourdIso={aujourdIso}
            libelles={calendarLabels}
            locale={locale}
            testId={sousId("calendar")}
          />
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
