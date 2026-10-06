// Spec 21 — Connecteur LobbyPMS, Phase 6. Job nocturne SÉPARÉ, non bloquant, LECTURE SEULE
// uniquement (jamais un POST/PUT/DELETE) — détecte une dérive de la forme des réponses LobbyPMS
// par rapport à ce que le connecteur suppose (docs/3-integrations/lobby_pms_api.md, racine du
// dépôt), avant que ça ne casse silencieusement une vraie réservation.
//
// Correction factuelle par rapport à l'architecture cible initiale (hifago/docs/04-architecture-
// cible.md § Tests et CI/CD, qui évoquait « le vrai sandbox LobbyPMS ») : AUCUN sandbox LobbyPMS
// n'existe (confirmé, spec 21 §10 point 1) — ce job frappe donc le(s) compte(s) réel(s) des
// établissements dont le connecteur est actif (Casa Kayam aujourd'hui, seul cas réel), jamais un
// environnement de test dédié. Décision explicite de Jérôme (spec 21) : lecture seule stricte,
// jamais en CI/en test (aucun test automatisé de ce fichier ne doit jamais l'invoquer contre le
// vrai baseUrl — seulement contre un serveur de fixtures via LOBBY_API_BASE_URL).
//
// Depuis P6 (2026-10) : squelette commun des jobs (_shared/job.ts — contrôle d'appelant, budget de
// temps, heartbeat à chaque passage) ; aucun secret dans ce qui sort — un message d'erreur de
// `fetch` porte l'URL, donc `api_token` : tout texte d'erreur passe par `ctx.redact`/`ctx.describe`.
import { type JobContext, type JobOutcome, serveJob } from "../_shared/job.ts";
import {
  getLobbyAvailableRooms,
  getLobbyNightAvailability,
  getLobbyRooms,
  LOBBY_DEFAULT_BASE_URL,
} from "../../../packages/domain/src/pms/lobbyClient.ts";
import { parseLobbyRooms } from "../../../packages/domain/src/pms/parseLobbyRooms.ts";
import { parseLobbyAvailabilityContract } from "../../../packages/domain/src/pms/parseLobbyAvailabilityContract.ts";
// Promue dans le domaine le 2026-08-28 : le chemin de réservation en avait besoin lui aussi, et
// deux copies de la même prudence auraient divergé.
import { describeLobbyErrorBody } from "../../../packages/domain/src/pms/describeLobbyErrorBody.ts";

interface EstablishmentRow {
  id: string;
  lobby_api_token: string | null;
}

function hasExpectedRoomsShape(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const data = (body as { data?: unknown }).data;
  return Array.isArray(data);
}

// Étendu le 2026-08-26. Vérifier que `data` est un tableau ne suffit plus : depuis que l'écran de
// liaison affiche et prérremplit le contenu Lobby (type/capacity/descriptions[]/photos[]), la
// disparition SILENCIEUSE d'un de ces champs ne casserait rien — les parseurs sont défensifs, ils
// omettent proprement — mais viderait l'écran sans que personne ne le sache. C'est exactement le
// genre de dérive que ce job existe pour attraper. Les formes ONT depuis été observées en
// conditions réelles (2026-08-26, compte Casa Kayam — spec 24 §11.1 : 6/6 catégories portent
// type/capacity/quantity, 4/6 portent descriptions[]/photos[]) : ce job ne surveille donc plus une
// hypothèse tirée de la doc, mais un contrat constaté. Raison de plus pour qu'il tourne — sa
// vigilance porte désormais sur une régression réelle, pas sur une supposition.
//
// Aucune de ces absences n'est une panne : ce sont des signalements. Un compte peut légitimement
// n'avoir aucune photo. Le but est de distinguer « Lobby ne renvoie plus ce champ » de « le champ
// est vide chez ce client », en le disant plutôt qu'en l'ignorant.
function describeRoomsFieldCoverage(body: unknown): string[] {
  const categories = parseLobbyRooms(body);
  if (categories.length === 0) return ["aucune catégorie exploitable dans GET /rooms"];

  const notes: string[] = [];
  // Compte `rawType`, pas `kind` : c'est la PRÉSENCE du champ Lobby qu'on surveille, pas notre
  // capacité à le normaliser. Renommé le 2026-08-26 — il s'appelait withKind et mesurait rawType.
  const withRawType = categories.filter((c) => c.rawType !== null).length;
  const withCapacity = categories.filter((c) => c.capacity !== null).length;
  const withDescription = categories.filter((c) => Object.keys(c.descriptions).length > 0).length;
  const withPhotos = categories.filter((c) => c.photos.length > 0).length;

  if (withRawType === 0) notes.push("aucune catégorie ne porte `type`");
  if (withCapacity === 0) notes.push("aucune catégorie ne porte `capacity`");
  if (withDescription === 0) notes.push("aucune catégorie ne porte `descriptions[]`");
  if (withPhotos === 0) notes.push("aucune catégorie ne porte `photos[]`");

  // Une langue que l'éditeur hifago ne sait pas afficher (fermé à es/en) : la signaler, sinon la
  // description existe chez Lobby et n'arrive jamais nulle part sans explication.
  const unsupported = [...new Set(categories.flatMap((c) => c.unsupportedLangs))].sort();
  if (unsupported.length > 0) notes.push(`descriptions dans des langues non éditables : ${unsupported.join(", ")}`);

  return notes;
}

