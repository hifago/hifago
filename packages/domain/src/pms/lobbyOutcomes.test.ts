import { describe, expect, it } from "vitest";
import { describeUnexpectedLobbyBooking, isLobbyBookingGone, isLobbyCancelAlreadyDone } from "./lobbyOutcomes";

// Corpus de réponses RÉELLES de LobbyPMS et de son relais, telles que `lobbyCall` les rend (un corps
// non-JSON devient `{ raw }`). Source de chacune en commentaire ; aucune n'est inventée — quand le
// corps n'a jamais été consigné, le cas le dit et ne teste que ce que l'on sait (le statut).
const CORPUS: Record<string, { status: number; body: unknown }> = {
  // GET d'un booking annulé par API — lobby_pms_api.md (legacy) et pmsFixtureServer.
  laravel404: { status: 404, body: { message: "No query results for model [App\\Models\\Booking]." } },
  // 404 de ROUTAGE de Lobby (URI inconnue, requête altérée par le relais) — journal 2026-09, 19/09.
  routage404: { status: 404, body: { error: "Resource Not Found." } },
  // 403 du relais Caddy sans en-tête X-Relay-Secret, corps texte « forbidden » — journal 2026-08.
  caddy403: { status: 403, body: { raw: "forbidden" } },
  // 403 de Lobby pour une IP non autorisée — journal 2026-08 (« GET /rooms forme inattendue
  // (status 403) ») ; son message est consigné en texte (journal 2026-09 : « … is not set as a valid
  // ip »), pas son enveloppe JSON exacte : seul le statut sert ici, sans recopier l'adresse.
  ip403: { status: 403, body: null },
  // Jeton refusé — journal 2026-08 et 2026-09.
  jeton401: { status: 401, body: { error: "Unauthenticated." } },
  // Annulation d'un booking déjà annulé — journal 2026-08 (booking 21635340) : le CODE est observé ;
  // le statut (422) et l'enveloppe sont INFÉRÉS de la forme des 422 observés (INPUT_PARAMETERS) —
  // d'où un prédicat qui décide sur le code, sous 422 ou 404 (cas suivant).
  dejaAnnule422: { status: 422, body: { error_code: "RECORD_NOT_FOUND" } },
  // Un 422 qui signale NOTRE erreur, jamais un succès — journal 2026-08.
  parametres422: { status: 422, body: { error_code: "INPUT_PARAMETERS", error: "The selected cancellation reason is invalid." } },
  // Annulation acceptée (le succès se lit dans le corps, pas dans le statut) — journal 2026-08.
  annulation201: { status: 201, body: { cancel_booking: 3437404 } },
};

describe("isLobbyBookingGone", () => {
  it("seul le 404 Laravel du modèle Booking prouve qu'un booking n'existe plus", () => {
    const gone = Object.entries(CORPUS)
      .filter(([, r]) => isLobbyBookingGone(r.status, r.body))
      .map(([name]) => name);
    expect(gone).toEqual(["laravel404"]);
  });

  it.each([
    ["un 404 HTML d'un proxy", 404, { raw: "<html><body>404 Not Found</body></html>" }],
    ["un 404 Laravel d'un AUTRE modèle", 404, { message: "No query results for model [App\\Models\\Room]." }],
    ["un 404 sans corps", 404, null],
    ["le corps Laravel avec un autre statut", 200, { message: "No query results for model [App\\Models\\Booking]." }],
    ["un 500", 500, { message: "Server Error" }],
  ])("%s ne prouve rien (passager)", (_cas, status, body) => {
    expect(isLobbyBookingGone(status, body)).toBe(false);
  });
});

describe("isLobbyCancelAlreadyDone", () => {
  it("seul le code RECORD_NOT_FOUND prouve qu'un booking était déjà annulé", () => {
    const done = Object.entries(CORPUS)
      .filter(([, r]) => isLobbyCancelAlreadyDone(r.status, r.body))
      .map(([name]) => name);
    expect(done).toEqual(["dejaAnnule422"]);
  });

  it("RECORD_NOT_FOUND sous un 404 compte aussi (le statut n'a jamais été consigné)", () => {
    expect(isLobbyCancelAlreadyDone(404, { error_code: "RECORD_NOT_FOUND" })).toBe(true);
  });

  it("un 404 sans ce code n'est jamais « déjà annulé » — ni Laravel, ni de routage", () => {
    expect(isLobbyCancelAlreadyDone(404, CORPUS.laravel404.body)).toBe(false);
    expect(isLobbyCancelAlreadyDone(404, CORPUS.routage404.body)).toBe(false);
  });

  it("RECORD_NOT_FOUND sous un autre statut ne compte pas", () => {
    expect(isLobbyCancelAlreadyDone(200, { error_code: "RECORD_NOT_FOUND" })).toBe(false);
    expect(isLobbyCancelAlreadyDone(500, { error_code: "RECORD_NOT_FOUND" })).toBe(false);
  });
});

describe("describeUnexpectedLobbyBooking", () => {
  it("rien à signaler pour un booking confirmé ou terminé, actif", () => {
    expect(describeUnexpectedLobbyBooking({ estatus: "completo", deleted_at: null })).toBeNull();
    expect(describeUnexpectedLobbyBooking({ estatus: "fin", deleted_at: null })).toBeNull();
    expect(describeUnexpectedLobbyBooking({})).toBeNull();
  });

  it("signale un booking supprimé logiquement mais encore rendu, ou un estatus jamais observé", () => {
    expect(describeUnexpectedLobbyBooking({ estatus: "completo", deleted_at: "2026-10-01 10:00:00" })).toBe("deleted_at posé");
    expect(describeUnexpectedLobbyBooking({ estatus: "cancelado", deleted_at: null })).toBe("estatus « cancelado »");
    expect(describeUnexpectedLobbyBooking({ estatus: "x<script>", deleted_at: "d" })).toBe("deleted_at posé, estatus « xscript »");
  });
});
