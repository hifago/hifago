import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Card } from "@/components/atoms/Card";
import { Price } from "@/components/atoms/Price";
import { PhotoStrip, type PhotoStripPhoto } from "./PhotoStrip";

// Vraies photos de `mockData/`, servies par Storybook sous `/mock` : les stories restent locales et
// exercent aussi le pipeline matriciel de `next/image`.
const VISUELS = [
  "/mock/activities/kayak1/photos/1.jpeg",
  "/mock/activities/partyboat1/photos/1.jpg",
  "/mock/activities/yoga-session/photos/1.webp",
  "/mock/establishments/bania/photos/1.jpeg",
];

// La valeur employée en production sur la fiche produit (ProductPhotos.tsx:26).
const SIZES = "(max-width: 640px) 100vw, 640px";

// `decalage` fait démarrer chaque bande sur un visuel différent. Ce n'est pas cosmétique : sans lui,
// toutes les cartes de la grille partagent la même première photo, `ReactDOM.preload` dédoublonne
// par URL, et le nombre de preloads mesuré dans la story vaut 1 au lieu du vrai.
function photos(nombre: number, decalage = 0): PhotoStripPhoto[] {
  return Array.from({ length: nombre }, (_, i) => ({
    id: `photo-${decalage}-${i}`,
    alt: `Vue ${i + 1} de la cabaña sur le Embalse de Guatapé`,
    url: VISUELS[(i + decalage) % VISUELS.length],
  }));
}

const meta = {
  title: "Affichage/PhotoStrip",
  component: PhotoStrip,
  parameters: { layout: "padded" },
  // `loading: "priority"` en défaut de STORY, jamais en défaut du composant : l'usage de référence
  // est la galerie d'une fiche produit, qui est bien au-dessus de la ligne de flottaison. La story
  // `DansUneCarte` le remet à `"lazy"`, et c'est tout l'intérêt de la prop.
  args: { photos: photos(4), sizes: SIZES, loading: "priority" },
} satisfies Meta<typeof PhotoStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaut: Story = {};

// Une seule photo : ni flèches ni points. C'est le Carousel qui l'assure (règle §8 du spec,
// comportement legacy conservé), pas PhotoStrip — cette story existe pour qu'on le VOIE, parce que
// c'est le cas le plus fréquent d'une fiche réelle après la photo de couverture.
export const UnePhoto: Story = { args: { photos: photos(1) } };

// ⚠️ Différence de comportement ASSUMÉE avec `ProductPhotos`, qui ne rendait rien du tout : le bloc
// garde sa place et son ratio, comme le fait déjà l'atome `Image` dans la grille du catalogue. À
// arbitrer par Jérôme au moment de migrer les pages (cf. l'en-tête du composant) — c'est le repli
// générique demandé par le §9 de docs/specs/04-gestion-images.md.
export const AucunePhoto: Story = { args: { photos: [] } };

// ⚠️ Un SVG très haut, écrit en `data:` plutôt qu'ajouté à public/ : un fichier d'exemple
// dans public/ serait servi en production pour une story. Le pendant large est une vraie photo.
const TRES_HAUTE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 1200'%3E" +
  "%3Crect width='100' height='1200' fill='%23c7d2fe'/%3E" +
  "%3Crect width='100' height='300' fill='%236366f1'/%3E%3C/svg%3E";

// Le cas qui casse une galerie en production : une photo qui n'est pas au ratio du gabarit. Le
// conteneur de l'atome impose le sien et `object-cover` rogne — donc la bande garde sa hauteur, les
// slides restent alignés, et rien ne déborde. C'est la story à regarder en Mobile 390 : une galerie
// est l'endroit du site où un défilement horizontal apparaît le plus facilement.
export const FormatInattendu: Story = {
  args: {
    photos: [
      { id: "large", alt: "Panorama très large du barrage", url: VISUELS[1] },
      { id: "haute", alt: "Le Peñón photographié en très haut format", url: TRES_HAUTE },
      { id: "normale", alt: "Vue de la cabaña", url: VISUELS[3] },
    ],
  },
};

