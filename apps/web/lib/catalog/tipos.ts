// Les types partagés de la couche d'accès au catalogue (spec 27 §0, spec 28 §0).
//
// Ce fichier ne dépend de RIEN : ni de Supabase, ni de next-intl, ni de React. C'est ce qui permet
// de le lire depuis un Server Component comme depuis un composant client sans traîner un graphe de
// modules derrière — et notamment sans faire entrer le barrel `@hifago/ui` dans le graphe d'un
// `page.tsx` (CLAUDE.md §11.16).

/** Les cinq types d'offre, dans l'ORDRE d'affichage par défaut de l'accueil (cahier §2a). */
export const ORDEN_SECCIONES = ["activity", "lodging", "transport", "camp", "evento"] as const;

export type TipoOferta = (typeof ORDEN_SECCIONES)[number];

export function esTipoOferta(valor: string): valor is TipoOferta {
  return (ORDEN_SECCIONES as readonly string[]).includes(valor);
}

/**
 * Les critères de recherche, tels qu'ils vivent dans l'URL des pages à résultats.
 *
 * Un champ absent = pas de filtre. Jamais de valeur sentinelle ("todos", -1, "") : l'absence est
 * la seule façon de dire « pas de filtre », sinon deux URL différentes décrivent la même recherche
 * et le canonical ne les rassemble plus.
 */
export type Criterios = {
  q?: string;
  tipo?: TipoOferta;
  tag?: string;
  personas?: number;
  /** ISO `YYYY-MM-DD`. Toujours posés ensemble : une seule date saisie devient desde = hasta. */
  desde?: string;
  hasta?: string;
};

export type FotoTarjeta = {
  /** URL publique déjà résolue depuis le `storage_path` — un composant ne parle jamais à Storage. */
  url: string;
};

/**
 * Le prix d'une carte. Quatre formes, parce que le catalogue en porte réellement quatre :
 *  - `monto`  : un prix chiffré (`products.price_cop`) ;
 *  - `desde`  : le minimum des couchages d'un établissement groupé ;
 *  - `texto`  : `products.price_label`, le prix libre d'une offre en vitrine (spec 27 §6) ;
 *  - `null`   : ni l'un ni l'autre — la carte n'affiche AUCUN prix, jamais « desde 0 ».
 */
export type PrecioTarjeta =
  | { tipo: "monto"; cop: number }
  | { tipo: "desde"; cop: number }
  | { tipo: "texto"; label: string }
  | null;

/**
 * Le prix d'une offre, en DONNÉES — le formatage monétaire appartient à l'affichage.
 *
 * ⚠️ L'ordre dit la règle, et il compte : un libellé libre d'abord, un montant ensuite, sinon
 * RIEN. Jamais un zéro, qui prétendrait la gratuité — le défaut mesuré en réel le 2026-09-08,
 * quand la migration `products_price_cop_required_unless_vitrine` a rendu ce cas atteignable.
 *
 * ⚠️ ELLE VIT ICI, dans le module SANS dépendance, parce que les TROIS écrans qui affichent un
 * prix de carte doivent trancher pareil : la fiche produit (`producto.ts`), les cartes de chambre
 * d'une fiche établissement (`establecimiento.ts`) et toute carte du catalogue (`buscar.ts`).
 * Le 2026-09-08 elle était écrite trois fois — et les trois copies avaient DÉJÀ divergé :
 * `buscar.ts` testait le montant AVANT le libellé, donc un produit portant les deux s'affichait
 * « 120.000 COP » sur l'accueil et « Consultar » sur sa propre fiche. Latent tant qu'aucune ligne
 * ne porte les deux (le seed n'en a pas), certain à la première saisie — et invisible : aucun des
 * tests des trois modules n'exerçait ce cas, chacun ne vérifiant que sa propre copie.
 *
 * La contrainte `products_price_cop_required_unless_vitrine` n'interdit PAS de porter les deux :
 * elle exige un `price_cop` sauf vitrine/evento, jamais l'absence de `price_label`.
 */
export function resolverPrecio(priceLabel: string | null, priceCop: number | null): PrecioTarjeta {
  if (priceLabel) return { tipo: "texto", label: priceLabel };
  if (priceCop !== null) return { tipo: "monto", cop: priceCop };
  return null;
}

