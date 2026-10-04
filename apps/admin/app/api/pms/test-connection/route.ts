import { getLobbyRooms, LOBBY_DEFAULT_BASE_URL } from "@hifago/domain";
import { createClient } from "@hifago/supabase/server";

// Spec 21 §0/§5 — bouton "Tester la connexion" de la fiche établissement admin. Reçoit le jeton
// TAPÉ À L'ÉCRAN (jamais celui déjà en base, illisible de toute façon via PostgREST — cf. migration
// 20260819110000), ne persiste rien. Admin-only (précédent auth : apps/admin/app/admin/layout.tsx,
// apps/admin/app/api/upload/[entity]/route.ts pour la forme d'un Route Handler admin).
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }
  // Échec fermé (2026-10-01), motif de lib/pms/lobbyEstablishment.ts : un rôle illisible répond
  // 503, jamais 403 « pas admin ».
  const { data: isAdmin, error: isAdminError } = await supabase.rpc("is_admin", { uid: user.id });
  if (isAdminError) {
    console.error("test-connection : rôle indéterminable", isAdminError.message);
    return Response.json({ ok: false, reason: "authorization_unavailable" }, { status: 503 });
  }
  if (!isAdmin) {
    return Response.json({ ok: false, reason: "not_admin" }, { status: 403 });
  }

  let body: { apiToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }
  const apiToken = typeof body.apiToken === "string" ? body.apiToken.trim() : "";
  if (!apiToken) {
    return Response.json({ ok: false, reason: "token_required" }, { status: 400 });
  }

  try {
    const baseUrl = process.env.LOBBY_API_BASE_URL || LOBBY_DEFAULT_BASE_URL;
    const relaySecret = process.env.LOBBY_RELAY_SECRET;
    const result = await getLobbyRooms(baseUrl, apiToken, undefined, relaySecret);
    if (result.status !== 200) {
      return Response.json({ ok: false, reason: "lobby_rejected", status: result.status }, { status: 502 });
    }
    const data = (result.body as { data?: unknown[] } | null)?.data;
    return Response.json({ ok: true, roomsCount: Array.isArray(data) ? data.length : 0 });
  } catch (error) {
    console.error("test_pms_connection a échoué", error);
    return Response.json({ ok: false, reason: "lobby_unreachable" }, { status: 502 });
  }
}
