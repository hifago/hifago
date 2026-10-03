"use client";

import { MediaGallery, type MediaGalleryPhoto } from "@hifago/ui";
import { uploadCatalogBlob } from "@/lib/media/uploadCatalogBlob";

const MAX_PHOTOS = 6;

export type StagedPhoto = { path: string; url: string };

// Miroir de StagedProductPhotos (product-photos-staged.tsx, spec 11) pour l'établissement — même
// besoin structurel : des photos disponibles dès la création, avant que l'établissement existe
// (establishment_media.establishment_id est une FK not null). Upload immédiat vers Storage au
// recadrage confirmé (aucune ligne DB encore), state local {path, url}[] tenu par le parent
// (NewEstablishmentProposalForm.tsx), rattachement différé (establishment_media) une fois
// l'establishment_id connu, à l'approbation admin — cf. migration
// <horodatage>_establishment_creation_proposal_photos.sql.
export function StagedEstablishmentPhotos({
  photos,
  onChange,
}: {
  photos: StagedPhoto[];
  onChange: (next: StagedPhoto[]) => void;
}) {
  async function handleAddFile(blob: Blob) {
    // Envoi commun aux six galeries (lib/media/uploadCatalogBlob.ts) : toute issue rend un
    // résultat avec un message écrit pour l'écran, jamais une exception ni un code brut.
    const upload = await uploadCatalogBlob("establishment", blob);
    if (!upload.ok) {
      return { ok: false, reason: upload.reason };
    }
    onChange([...photos, { path: upload.storagePath, url: URL.createObjectURL(blob) }]);
    return { ok: true };
  }

  async function handleReorder(orderedIds: string[]) {
    onChange(orderedIds.map((path) => photos.find((photo) => photo.path === path)!));
    return { ok: true };
  }

  async function handleDelete(path: string) {
    onChange(photos.filter((photo) => photo.path !== path));
    return { ok: true };
  }

  const galleryPhotos: MediaGalleryPhoto[] = photos.map((photo) => ({ id: photo.path, url: photo.url }));

  return (
    <MediaGallery
      photos={galleryPhotos}
      maxPhotos={MAX_PHOTOS}
      onAddFile={handleAddFile}
      onReorder={handleReorder}
      onDelete={handleDelete}
    />
  );
}
