import { TELEFONO_HIFAGO } from "@/lib/contacto/whatsapp";

// L'identité légale de l'entité qui exploite Hifago — LE SEUL endroit à remplir.
//
// ⚠️ Ley 1480 de 2011, art. 50 a) : un vendeur en ligne doit publier sa raison sociale, son NIT,
// son adresse de notification judiciaire, un téléphone et un e-mail. La Ley 2068 de 2020 y ajoute
// l'inscription au Registre national du tourisme (RNT).
//
// Source : le certificat RNT délivré par la Cámara de Comercio de Oriente Antioqueño le 2026-11-12
// (donné par Jérôme ce jour-là). Le municipio de l'adresse (absent du certificat) et l'e-mail
// public ont été précisés par Jérôme le même jour. Le titulaire est une PERSONA NATURAL, pas une
// société : il n'y a pas de « razón social », d'où le champ `titular` — les textes de
// `Legal.json` ne disent jamais « empresa ».
//
// ⚠️ Le RNT se RENOUVELLE chaque année avant le 31 mars (certificat : vencimiento 2027-03-31) —
// suivi au backlog. Le numéro ne change pas au renouvellement.
//
// Si une donnée redevient `null`, les cinq pages institutionnelles affichent « [por completar] » à
// sa place, repassent `noindex` et sortent du sitemap (`identidadCompleta`, lu par leurs
// métadonnées et par `app/sitemap.ts`) : une page légale à trous ne doit pas être indexée.
export const IDENTIDAD_LEGAL = {
  /** Titulaire, tel qu'inscrit au RNT (persona natural). */
  titular: "Jerome Christian Filippi",
  /** NIT avec son chiffre de vérification, tel qu'écrit sur le certificat RNT. */
  nit: "700146925-4",
  /** Numéro d'inscription au Registro Nacional de Turismo (« Registro No. » du certificat). */
  rnt: "306057",
  /** Adresse de notification judiciaire (certificat RNT), municipio et département. */
  domicilio: "Villa Adriana, sector Aeropuerto, vereda El Roble, Guatapé, Antioquia",
  /** E-mail public d'attention au client et aux demandes Habeas Data (PQR). */
  correo: "info@hifago.co",
} as const satisfies Record<string, string | null>;

/** Date d'entrée en vigueur des textes (cahier client, modèle de données §« pages légales »). */
export const VIGENCIA_TEXTOS_LEGALES = "2026-11-05";

/** Le WhatsApp de Hifago, lisible : `+57 321 576 4841`. Dérivé, jamais recopié. */
export const TELEFONO_LEGIBLE = TELEFONO_HIFAGO.replace(/^\+57(\d{3})(\d{3})(\d{4})$/, "+57 $1 $2 $3");

export type ClaveIdentidad = keyof typeof IDENTIDAD_LEGAL | "telefono";

/** Vrai quand toutes les données légales sont renseignées. */
export function identidadCompleta(
  identidad: Record<string, string | null> = IDENTIDAD_LEGAL
): boolean {
  return Object.values(identidad).every((valeur) => valeur !== null && valeur.trim() !== "");
}

/**
 * Remplace `{titular}`, `{nit}`, `{rnt}`, `{domicilio}`, `{correo}` et `{telefono}` dans un
 * texte de `messages/<locale>/Legal.json`. Une donnée manquante devient `pendiente` — visible, pour
 * que personne ne prenne la page pour finie. Un jeton inconnu est laissé tel quel.
 *
 * Écrit à la main parce que les sections sont lues par `t.raw()`, qui n'interpole rien.
 */
export function rellenarIdentidad(
  texto: string,
  pendiente: string,
  identidad: Record<string, string | null> = IDENTIDAD_LEGAL
): string {
  const valores: Record<string, string | null> = { ...identidad, telefono: TELEFONO_LEGIBLE };
  return texto.replace(/\{(\w+)\}/g, (jeton, clave: string) =>
    clave in valores ? (valores[clave] ?? pendiente) : jeton
  );
}
