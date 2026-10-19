import { createClient } from "@hifago/supabase/server";
import { createServiceRoleClient } from "@hifago/supabase/service";
import { CATALOG_MEDIA_BUCKET } from "@/lib/media/catalogImage";
import { isUuid } from "@/lib/uuid";

// Suppression définitive d'un partenaire (demande Jérôme, 2026-10-19 : « comme si ça n'avait
// jamais existé », l'adresse e-mail redevient libre). Trois gestes, dans cet ordre :
//
//   1. admin_delete_partner (20261019150000) sur la SESSION de l'admin — c'est elle qui porte
//      is_admin() et la ligne d'audit nominative. Toute la base part en une transaction, ou rien ;
//      elle refuse un partenaire qui a déjà une commande.
//   2. Les comptes de connexion, par l'API Admin (service_role) — jamais en SQL sur le schéma auth
//      (même règle que delete_my_account). La RPC les a détachés : un échec ici laisse un compte
//      sans partenaire ni capacité, qui ne donne accès à rien mais garde l'adresse. La réponse le
//      dit (`accountsNotDeleted`) pour que l'écran l'affiche, jamais en silence.
//   3. Les photos que plus aucune fiche n'utilise. Un échec ne laisse qu'un fichier orphelin dans
//      un bucket public, déjà le cas de toute photo retirée ailleurs : journalisé, pas bloquant.
//
// service_role ne sert qu'aux étapes 2 et 3 : aucune donnée n'est lue ni écrite en base par lui.
export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_delete_partner", { p_partner_id: id });
  if (error) {
    if (error.code === "42501") {
      return Response.json({ ok: false, reason: "forbidden" }, { status: 403 });
    }
    console.error("delete partner : admin_delete_partner en échec", { id, message: error.message });
    return Response.json({ ok: false, reason: "delete_failed" }, { status: 503 });
  }

  const result = data as
    | { ok: true; account_ids: string[]; storage_paths: string[] }
    | { ok: false; reason: string };
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 409;
    return Response.json({ ok: false, reason: result.reason }, { status });
  }

  const service = createServiceRoleClient();

  const accountsNotDeleted: string[] = [];
  for (const accountId of result.account_ids) {
    const { error: deleteError } = await service.auth.admin.deleteUser(accountId);
    if (deleteError) {
      accountsNotDeleted.push(accountId);
      console.error("delete partner : compte de connexion non supprimé", {
        partnerId: id,
        accountId,
        message: deleteError.message,
      });
    }
  }

  if (result.storage_paths.length > 0) {
    const { error: storageError } = await service.storage
      .from(CATALOG_MEDIA_BUCKET)
      .remove(result.storage_paths);
    if (storageError) {
      console.error("delete partner : photos non supprimées de Storage", {
        partnerId: id,
        paths: result.storage_paths,
        message: storageError.message,
      });
    }
  }

  return Response.json({ ok: true, accountsNotDeleted });
}
