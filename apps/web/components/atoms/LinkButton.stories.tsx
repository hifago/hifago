import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import * as React from "react";
import { Button, type ButtonColor, type ButtonVariant } from "./Button";
import { LinkButton } from "./LinkButton";
import { Legende } from "../playground/Legende";

// Le playground du lien habillé en bouton. Deux choses à y regarder, et une seule compte vraiment :
// que `LinkButton` et `Button` soient INDISCERNABLES à l'œil, et discernables à l'oreille.
//
// À voir aux deux gabarits (Mobile 390 par défaut, Desktop 1280) : les hauteurs changent au
// breakpoint `md`, et c'est là que se joue la règle des 44 px de cible tactile.
const meta = {
  title: "Actions/LinkButton",
  component: LinkButton,
  parameters: { layout: "padded" },
  args: { href: "/pago", children: "Reservar" },
} satisfies Meta<typeof LinkButton>;

export default meta;
type Story = StoryObj<typeof meta>;

const VARIANTS: ButtonVariant[] = ["solid", "soft", "outline", "ghost"];
const COLORS: ButtonColor[] = ["accent", "neutral", "danger"];

// Icône inline, volontairement : `lucide-react` est présent dans node_modules mais déclaré par
// packages/ui, PAS par apps/web — l'importer ici créerait une dépendance fantôme (même raisonnement
// que Button.stories.tsx).
const FlecheSortante = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />
  </svg>
);

export const Defaut: Story = {};