// La bande ne fixe aucune largeur : elle prend celle de son parent. Sans ça, une galerie sortirait
// de sa carte et ferait défiler la PAGE horizontalement — le défaut que components/README.md
// interdit explicitement, et le plus probable sur ce composant précis.
export const DansUnConteneurEtroit: Story = {
  render: (args) => (
    <div className="w-48 border border-border p-1">
      <PhotoStrip {...args} />
    </div>
  ),
};

// ⚠️ La bande DANS une carte — la composition qui compte, parce que c'est là qu'un carrousel finit
// toujours. Rien n'a été ajouté à l'atome `Card` pour la rendre possible : son `media` accepte déjà
// n'importe quel ReactNode, la bande y remplace l'`<Image>` telle quelle. En `stack`, le `media`
// annule le `p-4` de la carte et se fait rogner au rayon des angles — donc la bande vient à fleur
// de carte, flèches et points compris.
//
// ⚠️ Ce qu'il faut ESSAYER À LA SOURIS ici, et pas seulement regarder : la carte de droite est
// CLIQUABLE (`href`). Son titre porte un `::after` étiré sur toute la surface, donc tout clic
// devrait naviguer — sauf que les flèches et les points du carrousel sont des `<button>`, et que
// `Card` remonte tout enfant interactif au-dessus de cet overlay (`ENFANTS_INTERACTIFS_CLASS`).
// Cliquer une flèche change donc la photo SANS partir sur la fiche, et cliquer la photo elle-même
// navigue. C'est ce qui rend la composition viable ; c'est aussi ce qui casserait en silence si
// quelqu'un touchait au z-index de la carte.
//
// ⚠️ Ce que cette story n'est PAS : le catalogue réel. `app/[locale]/page.tsx` ne remonte
// aujourd'hui qu'UNE photo par produit (`imageUrl`, au singulier) — brancher la bande sur la
// grille du catalogue demande d'abord que la requête serve la galerie, ce qui est une décision de
// page, pas de composant.
const CATALOGUE = [
  { titre: "Habitación privada con vista al lago", prix: 180000, photos: photos(4, 0) },
  { titre: "Cabaña entera sobre el embalse", prix: 420000, photos: photos(2, 1) },
  { titre: "Tour en lancha al Peñón", prix: 95000, photos: photos(1, 2) },
  { titre: "Camping junto al agua", prix: 60000, photos: [] },
];

export const DansUneCarte: Story = {
  render: (args) => (
    // Grille du catalogue reprise telle quelle de CatalogBrowser.tsx:92 — une colonne sous 640 px,
    // deux au-delà. C'est à 390 px que le débordement horizontal apparaîtrait, s'il devait
    // apparaître quelque part.
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {CATALOGUE.map((produit, i) => (
        <Card
          key={produit.titre}
          title={produit.titre}
          titleAs="h3"
          // Une carte sur deux est cliquable : c'est la seule façon de VOIR côte à côte que les
          // flèches restent au-dessus de l'overlay du lien dans un cas et n'ont rien à franchir
          // dans l'autre.
          href={i % 2 === 1 ? `/productos/exemple-${i}` : undefined}
          // ⚠️ `loading="lazy"`, et c'est LE point de cette story : une grille de cartes n'est pas
          // au-dessus de la ligne de flottaison. Sans ce réglage, chaque carte préchargeait sa
          // première photo — mesuré à 3 preloads pour 3 cartes, donc 20 sur un vrai catalogue.
          media={<PhotoStrip {...args} photos={produit.photos} loading="lazy" />}
          testId={`carte-catalogue-${i}`}
        >
          <Price amountCop={produit.prix} locale="es" />
        </Card>
      ))}
    </div>
  ),
};
