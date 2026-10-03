import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { TarjetaOferta as OfertaTarjeta } from "@/lib/catalog/tipos";
import { ListadoInfinito } from "./ListadoInfinito";

// La liste d'une page de listing et son défilement (spec 29 §5d). Ce qui se juge ICI et nulle part
// ailleurs :
//
//  • **le bas de page**, qui est tout l'enjeu de cet écran — le décompte, le bouton et la région
//    d'état s'empilent sous la grille, et c'est la seule zone que le visiteur regarde en défilant ;
//  • **la dernière rangée incomplète** aux trois gabarits (390, 768, 1280) : 24 cartes tombent
//    juste sur 1, 2 et 3 colonnes, mais une page partielle (le reliquat d'un total non multiple)
//    laisse un trou qu'il faut avoir vu ;
//  • **l'état d'échec**, qui doit rester lisible et ne jamais ressembler à une fin de liste.
//
// ⚠️ L'observateur d'intersection FONCTIONNE dans Storybook (contrairement à jsdom) : défiler
// jusqu'en bas déclenche un vrai appel réseau vers `/api/catalogo/listado`, qui n'existe pas ici.
// C'est voulu — c'est exactement le chemin d'échec de la dernière story, et il se regarde.
//
// Le contexte i18n vient du décorateur global de `.storybook/preview.tsx` — aucune story de ce
// dépôt ne monte son propre `NextIntlClientProvider`.

const VISUELS = [
  "/mock/activities/kayak1/photos/1.jpeg",
  "/mock/activities/partyboat1/photos/1.jpg",
  "/mock/activities/yoga-session/photos/1.webp",
  "/mock/establishments/bania/photos/1.jpeg",
];

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

function tarjetas(cantidad: number): OfertaTarjeta[] {
  return Array.from({ length: cantidad }, (_, i) => ({
    clave: `oferta-${i}`,
    href: `/productos/oferta-${i}`,
    nombre: NOMBRES[i % NOMBRES.length],
    establecimiento: i % 3 === 0 ? "Casa Kayam" : "Hostal El Peñón",
    precio:
      i % 4 === 0
        ? { tipo: "monto" as const, cop: 80000 }
        : i % 4 === 1
          ? { tipo: "desde" as const, cop: 120000 }
          : i % 4 === 2
            ? { tipo: "texto" as const, label: "Consultar disponibilidad" }
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
  title: "Affichage/ListadoInfinito",
  component: ListadoInfinito,
  // Sur l'or, sa seule page : la catégorie (plan 41, P2). Son bouton `marine` et son décompte marine
  // s'y jugent, pas sur le clair.
  decorators: [
    (Story) => (
      <div data-superficie="or" className="p-4 sm:p-6">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "fullscreen",
    // Les cartes passent par le `Link` de next-intl, qui lit le contexte de route — `null` hors
    // d'une route Next, et rien ne s'afficherait. Même geste que `SeccionOfertas`.
    nextjs: { appDirectory: true, navigation: { pathname: "/alojamientos" } },
  },
  args: {
    locale: "es" as const,
    endpointBase: "/api/catalogo/listado?tipo=activity&locale=es",
    paginaInicial: 1,
  },
} satisfies Meta<typeof ListadoInfinito>;

export default meta;
type Story = StoryObj<typeof meta>;

// Le cas courant : une première page pleine, et il en reste. Le bouton est là, le décompte dit où
// l'on en est.
export const PrimeraPagina: Story = {
  args: { tarjetasIniciales: tarjetas(24), total: 57, hayMasInicial: true },
};

// ⚠️ La fin de liste : PAS de bouton, et le décompte se referme sur lui-même (« 9 de 9 offres »).
// C'est le seul signal que le visiteur a tout vu — sans lui, une liste qui s'arrête ressemble à une
// panne.
export const TodoCargado: Story = {
  args: { tarjetasIniciales: tarjetas(9), total: 9, hayMasInicial: false },
};

// Le retour depuis une fiche après avoir chargé trois pages (`?pagina=3`) : le serveur a rendu les
// 72 offres d'un coup. À regarder pour la hauteur de page et la tenue de la grille sur un long
// défilement.
export const TercerPaginaDirecta: Story = {
  args: { tarjetasIniciales: tarjetas(72), total: 132, hayMasInicial: true, paginaInicial: 3 },
};

// ⚠️ Une page partielle : 7 cartes sur 3 colonnes laissent un trou d'une case en bas à droite. Rien
// ne le corrige et rien ne doit le corriger — mais il faut l'avoir vu pour ne pas le prendre pour
// un bug plus tard.
export const UltimaFilaIncompleta: Story = {
  args: { tarjetasIniciales: tarjetas(7), total: 7, hayMasInicial: false },
};
