import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useRef, useState } from "react";
import { Button, type ButtonColor, type ButtonVariant } from "./Button";
import { IconButton } from "./IconButton";
import { composer, contraste, resoudre } from "../playground/contraste";
import { Legende } from "../playground/Legende";

// Le playground du bouton de la vitrine. Il est fait pour être REGARDÉ d'un coup d'œil, pas
// manipulé contrôle par contrôle : chaque story montre un axe entier à la fois.
//
// À voir aux deux gabarits (Mobile 390 par défaut, Desktop 1280) : depuis le plan 41 (item F4),
// les hauteurs NE changent PLUS au breakpoint `md` — 44 px au moins partout (story `Tailles`).
const meta = {
  title: "Actions/Button",
  component: Button,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

const VARIANTS: ButtonVariant[] = ["solid", "soft", "outline", "ghost"];
const COLORS: ButtonColor[] = ["accent", "neutral", "danger"];

// Icônes inline, volontairement : `lucide-react` est présent dans node_modules mais déclaré par
// packages/ui, PAS par apps/web — l'importer ici créerait une dépendance fantôme, celle qui a cassé
// le build Vercel le 2026-08-23 (le hoisting npm local la masque, l'install scopée la révèle).
// Le composant ne connaît donc aucune bibliothèque d'icônes : il reçoit un ReactNode.
const FlecheDroite = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
const Panier = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M6 6h15l-1.5 9h-12z" />
    <circle cx="9" cy="20" r="1" />
    <circle cx="18" cy="20" r="1" />
  </svg>
);
const Croix = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Contraste mesuré EN DIRECT, pas recopié.
//
// ⚠️ Écrire les ratios en dur dans un commentaire les rend faux au premier changement de jeton.
// Mesuré ici, le chiffre affiché sous chaque bouton reste vrai par construction et dit
// immédiatement si un changement de thème casse une combinaison.
//
// La composition (les fonds `soft` sont semi-transparents) est faite par le navigateur lui-même
// via un canvas 1×1 : aucun parsing d'oklch/color-mix à écrire, et le résultat est celui affiché.
function contrasteMesure(bouton: HTMLElement): number | null {
  // ⚠️ Le fond de référence est celui d'une PAGE de la vitrine (`--background`), pas celui du body
  // de Storybook, que le playground ne peint pas. `resoudre` fait évaluer la custom property par
  // le moteur sur un élément réel au lieu de transmettre son expression CSS brute au canvas.
  // Posé sur une SURFACE (`data-superficie`, plan 41 F3), le fond de référence est le sien : le
  // bouton marine se mesure sur l'or, pas sur le clair.
  const surface = bouton.closest("[data-superficie]");
  const sonde = document.createElement("div");
  document.body.appendChild(sonde);
  let fondPage = surface ? getComputedStyle(surface).backgroundColor : resoudre(sonde, "var(--background)");
  sonde.remove();
  if (!fondPage || fondPage === "rgba(0, 0, 0, 0)") fondPage = "rgb(255,255,255)";

  const style = getComputedStyle(bouton);
  // Les fonds `soft` sont semi-transparents : un aplat n'a de contraste réel qu'une fois posé sur
  // son fond, d'où l'empilement plutôt qu'une lecture directe.
  const fondBouton = composer([fondPage, style.backgroundColor]);
  const texte = composer([fondPage, style.backgroundColor, style.color]);
  return Math.round(contraste(texte, fondBouton) * 100) / 100;
}

/** Affiche le bouton et, sous lui, le contraste WCAG réellement rendu. Seuil du texte : 4.5:1. */
function AvecContraste({ legende, children }: { legende: string; children: React.ReactNode }) {
  const conteneur = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    const bouton = conteneur.current?.querySelector("button");
    if (!bouton) return;
    const mesurer = () => setRatio(contrasteMesure(bouton));
    // ⚠️ Deux mesures, et le délai n'est PAS une précaution en l'air : `.button` de HeroUI porte
    // `transition: background-color 100ms`. Une mesure prise juste après un changement de thème
    // lit une couleur EN COURS D'ANIMATION — constaté en comparant les chiffres affichés à un
    // recalcul externe : la story annonçait 3.57:1 (la couleur de départ) là où le bouton rendait
    // déjà 5.93:1. On mesure donc une fois tout de suite, et une fois la transition finie.
    const planifier = () => {
      mesurer();
      return window.setTimeout(mesurer, 250);
    };
    let minuteur = planifier();
    // L'addon pose `data-theme` sur <html> APRÈS le montage : le contraste doit être recalculé si
    // le thème vitrine/admin change dans la barre d'outils.
    const observateur = new MutationObserver(() => {
      window.clearTimeout(minuteur);
      minuteur = planifier();
    });
    observateur.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      window.clearTimeout(minuteur);
      observateur.disconnect();
    };
  }, []);
  const passe = ratio === null || ratio >= 4.5;
  return (
    <div ref={conteneur} className="flex flex-col items-start gap-1">
      {children}
      {/* ⚠️ `text-danger` (le jeton brut) est lui-même à 3.56:1 sur fond blanc — mesuré en
          écrivant cette story, et signalé par axe. C'est `--danger-soft-foreground` qui est la
          couleur de TEXTE de la famille (6.74:1) : un avertissement de contraste illisible aurait
          été une jolie ironie. Le mot « sous 4.5 » porte l'information, pas la couleur seule. */}
      <span
        className={
          passe ? "text-xs text-muted" : "text-xs font-medium [color:var(--danger-soft-foreground)]"
        }
      >
        {legende} · {ratio === null ? "…" : `${ratio}:1`}
        {passe ? "" : " ⚠ sous 4.5"}
      </span>
    </div>
  );
}

