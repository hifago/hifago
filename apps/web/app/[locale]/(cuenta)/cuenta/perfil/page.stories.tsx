import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, mocked } from "storybook/test";
import { getMyProfile } from "@/lib/account/getMyProfile";
import { historiaDePagina } from "@/.storybook/support/pagina";
import { esperar, escribir, pulsar } from "@/.storybook/support/interacciones";
import { simularPendiente, simularRpc, simularSesion } from "@/.storybook/support/supabaseFalso";
import type { RutasSimuladas } from "@/.storybook/support/fetch";
import { PERFIL_COMPLETO, PERFIL_PROFESIONAL, PERFIL_VACIO } from "@/.storybook/support/fixtures/cuenta";
import AccountProfilePage from "./page";

// `/cuenta/perfil` : coordonnées, déconnexion, suppression du compte. La zone compte exige un vrai
// compte (le layout redirige sinon) : chaque story pose donc `simularSesion("cuenta")`.
const meta = { title: "Écrans/Mon profil", id: "ecrans-mon-profil" } satisfies Meta;
export default meta;

const pagina = (
  opciones: { perfil?: typeof PERFIL_COMPLETO; preparar?: () => void; simularFetch?: RutasSimuladas } = {}
): StoryObj => {
  const historia = historiaDePagina({
    Page: AccountProfilePage,
    grupo: "cuenta",
    ruta: "/cuenta/perfil",
    preparar: () => {
      simularSesion("cuenta");
      if (opciones.perfil) mocked(getMyProfile).mockResolvedValue(opciones.perfil);
      opciones.preparar?.();
    },
  });
  return opciones.simularFetch
    ? { ...historia, parameters: { ...historia.parameters, simularFetch: opciones.simularFetch } }
    : historia;
};

async function modificarNombre(raiz: HTMLElement) {
  await escribir(raiz, '[data-testid="profile-full-name-input"]', "Laura Restrepo Gómez");
}

async function abrirSupresion(raiz: HTMLElement, email = PERFIL_COMPLETO.email) {
  await pulsar(raiz, '[data-testid="delete-account-button"]');
  await escribir(raiz, '[data-testid="delete-account-email-input"]', email);
  await pulsar(raiz, '[data-testid="delete-account-confirm-yes"]');
}

export const PerfilCompleto: StoryObj = { ...pagina(), name: "Profil rempli" };

export const PerfilVacio: StoryObj = { ...pagina({ perfil: PERFIL_VACIO }), name: "Profil vide" };

export const Modificado: StoryObj = {
  ...pagina(),
  name: "Modifié (Enregistrer actif)",
  play: async ({ canvasElement }) => {
    await modificarNombre(canvasElement);
    await expect(await esperar(canvasElement, '[data-testid="profile-save-button"]')).toBeEnabled();
  },
};

export const Guardando: StoryObj = {
  ...pagina({ preparar: () => simularPendiente("rpc:update_my_account_profile") }),
  name: "Enregistrement en cours",
  play: async ({ canvasElement }) => {
    await modificarNombre(canvasElement);
    await pulsar(canvasElement, '[data-testid="profile-save-button"]');
  },
};

export const Guardado: StoryObj = {
  ...pagina(),
  name: "Profil enregistré",
  play: async ({ canvasElement }) => {
    await modificarNombre(canvasElement);
    await pulsar(canvasElement, '[data-testid="profile-save-button"]');
    await expect(await esperar(canvasElement, '[data-testid="profile-save-success"]')).toBeVisible();
  },
};

export const ErrorAlGuardar: StoryObj = {
  ...pagina({
    preparar: () =>
      simularRpc("update_my_account_profile", { data: null, error: { code: "22023", message: "El nombre es obligatorio" } }),
  }),
  name: "Erreur à l'enregistrement",
  play: async ({ canvasElement }) => {
    await modificarNombre(canvasElement);
    await pulsar(canvasElement, '[data-testid="profile-save-button"]');
    await expect(await esperar(canvasElement, '[data-testid="profile-save-error"]')).toBeVisible();
  },
};

export const CuentaProfesional: StoryObj = {
  ...pagina({ perfil: PERFIL_PROFESIONAL }),
  name: "Compte professionnel (suppression bloquée)",
};

export const SupresionConfirmacion: StoryObj = {
  ...pagina(),
  name: "Suppression : confirmation",
  play: async ({ canvasElement }) => {
    await pulsar(canvasElement, '[data-testid="delete-account-button"]');
    await expect(await esperar(canvasElement, '[data-testid="delete-account-confirm"]')).toBeVisible();
  },
};

export const SupresionEmailDistinto: StoryObj = {
  ...pagina(),
  name: "Suppression : e-mail différent",
  play: async ({ canvasElement }) => {
    await abrirSupresion(canvasElement, "otra@ejemplo.co");
    await expect(await esperar(canvasElement, '[data-testid="delete-account-mismatch"]')).toBeVisible();
  },
};

export const SupresionEnCurso: StoryObj = {
  ...pagina({ simularFetch: { "/api/account/delete": { demora: "nunca" } } }),
  name: "Suppression en cours",
  play: async ({ canvasElement }) => {
    await abrirSupresion(canvasElement);
    await expect(await esperar(canvasElement, '[data-testid="delete-account-confirm-no"]')).toBeDisabled();
  },
};

export const SupresionFallida: StoryObj = {
  ...pagina({ simularFetch: { "/api/account/delete": { status: 500, body: { ok: false, reason: "rpc_failed" } } } }),
  name: "Suppression échouée",
  play: async ({ canvasElement }) => {
    await abrirSupresion(canvasElement);
    await expect(await esperar(canvasElement, '[data-testid="delete-account-error"]')).toBeVisible();
  },
};

// Panne réseau : `fetch` REJETTE au lieu de répondre (la route simulée lève). L'erreur s'affiche et
// la main est rendue — avant le correctif, le bouton restait figé « en cours » et « No » désactivé.
export const SupresionError: StoryObj = {
  ...pagina({
    simularFetch: {
      "/api/account/delete": () => {
        throw new TypeError("Failed to fetch");
      },
    },
  }),
  name: "Suppression : panne réseau",
  play: async ({ canvasElement }) => {
    await abrirSupresion(canvasElement);
    await expect(await esperar(canvasElement, '[data-testid="delete-account-error"]')).toBeVisible();
    await expect(await esperar(canvasElement, '[data-testid="delete-account-confirm-no"]')).toBeEnabled();
  },
};
