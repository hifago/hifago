"use client";

import * as React from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Button, Slider } from "@heroui/react";

/**
 * Recadrage image en mémoire navigateur (spec docs/specs/04-gestion-images.md §10) —
 * `react-easy-crop` choisi headless (aucune UI/CSS embarquée, juste la géométrie + un callback
 * pixel) précisément pour pouvoir l'habiller en HeroUI (Slider pour le zoom, Button pour
 * confirmer) sans dupliquer un second design system (`hifago/CLAUDE.md` §2 point 2) — contrairement
 * à `cropperjs`, qui embarque sa propre UI. Rien n'est jamais écrit sur disque ici : le crop
 * produit un `Blob` en mémoire, à envoyer tel quel au Route Handler d'upload (contre le gap G5).
 */
export type ImageCropProps = {
  imageSrc: string;
  /** Largeur/hauteur, ex. 4/3 ou 1 pour un carré — undefined = recadrage libre. */
  aspect?: number;
  onCancel: () => void;
  /** Peut rendre une promesse : « Confirmar recorte » reste inactif jusqu'à sa résolution. */
  onConfirm: (blob: Blob) => void | Promise<void>;
};

export function ImageCrop({ imageSrc, aspect, onCancel, onConfirm }: ImageCropProps) {
  const [crop, setCrop] = React.useState({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = React.useState<Area | null>(null);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [hasFailed, setHasFailed] = React.useState(false);

  async function handleConfirm() {
    if (!croppedAreaPixels) return;
    setIsProcessing(true);
    setHasFailed(false);
    try {
      let blob: Blob;
      try {
        blob = await cropImageToBlob(imageSrc, croppedAreaPixels);
      } catch {
        // Image illisible par le navigateur, canvas indisponible : le dire, au lieu d'un bouton
        // qui ne fait rien.
        setHasFailed(true);
        return;
      }
      // ATTENDU (2026-10-01) : le bouton reste inactif jusqu'à la fin de l'envoi que l'appelant
      // déclenche. Sans cette attente, il se réactivait aussitôt, la modale encore ouverte, et un
      // second clic relançait un second envoi.
      await onConfirm(blob);
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative h-80 w-full overflow-hidden rounded-md bg-black" data-testid="image-crop-stage">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_area, areaPixels) => setCroppedAreaPixels(areaPixels)}
        />
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-muted">Zoom</span>
        <Slider
          className="flex-1"
          value={[zoom]}
          onChange={(value) => setZoom(Array.isArray(value) ? value[0]! : value)}
          minValue={1}
          maxValue={3}
          step={0.1}
          aria-label="Zoom de recadrage"
          data-testid="image-crop-zoom"
        >
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
      </div>

      {hasFailed ? (
        <p role="alert" className="text-sm text-danger" data-testid="image-crop-error">
          No se pudo procesar la imagen. Prueba con otra foto.
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onPress={onCancel} isDisabled={isProcessing} data-testid="image-crop-cancel">
          Cancelar
        </Button>
        <Button
          onPress={handleConfirm}
          isDisabled={isProcessing || !croppedAreaPixels}
          data-testid="image-crop-confirm"
        >
          {isProcessing ? "Procesando…" : "Confirmar recorte"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Côté le plus long d'une image recadrée, en pixels. C'est la valeur à laquelle le serveur réduit
 * de toute façon chaque photo (`MAX_DIMENSION`, apps/admin/lib/media/catalogImage.ts) : envoyer
 * plus grand ne gagne rien à l'écran et ne fait qu'alourdir l'envoi. Les deux valeurs vont ensemble.
 */
export const CROP_MAX_DIMENSION = 2400;

/**
 * Taille de sortie d'un recadrage : celle de la zone choisie, réduite proportionnellement pour que
 * son côté le plus long ne dépasse pas `max`. Jamais agrandie.
 */
export function cropOutputSize(
  area: { width: number; height: number },
  max: number = CROP_MAX_DIMENSION
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(area.width, area.height));
  return {
    width: Math.max(1, Math.round(area.width * scale)),
    height: Math.max(1, Math.round(area.height * scale)),
  };
}

// Recette standard react-easy-crop (dessin sur un canvas hors-écran) — jamais d'écriture disque,
// le résultat reste un Blob en mémoire jusqu'à l'envoi au Route Handler.
//
// Export JPEG qualité 0,9, côté long plafonné (2026-10-01). Avant : un PNG à la résolution de la
// zone recadrée, soit couramment plus de 10 Mo pour une photo de téléphone — au-dessus des limites
// d'envoi, donc refusé. Le serveur ré-encode toute photo en WebP : ce JPEG n'est qu'un transport.
// Fond blanc d'abord : le JPEG n'a pas de transparence, une source PNG transparente donnerait du
// noir.
async function cropImageToBlob(imageSrc: string, area: Area): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const output = cropOutputSize(area);
  const canvas = document.createElement("canvas");
  canvas.width = output.width;
  canvas.height = output.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context indisponible");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    output.width,
    output.height
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Échec de la conversion du recadrage en blob"));
      },
      "image/jpeg",
      0.9
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}