// ⚠️ LA story de ce lot : les deux axes que HeroUI ne sépare pas. Quatre formes × trois couleurs,
// et chaque case est une combinaison réellement atteignable — « outline en rouge » n'existe pas
// dans le `variant` à 7 valeurs de HeroUI.
export const Matrice: Story = {
  args: {
    children: "Reservar",
    variant: "solid"
  },
  render: (args) => (
    <div className="flex flex-col gap-6">
      <Legende>
        Le chiffre sous chaque bouton est son contraste WCAG mesuré au rendu, pas une valeur
        recopiée : il suit les jetons du thème. Seuil du texte : 4.5:1.
      </Legende>
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex flex-col gap-2">
          <Legende>{variant}</Legende>
          <div className="flex flex-wrap items-center gap-3">
            {COLORS.map((color) => (
              <AvecContraste key={color} legende={color}>
                <Button {...args} variant={variant} color={color} />
              </AvecContraste>
            ))}
          </div>
        </div>
      ))}
    </div>
  ),
};

// Mesure la hauteur RENDUE plutôt que de l'écrire en dur : une valeur recopiée deviendrait fausse
// en silence au premier changement de HeroUI ou des classes de taille.
function AvecHauteur({ children }: { children: React.ReactNode }) {
  const conteneur = useRef<HTMLDivElement>(null);
  const [hauteur, setHauteur] = useState<number | null>(null);
  useEffect(() => {
    const bouton = conteneur.current?.querySelector("button");
    if (!bouton) return;
    const mesurer = () => setHauteur(Math.round(bouton.getBoundingClientRect().height));
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(bouton);
    return () => observateur.disconnect();
  }, []);
  return (
    <div ref={conteneur} className="flex flex-col items-start gap-1">
      {children}
      <Legende>{hauteur === null ? "…" : `${hauteur} px`}</Legende>
    </div>
  );
}

// ⚠️ La règle des 44 px de components/README.md, mise à l'épreuve (plan 41, item F4). HeroUI
// rétrécit chaque taille de 4 px à partir de `md` ; les classes de taille de l'atome l'en empêchent :
// `sm` et `md` font 44 px, `lg` 48 px, sur Mobile 390 comme sur Desktop 1280. Même rayon partout.
export const Tailles: Story = {
  args: { children: "Reservar" },
  render: (args) => (
    <div className="flex flex-wrap items-end gap-4">
      <AvecHauteur>
        <Button {...args} size="sm">
          sm
        </Button>
      </AvecHauteur>
      <AvecHauteur>
        <Button {...args} size="md">
          md (défaut)
        </Button>
      </AvecHauteur>
      <AvecHauteur>
        <Button {...args} size="lg">
          lg (conversion)
        </Button>
      </AvecHauteur>
    </div>
  ),
};

// Force les attributs que react-aria pose lui-même (`data-hovered`, `data-pressed`,
// `data-focus-visible`) pour rendre les états VISIBLES côte à côte, sans avoir à survoler chaque
// bouton. Ce sont exactement les sélecteurs du CSS de HeroUI — ce n'est donc pas une imitation :
// c'est le vrai style, dans un état figé. Les états réels se voient dans la story `Actions`.
function EtatForce({ attribut, children }: { attribut?: string; children: React.ReactNode }) {
  const conteneur = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!attribut) return;
    conteneur.current?.querySelector("button")?.setAttribute(attribut, "true");
  }, [attribut]);
  return <div ref={conteneur}>{children}</div>;
}

