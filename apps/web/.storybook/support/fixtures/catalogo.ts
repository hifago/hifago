import type {
  CategoriaConTarjetas,
  FichaEstablecimiento,
  FichaProducto,
  TarjetaOferta,
  TipoOferta,
} from "@/lib/catalog/tipos";
import { segmentoDeTipo } from "@/lib/catalog/segmentos";
import {
  ACTIVIDAD_CAMINATA,
  ACTIVIDAD_CONSULTAR,
  ACTIVIDAD_KAYAK,
  ALOJAMIENTO_DORM_PMS,
  ALOJAMIENTO_GLAMPING,
  CAMP_ESCALADA,
  ESTABLECIMIENTO_KAYAM,
  EVENTO_FESTIVAL,
  EVENTO_JAM,
  EVENTO_MARATON,
  TRANSPORTE_LANCHA,
} from "./productos";

// Le catalogue de la vitrine dans les stories d'écran (2026-10-01) : les cartes de l'accueil, des
// index par type et des pages de catégorie, et les fiches établissement. Les cartes qui ont une
// fiche produit en sont DÉRIVÉES (mêmes nom, prix, photos) ; les autres complètent les carrousels
// pour qu'ils débordent comme en vrai. Formes : celles que produit `lib/catalog/buscar.ts`.

export function tarjetaDeFicha(ficha: FichaProducto, sobre: Partial<TarjetaOferta> = {}): TarjetaOferta {
  return {
    clave: `producto-${ficha.id}`,
    href: `/productos/${ficha.slug}`,
    nombre: ficha.nombre,
    establecimiento: ficha.establecimiento?.nombre ?? null,
    precio: ficha.precio,
    fotos: ficha.fotos,
    tipo: ficha.tipo,
    nAlojamientos: null,
    capacidad: null,
    testId: `tarjeta-${ficha.slug}`,
    ...sobre,
  };
}

function tarjeta(
  slug: string,
  tipo: TipoOferta,
  nombre: string,
  precio: TarjetaOferta["precio"],
  fotos: string[],
  establecimiento: string | null = null
): TarjetaOferta {
  return {
    clave: `producto-${slug}`,
    href: `/productos/${slug}`,
    nombre,
    establecimiento,
    precio,
    fotos: fotos.map((url) => ({ url })),
    tipo,
    nAlojamientos: null,
    capacidad: null,
    testId: `tarjeta-${slug}`,
  };
}

const monto = (cop: number) => ({ tipo: "monto" as const, cop });

const ACTIVIDADES = {
  kayak: tarjetaDeFicha(ACTIVIDAD_KAYAK),
  caminata: tarjetaDeFicha(ACTIVIDAD_CAMINATA),
  estudio: tarjetaDeFicha(ACTIVIDAD_CONSULTAR),
  yoga: tarjeta("yoga-al-amanecer", "activity", "Yoga al amanecer", monto(35000), ["/mock/activities/yoga-session/photos/1.webp"], "Casa Kayam"),
  jetski: tarjeta("paseo-en-jetski", "activity", "Paseo en jetski", monto(180000), ["/mock/activities/jetski1/photos/2.jpeg", "/mock/activities/jetski2/photos/1.jpeg"], "Guatapé Náutica"),
  partyboat: tarjeta("partyboat", "activity", "Partyboat por el embalse", monto(100000), ["/mock/activities/partyboat1/photos/1.jpg"], "Guatapé Náutica"),
  guitarra: tarjeta("clase-de-guitarra", "activity", "Clase de guitarra", monto(60000), ["/mock/activities/clase-de-guitarra/photos/1.webp", "/mock/activities/clase-de-guitarra/photos/2.webp"], "Casa Kayam"),
  espanol: tarjeta("clase-de-espanol", "activity", "Clase de español (60 min)", monto(50000), ["/mock/activities/espanol-60min/photos/1.webp"], "Casa Kayam"),
  escalada: tarjeta("escalada-en-la-piedra", "activity", "Escalada en la Piedra del Peñol", monto(150000), ["/mock/activities/climbing1/photos/2.jpeg"], "Guatapé Climbing"),
};

/** Carte GROUPÉE d'un établissement à plusieurs hébergements (« Desde », « N alojamientos »). */
const KAYAM_AGRUPADO: TarjetaOferta = {
  clave: "establecimiento-est-kayam",
  href: "/establecimientos/casa-kayam",
  nombre: "Casa Kayam",
  establecimiento: null,
  precio: { tipo: "desde", cop: 55000 },
  fotos: [{ url: "/mock/establishments/kayam/photos/1.jpeg" }, { url: "/mock/rooms/kayam-glamping/photos/2.webp" }],
  tipo: "lodging",
  nAlojamientos: 3,
  capacidad: null,
  testId: "tarjeta-casa-kayam",
};

