"use client";

import { useState } from "react";
import { createClient } from "@hifago/supabase/client";
import { MediaGallery, type MediaGalleryPhoto } from "@hifago/ui";
import { uploadCatalogBlob } from "@/lib/media/uploadCatalogBlob";

const MAX_PHOTOS = 6;

type EntityType = "product" | "establishment";
type SubmitRpc = "submit_photos_proposal" | "submit_establishment_photos_proposal";
type DeleteTable = "product_media" | "establishment_media";

const SUBMIT_ERRORS_COMMON: Record<string, string> = {
  capability_suspended: "Tu capacidad de operador para este establecimiento no está activa.",
  pending_cap_exceeded: "Ya tienes 10 propuestas pendientes. Espera a que se revisen antes de enviar más.",
  gallery_cap_exceeded: "La galería ya tiene 6 fotos entre publicadas y propuestas.",
  no_photos: "Selecciona una foto.",
  not_authenticated: "No se pudo verificar tu sesión. Vuelve a intentarlo.",
};

// Bloc générique factorisant ProductPhotosSocioBlock.tsx / EstablishmentPhotosSocioBlock.tsx
// (quasi-duplication byte-for-byte relevée en revue) — un seul composant paramétré par entité au
// lieu de deux fichiers symétriques. Galerie socio (spec docs/specs/04-gestion-images.md §5) —
// retirer/reordenar es escritura directa (RLS {product,establishment}_media_delete_own / RPC
// reorder_gallery, déjà générique via p_entity_type/p_entity_id), pero AÑADIR siempre pasa por una
// RPC submit_*_photos_proposal dédiée par entité (pas encore généricisée côté DB) : nunca aparece
// en la galería principal hasta que el admin apruebe (invariante "un prestatario nunca introduce
// contenido no moderado en el catálogo público", cahier socio §3f) — se muestra aparte, como
// "propuesta pendiente".
export function PhotosSocioBlock({
  entityType,
  entityId,
  submitRpc,
  deleteTable,
  notFoundLabel,
  initialPhotos,
  initialPendingPhotos,
}: {
  entityType: EntityType;
  entityId: string;
  submitRpc: SubmitRpc;
  deleteTable: DeleteTable;
  notFoundLabel: string;
  initialPhotos: MediaGalleryPhoto[];
  initialPendingPhotos: string[];
}) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [pendingPhotos, setPendingPhotos] = useState(initialPendingPhotos);

  // Seule la clé "*_not_found" varie réellement en texte (une activité vs un establecimiento) —
  // le reste du vocabulaire d'erreur est partagé mot pour mot entre les deux entités.
  const submitErrors: Record<string, string> = {
    [`${entityType}_not_found`]: notFoundLabel,
    ...SUBMIT_ERRORS_COMMON,
  };

  async function handleAddFile(blob: Blob) {
    const supabase = createClient();

    // Envoi commun aux six galeries (lib/media/uploadCatalogBlob.ts) : toute issue rend un
    // résultat avec un message écrit pour l'écran, jamais une exception ni un code brut. La route
    // se déduit de l'entité (l'ancienne prop `uploadEndpoint` ne faisait que la répéter).
    const upload = await uploadCatalogBlob(entityType, blob);
    if (!upload.ok) {
      return { ok: false, reason: upload.reason };
    }

    // Les deux RPC partagent p_storage_paths mais divergent sur le nom de leur paramètre d'entité
    // (p_product_id / p_establishment_id) — pas encore généricisées en p_entity_type/p_entity_id
    // côté DB (contrairement à reorder_gallery ci-dessous) : brancher sur `submitRpc` narrowe son
    // literal type pour que chaque appel matche exactement la signature Args attendue.
    const { data, error: rpcError } =
      submitRpc === "submit_photos_proposal"
        ? await supabase.rpc(submitRpc, {
            p_product_id: entityId,
            p_storage_paths: [upload.storagePath],
          })
        : await supabase.rpc(submitRpc, {
            p_establishment_id: entityId,
            p_storage_paths: [upload.storagePath],
          });
    const result = data as { ok: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      // Un code inconnu ou une erreur SQL ne s'affichent jamais tels quels : sans `reason`, la
      // galerie montre son propre message.
      return { ok: false, reason: submitErrors[result?.reason ?? ""] };
    }

    // Aperçu local immédiat (blob déjà en main, pas besoin d'attendre un aller-retour Storage) —
    // jamais ajouté à `photos` : la galerie publiée (media-gallery-item) ne doit refléter que le
    // contenu déjà approuvé (cf. partner-propose-photo.spec.ts).
    setPendingPhotos((prev) => [...prev, URL.createObjectURL(blob)]);
    return { ok: true };
  }

  async function handleReorder(orderedIds: string[]) {
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("reorder_gallery", {
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_ordered_media_ids: orderedIds,
    });
    const result = data as { ok: boolean; reason?: string } | null;
    if (rpcError || !result?.ok) {
      return { ok: false, reason: submitErrors[result?.reason ?? ""] };
    }
    setPhotos((prev) => orderedIds.map((id) => prev.find((p) => p.id === id)!));
    return { ok: true };
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    // `.select("id")` : une suppression refusée par la RLS (photo d'un établissement que l'on
    // n'opère pas) ne lève pas, elle touche 0 ligne. Sans ce retour, « Foto eliminada. »
    // s'affichait pour une photo restée en place.
    const { data: deleted, error: deleteError } = await supabase
      .from(deleteTable)
      .delete()
      .eq("id", id)
      .select("id");
    if (deleteError || !deleted?.length) return { ok: false };
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    return { ok: true };
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-surface p-4">
      <h2 className="text-sm font-medium">Fotos</h2>
      <p className="text-xs text-muted">
        Puedes quitar o reordenar tus fotos publicadas cuando quieras. Añadir una foto nueva envía una
        propuesta que un admin revisa antes de publicarla.
      </p>

      {pendingPhotos.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p role="status" data-testid="pending-photos-proposal" className="text-sm text-muted">
            {pendingPhotos.length === 1 ? "1 foto propuesta" : `${pendingPhotos.length} fotos propuestas`},
            pendiente de revisión.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {pendingPhotos.map((url) => (
              <div
                key={url}
                className="relative overflow-hidden rounded-md border border-dashed border-default opacity-80"
                data-testid="pending-photo-item"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob:/URL signée), pas une image de contenu servie par next/image */}
                <img src={url} alt="" className="aspect-square w-full object-cover" />
                <span className="absolute left-1 top-1 rounded bg-warning px-1.5 py-0.5 text-xs text-warning-foreground">
                  Pendiente
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <MediaGallery
        photos={photos}
        maxPhotos={MAX_PHOTOS}
        addLabel="Proponer foto"
        addHint="La foto se publica solo después de que un admin la apruebe."
        onAddFile={handleAddFile}
        onReorder={handleReorder}
        onDelete={handleDelete}
      />
    </div>
  );
}
