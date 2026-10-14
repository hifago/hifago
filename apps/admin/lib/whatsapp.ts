// wa.me deep-link — mécanisme de contact WhatsApp déjà utilisé ailleurs dans l'app (public/app.js
// `setupSupportLink` legacy, PartnerCodeEntry.tsx) : même numéro, même schéma d'URL
// (`https://wa.me/<digits>?text=<message pré-rempli>`), aucun nouveau canal de configuration
// introduit ici (pas de variable d'env, pas de second numéro).
export const SUPPORT_WHATSAPP_NUMBER = "573215764841";

export function buildWhatsAppLink(digitsOrRaw: string, message: string): string {
  return `https://wa.me/${digitsOrRaw}?text=${encodeURIComponent(message)}`;
}

// Messages pré-remplis du support de l'espace socio. Ils ne nomment personne (arbitrage de Gabriel,
// au nom de Jérôme) : le numéro est celui de l'équipe, pas d'une personne.
export const SUPPORT_ACCOUNT_MESSAGE =
  "Hola equipo Hifago, tengo un problema con mi cuenta de socio. ¿Me pueden ayudar?";

export function supportReferralCodeMessage(code: string): string {
  return `Hola equipo Hifago, soy "${code}", tengo un problema con mi enlace/QR de venta. ¿Me pueden ayudar?`;
}

// Normalisation heuristique d'un numéro CLIENT (order_lines.holder_phone, texte libre saisi au
// checkout, jamais validé/formaté en base) — retourne null si rien d'exploitable après nettoyage,
// pour ne jamais rendre un bouton mort plutôt que de générer un lien wa.me cassé. Best-effort : un
// numéro colombien à 10 chiffres commençant par 3 (format mobile local sans indicatif) reçoit le
// préfixe pays 57 ; tout le reste part tel quel (l'utilisateur a pu saisir l'indicatif lui-même).
export function buildClientWhatsAppLink(rawPhone: string | null | undefined, message: string): string | null {
  if (!rawPhone) return null;
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length === 0) return null;
  const withCountryCode = digits.length === 10 && digits.startsWith("3") ? `57${digits}` : digits;
  return buildWhatsAppLink(withCountryCode, message);
}

// Sentinelles email posées par create_manual_order_line (réservation manuelle walk-in, jamais
// d'email réel collecté) et par le backfill legacy (migration 20260817190000) — jamais présentées
// au prestataire comme un email réel à contacter.
const NON_REAL_EMAIL_SENTINELS = new Set([
  "reserva-manual@hifago.local",
  "sin-email-migrado@hifago.local",
]);

export function isRealClientEmail(email: string | null | undefined): email is string {
  return Boolean(email) && !NON_REAL_EMAIL_SENTINELS.has(email as string);
}
