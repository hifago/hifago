"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@hifago/supabase/client";
import { Button, Checkbox, ImageCrop, Input, Label, Modal, TextArea, TextField, cn, toast } from "@hifago/ui";
import Link from "next/link";
import { SearchableCombobox } from "@/components/searchable-combobox";
import { useAddressAutocomplete } from "@/components/use-address-autocomplete";
import { TagsMultiSelect, type TagOption } from "@/components/tags-multiselect";
import { useEstablishmentFieldsState } from "@/lib/establishments/useEstablishmentFieldsState";
import { buildEstablishmentRpcParams } from "@/lib/establishments/establishmentPayload";
import { uploadCatalogBlob } from "@/lib/media/uploadCatalogBlob";
import { ActionConfirmation } from "@/components/action-confirmation";
import { WizardStepper } from "@/components/wizard-stepper";

type Partner = { id: string; display_name: string };

// docs/specs/04-gestion-images.md — remplace le bucket/mécanisme provisoire de la spec 03
// (photo_urls, déprécié par 20260815110000_gestion_images.sql). Bucket unique pour tout le
// catalogue, dossier establishments/ par lisibilité (§6). Upload via le Route Handler
// service_role (POST /api/upload/establishment, §7 du spec 04) : recadrage client + conversion
// WebP/strip EXIF, le même pipeline que la fiche produit (ProductPhotosBlock) — plus l'upload
// direct basique posé par la spec 03 en attendant que ce pipeline existe.
const MAX_PHOTOS = 6; // plafond uniforme décidé (spec 04 §3), déjà appliqué côté RPC

// Même constante que packages/ui/src/components/media-gallery.tsx (bouton flottant sur une
// vignette photo) — un scrim sombre fixe reste lisible quelle que soit la photo derrière, à
// l'inverse d'un contour qui dépend du contraste avec les jetons de couleur ambiants.
const overlayButtonClass =
  "flex h-7 w-7 items-center justify-center bg-black/55 text-sm leading-none text-white transition-colors hover:bg-black/70 disabled:pointer-events-none disabled:opacity-40";

