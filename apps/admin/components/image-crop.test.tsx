import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Recadreur partagé (packages/ui, ImageCrop). Testé ici, chez son consommateur : packages/ui n'a
// pas d'exécuteur de tests. jsdom n'a ni image décodée ni canvas : ils sont simulés, et le
// recadreur de react-easy-crop remplacé par une zone déjà choisie (4000 × 3000). Ce fichier prouve
// ce que le navigateur reçoit réellement : un JPEG qualité 0,9 au côté long plafonné, et un bouton
// « Confirmar recorte » qui ne se réactive pas pendant l'envoi.

function RecadreurSimule({
  onCropComplete,
}: {
  onCropComplete: (area: unknown, pixels: { x: number; y: number; width: number; height: number }) => void;
}) {
  // Une seule fois, au montage : le vrai recadreur ne rappelle qu'après un geste, et le rappel reçu
  // est une nouvelle fonction à chaque rendu (le relancer à chaque fois bouclerait).
  useEffect(() => {
    onCropComplete({}, { x: 0, y: 0, width: 4000, height: 3000 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

vi.mock("react-easy-crop", () => ({ default: RecadreurSimule }));

type Export = { width: number; height: number; type?: string; quality?: unknown };
let exports: Export[] = [];
let toBlobRendNull = false;
const ImageOriginale = globalThis.Image;

beforeEach(() => {
  exports = [];
  toBlobRendNull = false;
  // Image « décodée » aussitôt que sa source est posée.
  globalThis.Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    crossOrigin = "";
    set src(_valeur: string) {
      queueMicrotask(() => this.onload?.());
    }
  } as unknown as typeof Image;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillStyle: "",
    fillRect: () => {},
    drawImage: () => {},
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    rappel: BlobCallback,
    type?: string,
    quality?: unknown
  ) {
    exports.push({ width: this.width, height: this.height, type, quality });
    rappel(toBlobRendNull ? null : new Blob(["x"], { type: type ?? "image/png" }));
  });
});

afterEach(() => {
  globalThis.Image = ImageOriginale;
  vi.restoreAllMocks();
});

const { ImageCrop } = await import("@hifago/ui");

function confirmer() {
  return screen.getByTestId("image-crop-confirm");
}

describe("ImageCrop", () => {
  it("exporte un JPEG qualité 0,9, côté long plafonné à 2400 px, proportions gardées", async () => {
    const onConfirm = vi.fn();
    render(<ImageCrop imageSrc="blob:source" onCancel={() => {}} onConfirm={onConfirm} />);
    await waitFor(() => expect(confirmer()).not.toHaveProperty("disabled", true));
    fireEvent.click(confirmer());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(exports).toEqual([{ width: 2400, height: 1800, type: "image/jpeg", quality: 0.9 }]);
    expect((onConfirm.mock.calls[0]![0] as Blob).type).toBe("image/jpeg");
  });

  it("« Confirmar recorte » reste inactif tant que l'envoi déclenché n'est pas fini", async () => {
    let terminerEnvoi: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((resoudre) => (terminerEnvoi = resoudre)));
    render(<ImageCrop imageSrc="blob:source" onCancel={() => {}} onConfirm={onConfirm} />);
    await waitFor(() => expect(confirmer()).not.toHaveProperty("disabled", true));

    fireEvent.click(confirmer());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    // Envoi toujours en cours : le bouton ne doit pas permettre un second envoi.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(confirmer()).toHaveProperty("disabled", true);
    fireEvent.click(confirmer());
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await act(async () => terminerEnvoi());
    await waitFor(() => expect(confirmer()).toHaveProperty("disabled", false));
  });

  it("recadrage impossible (le navigateur ne rend pas d'image) : message affiché, rien n'est envoyé", async () => {
    toBlobRendNull = true;
    const onConfirm = vi.fn();
    render(<ImageCrop imageSrc="blob:source" onCancel={() => {}} onConfirm={onConfirm} />);
    await waitFor(() => expect(confirmer()).not.toHaveProperty("disabled", true));
    fireEvent.click(confirmer());
    expect(await screen.findByTestId("image-crop-error")).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