export type TarjetaOferta = {
  clave: string;
  href: string;
  nombre: string;
  establecimiento: string | null;
  precio: PrecioTarjeta;
  fotos: FotoTarjeta[];
  tipo: TipoOferta;
  /**
   * Combien de couchages une carte GROUPÉE représente — `null` sur toute autre carte.
   *
   * `null` et jamais 0 : « 0 alojamientos » se lirait « cet établissement n'en a aucun », alors
   * que la carte est justement celle d'une offre isolée. Restauré par la spec 30 §3.6 — le front
   * d'août l'affichait, la refonte l'avait perdu.
   */
  nAlojamientos: number | null;
  /**
   * Combien de personnes une unité accueille. `null` partout sauf sur les cartes de chambre d'une
   * fiche établissement : c'est le seul écran où le cahier la demande (« photo · nom · capacité ·
   * prix », entretien du 2026-09-07). `search_catalog` ne la rend pas — l'accueil et les listings
   * la laissent donc à `null`, et la carte ne l'affiche pas.
   */
  capacidad: number | null;
  testId: string;
};

export type Seccion = {
  tipo: TipoOferta;
  tarjetas: TarjetaOferta[];
  /** Nombre d'offres du type AVANT plafonnement — c'est lui qui donne son chiffre au « Ver más ». */
  total: number;
};

/** Une suggestion de la barre de recherche, en DONNÉES : aucun libellé traduit ici. */
export type SugerenciaCatalogo = {
  /** Stable et unique dans la liste — reprend la `clave` d'une carte. */
  id: string;
  /** Déjà résolu dans la locale demandée. */
  nombre: string;
  tipo: TipoOferta;
  esEstablecimiento: boolean;
  /** Nom de l'établissement porteur, `null` pour une carte d'établissement. */
  establecimiento: string | null;
  /** Chemin SANS préfixe de langue : `/productos/<slug>` ou `/establecimientos/<slug>`. */
  href: string;
};

/**
 * Une CATÉGORIE d'un type d'offre, avec un aperçu de ses items (spec 29, généralisée 2026-09-14 —
 * `/es/actividades`, `/es/alojamientos`, etc. affichent maintenant chacune une section par
 * catégorie, sur le même patron que les sections de l'accueil).
 *
 * ⚠️ Le mot « catégorie » et non « tag » est délibéré : depuis la décision de Jérôme du 2026-09-08,
 * une ligne de `catalog_tags` porte une image, un nom et un texte — c'est une entité éditoriale que
 * le visiteur voit, plus une étiquette technique.
 *
 * Comme `TarjetaOferta`, tout est DÉJÀ RÉSOLU ici : le nom et le texte dans la locale demandée,
 * l'URL de l'image depuis son `storage_path`. Un composant ne parle jamais à Storage et ne résout
 * jamais un champ JSONB.
 */