export const Etats: Story = {
  args: { children: "Pagar" },
  render: (args) => (
    <div className="flex flex-col gap-6">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex flex-col gap-2">
          <Legende>{variant}</Legende>
          <div className="flex flex-wrap items-center gap-3">
            {[
              { cle: "defaut", libelle: "défaut", attribut: undefined },
              { cle: "survol", libelle: "survol", attribut: "data-hovered" },
              { cle: "focus", libelle: "focus clavier", attribut: "data-focus-visible" },
              { cle: "presse", libelle: "pressé", attribut: "data-pressed" },
            ].map(({ cle, libelle, attribut }) => (
              <div key={cle} className="flex flex-col items-start gap-1">
                <EtatForce attribut={attribut}>
                  <Button {...args} variant={variant} />
                </EtatForce>
                <Legende>{libelle}</Legende>
              </div>
            ))}
            <div className="flex flex-col items-start gap-1">
              <Button {...args} variant={variant} isDisabled />
              <Legende>désactivé</Legende>
            </div>
            {/* ⚠️ L'état qui absorbe une duplication réelle : cinq écrans écrivent aujourd'hui
                `isDisabled={isSubmitting}` PLUS un libellé ternaire. Ici une prop, et le libellé de
                remplacement reçu déjà traduit. */}
            <div className="flex flex-col items-start gap-1">
              <Button {...args} variant={variant} isPending pendingLabel="Enviando…" />
              <Legende>en cours</Legende>
            </div>
          </div>
        </div>
      ))}
    </div>
  ),
};

// La couleur `marine` (plan 41, item F4) : l'action principale posée sur une SURFACE OR, où un
// bouton or disparaîtrait. Le chiffre est mesuré sur l'or (le fond de la surface), pas sur le clair.
export const SurLOr: Story = {
  args: { children: "Ver alojamientos" },
  render: (args) => (
    <div data-superficie="or" className="flex flex-col gap-6 rounded-[16px] p-6">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex flex-col gap-2">
          <Legende>{variant}</Legende>
          <div className="flex flex-wrap items-center gap-3">
            <AvecContraste legende="marine">
              <Button {...args} variant={variant} color="marine" />
            </AvecContraste>
          </div>
        </div>
      ))}
      <Legende>
        Sur l&apos;or, l&apos;action principale est marine + texte blanc ; un bouton or y perd son
        contour. Sur une surface claire, elle reste or + texte marine (`accent`).
      </Legende>
    </div>
  ),
};

// Avant, après, et seule (via IconButton, qui exige un libellé accessible).
export const AvecIcone: Story = {
  args: { children: "Añadir al carrito" },
  render: (args) => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button {...args} iconBefore={<Panier />} />
        <Legende>iconBefore</Legende>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button {...args} iconAfter={<FlecheDroite />}>
          Continuar
        </Button>
        <Legende>iconAfter</Legende>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <IconButton icon={<Croix />} label="Quitar del carrito" />
        <IconButton icon={<Croix />} label="Quitar del carrito" variant="soft" color="danger" />
        <IconButton icon={<Panier />} label="Ver carrito" variant="solid" color="accent" />
        <Legende>
          IconButton — le libellé est requis, il devient le nom accessible. Formes, tailles et
          états complets : story « Actions/IconButton ».
        </Legende>
      </div>
    </div>
  ),
};

// Le cas mobile : sur un écran de 390 px, l'action principale d'un formulaire prend toute la
// largeur. `width="full"` remplace le `className="w-fit"`/pleine largeur écrit à la main.
export const PleineLargeur: Story = {
  args: { children: "Confirmar y pagar" },
  render: (args) => (
    <div className="flex max-w-sm flex-col gap-3">
      <Button {...args} width="full" />
      <Button {...args} width="full" variant="outline" color="neutral">
        Seguir comprando
      </Button>
      <Legende>À regarder en Mobile 390 : c&apos;est la disposition réelle du checkout.</Legende>
    </div>
  ),
};

// ⚠️ La story cliquable : le clic atterrit, le survol se voit, le focus clavier se voit (Tab), et
// l'état pressé se voit (maintenir). Les trois derniers sont ici RÉELS, contrairement à `Etats`.
function Demonstration() {
  const [compteur, setCompteur] = useState(0);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button onPress={() => setCompteur((n) => n + 1)}>Añadir al carrito</Button>
        <Button variant="outline" color="neutral" onPress={() => setCompteur(0)}>
          Vaciar
        </Button>
        <span className="text-sm font-medium" data-testid="compteur">
          Carrito : {compteur}
        </span>
      </div>

      {/* Le vrai cycle d'un envoi : un clic, deux secondes en cours, retour. C'est ce que font les
          cinq formulaires de l'app — sauf qu'ils l'écrivent à la main. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          isPending={envoiEnCours}
          pendingLabel="Enviando…"
          onPress={() => {
            setEnvoiEnCours(true);
            setTimeout(() => setEnvoiEnCours(false), 2000);
          }}
        >
          Confirmar reserva
        </Button>
        <Legende>2 s en cours, puis retour — le focus reste sur le bouton</Legende>
      </div>

      <Legende>
        Survoler, tabuler (l&apos;anneau de focus doit rester visible), maintenir enfoncé pour voir
        l&apos;enfoncement.
      </Legende>
    </div>
  );
}

export const Actions: Story = {
  args: { children: "" },
  render: () => <Demonstration />,
};
