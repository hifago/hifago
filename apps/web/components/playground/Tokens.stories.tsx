import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

// Ce que la vitrine utilise RÉELLEMENT — lu à l'exécution, pas recopié d'un fichier.
//
// Le thème `vitrine` porte la charte Hifago 2026 dans packages/ui/src/styles/globals.css.
// Basculer sur `admin` permet seulement d'inspecter l'autre application ; il n'existe plus de
// palette candidate ni de mode sombre pour la vitrine.

const COULEURS = [
  "--background", "--foreground", "--surface", "--surface-foreground", "--overlay",
  "--muted", "--default", "--default-foreground", "--accent", "--accent-foreground",
  "--success", "--warning", "--danger", "--border", "--separator", "--focus", "--link",
  "--field-background", "--field-foreground", "--field-border",
];

const FORMES = ["--radius", "--field-radius", "--border-width", "--field-border-width"];
const POLICES = ["--font-sans", "--font-mono"];
const TOUS = [...COULEURS, ...FORMES, ...POLICES];

/** `getComputedStyle` est appelé UNE fois, pas une fois par token. */
function lireTokens(noms: string[]): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(noms.map((n) => [n, style.getPropertyValue(n).trim()]));
}

function useTokens(noms: string[]) {
  // Initialiseur paresseux plutôt qu'un effet : lire une valeur calculée n'est pas une
  // synchronisation, et setState dans le corps d'un effet déclenche des rendus en cascade.
  const [valeurs, setValeurs] = React.useState(() => lireTokens(noms));

  // L'effet ne sert qu'à S'ABONNER à un système externe — l'addon de thème modifie `data-theme`
  // sur <html>. C'est l'usage légitime d'un effet, et ça rend la bascule de thème réactive sans
  // recharger la page. ⚠️ Ne pas remplacer par une lecture pendant le rendu depuis `globals` :
  // l'addon pose l'attribut dans un effet, on lirait donc le thème précédent.
  React.useEffect(() => {
    const observateur = new MutationObserver(() => setValeurs(lireTokens(noms)));
    observateur.observe(document.documentElement, {
      attributes: true,
      // Le thème et le comparateur de rayon sont les deux globals encore susceptibles de changer
      // les jetons affichés sans remonter la story.
      attributeFilter: ["data-theme", "data-radius"],
    });
    return () => observateur.disconnect();
  }, [noms]);

  return valeurs;
}

function Ligne({ nom, valeur, echantillon }: { nom: string; valeur: string; echantillon?: boolean }) {
  const defini = valeur !== "";
  return (
    <div className="flex items-center gap-3 border-b border-[var(--separator)] py-2 text-sm">
      {echantillon ? (
        <span
          className="size-8 shrink-0 rounded border border-[var(--border)]"
          style={{ background: defini ? `var(${nom})` : "transparent" }}
        />
      ) : null}
      <code className="w-56 shrink-0 font-mono text-xs">{nom}</code>
      {/* Une valeur de jeton peut être une expression CSS bien plus longue qu'une couleur simple.
          Sans `min-w-0 break-words`, cette ligne pousse la page au-delà du gabarit Mobile 390. */}
      <span className={`min-w-0 break-words ${defini ? "text-xs" : "text-xs italic text-[var(--muted)]"}`}>
        {defini ? valeur : "non défini — valeur héritée du navigateur"}
      </span>
    </div>
  );
}

// Purement présentationnelle : les valeurs viennent d'un unique `useTokens` en amont, sinon chaque
// section poserait son propre MutationObserver sur le même attribut.
function Section({
  titre,
  noms,
  valeurs,
  echantillon,
}: {
  titre: string;
  noms: string[];
  valeurs: Record<string, string>;
  echantillon?: boolean;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-lg font-semibold">{titre}</h2>
      <div>
        {noms.map((n) => (
          <Ligne key={n} nom={n} valeur={valeurs[n]} echantillon={echantillon} />
        ))}
      </div>
    </section>
  );
}

function Tokens() {
  const valeurs = useTokens(TOUS);
  return (
    <div className="max-w-2xl">
      <p className="mb-6 text-sm text-[var(--muted)]">
        Valeurs calculées sur <code>&lt;html&gt;</code> au moment du rendu. Change le thème dans la
        barre d’outils pour comparer <strong>vitrine</strong> et <strong>admin</strong>.
      </p>
      <Section titre="Couleurs" noms={COULEURS} valeurs={valeurs} echantillon />
      <Section titre="Formes" noms={FORMES} valeurs={valeurs} />
      <Section titre="Polices" noms={POLICES} valeurs={valeurs} />
    </div>
  );
}

const meta = {
  title: "Playground/Tokens",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const EnVigueur: Story = { render: () => <Tokens /> };
