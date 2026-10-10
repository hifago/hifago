// Contrôle d'appelant des Edge Functions de jobs : seule la clé service_role de l'environnement les
// déclenche — celle qu'envoient les wrappers SQL `invoke_*` (Vault `pms_service_role_key`). La
// passerelle (`verify_jwt = true`, config.toml) vérifie seulement qu'un jeton est signé par le
// projet ; ce contrôle-ci vérifie QUEL jeton.
//
// Comparaison par empreinte, à temps constant (bearerMatchesKey) ; échec fermé si la variable
// d'environnement manque.
import { bearerMatchesKey } from "../../../packages/domain/src/http/bearerMatchesKey.ts";

/** null si l'appelant présente la clé service_role ; sinon la réponse 401 à rendre telle quelle. */
export async function requireServiceRole(request: Request): Promise<Response | null> {
  const allowed = await bearerMatchesKey(
    request.headers.get("authorization"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  if (allowed) return null;
  return new Response(JSON.stringify({ ok: false, reason: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
