import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { Locale } from "@/messages";
import type { TarjetaOferta as OfertaTarjeta } from "@/lib/catalog/tipos";
import { PageShell } from "@/components/atoms/PageShell";
import { SeccionOfertas } from "./SeccionOfertas";

// Une section de l'accueil (spec 28 §5). Ce qui se juge ici ne se juge QUE dans le playground :
// le passage de 1 à 2 puis 3 colonnes, et surtout la dernière rangée incomplète — sept cartes sur
// trois colonnes laissent un trou, huit sur deux colonnes n'en laissent aucun. À regarder aux
// trois gabarits de la barre d'outils (390, 768, 1280), et dans les deux langues : l'espagnol est
// 20 à 25 % plus long que l'anglais, et c'est le titre de section qui déborde en premier.
//
// ⚠️ La carte N'EST PAS doublée ici, contrairement au test : une story qui montrerait des rectangles
// gris ne dirait rien de la mise en page réelle (la hauteur d'une carte dépend de ses photos et de
// la longueur de son nom, et c'est exactement ce qui fait ou casse une grille).
//
// Le contexte i18n vient du décorateur global de `.storybook/preview.tsx` — aucune story de ce
// dépôt ne monte son propre `NextIntlClientProvider`, et le sélecteur de langue de la barre
// d'outils ne fonctionnerait plus si l'une le faisait.

// Les visuels réellement présents dans apps/web/public — même règle que les stories de `Image` et
// de `PhotoStrip` : une story ne dépend jamais du réseau pour s'afficher.
const VISUELS = ["/globe.svg", "/window.svg", "/file.svg", "/vercel.svg"];

const NOMBRES = [
  "Kayak en el Embalse de Guatapé",
  "Paseo en lancha por el Peñón",
  "Cabaña con vista al agua",
  "Tour en chiva por el pueblo",
  "Parapente sobre el embalse",
  "Camping a orillas del embalse",
  "Traslado Medellín — Guatapé",
  "Noche de zócalos y música",
];

// `decalage` fait démarrer chaque carte sur un visuel différent : sans lui toutes les cartes de la
// grille partagent la même photo, et on ne voit plus laquelle est laquelle en scrollant.
function tarjetas(cantidad: number): OfertaTarjeta[] {
  return Array.from({ length: cantidad }, (_, i) => ({
    clave: `oferta-${i}`,
    href: `/productos/oferta-${i}`,
    nombre: NOMBRES[i % NOMBRES.length],
    establecimiento: i % 3 === 0 ? "Casa Kayam" : "Hostal El Peñón",
    // Les trois formes de prix réellement présentes au catalogue, plus l'absence de prix : c'est
    // la carte la plus haute (« desde ») qui décide de la hauteur de la rangée.
    precio:
      i % 4 === 0
        ? { tipo: "monto", cop: 80000 }
        : i % 4 === 1
          ? { tipo: "desde", cop: 120000 }
          : i % 4 === 2
            ? { tipo: "texto", label: "Consultar disponibilidad" }
            : null,
    fotos: Array.from({ length: (i % 3) + 1 }, (_, j) => ({
      url: VISUELS[(i + j) % VISUELS.length],
    })),
    tipo: "activity" as const,
    capacidad: null,
    nAlojamientos: null,
    testId: `tarjeta-${i}`,
  }));
}

const meta = {
  title: "Affichage/SeccionOfertas",
  component: SeccionOfertas,
  parameters: {
    layout: "padded",
    // Le lien « Ver más » passe par le `Link` de next-intl, qui lit le contexte de route — `null`
    // hors d'une route Next, et la story ne rendrait rien. Même geste que les stories du footer.
    nextjs: { appDirectory: true, navigation: { pathname: "/" } },
  },
  args: {
    titulo: "Actividades",
    hrefVerMas: "/actividades",
    labelVerMas: "Ver todas las actividades",
    variante: "grilla",
    tarjetas: tarjetas(8),
    locale: "es",
    testId: "seccion",
  },
  // ⚠️ `locale` est une DONNÉE (elle sert à formater les prix dans la carte), pas le contexte i18n
  // du décorateur global — mais laisser les deux diverger donnerait une section en anglais avec des
  // montants formatés à l'espagnole, ce qui n'arrive jamais en production. Le sélecteur de langue
  // de la barre d'outils pilote donc les deux d'un coup.
  render: (args, { globals }) => (
    <SeccionOfertas {...args} locale={(globals.locale as Locale) ?? "es"} />
  ),
} satisfies Meta<typeof SeccionOfertas>;

export default meta;
type Story = StoryObj<typeof meta>;

// Les quatre sections sur cinq : alojamientos, transportes, camps, eventos. Huit cartes, le plafond
// réel de l'accueil (spec 28 §0) — c'est cette quantité qu'il faut regarder, pas trois.
export const Grilla: Story = {};

// La section des ACTIVITÉS, seule à s'afficher en liste : sa carte est un `Card layout="row"`
// (visuel à gauche, texte à droite). Son « Ver más » porte aussi un autre libellé, parce qu'il mène
// à un index de tags et non à une liste d'offres (spec 29) — c'est la raison d'être de la prop.
export const Lista: Story = {
  args: {
    variante: "lista",
    labelVerMas: "Explorar por categoría",
  },
};

// Le cas le plus fréquent d'une recherche filtrée, et celui qui déçoit visuellement : une seule
// carte dans une grille à trois colonnes laisse deux tiers de vide. À regarder à 1280 avant de
// décider si la grille doit se resserrer sous un certain nombre de résultats (elle ne le fait pas
// aujourd'hui — signalé, pas décidé ici).
export const UnaSolaTarjeta: Story = {
  args: { tarjetas: tarjetas(1) },
};

// ⚠️ Le titre n'est PAS tronqué et ne doit pas l'être : c'est un <h2>, du contenu indexable. Cette
// story existe pour vérifier qu'il passe à la ligne proprement à 390 px sans pousser le lien
// « Ver más » hors de l'écran ni faire défiler la page horizontalement.
export const TituloLargo: Story = {
  args: {
    titulo: "Actividades acuáticas y de aventura en el Embalse de Guatapé y sus alrededores",
    labelVerMas: "Ver todas las actividades acuáticas y de aventura del Embalse de Guatapé",
    tarjetas: tarjetas(3),
  },
};

// ⚠️ LA VARIANTE REFONDUE LE 2026-10-01, et la seule qui exige un décorateur. Elle ne se suffit
// pas à elle-même : son fond perdu passe par `data-bleed`, une marque que seule la grille de
// `PageShell` sait lire (cf. son en-tête). Rendue nue, la section s'afficherait sans ses trois
// colonnes et le conteneur bleu ne longerait plus les bords — une story qui mentirait.
//
// À regarder à 1280 (trois cartes pile dans le conteneur) PUIS à 390 (une carte et l'amorce de la
// suivante). La bande, elle, ne bouge qu'au scroll de la PAGE : dans ce cadre court elle reste
// immobile, c'est normal — `Molécules/BandaTitulo` est la story faite pour ça.
export const Carrusel: Story = {
  parameters: { layout: "fullscreen" },
  args: {
    variante: "carrusel",
    labelVerMas: "Más actividades",
  },
  decorators: [
    (Story) => (
      <PageShell variant="large">
        <Story />
      </PageShell>
    ),
  ],
};
