import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button, Card, Chip, Input, Label, TextField } from "@hifago/ui";
import { composer as versRgb, contraste, resoudre } from "./contraste";

// Les cinq pistes visuelles candidates de la vitrine, à comparer et à trancher — en clair ET en
// sombre. Écrit le 2026-09-01, même démarche que pour l'admin le 2026-08-15
// (docs/specs/09-design-system-admin.md §10) : on ne choisit pas une palette dans un tableau de
// valeurs, on la choisit en la regardant sur des composants réels.
//
// ⚠️ AUCUNE piste n'est adoptée. La production reste sur les défauts HeroUI tant que Jérôme n'a pas
// tranché ; la recette d'adoption tient en trois gestes, écrite en tête de la section « vitrine »
// de packages/ui/src/styles/globals.css.
//
// Cette story ne dépend PAS du sélecteur « piste » de la barre d'outils : chaque panneau porte ses
// propres `data-piste`/`data-mode`, ce qui permet d'afficher les cinq pistes — et les deux modes —
// sur le même écran. C'est possible parce que `light-dark()` se résout sur l'élément qui porte le
// `color-scheme`, pas sur la racine du document : vérifié en navigateur avant d'écrire le CSS.

const PISTES = [
  {
    // ⚠️ Placée en PREMIER, et ce n'est pas un détail de mise en page : c'est la seule qui
    // n'invente rien. La marque Hifago existe déjà en production dans le portail legacy /guatape —
    // couleurs, polices, slogan, et un mode sombre par défaut. Les trois suivantes sont des
    // alternatives à cette référence, pas quatre propositions à égalité.
    cle: "hifago",
    titre: "Hifago",
    sous_titre: "la marque telle qu’elle existe déjà",
    parti:
      "Orange de marque, vert forêt, papier crème — repris au caractère près du portail /guatape en production (tailwind.config.js, reservar.html, kayam-contrast.css).",
    sacrifice:
      "L’orange Hifago tombe entre l’ambre d’alerte et le rouge d’erreur : il a fallu écarter les couleurs de statut de 24° à 45°, un coût que le legacy n’avait pas puisqu’il n’a pas de palette de statut. Et le legacy garde son fond de page sombre même en clair — ici le mode clair est un vrai mode clair.",
  },
  {
    cle: "embalse",
    titre: "Embalse",
    sous_titre: "l'eau du barrage",
    parti: "Teal profond, neutres à peine froids, angles généreux. Calme et confiance.",
    sacrifice:
      "Aucune couleur locale : rien ici ne dit Guatapé plutôt qu'une autre destination lacustre. Tout repose sur les photos.",
  },
  {
    cle: "zocalo",
    titre: "Zócalo",
    sous_titre: "les frises peintes des maisons",
    parti: "Brique saturée sur crème chaud, angles francs. Chaleur et ancrage local.",
    sacrifice:
      "Le crème teinte toutes les photos posées dessus ; l'accent n'est qu'à 36° de la couleur d'alerte ; et l'ensemble rappelle l'admin, qu'on devait oublier.",
  },
  {
    cle: "cal",
    titre: "Cal",
    sous_titre: "encre et papier",
    parti: "Pas de couleur d'identité, pas d'angle arrondi. L'interface se tait, les photos parlent.",
    sacrifice:
      "Un lien a la couleur du texte : il DEVRA être souligné. Et un bouton de réservation noir ne se repère pas de loin comme un bouton coloré.",
  },
  {
    // Ajoutée le 2026-09-02 sur demande de Jérôme : « une nouvelle flashy, bordure noire, fond
    // blanc de base, et des couleurs flashy jaune rouge vert bleu ». Elle s'oppose frontalement
    // aux quatre autres, qui sont toutes teintées et douces — c'est l'intérêt de l'avoir, et elle
    // n'a pas été adoucie pour leur ressembler.
    cle: "chiva",
    titre: "Chiva",
    sous_titre: "le bus peint colombien",
    parti:
      "Blanc franc, trait noir de 2 px, ombre portée dure sans flou, aplats saturés jaune/rouge/vert/bleu. Néo-brutalisme.",
    sacrifice:
      "En mode clair, le jaune (1,38:1 sur blanc) et le vert (1,86:1) ne peuvent JAMAIS porter de texte : ce sont des aplats, avec du texte noir dessus. Le rouge et le bleu sont l’inverse — lisibles en texte (4,92 et 5,67) mais leurs aplats portent du BLANC, pas du noir. Deux règles de texte au lieu d’une. Et le rouge devient une couleur de marque autant qu’une couleur d’alerte : ce n’est plus lui seul qui signale une action destructrice.",
  },
  {
    // Ajoutée le 2026-09-14, à partir d'un nouveau logo « hifaGO • Guatapé » envoyé par Jérôme —
    // une DEUXIÈME référence de marque, pas une variante de `hifago` : elle ne reprend aucune
    // couleur du legacy Kayam (zéro orange, zéro vert forêt). Retouchée le même jour après retour
    // de Jérôme : bouton en or franc, bleu promu en deuxième couleur principale (lien/focus ET
    // bouton secondaire), cartes sans ombre à bordure marine.
    cle: "penol",
    titre: "Peñol → LA CHARTE (adoptée)",
    sous_titre: "la charte graphique Hifago 2026",
    parti:
      "ADOPTÉE le 2026-10-01 : c’est la production. Née comme piste le 2026-09-14 avec des couleurs estimées à l’œil, puis RECALÉE sur les hex exacts de la charte fournie par Jérôme (or, bleu poudre, bleu ciel, bleu moyen, marine — valeurs dans globals.css, section « LA CHARTE »). Bouton en or franc à texte marine, bleu en deuxième couleur principale, cartes sans ombre à bordure marine, titres en Anton.",
    sacrifice:
      "Trois contraintes mesurées, pas des préférences : l’or ne peut JAMAIS porter de texte sur fond clair (1.96:1) ni recevoir du blanc (2.07:1), et le bleu ciel ne peut identifier aucun composant (2.79:1, sous 3:1) — il reste décoratif. D’où `--link`/`--focus` DÉCOUPLÉS de `--accent`, contrairement aux cinq autres pistes : elles ne se comparent donc pas terme à terme avec celle-ci sur ce point. La colonne ci-contre n’ayant plus de `data-piste` propre, elle rend le thème par défaut — c’est voulu, c’est le même CSS.",
  },
] as const;

