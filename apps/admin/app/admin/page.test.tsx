// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentListProps } from "./RecentList";
import type { JobsStatusProps } from "./JobsStatus";

// Accueil admin, bloc « Clientes recientes ». Ce fichier prouve qu'il affiche les clients qui ont
// commandé le plus récemment (list_clients, la même notion de client que /admin/clients) au lieu
// d'une liste vide figée, avec un lien encodé vers leur fiche, et qu'une panne de la lecture lève
// comme les autres agrégats de l'accueil.

type Reponse = { data: unknown; error: { message: string } | null };

let rpcs: Record<string, Reponse> = {};
// Lecture de table en panne, désignée par sa table et ses valeurs de filtre (`products:true`,
// `product_proposals:rejected`…) : trois lectures portent sur product_proposals, deux sur products.
let tablesEnPanne = new Set<string>();
const appelsRpc: { nom: string; args: unknown }[] = [];
const listes: RecentListProps[] = [];
const procesos: JobsStatusProps[] = [];

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => {
    const lecture = (table: string) => {
      const valeurs: string[] = [];
      const requete = {
        select: () => requete,
        eq: (_colonne: string, valeur: unknown) => (valeurs.push(String(valeur)), requete),
        in: () => requete,
        order: () => requete,
        limit: () => requete,
        then: (resoudre: (r: unknown) => unknown) => {
          const cle = [table, ...valeurs].join(":");
          return resoudre(
            tablesEnPanne.has(cle)
              ? { data: null, count: null, error: { message: "connection refused" } }
              : { data: [], count: 0, error: null }
          );
        },
      };
      return requete;
    };
    return {
      rpc: async (nom: string, args: unknown) => {
        appelsRpc.push({ nom, args });
        return rpcs[nom] ?? { data: [], error: null };
      },
      from: (table: string) => lecture(table),
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
vi.mock("./JobsStatus", () => ({
  JobsStatus: (props: JobsStatusProps) => {
    procesos.push(props);
    return null;
  },
}));

const { default: AdminHomePage } = await import("./page");
const { renderToStaticMarkup } = await import("react-dom/server");

async function rendre() {
  listes.length = 0;
  procesos.length = 0;
  // Rendu réel de l'arbre : les composants simulés enregistrent les props qu'ils reçoivent.
  renderToStaticMarkup(await AdminHomePage({ searchParams: Promise.resolve({}) } as never));
  return listes.find((liste) => liste.title === "Clientes recientes");
}

describe("/admin — Clientes recientes", () => {
  beforeEach(() => {
    rpcs = {};
    appelsRpc.length = 0;
    tablesEnPanne = new Set();
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

// Les compteurs et listes de l'accueil (alertes « Pendientes », santé du catalogue, établissements
// actifs, listes récentes) étaient lus sans leur `error` : une panne s'affichait « 0 propuestas »,
// « nada que conciliar », un catalogue vide. Chacune lève désormais, comme les agrégats.
describe("/admin — chaque compteur et liste de l'accueil lève sur une panne", () => {
  beforeEach(() => {
    rpcs = {};
    tablesEnPanne = new Set();
  });

  it.each([
    ["establishments:active"],
    ["product_proposals:pending"],
    ["establishment_proposals:pending"],
    ["pms_reconciliation_entries"],
    ["payment_reconciliation_entries"],
    ["partners"],
    ["establishments"],
    ["products:true"],
    ["products:false"],
    ["product_proposals:rejected"],
  ])("lecture %s en panne : la page lève, jamais un zéro ou une liste vide", async (cle) => {
    tablesEnPanne.add(cle);
    await expect(rendre()).rejects.toThrow(/Lecture impossible/);
  });

  it.each([
    ["admin_dashboard_totals"],
    ["admin_dashboard_referrer_commissions"],
    ["admin_dashboard_daily_series"],
    ["admin_dashboard_top_partners"],
  ])("agrégat %s en panne : la page lève, jamais un KPI à zéro", async (rpc) => {
    rpcs[rpc] = { data: null, error: { message: "connection refused" } };
    await expect(rendre()).rejects.toThrow(rpc);
  });
});

// Bloc « Procesos » : la SEULE lecture de l'accueil qui ne lève pas (décision du 2026-10-04). Sa
// panne s'affiche dans le bloc, et le reste de l'accueil reste utilisable.
describe("/admin — bloc « Procesos »", () => {
  beforeEach(() => {
    rpcs = {};
    appelsRpc.length = 0;
    tablesEnPanne = new Set();
  });

  it("passe l'état des jobs lu en base, colonnes nullables relues comme telles", async () => {
    rpcs.admin_jobs_status = {
      data: [
        {
          job_name: "payments-reconcile",
          stale_after_minutes: 15,
          last_run_at: "2026-10-06T19:58:00Z",
          last_ok_at: "2026-10-06T19:58:00Z",
          last_error: null,
          alerted_at: null,
          state: "ok",
          alert_active: false,
          checked_at: "2026-10-06T20:00:00Z",
        },
        {
          job_name: "pms-nightly-contract-check",
          stale_after_minutes: 2160,
          last_run_at: null,
          last_ok_at: null,
          last_error: null,
          alerted_at: null,
          state: "never",
          alert_active: false,
          checked_at: "2026-10-06T20:00:00Z",
        },
      ],
      error: null,
    };
    await rendre();
    expect(appelsRpc.some((a) => a.nom === "admin_jobs_status")).toBe(true);
    expect(procesos).toEqual([
      {
        jobs: [
          {
            jobName: "payments-reconcile",
            staleAfterMinutes: 15,
            lastOkAt: "2026-10-06T19:58:00Z",
            lastError: null,
            alertedAt: null,
            state: "ok",
            alertActive: false,
          },
          {
            jobName: "pms-nightly-contract-check",
            staleAfterMinutes: 2160,
            lastOkAt: null,
            lastError: null,
            alertedAt: null,
            state: "never",
            alertActive: false,
          },
        ],
        checkedAt: "2026-10-06T20:00:00Z",
      },
    ]);
  });

  it("panne de admin_jobs_status : l'accueil s'affiche, le bloc dit « no disponible »", async () => {
    rpcs.admin_jobs_status = { data: null, error: { message: "permission denied" } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(rendre()).resolves.toBeDefined();
    expect(procesos).toEqual([{ unavailable: true }]);
    vi.restoreAllMocks();
  });
});
