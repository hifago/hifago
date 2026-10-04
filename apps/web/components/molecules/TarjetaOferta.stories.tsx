import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { FotoTarjeta, TarjetaOferta as OfertaTarjeta } from "@/lib/catalog/tipos";
import { TarjetaOferta } from "./TarjetaOferta";

// La carte d'une offre de l'accueil-résultats (spec 28 §5), dans ses deux variantes.
//
// ⚠️ Le contexte i18n vient du décorateur GLOBAL de `.storybook/preview.tsx` (un
// `NextIntlClientProvider` alimenté par `loadMessages`), pas d'un provider local : c'est lui qui
// branche aussi le sélecteur de langue de la barre d'outils, et le doubler ici figerait la langue
// de ces stories. Les deux clés consommées par la carte — `fotoAlt` et `precioDesde` — viennent
// donc des vrais fichiers `messages/{es,en}/HomePage.json`, et basculer la barre d'outils sur
// « English » montre l'espagnol face à l'anglais (« Desde » / « From »), c'est-à-dire le cas qui
// fait déborder un prix d'une carte étroite. Le test, lui, fournit ses messages en dur : il doit
// dire quelle FORME de message le composant attend, ce qu'un fichier partagé ne montre plus.
//
// Photos réelles de `mockData/`, servies localement par Storybook sous `/mock`.
const VISUELS = [
  "/mock/activities/kayak1/photos/1.jpeg",
  "/mock/activities/partyboat1/photos/1.jpg",
  "/mock/activities/yoga-session/photos/1.webp",
  "/mock/establishments/bania/photos/1.jpeg",
];

// `decalage` fait démarrer chaque carte sur un visuel différent — dans une grille, des cartes qui
// partagent leur première photo donnent l'illusion d'un composant qui ne varie pas.
function fotos(nombre: number, decalage = 0): FotoTarjeta[] {
  return Array.from({ length: nombre }, (_, i) => ({
    url: VISUELS[(i + decalage) % VISUELS.length],
  }));
}

// Une offre réaliste : les montants et les libellés sont ceux de Guatapé, pas du lorem ipsum — ce
// sont eux qui font déborder (ou non) un titre de carte.
const CABANA: OfertaTarjeta = {
  clave: "producto-1",
  href: "/productos/cabana-embalse",
  nombre: "Cabaña entera sobre el embalse",
  establecimiento: "Casa Kayam Guatapé",
  precio: { tipo: "monto", cop: 420000 },
  fotos: fotos(4),
  tipo: "lodging",
  capacidad: null,
  nAlojamientos: null,
  testId: "tarjeta-cabana-embalse",
};

const meta = {
  title: "Affichage/TarjetaOferta",
  component: TarjetaOferta,
  parameters: { layout: "padded" },
  args: { oferta: CABANA, variante: "grilla", locale: "es" },
} satisfies Meta<typeof TarjetaOferta>;

export default meta;
type Story = StoryObj<typeof meta>;

// La tuile photo de l'accueil (`TeselaOferta`, plan 41 S4) : une photo carrée arrondie à 16 px, le
// nom dans un cartouche, le prix en bulle. Depuis S4, `grilla` et `carrusel` la rendent ; les
// commentaires ci-dessous qui parlent de `Card` et de `PhotoStrip` ne valent plus que pour `lista`.
// Les visuels sont les mêmes photos locales que la planche `TeselaOferta`.
export const Grilla: Story = {};

