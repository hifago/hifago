import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { TARJETAS_POR_TIPO } from "@/.storybook/support/fixtures/catalogo";
import { Button, type ButtonColor } from "@/components/atoms/Button";
import { EnlaceGo } from "@/components/atoms/EnlaceGo";
import { Field } from "@/components/atoms/Field";
import { PageShell } from "@/components/atoms/PageShell";
import { PuceEstado } from "@/components/atoms/PuceEstado";
import { Title } from "@/components/atoms/Title";
import { Aviso } from "@/components/molecules/Aviso";
import { TituloRubrica } from "@/components/molecules/TituloRubrica";
import { BandeauPagina } from "@/components/organisms/BandeauPagina";
import { SeccionRiel } from "@/components/organisms/SeccionRiel";
import { Link } from "@/i18n/navigation";

// Référence visuelle à ouvrir avant tout nouvel écran : plan 41, item G4 (2026-10-03). Elle ne
// redessine aucun composant signature ; elle assemble ceux livrés par S1 à S7 sur leurs surfaces.
const meta = {
  title: "Playground/Charte",
  id: "playground-charte",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

type Surface = {
  cle: "or" | "clara" | "marine";
  titre: string;
  emploi: string;
  classes: string;
  boutonPrincipal: ButtonColor;
  boutonSecondaire: ButtonColor;
  contrastes: { nom: string; ratio: string }[];
};

const SURFACES: Surface[] = [
  {
    cle: "or",
    titre: "Surface or",
    emploi: "Navigation, bandeaux et accueil",
    classes: "bg-accent text-foreground",
    boutonPrincipal: "marine",
    boutonSecondaire: "marine",
    contrastes: [
      { nom: "Texte, discret et lien · marine/or", ratio: "6,31:1" },
      { nom: "Action principale · blanc/marine", ratio: "13,07:1" },
    ],
  },
  {
    cle: "clara",
    titre: "Surface claire",
    emploi: "Lecture, formulaires et transaction",
    classes: "bg-background text-foreground",
    boutonPrincipal: "accent",
    boutonSecondaire: "neutral",
    contrastes: [
      { nom: "Texte · marine/clair", ratio: "12,04:1" },
      { nom: "Discret et lien · bleu moyen/clair", ratio: "6,05:1" },
      { nom: "Action principale · marine/or", ratio: "6,31:1" },
    ],
  },
  {
    cle: "marine",
    titre: "Surface marine",
    emploi: "Rails et pied de page",
    classes: "bg-[var(--charte-marine)] text-foreground",
    boutonPrincipal: "accent",
    boutonSecondaire: "neutral",
    contrastes: [
      { nom: "Texte · blanc/marine", ratio: "13,07:1" },
      { nom: "Discret · bleu poudre/marine", ratio: "8,02:1" },
      { nom: "Lien et action · or/marine", ratio: "6,31:1" },
    ],
  },
];

function SurfaceCharte({ surface }: { surface: Surface }) {
  return (
    <article
      data-superficie={surface.cle}
      className={`min-w-0 rounded-[16px] p-5 ${surface.classes}`}
    >
      <Title as="h3" size="bloque">{surface.titre}</Title>
      <p className="mt-1 text-base text-muted">{surface.emploi}</p>
      <p className="mt-4 text-base">Texte courant lisible sur la surface.</p>
      <p className="mt-1 text-base text-muted">Information secondaire et discrète.</p>
      <Link href="/" className="mt-2 inline-block min-h-11 py-2 text-link underline underline-offset-4">
        Lien de navigation
      </Link>
      <div className="mt-3">
        <Field
          label="Champ de référence"
          value="Guatapé"
          onChange={() => {}}
          hint="Hauteur 48 px, rayon 8 px"
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button color={surface.boutonPrincipal}>Action principale</Button>
        <Button color={surface.boutonSecondaire} variant={surface.cle === "marine" ? "soft" : "outline"}>
          Secondaire
        </Button>
      </div>
      <div className="mt-5 border-t border-separator pt-4">
        <p className="mb-2 text-sm font-semibold">Contrastes vérifiés dans Palette</p>
        <dl className="flex flex-col gap-1 text-sm">
          {surface.contrastes.map((contraste) => (
            <div key={contraste.nom} className="flex items-start justify-between gap-3">
              <dt>{contraste.nom}</dt>
              <dd className="shrink-0 font-mono tabular-nums">{contraste.ratio} · conforme</dd>
            </div>
          ))}
        </dl>
      </div>
    </article>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <section className="flex min-w-0 flex-col gap-5 rounded-[16px] bg-surface p-5 sm:p-8">{children}</section>;
}

export const Reference: Story = {
  name: "La charte Hifago 2026",
  render: () => (
    <PageShell variant="pagina">
      <BandeauPagina
        variante="contenido"
        titulo="La charte Hifago 2026"
        chapo="Une page de référence pour composer les prochains écrans avec les rôles, surfaces et composants adoptés."
      />

      <Section>
        <TituloRubrica as="h2" texto="Rôles typographiques" tamano="seccion" />
        <p className="max-w-[75ch] text-base text-muted">
          Production et Storybook chargent les mêmes familles : Anton pour les titres, Poppins pour le texte.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="rounded-[16px] border border-border p-4">
            <Title as="h3" size="pagina">Titre de page</Title>
            <p className="mt-1 text-sm text-muted">Anton 400 · 32 → 52 px</p>
          </div>
          <div className="rounded-[16px] border border-border p-4">
            <Title as="h3" size="seccion">Titre de section</Title>
            <p className="mt-1 text-sm text-muted">Anton 400 · 26 → 40 px</p>
          </div>
          <div className="rounded-[16px] border border-border p-4">
            <Title as="h3" size="bloque">Titre de bloc</Title>
            <p className="mt-1 text-sm text-muted">Anton 400 · 20 → 22 px</p>
          </div>
          <div className="rounded-[16px] border border-border p-4">
            <Title as="h3" size="etiqueta">Étiquette</Title>
            <p className="mt-1 text-sm text-muted">Poppins 600 · 14 → 15 px</p>
          </div>
        </div>
      </Section>

      <Section>
        <TituloRubrica as="h2" texto="Trois surfaces" tamano="seccion" />
        <div className="grid gap-4 lg:grid-cols-3">
          {SURFACES.map((surface) => <SurfaceCharte key={surface.cle} surface={surface} />)}
        </div>
      </Section>

      <Section>
        <TituloRubrica as="h2" texto="Formes et états" tamano="seccion" />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-[8px] border border-border p-4">8 px · boutons et champs</div>
          <div className="rounded-[16px] border border-border p-4">16 px · tuiles et conteneurs</div>
          <div className="rounded-full border border-border p-4">Pilule · puces et bulles</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <PuceEstado tono="exito">Confirmée</PuceEstado>
          <PuceEstado tono="alerta">À payer</PuceEstado>
          <PuceEstado tono="error">Expirée</PuceEstado>
          <PuceEstado tono="info">En confirmation</PuceEstado>
          <PuceEstado tono="neutro">Réservée</PuceEstado>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Aviso tono="info" titulo="Information">Un contexte utile sans interrompre le parcours.</Aviso>
          <Aviso tono="exito" titulo="Succès">La réservation est bien enregistrée.</Aviso>
          <Aviso tono="alerta" titulo="Attention">Une action reste nécessaire avant de continuer.</Aviso>
          <Aviso tono="error" titulo="Erreur">Le problème est expliqué avec une suite possible.</Aviso>
        </div>
        <div data-superficie="clara" className="flex justify-end rounded-[16px] bg-background p-4">
          <EnlaceGo href="/actividades" label="Voir toutes les activités" tamano="normal" />
        </div>
      </Section>

      <div data-superficie="or" className="rounded-[16px] bg-accent py-6">
        <SeccionRiel
          titulo="Le rail signature"
          tamanoTitulo="seccion"
          hrefVerMas="/actividades"
          labelVerMas="Voir toutes les activités"
          tarjetas={TARJETAS_POR_TIPO.activity.slice(0, 3)}
          locale="es"
          labelDesde="Desde"
        />
      </div>
    </PageShell>
  ),
};
