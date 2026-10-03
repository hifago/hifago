import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Image } from "./Image";

// Une vraie photo de `mockData/`, servie par Storybook sous `/mock` : pas d'URL distante et le
// pipeline matriciel de `next/image` reste visible dans la story.
const SRC = "/mock/activities/kayak1/photos/1.jpeg";

// La valeur de `sizes` reprise de la production (CatalogBrowser.tsx:98) plutôt qu'inventée : c'est
// celle d'une grille à une colonne sous 640 px, deux au-delà.
const SIZES = "(max-width: 640px) 100vw, 50vw";

const meta = {
  title: "Affichage/Image",
  component: Image,
  parameters: { layout: "padded" },
  // `loading: "lazy"` en défaut de story, jamais en défaut du composant : la prop est obligatoire
  // exprès (2026-09-02), et lui donner une valeur par défaut ici ne fait que dispenser CHAQUE
  // story de la réécrire — pas les appelants.
  args: {
    src: SRC,
    alt: "Vue du Embalse de Guatapé depuis la colline",
    sizes: SIZES,
    loading: "lazy",
  },
} satisfies Meta<typeof Image>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaut: Story = {};

// ⚠️ L'état le plus fréquent du catalogue réel, pas un cas limite : beaucoup de produits n'ont
// aucune photo. Le bloc garde le ratio, donc la carte qui l'accueille ne s'effondre pas et la
// grille ne saute pas d'une ligne à l'autre.
export const SansImage: Story = { args: { src: null } };

export const Carre: Story = { args: { ratio: "1/1" } };

export const Panoramique: Story = { args: { ratio: "16/9" } };

// ⚠️ La seule story du fichier dont la différence ne se VOIT pas — et c'est justement ce qu'elle
// documente. Mesuré sur Next 16.3.0, pas supposé (cf. Image.test.tsx) :
//   • `"lazy"`     → `<img loading="lazy">`, l'image n'est cherchée qu'à l'approche du viewport ;
//   • `"priority"` → la balise perd `loading` et NE GAGNE RIEN (pas de `loading="eager"`, et plus
//     de `fetchpriority="high"` depuis Next 16) ; l'effet réel est un
//     `<link rel="preload" as="image">` injecté dans le `<head>`, qui fait découvrir l'image au
//     navigateur sans attendre la mise en page.
// À inspecter dans l'onglet Éléments du navigateur, pas à l'œil. La valeur se change aussi depuis
// les contrôles de la barre latérale, sur n'importe quelle story du fichier.
export const Chargement: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      {(["priority", "lazy"] as const).map((valeur) => (
        <div key={valeur} className="flex items-start gap-3">
          <span className="w-20 shrink-0 text-xs text-muted">{valeur}</span>
          <div className="w-40">
            {/* `alt` répété après le spread : cf. le commentaire de TousLesRatios. */}
            <Image {...args} alt={args.alt} loading={valeur} />
          </div>
          <p className="text-xs text-muted">
            {valeur === "priority"
              ? "Au-dessus de la ligne de flottaison — c'est le LCP. Pose un <link rel=preload> dans le <head>."
              : "Tout le reste. Pose loading=\"lazy\" sur la balise."}
          </p>
        </div>
      ))}
    </div>
  ),
};

// Les trois ratios côte à côte, avec et sans visuel : c'est la vue qui prouve que le substitut
// occupe exactement la même place que l'image qu'il remplace.
export const TousLesRatios: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      {(["4/3", "16/9", "1/1"] as const).map((ratio) => (
        <div key={ratio} className="flex items-start gap-3">
          <span className="w-12 shrink-0 text-xs text-muted">{ratio}</span>
          <div className="w-40">
            {/* `alt` est répété après le spread uniquement pour jsx-a11y/alt-text : la règle ne
                sait pas lire un alt qui arrive par `{...args}` et avertit sur un composant nommé
                `Image`. La valeur est la même — c'est du bruit d'outil, pas une correction. */}
            <Image {...args} alt={args.alt} ratio={ratio} />
          </div>
          <div className="w-40">
            <Image {...args} alt={args.alt} src={null} ratio={ratio} />
          </div>
        </div>
      ))}
    </div>
  ),
};

// Conteneur étroit : l'atome ne fixe aucune largeur, il prend celle de son parent et ne déborde
// pas. Sans ça, une image trop large sortirait de sa carte et ferait défiler la PAGE
// horizontalement — le défaut que le README interdit explicitement. À vérifier en Mobile 390.
export const DansUnConteneurEtroit: Story = {
  render: (args) => (
    <div className="w-24 border border-border p-1">
      <Image {...args} alt={args.alt} />
    </div>
  ),
};
