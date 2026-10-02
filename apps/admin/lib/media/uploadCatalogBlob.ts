// L'envoi d'une photo recadrée au Route Handler d'upload (`/api/upload/[entity]`) — UN seul endroit
// pour les six galeries d'apps/admin (fiche produit et établissement admin, catégorie éditoriale,
// photos « en attente » de création, galerie socio), qui recopiaient chacune les mêmes lignes
// (2026-10-01).
//
// POURQUOI. Ces copies faisaient `await response.json()` sans regarder la réponse. Or au-dessus de
// sa limite de corps, la plateforme répond 413 en TEXTE, avant même la route : `.json()` levait,
// la modale de recadrage se fermait et rien ne s'affichait. Et un refus de la route remontait son
// code brut (« file_too_large ») jusqu'au toast. Ici, toute issue rend un résultat, avec un message
// écrit pour l'écran — jamais une exception, jamais un code technique.

export type CatalogUploadEntity = "product" | "establishment" | "tag";

export type CatalogUploadResult = { ok: true; storagePath: string } | { ok: false; reason: string };

const ECHEC = "No se pudo subir la foto.";
// Sans chiffre : la limite qui coupe d'abord n'est pas celle de la route (8 Mo) mais la limite de
// corps de la plateforme, plus basse — un chiffre affiché serait faux sur l'un des deux chemins.
const TROP_LOURDE = "La foto es demasiado pesada. Prueba con una imagen más liviana.";

// Codes de refus du Route Handler (apps/admin/app/api/upload/[entity]/route.ts et
// lib/media/catalogImage.ts). Un code absent d'ici retombe sur le message générique.
const MESSAGES: Record<string, string> = {
  file_too_large: TROP_LOURDE,
  unsupported_format: "Formato no admitido: usa JPG, PNG o WebP.",
  decode_failed: "No se pudo leer la imagen. Prueba con otra foto.",
  no_file: ECHEC,
  not_authenticated: "Tu sesión expiró. Vuelve a iniciar sesión.",
  anonymous_not_allowed: "Tu sesión expiró. Vuelve a iniciar sesión.",
  not_authorized: "No tienes permiso para subir esta foto.",
  authorization_unavailable: "No se pudo verificar tu acceso en este momento. Vuelve a intentarlo.",
  upload_failed: "No se pudo guardar la foto. Vuelve a intentarlo.",
};

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export async function uploadCatalogBlob(
  entity: CatalogUploadEntity,
  blob: Blob
): Promise<CatalogUploadResult> {
  const formData = new FormData();
  // Le nom n'est qu'indicatif : la route détermine le format à partir des octets.
  formData.append("file", blob, `photo.${EXTENSIONS[blob.type] ?? "jpg"}`);

  let response: Response;
  try {
    response = await fetch(`/api/upload/${entity}`, { method: "POST", body: formData });
  } catch {
    return { ok: false, reason: "No se pudo contactar con el servidor. Revisa tu conexión." };
  }

  // Réponse qui ne vient pas de la route (limite de corps de la plateforme, page d'erreur) : son
  // corps n'est pas du JSON et ne doit jamais être lu comme tel.
  if (!response.headers.get("Content-Type")?.includes("application/json")) {
    return { ok: false, reason: response.status === 413 ? TROP_LOURDE : ECHEC };
  }

  let body: { ok?: unknown; reason?: unknown; storage_path?: unknown };
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: ECHEC };
  }

  if (response.ok && body.ok === true && typeof body.storage_path === "string" && body.storage_path) {
    return { ok: true, storagePath: body.storage_path };
  }
  const code = typeof body.reason === "string" ? body.reason : "";
  return { ok: false, reason: MESSAGES[code] ?? (response.status === 413 ? TROP_LOURDE : ECHEC) };
}
