import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, useState } from "react";
import { PageShell } from "@/components/atoms/PageShell";
import { SearchBar, type SearchSuggestion } from "./SearchBar";

// LA barre de recherche de l'accueil. À regarder aux deux gabarits dans la charte claire adoptée :
// c'est le composant le plus visible du site, et le seul dont un panneau flottant peut sortir de
// l'écran.
//
// ⚠️ Les suggestions sont fournies À LA MAIN ici, et c'est le contrat du composant : il ne cherche
// rien, il reçoit une liste déjà constituée. Les stories n'ont donc aucun catalogue à monter.
//
// ⚠️ Trois natures MÉLANGÉES dans une liste PLATE, sans intitulé de section — activité, catégorie,
// établissement. Vérifié sur getyourguide.com : leur liste ne contient pas un seul `role="group"`,
// la nature est portée par la ligne secondaire. C'est plus simple, ça classe par pertinence plutôt
// que par type, et ça évite les intitulés non sélectionnables qui compliquent le clavier.
const SUGGESTIONS: SearchSuggestion[] = [
  {
    id: "p-kayak",
    label: "Kayak en el Embalse de Guatapé",
    meta: "Actividad en Guatapé",
    kind: "product",
    href: "/productos/kayak-embalse",
  },
  {
    id: "c-activity",
    label: "Actividades acuáticas",
    meta: "12 actividades",
    kind: "category",
    href: "/?type=activity",
  },
  {
    id: "e-casa-kayam",
    label: "Casa Kayam",
    meta: "Alojamiento en Guatapé",
    kind: "establishment",
    href: "/establecimientos/casa-kayam",
  },
  {
    id: "p-lancha",
    label: "Paseo en lancha por el Peñón",
    meta: "Actividad en Guatapé",
    kind: "product",
    href: "/productos/paseo-lancha",
  },
];

// Avant la moindre frappe, la liste ne doit pas être vide : les catégories sont disponibles
// gratuitement côté client, les proposer est un point de départ honnête. (Un « recherches
// récentes » demanderait du localStorage, donc une décision de plus — signalé, pas fait.)
const CATEGORIES: SearchSuggestion[] = [
  { id: "c-lodging", label: "Alojamientos", meta: "18 opciones", kind: "category" },
  { id: "c-activity", label: "Actividades", meta: "12 opciones", kind: "category" },
  { id: "c-transport", label: "Transporte", meta: "4 opciones", kind: "category" },
  { id: "c-camp", label: "Camps", meta: "2 opciones", kind: "category" },
  { id: "c-evento", label: "Eventos", meta: "3 opciones", kind: "category" },
];

const LIBELLES = {
  label: "Buscar actividades, alojamientos o lugares",
  placeholder: "¿Qué quieres hacer en Guatapé?",
  submitLabel: "Buscar",
  emptyLabel: "No encontramos nada con ese texto. Pulsa Buscar para verlo en el catálogo.",
};

const meta = {
  title: "Saisie/SearchBar",
  component: SearchBar,
  parameters: { layout: "padded" },
  // Les stories rendent toutes leur propre `Cadre` (le composant est CONTRÔLÉ) : ces args ne
  // servent qu'à satisfaire le type et à alimenter le panneau de contrôles.
  args: {
    ...LIBELLES,
    suggestions: SUGGESTIONS,
    testId: "recherche",
    value: "",
    onValueChange: () => {},
    onSubmit: () => {},
    onSuggestionSelect: () => {},
  },
} satisfies Meta<typeof SearchBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Le composant est CONTRÔLÉ : sans état autour, le champ ne se remplirait pas. Ce cadre est le
 * minimum que tout appelant réel écrira.
 */