type Mode = "clair" | "sombre";

/* ------------------------------------------------------------------------------------------- */
/* Mesure — on lit ce que le navigateur calcule, on ne recopie aucun chiffre                     */
/* ------------------------------------------------------------------------------------------- */

// ⚠️ `getComputedStyle(...).getPropertyValue("--background")` renvoie la chaîne BRUTE
// `light-dark(oklch(...), oklch(...))`, pas la couleur choisie : une custom property n'est pas
// résolue tant qu'elle n'est pas UTILISÉE. (C'est aussi pour ça que `Playground/Tokens` affichera
// désormais des `light-dark(...)` sur une piste active — constaté, hors de mon périmètre.)
// D'où la sonde : on pose l'expression sur un élément réel placé DANS le panneau, et on relit la
// couleur calculée.
// ⚠️ La formule vit dans `./contraste` depuis le 2026-09-02 : elle était écrite ici ET dans
// Button.stories.tsx, et les deux versions avaient divergé sur le seuil de linéarisation sRGB.
// Voir l'en-tête du module — c'était le pire endroit du lot où se permettre un doublon, puisque
// ce sont les chiffres qui départagent les pistes.

// `seuil` : 4.5 = texte (WCAG 1.4.3) ; 3 = ce qui IDENTIFIE un composant (1.4.11 — bordure de
// champ, anneau de focus). Un filet de carte décoratif n'entre dans aucune des deux catégories et
// n'est donc pas listé ici.
type Couple = { nom: string; texte: string; fonds: string[]; seuil: number };