// Sonde de contrat sur GET /api/v2/available-rooms (2026-08-27). Ce job était déjà le bon endroit :
// il tourne en préprod, il tient le jeton par la BASE (jamais par une variable d'environnement, et
// jamais dans un poste de dev), et sa raison d'être est de dire ce que Lobby renvoie. Deux points
// du plan attendaient une observation que personne ne pouvait faire depuis un poste de dev :
//
//   C1 — quel attribut sépare une catégorie réservable par API d'une qui refuse en 422 ? Si Lobby
//        n'énumère ici QUE les réservables, la réponse EST le filtre, et on n'a jamais à coder un
//        identifiant en dur. Sinon, les signatures de champs ci-dessous sont le seul autre angle.
//   C5 — les valeurs réelles de restrictions{min_stay, max_stay, lead_days}, jamais observées.
//
// Les rendre visibles ICI plutôt que par une sonde jetable a un effet durable : la réponse arrive
// sans intervention humaine, et reste SURVEILLÉE ensuite. Une sonde manuelle aurait répondu une
// fois puis serait devenue une capture périmée dans un document.
//
// Ces lignes vont dans `observations`, JAMAIS dans `drifts` : une dérive dit « quelque chose a
// cassé », une observation dit « voici la tête du contrat aujourd'hui ». Les confondre ferait crier
// au loup ce job à chaque nuit, et la prochaine vraie dérive passerait inaperçue.
function describeAvailabilityContract(body: unknown, knownCategoryIds: number[]): string[] {
  const contract = parseLobbyAvailabilityContract(body);
  if (!contract.ok) return ["GET /available-rooms : corps inexploitable (aucun `categories[]`)"];

  const notes: string[] = [];
  const listed = new Set(contract.categoryIds);
  const absent = knownCategoryIds.filter((id) => !listed.has(id));
  const extra = contract.categoryIds.filter((id) => !knownCategoryIds.includes(id));

  notes.push(
    `available-rooms cote ${contract.categoryIds.length}/${knownCategoryIds.length} catégories : ${contract.categoryIds.join(", ")}`
  );
  // Disponibilité par catégorie : dernier angle pour C1. Une catégorie que Lobby cote mais qui
  // n'a JAMAIS de disponibilité serait un discriminant plausible — à distinguer d'un simple
  // « complet cette nuit-là », ce que seule une observation répétée peut faire. D'où sa place ici,
  // dans un job qui repasse chaque nuit, plutôt que dans une sonde unique.
  notes.push(
    `available_rooms : ${contract.categories.map((c) => `${c.categoryId}=${c.availableRooms}`).join(", ")}`
  );
  if (absent.length > 0) {
    notes.push(`absentes d'available-rooms (candidat C1 — non réservables par API ?) : ${absent.join(", ")}`);
  }
  if (extra.length > 0) {
    notes.push(`cotées ici mais absentes de GET /rooms : ${extra.join(", ")}`);
  }

  notes.push(
    `plans/prix : ${contract.categories.map((c) => `${c.categoryId}=${c.planCount}p/${c.priceCount}€`).join(", ")}`
  );

  const withRestrictions = contract.categories.filter((c) => c.restrictions !== null);
  if (withRestrictions.length === 0) {
    notes.push("aucune catégorie ne porte `restrictions` — C5 reste sans valeur observée");
  } else {
    for (const category of withRestrictions) {
      notes.push(`restrictions[${category.categoryId}] = ${JSON.stringify(category.restrictions)}`);
    }
  }

  // Deux familles de catégories, si elles existent, se voient comme deux signatures distinctes.
  const signatures = new Map<string, number[]>();
  for (const category of contract.categories) {
    const key = category.keys.join(",");
    signatures.set(key, [...(signatures.get(key) ?? []), category.categoryId]);
  }
  for (const [keys, ids] of signatures) {
    notes.push(`signature [${keys}] → catégories ${ids.join(", ")}`);
  }

  return notes;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SONDES OPT-IN — 2026-08-28
//
// POURQUOI ICI, et pas dans un script jetable. Ce job est le seul endroit du projet qui réunit les
// trois conditions nécessaires : il tourne en préprod (donc il PEUT joindre LobbyPMS, ce qu'un
// poste de dev ne peut pas), il lit le jeton EN BASE (aucun secret manipulé à la main, aucune
// variable d'environnement à poser), et sa raison d'être est déjà de dire ce que Lobby renvoie.
//
// OPT-IN PAR LE CORPS DE LA REQUÊTE, et c'est ce qui rend l'ajout sans risque : pg_cron poste `{}`,
// donc le comportement nominal du job est INCHANGÉ, à l'appel près. Les sondes ne partent que si
// quelqu'un les demande explicitement, depuis le SQL Editor via net.http_post.
//
// ⚠️ BUDGET D'APPELS. Le plafond mesuré est de 60 appels par fenêtre glissante d'une minute
// (Retry-After décompté 55/54/53/52 en préprod le 2026-08-28 — signature d'un `throttle:60,1`
// Laravel), et son mode d'échec est MUET : une fenêtre vide ne dit pas si Lobby a refusé ou si le
// quota est épuisé. Les sondes sont donc espacées, et le nombre d'appels réellement émis est
// RENDU dans la réponse — on ne devine jamais ce qu'on a consommé.
const PROBE_SPACING_MS = 1500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Une sonde que le budget du passage ne laisse plus lancer : sautée, jamais lancée sans délai. */
class ProbeBudgetExceeded extends Error {
  constructor() {
    super("budget du passage épuisé");
    this.name = "ProbeBudgetExceeded";
  }
}

const probeFailure = (err: unknown, describe: (err: unknown) => string) =>
  err instanceof ProbeBudgetExceeded ? "sautée (budget du passage épuisé)" : `injoignable (${describe(err)})`;

/** Fisher-Yates sur une copie. */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

type ProbeName = "range" | "category_filter";
const KNOWN_PROBES: ProbeName[] = ["range", "category_filter"];

// Lit la demande de sondes SANS jamais lever : un corps absent, vide, non-JSON ou inattendu vaut
// « pas de sonde ». C'est ce qui garantit que le cron, qui poste `{}`, ne peut pas déclencher un
// appel supplémentaire vers Lobby par accident.
async function readRequestedProbes(req: Request): Promise<ProbeName[]> {
  if (req.method !== "POST") return [];
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const requested = (parsed as { probes?: unknown }).probes;
  if (!Array.isArray(requested)) return [];
  return KNOWN_PROBES.filter((name) => requested.includes(name));
}

// Décrit la FORME d'une réponse de plage sans jamais rendre le corps entier (il peut être gros) et
// sans jamais rendre l'URL, qui porte `api_token` (CLAUDE.md §8).
function describeRangeShape(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return ["corps non-objet"];
  const record = body as Record<string, unknown>;
  const notes = [`clés racine : ${Object.keys(record).sort().join(", ")}`];

  const dataArray = Array.isArray(record.data) ? record.data : null;
  if (dataArray === null) {
    notes.push("pas de `data[]` — forme MONO-NUIT, donc la plage n'est PAS honorée");
    notes.push(`date rendue : ${typeof record.date === "string" ? record.date : "(absente)"}`);
    const categories = Array.isArray(record.categories) ? record.categories : [];
    notes.push(`categories[] : ${categories.length} entrée(s)`);
    return notes;
  }

  const dates = dataArray.map((entry) => {
    const nested = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    return typeof nested.date === "string" ? nested.date : "(sans date)";
  });
  notes.push(`\`data[]\` : ${dataArray.length} enregistrement(s)`);
  notes.push(`dates rendues : ${dates.join(", ")}`);
  const first = typeof dataArray[0] === "object" && dataArray[0] !== null
    ? Object.keys(dataArray[0] as Record<string, unknown>).sort().join(", ")
    : "(non-objet)";
  notes.push(`clés d'un enregistrement : ${first}`);
  if (record.meta !== undefined) notes.push(`meta : ${JSON.stringify(record.meta)}`);
  return notes;
}

// Combien d'unités Lobby cote pour UNE catégorie dans un corps `available-rooms`, ou null si la
// catégorie n'y figure pas. Volontairement local à la sonde : c'est une lecture d'observation, pas
// le parseur du chemin de réservation.
function availableForCategory(body: unknown, categoryId: number): number | null {
  const contract = parseLobbyAvailabilityContract(body);
  if (!contract.ok) return null;
  const found = contract.categories.find((category) => category.categoryId === categoryId);
  return found ? found.availableRooms : null;
}

// Nuit sondée : J+30. Assez loin pour qu'un `lead_days` ne puisse pas masquer une catégorie (ce
// serait confondre « non réservable » avec « pas encore ouvert », exactement l'erreur que C1 doit
// éviter), assez proche pour rester dans l'horizon de réservation de n'importe quel plan tarifaire.
function probeNights(): { date: string; nextDate: string; rangeEnd: string } {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 30);
  const next = new Date(start);
  next.setUTCDate(next.getUTCDate() + 1);
  // Borne de la sonde de plage : D+5. Le chiffre est choisi pour que la RÉPONSE soit décisive —
  // 5 enregistrements = `end_date` EXCLUSIF (ce que la production suppose sans l'avoir vérifié),
  // 6 = INCLUSIF, 1 = la plage n'est pas honorée du tout. Aucune de ces trois réponses n'est
  // devinable, et se tromper décalerait toute la grille d'un jour, silencieusement.
  const rangeEnd = new Date(start);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 5);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { date: iso(start), nextDate: iso(next), rangeEnd: iso(rangeEnd) };
}

