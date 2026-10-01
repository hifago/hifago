import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor } from "storybook/test";
import { addDaysIso, todayInBogota } from "@hifago/domain";
import { historiaDePagina } from "@/.storybook/support/pagina";
import { esperar, pulsar, pulsarDia } from "@/.storybook/support/interacciones";
import { carritoSimulado, simularErrorAuth } from "@/.storybook/support/supabaseFalso";
import type { RutasSimuladas } from "@/.storybook/support/fetch";
import {
  ACTIVIDAD_CAMINATA,
  ACTIVIDAD_CONSULTAR,
  ACTIVIDAD_KAYAK,
  ALOJAMIENTO_DORM_CONECTOR_CORTADO,
  ALOJAMIENTO_DORM_PMS,
  ALOJAMIENTO_DORM_SIN_ESPEJO,
  ALOJAMIENTO_GLAMPING,
  CAMP_ESCALADA,
  EVENTO_FESTIVAL,
  EVENTO_JAM,
  EVENTO_MARATON,
  EVENTO_SIN_ENLACE,
  TRANSPORTE_LANCHA,
} from "@/.storybook/support/fixtures/productos";
import ProductoPage from "./page";

// La fiche d'une offre, rendue EN ENTIER : coquille, fil d'Ariane, photos, formulaire de
// réservation. Un formulaire par mode de réservation (date, créneaux, camp, hébergement avec ou
// sans PMS, vitrine, événement), puis les états qui ne s'obtiennent qu'en cliquant. Inventaire :
// `apps/web/components/README.md`, « Stories d'écran ».
const meta = { title: "Écrans/Fiche produit", id: "ecrans-fiche-produit" } satisfies Meta;
export default meta;

const dia = (desplazamiento: number) => addDaysIso(todayInBogota(), desplazamiento);

const ficha = (
  slug: string,
  opciones: { preparar?: () => void; simularFetch?: RutasSimuladas } = {}
): StoryObj => {
  const historia = historiaDePagina({
    Page: ProductoPage,
    grupo: "vitrine",
    ruta: `/productos/${slug}`,
    params: { slug },
    preparar: opciones.preparar,
  });
  return opciones.simularFetch
    ? { ...historia, parameters: { ...historia.parameters, simularFetch: opciones.simularFetch } }
    : historia;
};

// — Un formulaire par mode de réservation —

export const ActividadConFranjas: StoryObj = { ...ficha(ACTIVIDAD_KAYAK.slug), name: "Activité à créneaux" };

export const ActividadConFecha: StoryObj = {
  ...ficha(ACTIVIDAD_CAMINATA.slug),
  name: "Activité à la date (minimum 2 personnes)",
};

export const Camp: StoryObj = { ...ficha(CAMP_ESCALADA.slug), name: "Camp : éditions, programme, remise de groupe" };

export const AlojamientoSinPms: StoryObj = { ...ficha(ALOJAMIENTO_GLAMPING.slug), name: "Hébergement hors PMS" };

export const AlojamientoPms: StoryObj = {
  ...ficha(ALOJAMIENTO_DORM_PMS.slug),
  name: "Hébergement PMS (dortoir), séjour minimum le week-end",
};

// Connecteur PMS coupé : aucune réservation en ligne possible. Le calendrier laisse place à un bloc
// qui le dit et renvoie vers l'établissement (dont la page porte le contact).
export const AlojamientoPmsConectorCortado: StoryObj = {
  ...ficha(ALOJAMIENTO_DORM_CONECTOR_CORTADO.slug),
  name: "Hébergement PMS, connecteur coupé",
  play: async ({ canvasElement }) => {
    await expect(await esperar(canvasElement, '[data-testid="pms-no-reservable"]')).toBeVisible();
  },
};

export const Transporte: StoryObj = { ...ficha(TRANSPORTE_LANCHA.slug), name: "Transport (vitrine, trajet, carte)" };

export const EventoVitrina: StoryObj = { ...ficha(EVENTO_JAM.slug), name: "Événement récurrent en vitrine" };

export const EventoReservable: StoryObj = {
  ...ficha(EVENTO_FESTIVAL.slug),
  name: "Événement réservable, une date complète",
};

export const EventoGratisInscripcion: StoryObj = {
  ...ficha(EVENTO_MARATON.slug),
  name: "Événement gratuit sur inscription",
};

// — Cas limites de contenu —

export const PrecioConsultarSinFoto: StoryObj = {
  ...ficha(ACTIVIDAD_CONSULTAR.slug),
  name: "Prix « Consultar », sans photo, textes longs",
};