// ⚠️ POINT OUVERT DE LA SPEC 28 §10, à regarder avant d'arbitrer — c'est pour ça que cette story
// existe. La variante `lista` (les activités) passe par `Card layout="row"`, dont le visuel fait
// 64 px : il a été dimensionné pour la ligne produit d'une fiche établissement, et un carrousel
// n'y tient pas (les flèches et les points d'Embla occupent la vignette entière). Trois issues
// possibles : agrandir le visuel de la variante `row`, renoncer au carrousel sur cette seule
// variante, ou faire de la carte d'activité une molécule à part. Aucune n'est tranchée, et aucune
// n'appartient à ce lot : agrandir le visuel modifie `atoms/Card.tsx`, un fichier partagé par cinq
// écrans. La carte est donc rendue TELLE QUELLE, défaut compris.
export const Lista: Story = {
  args: {
    variante: "lista",
    oferta: {
      ...CABANA,
      clave: "producto-2",
      href: "/productos/tour-lancha-penon",
      nombre: "Tour en lancha al Peñón",
      precio: { tipo: "monto", cop: 95000 },
      fotos: fotos(3, 1),
      tipo: "activity",
      capacidad: null,
      nAlojamientos: null,
      testId: "tarjeta-tour-lancha-penon",
    },
  },
};

// Le repli : `PhotoStrip` pose le substitut de l'atome `Image`, au même ratio. La carte garde sa
// forme au lieu de se tasser — c'est ce qui permet à une grille de rester alignée quand une seule
// offre n'a pas encore de photo (cas limite de la spec 28 §0).
export const SinFoto: Story = {
  args: { oferta: { ...CABANA, fotos: [], testId: "tarjeta-sin-foto" } },
};

// ⚠️ Aucun bloc de prix, et surtout aucun conteneur vide : `Card` n'ouvre son `Card.Content` que
// s'il reçoit des enfants. À comparer à `Grilla` — l'écart sous le sous-titre doit disparaître, pas
// rester vide. Le cas est réel : une offre en vitrine peut n'avoir ni `price_cop` ni `price_label`,
// et un établissement groupé dont aucun couchage n'a de prix chiffré n'affiche jamais « desde 0 ».
export const SinPrecio: Story = {
  args: { oferta: { ...CABANA, precio: null, testId: "tarjeta-sin-precio" } },
};

// Le prix d'une carte GROUPÉE : le minimum des couchages de l'établissement, précédé de son
// libellé. Les deux vivent dans un seul élément — un lecteur d'écran lit « Desde 180.000 COP »
// d'une traite, pas deux informations voisines.
//
// C'est aussi la seule story qui montre une CARTE GROUPÉE complète : le sous-titre y porte le
// décompte de couchages (« 6 alojamientos ») au lieu du nom d'un établissement, parce qu'ici la
// carte EST l'établissement. Littéralement ce que le front d'août affichait.
export const PrecioDesde: Story = {
  args: {
    oferta: {
      ...CABANA,
      clave: "establecimiento-1",
      href: "/establecimientos/casa-kayam-guatape",
      nombre: "Casa Kayam Guatapé",
      establecimiento: null,
      precio: { tipo: "desde", cop: 180000 },
      fotos: fotos(2, 2),
      capacidad: null,
      // ⚠️ 6 et non `null` : c'est l'état que la base produit RÉELLEMENT. Une carte groupée porte
      // toujours les deux — `search_catalog` calcule `precio_desde` et `n_alojamientos` dans la
      // même branche. La story les montrait dissociés, donc un état impossible, et c'est ce qui a
      // permis au décompte de rester non rendu pendant un lot entier sans que rien ne le montre.
      nAlojamientos: 6,
      testId: "tarjeta-casa-kayam",
    },
  },
};

// ⚠️ Un prix en TEXTE LIBRE, jamais formaté en COP : un evento porte un `price_label` saisi par le
// partenaire (règle métier du cahier admin §3c). Le formater rendrait « 0 COP » — un prix faux
// affiché avec l'aplomb d'un prix juste.
export const PrecioTexto: Story = {
  args: {
    oferta: {
      ...CABANA,
      clave: "producto-3",
      href: "/productos/festival-zocalos",
      nombre: "Festival de los Zócalos",
      establecimiento: "Plaza principal",
      precio: { tipo: "texto", label: "Entrada libre, cupo limitado" },
      fotos: fotos(1, 3),
      tipo: "evento",
      capacidad: null,
      nAlojamientos: null,
      testId: "tarjeta-festival-zocalos",
    },
  },
};