const COUPLES: Couple[] = [
  { nom: "Texte courant sur la page", texte: "var(--foreground)", fonds: ["var(--background)"], seuil: 4.5 },
  { nom: "Texte sur une carte", texte: "var(--surface-foreground)", fonds: ["var(--surface)"], seuil: 4.5 },
  { nom: "Texte discret sur une carte", texte: "var(--muted)", fonds: ["var(--surface)"], seuil: 4.5 },
  { nom: "Lien sur une carte", texte: "var(--link)", fonds: ["var(--surface)"], seuil: 4.5 },
  { nom: "Bouton primaire", texte: "var(--accent-foreground)", fonds: ["var(--accent)"], seuil: 4.5 },
  { nom: "Bouton secondaire", texte: "var(--default-foreground)", fonds: ["var(--default)"], seuil: 4.5 },
  {
    nom: "Badge accent translucide, sur carte",
    texte: "var(--accent-soft-foreground)",
    fonds: ["var(--surface)", "var(--accent-soft)"],
    seuil: 4.5,
  },
  {
    nom: "Badge warning translucide, sur la page",
    texte: "var(--warning-soft-foreground)",
    fonds: ["var(--background)", "var(--warning-soft)"],
    seuil: 4.5,
  },
  { nom: "Texte saisi dans un champ", texte: "var(--field-foreground)", fonds: ["var(--field-background)"], seuil: 4.5 },
  { nom: "Placeholder de champ", texte: "var(--field-placeholder)", fonds: ["var(--field-background)"], seuil: 4.5 },
  { nom: "Bordure de champ, sur la page", texte: "var(--field-border)", fonds: ["var(--background)"], seuil: 3 },
  { nom: "Anneau de focus, sur une carte", texte: "var(--focus)", fonds: ["var(--surface)"], seuil: 3 },
];

const JETONS_AFFICHES = [
  "--background", "--surface", "--surface-secondary", "--surface-tertiary", "--foreground",
  "--muted", "--default", "--accent", "--accent-foreground", "--field-background",
  "--field-border", "--success", "--warning", "--danger", "--border", "--separator",
];

type Ratio = { nom: string; ratio: number; seuil: number };
type Mesures = { couples: Ratio[]; jetons: { nom: string; css: string }[] };

/** Mesure chaque couple sur la sonde, donc dans le contexte (thème, piste, mode, surface) où elle est posée. */
function mesurerCouples(sonde: HTMLElement, couples: Couple[]): Ratio[] {
  return couples.map(({ nom, texte, fonds, seuil }) => ({
    nom,
    seuil,
    ratio: contraste(versRgb([resoudre(sonde, texte)]), versRgb(fonds.map((f) => resoudre(sonde, f)))),
  }));
}

/** Pose une sonde invisible dans `hote`, la passe à `mesure`, puis la retire. */
function avecSonde<T>(hote: HTMLElement, mesure: (sonde: HTMLElement) => T): T {
  const sonde = document.createElement("span");
  sonde.style.cssText = "position:absolute;opacity:0;pointer-events:none";
  hote.appendChild(sonde);
  const resultat = mesure(sonde);
  sonde.remove();
  return resultat;
}

/**
 * Mesure tout ce qui est affiché, sur le panneau réel — donc dans son thème, sa piste, son mode.
 *
 * ⚠️ La mesure vit dans un REF CALLBACK, pas dans un effet, et ce n'est pas un détail de style :
 * elle a besoin d'un élément réellement attaché au document (une custom property ne se résout pas
 * hors du DOM), donc l'initialiseur paresseux qu'utilise `Tokens.stories.tsx` est impossible ici ;
 * et un `setState` synchrone dans le corps d'un effet déclenche des rendus en cascade — le lint de
 * ce dépôt le refuse, à raison. Un ref callback s'exécute une fois, à l'attachement, ce qui est
 * exactement le moment où la mesure devient possible.
 */
