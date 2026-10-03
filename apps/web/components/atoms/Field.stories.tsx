import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Field, type FieldProps } from "./Field";
import { Textarea } from "./Textarea";
import { Select } from "./Select";
import { Checkbox } from "./Checkbox";
import { Button } from "./Button";
import { Legende } from "../playground/Legende";

// Le champ de saisie de la vitrine, dans tous ses états.
//
// ⚠️ Chaque story met ses valeurs dans `args`, JAMAIS dans le `render` après le spread. Ça a l'air
// d'un détail de forme, c'en est un de fond : écrire `<Champ {...args} type="email" />` écrase
// silencieusement le contrôle du panneau, et le lecteur en conclut que la prop ne marche pas.
// Constaté le 2026-09-02 sur `type` — passer le contrôle à `password` ne masquait rien, parce que
// la story réimposait `email` juste après.
//
// Toutes les stories sont réellement saisissables : un champ figé ne montre ni le focus, ni ce que
// devient un libellé long à côté d'une valeur longue. À regarder aux deux gabarits dans la charte
// claire adoptée.
const meta = {
  title: "Saisie/Field",
  component: Field,
  parameters: { layout: "padded" },
  argTypes: {
    // ⚠️ Déclaré à la main, et c'est une conséquence directe d'une décision du composant : depuis
    // que `FieldProps` est une union discriminée (les libellés du bouton œil ne sont requis que
    // pour `type="password"`), react-docgen ne sait plus fusionner les deux branches et retombe
    // sur un contrôle « object ». Storybook ignore alors la valeur envoyée par le panneau ou par
    // l'URL — le contrôle s'affiche et ne fait rien. Mesuré le 2026-09-02, après que Jérôme a
    // signalé « le type password ne fonctionne pas ».
    type: {
      control: "select",
      options: ["text", "email", "password", "search", "tel", "number"],
      description: "Type du champ. `password` exige les deux libellés du bouton de révélation.",
    },
    revealLabel: { control: "text" },
    hideLabel: { control: "text" },
  },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Rend le champ réellement utilisable dans le playground : l'état vit ici, et `value`/`onChange`
 * des args sont volontairement remplacés — ce sont les deux seules props qu'une story ne peut pas
 * piloter. Tout le reste passe intact, donc les contrôles fonctionnent.
 */
function ChampControle({ valeurInitiale = "", ...props }: FieldProps & { valeurInitiale?: string }) {
  const [valeur, setValeur] = useState(valeurInitiale);
  return <Field {...props} value={valeur} onChange={setValeur} />;
}

export const Defaut: Story = {
  args: { label: "Correo electrónico", type: "email", autoComplete: "email", value: "", onChange: () => {} },
  render: (args) => <ChampControle {...args} />,
};

export const Rempli: Story = {
  args: { label: "Correo electrónico", type: "email", value: "", onChange: () => {} },
  render: (args) => <ChampControle {...args} valeurInitiale="ada@example.com" />,
};

// ⚠️ Le champ mot de passe et son bouton de révélation (demande de Jérôme, 2026-09-02).
//
// Les deux libellés sont REQUIS par le type dès que `type="password"` : un bouton d'icône sans nom
// accessible n'annonce rien d'autre que « bouton » à un lecteur d'écran, et des libellés
// optionnels auraient fini par manquer. Le nom change avec l'état — c'est ce que le lecteur
// d'écran annonce à l'activation.
export const MotDePasse: Story = {
  args: {
    label: "Contraseña",
    type: "password",
    autoComplete: "current-password",
    revealLabel: "Mostrar la contraseña",
    hideLabel: "Ocultar la contraseña",
    value: "",
    onChange: () => {},
  },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <ChampControle {...args} valeurInitiale="contraseña-secreta" />
      <Legende>
        Clique sur l&apos;œil : le champ passe en clair et le nom du bouton devient « Ocultar la
        contraseña ». La cible fait 44 px, comme le champ.
      </Legende>
    </div>
  ),
};

// ⚠️ L'état que les cinq formulaires de l'app ne savent pas rendre aujourd'hui : leurs erreurs
// vivent dans un <p> à part, relié à rien. Ici le message est porté par le champ, qui devient
// invalide et se décrit lui-même à un lecteur d'écran.
export const EnErreur: Story = {
  args: {
    label: "Correo electrónico",
    type: "email",
    error: "Introduce un correo válido",
    value: "",
    onChange: () => {},
  },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <ChampControle {...args} valeurInitiale="ada@" />
      <Legende>
        Le message est relié au champ par aria-describedby, et le champ porte aria-invalid — c&apos;est
        ce que lit un lecteur d&apos;écran, pas la couleur.
      </Legende>
    </div>
  ),
};

export const Requis: Story = {
  args: { label: "Nombre del titular", isRequired: true, value: "", onChange: () => {} },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <ChampControle {...args} />
      <Legende>
        ⚠️ Requis en aria, jamais en validation native : un champ natif requis fait bloquer la
        soumission par le navigateur AVANT le onSubmit React (CLAUDE.md §11 point 11), donc sans
        aucun message. Ce champ-là se soumet même dans un formulaire qui a oublié noValidate.
      </Legende>
    </div>
  ),
};