export const EventoSinEnlace: StoryObj = {
  ...ficha(EVENTO_SIN_ENLACE.slug),
  name: "Événement sans lien (aucun bouton, défaut connu)",
};

// — États obtenus en cliquant —

export const FranjaElegida: StoryObj = {
  ...ficha(ACTIVIDAD_KAYAK.slug),
  name: "Créneau choisi",
  play: async ({ canvasElement }) => {
    await pulsarDia(canvasElement, dia(1));
    await pulsar(canvasElement, `[data-testid="slot-chip-${dia(1)}-10:00"]`);
    await expect(await esperar(canvasElement, '[data-testid="add-to-cart-button"]')).toBeEnabled();
  },
};

export const FechaElegida: StoryObj = {
  ...ficha(ACTIVIDAD_CAMINATA.slug),
  name: "Date choisie",
  play: async ({ canvasElement }) => {
    await pulsarDia(canvasElement, dia(1));
    await expect(await esperar(canvasElement, '[data-testid="add-to-cart-button"]')).toBeEnabled();
  },
};

export const CampEdicionElegida: StoryObj = {
  ...ficha(CAMP_ESCALADA.slug),
  name: "Camp : édition choisie, semaine surlignée",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, `[data-testid="edition-card-${dia(7)}"]`);
    await expect(await esperar(canvasElement, `[data-testid="edition-card-${dia(7)}"]`)).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  },
};

export const AlojamientoRangoElegido: StoryObj = {
  ...ficha(ALOJAMIENTO_GLAMPING.slug),
  name: "Hébergement : nuits choisies, total estimé",
  play: async ({ canvasElement }) => {
    await pulsarDia(canvasElement, dia(1));
    await pulsarDia(canvasElement, dia(3));
    await expect(await esperar(canvasElement, '[data-testid="lodging-estimated-price"]')).toBeVisible();
  },
};

export const AnadidoAlViaje: StoryObj = {
  ...ficha(ACTIVIDAD_KAYAK.slug),
  name: "Ajouté au voyage (toast, pastille du panier)",
  play: async ({ canvasElement }) => {
    await pulsarDia(canvasElement, dia(1));
    await pulsar(canvasElement, `[data-testid="slot-chip-${dia(1)}-10:00"]`);
    await pulsar(canvasElement, '[data-testid="add-to-cart-button"]');
    await waitFor(() => expect(carritoSimulado()).toHaveLength(1));
  },
};

export const AnadirFallido: StoryObj = {
  ...ficha(ACTIVIDAD_KAYAK.slug, { preparar: () => simularErrorAuth("anonymous_provider_disabled") }),
  name: "Ajout impossible (toast d'erreur)",
  play: async ({ canvasElement }) => {
    await pulsarDia(canvasElement, dia(1));
    await pulsar(canvasElement, `[data-testid="slot-chip-${dia(1)}-10:00"]`);
    await pulsar(canvasElement, '[data-testid="add-to-cart-button"]');
    // Le refus est asynchrone : on laisse à `addLine` le temps d'échouer avant de constater.
    await new Promise((resolver) => setTimeout(resolver, 400));
    await expect(carritoSimulado()).toHaveLength(0);
  },
};

// — Disponibilité interrogée en direct chez LobbyPMS (pas de miroir semé) —

const DISPONIBILIDAD_PMS = "/api/pms/night-availability";

export const PmsConsultando: StoryObj = {
  ...ficha(ALOJAMIENTO_DORM_SIN_ESPEJO.slug, { simularFetch: { [DISPONIBILIDAD_PMS]: { demora: "nunca" } } }),
  name: "PMS : disponibilité en cours de lecture",
};

export const PmsInalcanzable: StoryObj = {
  ...ficha(ALOJAMIENTO_DORM_SIN_ESPEJO.slug, {
    simularFetch: { [DISPONIBILIDAD_PMS]: { status: 502, body: { ok: false, reason: "pms_unreachable" } } },
  }),
  name: "PMS : injoignable (Réessayer)",
};

export const PmsLimiteConsultas: StoryObj = {
  ...ficha(ALOJAMIENTO_DORM_SIN_ESPEJO.slug, {
    simularFetch: {
      [DISPONIBILIDAD_PMS]: { status: 429, body: { ok: false, reason: "pms_rate_limited", retryAfterSeconds: 60 } },
    },
  }),
  name: "PMS : trop de consultations",
};

export const PmsConectorInactivo: StoryObj = {
  ...ficha(ALOJAMIENTO_DORM_SIN_ESPEJO.slug, {
    simularFetch: { [DISPONIBILIDAD_PMS]: { body: { ok: false, reason: "connector_inactive" } } },
  }),
  name: "PMS : connecteur coupé (sans bouton)",
};