const ALOJAMIENTOS = {
  kayam: KAYAM_AGRUPADO,
  bania: tarjeta("casa-bania-completa", "lodging", "Casa Bania — casa entera frente al embalse", { tipo: "monto", cop: 850000 }, ["/mock/rooms/bania-casa-completa/photos/1.jpeg", "/mock/rooms/bania-casa-completa/photos/3.jpeg", "/mock/rooms/bania-casa-completa/photos/4.jpeg"], "Casa Bania"),
  doble: tarjeta("habitacion-doble-del-pueblo", "lodging", "Habitación doble en el pueblo", monto(140000), ["/mock/rooms/room1/photos/1.jpeg"], "Hotel Zócalo"),
  suite: tarjeta("suite-con-jacuzzi", "lodging", "Suite con jacuzzi", monto(320000), ["/mock/rooms/hiltonroom1/photos/1.jpeg"], "Hotel Zócalo"),
  dorm: tarjeta("dormitorio-del-centro", "lodging", "Cama en dormitorio, centro", monto(45000), ["/mock/rooms/dorm1/photos/1.jpeg"], "Hostal Centro"),
};

const TRANSPORTES = {
  lancha: tarjetaDeFicha(TRANSPORTE_LANCHA),
  chiva: tarjeta("chiva-al-penol", "transport", "Chiva Guatapé – El Peñol", monto(8000), []),
  tuktuk: tarjeta("tuk-tuk-al-mirador", "transport", "Tuk-tuk al mirador", { tipo: "texto", label: "Desde 25.000 COP" }, []),
};

const CAMPS = {
  escalada: tarjetaDeFicha(CAMP_ESCALADA),
  yoga: tarjeta("retiro-de-yoga", "camp", "Retiro de yoga — 4 días", monto(1200000), ["/mock/activities/movilidad-session/photos/2.webp"], "Casa Kayam"),
};

const EVENTOS = {
  jam: tarjetaDeFicha(EVENTO_JAM),
  festival: tarjetaDeFicha(EVENTO_FESTIVAL),
  maraton: tarjetaDeFicha(EVENTO_MARATON),
  zocalos: tarjeta("fiestas-zocalos-y-flores", "evento", "Fiestas de Zócalos y Flores", { tipo: "texto", label: "Entrada libre" }, ["/mock/events/fiestas-zocalos-flores/photos/1.webp"]),
};

/** Toutes les cartes de la vitrine, par type, dans l'ordre où le catalogue les rend. */
export const TARJETAS_POR_TIPO: Record<TipoOferta, TarjetaOferta[]> = {
  activity: Object.values(ACTIVIDADES),
  lodging: Object.values(ALOJAMIENTOS),
  transport: Object.values(TRANSPORTES),
  camp: Object.values(CAMPS),
  evento: Object.values(EVENTOS),
};

function categoria(
  tipo: TipoOferta,
  slug: string,
  nombre: string,
  descripcion: string | null,
  tarjetas: TarjetaOferta[]
): CategoriaConTarjetas {
  return {
    slug,
    href: `/${segmentoDeTipo(tipo)}/${slug}`,
    nombre,
    descripcion,
    foto: null,
    esSinTag: false,
    localesNativas: ["es"],
    tarjetas,
    total: tarjetas.length,
    testId: `categoria-${slug}`,
  };
}

/** La catégorie de rattrapage, exactement comme `buscar.ts` la construit (nom VIDE compris). */
function otras(tipo: TipoOferta, tarjetas: TarjetaOferta[]): CategoriaConTarjetas {
  return {
    slug: "otras",
    href: `/${segmentoDeTipo(tipo)}/otras`,
    nombre: "",
    descripcion: null,
    foto: null,
    esSinTag: true,
    localesNativas: ["es", "en"],
    tarjetas,
    total: tarjetas.length,
    testId: "categoria-otras",
  };
}

