"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, MediaGallery, toast, type MediaGalleryPhoto } from "@hifago/ui";
import { uploadCatalogBlob } from "@/lib/media/uploadCatalogBlob";
import { LocalizedTextField, type LocalizedValue } from "@/components/localized-text-field";
import { limpiarDescripcion } from "@/lib/tags/descripcionEditorial";

// Le CONTENU ÉDITORIAL d'une catégorie (spec 29 Tranche 3, 2026-09-08).
//
// ⚠️ POURQUOI CET ÉCRAN EXISTE. Depuis la décision de Jérôme du 2026-09-08, une catégorie porte une
// image, un nom et un texte, et la vitrine les affiche (`/es/actividades`). Sans ce bloc, seuls le
// seed — donc du SQL — pouvait les remplir : une catégorie créée en préprod ou en production
// naissait vide et le restait. C'est la différence entre une fonctionnalité montrable et une
// fonctionnalité livrée.
//
// ⚠️ UNE IMAGE, PAS UNE GALERIE, et c'est pourquoi on ne passe PAS par `add_catalog_media` :
// `catalog_tags` n'a pas de table de médias, le chemin vit dans une colonne (`image_path`, spec 29
// §6a). L'upload passe quand même par `/api/upload/tag` — le chemin canonique de tout le module
// images, qui traite le fichier (EXIF retiré, WebP, borne de dimensions) et l'écrit dans Storage
// avec `service_role`. Seul le RATTACHEMENT diffère, et il a toujours été à la charge de l'appelant.
//
// ⚠️ `MediaGallery` avec `maxPhotos={1}` plutôt qu'un téléverseur maison : le README l'exige
// (« un composant qui duplique quelque chose de packages/ui est une rupture »), et ça donne
// gratuitement le recadrage, les messages d'erreur et le comportement déjà connus des admins sur
// les fiches produit et établissement.

export function CategoriaEditorialBlock({
  tagId,
  initialDescription,
  initialImagePath,
}: {
  tagId: string;
  initialDescription: LocalizedValue;
  initialImagePath: string | null;
}) {
  const router = useRouter();
  const [description, setDescription] = useState<LocalizedValue>(initialDescription);
  const [imagePath, setImagePath] = useState(initialImagePath);
  const [isSaving, setIsSaving] = useState(false);

  const supabaseUrl = () => createClient().storage.from("catalog-media");

  const photos: MediaGalleryPhoto[] = imagePath
    ? // L'id est le chemin lui-même : il n'y a pas de ligne de média, donc pas d'identifiant à
      // part — et il est unique par construction (`crypto.randomUUID()` côté upload).
      [{ id: imagePath, url: supabaseUrl().getPublicUrl(imagePath).data.publicUrl }]
    : [];

  async function guardarTexto() {
    setIsSaving(true);
    const supabase = createClient();

    // ⚠️ Le nettoyage vit dans `lib/tags/` et pas ici : ce n'est pas de la cosmétique de saisie,
    // c'est ce qui décide de l'INDEXATION de la page de catégorie sur la vitrine (règle SEO 2).
    // Une fonction pure, donc testée comme telle.
    const { error } = await supabase
      .from("catalog_tags")
      .update({ description: limpiarDescripcion(description) })
      .eq("id", tagId);

    setIsSaving(false);

    if (error) {
      toast.danger("No se pudo guardar el texto de la categoría.");
      return;
    }
    toast.success("Texto guardado.");
    router.refresh();
  }

  async function handleAddFile(blob: Blob) {
    // Envoi commun aux six galeries (lib/media/uploadCatalogBlob.ts) : toute issue rend un
    // résultat avec un message écrit pour l'écran, jamais une exception ni un code brut.
    const upload = await uploadCatalogBlob("tag", blob);
    if (!upload.ok) return { ok: false, reason: upload.reason };

    const supabase = createClient();
    const { error } = await supabase
      .from("catalog_tags")
      .update({ image_path: upload.storagePath })
      .eq("id", tagId);

    // ⚠️ Si l'écriture échoue, le fichier reste dans le bucket sans être référencé. On ne le
    // supprime pas ici : `service_role` est côté serveur, et un client n'a pas le droit d'effacer
    // dans `catalog-media` (policies de la spec 04). L'orphelin est le même que celui d'un
    // remplacement — dette globale du module images, portée au backlog.
    if (error) return { ok: false, reason: "No se pudo asociar la imagen a la categoría." };

    setImagePath(upload.storagePath);
    router.refresh();
    return { ok: true };
  }

  async function handleDelete() {
    const supabase = createClient();
    const { error } = await supabase
      .from("catalog_tags")
      .update({ image_path: null })
      .eq("id", tagId);

    // Jamais `error.message` à l'écran : un texte technique, pas un message pour l'utilisateur.
    if (error) return { ok: false, reason: "No se pudo quitar la imagen de la categoría." };

    // ⚠️ L'objet reste dans le bucket : on retire la RÉFÉRENCE, pas le fichier. Même comportement
    // que partout ailleurs dans le module images, et même dette.
    setImagePath(null);
    router.refresh();
    return { ok: true };
  }

  return (
    <div className="flex flex-col gap-6 rounded-lg border bg-surface p-4">
      <div>
        <h2 className="mb-1 text-sm font-medium">Contenido de la categoría</h2>
        <p className="text-sm text-muted">
          La imagen y el texto se muestran en la página de actividades del sitio público. Ambos son
          opcionales: sin imagen la ficha muestra un fondo neutro, sin texto solo el nombre.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <LocalizedTextField
          label="Texto de la categoría"
          value={description}
          onChange={setDescription}
          multiline
          testIdPrefix="categoria-descripcion"
          fieldTestId="categoria-descripcion-field"
        />
        {/* ⚠️ `isDisabled` + libellé conditionnel, la convention de tout `apps/admin` (NewTagForm,
            ResolveEntryDialog, MarkPaidDialog…). Le `Button` d'ici est le HeroUI brut : il n'a pas
            le couple `isPending`/`pendingLabel` que l'atome d'`apps/web` ajoute, lequel garde le
            focus pendant l'envoi. Suivre la convention locale plutôt qu'innover dans un coin —
            l'écart entre les deux apps est une dette réelle, mais elle ne se corrige pas ici. */}
        <Button
          onPress={guardarTexto}
          isDisabled={isSaving}
          data-testid="guardar-descripcion"
          className="self-start"
        >
          {isSaving ? "Guardando…" : "Guardar texto"}
        </Button>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Imagen de portada</h3>
        <MediaGallery
          photos={photos}
          // UNE seule image : `MediaGallery` masque son bouton d'ajout dès qu'elle est là.
          maxPhotos={1}
          addLabel="Añadir imagen"
          onAddFile={handleAddFile}
          // ⚠️ Sans objet ici, et c'est volontaire : on ne peut pas réordonner un élément unique.
          // La prop est requise par le composant partagé — la satisfaire par un succès immédiat
          // est plus honnête que de la rendre optionnelle pour ce seul écran.
          onReorder={async () => ({ ok: true })}
          onDelete={handleDelete}
        />
      </div>
    </div>
  );
}
