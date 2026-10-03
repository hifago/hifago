import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button, Card, Chip, Input, Label, TextField } from "@hifago/ui";
import { composer as versRgb, contraste, resoudre } from "./contraste";

// Mesures de la palette de production. Les cinq anciennes pistes comparatives ont été
// archivées dans `docs/journal/2026-09.md` puis retirées du CSS après accord (plan 41, G5).
// La vitrine est claire uniquement (D9).
/* ------------------------------------------------------------------------------------------- */
/* Mesure — on lit ce que le navigateur calcule, on ne recopie aucun chiffre                     */
/* ------------------------------------------------------------------------------------------- */

// ⚠️ `getComputedStyle(...).getPropertyValue("--background")` renvoie l'expression CSS BRUTE,
// pas nécessairement sa couleur finale : une custom property n'est résolue qu'une fois UTILISÉE.
// D'où la sonde : on pose l'expression sur un élément réel placé DANS le panneau, et on relit la
// couleur calculée.
// ⚠️ La formule vit dans `./contraste` depuis le 2026-09-02 : elle était écrite ici ET dans
// Button.stories.tsx, et les deux versions avaient divergé sur le seuil de linéarisation sRGB.
// Voir l'en-tête du module — les chiffres doivent rester identiques entre les deux planches de
// contrôle de la charte.

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

/** Mesure chaque couple sur la sonde, donc dans le thème et la surface où elle est posée. */
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
 * Mesure tout ce qui est affiché sur le panneau réel, dans son thème et sa surface.
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
/* ------------------------------------------------------------------------------------------- */
/* Mesures de la charte de production                                                          */
/* ------------------------------------------------------------------------------------------- */

function PanneauMesure() {
  const [attacher, mesures] = useMesures();

  return (
    <div
      ref={attacher}
      data-theme="vitrine"
      className="min-w-0 rounded-lg border border-border bg-background p-4 text-foreground"
    >
      <p className="mb-3 text-sm font-semibold">Charte Hifago 2026</p>
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
const meta = {
  title: "Playground/Palette",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/* ------------------------------------------------------------------------------------------- */

// Échantillon de la palette effectivement livrée, en mode clair.
export const PaletteActive: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <p className="max-w-[75ch] text-sm">Charte Hifago 2026 — palette de production.</p>
      <Echantillon />
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
      <section>
        <h2 className="mb-2 text-xl">Palette de production</h2>
        <PanneauMesure />
      </section>
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
