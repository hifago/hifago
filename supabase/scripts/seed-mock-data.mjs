// Mock data JSON — établissements/activités/chambres/tags/partenaires/photos, lus depuis
// `mockData/` à la racine du monorepo.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// EN QUOI C'EST DIFFÉRENT DE `seed.sql` ET DE `seed-media.mjs`
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// `seed.sql` suppose une base fraîche (`db reset --no-seed` puis rejeu complet, UUID fixes, aucun
// `ON CONFLICT`) — rejouer ce script-ci sur une base contenant déjà des modifications d'admin
// romprait ce travail. `seed-media.mjs` purge-puis-recrée à chaque exécution (préfixe `seed/`).
//
// Ce script-ci a une règle différente et volontaire : **créer si absent, ne JAMAIS retoucher un
// item déjà en base** — même si le JSON change ensuite, même si un admin a modifié l'item depuis.
// Pas de synchro, pas de table de suivi de hash : un item existant (identifié par sa colonne
// métier stable — `email` pour un partenaire, `slug` pour un établissement/produit/tag) est purement
// et simplement ignoré, PHOTOS COMPRISES. Ajouter une photo à un établissement mock déjà créé n'a
// donc aucun effet sur un rerun — c'est le point le plus contre-intuitif du système, voir
// mockData/README.md.
//
// Conséquence : contrairement à `seed_auth_users.mjs`/`seed.sql`, ce script est fait pour tourner
// répétitivement, y compris contre un projet préprod déjà utilisé.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// POURQUOI DEUX CLIENTS SUPABASE (+ UN TROISIÈME ÉPHÉMÈRE PAR PERSONNE)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Toutes les écritures nécessaires (`create_partner_direct`, `set_capability_status`,
// `create_establishment`, `update_establishment_stay_details`, `update_establishment_contact`,
// `set_establishment_status`, `add_catalog_media`, `create_product_from_proposal`, l'insert direct
// dans `catalog_tags`) sont `security definer`/`security invoker` ou RLS directe, mais vérifient
// TOUTES `is_admin(auth.uid())` — un client `service_role` pur (`auth.uid()` null) échoue sur
// toutes. D'où :
//   - `admin`  : clé anon + `signInWithPassword` avec un compte admin déjà seedé (par
//                `seed_auth_users.mjs` en local) — sert à toutes les RPC et lectures d'existence.
//   - `svc`    : service_role — uniquement pour l'upload Storage (bypass RLS storage, même pattern
//                que `seed-media.mjs`), le complément `_extra_columns`, et la création des comptes
//                auth des personnes rattachées aux partenaires.
//   - un client anon éphémère par personne rattachée : `consume_partner_invitation` lit
//     `auth.uid()`, donc l'appel doit être fait EN TANT QUE cette personne, jamais `admin` ni `svc`
//     — c'est le chemin métier réel déjà dogfoodé par `seed.sql` pour ses propres partenaires,
//     repris ici plutôt qu'un insert direct dans `partner_accounts`.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// USAGE
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Local (après `npm run db:setup`, pour avoir un compte admin à utiliser) :
//   eval "$(npx supabase status -o env | grep -E '^[A-Z0-9_]+=' | sed 's/^/export /')"
//   SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
//     SUPABASE_ADMIN_EMAIL="admin@hifago.test" SUPABASE_ADMIN_PASSWORD="Seed1234!" \
//     node supabase/scripts/seed-mock-data.mjs
//
// Préprod (jamais sans /hifago-verify-compte au préalable, cf. hifago/CLAUDE.md §8.1) :
//   SUPABASE_URL="https://<project-ref>.supabase.co" SUPABASE_ANON_KEY="…" \
//     SUPABASE_SERVICE_ROLE_KEY="…" SUPABASE_ADMIN_EMAIL="…" SUPABASE_ADMIN_PASSWORD="…" \
//     node supabase/scripts/seed-mock-data.mjs
//   (credentials en variable de session uniquement, jamais dans un fichier — CLAUDE.md §8.2)

import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, extname } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = process.env.SUPABASE_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SUPABASE_ADMIN_PASSWORD;

const VARIABLES_REQUISES = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  SUPABASE_ADMIN_EMAIL: ADMIN_EMAIL,
  SUPABASE_ADMIN_PASSWORD: ADMIN_PASSWORD,
};
const manquantes = Object.entries(VARIABLES_REQUISES)
  .filter(([, valeur]) => !valeur)
  .map(([nom]) => nom);
if (manquantes.length) {
  console.error(
    `Variables d'environnement manquantes (jamais de valeur par défaut codée en dur — ` +
      `hifago/CLAUDE.md §8.2) : ${manquantes.join(", ")}`
  );
  process.exit(1);
}

const BUCKET = "catalog-media";
// Préfixe dédié, distinct de `seed/` (seed-media.mjs) et de `products/`/`establishments/`/`tags/`
// (upload réel via /api/upload/[entity]) : aucune collision possible.
const PREFIXE = "mock";

