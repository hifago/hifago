import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Galerie socio : retrait direct d'une photo publiée. Une suppression refusée par la RLS ne lève
// pas — elle touche 0 ligne. Ce fichier prouve qu'elle s'affiche comme un ÉCHEC, photo conservée,
// et jamais « Foto eliminada. » pour une photo restée en place.

const toast = vi.hoisted(() => ({ success: vi.fn(), danger: vi.fn(), info: vi.fn() }));
let supprimees: { id: string }[] | null = [];
let erreur: { message: string } | null = null;

vi.mock("@heroui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@heroui/react")>()),
  toast,
}));

vi.mock("@hifago/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      delete: () => ({ eq: () => ({ select: async () => ({ data: supprimees, error: erreur }) }) }),
    }),
  }),
}));

const { PhotosSocioBlock } = await import("./photos-socio-block");

function rendre() {
  render(
    <PhotosSocioBlock
      entityType="product"
      entityId="p-1"
      submitRpc="submit_photos_proposal"
      deleteTable="product_media"
      notFoundLabel="No se encontró la actividad."
      initialPhotos={[{ id: "m-1", url: "https://example.test/m-1.webp" }]}
      initialPendingPhotos={[]}
    />
  );
}

describe("PhotosSocioBlock — retrait d'une photo", () => {
  beforeEach(() => {
    toast.success.mockClear();
    toast.danger.mockClear();
    erreur = null;
  });

  it("0 ligne supprimée (refus RLS) : échec affiché, photo conservée", async () => {
    supprimees = [];
    rendre();
    fireEvent.click(screen.getByTestId("media-gallery-delete"));
    await waitFor(() => expect(toast.danger).toHaveBeenCalledWith("No se pudo eliminar la foto."));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("media-gallery-item")).toHaveLength(1);
  });

  it("erreur de la base : échec affiché sans texte technique", async () => {
    supprimees = null;
    erreur = { message: 'permission denied for table "product_media"' };
    rendre();
    fireEvent.click(screen.getByTestId("media-gallery-delete"));
    await waitFor(() => expect(toast.danger).toHaveBeenCalledWith("No se pudo eliminar la foto."));
    expect(screen.getAllByTestId("media-gallery-item")).toHaveLength(1);
  });

  it("photo réellement supprimée : succès, photo retirée", async () => {
    supprimees = [{ id: "m-1" }];
    rendre();
    fireEvent.click(screen.getByTestId("media-gallery-delete"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Foto eliminada."));
    expect(screen.queryAllByTestId("media-gallery-item")).toHaveLength(0);
  });
});
