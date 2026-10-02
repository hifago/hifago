// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadCatalogBlob } from "./uploadCatalogBlob";

// L'envoi d'une photo recadrée au Route Handler d'upload. Ce fichier prouve que TOUTE issue rend
// un résultat exploitable par la galerie — jamais une exception qui fermerait la modale sans un
// mot : réponse non-JSON (la plateforme répond 413 en texte au-dessus de sa limite de corps, avant
// même la route), réseau coupé, refus de la route avec son code, traduit pour l'écran.

function repondre(corps: BodyInit | null, init: ResponseInit & { json?: boolean } = {}) {
  const headers = new Headers(init.headers);
  if (init.json !== false) headers.set("Content-Type", "application/json");
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(corps, { ...init, headers }));
}

const PHOTO = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });

afterEach(() => vi.restoreAllMocks());

describe("uploadCatalogBlob", () => {
  it("succès : rend le chemin de stockage", async () => {
    repondre(JSON.stringify({ ok: true, storage_path: "products/x.webp" }));
    await expect(uploadCatalogBlob("product", PHOTO)).resolves.toEqual({
      ok: true,
      storagePath: "products/x.webp",
    });
  });

  it("envoie à la route de l'entité, un fichier nommé selon son type", async () => {
    const espion = repondre(JSON.stringify({ ok: true, storage_path: "tags/x.webp" }));
    await uploadCatalogBlob("tag", PHOTO);
    const [url, init] = espion.mock.calls[0]!;
    expect(url).toBe("/api/upload/tag");
    expect(((init?.body as FormData).get("file") as File).name).toBe("photo.jpg");
  });

  it("413 en texte (limite de la plateforme, avant la route) : « trop lourde », jamais une exception", async () => {
    repondre("Request Entity Too Large", { status: 413, json: false });
    await expect(uploadCatalogBlob("product", PHOTO)).resolves.toEqual({
      ok: false,
      reason: "La foto es demasiado pesada (máx. 8 MB).",
    });
  });

  it("autre réponse non-JSON (page d'erreur) : message générique, jamais une exception", async () => {
    repondre("<html>502</html>", { status: 502, json: false });
    await expect(uploadCatalogBlob("product", PHOTO)).resolves.toEqual({
      ok: false,
      reason: "No se pudo subir la foto.",
    });
  });

  it("réseau coupé : message explicite, jamais une exception", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(uploadCatalogBlob("product", PHOTO)).resolves.toEqual({
      ok: false,
      reason: "No se pudo contactar con el servidor. Revisa tu conexión.",
    });
  });

  it.each([
    ["file_too_large", 413, "La foto es demasiado pesada (máx. 8 MB)."],
    ["unsupported_format", 415, "Formato no admitido: usa JPG, PNG o WebP."],
    ["authorization_unavailable", 503, "No se pudo verificar tu acceso en este momento. Vuelve a intentarlo."],
    ["not_authorized", 403, "No tienes permiso para subir esta foto."],
  ])("refus %s (%i) : traduit pour l'écran", async (reason, status, attendu) => {
    repondre(JSON.stringify({ ok: false, reason }), { status });
    await expect(uploadCatalogBlob("product", PHOTO)).resolves.toEqual({ ok: false, reason: attendu });
  });

  it("refus au code inconnu : message générique, jamais le code brut", async () => {
    repondre(JSON.stringify({ ok: false, reason: "quelque_chose_de_neuf" }), { status: 400 });
    await expect(uploadCatalogBlob("product", PHOTO)).resolves.toEqual({
      ok: false,
      reason: "No se pudo subir la foto.",
    });
  });

  it("succès sans chemin de stockage : échec, jamais un chemin vide", async () => {
    repondre(JSON.stringify({ ok: true }));
    await expect(uploadCatalogBlob("product", PHOTO)).resolves.toEqual({
      ok: false,
      reason: "No se pudo subir la foto.",
    });
  });
});
