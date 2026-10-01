import { addDaysIso, todayInBogota } from "@hifago/domain";
import type { FichaProducto, FilaFranja, ResumenEstablecimiento } from "@/lib/catalog/tipos";

// Fiches produit des stories d'écran (2026-10-01). Une fiche par cas que Jérôme doit voir pour
// décider du design. Les textes sont RÉALISTES, pas du lorem ipsum : on ne juge pas une
// typographie sur un faux texte. Les photos sont les vraies de `mockData/`, servies sous `/mock`
// par `staticDirs` (.storybook/main.ts). ⚠️ Jamais `establishments/etablissement{1..4}/` : ce sont des
// LOGOS de marques (Goélia, Club Med, UCPA, Hilton), pas des photos de lieu.
//
// ⚠️ Les dates sont RELATIVES à aujourd'hui à Guatapé, jamais écrites en dur : une story figée sur
// une date passée afficherait un calendrier entièrement fermé dès la semaine suivante.

const hoy = todayInBogota();
const dia = (desplazamiento: number) => addDaysIso(hoy, desplazamiento);

export const ESTABLECIMIENTO_EMBALSE: ResumenEstablecimiento = {
  id: "est-embalse",
  slug: "casa-del-embalse",
  nombre: "Casa del Embalse",
  descripcion:
    "Casa de huéspedes a la orilla del embalse, con muelle propio y vista directa a la Piedra del Peñol.",
  direccion: "Vereda La Piedra, Guatapé, Antioquia",
  fotos: [
    { url: "/mock/establishments/bania/photos/1.jpeg" },
    { url: "/mock/rooms/bania-casa-completa/photos/2.jpeg" },
  ],
};

/** Franjas d'une heure, de 10:00 à 16:00, sur trois semaines — quelques-unes déjà pleines. */
function franjasHorarias(capacidad: number): FilaFranja[] {
  const filas: FilaFranja[] = [];
  for (let d = 1; d <= 21; d += 1) {
    for (let hora = 10; hora <= 16; hora += 1) {
      const lleno = (d + hora) % 5 === 0;
      filas.push({
        slot_date: dia(d),
        slot_start_time: `${String(hora).padStart(2, "0")}:00:00`,
        capacity: capacidad,
        booked: lleno ? capacidad : (d * hora) % capacidad,
        slot_duration_minutes: 60,
      });
    }
  }
  return filas;
}

const BASE: Omit<FichaProducto, "id" | "slug" | "tipo" | "nombre" | "modoReserva"> = {
  descripcion: null,
  fotos: [],
  precio: null,
  unidad: null,
  minQty: 1,
  urlExterna: null,
  ocurrencia: null,
  eventoReservable: null,
  alojamiento: null,
  transporte: null,
  duracionDias: null,
  descuentoGrupo: null,
  programa: null,
  primeraSalidaIso: null,
  disponibilidad: [],
  restriccionesPms: [],
  tarifas: [],
  franjas: [],
  establecimiento: null,
  localesNativas: ["es"],
};

export const ACTIVIDAD_KAYAK: FichaProducto = {
  ...BASE,
  id: "prod-kayak",
  slug: "kayak-en-el-embalse",
  tipo: "activity",
  nombre: "Kayak en el embalse",
  descripcion:
    "Una hora de kayak entre las islas del embalse de Guatapé, con chaleco, remo y una breve " +
    "explicación antes de salir. Apto para principiantes: el agua es tranquila por la mañana.",
  fotos: [
    { url: "/mock/activities/kayak1/photos/1.jpeg" },
    { url: "/mock/activities/kayak1/photos/2.jpeg" },
  ],
  precio: { tipo: "monto", cop: 20000 },
  unidad: "per_person",
  modoReserva: "slot",
  franjas: franjasHorarias(6),
  establecimiento: ESTABLECIMIENTO_EMBALSE,
};

export const ESTABLECIMIENTO_KAYAM: ResumenEstablecimiento = {
  id: "est-kayam",
  slug: "casa-kayam",
  nombre: "Casa Kayam",
  descripcion: "Hostal y glamping en la montaña, a diez minutos del pueblo, con música en vivo los viernes.",
  direccion: "Vereda El Roble, Guatapé, Antioquia",
  fotos: [{ url: "/mock/establishments/kayam/photos/1.jpeg" }],
};

