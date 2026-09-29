import { isRealAccount } from "@hifago/supabase/identity";
import { createClient } from "@hifago/supabase/server";
import { createServiceRoleClient } from "@hifago/supabase/service";
import { MAX_IMAGE_BYTES, toCatalogWebp, uploadCatalogWebp } from "@/lib/media/catalogImage";

// sharp a besoin de bindings natifs — incompatible avec le runtime edge (le pipeline vit dans
// @/lib/media/catalogImage, mais il s'exécute ici).
export const runtime = "nodejs";

const MARGE_MULTIPART = 64 * 1024;

// Upload canonique de tout le module images (spec docs/specs/04-gestion-images.md §7) — admin ET
// socio passent par CE MÊME Route Handler, jamais un chemin distinct par rôle (contrairement au
// fork admin/socio du legacy, `imageUpload.js`, qui n'a plus de raison d'être ici : Vercel n'a de
// toute façon aucun disque persistant à écrire pour personne). Ne fait QUE traiter le fichier et
// l'écrire dans Storage — retourne un storage_path que l'appelant attache ensuite à une entité via
// add_catalog_media (admin) ou submit_photos_proposal (socio), jamais d'écriture DB ici.
//
// Le décodage/réencodage et l'écriture Storage sont partagés avec api/pms/import-room-photos
// (/simplify 2026-08-27) : les deux chemins aboutissent au même bucket, ils doivent produire le
// même rendu.
export async function POST(request: Request, context: RouteContext<"/api/upload/[entity]">) {
  const { entity } = await context.params;
  // ⚠️ `tag` ajouté le 2026-09-08 (spec 29 Tranche 3) — une ENTRÉE de plus dans la liste blanche,
  // et rien d'autre : ce Route Handler est le chemin d'upload canonique de TOUT le module images
  // (photos de produits et d'établissements, propositions socio, import PMS). Sa signature, son
  // ordre de vérifications et ses deux chemins existants sont intacts.
  if (entity !== "product" && entity !== "establishment" && entity !== "tag") {
    return Response.json({ ok: false, reason: "invalid_entity" }, { status: 400 });
  }

  // Auth vérifiée AVANT toute lecture du body (contre C29, docs/4-pilotage/backlog.md:871-894) —
  // la session est la toute première chose lue dans ce corps de fonction, avant même
  // request.formData(). Un upload sans session ne déclenche jamais aucune écriture Storage.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ ok: false, reason: "not_authenticated" }, { status: 401 });
  }

  // L'écriture se fait en service_role dans un bucket PUBLIC : les policies Storage ne s'appliquent
  // pas, l'autorisation se décide donc entièrement ici, toujours avant la lecture du corps. Une
  // identité anonyme n'est jamais un compte ; il faut ensuite un rôle — admin, ou organisation
  // partenaire —, et `tag` (image éditoriale d'une catégorie) reste réservé à l'admin.
  if (!isRealAccount(user)) {
    return Response.json({ ok: false, reason: "anonymous_not_allowed" }, { status: 403 });
  }
  const [adminResult, partnerResult] = await Promise.all([
    supabase.rpc("is_admin", { uid: user.id }),
    supabase.rpc("partner_id_for_account", { uid: user.id }),
  ]);
  // Même discipline que lib/pms/lobbyEstablishment.ts : « je n'ai pas pu le savoir » n'est jamais
  // « tu as le droit » — 503 explicite, fermé par défaut.
  if (adminResult.error || partnerResult.error) {
    console.error("upload : autorisation indéterminable", {
      isAdmin: adminResult.error?.message,
      partnerId: partnerResult.error?.message,
    });
    return Response.json({ ok: false, reason: "authorization_unavailable" }, { status: 503 });
  }
  const isAdmin = adminResult.data === true;
  if (!isAdmin && (entity === "tag" || !partnerResult.data)) {
    return Response.json({ ok: false, reason: "not_authorized" }, { status: 403 });
  }

  // Taille ANNONCÉE refusée avant de bufferiser le corps — défense en profondeur seulement : un
  // en-tête absent laisse passer, et le contrôle de `file.size` ci-dessous reste la vraie borne.
  // Marge pour l'enveloppe multipart, sans quoi une image juste sous la limite serait refusée.
  const tailleAnnoncee = Number(request.headers.get("content-length"));
  if (Number.isFinite(tailleAnnoncee) && tailleAnnoncee > MAX_IMAGE_BYTES + MARGE_MULTIPART) {
    return Response.json({ ok: false, reason: "file_too_large" }, { status: 413 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ ok: false, reason: "no_file" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return Response.json({ ok: false, reason: "file_too_large" }, { status: 413 });
  }

  // Buffer 100% en mémoire — jamais fs.writeFile (contre le gap G5, aucun fichier utilisateur ne
  // touche jamais un disque local à aucune étape).
  const inputBuffer = Buffer.from(await file.arrayBuffer());

  const processed = await toCatalogWebp(inputBuffer);
  if (!processed.ok) {
    return Response.json(
      { ok: false, reason: processed.reason },
      { status: processed.reason === "unsupported_format" ? 415 : 400 },
    );
  }

  const service = createServiceRoleClient();
  // ⚠️ Table explicite plutôt qu'un ternaire imbriqué : à trois valeurs, un `a ? b : c ? d : e`
  // devient l'endroit exact où une quatrième entité partira dans le mauvais dossier sans que rien
  // ne le signale — le fichier atterrirait dans `products/` et la page l'afficherait quand même.
  const DOSSIER = { product: "products", establishment: "establishments", tag: "tags" } as const;
  const stored = await uploadCatalogWebp(service, DOSSIER[entity], processed.buffer);
  if (!stored.ok) {
    return Response.json({ ok: false, reason: "upload_failed" }, { status: 500 });
  }

  return Response.json({ ok: true, storage_path: stored.path });
}
