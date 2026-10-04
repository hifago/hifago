"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { MediaGallery, type MediaGalleryPhoto } from "@hifago/ui";
import { uploadCatalogBlob } from "@/lib/media/uploadCatalogBlob";

const MAX_PHOTOS = 6;

// Bloc galerie produit (spec docs/specs/04-gestion-images.md §5/§7) — même mécanique que
// ProductStatusBlock (action distincte, pas un champ de plus dans EditProductForm). L'admin
// écrit directement (add_catalog_media) : jamais de file de modération pour ses propres ajouts,
// contrairement au socio (cf. ProposePhotosBlock côté /partner).
export function ProductPhotosBlock({
  productId,
  initialPhotos,
}: {
  productId: string;
  initialPhotos: MediaGalleryPhoto[];
}) {
  const [photos, setPhotos] = useState(initialPhotos);

  async function handleAddFile(blob: Blob) {
    const supabase = createClient();

    // Envoi commun aux six galeries (lib/media/uploadCatalogBlob.ts) : toute issue rend un
    // résultat avec un message écrit pour l'écran, jamais une exception ni un code brut.
    const upload = await uploadCatalogBlob("product", blob);
    if (!upload.ok) {
      return { ok: false, reason: upload.reason };
    }

    const { data, error } = await supabase.rpc("add_catalog_media", {
      p_entity_type: "product",
      p_entity_id: productId,
      p_storage_path: upload.storagePath,
    });

    // Jamais `error.message` à l'écran : c'est un texte SQL (en français, avec des noms de
    // fonction), pas un message pour l'utilisateur.
    if (error || !data) {
      return { ok: false, reason: "No se pudo añadir la foto." };
    }

    const { data: publicUrl } = supabase.storage.from("catalog-media").getPublicUrl(upload.storagePath);
    setPhotos((prev) => [...prev, { id: data as string, url: publicUrl.publicUrl }]);
    return { ok: true };
  }

  async function handleReorder(orderedIds: string[]) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("reorder_gallery", {
      p_entity_type: "product",
      p_entity_id: productId,
      p_ordered_media_ids: orderedIds,
    });
    const result = data as { ok: boolean; reason?: string } | null;
    if (error || !result?.ok) {
      // Sans `reason`, la galerie affiche son propre message (« No se pudo reordenar la galería. »).
      return { ok: false };
    }
    setPhotos((prev) => orderedIds.map((id) => prev.find((p) => p.id === id)!));
    return { ok: true };
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    // `.select("id")` : une suppression filtrée par la RLS ne lève pas, elle touche 0 ligne.
    // Sans ce retour, « Foto eliminada. » s'afficherait pour une photo restée en place.
    const { data: deleted, error } = await supabase.from("product_media").delete().eq("id", id).select("id");
    if (error || !deleted?.length) return { ok: false };
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    return { ok: true };
  }

  return (
    <div className="rounded-lg border bg-surface p-4">
      <h2 className="mb-3 text-sm font-medium">Fotos</h2>
      <MediaGallery
        photos={photos}
        maxPhotos={MAX_PHOTOS}
        onAddFile={handleAddFile}
        onReorder={handleReorder}
        onDelete={handleDelete}
      />
    </div>
  );
}