/** Une ligne par jour ouvert, sur `jours` jours à partir de demain — quelques jours pleins. */
function diasAbiertos(jours: number, capacidad: number, cadaLleno = 6) {
  return Array.from({ length: jours }, (_, i) => ({
    date: dia(i + 1),
    capacity: capacidad,
    booked: (i + 1) % cadaLleno === 0 ? capacidad : (i * 3) % capacidad,
  }));
}

/** Activité réservée à la DATE (ReservationForm), minimum de groupe affiché. */
export const ACTIVIDAD_CAMINATA: FichaProducto = {
  ...BASE,
  id: "prod-caminata",
  slug: "caminata-a-la-cascada",
  tipo: "activity",
  nombre: "Caminata a la cascada",
  descripcion:
    "Tres horas de sendero entre bosque y potreros hasta la cascada de La Culebra, con guía local y " +
    "refrigerio. Nivel medio: hay barro después de la lluvia.",
  fotos: [
    { url: "/mock/activities/hikinggroup1/photos/1.jpeg" },
    { url: "/mock/tags/hiking/photos/1.jpeg" },
  ],
  precio: { tipo: "monto", cop: 45000 },
  unidad: "per_person",
  minQty: 2,
  modoReserva: "date",
  disponibilidad: diasAbiertos(40, 12),
  establecimiento: ESTABLECIMIENTO_KAYAM,
};

/** Camp sur plusieurs jours : éditions, programme daté, remise de groupe. */
export const CAMP_ESCALADA: FichaProducto = {
  ...BASE,
  id: "prod-camp-escalada",
  slug: "camp-de-escalada",
  tipo: "camp",
  nombre: "Camp de escalada — 5 días",
  descripcion:
    "Cinco días para aprender a escalar en roca en la Piedra del Peñol y sus alrededores: técnica, " +
    "nudos, seguridad y una salida final a una vía de varios largos.",
  fotos: [
    { url: "/mock/activities/climbing1/photos/1.jpeg" },
    { url: "/mock/activities/climbing1/photos/2.jpeg" },
    { url: "/mock/tags/climbing/photos/1.jpg" },
  ],
  precio: { tipo: "monto", cop: 900000 },
  unidad: "per_person",
  modoReserva: "date",
  duracionDias: 5,
  descuentoGrupo: { umbralPersonas: 6, porcentaje: 10 },
  programa: [
    { dia: 1, lineas: ["Llegada y presentación", "Nudos y equipo de seguridad"] },
    { dia: 2, lineas: ["Técnica de pies en bloque", "Primera vía en top-rope"] },
    { dia: 3, lineas: ["Rapel", "Tarde libre en el embalse"] },
    { dia: 4, lineas: ["Vía de varios largos (mañana)", "Asado de despedida"] },
    { dia: 5, lineas: ["Balance y certificado", "Salida"] },
  ],
  disponibilidad: [7, 14, 21, 28, 35, 42, 49].map((d, i) => ({
    date: dia(d),
    capacity: 8,
    booked: i === 1 ? 8 : i,
  })),
  primeraSalidaIso: dia(7),
  establecimiento: { ...ESTABLECIMIENTO_KAYAM, slug: null, nombre: "Guatapé Climbing", fotos: [] },
};

/** Une nuit par jour sur deux mois : le calendrier d'hébergement ouvre sur le mois courant. */
function noches(capacidad: number) {
  return Array.from({ length: 62 }, (_, i) => ({
    date: dia(i),
    capacity: capacidad,
    booked: i % 9 === 4 ? capacidad : i % 4,
  }));
}

/** Hébergement HORS PMS : paliers de prix, tarifs du week-end, équipements. */
export const ALOJAMIENTO_GLAMPING: FichaProducto = {
  ...BASE,
  id: "prod-glamping",
  slug: "glamping-con-vista",
  tipo: "lodging",
  nombre: "Glamping con vista a la Piedra",
  descripcion:
    "Tienda safari sobre plataforma de madera, cama doble, baño privado y terraza con hamaca frente a " +
    "la Piedra del Peñol. Desayuno incluido.",
  fotos: [
    { url: "/mock/rooms/kayam-glamping/photos/1.webp" },
    { url: "/mock/rooms/kayam-glamping/photos/2.webp" },
    { url: "/mock/rooms/kayam-glamping/photos/3.webp" },
    { url: "/mock/rooms/kayam-glamping/photos/4.webp" },
  ],
  precio: { tipo: "monto", cop: 180000 },
  unidad: "per_two",
  modoReserva: "lodging",
  alojamiento: {
    lodgingKind: "private",
    capacity: 2,
    unitCount: 3,
    priceTiers: null,
    maxQty: 3,
    esPmsBacked: false,
    amenidades: [
      { categoria: "Baño", items: ["Baño privado", "Agua caliente", "Toallas"] },
      { categoria: "Exterior", items: ["Terraza", "Hamaca", "Vista a la Piedra del Peñol"] },
      { categoria: "Servicios", items: ["Desayuno incluido", "Wifi"] },
    ],
  },
  disponibilidad: noches(3),
  tarifas: Array.from({ length: 62 }, (_, i) => i)
    .filter((i) => i % 7 === 5 || i % 7 === 6)
    .map((i) => ({ date: dia(i), price_cop: 220000 })),
  establecimiento: ESTABLECIMIENTO_KAYAM,
};