// L'état limite qui casse une carte en production : un nom de partenaire qui ne tient pas sur une
// ligne, doublé d'un nom d'établissement long. À regarder en gabarit Mobile 390 ET dans la story
// `Grilla3Columnas` — c'est en colonne étroite que le titre pousse la vignette hors de la carte,
// si le `min-w-0` de `Card` venait à disparaître.
export const TextoLargo: Story = {
  args: {
    oferta: {
      ...CABANA,
      nombre:
        "Cabaña familiar de dos habitaciones con terraza privada y vista panorámica al Embalse de Guatapé",
      establecimiento: "Hostal y Restaurante Mirador del Peñón de Guatapé — sede principal",
      precio: { tipo: "desde", cop: 12500000 },
      capacidad: null,
      nAlojamientos: null,
      testId: "tarjeta-texto-largo",
    },
  },
};

// La carte dans son contexte réel : la grille de `SeccionOfertas` — 1 colonne en mobile, 2 dès
// `md`, 3 dès `lg` (spec 28 §5). C'est la seule story qui montre ce qui compte vraiment sur un
// catalogue : des cartes de hauteurs de texte différentes qui restent alignées (l'étirement vient
// de la grille elle-même, aucune classe de hauteur n'est posée), et une carte sans photo au milieu
// de cartes qui en ont.
//
// ⚠️ `prioridad` n'est passé QU'À LA PREMIÈRE, et c'est le point de cette story : c'est elle le
// LCP (spec 28 §0, invariant 6). Toutes prioritaires, le navigateur préchargerait autant d'images
// qu'il y a de cartes, dont l'essentiel sous la ligne de flottaison — la régression exacte mesurée
// sur la story `DansUneCarte` de `PhotoStrip`.
const SECCION: OfertaTarjeta[] = [
  CABANA,
  {
    ...CABANA,
    clave: "producto-4",
    href: "/productos/tour-lancha-penon",
    nombre: "Tour en lancha al Peñón",
    establecimiento: "Muelle turístico",
    precio: { tipo: "monto", cop: 95000 },
    fotos: fotos(2, 1),
    tipo: "activity",
    capacidad: null,
    nAlojamientos: null,
    testId: "tarjeta-tour-lancha-penon",
  },
  {
    ...CABANA,
    clave: "producto-5",
    href: "/productos/camping-junto-al-agua",
    nombre: "Camping junto al agua",
    establecimiento: null,
    precio: { tipo: "texto", label: "Consultar" },
    fotos: [],
    tipo: "camp",
    capacidad: null,
    nAlojamientos: null,
    testId: "tarjeta-camping",
  },
  {
    ...CABANA,
    clave: "establecimiento-2",
    href: "/establecimientos/casa-kayam-guatape",
    nombre: "Casa Kayam Guatapé",
    establecimiento: null,
    precio: { tipo: "desde", cop: 180000 },
    fotos: fotos(3, 2),
    capacidad: null,
    nAlojamientos: null,
    testId: "tarjeta-casa-kayam",
  },
  {
    ...CABANA,
    clave: "producto-6",
    href: "/productos/traslado-medellin",
    nombre: "Traslado desde Medellín",
    establecimiento: "Transportes El Peñol",
    precio: null,
    fotos: fotos(1, 3),
    tipo: "transport",
    capacidad: null,
    nAlojamientos: null,
    testId: "tarjeta-traslado-medellin",
  },
];

export const Grilla3Columnas: Story = {
  render: (args) => (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {SECCION.map((item, index) => (
        <TarjetaOferta
          key={item.clave}
          oferta={item}
          variante={args.variante}
          prioridad={index === 0}
          locale={args.locale}
        />
      ))}
    </div>
  ),
};