const RACINE_MOCK_DATA = fileURLToPath(new URL("../../mockData", import.meta.url));

// Formats acceptés TELS QUELS, sans conversion : pas de dépendance `sharp` (elle vit dans
// apps/admin, pas ici) juste pour reproduire la conversion webp du vrai pipeline d'upload — sans
// impact réel pour des données de test en volume limité.
const TYPES_MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

function typeMime(cheminFichier) {
  const type = TYPES_MIME[extname(cheminFichier).toLowerCase()];
  if (!type) {
    throw new Error(`extension non supportée pour une photo mock : ${cheminFichier} (jpg/jpeg/png/webp seulement)`);
  }
  return type;
}

function chargerDossier(sousDossier) {
  const dir = join(RACINE_MOCK_DATA, sousDossier);
  const items = new Map();
  if (!existsSync(dir)) return items;
  for (const nom of readdirSync(dir)) {
    if (!nom.endsWith(".json")) continue;
    const cle = nom.slice(0, -".json".length);
    const contenu = JSON.parse(readFileSync(join(dir, nom), "utf8"));
    items.set(cle, { ...contenu, _fichier: `mockData/${sousDossier}/${nom}` });
  }
  return items;
}

function verifierDoublons(items, lireChamp, nomType, erreurs) {
  const vus = new Map();
  for (const [cle, item] of items) {
    const valeur = lireChamp(item);
    if (!valeur) continue;
    if (vus.has(valeur)) {
      erreurs.push(
        `${nomType} : "${valeur}" utilisé à la fois par ${vus.get(valeur)} et ${cle} — le trigger ` +
          `de slug ajouterait un "-2" silencieux au lieu d'un skip propre.`
      );
    } else {
      vus.set(valeur, cle);
    }
  }
}

function validerProduits(produits, nomType, { partners, establishments, tags }, erreurs) {
  for (const [, item] of produits) {
    if (!item.name?.es) erreurs.push(`${item._fichier} : "name.es" requis.`);
    const etablissement = establishments.get(item.establishment);
    if (!etablissement) {
      erreurs.push(`${item._fichier} : establishment "${item.establishment}" introuvable dans mockData/establishments/.`);
    } else if (etablissement.partner !== item.partner) {
      erreurs.push(
        `${item._fichier} : partner "${item.partner}" différent de celui de l'établissement "${item.establishment}" (${etablissement.partner}).`
      );
    }
    if (!partners.has(item.partner)) erreurs.push(`${item._fichier} : partner "${item.partner}" introuvable dans mockData/partners/.`);
    for (const cleTag of item.tags ?? []) {
      if (!tags.has(cleTag)) erreurs.push(`${item._fichier} : tag "${cleTag}" introuvable dans mockData/tags/.`);
    }
  }
}

function validerReferences({ partners, tags, establishments, activities, rooms, events, transport, camps }) {
  const erreurs = [];

  for (const [, p] of partners) {
    if (!p.email) erreurs.push(`${p._fichier} : "email" requis.`);
    if (p.person && !p.code) {
      erreurs.push(`${p._fichier} : "code" requis dès que "person" est présent (create_partner_direct l'exige pour envoyer une invitation).`);
    }
    if (p.person && !p.person.email) erreurs.push(`${p._fichier} : "person.email" requis.`);
  }

  for (const [, e] of establishments) {
    if (!e.name?.es) erreurs.push(`${e._fichier} : "name.es" requis.`);
    if (!partners.has(e.partner)) erreurs.push(`${e._fichier} : partner "${e.partner}" introuvable dans mockData/partners/.`);
  }

  validerProduits(activities, "activités", { partners, establishments, tags }, erreurs);
  validerProduits(rooms, "chambres", { partners, establishments, tags }, erreurs);
  validerProduits(events, "événements", { partners, establishments, tags }, erreurs);
  validerProduits(transport, "transports", { partners, establishments, tags }, erreurs);
  validerProduits(camps, "camps", { partners, establishments, tags }, erreurs);
  for (const [, c] of camps) {
    if (!Number.isInteger(c.duration_days) || c.duration_days < 1) {
      erreurs.push(`${c._fichier} : "duration_days" requis (entier >= 1) pour un camp.`);
    }
    // Un camp « vitrine » (réservé hors ligne via `external_booking_url`, comme les escapades de la
    // v1 coordonnées par WhatsApp) n'a pas de départs datés ; tout autre camp en exige.
    if (!c.external_booking_url && (!Array.isArray(c.departures) || c.departures.length === 0)) {
      erreurs.push(`${c._fichier} : "departures" requis (tableau non vide de dates) pour un camp sans "external_booking_url".`);
    }
    // `program` est facultatif, mais s'il est là il doit être exploitable : c'est le seul endroit
    // où une donnée mock malformée peut atteindre la base, et un jour au-delà de la durée passerait
    // les CHECK SQL (volontairement souples) pour n'échouer qu'à l'affichage.
    if (c.program !== undefined) {
      if (!Array.isArray(c.program)) {
        erreurs.push(`${c._fichier} : "program" doit être un tableau [{day, text:{es,…}}].`);
      } else {
        for (const [i, ligne] of c.program.entries()) {
          const jour = ligne?.day;
          if (!Number.isInteger(jour) || jour < 1 || jour > (c.duration_days ?? 0)) {
            erreurs.push(
              `${c._fichier} : program[${i}].day doit être un entier entre 1 et duration_days (${c.duration_days}).`,
            );
          }
          if (!ligne?.text?.es || String(ligne.text.es).trim() === "") {
            erreurs.push(`${c._fichier} : program[${i}].text.es est obligatoire (repli de la fiche).`);
          }
        }
      }
    }
  }

  verifierDoublons(establishments, (e) => e.name?.es, "établissements", erreurs);
  verifierDoublons(tags, (t) => t.label?.es, "tags", erreurs);
  // `products.slug` est UNIQUE et PARTAGÉ entre tous les types (activity/lodging/evento/transport/
  // camp/...) : le dédoublonnage doit porter sur les 5 dossiers COMBINÉS, jamais séparément (deux
  // fichiers de dossiers différents au même name.es collisionneraient silencieusement sur le même
  // slug sinon).
  verifierDoublons(
    new Map([...activities, ...rooms, ...events, ...transport, ...camps]),
    (item) => item.name?.es,
    "activités/chambres/événements/transports/camps",
    erreurs
  );

  return erreurs;
}