export const AvecAide: Story = {
  args: {
    label: "Contraseña",
    type: "password",
    revealLabel: "Mostrar la contraseña",
    hideLabel: "Ocultar la contraseña",
    hint: "Mínimo 6 caracteres",
    minLength: 6,
    value: "",
    onChange: () => {},
  },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <ChampControle {...args} />
      <ChampControle {...args} error="Demasiado corta" valeurInitiale="abc" />
      <Legende>
        ⚠️ En erreur, HeroUI masque le texte d&apos;aide au profit du message — les deux restent
        reliés au champ, seul l&apos;affichage change.
      </Legende>
    </div>
  ),
};

export const Desactive: Story = {
  args: { label: "Cantidad", isDisabled: true, width: "short", value: "", onChange: () => {} },
  render: (args) => <ChampControle {...args} valeurInitiale="2" />,
};

// Les trois largeurs sont les trois usages réels du dépôt, pas un catalogue : elles remplacent les
// `className` que quatre écrans passent aujourd'hui à TextField.
export const Largeurs: Story = {
  args: { label: "Buscar", value: "", onChange: () => {} },
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <ChampControle label="Nombre del titular" value="" onChange={() => {}} />
        <Legende>full (défaut) — un champ de formulaire occupe sa colonne</Legende>
      </div>
      <div className="flex flex-col gap-1">
        <ChampControle
          label="Cantidad"
          type="number"
          min={1}
          max={9}
          width="short"
          valeurInitiale="2"
          value=""
          onChange={() => {}}
        />
        <Legende>short — les trois champs de quantité (max-w-32)</Legende>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <ChampControle
          label="Buscar"
          type="search"
          placeholder="Kayak, lancha…"
          width="grow"
          value=""
          onChange={() => {}}
        />
        <Legende>grow — la recherche du catalogue, dans une barre de filtres</Legende>
      </div>
    </div>
  ),
};

// L'espagnol fait 20 à 25 % de plus que l'anglais : c'est lui qui fait déborder les libellés.
export const TexteLong: Story = {
  args: {
    label: "Nombre completo del titular de la reserva tal y como aparece en el documento",
    hint: "Escríbelo exactamente como en tu documento de identidad, sin abreviaturas",
    error: "Este nombre no coincide con el documento indicado en el paso anterior",
    value: "",
    onChange: () => {},
  },
  render: (args) => (
    <ChampControle {...args} valeurInitiale="María de los Ángeles Fernández de la Torre y Villanueva" />
  ),
};

// ⚠️ LA story qui compte : un champ isolé peut être parfait et le formulaire illisible. Les quatre
// composants du lot ensemble, dans l'ordre et la largeur d'un vrai écran de paiement.
function FormulaireDemo() {
  const [nom, setNom] = useState("");
  const [courriel, setCourriel] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [pays, setPays] = useState("");
  const [message, setMessage] = useState("");
  const [consentement, setConsentement] = useState(false);
  const [envoye, setEnvoye] = useState(false);

  // Validation d'exemple, volontairement écrite en JS : c'est tout le sujet du lot — la validation
  // native ne bloque plus rien, donc c'est React qui doit parler. (Motif délibérément simple : il
  // sert la démonstration, pas la production.)
  const courrielInvalide = courriel.length > 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(courriel);

  return (
    // Pas de noValidate, VOLONTAIREMENT : c'est la démonstration que les champs de ce lot n'en ont
    // plus besoin. Le formulaire se soumet, et c'est la validation React qui parle.
    <form
      className="flex w-full max-w-md flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setEnvoye(true);
      }}
    >
      <Field label="Nombre del titular" value={nom} onChange={setNom} isRequired name="holder-name" />
      <Field
        label="Correo electrónico"
        type="email"
        value={courriel}
        onChange={setCourriel}
        isRequired
        name="holder-email"
        autoComplete="email"
        hint="Te enviamos ahí la confirmación"
        error={courrielInvalide ? "Introduce un correo válido" : undefined}
      />
      <Field
        label="Contraseña"
        type="password"
        value={motDePasse}
        onChange={setMotDePasse}
        name="password"
        autoComplete="new-password"
        revealLabel="Mostrar la contraseña"
        hideLabel="Ocultar la contraseña"
        hint="Mínimo 6 caracteres"
      />
      <Select
        label="País de residencia"
        value={pays}
        onChange={setPays}
        allLabel="Sin especificar"
        options={[
          { value: "co", label: "Colombia" },
          { value: "fr", label: "Francia" },
          { value: "es", label: "España" },
        ]}
      />
      <Textarea
        label="Petición especial"
        value={message}
        onChange={setMessage}
        hint="Alergias, hora de llegada tardía…"
        maxLength={500}
      />
      <Checkbox
        label="Quiero recibir ofertas de Hifago"
        isSelected={consentement}
        onChange={setConsentement}
      />
      <Button type="submit" width="full">
        Confirmar y pagar
      </Button>
      {envoye ? (
        <p role="status" className="text-sm font-medium">
          Formulaire soumis — la validation native n&apos;a rien bloqué, malgré deux champs requis
          vides et aucun noValidate sur le &lt;form&gt;.
        </p>
      ) : null}
    </form>
  );
}

export const Formulaire: Story = {
  args: { label: "", value: "", onChange: () => {} },
  render: () => <FormulaireDemo />,
};
