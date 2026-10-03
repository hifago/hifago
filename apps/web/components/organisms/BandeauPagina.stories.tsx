import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import NextImage from "next/image";
import { useState, type ReactNode } from "react";
import { BackLink } from "@/components/atoms/BackLink";
import { LinkButton } from "@/components/atoms/LinkButton";
import { PageShell } from "@/components/atoms/PageShell";
import { PuceEstado } from "@/components/atoms/PuceEstado";
import { Migas } from "@/components/molecules/Migas";
import { SearchBar } from "./SearchBar";
import { BandeauPagina } from "./BandeauPagina";

// Plan 41, S2. Le bandeau dans son contexte réel : enfant direct de `PageShell variant="pagina"`,
// avec un paragraphe de contenu dessous (la page claire qui suit). Ce que ces stories servent à
// regarder, à 360, 390 et 1 280 px :
//   - `contenido` : l'or à fond perdu, bord à bord, le contenu dans la colonne de l'accueil ;
//   - `navegacion` : sur une page déjà or, aucun second fond ni filet ;
//   - le titre à point (sans point pour un nom propre), le chapô limité à 60 caractères ;
//   - un titre de trois lignes, la recherche, un CTA, et l'image de catégorie à droite (≥ lg).
// Le header or du site n'est pas rendu ici : la jonction header / bandeau se vérifie dans les pages
// (items P).
const meta = {
  title: "Structure/BandeauPagina",
  component: BandeauPagina,
  parameters: { layout: "fullscreen" },
  args: { titulo: "Agua", variante: "contenido", testId: "bandeau" },
} satisfies Meta<typeof BandeauPagina>;

export default meta;
type Story = StoryObj<typeof meta>;

const MIGAS = (
  <Migas
    etiqueta="Ruta de navegación"
    locale="es"
    items={[
      { nombre: "Inicio", href: "/" },
      { nombre: "Actividades", href: "/actividades" },
      { nombre: "Agua" },
    ]}
  />
);

function Page({ children, or = false }: { children: ReactNode; or?: boolean }) {
  return (
    <PageShell variant="pagina" fondo={or ? "acento" : undefined}>
      {children}
      <p className="max-w-prose">
        El contenido de la página empieza aquí, sobre el fondo claro: fichas, formularios y el
        resumen del viaje se leen mejor fuera del oro.
      </p>
    </PageShell>
  );
}

// Une page claire (catégorie, fiche, tunnel) : le bandeau peint l'or lui-même, bord à bord.
export const Contenido: Story = {
  args: {
    migas: MIGAS,
    chapo: "Kayak, jetski y paseos en lancha por el embalse.",
  },
  render: (args) => (
    <Page>
      <BandeauPagina {...args} />
    </Page>
  ),
};

// Une page déjà or (index par type) : le bandeau n'est que le haut de la page.
export const Navegacion: Story = {
  args: {
    variante: "navegacion",
    titulo: "Actividades",
    migas: <Migas etiqueta="Ruta de navegación" locale="es" items={[{ nombre: "Inicio", href: "/" }, { nombre: "Actividades" }]} />,
    chapo: "Lo que se hace en Guatapé, del embalse a la Piedra: elige una categoría para empezar.",
  },
  render: (args) => (
    <Page or>
      <BandeauPagina {...args} />
    </Page>
  ),
};

export const SinChapo: Story = {
  args: { migas: MIGAS },
  render: (args) => (
    <Page>
      <BandeauPagina {...args} />
    </Page>
  ),
};

// Un nom de produit long, sur trois lignes à 390 px, sans point (nom propre), avec lien retour et
// meta (puce et adresse).
export const TituloLargo: Story = {
  args: {
    titulo: "Paseo en lancha al atardecer por las islas del embalse de Guatapé",
    conPunto: false,
    volver: <BackLink href="/actividades" label="Volver al catálogo" />,
    meta: (
      <>
        <PuceEstado tono="neutro">3 cupos</PuceEstado>
        <span className="text-sm font-medium">Muelle principal, Guatapé</span>
      </>
    ),
  },
  render: (args) => (
    <Page>
      <BandeauPagina {...args} />
    </Page>
  ),
};

// La recherche des index et catégories, posée dans le bandeau (le composant est contrôlé).
function Recherche() {
  const [valeur, setValeur] = useState("");
  return (
    <SearchBar
      value={valeur}
      onValueChange={setValeur}
      suggestions={[]}
      onSubmit={() => {}}
      onSuggestionSelect={() => {}}
      label="Buscar actividades, alojamientos o lugares"
      placeholder="¿Qué buscas en Guatapé?"
      submitLabel="Buscar"
      emptyLabel="No encontramos nada con ese texto."
    />
  );
}

export const ConBusqueda: Story = {
  args: {
    migas: MIGAS,
    chapo: "Kayak, jetski y paseos en lancha por el embalse.",
    accion: <Recherche />,
  },
  render: (args) => (
    <Page>
      <BandeauPagina {...args} />
    </Page>
  ),
};

// Mi viaje : le titre à point et le CTA de la page.
export const ConCta: Story = {
  args: {
    titulo: "Mi viaje",
    chapo: "Revisa tus reservas antes de pagar el anticipo.",
    accion: <LinkButton href="/pago">Continuar al pago</LinkButton>,
  },
  render: (args) => (
    <Page>
      <BandeauPagina {...args} />
    </Page>
  ),
};

// L'image d'une catégorie (D16), à droite à partir de `lg` ; décor, absente en dessous.
export const ConImagen: Story = {
  args: {
    migas: MIGAS,
    chapo: "Kayak, jetski y paseos en lancha por el embalse.",
    imagen: (
      <div className="relative size-40 overflow-hidden rounded-[16px]">
        <NextImage src="/mock/activities/jetski1/photos/2.jpeg" alt="" fill sizes="160px" className="object-cover" />
      </div>
    ),
  },
  render: (args) => (
    <Page>
      <BandeauPagina {...args} />
    </Page>
  ),
};