async function televerserPhoto(svc, chemin, cheminLocal) {
  const { error } = await svc.storage.from(BUCKET).upload(chemin, readFileSync(cheminLocal), {
    contentType: typeMime(cheminLocal),
    upsert: true,
  });
  if (error) throw new Error(`upload ${chemin} : ${error.message}`);
  return chemin;
}

async function retrouverUtilisateurParEmail(svc, email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers : ${error.message}`);
    const trouve = data.users.find((u) => u.email === email);
    if (trouve) return trouve;
    if (data.users.length < 200) return null;
  }
}

async function creerOuRecupererCompte(svc, email, password) {
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (!error) return data.user;
  if (!/already.*registered|already.*exists/i.test(error.message ?? "")) {
    throw new Error(`création du compte ${email} : ${error.message}`);
  }
  // Idempotence volontairement différente de seed_auth_users.mjs (qui échoue sur un doublon) : ce
  // script-ci doit rester rejouable, donc un compte déjà existant est retrouvé, pas une erreur.
  const existant = await retrouverUtilisateurParEmail(svc, email);
  if (!existant) throw new Error(`compte ${email} annoncé "déjà existant" par l'API mais introuvable via listUsers`);
  return existant;
}

// Mot de passe d'une personne : celui de son JSON, sinon MOCK_PERSONNE_MDP (variable de session).
// Le dépôt est PUBLIC : les personnes ajoutées depuis la reprise v1 n'ont AUCUN mot de passe dans
// leur fichier. Sans la variable, la personne est simplement ignorée (le partenaire est créé quand
// même, sans compte de connexion), jamais une erreur.
const MDP_PERSONNE_PAR_DEFAUT = process.env.MOCK_PERSONNE_MDP || null;

