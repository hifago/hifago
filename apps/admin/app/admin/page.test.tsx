// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentListProps } from "./RecentList";

// Accueil admin, bloc « Clientes recientes ». Ce fichier prouve qu'il affiche les clients qui ont
// commandé le plus récemment (list_clients, la même notion de client que /admin/clients) au lieu
// d'une liste vide figée, avec un lien encodé vers leur fiche, et qu'une panne de la lecture lève
// comme les autres agrégats de l'accueil.

type Reponse = { data: unknown; error: { message: string } | null };

let rpcs: Record<string, Reponse> = {};
const appelsRpc: { nom: string; args: unknown }[] = [];
const listes: RecentListProps[] = [];

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => {
    const requete = {
      select: () => requete,
      eq: () => requete,
      in: () => requete,
      order: () => requete,
      limit: () => requete,
      then: (resoudre: (r: unknown) => unknown) => resoudre({ data: [], count: 0, error: null }),
    };
    return {
      rpc: async (nom: string, args: unknown) => {
        appelsRpc.push({ nom, args });
        return rpcs[nom] ?? { data: [], error: null };
      },
      from: () => requete,
    };
  },
}));

vi.mock("./RecentList", () => ({
  RecentList: (props: RecentListProps) => {
    listes.push(props);
    return null;
  },
}));
vi.mock("./charts/SalesChart", () => ({ SalesChart: () => null }));
vi.mock("./charts/CommissionsChart", () => ({ CommissionsChart: () => null }));
vi.mock("./charts/TopPartnersChart", () => ({ TopPartnersChart: () => null }));
vi.mock("./charts/CatalogHealthChart", () => ({ CatalogHealthChart: () => null }));
vi.mock("./AdminAlerts", () => ({ AdminAlerts: () => null }));

const { default: AdminHomePage } = await import("./page");
const { renderToStaticMarkup } = await import("react-dom/server");

async function rendre() {
  listes.length = 0;
  // Rendu réel de l'arbre : les composants simulés enregistrent les props qu'ils reçoivent.
  renderToStaticMarkup(await AdminHomePage({ searchParams: Promise.resolve({}) } as never));
  return listes.find((liste) => liste.title === "Clientes recientes");
}

describe("/admin — Clientes recientes", () => {
  beforeEach(() => {
    rpcs = {};
    appelsRpc.length = 0;
  });

  it("lit les 5 clients ayant commandé le plus récemment", async () => {
    await rendre();
    expect(appelsRpc.find((a) => a.nom === "list_clients")?.args).toEqual({
      p_sort_key: "last_order_at",
      p_sort_desc: true,
      p_limit: 5,
    });
  });

  it("affiche chaque client avec un lien encodé vers sa fiche", async () => {
    rpcs.list_clients = {
      data: [
        { client_key: "ana@example.test", display_name: "Ana", email: "ana@example.test" },
        { client_key: "+57 300 111", display_name: null, email: null },
      ],
      error: null,
    };
    const liste = await rendre();
    expect(liste?.items).toEqual([
      {
        id: "ana@example.test",
        label: "Ana",
        sublabel: "ana@example.test",
        href: "/admin/clients/ana%40example.test",
      },
      { id: "+57 300 111", label: "+57 300 111", sublabel: null, href: "/admin/clients/%2B57%20300%20111" },
    ]);
  });

  it("panne de list_clients : la page lève, jamais une liste vide", async () => {
    rpcs.list_clients = { data: null, error: { message: "connection refused" } };
    await expect(rendre()).rejects.toThrow(/list_clients/);
  });
});
