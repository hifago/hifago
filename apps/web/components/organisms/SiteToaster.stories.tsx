import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { toast } from "@hifago/ui";
import { CartProvider } from "@/lib/cart/CartContext";
import { PanierPre } from "@/components/playground/PanierPre";
import { Button } from "@/components/atoms/Button";
import { Field } from "@/components/atoms/Field";
import { PageShell } from "@/components/atoms/PageShell";
import { Title } from "@/components/atoms/Title";
import { SiteHeader } from "./SiteHeader";
import { SiteToaster } from "./SiteToaster";

// ⚠️ Une story de toast est particulière : le composant ne rend RIEN tant qu'aucun toast n'existe
// (`visibleToasts.length === 0` → la région retourne `null`). Il n'y a donc rien à regarder sans
// boutons qui en déclenchent — d'où les déclencheurs ci-dessous, qui font partie de la story et
// jamais du composant.
//
// À regarder aux deux gabarits (390 / 1280) et sur les surfaces claire, or et marine : le toast est
// le seul élément du site qui se superpose au contenu, donc le seul dont le contraste dépend de ce
// qu'il recouvre.
//
// ⚠️ La file de toasts est un SINGLETON, partagé par toutes les stories de l'iframe : un toast
// déclenché ici survit au changement de story tant que ses 4 secondes ne sont pas écoulées. Ce
// n'est pas un défaut, c'est la propriété qui fait qu'un toast survit à un `router.push()`.
//
// Les déclencheurs restent de vrais boutons de la charte : la story ne change pas leur variante
// pour améliorer artificiellement un résultat d'accessibilité.
const meta = {
  title: "Coquille/SiteToaster",
  component: SiteToaster,
  parameters: {
    layout: "fullscreen",
    // ⚠️ Repris de SiteHeader.stories.tsx, et indispensable dès que `SurUnEcranReel` monte le
    // header : le `Link` de next-intl auquel le sélecteur de langue passe une prop `locale` lit le
    // chemin courant, `null` hors d'une route Next — la story ne rendait RIEN, sans autre indice
    // qu'un « Cannot read properties of null (reading 'pathname') » en console.
    nextjs: { appDirectory: true, navigation: { pathname: "/verificar-email" } },
  },
} satisfies Meta<typeof SiteToaster>;

export default meta;
type Story = StoryObj<typeof meta>;

// Messages repris des fichiers de messages réels (messages/es/VerifyEmail.json), jamais inventés :
// ce sont eux que la vitrine affichera, et leur longueur est ce qui décide du rendu.
const SUCCES = "Correo reenviado.";
const ERREUR = "No se pudo reenviar el correo. Inténtalo de nuevo en unos segundos.";

// ⚠️ Le plus long message d'erreur réellement présent dans le dépôt
// (messages/es/ProductPage.json → pmsAvailabilityError). C'est lui qui révèle le comportement en
// pleine largeur sous 640 px, où la région occupe `calc(100vw - 2rem)`.
const ERREUR_LONGUE =
  "No se pudo consultar la disponibilidad en este momento. Intenta de nuevo más tarde. " +
  "Si el problema persiste, escríbenos y reservamos manualmente tu alojamiento en Guatapé.";

function Declencheurs() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button onPress={() => toast.success(SUCCES)} testId="declencheur-succes">
        Éxito
      </Button>
      <Button color="danger" onPress={() => toast.danger(ERREUR)} testId="declencheur-erreur">
        Error
      </Button>
      <Button
        variant="outline"
        color="neutral"
        onPress={() => {
          // Trois d'un coup : c'est l'empilement, le décalage d'échelle et le nombre maximum
          // visible qui se regardent ici, pas le message.
          toast.success("Reserva confirmada.");
          toast.danger("No se pudo cobrar el depósito.");
          toast.success("Correo de confirmación enviado.");
        }}
        testId="declencheur-empilement"
      >
        Tres a la vez
      </Button>
      <Button
        variant="outline"
        color="neutral"
        onPress={() => toast.danger(ERREUR_LONGUE)}
        testId="declencheur-long"
      >
        Mensaje largo
      </Button>
    </div>
  );
}

export const Defaut: Story = {
  render: () => (
    <PageShell variant="pagina">
      <Title as="h1">Notificaciones</Title>
      <Declencheurs />
      <SiteToaster testId="toaster" />
    </PageShell>
  ),
};

// ⚠️ LA story du lot, et celle qui a tranché le placement. Un écran réel de la vitrine : le
// `SiteHeader` collant en haut, un formulaire, et son bouton principal en bas — la configuration
// exacte du tunnel de réservation et de l'écran « renvoyer l'email de confirmation ».
//
// C'est ici qu'on mesure ce que le toast RECOUVRE, à 390 px :
//   • en `bottom` (le réglage de l'admin), il se pose sur le bouton principal — donc sur l'action
//     que l'utilisateur vient de déclencher, et sur celle qu'il doit represser en cas d'échec ;
//   • en `top` (le réglage retenu), il se pose sur l'en-tête, avec lequel personne n'interagit à
//     l'instant où une opération se termine.
// Détail chiffré dans l'en-tête de SiteToaster.tsx.
export const SurUnEcranReel: Story = {
  render: () => (
    <CartProvider>
      <PanierPre lignes={2} />
      <div className="flex min-h-screen flex-col">
        <SiteHeader isAuthenticated={false} testId="header" />
        <PageShell variant="pagina">
          <Title as="h1">Finaliza tu reserva</Title>
          <p className="text-sm">
            Paseo en lancha por el Embalse de Guatapé · Casa Kayam · 14 de septiembre de 2026
          </p>
          {/* ⚠️ Quatre champs, pas un : le formulaire doit DÉPASSER la hauteur du gabarit 390, sinon
              le bouton principal reste au milieu de l'écran et la mesure du placement ne mesure
              rien. Le vrai tunnel (CheckoutForm) en porte quatre plus une case à cocher — celui-ci
              en est la réduction fidèle. */}
          <ChampTexte etiquette="Nombre y apellido" nom="holder-name" initial="Ana Restrepo" />
          <ChampTexte etiquette="Teléfono" nom="holder-phone" initial="+57 300 000 00 00" />
          <ChampTexte etiquette="Correo" nom="holder-email" initial="hola@ejemplo.com" />
          <ChampTexte etiquette="Documento" nom="holder-doc" initial="1 234 567 890" />
          <p className="text-xs text-muted">
            Cancelación gratuita hasta 24 horas antes del inicio de la actividad.
          </p>
          <Declencheurs />
          {/* Le bouton principal est le DERNIER élément de la page, comme dans CheckoutForm et
              dans ResendConfirmationForm : c'est lui que le toast risque de recouvrir. */}
          <Button width="full" testId="action-principale" onPress={() => toast.success(SUCCES)}>
            Pagar y reservar
          </Button>
        </PageShell>
        <SiteToaster testId="toaster" />
      </div>
    </CartProvider>
  ),
};

/** `Field` est contrôlé — un état local suffit ici, la story ne teste pas la saisie. */
function ChampTexte({ etiquette, nom, initial }: { etiquette: string; nom: string; initial: string }) {
  const [valeur, setValeur] = useState(initial);
  return <Field label={etiquette} name={nom} value={valeur} onChange={setValeur} width="full" />;
}