function useMesures(): [(noeud: HTMLDivElement | null) => void, Mesures | null] {
  const [mesures, setMesures] = React.useState<Mesures | null>(null);

  const attacher = React.useCallback((panneau: HTMLDivElement | null) => {
    if (!panneau) return;
    setMesures(
      avecSonde(panneau, (sonde) => ({
        couples: mesurerCouples(sonde, COUPLES),
        jetons: JETONS_AFFICHES.map((nom) => ({ nom, css: resoudre(sonde, `var(${nom})`) })),
      }))
    );
  }, []);

  return [attacher, mesures];
}

/** Même principe que `useMesures`, pour les couples d'une surface : la sonde est posée DANS la surface. */
function useMesuresSurface(couples: Couple[]): [(noeud: HTMLDivElement | null) => void, Ratio[] | null] {
  const [ratios, setRatios] = React.useState<Ratio[] | null>(null);

  const attacher = React.useCallback(
    (surface: HTMLDivElement | null) => {
      if (!surface) return;
      setRatios(avecSonde(surface, (sonde) => mesurerCouples(sonde, couples)));
    },
    [couples]
  );

  return [attacher, ratios];
}

/* ------------------------------------------------------------------------------------------- */
/* Les trois surfaces de la charte — plan 41, item F3                                            */
/* ------------------------------------------------------------------------------------------- */

// Une surface (`data-superficie`, `globals.css`) redéfinit ce qui se lit sur son fond. Ces couples
// sont ceux qui ÉCHOUAIENT avant elle — le texte discret de l'accueil mesurait 3.17:1 sur l'or — et
// ceux que les items suivants poseront sur l'or et le marine (bandeaux, pied de page, rails). Les
// fonds sont résolus DANS la surface : `var(--accent)` y reste l'or, puisqu'aucune surface ne le
// redéfinit. La vitrine n'a plus de mode sombre (arbitrage D9 = A) : clair seulement.
type Surface = {
  cle: string;
  titre: string;
  superficie: "or" | "marine" | "clara";
  /** La surface sur laquelle celle-ci est posée — un `Aviso` blanc (`clara`) sur l'or. */
  sur?: "or";
  couples: Couple[];
};

const SURFACES: Surface[] = [
  {
    cle: "or",
    titre: "Or — accueil, navigation, bandeaux",
    superficie: "or",
    couples: [
      { nom: "Texte courant sur l’or", texte: "var(--foreground)", fonds: ["var(--accent)"], seuil: 4.5 },
      { nom: "Texte discret sur l’or", texte: "var(--muted)", fonds: ["var(--accent)"], seuil: 4.5 },
      { nom: "Lien sur l’or", texte: "var(--link)", fonds: ["var(--accent)"], seuil: 4.5 },
      { nom: "Anneau de focus sur l’or", texte: "var(--focus)", fonds: ["var(--accent)"], seuil: 3 },
      { nom: "Bordure de champ sur l’or", texte: "var(--field-border)", fonds: ["var(--accent)"], seuil: 3 },
    ],
  },
  {
    cle: "marine",
    titre: "Marine — rails, pied de page",
    superficie: "marine",
    couples: [
      { nom: "Texte courant sur le marine", texte: "var(--foreground)", fonds: ["var(--charte-marine)"], seuil: 4.5 },
      { nom: "Texte discret sur le marine", texte: "var(--muted)", fonds: ["var(--charte-marine)"], seuil: 4.5 },
      { nom: "Lien sur le marine", texte: "var(--link)", fonds: ["var(--charte-marine)"], seuil: 4.5 },
      { nom: "Anneau de focus sur le marine", texte: "var(--focus)", fonds: ["var(--charte-marine)"], seuil: 3 },
    ],
  },
  {
    cle: "aviso-sur-or",
    titre: "Clara — un Aviso blanc posé sur l’or",
    superficie: "clara",
    sur: "or",
    couples: [
      { nom: "Texte de l’Aviso", texte: "var(--foreground)", fonds: ["var(--surface)"], seuil: 4.5 },
      { nom: "Texte discret de l’Aviso", texte: "var(--muted)", fonds: ["var(--surface)"], seuil: 4.5 },
      { nom: "Lien dans l’Aviso", texte: "var(--link)", fonds: ["var(--surface)"], seuil: 4.5 },
      { nom: "Bordure de l’Aviso, sur l’or", texte: "var(--border)", fonds: ["var(--accent)"], seuil: 3 },
    ],
  },
];