async function creerPartenaires(admin, svc, partners) {
  const idParCle = new Map();
  let crees = 0;
  let ignores = 0;
  let personnesCreees = 0;
  let personnesIgnorees = 0;
  let personnesSansMotDePasse = 0;

  for (const cle of [...partners.keys()].sort()) {
    const p = partners.get(cle);
    const motDePasse = p.person ? (p.person.password ?? MDP_PERSONNE_PAR_DEFAUT) : null;
    if (p.person && !motDePasse) personnesSansMotDePasse += 1;
    const avecPersonne = !!p.person && !!motDePasse;

    const { data: existant, error: erreurLecture } = await admin.from("partners").select("id").eq("email", p.email).maybeSingle();
    if (erreurLecture) throw new Error(`${p._fichier} : lecture partners : ${erreurLecture.message}`);

    if (existant) {
      idParCle.set(cle, existant.id);
      ignores += 1;
      if (p.person) personnesIgnorees += 1;
      continue;
    }

    const { data: resultat, error: erreurCreation } = await admin.rpc("create_partner_direct", {
      p_display_name: p.display_name,
      p_roles: p.roles,
      p_legal_name: p.legal_name ?? null,
      p_identification_type: p.identification_type ?? null,
      p_identification_number: p.identification_number ?? null,
      p_partner_city: p.partner_city ?? null,
      p_email: p.email,
      p_phone: p.phone ?? null,
      p_code: p.code ?? null,
      p_commission_enabled: p.commission_enabled ?? true,
      p_crm_profile: p.crm_profile ?? null,
      p_send_invitation: avecPersonne,
      p_invitation_expires_days: 14,
    });
    if (erreurCreation) throw new Error(`${p._fichier} : create_partner_direct : ${erreurCreation.message}`);
    if (!resultat?.ok) throw new Error(`${p._fichier} : create_partner_direct a renvoyé ok=false`);

    idParCle.set(cle, resultat.partner_id);
    crees += 1;

    if (p.capability_status === "suspended") {
      for (const capaciteId of resultat.capability_ids ?? []) {
        const { error } = await admin.rpc("set_capability_status", { p_capability_id: capaciteId, p_new_status: "suspended" });
        if (error) throw new Error(`${p._fichier} : set_capability_status : ${error.message}`);
      }
    }

    if (avecPersonne) {
      await creerOuRecupererCompte(svc, p.person.email, motDePasse);

      const clientPersonne = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error: erreurConnexion } = await clientPersonne.auth.signInWithPassword({
        email: p.person.email,
        password: motDePasse,
      });
      if (erreurConnexion) throw new Error(`${p._fichier} : connexion de la personne rattachée : ${erreurConnexion.message}`);

      const { data: consommation, error: erreurConsommation } = await clientPersonne.rpc("consume_partner_invitation", {
        p_token: resultat.invitation_token,
        p_signer_name: p.person.full_name ?? p.display_name,
        p_document_version: "v1",
        p_ip: null,
        p_user_agent: null,
      });
      if (erreurConsommation) throw new Error(`${p._fichier} : consume_partner_invitation : ${erreurConsommation.message}`);
      if (!consommation?.ok) {
        throw new Error(`${p._fichier} : consume_partner_invitation a renvoyé ok=false (${consommation?.reason ?? "raison inconnue"})`);
      }

      personnesCreees += 1;
    }
  }

  return { idParCle, crees, ignores, personnesCreees, personnesIgnorees, personnesSansMotDePasse };
}

// Équipements structurés (migration 20260917110000, décision Jérôme du 2026-09-17) — DIFFÉRENCE
// STRUCTURELLE avec les tags : ce référentiel n'est JAMAIS créé par le script mock, contrairement à
// `catalog_tags` (créerTags ci-dessous). Il vit en migration, appliquée aussi en préprod — le
// script se contente d'ASSIGNER des slugs déjà en base, et échoue bruyamment si un slug référencé
// n'existe pas (référentiel non seedé), plutôt que de le créer à la volée.
async function chargerAmenitiesExistantes(admin) {
  const { data, error } = await admin.from("catalog_amenities").select("id, slug");
  if (error) throw new Error(`lecture catalog_amenities : ${error.message}`);
  return new Map((data ?? []).map((a) => [a.slug, a.id]));
}

function resoudreAmenityIds(item, idAmenityParSlug) {
  return (item.amenities ?? []).map((slug) => {
    const id = idAmenityParSlug.get(slug);
    if (!id) {
      throw new Error(
        `${item._fichier} : amenity "${slug}" introuvable dans catalog_amenities (référentiel non seedé ? migration 20260917120000 appliquée ?).`
      );
    }
    return id;
  });
}

async function creerTags(admin, svc, tags) {
  const idParCle = new Map();
  let crees = 0;
  let ignores = 0;

  for (const cle of [...tags.keys()].sort()) {
    const t = tags.get(cle);

    const { data: slug, error: erreurSlug } = await admin.rpc("slugify", { p_text: t.label.es });
    if (erreurSlug) throw new Error(`${t._fichier} : slugify : ${erreurSlug.message}`);

    const { data: existant, error: erreurLecture } = await admin.from("catalog_tags").select("id").eq("slug", slug).maybeSingle();
    if (erreurLecture) throw new Error(`${t._fichier} : lecture catalog_tags : ${erreurLecture.message}`);

    if (existant) {
      idParCle.set(cle, existant.id);
      ignores += 1;
      continue;
    }

    let imagePath = null;
    if (t.photo) {
      const cheminLocal = join(RACINE_MOCK_DATA, "tags", cle, "photos", t.photo);
      imagePath = await televerserPhoto(svc, `${PREFIXE}/tags/${cle}${extname(t.photo)}`, cheminLocal);
    }

    const { data: cree, error: erreurCreation } = await admin
      .from("catalog_tags")
      .insert({ label: t.label, slug, image_path: imagePath })
      .select("id")
      .single();
    if (erreurCreation) throw new Error(`${t._fichier} : insert catalog_tags : ${erreurCreation.message}`);

    idParCle.set(cle, cree.id);
    crees += 1;
  }

  return { idParCle, crees, ignores };
}

