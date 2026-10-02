import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import * as React from "react";
import { Card } from "./Card";
import { Image } from "./Image";
import { Price } from "./Price";
import { TypeBadge } from "./TypeBadge";

// Le playground de la carte. Deux stories comptent plus que les autres :
//   • `GrilleDeCartes`, parce qu'une carte isolée ne montre JAMAIS le défaut qui compte — des
//     hauteurs inégales dans une grille ;
//   • `Cliquable`, à parcourir au clavier et avec le panneau d'accessibilité ouvert : c'est là que
//     se vérifie que le lien s'annonce par son titre et non par toute la carte.
//
// À voir aux deux gabarits (Mobile 390 par défaut, Desktop 1280) et dans les deux modes de la
// barre d'outils.
const meta = {
  title: "Structure/Card",
  component: Card,
  parameters: { layout: "padded" },
  args: {
    title: "Habitación privada con vista al lago",
    titleAs: "h2",
    description: "Amplia habitación con balcón privado sobre el embalse, para dos personas.",
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

// `/globe.svg` : le seul visuel réellement présent dans apps/web/public — même source que
// Image.stories.tsx et la story de CatalogBrowser. Pas d'URL distante : une story ne doit pas
// dépendre du réseau pour s'afficher.
const SRC = "/globe.svg";
// Valeur reprise de la production (CatalogBrowser.tsx:98), pas inventée : grille à une colonne
// sous 640 px, deux au-delà.
const SIZES = "(max-width: 640px) 100vw, 50vw";

function Photo({ src = SRC }: { src?: string | null }) {
  // `loading` est devenu obligatoire sur l'atome le 2026-09-02 (vague 4) : une carte de catalogue
  // est en dessous de la ligne de flottaison sauf la toute première, donc `"lazy"`. Seule ligne
  // touchée hors du périmètre Image/PhotoStrip, et elle l'est par nécessité — la prop est requise.
  return (
    <Image src={src} alt="Vue du Embalse de Guatapé depuis la colline" sizes={SIZES} loading="lazy" />
  );
}

// Les stories d'une carte SEULE sont bornées en largeur : une carte occupe rarement 1 248 px, et
// un visuel en 4/3 sur toute cette largeur ferait 936 px de haut, ce qui noierait ce qu'il y a à
// regarder. Ce n'est pas le composant qui se borne — il ne fixe aucune largeur — c'est le
// conteneur de la story, comme en production.
function Cadre({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-md">{children}</div>;
}

export const Defaut: Story = {
  render: (args) => (
    <Cadre>
      <Card {...args}>
        <Price amountCop={180000} locale="es" />
      </Card>
    </Cadre>
  ),
};

/**
 * Sans visuel — l'état le plus fréquent du catalogue réel, pas un cas limite. Deux cartes, deux
 * façons de ne pas avoir de photo, et elles ne sont pas équivalentes :
 *   • à gauche, aucun `media` : la carte se referme sur son texte ;
 *   • à droite, un `media` dont la source est `null` : l'atome `Image` rend son substitut au même
 *     ratio, donc la carte garde exactement la hauteur qu'elle aurait avec une photo. C'est ce qui
 *     empêche une grille de catalogue de sauter d'une ligne à l'autre.
 */
export const SansImage: Story = {
  render: (args) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Card {...args}>
        <Price amountCop={180000} locale="es" />
      </Card>
      <Card {...args} media={<Photo src={null} />}>
        <Price amountCop={180000} locale="es" />
      </Card>
    </div>
  ),
};

/**
 * Avec visuel, à fleur de carte. ⚠️ C'est ici que se voit ce que `overflow-hidden` était censé
 * faire dans le code d'origine et ne faisait pas : le `p-4` de `.card` mettait l'image en retrait
 * de 16 px, donc il n'y avait rien à rogner. Le visuel annule ce padding et se fait rogner au
 * rayon des angles — qui suit `--radius`, donc la piste de couleur choisie dans la barre d'outils.
 */
export const AvecImage: Story = {
  render: (args) => (
    <Cadre>
      <Card {...args} media={<Photo />}>
        <Price amountCop={180000} locale="es" />
      </Card>
    </Cadre>
  ),
};

/**
 * La carte cliquable. À parcourir AU CLAVIER : un seul arrêt de tabulation, sur le titre, et
 * l'anneau de focus entoure la carte entière — pas les trois mots du titre.
 *
 * ⚠️ Dans le panneau d'accessibilité, le lien s'annonce « Habitación privada con vista al lago »
 * et rien de plus. Le motif d'origine (toute la carte dans un `<a>`) annonçait le titre, le
 * sous-titre, la description et le prix d'une traite.
 *
 * Le bouton « Añadir » montre le second acquis du motif : un élément interactif de plus reste
 * possible et atteignable, sans produire un lien dans un lien. ⚠️ Il ne porte AUCUNE classe de
 * z-index — c'est la carte qui remonte ses enfants interactifs au-dessus de l'overlay. Clique
 * dessus : il agit. Clique n'importe où ailleurs : la carte navigue.
 */
export const Cliquable: Story = {
  args: { href: "/productos/habitacion-privada", subtitle: "2 habitaciones" },
  render: (args) => (
    <Cadre>
      <Card {...args} media={<Photo />} testId="carte-cliquable">
        <div className="flex items-center justify-between gap-3">
          <Price amountCop={180000} locale="es" />
          <button type="button" className="rounded-[var(--radius)] border border-border px-3 py-2 text-xs">
            Añadir
          </button>
        </div>
      </Card>
    </Cadre>
  ),
};

/**
 * Titre et description longs. La carte ne fixe aucune largeur : elle prend celle de son conteneur
 * et le texte passe à la ligne. À vérifier en Mobile 390 — aucun défilement horizontal de la page.
 */
export const TexteLong: Story = {
  args: {
    title:
      "Habitación privada con vista panorámica al Embalse de Guatapé, balcón, baño privado y desayuno incluido",
    description:
      "Amplia habitación con balcón privado sobre el embalse, para dos personas, con baño privado, agua caliente, ventilador de techo, escritorio y una vista despejada sobre la represa desde el amanecer hasta el atardecer. El desayuno se sirve en la terraza común.",
    subtitle: "2 habitaciones · 4 personas",
  },
  render: (args) => (
    <Cadre>
      <Card {...args} media={<Photo />}>
        <Price amountCop={180000} locale="es" />
      </Card>
    </Cadre>
  ),
};

// Le catalogue réel : des titres et des descriptions de longueurs très différentes, dont un produit
// sans photo. C'est le mélange qui révèle les hauteurs inégales — une carte isolée ne le montre
// jamais.
const CATALOGUE = [
  {
    id: "1",
    title: "Habitación privada con vista al lago",
    subtitle: "2 habitaciones",
    description: "Amplia habitación con balcón privado sobre el embalse, para dos personas.",
    prix: 180000,
    type: "lodging",
    src: SRC as string | null,
  },
  {
    id: "2",
    title: "Cama en dormitorio compartido",
    subtitle: undefined,
    description: undefined,
    prix: 45000,
    type: "lodging",
    src: null as string | null,
  },
  {
    id: "3",
    title: "Paseo en lancha por el Embalse de Guatapé con guía local y parada en la Piedra del Peñol",
    subtitle: "3 horas",
    description:
      "Recorrido en lancha por el embalse con guía local, parada fotográfica frente a la Piedra del Peñol y regreso al muelle municipal.",
    prix: 95000,
    type: "activity",
    src: SRC as string | null,
  },
  {
    id: "4",
    title: "Transporte Medellín — Guatapé",
    subtitle: "Ida y vuelta",
    description: "Salida desde el Terminal del Norte.",
    prix: 70000,
    type: "transport",
    src: SRC as string | null,
  },
];

/**
 * ⚠️ LA STORY QUI COMPTE. Quatre cartes cliquables de contenus très inégaux, dans la grille réelle
 * du catalogue (`grid-cols-1 sm:grid-cols-2`, reprise de CatalogBrowser.tsx:92).
 *
 * Elle prouve le constat qui a fait disparaître le `h-full` de l'existant : la carte est
 * l'élément de grille, et `align-items: stretch` — le défaut d'une grille CSS — l'étire toute
 * seule. Le `h-full` d'origine ne rattrapait que le `<Link>` intercalé entre la grille et la
 * carte. La mesure affichée en tête relit les hauteurs rendues au lieu de l'affirmer.
 */
export const GrilleDeCartes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <HauteursDeLaGrille />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-grille>
        {CATALOGUE.map((p) => (
          <Card
            key={p.id}
            href={`/productos/${p.id}`}
            title={p.title}
            titleAs="h2"
            subtitle={p.subtitle}
            description={p.description}
            media={<Photo src={p.src} />}
            testId={`carte-${p.id}`}
          >
            {/* `mt-auto` : dans une carte étirée par la grille, la ligne de prix se colle au bas
                et s'aligne d'une carte à l'autre. Aucune prop n'a été ajoutée pour ça —
                `.card__content` est déjà `flex flex-1 flex-col`, donc l'appelant l'obtient avec
                une classe sur SON propre div. C'est exactement la composition que le README
                appelle « props sémantiques plutôt qu'override de classe » : le composant n'expose
                pas `className`, mais ce qu'on lui passe en enfant reste libre. */}
            <div className="mt-auto flex items-center justify-between gap-2">
              <Price amountCop={p.prix} locale="es" />
              <TypeBadge type={p.type} label={p.type} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  ),
};

// Relit les hauteurs rendues des cartes de la grille. Écrire « elles sont égales » dans un
// commentaire le rendrait faux au premier changement de gabarit ; ici la story le dit elle-même,
// et devient rouge si elles cessent de l'être.
function HauteursDeLaGrille() {
  const [mesure, setMesure] = React.useState<{ hauteurs: number[]; colonnes: number } | null>(null);
  const attacher = React.useCallback((noeud: HTMLParagraphElement | null) => {
    if (!noeud) return;
    const grille = noeud.parentElement?.querySelector("[data-grille]");
    if (!grille) return;
    setMesure({
      hauteurs: Array.from(grille.children).map((c) => Math.round(c.getBoundingClientRect().height)),
      // ⚠️ Le nombre de colonnes est LU sur la grille, pas supposé : à 390 px elle en a une, à
      // 1280 px deux. Un verdict câblé sur deux colonnes crierait au défaut sur mobile, où chaque
      // carte est seule sur sa rangée et où des hauteurs différentes sont donc normales.
      colonnes: getComputedStyle(grille).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
    });
  }, []);

  const rangees: number[][] = [];
  if (mesure) {
    for (let i = 0; i < mesure.hauteurs.length; i += mesure.colonnes) {
      rangees.push(mesure.hauteurs.slice(i, i + mesure.colonnes));
    }
  }
  const egales = rangees.every((r) => new Set(r).size === 1);

  return (
    <p ref={attacher} className={egales ? "text-xs text-muted" : "text-xs text-danger"}>
      {mesure === null
        ? ""
        : `${mesure.colonnes} colonne(s) · hauteurs rendues par rangée : ${rangees
            .map((r) => r.join("/"))
            .join(" · ")} px — ${
            egales ? "égales, sans aucune classe de hauteur" : "INÉGALES sur une rangée"
          }`}
    </p>
  );
}

/**
 * La disposition en ligne — la ligne produit d'une fiche établissement
 * (`EstablishmentDetailView.tsx:139`), cliquable elle aussi. La vignette fait 64 px et ne se
 * comprime pas ; le texte, lui, peut rétrécir (`min-w-0`), sinon un titre long la pousserait hors
 * de la carte. À vérifier en Mobile 390 avec le titre long ci-dessous.
 */
export const EnLigne: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Card
        layout="row"
        href="/productos/habitacion-privada"
        title="Habitación privada"
        titleAs="h3"
        media={<Photo />}
      >
        <span className="text-xs text-muted">Privada · 2 personas · 3 unidades en total</span>
      </Card>
      <Card
        layout="row"
        href="/productos/paseo-en-lancha"
        title="Paseo en lancha por el Embalse de Guatapé con guía local y parada en la Piedra del Peñol"
        titleAs="h3"
        media={<Photo />}
      >
        <span className="text-xs text-muted">3 horas</span>
      </Card>
      <Card layout="row" href="/productos/sin-foto" title="Producto sin foto" titleAs="h3">
        <span className="text-xs text-muted">Sin visual</span>
      </Card>
    </div>
  ),
};

/**
 * Les tailles de titre, décorrélées du niveau. `sm` est le titre de HeroUI (celui d'une tuile de
 * listing), `md` le `text-lg` des tuiles photo, `lg` le `text-2xl`, et `bloque` le rôle `titre-bloc`
 * de la charte, celui des cartes de contenu (plan 41, F2). Toutes sont ici en `h2` : la taille est
 * visuelle, le niveau est sémantique, et ce ne sont pas la même décision.
 */
export const TaillesDeTitre: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(["sm", "md", "lg", "bloque"] as const).map((titleSize) => (
        <Card
          key={titleSize}
          title={`Titre en ${titleSize}`}
          titleAs="h2"
          titleSize={titleSize}
          description="La description, elle, ne change pas de taille."
        >
          <Price amountCop={180000} locale="es" />
        </Card>
      ))}
    </div>
  ),
};

