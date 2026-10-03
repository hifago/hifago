import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Galerie et recadrage partagés (packages/ui, MediaGallery + ImageCrop). Testés ici, chez leur
// consommateur : packages/ui n'a pas d'exécuteur de tests. Ce fichier prouve :
// (1) qu'un recadrage n'est jamais exporté au-delà du côté long que le serveur garde (2400 px) ;
// (2) qu'aucune action de la galerie ne finit en silence quand son callback lève — la modale se
//     fermait sans un mot, ou la galerie restait bloquée en « occupée ».

const toast = vi.hoisted(() => ({ success: vi.fn(), danger: vi.fn(), info: vi.fn() }));

vi.mock("@heroui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heroui/react")>()),
  toast,
}));

// Le recadreur réel attend une image décodée et un canvas, absents de jsdom : remplacé par un
// bouton qui confirme un recadrage déjà fait. `cropOutputSize` reste le vrai.
vi.mock("../../../packages/ui/src/components/image-crop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../packages/ui/src/components/image-crop")>()),
  ImageCrop: ({ onConfirm }: { onConfirm: (blob: Blob) => void }) => (
    <button type="button" onClick={() => onConfirm(new Blob(["x"], { type: "image/jpeg" }))}>
      confirmar recorte
    </button>
  ),
}));

const { MediaGallery, cropOutputSize, CROP_MAX_DIMENSION } = await import("@hifago/ui");

describe("cropOutputSize", () => {
  it("plafonne le côté long à la valeur du serveur, proportions gardées", () => {
    expect(CROP_MAX_DIMENSION).toBe(2400);
    expect(cropOutputSize({ width: 4000, height: 3000 })).toEqual({ width: 2400, height: 1800 });
    expect(cropOutputSize({ width: 3000, height: 6000 })).toEqual({ width: 1200, height: 2400 });
  });

  it("n'agrandit jamais un recadrage plus petit", () => {
    expect(cropOutputSize({ width: 1200, height: 800 })).toEqual({ width: 1200, height: 800 });
  });
});

const PHOTOS = [
  { id: "a", url: "https://example.test/a.webp" },
  { id: "b", url: "https://example.test/b.webp" },
];

function rendre(callbacks: Partial<Parameters<typeof MediaGallery>[0]> = {}) {
  render(
    <MediaGallery
      photos={PHOTOS}
      maxPhotos={6}
      onAddFile={async () => ({ ok: true })}
      onReorder={async () => ({ ok: true })}
      onDelete={async () => ({ ok: true })}
      {...callbacks}
    />
  );
}

const LEVE = async () => {
  throw new Error("réseau coupé");
};

describe("MediaGallery — une action qui lève ne finit jamais en silence", () => {
  beforeEach(() => {
    toast.success.mockClear();
    toast.danger.mockClear();
    URL.createObjectURL = vi.fn(() => "blob:recadrage");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.clearAllMocks());

  it("ajout : l'envoi lève → message d'échec, modale refermée", async () => {
    rendre({ onAddFile: LEVE });
    const input = screen.getByTestId("media-gallery-add").querySelector("input")!;
    fireEvent.change(input, { target: { files: [new File(["x"], "f.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(await screen.findByText("confirmar recorte"));
    await waitFor(() => expect(toast.danger).toHaveBeenCalledWith("No se pudo subir la foto."));
    await waitFor(() => expect(screen.queryByText("confirmar recorte")).toBeNull());
  });

  it("reclassement : le callback lève → message d'échec, galerie de nouveau utilisable", async () => {
    rendre({ onReorder: LEVE });
    fireEvent.click(screen.getAllByTestId("media-gallery-move-right")[0]!);
    await waitFor(() => expect(toast.danger).toHaveBeenCalledWith("No se pudo reordenar la galería."));
    expect(screen.getAllByTestId("media-gallery-move-right")[0]).toHaveProperty("disabled", false);
  });

  it("suppression : le callback lève → message d'échec, galerie de nouveau utilisable", async () => {
    rendre({ onDelete: LEVE });
    fireEvent.click(screen.getAllByTestId("media-gallery-delete")[0]!);
    await waitFor(() => expect(toast.danger).toHaveBeenCalledWith("No se pudo eliminar la foto."));
    expect(screen.getAllByTestId("media-gallery-delete")[0]).toHaveProperty("disabled", false);
  });
});