export const CATEGORIAS_POR_TIPO: Record<TipoOferta, CategoriaConTarjetas[]> = {
  activity: [
    categoria("activity", "agua", "Agua", "Kayak, jetski y paseos en lancha por el embalse.", [ACTIVIDADES.kayak, ACTIVIDADES.jetski, ACTIVIDADES.partyboat]),
    categoria("activity", "montana", "Montaña", "Senderos, escalada y miradores alrededor de la Piedra.", [ACTIVIDADES.caminata, ACTIVIDADES.escalada]),
    categoria("activity", "musica", "Música", null, [ACTIVIDADES.guitarra, ACTIVIDADES.estudio]),
    categoria("activity", "bienestar", "Bienestar", "Yoga, movilidad y descanso.", [ACTIVIDADES.yoga]),
    otras("activity", [ACTIVIDADES.espanol]),
  ],
  lodging: [
    categoria("lodging", "hostales", "Hostales", "Camas y habitaciones para viajeros.", [ALOJAMIENTOS.kayam, ALOJAMIENTOS.dorm]),
    categoria("lodging", "casas-enteras", "Casas enteras", "Para grupos y familias.", [ALOJAMIENTOS.bania]),
    categoria("lodging", "hoteles", "Hoteles", null, [ALOJAMIENTOS.doble, ALOJAMIENTOS.suite]),
  ],
  transport: [categoria("transport", "terrestre", "Terrestre", null, [TRANSPORTES.chiva, TRANSPORTES.tuktuk]), categoria("transport", "lanchas", "Lanchas", null, [TRANSPORTES.lancha])],
  camp: [categoria("camp", "deporte", "Deporte", "Camps para aprender en una semana.", Object.values(CAMPS))],
  evento: [
    categoria("evento", "musica", "Música", null, [EVENTOS.jam]),
    categoria("evento", "fiestas", "Fiestas", "Las fiestas del pueblo.", [EVENTOS.festival, EVENTOS.zocalos, EVENTOS.maraton]),
  ],
};

export const ESTABLECIMIENTO_KAYAM_FICHA: FichaEstablecimiento = {
  id: ESTABLECIMIENTO_KAYAM.id,
  slug: "casa-kayam",
  nombre: ESTABLECIMIENTO_KAYAM.nombre,
  descripcion: ESTABLECIMIENTO_KAYAM.descripcion,
  direccion: ESTABLECIMIENTO_KAYAM.direccion,
  lat: 6.24,
  lon: -75.16,
  horaEntrada: "15:00:00",
  horaSalida: "11:00:00",
  modo: "rooms",
  contacto: "+573001112244",
  fotos: [
    { url: "/mock/establishments/kayam/photos/1.jpeg" },
    { url: "/mock/rooms/kayam-glamping/photos/1.webp" },
    { url: "/mock/rooms/kayam-audo/photos/1.webp" },
  ],
  alojamientos: [
    tarjetaDeFicha(ALOJAMIENTO_GLAMPING, { establecimiento: null, capacidad: 2 }),
    tarjetaDeFicha(ALOJAMIENTO_DORM_PMS, { establecimiento: null, capacidad: 1 }),
    tarjeta("habitacion-gusto", "lodging", "Habitación Gusto", monto(150000), ["/mock/rooms/kayam-gusto/photos/1.webp"]),
  ],
  otrosProductos: [
    tarjetaDeFicha(ACTIVIDAD_CAMINATA, { establecimiento: null }),
    tarjetaDeFicha(EVENTO_JAM, { establecimiento: null }),
    { ...ACTIVIDADES.guitarra, establecimiento: null },
  ],
  amenidades: [
    { categoria: "General", items: ["Wifi", "Cocina compartida", "Parqueadero"] },
    { categoria: "Exterior", items: ["Fogata", "Hamacas", "Vista a la Piedra del Peñol"] },
  ],
  localesNativas: ["es"],
};

/** Casa entière, presque vide : ni photo, ni adresse, ni horaires, ni contact, ni équipements. */
export const ESTABLECIMIENTO_MINIMO: FichaEstablecimiento = {
  id: "est-bania",
  slug: "casa-bania",
  nombre: "Casa Bania",
  descripcion: null,
  direccion: null,
  lat: null,
  lon: null,
  horaEntrada: null,
  horaSalida: null,
  modo: "whole_house",
  contacto: null,
  fotos: [],
  alojamientos: [{ ...ALOJAMIENTOS.bania, establecimiento: null, capacidad: 10 }],
  otrosProductos: [],
  amenidades: [],
  localesNativas: ["es"],
};

/** Un établissement publié qui n'a encore rien à vendre (inatteignable en prod à cause de la RLS). */
export const ESTABLECIMIENTO_SIN_OFERTAS: FichaEstablecimiento = {
  ...ESTABLECIMIENTO_MINIMO,
  id: "est-vacio",
  slug: "hostal-en-construccion",
  nombre: "Hostal en construcción",
  alojamientos: [],
};

export const ESTABLECIMIENTOS: FichaEstablecimiento[] = [
  ESTABLECIMIENTO_KAYAM_FICHA,
  ESTABLECIMIENTO_MINIMO,
  ESTABLECIMIENTO_SIN_OFERTAS,
];