/** Lit en dortoir SOUS PMS (LobbyPMS) : miroir semé sur deux mois, séjour minimum le week-end. */
export const ALOJAMIENTO_DORM_PMS: FichaProducto = {
  ...BASE,
  id: "prod-dorm",
  slug: "cama-en-dormitorio",
  tipo: "lodging",
  nombre: "Cama en dormitorio compartido",
  descripcion: "Litera con cortina, enchufe y lámpara propios, en un dormitorio de 6 camas con baño compartido.",
  fotos: [
    { url: "/mock/rooms/kayam-vidpovo/photos/1.webp" },
    { url: "/mock/rooms/kayam-vidpovo/photos/2.webp" },
  ],
  precio: { tipo: "monto", cop: 55000 },
  unidad: "per_person",
  modoReserva: "lodging",
  alojamiento: {
    lodgingKind: "dorm",
    capacity: 1,
    unitCount: 6,
    priceTiers: [
      { min_qty: 1, max_qty: 2, price_cop: 55000 },
      { min_qty: 3, max_qty: 6, price_cop: 48000 },
    ],
    maxQty: 6,
    esPmsBacked: true,
    amenidades: [{ categoria: "Dormitorio", items: ["Cortina de privacidad", "Locker", "Enchufe propio"] }],
  },
  disponibilidad: noches(6).map((noche) => ({ ...noche, booked: 0, capacity: noche.capacity - noche.booked })),
  restriccionesPms: Array.from({ length: 62 }, (_, i) => i)
    .filter((i) => i % 7 === 5)
    .map((i) => ({ date: dia(i), restrictions: { minStay: 2, maxStay: null, leadDays: null } })),
  establecimiento: ESTABLECIMIENTO_KAYAM,
};

/** Même dortoir, mais sans miroir : chaque mois part chez LobbyPMS (`/api/pms/night-availability`). */
export const ALOJAMIENTO_DORM_SIN_ESPEJO: FichaProducto = {
  ...ALOJAMIENTO_DORM_PMS,
  id: "prod-dorm-sin-espejo",
  slug: "cama-en-dormitorio-sin-espejo",
  disponibilidad: [],
  restriccionesPms: [],
};

/** Transport : toujours en VITRINE (lien externe), horaires, trajet, lien Maps. */
export const TRANSPORTE_LANCHA: FichaProducto = {
  ...BASE,
  id: "prod-lancha",
  slug: "lancha-al-penol",
  tipo: "transport",
  nombre: "Lancha Guatapé – El Peñol",
  descripcion: "Traslado en lancha por el embalse entre el malecón de Guatapé y el muelle de El Peñol.",
  fotos: [{ url: "/mock/activities/partyboat1/photos/2.jpeg" }],
  precio: { tipo: "monto", cop: 15000 },
  unidad: "per_person",
  modoReserva: "vitrina",
  urlExterna: "https://wa.me/573001234567",
  transporte: {
    primeraSalida: "08:00",
    ultimaSalida: "17:30",
    plazasPorSalida: 12,
    salida: { direccion: "Malecón de Guatapé", lat: 6.2335, lon: -75.1588 },
    llegada: { direccion: "Muelle de El Peñol", lat: 6.2208, lon: -75.1775 },
  },
};

/** Événement en vitrine, récurrent chaque semaine, prix libre. */
export const EVENTO_JAM: FichaProducto = {
  ...BASE,
  id: "prod-jam",
  slug: "kayams-jam",
  tipo: "evento",
  nombre: "Kayam's Jam — noche de música",
  descripcion: "Jam abierta cada viernes: trae tu instrumento o solo tus ganas de escuchar. Fogata y cocina hasta las 11.",
  fotos: [{ url: "/mock/events/kayams-jam/photos/1.webp" }],
  precio: { tipo: "texto", label: "Entrada libre" },
  modoReserva: "evento",
  urlExterna: "https://instagram.com/casakayam",
  ocurrencia: { tipo: "recurring", fecha: dia(2), frecuenciaDias: 7, finFecha: null, finConteo: null, hora: "20:00" },
  establecimiento: ESTABLECIMIENTO_KAYAM,
};

