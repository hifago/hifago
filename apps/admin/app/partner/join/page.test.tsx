// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// La page lit l'adresse de l'invitation (check_partner_invitation → invited_email) pour verrouiller
// le champ. Panne, refus ou base sans le champ : champ libre, comme avant (la base refuse de toute
// façon un autre e-mail à la consommation). Seul le motif connu est relayé depuis l'URL.

type Props = { token: string | null; invitedEmail: string | null; initialError: string | null };
const recues: Props[] = [];
let reponseCheck: { data: unknown; error: { message: string } | null } = { data: { ok: true }, error: null };
const appels: unknown[] = [];

vi.mock("@hifago/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    rpc: async (nom: string, args: unknown) => {
      appels.push({ nom, args });
      return reponseCheck;
    },
  }),
}));
vi.mock("./JoinForm", () => ({
  JoinForm: (props: Props) => {
    recues.push(props);
    return null;
  },
}));
vi.mock("@/components/logo-hifago", () => ({ LogoHifago: () => null }));

const { default: PartnerJoinPage } = await import("./page");
const { renderToStaticMarkup } = await import("react-dom/server");

async function rendre(searchParams: Record<string, string>) {
  recues.length = 0;
  renderToStaticMarkup(await PartnerJoinPage({ searchParams: Promise.resolve(searchParams) } as never));
  return recues[0];
}

describe("/partner/join — adresse de l'invitation", () => {
  beforeEach(() => {
    reponseCheck = { data: { ok: true }, error: null };
    appels.length = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  it("invitation envoyée par e-mail : l'adresse est passée au formulaire", async () => {
    reponseCheck = { data: { ok: true, invited_email: "socio@ejemplo.co" }, error: null };
    expect((await rendre({ token: "T" })).invitedEmail).toBe("socio@ejemplo.co");
    expect(appels).toEqual([{ nom: "check_partner_invitation", args: { p_token: "T" } }]);
  });

  it.each([
    ["simple lien (null)", { data: { ok: true, invited_email: null }, error: null }],
    ["base sans le champ", { data: { ok: true }, error: null }],
    ["invitation refusée", { data: { ok: false, reason: "expired" }, error: null }],
  ])("%s : champ libre", async (_cas, check) => {
    reponseCheck = check;
    expect((await rendre({ token: "T" })).invitedEmail).toBeNull();
  });

  it("panne de la lecture : champ libre, et la panne est journalisée", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    reponseCheck = { data: null, error: { message: "connection refused" } };
    expect((await rendre({ token: "T" })).invitedEmail).toBeNull();
    expect(journal).toHaveBeenCalled();
  });

  it("sans jeton : aucune lecture", async () => {
    expect((await rendre({})).invitedEmail).toBeNull();
    expect(appels).toEqual([]);
  });

  it("seul le motif email_mismatch est relayé depuis l'URL", async () => {
    expect((await rendre({ token: "T", error: "email_mismatch" })).initialError).toBe("email_mismatch");
    expect((await rendre({ token: "T", error: "<script>" })).initialError).toBeNull();
  });
});