async function creerEtablissements(admin, svc, establishments, idPartenaireParCle, idAmenityParSlug) {
  const idParCle = new Map();
  let crees = 0;
  let ignores = 0;
  let photosTeleversees = 0;

  for (const cle of [...establishments.keys()].sort()) {
    const e = establishments.get(cle);

    // ⚠️ NE PAS utiliser establishment_slug_from_name ici : cette fonction fait de l'anti-collision
    // (comme le trigger DB) — une fois la ligne créée, elle renvoie "<base>-2" au lieu du slug
    // initial, donc la comparaison échouerait à chaque rerun et créerait un doublon. slugify() seul
    // donne le slug de base, stable, identique à celui du premier insert (garanti sans collision
    // par la validation statique de l'étape 0 qui interdit deux établissements mock au même
    // name.es) — même logique que pour les produits et les tags ci-dessous/au-dessus.
    const { data: slugAttendu, error: erreurSlug } = await admin.rpc("slugify", { p_text: e.name.es });
    if (erreurSlug) throw new Error(`${e._fichier} : slugify : ${erreurSlug.message}`);

    const { data: existant, error: erreurLecture } = await admin.from("establishments").select("id").eq("slug", slugAttendu).maybeSingle();
    if (erreurLecture) throw new Error(`${e._fichier} : lecture establishments : ${erreurLecture.message}`);

    if (existant) {
      // L'entité entière est ignorée, PHOTOS COMPRISES — cf. l'en-tête du fichier.
      idParCle.set(cle, existant.id);
      ignores += 1;
      continue;
    }

    const { data: idEtablissement, error: erreurCreation } = await admin.rpc("create_establishment", {
      p_partner_id: idPartenaireParCle.get(e.partner),
      p_name: e.name,
      p_description: e.description ?? null,
      p_address: e.address ?? null,
      p_lat: e.lat ?? null,
      p_lon: e.lon ?? null,
      p_operated_directly: e.operated_directly ?? false,
    });
    if (erreurCreation) throw new Error(`${e._fichier} : create_establishment : ${erreurCreation.message}`);

    if (e.check_in_time || e.check_out_time || e.mode) {
      const { data: resultat, error } = await admin.rpc("update_establishment_stay_details", {
        p_establishment_id: idEtablissement,
        p_check_in_time: e.check_in_time ?? null,
        p_check_out_time: e.check_out_time ?? null,
        p_mode: e.mode ?? null,
      });
      if (error) throw new Error(`${e._fichier} : update_establishment_stay_details : ${error.message}`);
      if (!resultat?.ok) throw new Error(`${e._fichier} : update_establishment_stay_details a renvoyé ok=false (${resultat?.reason})`);
    }

    if (e.contact_phone) {
      const { data: resultat, error } = await admin.rpc("update_establishment_contact", {
        p_establishment_id: idEtablissement,
        p_contact_phone: e.contact_phone,
      });
      if (error) throw new Error(`${e._fichier} : update_establishment_contact : ${error.message}`);
      if (!resultat?.ok) throw new Error(`${e._fichier} : update_establishment_contact a renvoyé ok=false (${resultat?.reason})`);
    }

    if (e.status && e.status !== "active") {
      const { error } = await admin.rpc("set_establishment_status", { p_establishment_id: idEtablissement, p_status: e.status });
      if (error) throw new Error(`${e._fichier} : set_establishment_status : ${error.message}`);
    }

    for (const [index, nomPhoto] of (e.photos ?? []).entries()) {
      const cheminLocal = join(RACINE_MOCK_DATA, "establishments", cle, "photos", nomPhoto);
      const chemin = await televerserPhoto(svc, `${PREFIXE}/establishments/${cle}/${index + 1}${extname(nomPhoto)}`, cheminLocal);
      const { error } = await admin.rpc("add_catalog_media", {
        p_entity_type: "establishment",
        p_entity_id: idEtablissement,
        p_storage_path: chemin,
        p_sort: index,
      });
      if (error) throw new Error(`${e._fichier} : add_catalog_media : ${error.message}`);
      photosTeleversees += 1;
    }

    const amenityIds = resoudreAmenityIds(e, idAmenityParSlug);
    if (amenityIds.length > 0) {
      const { error } = await admin
        .from("establishment_amenity_assignments")
        .insert(amenityIds.map((amenity_id) => ({ establishment_id: idEtablissement, amenity_id })));
      if (error) throw new Error(`${e._fichier} : insert establishment_amenity_assignments : ${error.message}`);
    }

    idParCle.set(cle, idEtablissement);
    crees += 1;
  }

  return { idParCle, crees, ignores, photosTeleversees };
}