serveJob("pms-nightly-contract-check", async (ctx: JobContext): Promise<JobOutcome> => {
  const { supabase, request: req } = ctx;
  const baseUrl = Deno.env.get("LOBBY_API_BASE_URL") || LOBBY_DEFAULT_BASE_URL;
  const relaySecret = Deno.env.get("LOBBY_RELAY_SECRET");

  const { data: establishments, error } = await supabase
    .from("establishments")
    .select("id, lobby_api_token")
    .eq("lobby_connector_active", true)
    .returns<EstablishmentRow[]>();

  if (error) {
    return { ok: false, error: `lecture des établissements — ${ctx.describe(error)}`, stats: {}, status: 500 };
  }
  for (const establishment of establishments ?? []) ctx.addSecret(establishment.lobby_api_token);
  // Ordre tiré au sort à chaque nuit : si le budget s'épuise, ce ne sont jamais les mêmes
  // établissements qui restent non contrôlés.
  const toCheck = shuffled(establishments ?? []);

  const drifts: string[] = [];
  const observations: string[] = [];
  // Établissements dont GET /rooms a échoué (statut ou transport) : le passage n'est pas `ok`.
  const roomsFailures: string[] = [];
  // Établissements que le budget du passage n'a pas laissé contrôler : une dérive signalée, pas un
  // échec (le tirage au sort les met en tête une autre nuit).
  let unchecked = 0;

  // C2 (spec 25) — supervision de la file d'annulation. Une entrée définitivement 'failed' n'envoie
  // AUCUN e-mail par conception : pms_reconciliation_entries déclenche notify_all_admins sans dédup
  // (défaut C9). La supervision d'une file est un problème de COMPTAGE, et ce job nocturne est
  // l'endroit pour le faire — une seule ligne par nuit, jamais une par entrée.
  //
  // Migration 20261004005336 : un jeton REMPLACÉ fait aussi passer des annulations en échec, sans
  // aucune tentative — comptées à part, avec les bookings posés avec l'ancien jeton qui attendent
  // leur vérification manuelle (entrées de réconciliation muettes de cette classe).
  const REPLACED = "jeton Lobby remplacé%";
  const { count: failedCancellations, error: failedError } = await supabase
    .from("pms_cancellation_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed");
  const { count: replacedCancellations, error: replacedError } = await supabase
    .from("pms_cancellation_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .like("last_error", REPLACED);
  const { count: replacedBookings, error: replacedBookingsError } = await supabase
    .from("pms_reconciliation_entries")
    .select("id", { count: "exact", head: true })
    .in("status", ["open", "retrying"])
    .like("detail", REPLACED);
  // Un comptage illisible n'est jamais un zéro : le passage le dit et n'est pas `ok`.
  const countErrors = [failedError, replacedError, replacedBookingsError].filter((e) => e !== null);
  for (const countError of countErrors) {
    drifts.push(`comptage des files d'annulation et de réconciliation illisible — ${ctx.describe(countError)}`);
  }
  const failedByAttempts = (failedCancellations ?? 0) - (replacedCancellations ?? 0);
  if (failedByAttempts > 0) {
    drifts.push(`${failedByAttempts} annulation(s) LobbyPMS en échec après leurs tentatives — chambres possiblement encore bloquées`);
  }
  if ((replacedCancellations ?? 0) > 0) {
    drifts.push(`${replacedCancellations} annulation(s) d'un booking posé avec un jeton Lobby depuis remplacé — à vérifier à la main sur l'ancien compte`);
  }
  if ((replacedBookings ?? 0) > 0) {
    drifts.push(`${replacedBookings} booking(s) posé(s) avec un jeton Lobby depuis remplacé, en attente de vérification manuelle`);
  }

  const { date, nextDate, rangeEnd } = probeNights();
  // Les catégories relevées par le passage nominal, réutilisées par la sonde 2 — pour ne PAS
  // repayer un GET /rooms rien que pour connaître un identifiant de catégorie.
  const probeCategoryIds = new Map<string, number[]>();
  const requestedProbes = await readRequestedProbes(req);
  const probeNotes: string[] = [];
  // Compteur d'appels Lobby émis PAR LES SONDES. Il est rendu dans la réponse : le mode d'échec du
  // quota étant muet, savoir exactement ce qu'on a consommé est la seule façon de ne pas
  // rediagnostiquer un « horizon de calendrier » qui n'existe pas.
  let probeCalls = 0;
  // ⚠️ 20260918170000 : le chemin NOMINAL (1 GET /rooms + 1 GET /available-rooms par établissement
  // connecté) tirait ses 2N appels EN RAFALE, sans le `PROBE_SPACING_MS` déjà posé pour les sondes
  // opt-in. Sans mesure du seau (par jeton ou par IP, point ouvert), c'est le seul poste de ce
  // dossier dont le coût croît AVEC le nombre d'établissements — les trois autres crons PMS sont
  // bornés par un lot fixe (claim_pms_sync_batch, claim_pms_poll_batch, claim_pms_cancellation_batch).
  // Espacer coûte une nuit plus longue (jamais un problème, `0 7 * * *`), jamais un appel de plus.
  for (const [index, establishment] of toCheck.entries()) {
    if (index > 0) await sleep(PROBE_SPACING_MS);
    if (!establishment.lobby_api_token) continue;
    const roomsTimeout = ctx.nextCallTimeout();
    if (roomsTimeout === null) {
      unchecked = toCheck.length - index;
      drifts.push(`budget du passage épuisé : ${unchecked} établissement(s) non contrôlé(s) cette nuit`);
      break;
    }
    let knownCategoryIds: number[] = [];
    try {
      const rooms = await getLobbyRooms(baseUrl, establishment.lobby_api_token, undefined, relaySecret, roomsTimeout);
      if (rooms.status !== 200 || !hasExpectedRoomsShape(rooms.body)) {
        if (rooms.status !== 200) roomsFailures.push(establishment.id);
        drifts.push(
          ctx.redact(`établissement ${establishment.id} : GET /rooms forme inattendue (status ${rooms.status}) — ${describeLobbyErrorBody(rooms.body, ctx.redact)}`)
        );
      } else {
        knownCategoryIds = parseLobbyRooms(rooms.body).map((category) => category.categoryId);
        probeCategoryIds.set(establishment.id, knownCategoryIds);
        for (const note of describeRoomsFieldCoverage(rooms.body)) {
          drifts.push(`établissement ${establishment.id} : ${note}`);
        }
      }
    } catch (err) {
      roomsFailures.push(establishment.id);
      drifts.push(`établissement ${establishment.id} : GET /rooms injoignable (${ctx.describe(err)})`);
    }

    // UNE requête par établissement, pas une par catégorie : sans `category_id`, Lobby renvoie tout
    // le catalogue pour la nuit. Coût total du job : +1 appel par nuit et par établissement connecté.
    // Sautée si GET /rooms n'a rien donné — sans la liste de référence, « absente d'available-rooms »
    // ne voudrait rien dire.
    if (knownCategoryIds.length === 0) continue;
    const availabilityTimeout = ctx.nextCallTimeout();
    if (availabilityTimeout === null) continue;
    try {
      const availability = await getLobbyAvailableRooms(
        baseUrl, establishment.lobby_api_token, date, nextDate, relaySecret, availabilityTimeout
      );
      if (availability.status !== 200) {
        observations.push(
          ctx.redact(`établissement ${establishment.id} : GET /available-rooms (nuit ${date}) a répondu ${availability.status} — ${describeLobbyErrorBody(availability.body, ctx.redact)}`)
        );
      } else {
        for (const note of describeAvailabilityContract(availability.body, knownCategoryIds)) {
          observations.push(`établissement ${establishment.id} : ${note}`);
        }
      }
    } catch (err) {
      observations.push(`établissement ${establishment.id} : GET /available-rooms injoignable (${ctx.describe(err)})`);
    }
  }

  // Jamais bloquant (non-CI, non-test) — une alerte console est le seul effet de bord voulu ici,
  // à brancher sur une vraie supervision (ex. log drain → alerte) hors périmètre code de cette spec.
  if (drifts.length > 0) {
    console.warn("pms-nightly-contract-check : dérive de contrat détectée", drifts.map(ctx.redactLong));
  }
  // Journalisé en `info` et non en `warn` : ce n'est pas une alerte, c'est le relevé de la nuit.
  // Il laisse une trace dans les logs de la fonction même quand personne ne lit la réponse HTTP —
  // ce qui est le cas nominal, le job étant déclenché par pg_cron.
  if (observations.length > 0) {
    console.info("pms-nightly-contract-check : contrat observé", observations.map(ctx.redactLong));
  }

  // ── SONDES, après le passage nominal et seulement sur demande explicite ──────────────────────
  for (const establishment of requestedProbes.length > 0 ? toCheck : []) {
    if (!establishment.lobby_api_token) continue;

    if (requestedProbes.includes("range")) {
      // SONDE 1 — `end_date` est-il INCLUSIF ou EXCLUSIF ? C'est la première question à poser,
      // avant toute autre : le code de production suppose EXCLUSIF sans l'avoir vérifié, et une
      // erreur ici décale toute la grille d'un jour sans rien casser de visible.
      // UN SEUL APPEL : D → D+5.
      try {
        await sleep(PROBE_SPACING_MS);
        const rangeTimeout = ctx.nextCallTimeout();
        if (rangeTimeout === null) throw new ProbeBudgetExceeded();
        probeCalls += 1;
        const range = await getLobbyAvailableRooms(
          baseUrl, establishment.lobby_api_token, date, rangeEnd, relaySecret, rangeTimeout
        );
        if (range.status !== 200) {
          probeNotes.push(
            ctx.redact(`sonde plage ${establishment.id} : ${range.status} — ${describeLobbyErrorBody(range.body, ctx.redact)}`)
          );
        } else {
          probeNotes.push(`sonde plage ${establishment.id} : demandé ${date} → ${rangeEnd} (5 nuits si exclusif, 6 si inclusif)`);
          for (const note of describeRangeShape(range.body)) {
            probeNotes.push(`sonde plage ${establishment.id} : ${note}`);
          }
        }
      } catch (err) {
        probeNotes.push(`sonde plage ${establishment.id} : ${probeFailure(err, ctx.describe)}`);
      }
    }

    if (requestedProbes.includes("category_filter")) {
      // SONDE 2 — R1 repose sur une prémisse : la disponibilité rendue POUR UNE CATÉGORIE est la
      // même qu'on filtre ou non par `category_id`. La forme a été observée le 2026-08-27 ;
      // l'ÉGALITÉ DES VALEURS, elle, ne l'a jamais été. Deux appels sur la MÊME nuit la vérifient.
      const knownCategoryIds = probeCategoryIds.get(establishment.id) ?? [];
      const categoryId = knownCategoryIds[0];
      if (categoryId === undefined) {
        probeNotes.push(`sonde filtre ${establishment.id} : aucune catégorie connue, sonde sautée`);
      } else {
        try {
          await sleep(PROBE_SPACING_MS);
          const filteredTimeout = ctx.nextCallTimeout();
          if (filteredTimeout === null) throw new ProbeBudgetExceeded();
          probeCalls += 1;
          const filtered = await getLobbyNightAvailability(
            baseUrl, establishment.lobby_api_token, categoryId, date, nextDate, relaySecret, filteredTimeout
          );
          await sleep(PROBE_SPACING_MS);
          const wholeTimeout = ctx.nextCallTimeout();
          if (wholeTimeout === null) throw new ProbeBudgetExceeded();
          probeCalls += 1;
          const whole = await getLobbyAvailableRooms(
            baseUrl, establishment.lobby_api_token, date, nextDate, relaySecret, wholeTimeout
          );
          const withFilter = filtered.status === 200 ? availableForCategory(filtered.body, categoryId) : null;
          const withoutFilter = whole.status === 200 ? availableForCategory(whole.body, categoryId) : null;
          probeNotes.push(
            `sonde filtre ${establishment.id} : catégorie ${categoryId}, nuit ${date} — avec category_id = ${withFilter}, sans = ${withoutFilter}` +
              (withFilter === withoutFilter ? " (IDENTIQUE : la prémisse de R1 tient)" : " ⚠️ DIVERGENT")
          );
        } catch (err) {
          probeNotes.push(`sonde filtre ${establishment.id} : ${probeFailure(err, ctx.describe)}`);
        }
      }
    }
  }

  if (probeNotes.length > 0) {
    console.info("pms-nightly-contract-check : sondes", { probeCalls, probeNotes: probeNotes.map(ctx.redactLong) });
  }

  const problems = [
    ...(roomsFailures.length > 0
      ? [`lobby : GET /rooms en échec pour ${roomsFailures.length} établissement(s) (${roomsFailures.map((id) => id.slice(0, 8)).join(", ")})`]
      : []),
    ...(countErrors.length > 0 ? [`${countErrors.length} comptage(s) de file illisible(s)`] : []),
  ];
  return {
    ok: problems.length === 0,
    error: problems.length > 0 ? problems.join(" ; ") : null,
    stats: {
      checked: toCheck.length - unchecked,
      unchecked,
      drifts: drifts.length,
      failed_cancellations: failedByAttempts,
      token_replaced_cancellations: replacedCancellations ?? 0,
      token_replaced_bookings: replacedBookings ?? 0,
    },
    extra: {
      drifts,
      observations,
      // Absents en nominal (cron), donc la réponse du job ne change pas de forme tant que personne
      // ne demande de sonde.
      ...(requestedProbes.length > 0 ? { probes: requestedProbes, probeCalls, probeNotes } : {}),
    },
  };
}, {
  // Le cron attend 60 s (invoke_pms_nightly_contract_check) ; l'espacement de 1,5 s entre
  // établissements est compris dans ce budget.
  budgetMs: 50_000,
});