/** Même événement SANS lien : le bloc de réservation est vide (cul-de-sac connu). */
export const EVENTO_SIN_ENLACE: FichaProducto = {
  ...EVENTO_JAM,
  id: "prod-jam-sin-enlace",
  slug: "kayams-jam-sin-enlace",
  urlExterna: null,
};

/** Événement réservable en ligne, places comptées, une date complète, paiement en ligne. */
export const EVENTO_FESTIVAL: FichaProducto = {
  ...BASE,
  id: "prod-festival",
  slug: "festival-de-la-bandeja",
  tipo: "evento",
  nombre: "Festival de la Bandeja Paisa",
  descripcion: "Tres noches de cocina antioqueña, música en vivo y concurso de bandejas en el parque principal.",
  fotos: [{ url: "/mock/events/festival-guatabandeja/photos/1.webp" }],
  precio: { tipo: "monto", cop: 35000 },
  unidad: "per_person",
  modoReserva: "evento_bookable",
  ocurrencia: { tipo: "once", fecha: dia(9), frecuenciaDias: null, finFecha: null, finConteo: null, hora: "18:00" },
  eventoReservable: {
    capacityMode: "metered",
    isFree: false,
    paymentMode: "online",
    occurrences: [
      { date: dia(9), capacity: 120, booked: 87, registeredQty: null },
      { date: dia(10), capacity: 120, booked: 120, registeredQty: null },
      { date: dia(11), capacity: 120, booked: 15, registeredQty: null },
    ],
    maxQty: 8,
  },
};

/** Événement GRATUIT sur inscription (RSVP), « X/Y inscritos », jamais bloquant. */
export const EVENTO_MARATON: FichaProducto = {
  ...BASE,
  id: "prod-maraton",
  slug: "media-maraton-de-guatape",
  tipo: "evento",
  nombre: "Media maratón entre zócalos y colores",
  descripcion: "21 km por las calles y veredas de Guatapé. Inscripción gratuita, cupo indicativo.",
  fotos: [{ url: "/mock/events/media-maraton-guatape/photos/1.webp" }],
  precio: null,
  modoReserva: "evento_bookable",
  ocurrencia: { tipo: "once", fecha: dia(26), frecuenciaDias: null, finFecha: null, finConteo: null, hora: "06:00" },
  eventoReservable: {
    capacityMode: "rsvp",
    isFree: true,
    paymentMode: null,
    occurrences: [{ date: dia(26), capacity: 300, booked: null, registeredQty: 212 }],
    maxQty: 4,
  },
};

/** Activité « Consultar » : prix libre, SANS photo, description longue, sans établissement. */
export const ACTIVIDAD_CONSULTAR: FichaProducto = {
  ...BASE,
  id: "prod-estudio",
  slug: "hora-de-estudio-de-grabacion",
  tipo: "activity",
  nombre: "Hora de estudio de grabación con productor y mezcla incluida para bandas y solistas",
  descripcion:
    "Graba tu maqueta o tu próximo sencillo en un estudio tratado acústicamente, con microfonía de " +
    "condensador, consola analógica y un productor que te acompaña desde la preproducción hasta la " +
    "mezcla. Ideal para bandas de hasta cinco músicos y solistas que quieren salir con un tema listo " +
    "para publicar. El precio depende de la duración y del número de pistas: escríbenos y armamos la " +
    "sesión contigo.",
  fotos: [],
  precio: { tipo: "texto", label: "Consultar" },
  modoReserva: "vitrina",
  urlExterna: "https://wa.me/573009876543",
};

/** Toutes les fiches connues des lectures simulées (`support/datos.ts`), cherchées par slug. */
export const FICHAS: FichaProducto[] = [
  ACTIVIDAD_KAYAK,
  ACTIVIDAD_CAMINATA,
  CAMP_ESCALADA,
  ALOJAMIENTO_GLAMPING,
  ALOJAMIENTO_DORM_PMS,
  ALOJAMIENTO_DORM_SIN_ESPEJO,
  TRANSPORTE_LANCHA,
  EVENTO_JAM,
  EVENTO_SIN_ENLACE,
  EVENTO_FESTIVAL,
  EVENTO_MARATON,
  ACTIVIDAD_CONSULTAR,
];