// Générique aux quatre dossiers `activities/` (type='activity'), `rooms/` (type='lodging'),
// `events/` (type='evento') et `transport/` (type='transport') : `create_product_from_proposal`
// gère tous les types de `products` via le même payload générique
// (capacity/unit/lodging_kind/slot_rules/occurrence_*/tag_ids/photos...) — pas de RPC séparée par
// type. Les champs qui ne s'appliquent pas à un type donné restent simplement `null` en base.
async function creerProduits(admin, svc, produits, { dossier, type }, idPartenaireParCle, idEtablissementParCle, idTagParCle, idAmenityParSlug) {
  let crees = 0;
  let ignores = 0;
  let photosTeleversees = 0;

  for (const cle of [...produits.keys()].sort()) {
    const item = produits.get(cle);

    const { data: slugBase, error: erreurSlug } = await admin.rpc("slugify", { p_text: item.name.es });
    if (erreurSlug) throw new Error(`${item._fichier} : slugify : ${erreurSlug.message}`);

    const { data: existant, error: erreurLecture } = await admin.from("products").select("id").eq("slug", slugBase).maybeSingle();
    if (erreurLecture) throw new Error(`${item._fichier} : lecture products : ${erreurLecture.message}`);

    if (existant) {
      // Entité ignorée, PHOTOS ET TAGS COMPRIS — même règle que les établissements.
      ignores += 1;
      continue;
    }

    const photos = [];
    for (const [index, nomPhoto] of (item.photos ?? []).entries()) {
      const cheminLocal = join(RACINE_MOCK_DATA, dossier, cle, "photos", nomPhoto);
      const chemin = await televerserPhoto(svc, `${PREFIXE}/${dossier}/${cle}/${index + 1}${extname(nomPhoto)}`, cheminLocal);
      photos.push({ storage_path: chemin });
      photosTeleversees += 1;
    }

    const payload = {
      name: item.name,
      description: item.description ?? null,
      price_cop: item.price_cop ?? null,
      price_label: item.price_label ?? null,
      price_tiers: item.price_tiers ?? null,
      // Grille d'un hébergement loué en entier (spec 12) et rattachement PMS Lobby : acceptés par
      // la RPC (liste blanche), à passer ICI — `lobby_category_id` est figé après création
      // (trigger products_capacity_flags_frozen), donc jamais via `_extra_columns`.
      stay_rates: item.stay_rates ?? null,
      lobby_category_id: item.lobby_category_id ?? null,
      lobby_product_id: item.lobby_product_id ?? null,
      min_qty: item.min_qty ?? null,
      max_qty: item.max_qty ?? null,
      capacity: item.capacity ?? null,
      default_capacity: item.default_capacity ?? null,
      unit: item.unit ?? null,
      unit_count: item.unit_count ?? null,
      lodging_kind: item.lodging_kind ?? null,
      check_in_time: item.check_in_time ?? null,
      check_out_time: item.check_out_time ?? null,
      duration_minutes: item.duration_minutes ?? null,
      duration_days: item.duration_days ?? null,
      // Remise par seuil de remplissage cumulé (migration 20260914130000) — camp uniquement,
      // les deux ensemble ou aucun (contrainte CHECK products_group_discount_pair).
      // Programme jour par jour (spec 37) — camp uniquement (CHECK products_program_camp_only).
      // `?? null` produit ici le littéral JSON `null` côté RPC : c'est justement ce que la
      // normalisation de create_product_from_proposal (migration 20260916140000) absorbe, sans
      // quoi tout camp SANS programme serait rejeté par products_program_is_array.
      program: item.program ?? null,
      group_discount_threshold_qty: item.group_discount_threshold_qty ?? null,
      group_discount_pct: item.group_discount_pct ?? null,
      start_time: item.start_time ?? null,
      occurrence_type: item.occurrence_type ?? null,
      occurrence_date: item.occurrence_date ?? null,
      recurrence_frequency_days: item.recurrence_frequency_days ?? null,
      recurrence_end_date: item.recurrence_end_date ?? null,
      recurrence_end_count: item.recurrence_end_count ?? null,
      external_booking_url: item.external_booking_url ?? null,
      address: item.address ?? null,
      lat: item.lat ?? null,
      lon: item.lon ?? null,
      // Transport informatif (migration 20260916150000). ⚠️ Ce payload mappe chaque clé
      // EXPLICITEMENT : une clé de JSON absente d'ici est jetée en silence, sans que rien ne le
      // signale — donc les 9 colonnes doivent y figurer, comme dans la whitelist de
      // create_product_from_proposal qu'on appelle juste en dessous.
      // ⚠️ Un transport n'utilise PLUS `address`/`lat`/`lon` ci-dessus : ses mocks portent
      // `transport_departure_*` (les 6 fichiers de mockData/transport/ ont été renommés avec la
      // migration). Les laisser tous les deux recréerait la double source de vérité.
      transport_first_departure_time: item.transport_first_departure_time ?? null,
      transport_last_departure_time: item.transport_last_departure_time ?? null,
      transport_seats_per_departure: item.transport_seats_per_departure ?? null,
      transport_departure_address: item.transport_departure_address ?? null,
      transport_departure_lat: item.transport_departure_lat ?? null,
      transport_departure_lon: item.transport_departure_lon ?? null,
      transport_arrival_address: item.transport_arrival_address ?? null,
      transport_arrival_lat: item.transport_arrival_lat ?? null,
      transport_arrival_lon: item.transport_arrival_lon ?? null,
      transport_contact_phone: item.transport_contact_phone ?? null,
      slot_rules: item.slot_rules ?? null,
      photos,
      tag_ids: (item.tags ?? []).map((cleTag) => idTagParCle.get(cleTag)),
    };

    const { data: idProduit, error: erreurCreation } = await admin.rpc("create_product_from_proposal", {
      p_partner_id: idPartenaireParCle.get(item.partner),
      p_establishment_id: idEtablissementParCle.get(item.establishment),
      p_type: type,
      p_payload: payload,
    });
    if (erreurCreation) throw new Error(`${item._fichier} : create_product_from_proposal : ${erreurCreation.message}`);

    if (item._extra_columns) {
      const { error } = await svc.from("products").update(item._extra_columns).eq("id", idProduit);
      if (error) throw new Error(`${item._fichier} : update _extra_columns : ${error.message}`);
    }

    // Équipements structurés (migration 20260917110000) — logement uniquement, même gating que
    // hasAmenities côté admin (productTypeGating.ts). Assignation directe, jamais via le payload de
    // create_product_from_proposal (qui ne connaît pas cette table) — cf. l'en-tête de
    // chargerAmenitiesExistantes ci-dessus.
    if (type === "lodging") {
      const amenityIds = resoudreAmenityIds(item, idAmenityParSlug);
      if (amenityIds.length > 0) {
        const { error } = await admin
          .from("product_amenity_assignments")
          .insert(amenityIds.map((amenity_id) => ({ product_id: idProduit, amenity_id })));
        if (error) throw new Error(`${item._fichier} : insert product_amenity_assignments : ${error.message}`);
      }
    }

    // Evento réservable en ligne, mode 'metered' (2026-09-15) — matérialise product_availability
    // pour les occurrences des 12 prochains mois (défaut de la RPC), même geste que l'admin après
    // création (product-form.tsx). Idempotent côté RPC (on conflict do nothing) : sans effet sur un
    // rerun, même si ce bloc est déjà après le `continue` d'existence plus haut.
    if (type === "evento" && item._extra_columns?.evento_capacity_mode === "metered") {
      const { error: erreurProvision } = await admin.rpc("provision_evento_availability", {
        p_product_id: idProduit,
      });
      if (erreurProvision) throw new Error(`${item._fichier} : provision_evento_availability : ${erreurProvision.message}`);
    }

    // Un camp n'a AUCUN repli automatique (contrairement à lodging/activity/transport) : ses
    // départs sont un calendrier fixe, pas une fenêtre glissante — `default_capacity` resterait
    // null. Chaque départ déclaré ici pose sa propre ligne `product_availability` (capacité du
    // camp) ET verrouille `provider_resource_calendar` pour chacun des `duration_days` jours de
    // l'établissement (feature 20) — sans quoi `create_order` refuserait toute réservation
    // (`resource_unavailable`) même avec une disponibilité posée côté produit. Exécuté UNE SEULE
    // FOIS, à la création (ce bloc est après le `continue` d'existence plus haut) — jamais retouché
    // au rerun, même règle que le reste du système.
    if (type === "camp" && Array.isArray(item.departures)) {
      const idEtablissement = idEtablissementParCle.get(item.establishment);
      for (const depart of item.departures) {
        const { data: dispo, error: erreurDispo } = await admin.rpc("set_product_availability", {
          p_product_id: idProduit,
          p_date: depart,
          p_capacity: item.capacity,
        });
        if (erreurDispo) throw new Error(`${item._fichier} : set_product_availability (${depart}) : ${erreurDispo.message}`);
        if (dispo?.ok === false) throw new Error(`${item._fichier} : set_product_availability (${depart}) a renvoyé ok=false (${dispo.reason})`);

        for (let jour = 0; jour < (item.duration_days ?? 1); jour += 1) {
          const dateRessource = new Date(`${depart}T00:00:00Z`);
          dateRessource.setUTCDate(dateRessource.getUTCDate() + jour);
          const { data: ressource, error: erreurRessource } = await admin.rpc("set_provider_resource_capacity", {
            p_establishment_id: idEtablissement,
            p_date: dateRessource.toISOString().slice(0, 10),
            p_capacity: item.capacity,
          });
          if (erreurRessource) {
            throw new Error(`${item._fichier} : set_provider_resource_capacity (${depart} +${jour}j) : ${erreurRessource.message}`);
          }
          if (ressource?.ok === false) {
            throw new Error(`${item._fichier} : set_provider_resource_capacity (${depart} +${jour}j) a renvoyé ok=false (${ressource.reason})`);
          }
        }
      }
    }

    crees += 1;
  }

  return { crees, ignores, photosTeleversees };
}