export function NewEstablishmentForm({
  partners,
  defaultPartnerId = null,
  allAmenities = [],
}: {
  partners: Partner[];
  defaultPartnerId?: string | null;
  // Équipements structurés (migration 20260917110000) — stagés comme le reste du formulaire,
  // demande explicite de Jérôme (2026-09-17) : contrairement aux tags, qui n'ont ici aucun
  // équivalent, l'équipement doit pouvoir être saisi dès la création, pas seulement après via
  // EstablishmentAmenitiesBlock.
  allAmenities?: TagOption[];
}) {
  const router = useRouter();

  // Identidad — `nombre` reste hors du hook d'état partagé, même patron que `name`/`description`
  // côté produit (useProductTypeFieldsState) : possédé par le composant, jamais localisé.
  const [nombre, setNombre] = useState("");

  // Rattachement partenaire — préréempli depuis ?partner_id= (docs/specs/05-invitations-onboarding-
  // dashboard-partenaire.md §5.6), ex. depuis le badge « Falta establecimiento » de
  // /admin/invitations. L'admin garde la main : le champ reste modifiable, ce n'est qu'une valeur
  // initiale, pas un verrouillage.
  const [partnerId, setPartnerId] = useState<string | null>(defaultPartnerId);

  // Presentación — description ES/EN + bascule de langue, adresse/lat/lon, operatedDirectly,
  // équipements stagés : state partagé avec EstablishmentEditBlock.tsx (revue de packaging admin,
  // 2026-09-17), même hook que useProductTypeFieldsState côté produit.
  const fields = useEstablishmentFieldsState();
  const [photos, setPhotos] = useState<{ path: string; url: string }[]>([]);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Assistant par étapes (docs/specs/40) — 2 étapes seulement, pas de 3e étape commerciale (un
  // établissement ne porte aucun prix propre, contrairement à un produit).
  const [stepIndex, setStepIndex] = useState(0);
  const STEP_TITLES = ["Propietario y gestión", "Detalles"];

  const [confirmation, setConfirmation] = useState<{
    status: "success" | "pending";
    title: string;
    body: string;
    actionLabel: string;
    onAction: () => void;
  } | null>(null);

  function validateStep(index: number): string | null {
    if (index === 0) {
      return partnerId ? null : "El partner es obligatorio.";
    }
    return nombre.trim() ? null : "El nombre es obligatorio.";
  }

  function goNext() {
    const error = validateStep(stepIndex);
    if (error) {
      toast.danger(error);
      return;
    }
    setStepIndex((current) => Math.min(current + 1, STEP_TITLES.length - 1));
  }

  function goPrev() {
    setStepIndex((current) => Math.max(current - 1, 0));
  }

  // Même widget que la création partenaire (docs/specs/01-admin-creation-partenaire.md §5) —
  // repli manuel toujours possible, no-op silencieux si la clé Google Maps est absente.
  const addressSearchRef = useAddressAutocomplete((place) => {
    fields.setAddress(place.address);
    if (place.lat !== null && place.lon !== null) {
      fields.setLat(String(place.lat));
      fields.setLon(String(place.lon));
    }
  });

  // L'établissement n'a pas encore d'id à ce stade du formulaire : le Route Handler d'upload
  // n'a besoin que du type d'entité pour choisir le dossier de rangement (§7 du spec 04), pas
  // d'un establishment_id réel. Les lignes establishment_media (avec le vrai establishment_id)
  // ne sont créées qu'à la soumission, via add_catalog_media (cf. handleSubmit) — la table a une
  // FK not null, contrairement à l'ancien tableau plat photo_urls.
  function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPendingImage(URL.createObjectURL(file));
  }

  async function handleCropConfirm(blob: Blob) {
    setIsUploadingPhotos(true);
    try {
      // Envoi commun aux galeries (lib/media/uploadCatalogBlob.ts) : toute issue rend un résultat
      // avec un message écrit pour l'écran — l'ancien `response.json()` levait sur un 413 en texte
      // de la plateforme, et la modale se fermait sans un mot.
      const upload = await uploadCatalogBlob("establishment", blob);
      if (!upload.ok) {
        toast.danger(upload.reason);
        return;
      }
      setPhotos((prev) => [...prev, { path: upload.storagePath, url: URL.createObjectURL(blob) }]);
      toast.success("Foto añadida.");
    } finally {
      if (pendingImage) URL.revokeObjectURL(pendingImage);
      setPendingImage(null);
      setIsUploadingPhotos(false);
    }
  }

  function handleCropCancel() {
    if (pendingImage) URL.revokeObjectURL(pendingImage);
    setPendingImage(null);
  }

  function removePhoto(path: string) {
    setPhotos((prev) => prev.filter((photo) => photo.path !== path));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    for (let index = 0; index < STEP_TITLES.length; index += 1) {
      const error = validateStep(index);
      if (error) {
        toast.danger(error);
        setStepIndex(index);
        return;
      }
    }

    // La boucle de validation ci-dessus garantit déjà partnerId non nul (étape 0) — TypeScript ne
    // suit pas cette garantie à travers l'appel à validateStep, d'où cette assertion plutôt qu'un
    // second `if` redondant à l'exécution.
    setIsSubmitting(true);

    const supabase = createClient();
    // Dédoublonnage payload établissement (chantier 2026-09-17) — même builder que
    // EstablishmentEditBlock.tsx, signatures RPC vérifiées contre la base avant extraction (cf.
    // establishmentPayload.ts).
    const { data: establishmentId, error: rpcError } = await supabase.rpc("create_establishment", {
      p_partner_id: partnerId!,
      ...buildEstablishmentRpcParams(nombre, fields),
    });

    if (rpcError || !establishmentId) {
      toast.danger("No se pudo crear el establecimiento.");
      setIsSubmitting(false);
      return;
    }

    // Les photos déjà uploadées dans le bucket (cf. handleFilesSelected) sont rattachées
    // maintenant que l'établissement existe (establishment_media.establishment_id est not null,
    // spec 04 §6) — un échec ici n'annule pas la création déjà réussie (spec 03 §9 : une photo en
    // échec ne bloque jamais la création), juste un avertissement non bloquant. Chaque appel est
    // indépendant (p_sort distinct par photo) : lancés en parallèle plutôt qu'attendus un par un.
    const mediaResults = await Promise.all(
      photos.map((photo, index) =>
        supabase.rpc("add_catalog_media", {
          p_entity_type: "establishment",
          p_entity_id: establishmentId,
          p_storage_path: photo.path,
          p_sort: index,
        })
      )
    );
    for (const { error: mediaError } of mediaResults) {
      if (mediaError) {
        toast.danger("El establecimiento se creó, pero una foto no se pudo asociar.");
      }
    }

    // Équipements structurés — rattachés après coup comme les photos ci-dessus (establishment_id
    // n'existe qu'une fois create_establishment résolu), non bloquant : un échec ici laisse
    // l'établissement créé sans équipements, corrigible depuis EstablishmentAmenitiesBlock.
    if (fields.selectedAmenityIds.length > 0) {
      const { error: amenitiesError } = await supabase
        .from("establishment_amenity_assignments")
        .insert(fields.selectedAmenityIds.map((amenityId) => ({ establishment_id: establishmentId, amenity_id: amenityId })));
      if (amenitiesError) {
        toast.danger("El establecimiento se creó, pero el equipamiento no se pudo asociar.");
      }
    }

    setConfirmation({
      status: "success",
      title: "¡Establecimiento creado!",
      body: "Ya está publicado y visible en el catálogo — no necesita revisión adicional.",
      actionLabel: "Volver al catálogo",
      onAction: () => {
        router.push("/admin/establishments");
        router.refresh();
      },
    });
  }

  if (confirmation) {
    return (
      <ActionConfirmation
        status={confirmation.status}
        title={confirmation.title}
        body={confirmation.body}
        actionLabel={confirmation.actionLabel}
        onAction={confirmation.onAction}
        testId="establishment-form-confirmation"
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full max-w-3xl flex-col gap-6 self-center">
      <WizardStepper titles={STEP_TITLES} currentIndex={stepIndex} onStepClick={setStepIndex} />

      {stepIndex === 0 ? (
        <div className="flex flex-col gap-6">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-lg font-semibold">Partner propietario</legend>
            <SearchableCombobox
              items={partners}
              getKey={(partner) => partner.id}
              getLabel={(partner) => partner.display_name}
              value={partnerId}
              onChange={setPartnerId}
              label="Partner propietario"
              placeholder="Buscar partner…"
              testId="partner-search"
            />
            <p className="text-xs text-muted">
              ¿No encuentras el partner?{" "}
              <Link href="/admin/partners/new" className="underline">
                Créalo primero
              </Link>
              , luego vuelve aquí.
            </p>
          </fieldset>

          <Checkbox
            data-testid="operated-directly-checkbox"
            isSelected={fields.operatedDirectly}
            onChange={fields.setOperatedDirectly}
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              Operado directamente por la plataforma
            </Checkbox.Content>
          </Checkbox>
        </div>
      ) : null}

      {stepIndex === 1 ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nombre">Nombre</Label>
            <Input
              id="nombre"
              name="nombre"
              required
              value={nombre}
              onChange={(event) => setNombre(event.target.value)}
            />
          </div>

          <TextField
            fullWidth
            value={fields.descriptionLang === "es" ? fields.descriptionEs : fields.descriptionEn}
            onChange={(value) =>
              fields.descriptionLang === "es" ? fields.setDescriptionEs(value) : fields.setDescriptionEn(value)
            }
          >
            <div className="flex items-center justify-between">
              <Label>Descripción</Label>
              <div className="flex gap-1" role="group" aria-label="Idioma de la descripción">
                {(["es", "en"] as const).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    data-testid={`description-lang-${lang}`}
                    onClick={() => fields.setDescriptionLang(lang)}
                    className={cn(
                      "rounded px-2 py-0.5 text-xs font-medium uppercase",
                      fields.descriptionLang === lang
                        ? "bg-accent text-accent-foreground"
                        : "text-muted hover:bg-muted/50",
                    )}
                  >
                    {lang}
                  </button>
                ))}
              </div>
            </div>
            <TextArea data-testid="description-textarea" />
          </TextField>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address-search">Buscar dirección (Google)</Label>
            {/* Web Component Google — pas de <Input> HeroUI ici, il gère son propre champ interne */}
            <div id="address-search" ref={addressSearchRef} data-testid="address-search" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address">Dirección</Label>
            <Input
              id="address"
              value={fields.address}
              onChange={(event) => fields.setAddress(event.target.value)}
              placeholder="Se completa al elegir una sugerencia arriba, o escribe aquí directamente"
              data-testid="address-input"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lat">Latitud — detectada o manual</Label>
              <Input id="lat" value={fields.lat} onChange={(event) => fields.setLat(event.target.value)} data-testid="lat-input" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lon">Longitud — detectada o manual</Label>
              <Input id="lon" value={fields.lon} onChange={(event) => fields.setLon(event.target.value)} data-testid="lon-input" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="photos">Fotos — máximo {MAX_PHOTOS}</Label>
            <label
              className={cn(
                "flex w-fit cursor-pointer items-center gap-2 border border-dashed border-default px-4 py-2 text-sm text-muted",
                (photos.length >= MAX_PHOTOS || isUploadingPhotos) && "pointer-events-none opacity-50"
              )}
            >
              <input
                id="photos"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileSelected}
                disabled={photos.length >= MAX_PHOTOS || isUploadingPhotos}
                data-testid="photos-input"
                className="hidden"
              />
              <span>Añadir foto</span>
              <span className="text-xs">
                {photos.length}/{MAX_PHOTOS}
              </span>
            </label>
            {isUploadingPhotos ? <p className="text-xs text-muted">Subiendo…</p> : null}
            {photos.length > 0 ? (
              <ul className="flex flex-wrap gap-2" data-testid="photos-list">
                {photos.map((photo) => (
                  <li key={photo.path} className="relative overflow-hidden rounded-md border border-default">
                    {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local d'un Blob
                        pas encore rattaché à un establishment_id ; next/image exigerait une URL
                        Storage réelle, pas un object URL éphémère. */}
                    <img src={photo.url} alt="" className="h-24 w-24 object-cover" />
                    <button
                      type="button"
                      onClick={() => removePhoto(photo.path)}
                      aria-label="Quitar foto"
                      className={cn(overlayButtonClass, "absolute right-1 top-1 h-6 w-6")}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <Modal>
              <Modal.Backdrop
                isOpen={pendingImage !== null}
                onOpenChange={(isOpen) => {
                  if (!isOpen) handleCropCancel();
                }}
              >
                <Modal.Container>
                  <Modal.Dialog data-testid="establishment-photo-crop-panel">
                    <Modal.Header>
                      <Modal.Heading>Recortar foto</Modal.Heading>
                    </Modal.Header>
                    <Modal.Body>
                      {pendingImage ? (
                        <ImageCrop imageSrc={pendingImage} onCancel={handleCropCancel} onConfirm={handleCropConfirm} />
                      ) : null}
                    </Modal.Body>
                  </Modal.Dialog>
                </Modal.Container>
              </Modal.Backdrop>
            </Modal>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-lg font-semibold">Equipamiento — opcional</legend>
            <TagsMultiSelect
              availableTags={allAmenities}
              selectedTagIds={fields.selectedAmenityIds}
              onChange={fields.setSelectedAmenityIds}
              allowCreate={false}
              label="Equipamiento"
              placeholder="Buscar equipamiento…"
              emptyMessage="Ningún equipamiento disponible."
              testId="amenities-multiselect"
            />
          </fieldset>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 pt-2">
        <Button type="button" variant="outline" onPress={goPrev} isDisabled={stepIndex === 0}>
          Anterior
        </Button>
        {stepIndex < STEP_TITLES.length - 1 ? (
          <Button type="button" onPress={goNext} data-testid="wizard-next-button">
            Siguiente
          </Button>
        ) : (
          <Button
            type="submit"
            isDisabled={isSubmitting || isUploadingPhotos}
            data-testid="create-establishment-button"
          >
            {isSubmitting ? "Creando…" : "Crear establecimiento"}
          </Button>
        )}
      </div>
    </form>
  );
}