export type CategoriaConTarjetas = {
  /** `kayak` — ou `otras` pour la catégorie qui rattrape ce qu'aucun tag ne classe. */
  slug: string;
  /** Chemin SANS préfixe de langue : `/actividades/kayak`. */
  href: string;
  /**
   * ⚠️ VIDE quand `esSinTag` est vrai. « Otras actividades »/« Otros alojamientos » n'est pas une
   * ligne de la base : son nom et son texte viennent des messages next-intl, donc de la page.
   * Cette couche ne traduit rien — même règle que le texte alternatif des photos et que les
   * libellés de suggestion.
   */
  nombre: string;
  /** Déjà résolu, `null` si la catégorie n'a pas encore été rédigée. */
  descripcion: string | null;
  /** URL publique déjà résolue, `null` → aucune photo (le pattern de section n'en affiche pas). */
  foto: FotoTarjeta | null;
  /** Vrai pour LA seule catégorie de rattrapage, toujours rendue en dernier. */
  esSinTag: boolean;
  /**
   * Les locales où le NOM est réellement saisi — pas obtenu par repli.
   *
   * ⚠️ C'est une donnée d'INDEXATION, pas d'affichage : une page de catégorie servie en repli
   * (nom espagnol sous une URL `/en/`) doit rester `noindex` avec un canonical vers la langue
   * source (règle SEO 2). Elle est calculée dans la couche parce que c'est elle qui tient le champ
   * JSONB brut — le résoudre puis tenter de deviner s'il vient d'un repli serait impossible.
   */
  localesNativas: string[];
  /** Plafonnées à `porCategoria` — c'est la base qui plafonne, jamais un `.slice()` ici. */
  tarjetas: TarjetaOferta[];
  /** Nombre d'offres de la catégorie AVANT plafonnement — alimente `mostrarVerMas`. */
  total: number;
  testId: string;
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// LES FICHES (spec 30) — ce qu'une page de détail reçoit, et rien d'autre.
//
// Même frontière que le reste de cette couche : des DONNÉES déjà résolues (JSONB dans la locale,
// URL publiques du Storage), jamais un libellé d'interface. Le `alt` des photos, le nom du bouton
// de contact et les titres de section viennent de la page, via next-intl.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Ce que le calendrier d'un produit à date unique reçoit. */
export type FilaDisponibilidad = { date: string; capacity: number; booked: number };

/** Override de prix pour une nuit donnée (hébergement). */
export type FilaTarifa = { date: string; price_cop: number };

/** Un créneau horaire, tel que `get_product_slots` le rend. */
export type FilaFranja = {
  slot_date: string;
  slot_start_time: string;
  capacity: number;
  booked: number;
  slot_duration_minutes: number;
};

/** Ce qui décide du bloc affiché sous le prix. Voir `FichaProducto.modoReserva`. */
export type ModoReserva = "evento" | "evento_bookable" | "vitrina" | "lodging" | "slot" | "date";

/** Les données d'occurrence d'un evento — le LIBELLÉ est composé par la page (il se traduit). */
export type DatosOcurrencia = {
  tipo: "once" | "recurring" | null;
  fecha: string | null;
  frecuenciaDias: number | null;
  finFecha: string | null;
  finConteo: number | null;
  /** `products.start_time` — l'heure de l'occurrence, requise par le JSON-LD `Event`. */
  hora: string | null;
};

/**
 * Ce que seul un evento réservable en ligne porte (`products.online_bookable = true`) — `null` sur
 * tout autre evento (vitrine) et sur tout autre type. Voir `ModoReserva`.
 *
 * `capacityMode`/`isFree`/`paymentMode` pilotent l'UI de `EventoReservationForm` (badge gratuit,
 * note « à régler sur place », compteur RSVP) ; ils ne sont jamais une barrière — `create_order`
 * seul décide (`CLAUDE.md` §4).
 */
export type DatosEventoReservable = {
  capacityMode: "unlimited" | "metered" | "rsvp";
  isFree: boolean;
  paymentMode: "online" | "on_site" | null;
  /**
   * Une entrée par occurrence dans l'horizon réservable. `capacity`/`booked` non null seulement en
   * mode 'metered' (`get_event_occurrence_availability`) ; `registeredQty` non null seulement en
   * mode 'rsvp' (`get_evento_rsvp_counts`, compteur affiché — décision actée, jamais silencieux).
   */
  occurrences: {
    date: string;
    capacity: number | null;
    booked: number | null;
    registeredQty: number | null;
  }[];
  /**
   * `products.max_qty`, replié à 20 — MÊME repli que `DatosAlojamiento.maxQty` et que le
   * `coalesce(max_qty, 20)` de `create_order`. Porté ici plutôt qu'inventé côté formulaire : une
   * constante locale (99 dans la première version) prétendait un plafond que la base ne connaît
   * pas, et contredisait le 20 appliqué partout ailleurs sans le dire.
   */
  maxQty: number;
};

/**
 * Un groupe d'équipements déjà résolus dans la locale demandée — jamais le JSONB brut côté
 * composant (`resolveLocalizedField`/`asLocalizedField` vivent dans la couche de données,
 * `.claude/rules/apps.md`). `categoria` est le libellé de `catalog_amenity_categories.label`,
 * `items` ceux de `catalog_amenities.label` qui lui sont rattachés, déjà triés par `sort_order`.
 */
export type AmenidadPorCategoria = {
  categoria: string;
  items: string[];
};

/** Ce que seul un hébergement porte. `null` sur tout autre type. */
export type DatosAlojamiento = {
  lodgingKind: string | null;
  capacity: number | null;
  unitCount: number | null;
  priceTiers: unknown;
  maxQty: number;
  /** `type = 'lodging'` ET une catégorie Lobby : la disponibilité vient alors du PMS, pas de la base. */
  esPmsBacked: boolean;
  /**
   * Faux pour un logement PMS dont l'établissement a son connecteur coupé ou pas de jeton —
   * exactement la condition qui fait refuser la ligne par `create_order` (`pms_unavailable`,
   * migration 20260929112240). La fiche n'offre alors aucun calendrier : elle renvoie vers
   * l'établissement. Toujours vrai pour un logement qui n'est pas adossé au PMS.
   */
  reservableEnLinea: boolean;
  /**
   * `product_amenity_assignments` (migration 20260917110000) — toujours `[]`, jamais `null` : pas
   * de garde supplémentaire côté composant. Référentiel fermé, peuplé par migration (décision
   * Jérôme du 2026-09-17), jamais de texte libre partenaire.
   */
  amenidades: AmenidadPorCategoria[];
};

/** Une extrémité d'un trajet de transport. Les trois champs sont indépendamment nuls : l'admin
 *  peut taper une adresse à la main sans passer par la suggestion Google (donc sans coordonnées). */
export type LugarTransporte = {
  direccion: string | null;
  lat: number | null;
  lon: number | null;
};

/**
 * `products.transport_*` (migration 20260916150000) — non nul seulement pour `transport`
 * (contrainte CHECK `products_transport_info_transport_only`).
 *
 * ⚠️ PUREMENT INFORMATIF, et c'est tout le point de ce lot (demande Jérôme du 2026-09-16 : « c'est
 * à titre informatif pour la personne qui réserve »). La fenêtre de départs n'est PAS un créneau
 * réservable — `modoReserva` d'un transport reste `date` (ou `vitrina`), jamais `slot`, et
 * `plazasPorSalida` n'est pas un cupo : celui qui bloque vraiment vit dans `disponibilidad`.
 *
 * Les heures sont des chaînes `"HH:MM"` OPAQUES, déjà découpées par la couche de données. Ne
 * jamais les recombiner avec une date en objet `Date` : il serait interprété dans le fuseau du
 * navigateur VISITEUR, pas celui de Bogota (spec 18 §0).
 */
export type DatosTransporte = {
  primeraSalida: string | null;
  ultimaSalida: string | null;
  plazasPorSalida: number | null;
  salida: LugarTransporte;
  llegada: LugarTransporte;
};

/** L'établissement, vu depuis une fiche produit. */
export type ResumenEstablecimiento = {
  id: string;
  slug: string | null;
  nombre: string;
  descripcion: string | null;
  direccion: string | null;
  fotos: FotoTarjeta[];
};

export type FichaProducto = {
  id: string;
  slug: string;
  tipo: TipoOferta;
  nombre: string;
  descripcion: string | null;
  fotos: FotoTarjeta[];
  precio: PrecioTarjeta;
  /**
   * L'unité de PRIX (`per_person` | `per_two` | `per_house`) — à ne pas confondre avec
   * `alojamiento.lodgingKind`, qui est une nature de couchage. Elle suffixe le prix affiché.
   */
  unidad: string | null;
  /**
   * `products.min_qty`, replié à 1. N'a de sens QUE hors lodging : `create_order` ne le vérifie
   * (`qty_below_minimum`) que dans sa branche non-lodging — `LodgingReservationForm` l'ignore et
   * garde son propre plancher fixé à 1 (spec 30 §7a, `lib/reservas/cantidad.ts`).
   */
  minQty: number;
  /**
   * `products.max_qty`, replié à 20 — le plafond par ligne que `create_order` applique à TOUT type
   * (`coalesce(max_qty, 20)`, migration 20260929112240). Même valeur que `eventoReservable.maxQty`
   * et `alojamiento.maxQty`, calculée une seule fois par la couche catalogue.
   */
  maxQty: number;
  modoReserva: ModoReserva;
  /** Non nul ⟺ `modoReserva === "vitrina"` — sauf pour un evento, qui l'est par son type. */
  urlExterna: string | null;
  /** Renseigné pour un evento, quel que soit son `modoReserva` : la date est une propriété du TYPE. */
  ocurrencia: DatosOcurrencia | null;
  /** Non nul ⟺ `modoReserva === "evento_bookable"`. */
  eventoReservable: DatosEventoReservable | null;
  alojamiento: DatosAlojamiento | null;
  /** Non nul seulement pour `transport` — cf. `DatosTransporte`, informatif de bout en bout. */
  transporte: DatosTransporte | null;
  /**
   * `products.duration_days` — non nul seulement pour `camp` (contrainte CHECK). Une ligne de
   * `disponibilidad` porte la date de DÉPART seule ; c'est ce champ qui dit sur combien de jours le
   * calendrier de réservation doit surligner la semaine complète autour d'un départ sélectionné.
   */
  duracionDias: number | null;
  /**
   * `products.group_discount_threshold_qty`/`group_discount_pct` (migration 20260914130000) — non
   * nul seulement pour `camp`, tous deux ensemble ou aucun (contrainte CHECK). Texte informatif
   * statique seulement (décision Jérôme) : jamais un compteur de remplissage en temps réel, ni un
   * prix recalculé côté client — `create_order` reste la seule source du prix engageant.
   */
  descuentoGrupo: { umbralPersonas: number; porcentaje: number } | null;
  /**
   * `products.program` (spec 37) — non nul seulement pour `camp` (contrainte CHECK), DÉJÀ résolu
   * dans la locale demandée et regroupé par journée : la couche de données résout le JSONB, jamais
   * le composant (`.claude/rules/apps.md`). Le jour est RELATIF au départ (día 1 = jour du départ),
   * donc le même programme vaut pour toutes les éditions du camp ; la date réelle se calcule à
   * l'affichage depuis la salida choisie.
   */
  programa: { dia: number; lineas: string[] }[] | null;
  /**
   * Première salida encore ouverte (>= aujourd'hui à Guatapé), ou `null`. Dérivée ici, côté
   * serveur, précisément pour que le programme s'affiche AVEC de vraies dates dans le HTML initial
   * — donc pour un crawler comme pour un visiteur qui n'a encore rien cliqué. La calculer côté
   * composant supposerait un `new Date()` client, interdit par `scripts/check-timezone.sh`.
   */
  primeraSalidaIso: string | null;
  disponibilidad: FilaDisponibilidad[];
  /**
   * Restrictions LobbyPMS des nuits semées, pour un logement PMS-backed uniquement — vide partout
   * ailleurs. Ne porte QUE les nuits réellement sous contrainte : l'absence d'une nuit EST
   * l'information « rien à appliquer ici », ce qui évite trente objets nuls par mois.
   *
   * ⚠️ La forme est REDÉCLARÉE ici plutôt qu'importée de `@hifago/domain` (`LobbyNightRestrictions`,
   * structurellement identique), parce que ce fichier ne dépend de RIEN — c'est ce qui lui permet
   * d'être lu depuis un Server Component sans traîner de graphe de modules (en-tête de ce fichier).
   * Une divergence casserait la compilation au premier point de passage, dans `producto.ts`.
   */
  restriccionesPms: {
    date: string;
    restrictions: { minStay: number | null; maxStay: number | null; leadDays: number | null };
  }[];
  tarifas: FilaTarifa[];
  franjas: FilaFranja[];
  establecimiento: ResumenEstablecimiento | null;
  /**
   * Les locales où la fiche a un contenu RÉELLEMENT saisi. Calculé ici parce que cette couche est
   * la seule à tenir le JSONB brut, et que `noindex`/canonical en dépendent — même raison et même
   * prédicat que `CategoriaConOferta.localesNativas` (spec 29).
   */
  localesNativas: string[];
};

export type FichaEstablecimiento = {
  id: string;
  slug: string;
  nombre: string;
  descripcion: string | null;
  direccion: string | null;
  lat: number | null;
  lon: number | null;
  /** Les horaires DU LIEU — `products.check_in_time` n'est plus lu par aucune page (spec 30 §3.4). */
  horaEntrada: string | null;
  horaSalida: string | null;
  modo: "rooms" | "whole_house" | null;
  /** `establishments.contact_phone`, E.164. `null` → aucun bouton de contact. */
  contacto: string | null;
  fotos: FotoTarjeta[];
  alojamientos: TarjetaOferta[];
  otrosProductos: TarjetaOferta[];
  /** `establishment_amenity_assignments` (migration 20260917110000) — même contrat que
   *  `DatosAlojamiento.amenidades` : toujours `[]`, jamais `null`. */
  amenidades: AmenidadPorCategoria[];
  localesNativas: string[];
};