function TableauRatios({ ratios }: { ratios: Ratio[] | null }) {
  return (
    <>
      <table className="w-full text-xs">
        <tbody>
          {(ratios ?? []).map((c) => (
            <tr key={c.nom} className="border-b border-separator">
              <td className="py-1 pr-2">{c.nom}</td>
              <td className="py-1 text-right font-mono tabular-nums">{c.ratio.toFixed(2)}</td>
              <td className="py-1 pl-2 text-right whitespace-nowrap">
                {/* Jamais la seule couleur : le mot est écrit. */}
                {c.ratio >= c.seuil ? `✓ ≥ ${c.seuil}` : `✗ < ${c.seuil}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {ratios === null ? <p className="text-xs text-muted">Mesure en cours…</p> : null}
    </>
  );
}

function ApercuSurface() {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p>Texte courant — nom de l’offre, prix.</p>
      <p className="text-muted">Texte discret — durée, point de rendez-vous.</p>
      {/* La couleur d'un lien, sans lien : un échantillon de palette ne mène nulle part. */}
      <p className="text-link underline underline-offset-4">Un lien, souligné</p>
    </div>
  );
}

function PanneauSurface({ surface }: { surface: Surface }) {
  const [attacher, ratios] = useMesuresSurface(surface.couples);
  // L'élément mesuré est celui qui porte la surface : posé directement dans le panneau, ou, pour
  // l'Aviso, dans une surface or qui l'entoure — c'est l'emboîtement réel qu'on veut prouver.
  const mesuree = (
    <div
      ref={attacher}
      data-superficie={surface.superficie}
      className={
        surface.sur
          ? "relative rounded-[16px] border border-border bg-surface p-4"
          : "relative rounded-[16px] p-4"
      }
    >
      <ApercuSurface />
    </div>
  );

  return (
    <div
      data-theme="vitrine"
      data-mode="clair"
      className="min-w-0 rounded-lg border border-border bg-background p-4 text-foreground"
    >
      <p className="mb-3 text-sm font-semibold">{surface.titre}</p>
      <div className="mb-4">
        {surface.sur ? (
          <div data-superficie={surface.sur} className="rounded-[16px] p-4">
            {mesuree}
          </div>
        ) : (
          mesuree
        )}
      </div>
      <TableauRatios ratios={ratios} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */
/* L'échantillon — les éléments que le §5 du brief demande de voir                               */
/* ------------------------------------------------------------------------------------------- */

// Volontairement construit sur les primitives HeroUI importées de @hifago/ui, et non sur les atomes
// de `components/atoms/` : un autre agent y écrit en ce moment, et un échantillon de palette ne doit
// dépendre d'aucun composant en cours d'écriture. Ce qu'on regarde ici est la palette, pas eux.
function Echantillon() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-xl font-semibold">Tour en lancha por el embalse</h3>
        <p className="mt-1 text-sm">
          Recorrido guiado de una hora, con parada fotográfica frente a la Piedra del Peñol.
        </p>
        <p className="mt-1 text-xs text-muted">Texte discret — durée, point de rendez-vous, conditions.</p>
      </div>

      <Card className="overflow-hidden">
        {/* Aplat de surface plutôt qu'une vraie photo : ce qu'on compare est la palette, et une
            photo la masquerait. C'est aussi le substitut que rend l'atome `Image` sans visuel. */}
        <div className="h-24 w-full bg-surface-secondary" aria-hidden="true" />
        <Card.Header>
          <Card.Title>Casa Kayam Guatapé</Card.Title>
          <Card.Description>Hospedaje frente al agua, seis alojamientos.</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-wrap items-center gap-2">
          <Chip color="accent" variant="soft">
            Alojamiento
          </Chip>
          <Chip color="warning" variant="primary">
            Evento
          </Chip>
          <Chip color="success" variant="secondary">
            Actividad
          </Chip>
          <span className="ml-auto font-semibold tabular-nums">80.000 COP</span>
        </Card.Content>
      </Card>

      <TextField name="buscar">
        <Label>Buscar</Label>
        <Input type="search" placeholder="Nombre del producto…" />
      </TextField>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary">Reservar</Button>
        <Button variant="secondary">Ver más</Button>
        <Button variant="outline">Cancelar</Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */
/* Le panneau : un sous-arbre qui porte sa propre piste et son propre mode                       */
/* ------------------------------------------------------------------------------------------- */

function Panneau({
  piste,
  mode,
  children,
}: {
  piste: string;
  mode: Mode;
  children: React.ReactNode;
}) {
  return (
    // Les trois attributs sur le MÊME élément : les règles de forçage du CSS exigent les trois
    // (`[data-theme][data-piste][data-mode]`). `bg-background`/`text-foreground` explicites, sinon
    // le panneau laisserait voir le fond du document, qui n'est pas celui de la piste.
    <div
      data-theme="vitrine"
      data-piste={piste}
      data-mode={mode}
      className="min-w-0 rounded-lg border border-border bg-background p-4 text-foreground"
    >
      {children}
    </div>
  );
}

function PanneauMesure({ piste, mode }: { piste: string; mode: Mode }) {
  const [attacher, mesures] = useMesures();

  return (
    <div
      ref={attacher}
      data-theme="vitrine"
      data-piste={piste}
      data-mode={mode}
      className="min-w-0 rounded-lg border border-border bg-background p-4 text-foreground"
    >
      <p className="mb-3 text-sm font-semibold capitalize">{mode}</p>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {(mesures?.jetons ?? []).map((j) => (
          <span
            key={j.nom}
            title={`${j.nom} — ${j.css}`}
            className="size-7 rounded border border-border"
            style={{ background: j.css }}
          />
        ))}
      </div>

      <TableauRatios ratios={mesures?.couples ?? null} />
    </div>
  );
}

function EnTetePiste({ piste }: { piste: (typeof PISTES)[number] }) {
  return (
    <div className="mb-2">
      <h2 className="text-lg font-semibold">
        {piste.titre} <span className="font-normal text-muted">— {piste.sous_titre}</span>
      </h2>
      <p className="mt-1 max-w-[75ch] text-sm">{piste.parti}</p>
      <p className="mt-1 max-w-[75ch] text-sm text-muted">
        <strong className="font-medium">Ce qu’elle sacrifie :</strong> {piste.sacrifice}
      </p>
    </div>
  );
}

const meta = {
  title: "Playground/Palette",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/* ------------------------------------------------------------------------------------------- */

// ⚠️ LA story où la barre d'outils fait tout — et la première à ouvrir. Elle ne force NI palette NI
// mode : elle hérite de `<html>`, donc les sélecteurs « Palette » et « Mode » la pilotent
// entièrement. Toutes les autres stories de ce fichier forcent leurs panneaux pour pouvoir montrer
// deux modes côte à côte, ce qui rend le sélecteur « Mode » sans effet SUR ELLES — c'est voulu,
// mais ça se voit mal, et c'est exactement ce qui a fait croire que la bascule ne marchait pas.
export const PaletteActive: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <p className="max-w-[75ch] text-sm">
        Cette story suit la barre d’outils : change <strong>Palette</strong> ou <strong>Mode</strong>
        {" "}et tout ce qui est ci-dessous change avec. Les stories de comparaison plus bas figent au
        contraire leurs panneaux, pour montrer plusieurs palettes ou les deux modes en même temps.
      </p>
      <Echantillon />
    </div>
  ),
};

// La comparaison : chaque palette en clair ET en sombre, sur les mêmes éléments. ⚠️ Les panneaux
// forcent leur mode, donc le sélecteur « Mode » de la barre d'outils ne les touche pas — c'est ce
// qui permet de voir les deux d'un coup d'œil.
export const ToutesLesPistes: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      <p className="max-w-[75ch] text-sm">
        Cinq directions, sur les mêmes éléments, chacune en clair et en sombre. Aucune n’est
        adoptée : la production tourne toujours sur les défauts HeroUI. ⚠️ Les panneaux ci-dessous
        figent leur palette et leur mode — le sélecteur « Mode » de la barre d’outils ne les change
        donc pas. Pour le voir agir, va sur la story « Palette active ».
      </p>
      {PISTES.map((piste) => (
        <section key={piste.cle}>
          <EnTetePiste piste={piste} />
          <div className="grid gap-4 md:grid-cols-2">
            <Panneau piste={piste.cle} mode="clair">
              <Echantillon />
            </Panneau>
            <Panneau piste={piste.cle} mode="sombre">
              <Echantillon />
            </Panneau>
          </div>
        </section>
      ))}
    </div>
  ),
};

// Les cinq pistes dans un même mode, côte à côte : c'est cette vue-là qui fait sentir l'écart
// entre elles, alors que la story ci-dessus fait sentir l'écart entre les deux modes.
export const ClairCoteACote: Story = {
  render: () => (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {PISTES.map((piste) => (
        <div key={piste.cle} className="min-w-0">
          <h2 className="mb-2 text-base font-semibold">{piste.titre}</h2>
          <Panneau piste={piste.cle} mode="clair">
            <Echantillon />
          </Panneau>
        </div>
      ))}
    </div>
  ),
};

export const SombreCoteACote: Story = {
  render: () => (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {PISTES.map((piste) => (
        <div key={piste.cle} className="min-w-0">
          <h2 className="mb-2 text-base font-semibold">{piste.titre}</h2>
          <Panneau piste={piste.cle} mode="sombre">
            <Echantillon />
          </Panneau>
        </div>
      ))}
    </div>
  ),
};

// Les chiffres. ⚠️ Ils ne sont pas recopiés d'un tableau : chaque ratio est mesuré à l'instant, sur
// le panneau lui-même, en composant les aplats translucides sur leur vrai fond. Si une valeur du
// CSS change, cette page le dit toute seule — c'est le seul moyen qu'elle ne mente pas.
export const Contrastes: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      <p className="max-w-[75ch] text-sm">
        Contrastes WCAG mesurés dans le navigateur. Seuil 4.5:1 pour du texte (1.4.3), 3:1 pour ce
        qui identifie un composant (1.4.11 — bordure de champ, anneau de focus). Le filet décoratif
        d’une carte n’entre dans aucune des deux catégories et n’est pas listé.
      </p>
      <section id="surfaces">
        <h2 className="mb-2 text-xl">Surfaces de la charte (production)</h2>
        <p className="mb-3 max-w-[75ch] text-sm">
          Chaque surface (<code>data-superficie</code>, plan 41, item F3) redéfinit ce qui se lit sur
          son fond. Mesuré dans la surface elle-même, en clair seulement : la vitrine n’a plus de
          mode sombre (arbitrage D9).
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {SURFACES.map((surface) => (
            <PanneauSurface key={surface.cle} surface={surface} />
          ))}
        </div>
      </section>
      {PISTES.map((piste) => (
        <section key={piste.cle}>
          <h2 className="mb-2 text-lg font-semibold">{piste.titre}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <PanneauMesure piste={piste.cle} mode="clair" />
            <PanneauMesure piste={piste.cle} mode="sombre" />
          </div>
        </section>
      ))}
    </div>
  ),
};

// Ce que la vitrine utilise VRAIMENT comme police. ⚠️ Ce panneau documentait un DÉFAUT jusqu'au
// 2026-10-01 : `layout.tsx` posait `--font-geist-sans` pendant que HeroUI et Tailwind lisaient
// `--font-sans`, deux noms que rien ne reliait — la vitrine rendait en pile système en chargeant
// deux polices pour rien. Le correctif est appliqué (charte graphique Hifago 2026) ; le panneau
// reste, comme VÉRIFICATION : si un jour `--font-sans` réaffiche un repli système, c'est que le
// raccord a été défait.
function lirePolices(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  return {
    "--font-sans (lu par HeroUI et Tailwind)": style.getPropertyValue("--font-sans").trim(),
    "--font-titre (titres de la charte)": style.getPropertyValue("--font-titre").trim(),
    "--font-mono (lu par HeroUI et Tailwind)": style.getPropertyValue("--font-mono").trim(),
    "font-family effective du corps": getComputedStyle(document.body).fontFamily,
    "font-family effective d’un titre":
      document.querySelector("h1, h2, h3") instanceof HTMLElement
        ? getComputedStyle(document.querySelector("h1, h2, h3") as HTMLElement).fontFamily
        : "(aucun titre dans cette story)",
  };
}

function Polices() {
  // Initialiseur paresseux, comme `Tokens.stories.tsx` : lire une valeur calculée n'est pas une
  // synchronisation, et ces valeurs-là ne dépendent d'aucun élément du panneau.
  const [valeurs] = React.useState(lirePolices);

  return (
    <div className="flex max-w-[75ch] flex-col gap-4">
      <p className="text-sm">
        Le raccord, <strong>appliqué depuis le 2026-10-01</strong> dans le thème : faire pointer{" "}
        <code>--font-sans</code> sur la variable que <code>next/font</code> produit déjà, au lieu de
        laisser les deux noms côte à côte sans lien. Les valeurs ci-dessous doivent montrer Poppins
        et Anton — un repli système y serait le signe que le raccord a été défait.
      </p>
      {/* `tabIndex`/`role`/`aria-label` : un conteneur qui défile horizontalement doit être
          atteignable au clavier, sinon son contenu est inaccessible à qui n'a pas de souris.
          Relevé par le panneau a11y sur cette story même — pas anticipé. */}
      <pre
        tabIndex={0}
        role="region"
        aria-label="Correctif proposé pour les polices"
        className="overflow-x-auto rounded border border-border bg-surface p-3 text-xs"
      >
        {`--font-sans: var(--font-poppins), ui-sans-serif, system-ui, sans-serif;
--font-titre: var(--font-anton), var(--font-poppins), ui-sans-serif, system-ui, sans-serif;
--font-mono: var(--font-geist-mono), ui-monospace, monospace;`}
      </pre>
      <dl className="text-xs">
        {Object.entries(valeurs).map(([nom, valeur]) => (
          <div key={nom} className="flex gap-3 border-b border-separator py-1.5">
            <dt className="w-64 shrink-0 font-mono">{nom}</dt>
            <dd className="min-w-0 break-words">
              {valeur === "" ? (
                <em className="text-muted">non défini ici — c’est le défaut du navigateur qui rend</em>
              ) : (
                valeur
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export const PolicesEnVigueur: Story = { render: () => <Polices /> };