async function main() {
  const partners = chargerDossier("partners");
  const tags = chargerDossier("tags");
  const establishments = chargerDossier("establishments");
  const activities = chargerDossier("activities");
  const rooms = chargerDossier("rooms");
  const events = chargerDossier("events");
  const transport = chargerDossier("transport");
  const camps = chargerDossier("camps");

  const erreurs = validerReferences({ partners, tags, establishments, activities, rooms, events, transport, camps });
  if (erreurs.length) {
    console.error("mockData/ invalide — corriger avant de réessayer :");
    for (const erreur of erreurs) console.error(`  - ${erreur}`);
    process.exit(1);
  }

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const admin = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: erreurConnexionAdmin } = await admin.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (erreurConnexionAdmin) throw new Error(`connexion admin (${ADMIN_EMAIL}) : ${erreurConnexionAdmin.message}`);

  console.log("==> mock data (partenaires, tags, établissements, activités, photos)");

  const resultatPartenaires = await creerPartenaires(admin, svc, partners);
  console.log(
    `   partenaires : ${resultatPartenaires.crees} créé(s), ${resultatPartenaires.ignores} ignoré(s)` +
      ` — personnes : ${resultatPartenaires.personnesCreees} créée(s), ${resultatPartenaires.personnesIgnorees} ignorée(s)` +
      (resultatPartenaires.personnesSansMotDePasse
        ? `, ${resultatPartenaires.personnesSansMotDePasse} sans compte (pas de mot de passe : poser MOCK_PERSONNE_MDP)`
        : "")
  );

  const resultatTags = await creerTags(admin, svc, tags);
  console.log(`   tags : ${resultatTags.crees} créé(s), ${resultatTags.ignores} ignoré(s)`);

  const idAmenityParSlug = await chargerAmenitiesExistantes(admin);

  const resultatEtablissements = await creerEtablissements(
    admin,
    svc,
    establishments,
    resultatPartenaires.idParCle,
    idAmenityParSlug
  );
  console.log(
    `   établissements : ${resultatEtablissements.crees} créé(s), ${resultatEtablissements.ignores} ignoré(s), ` +
      `${resultatEtablissements.photosTeleversees} photo(s)`
  );

  const resultatActivites = await creerProduits(
    admin,
    svc,
    activities,
    { dossier: "activities", type: "activity" },
    resultatPartenaires.idParCle,
    resultatEtablissements.idParCle,
    resultatTags.idParCle,
    idAmenityParSlug
  );
  console.log(
    `   activités : ${resultatActivites.crees} créée(s), ${resultatActivites.ignores} ignorée(s), ` +
      `${resultatActivites.photosTeleversees} photo(s)`
  );

  const resultatChambres = await creerProduits(
    admin,
    svc,
    rooms,
    { dossier: "rooms", type: "lodging" },
    resultatPartenaires.idParCle,
    resultatEtablissements.idParCle,
    resultatTags.idParCle,
    idAmenityParSlug
  );
  console.log(
    `   chambres : ${resultatChambres.crees} créée(s), ${resultatChambres.ignores} ignorée(s), ` +
      `${resultatChambres.photosTeleversees} photo(s)`
  );

  const resultatEvenements = await creerProduits(
    admin,
    svc,
    events,
    { dossier: "events", type: "evento" },
    resultatPartenaires.idParCle,
    resultatEtablissements.idParCle,
    resultatTags.idParCle,
    idAmenityParSlug
  );
  console.log(
    `   événements : ${resultatEvenements.crees} créé(s), ${resultatEvenements.ignores} ignoré(s), ` +
      `${resultatEvenements.photosTeleversees} photo(s)`
  );

  const resultatTransport = await creerProduits(
    admin,
    svc,
    transport,
    { dossier: "transport", type: "transport" },
    resultatPartenaires.idParCle,
    resultatEtablissements.idParCle,
    resultatTags.idParCle,
    idAmenityParSlug
  );
  console.log(
    `   transports : ${resultatTransport.crees} créé(s), ${resultatTransport.ignores} ignoré(s), ` +
      `${resultatTransport.photosTeleversees} photo(s)`
  );

  const resultatCamps = await creerProduits(
    admin,
    svc,
    camps,
    { dossier: "camps", type: "camp" },
    resultatPartenaires.idParCle,
    resultatEtablissements.idParCle,
    resultatTags.idParCle,
    idAmenityParSlug
  );
  console.log(
    `   camps : ${resultatCamps.crees} créé(s), ${resultatCamps.ignores} ignoré(s), ` +
      `${resultatCamps.photosTeleversees} photo(s)`
  );
}

main().catch((erreur) => {
  console.error(erreur.message);
  process.exit(1);
});