function Cadre({
  suggestions,
  texteInitial = "",
  ouvrir = false,
  ...libelles
}: Partial<React.ComponentProps<typeof SearchBar>> & { texteInitial?: string; ouvrir?: boolean }) {
  const [texte, setTexte] = useState(texteInitial);
  const [journal, setJournal] = useState<string[]>([]);

  // ⚠️ Une story de dropdown ne montre rien tant que le champ n'a pas le focus : le panneau ne
  // s'ouvre qu'à ce moment (`menuTrigger="focus"`). On le prend donc au montage, comme le ferait
  // un visiteur — plutôt que d'ajouter au composant une prop `autoFocus` que personne ne veut.
  useEffect(() => {
    if (!ouvrir) return;
    const champ = document.querySelector<HTMLInputElement>('[data-testid="recherche-input"]');
    champ?.focus();
  }, [ouvrir]);

  return (
    // `PageShell` plutôt qu'un `div` : la barre vit dans le premier bloc de l'accueil, donc dans un
    // `<main>`. Sans ce repère, axe remonte `region` (« du contenu hors landmark ») sur chaque
    // story — un bruit qui masquerait les vraies remontées.
    <PageShell variant="pagina">
      <SearchBar
        {...LIBELLES}
        {...libelles}
        value={texte}
        onValueChange={setTexte}
        suggestions={suggestions ?? SUGGESTIONS}
        onSubmit={(q) => setJournal((j) => [...j, `RECHERCHE le texte tapé : « ${q} »`])}
        onSuggestionSelect={(s) => setJournal((j) => [...j, `SUGGESTION activée : ${s.label}`])}
        testId="recherche"
      />
      {/* Le journal n'appartient PAS au composant : c'est la story qui rend visible ce qu'il émet. */}
      <pre
        className="min-h-16 rounded-[var(--radius)] border border-border p-3 text-xs"
        data-testid="journal"
      >
        {journal.join("\n") || "(rien émis pour l'instant)"}
      </pre>
    </PageShell>
  );
}

// ⚠️ Les suggestions SANS `href` pour les deux stories à journal : une suggestion avec `href` est
// un VRAI lien, donc l'activer fait NAVIGUER l'iframe Storybook (404) et emporte le journal avec
// elle. Ce n'est pas un défaut, c'est la preuve que le lien fonctionne — mais ça rend la démo
// inobservable. Les autres stories les gardent.
const SANS_LIEN: SearchSuggestion[] = SUGGESTIONS.map((s) => ({
  id: s.id,
  label: s.label,
  meta: s.meta,
  kind: s.kind,
}));

// Ce que voit un visiteur qui clique dans la barre sans avoir rien tapé.
export const OuverteAvantLaFrappe: Story = {
  render: () => <Cadre suggestions={CATEGORIES} ouvrir />,
};

// Les trois natures mélangées : une activité, une catégorie, un établissement, une activité.
export const OuverteAvecSuggestions: Story = {
  render: () => <Cadre texteInitial="kayak" ouvrir />,
};

// ⚠️ L'état le plus fréquent et le plus négligé. Le message dit quoi faire ensuite — `Entrée` ou le
// bouton cherchent quand même le texte tapé, ce qui reste la sortie utile.
export const AucunResultat: Story = {
  render: () => <Cadre texteInitial="xyzzy" suggestions={[]} ouvrir />,
};

// L'espagnol fait 20 à 25 % de plus que l'anglais : un libellé long est la norme, pas le cas
// limite. À regarder en Mobile 390 — c'est là que la ligne secondaire et le libellé se disputent.
export const TexteLong: Story = {
  render: () => (
    <Cadre
      texteInitial="paseo en lancha por el embalse con guía local y parada en la piedra"
      ouvrir
      suggestions={[
        {
          id: "long",
          label:
            "Paseo en lancha por el Embalse de Guatapé con guía local, parada en la Piedra del Peñol y refrigerio incluido",
          meta: "Actividad en Guatapé · Casa Kayam · duración 3 horas · salida cada mañana",
          kind: "product",
        },
        ...SUGGESTIONS,
      ]}
    />
  ),
};

// ⚠️ LA story du lot : c'est la seule façon de vérifier À L'ŒIL que `Entrée` soumet le TEXTE TAPÉ
// et non une suggestion. Le protocole, dans l'ordre :
//   1. taper « kayak » → la liste s'ouvre, AUCUNE ligne n'est surlignée ;
//   2. `Entrée` → le journal doit écrire « RECHERCHE le texte tapé : kayak » ;
//   3. retaper, puis `FlècheBas` (une ligne se surligne) puis `Entrée` → « SUGGESTION activée » ;
//   4. `Échap` → la liste se ferme et le texte RESTE dans le champ.
// C'est exactement le contraire de la référence, où `Entrée` seul part sur une suggestion.
export const Defaut: Story = { render: () => <Cadre suggestions={SANS_LIEN} /> };