// Le cas réel qui a motivé ce composant : ProductDetailView.tsx:158-167, le lien de réservation
// externe d'un evento — aujourd'hui un `<a>` habillé à la main.
export const Externe: Story = {
  args: {
    href: "https://tickets.example.com/evento-guatape",
    external: true,
    newTabLabel: "(se abre en una pestaña nueva)",
    children: "Reservar en el sitio del organizador",
    iconAfter: <FlecheSortante />,
  },
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// LA PREUVE VISUELLE — mesurée dans le navigateur, pas affirmée dans un commentaire
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Le test unitaire compare les classes des 36 combinaisons. Ce n'est pas tout à fait la même
// chose que « rendent pareil » : deux éléments peuvent porter les mêmes classes et différer par
// leur balise (`<a>` contre `<button>`), qui n'a ni les mêmes valeurs par défaut de l'agent
// utilisateur, ni la même boîte. Cette story compare donc ce que le navigateur A CALCULÉ —
// hauteur, largeur, fond, texte, rayon, bordure — et affiche l'écart s'il y en a un.
const PROPRIETES = [
  "height",
  "paddingLeft",
  "paddingRight",
  "backgroundColor",
  "color",
  "borderRadius",
  "borderTopWidth",
  "borderColor",
  "fontSize",
  "fontWeight",
] as const;

type Ecart = { propriete: string; bouton: string; lien: string };

function comparer(bouton: HTMLElement, lien: HTMLElement): Ecart[] {
  const b = getComputedStyle(bouton);
  const l = getComputedStyle(lien);
  const ecarts: Ecart[] = PROPRIETES.filter((p) => b[p] !== l[p]).map((p) => ({
    propriete: p,
    bouton: String(b[p]),
    lien: String(l[p]),
  }));
  // La largeur est comparée à part : les deux libellés sont identiques, donc les deux largeurs
  // doivent l'être au pixel près. Un écart ici veut dire que la boîte diffère, pas la couleur.
  const lb = bouton.getBoundingClientRect();
  const ll = lien.getBoundingClientRect();
  if (Math.abs(lb.width - ll.width) > 0.5 || Math.abs(lb.height - ll.height) > 0.5) {
    ecarts.push({
      propriete: "boîte rendue",
      bouton: `${lb.width.toFixed(1)}×${lb.height.toFixed(1)}`,
      lien: `${ll.width.toFixed(1)}×${ll.height.toFixed(1)}`,
    });
  }
  return ecarts;
}

// Mesure dans un callback de ref plutôt que dans un effet : la règle de lint du dépôt interdit un
// setState synchrone dans un effet, et le callback de ref s'exécute une fois le nœud posé — donc
// après que le navigateur a calculé le style.
function Paire({ variant, color }: { variant: ButtonVariant; color: ButtonColor }) {
  const [ecarts, setEcarts] = React.useState<Ecart[] | null>(null);
  const bouton = React.useRef<HTMLDivElement | null>(null);

  const attacher = React.useCallback((noeud: HTMLDivElement | null) => {
    if (!noeud || !bouton.current) return;
    const b = bouton.current.querySelector("button");
    const l = noeud.querySelector("a");
    if (b && l) setEcarts(comparer(b, l));
  }, []);

  return (
    <div className="flex flex-col gap-1">
      <Legende>
        {variant} / {color}
      </Legende>
      <div className="flex flex-wrap items-center gap-3">
        <div ref={bouton} className="contents">
          <Button variant={variant} color={color}>
            Reservar
          </Button>
        </div>
        <div ref={attacher} className="contents">
          <LinkButton href="/pago" variant={variant} color={color}>
            Reservar
          </LinkButton>
        </div>
        {ecarts === null ? null : ecarts.length === 0 ? (
          // Le verdict est porté par le MOT, pas par la couleur (règle de components/README.md :
          // « l'information n'est jamais portée par la seule couleur »). `text-muted` reste donc
          // volontairement neutre sur la surface de production.
          <span className="text-xs text-muted">identiques</span>
        ) : (
          <span className="text-xs text-danger">
            {ecarts.map((e) => `${e.propriete} : ${e.bouton} ≠ ${e.lien}`).join(" · ")}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Les 12 combinaisons, bouton et lien côte à côte, avec le verdict mesuré à droite de chaque paire.
 * ⚠️ « identiques » n'est pas un commentaire écrit à la main : c'est le résultat de la comparaison
 * des styles calculés au moment où la story s'affiche. Si un jeton de thème ou un ajout à `Button`
 * faisait diverger les deux, la ligne passerait en rouge et dirait laquelle.
 */
export const IdentiqueAuBouton: Story = {
  render: () => (
    <div className="flex flex-col gap-5">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex flex-col gap-3">
          {COLORS.map((color) => (
            <Paire key={color} variant={variant} color={color} />
          ))}
        </div>
      ))}
    </div>
  ),
};

/**
 * La différence qui doit rester : le rôle annoncé. À vérifier au clavier (Tab) et dans le panneau
 * d'accessibilité — le premier s'annonce « bouton », le second « lien », et le troisième « lien,
 * se abre en una pestaña nueva ».
 */
export const BoutonOuLien: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Legende>Button — agit sur place (soumettre, ajouter au panier)</Legende>
        <div>
          <Button>Añadir al carrito</Button>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Legende>LinkButton interne — navigue, garde le préfixe de locale</Legende>
        <div>
          <LinkButton href="/pago">Ir al pago</LinkButton>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Legende>LinkButton externe — nouvel onglet, annoncé, rel posé par construction</Legende>
        <div>
          <LinkButton
            href="https://tickets.example.com/evento-guatape"
            external
            newTabLabel="(se abre en una pestaña nueva)"
            iconAfter={<FlecheSortante />}
          >
            Reservar en el sitio del organizador
          </LinkButton>
        </div>
      </div>
    </div>
  ),
};

/**
 * Les trois tailles. ⚠️ Seule `lg` (le défaut) atteint les 44 px de cible tactile exigés par
 * components/README.md sur mobile : à vérifier en Mobile 390, où la mesure est affichée.
 */