/**
 * Les trois écarts de contenu. Le défaut (`sm`) est celui de HeroUI ; `lg` est l'espacement d'une
 * fiche produit, où le corps de la carte porte une galerie, un prix, des faits et un formulaire.
 */
export const EcartsDeContenu: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(["sm", "md", "lg"] as const).map((contentGap) => (
        <Card key={contentGap} title={`contentGap="${contentGap}"`} titleAs="h2" contentGap={contentGap}>
          <p className="text-sm">Première ligne du corps</p>
          <p className="text-sm">Deuxième ligne</p>
          <p className="text-sm">Troisième ligne</p>
        </Card>
      ))}
    </div>
  ),
};

/**
 * ⚠️ Ce que `children` accepte sur une carte CLIQUABLE : la même chose que sur une carte
 * ordinaire. Bouton, champ, liste déroulante, second lien — aucun ne porte de classe de z-index,
 * et tous restent atteignables : la carte les remonte elle-même au-dessus de l'overlay.
 *
 * À manipuler : chaque contrôle agit sur place, et tout le reste de la carte navigue. Le second
 * lien n'est pas imbriqué dans le premier — deux frères dans le DOM, pas un `<a>` dans un `<a>`,
 * ce que l'ancien motif (toute la carte dans un `<Link>`) rendait impossible.
 */
export const EnfantsInteractifs: Story = {
  render: () => (
    <Cadre>
      <Card
        href="/productos/habitacion-privada"
        title="Habitación privada con vista al lago"
        titleAs="h2"
        description="Tous les contrôles ci-dessous agissent sur place ; le reste de la carte navigue."
        contentGap="md"
        testId="carte-enfants"
      >
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="rounded-[var(--radius)] border border-border px-3 py-2 text-xs">
            Añadir
          </button>
          <select className="rounded-[var(--radius)] border border-border px-2 py-2 text-xs" aria-label="Cantidad">
            <option>1</option>
            <option>2</option>
          </select>
          <input
            type="date"
            aria-label="Fecha de llegada"
            className="rounded-[var(--radius)] border border-border px-2 py-2 text-xs"
          />
        </div>
        <a href="#establecimiento" className="text-xs underline">
          Ver el alojamiento
        </a>
      </Card>
    </Cadre>
  ),
};
