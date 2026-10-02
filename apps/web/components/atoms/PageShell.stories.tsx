import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PageShell } from "./PageShell";

// Les trois gabarits de page de la vitrine, côte à côte pour la première fois. Jusqu'ici ils
// n'existaient que recopiés dans huit fichiers de app/[locale]/**, donc invisibles ensemble : la
// dérive `gap-4`/`gap-6` a vécu comme ça.
//
// À regarder en gabarit Mobile 390 (actif par défaut) ET Desktop 1280 : `large` et `narrow` ne se
// distinguent qu'au-delà de 672 px, et `p-6 sm:p-8` ne se voit que sur le petit.
const meta = {
  title: "Structure/PageShell",
  component: PageShell,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      // Reproduit le conteneur réel : app/[locale]/layout.tsx rend
      // <body class="min-h-full flex flex-col">. Sans parent flex, le `flex-1` de la coquille
      // n'aurait aucun effet et la story mentirait sur ce que voit un visiteur — `centered`, qui
      // centre verticalement, ne montrerait rien du tout.
      <div className="flex min-h-screen flex-col">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PageShell>;

export default meta;
type Story = StoryObj<typeof meta>;

// Bloc de démonstration : la coquille n'a aucun rendu propre, il faut du contenu pour voir où
// s'arrête sa largeur. Bordure plutôt que fond — le thème vitrine ne définit aucun token de
// couleur (cf. story Playground/Tokens), un aplat serait un pari.
function Bloc({ children }: { children: React.ReactNode }) {
  return <div className="rounded border border-[var(--border)] p-4 text-sm">{children}</div>;
}

// accueil, index de catégories, listings, établissement, fiche produit — une GRILLE à trois
// colonnes depuis le 2026-10-01 : `1fr | lecture (704 px à 1280) | 1fr`. À regarder en Desktop 1280,
// c'est là que tout se joue ; en Mobile 390 les deux blocs se superposent et la story ne montre rien.
export const Large: Story = {
  args: {
    variant: "large",
    children: (
      <>
        <Bloc>Contenu large&nbsp;: le catalogue et la page établissement.</Bloc>
        <Bloc>Le second bloc rend visible le `gap-y-6` qui sépare les enfants.</Bloc>
      </>
    ),
  },
};

// ⚠️ LA story de cette coquille : l'enfant marqué `data-bleed` sort de la colonne de lecture et
// touche les deux bords du viewport, pendant que ses voisins restent alignés sur elle. C'est ce que
// `SeccionOfertas` utilise pour ses rangées de cartes (décision de Jérôme, 2026-10-01), et c'est la
// seule façon de VOIR que la marque fonctionne — en jsdom, aucun test ne calcule une largeur.
export const LargeAvecFondPerdu: Story = {
  args: {
    variant: "large",
    children: (
      <>
        <Bloc>Un bloc ordinaire&nbsp;: colonne de lecture, 704&nbsp;px à 1280.</Bloc>
        <div
          data-bleed=""
          className="bg-[var(--surface-secondary)] p-4 text-center text-sm"
        >
          `data-bleed`&nbsp;: d&apos;un bord à l&apos;autre, sans unité `vw`.
        </div>
        <Bloc>Le bloc suivant retrouve la colonne, sans rien savoir du précédent.</Bloc>
      </>
    ),
  },
};

// fiche produit, checkout, commandes — max-w-2xl (576 px). Plus étroit parce qu'on y lit et qu'on y
// remplit un formulaire, deux gestes qui souffrent des lignes longues.
export const Narrow: Story = {
  args: {
    variant: "narrow",
    children: (
      <>
        <Bloc>Contenu étroit&nbsp;: fiche produit, panier, commandes.</Bloc>
        <Bloc>Comparer avec `Large` à 1280&nbsp;px&nbsp;: 96&nbsp;px d&apos;écart.</Bloc>
      </>
    ),
  },
};

// login, signup, verify-email — centré vertical ET horizontal, sans largeur maximale : ces pages
// n'ont qu'une carte au milieu de l'écran.
export const Centered: Story = {
  args: {
    variant: "centered",
    children: <Bloc>Un formulaire court, seul au centre de la page.</Bloc>,
  },
};

// ⚠️ L'état limite qui compte pour une coquille : la page ne défile JAMAIS horizontalement
// (components/README.md). Un tableau et un bloc de code plus larges que 390 px sont ici chacun dans
// leur propre conteneur `overflow-x-auto` — c'est le contenu qui défile, pas la page.
//
// Ce que cette story prouve, et sa limite : la coquille borne bien sa largeur (`w-full`), mais elle
// ne peut PAS rattraper un enfant qui déborde sans son propre conteneur scrollable — retirer un
// `overflow-x-auto` ci-dessous fait aussitôt défiler la page entière. La règle reste donc à la
// charge de l'appelant ; la coquille ne la garantit pas seule.
//
// ⚠️ Et le corollaire, découvert en passant l'audit axe sur cette story même (2026-09-01) :
// `overflow-x-auto` SEUL est une violation a11y sérieuse (`scrollable-region-focusable`, WCAG
// 2.1.1) — une région qui défile mais qu'aucun tabstop n'atteint est inutilisable au clavier. Il
// faut `tabIndex={0}` + un nom accessible (`role="region"` + `aria-label`). Le pattern « contenu
// large dans son propre conteneur » de components/README.md ne le dit pas encore ; signalé au
// coordinateur, la correction du README n'est pas dans mon périmètre.
export const ContenuLong: Story = {
  args: {
    variant: "large",
    children: (
      <>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Tabla de reservas">
          <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
            <thead>
              <tr>
                <th className="border-b border-[var(--border)] p-2">Fecha</th>
                <th className="border-b border-[var(--border)] p-2">Producto</th>
                <th className="border-b border-[var(--border)] p-2">Establecimiento</th>
                <th className="border-b border-[var(--border)] p-2">Estado</th>
                <th className="border-b border-[var(--border)] p-2">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-2">2026-09-14</td>
                <td className="p-2">Recorrido guiado en lancha por el Embalse</td>
                <td className="p-2">Casa Kayam Guatapé</td>
                <td className="p-2">Confirmada</td>
                <td className="p-2">$ 240.000</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Ejemplo de petición">
          <pre className="text-xs">
            {"GET /api/pms/night-availability?product=alojamiento-demo&from=2026-09-14&to=2026-09-21&guests=2"}
          </pre>
        </div>
        {/* Troisième forme de débordement, la plus sournoise parce qu'elle ne ressemble pas à du
            contenu large : un mot SANS AUCUNE césure possible — une référence de commande, un
            identifiant. `break-words` est ici obligatoire, pas décoratif : mesuré à 390 px, le
            retirer fait passer la page à 453 px de large, donc la fait défiler.
            ⚠️ Une URL longue, elle, ne prouverait RIEN : ses tirets et ses barres obliques sont
            autant d'endroits où le navigateur coupe tout seul (vérifié — mesure identique avec et
            sans `break-words`). Le cas limite n'est pas « c'est long », c'est « c'est insécable ». */}
        <div className="rounded border border-[var(--border)] p-4 text-sm break-words">
          Referencia HIFAGO20260914CASAKAYAMGUATAPE0000000000000000000042
        </div>
      </>
    ),
  },
};