export const Tailles: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(["lg", "md", "sm"] as const).map((size) => (
        <div key={size} className="flex items-center gap-3">
          <span className="w-8 shrink-0 text-xs text-muted">{size}</span>
          <LinkButton href="/pago" size={size} testId={`lien-${size}`}>
            Reservar
          </LinkButton>
          <Hauteur cible={`lien-${size}`} />
        </div>
      ))}
    </div>
  ),
};

// Affiche la hauteur réellement rendue d'un lien, relue dans le DOM : écrire « 44 px » à la main
// dans une légende la rendrait fausse au premier changement de thème.
function Hauteur({ cible }: { cible: string }) {
  const [px, setPx] = React.useState<number | null>(null);
  const attacher = React.useCallback(
    (noeud: HTMLSpanElement | null) => {
      if (!noeud) return;
      const el = document.querySelector(`[data-testid="${cible}"]`);
      if (el) setPx(Math.round(el.getBoundingClientRect().height));
    },
    [cible]
  );
  return (
    <span ref={attacher} className={px !== null && px < 44 ? "text-xs text-danger" : "text-xs text-muted"}>
      {px === null ? "" : `${px} px`}
      {px !== null && px < 44 ? " — sous la cible tactile" : ""}
    </span>
  );
}

/** Pleine largeur, pour les écrans où le lien est l'action unique du bas de page. */
export const PleineLargeur: Story = { args: { width: "full" } };

/**
 * ⚠️ CONSTAT, NON CORRIGÉ ICI. `.button` de HeroUI porte `whitespace-nowrap` : un libellé long ne
 * passe pas à la ligne, il élargit le bouton jusqu'à faire déborder la page — ce que
 * components/README.md interdit.
 *
 * Ce n'est PAS un défaut de `LinkButton` : mesuré ci-dessous, un `<button>` et un `<a>` portant les
 * mêmes classes rendent exactement la même largeur. Le correctif appartient donc à `Button` et à
 * `LinkButton` ensemble, pas à l'un des deux — le corriger ici seul recréerait précisément la
 * divergence que ce lot cherche à empêcher.
 *
 * Le libellé réellement employé en production (« Reservar en el sitio del organizador », le lien
 * evento de ProductDetailView) tient, lui, dans 390 px : la deuxième ligne le montre.
 *
 * Les deux paires sont rognées par leur conteneur (`overflow-hidden`) pour que cette story ne
 * fasse pas défiler la page du playground ; en production, c'est la page qui déborde.
 */
export const LibelleLong: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <PaireLargeur libelle="Reservar esta habitación privada con vista al lago para dos personas" />
      <PaireLargeur libelle="Reservar en el sitio del organizador" />
    </div>
  ),
};

function PaireLargeur({ libelle }: { libelle: string }) {
  const [mesure, setMesure] = React.useState<{ bouton: number; lien: number; place: number } | null>(null);
  const attacher = React.useCallback((noeud: HTMLDivElement | null) => {
    if (!noeud) return;
    const b = noeud.querySelector("button");
    const l = noeud.querySelector("a");
    if (b && l) {
      setMesure({
        bouton: Math.round(b.getBoundingClientRect().width),
        lien: Math.round(l.getBoundingClientRect().width),
        place: Math.round(noeud.getBoundingClientRect().width),
      });
    }
  }, []);
  const deborde = mesure !== null && mesure.lien > mesure.place;
  return (
    <div className="flex flex-col gap-1">
      <div ref={attacher} className="flex flex-col gap-2 overflow-hidden">
        <Button>{libelle}</Button>
        <LinkButton href="/pago">{libelle}</LinkButton>
      </div>
      <Legende>
        {mesure === null
          ? ""
          : `Button ${mesure.bouton} px · LinkButton ${mesure.lien} px · place disponible ${mesure.place} px — ${
              mesure.bouton === mesure.lien ? "largeurs identiques" : "LARGEURS DIFFÉRENTES"
            }${deborde ? ", et les deux débordent" : ", et les deux tiennent"}`}
      </Legende>
    </div>
  );
}
