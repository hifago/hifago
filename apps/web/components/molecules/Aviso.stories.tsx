import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Aviso } from "./Aviso";
import { Button } from "@/components/atoms/Button";

// Plan 41, S6. Les textes sont ceux des messages réels de la vitrine (`messages/es/*.json`), pour
// juger l'encadré sur des longueurs vraies. Ce que ces stories servent à regarder : les quatre tons
// côte à côte (l'icône doit suffire à les distinguer, couleur mise à part), la variante compacte
// dans une ligne, et l'encadré posé sur l'or, où il garde son blanc et son texte marine.
const meta = {
  title: "Affichage/Aviso",
  component: Aviso,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Aviso>;

export default meta;
type Story = StoryObj<typeof meta>;

// Le bandeau camp de l'index par type : une information, sans urgence.
export const Defaut: Story = {
  args: {
    tono: "info",
    children: "Elige un alojamiento para las 2 noches de tu campamento.",
  },
};

export const Exito: Story = {
  args: {
    tono: "exito",
    titulo: "Reserva confirmada",
    children: "Te enviamos el detalle por WhatsApp y por correo.",
  },
};

// « Hébergement requis » de Mi viaje : il bloque la réservation tant qu'il n'est pas levé.
export const Alerta: Story = {
  args: {
    tono: "alerta",
    children:
      "Tu campamento requiere un alojamiento en tu viaje que cubra sus 2 noches antes de reservar.",
  },
};

// Pas `Error` : le nom masquerait le constructeur global dans tout le module.
export const ErrorConTitulo: Story = {
  args: {
    tono: "error",
    titulo: "No pudimos confirmar tu reserva",
    children:
      "No pudimos confirmar tu reserva con el alojamiento. No se cobró nada. Si ves una reserva pendiente, se liberará sola en unos 30 minutos.",
  },
};

// L'échec de chargement de `ListadoInfinito` : un texte et une action pour réessayer.
export const ConAccion: Story = {
  args: {
    tono: "error",
    children: "No pudimos cargar más ofertas.",
    accion: (
      <Button type="button" variant="outline" color="neutral" size="sm" width="auto">
        Reintentar
      </Button>
    ),
  },
};

// La ligne indisponible de `CartSummary` (F6) : plus serré, à la taille du texte de la ligne.
export const Compacto: Story = {
  args: {
    tono: "error",
    compacto: true,
    rol: "alert",
    children: "Este servicio ya no está disponible. Puedes quitarlo de tu viaje.",
  },
};

// Sur l'or, une couleur d'état nue tombe sous 4,5:1 (§3.1 du plan) : l'encadré remet sa surface
// claire. À regarder : fond blanc, texte marine, bordure et icône du ton, rien de délavé.
export const SobreOro: Story = {
  args: {
    tono: "alerta",
    titulo: "Necesitas un alojamiento",
    children:
      "Tu campamento requiere un alojamiento en tu viaje que cubra sus 2 noches antes de reservar.",
  },
  decorators: [
    (Story) => (
      <div data-superficie="or" className="p-6">
        <Story />
      </div>
    ),
  ],
};

// À regarder aux deux gabarits : le texte passe à la ligne sous le titre, l'icône reste en haut.
export const TextoLargo: Story = {
  args: {
    tono: "info",
    titulo: "Tienes reservas pendientes de pago",
    children:
      "Tu reserva del 14 de octubre en Casa Kayam sigue esperando el pago. Si no la pagas antes de que expire, los cupos se liberan para otros viajeros y tendrás que volver a armar tu viaje desde el principio.",
    accion: (
      <Button type="button" variant="outline" color="neutral" size="sm" width="auto">
        Ver mis reservas
      </Button>
    ),
  },
};
