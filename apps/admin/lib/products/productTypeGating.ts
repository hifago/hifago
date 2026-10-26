import { productTypeHasMaxQty, productTypeHasMinQty } from "@hifago/domain";

// Correctif — bug PRÉ-EXISTANT trouvé en vérifiant la spec 21 (connecteur LobbyPMS), SANS LIEN
// avec elle : confirmé présent dans le dernier commit (bb254e9, avant toute modification de cette
// session) via `git show HEAD:apps/admin/app/admin/products/[id]/edit/page.tsx`. Jamais corrigé en
// silence (hifago/CLAUDE.md, avant-la-spec.md §7) — signalé explicitement dans le rapport de fin de
// session.
//
// Root cause : productTypeGating/ProductType vivaient dans useProductTypeFieldsState.ts, qui porte
// "use client" (nécessaire pour son hook React). app/admin/products/[id]/edit/page.tsx (Server
// Component) importait productTypeGating depuis ce fichier — Next.js App Router traite TOUT export
// d'un module "use client" comme une référence client sérialisée, même une fonction pure sans
// aucun hook : « Attempted to call productTypeGating() from the server but productTypeGating is on
// the client » (erreur 500 constatée en faisant tourner admin-product-lodging.spec.ts et
// admin-product-create.spec.ts). Correctif : extraire la logique de gating, purement synchrone et
// sans state, dans CE fichier SANS "use client" — utilisable aussi bien depuis un Server Component
// que depuis un Client Component. useProductTypeFieldsState.ts réexporte ce module pour ne casser
// aucun import existant côté client.
// T3 (spec 24 §4) — `hotel` retiré le 2026-08-27. Cet étage dupliquait l'établissement au niveau
// produit : il n'existe ni chez LobbyPMS (propriété → catégories, sans intermédiaire) ni dans la
// v1, et il rendait un hôtel structurellement inconnectable à un PMS (isPmsBacked = lodging +
// lobby_category_id). Une chambre est désormais un `lodging` portant son `lodging_kind`, et
// c'est l'établissement qui porte le lieu. La création était fermée depuis le 2026-08-26 ; la
// préprod ne comptait aucun hôtel, aucun type de chambre, aucune commande — code mort, pas une
// migration de données.
export type ProductType = "activity" | "evento" | "camp" | "lodging" | "transport";

// Gating par type — miroir exact de ProductForm (spec 11/12/13/14), la SEULE définition de ces 3
// booléens dans tout le projet : ProductForm, ProductTypeFields et
// ModerateProductCreationProposalForm l'importent tous d'ici plutôt que de la recalculer chacun de
// leur côté (risque de divergence déjà rencontré à chaque évolution de gating, specs 11→14).
export function productTypeGating(type: ProductType) {
  const isEvento = type === "evento";
  const isCamp = type === "camp";
  const isActivity = type === "activity";
  const isLodging = type === "lodging";
  const isTransport = type === "transport";
  return {
    isEvento,
    isCamp,
    isActivity,
    isLodging,
    isTransport,
    // `isTransport` RETIRÉ le 2026-09-16 (demande Jérôme, migration 20260916150000) : un trajet a
    // DEUX extrémités, donc ses propres colonnes dédiées `transport_departure_*` /
    // `transport_arrival_*` et ses propres blocs de saisie (« Lugar de salida » / « Lugar de
    // llegada », cf. product-type-fields.tsx). Le trio générique `address`/`lat`/`lon` n'est plus
    // ni exposé ni écrit pour ce type — données transférées par la migration, `transport` retiré
    // des whitelists `address` des 4 RPC de proposition. Continuer à l'exposer ici aurait laissé
    // DEUX champs d'adresse sur le même formulaire, donc deux sources de vérité pour un seul lieu.
    // ⚠️ Les TAGS d'un transport ne sont pas touchés : ils ont leur propre booléen (`hasTags`
    // ci-dessous, qui garde `isTransport`) depuis le retour Jérôme du 2026-08-18. Le nom
    // `hasLocationAndTags` est donc trompeur depuis cette date-là, pas depuis ce lot — renommage
    // cosmétique laissé de côté volontairement (4 fichiers, zéro effet fonctionnel).
    hasLocationAndTags: isActivity || isLodging,
    // Retour Jérôme (2026-08-18) : un camp a aussi des "servicios incluidos" (desayuno, transporte,
    // guía…) qui doivent être des tags comme pour les autres types, pour pouvoir un jour trier/
    // filtrer dessus — camp n'a en revanche pas besoin d'adresse propre (déjà celle de son
    // établissement), d'où un booléen SÉPARÉ de hasLocationAndTags plutôt qu'un ajout à ce dernier
    // (qui aurait aussi fait apparaître les champs adresse/lat/lon, jamais demandés pour camp).
    // `evento` rejoint hasTags le 2026-09-14 (chantier "catégories partout" — Jérôme : "tout doit
    // pouvoir en avoir") — même raisonnement que camp, pas d'adresse propre non plus, donc toujours
    // absent de hasLocationAndTags.
    hasTags: isActivity || isLodging || isTransport || isCamp || isEvento,
    // Équipements structurés (migration 20260917110000, décision Jérôme du 2026-09-17) — logement
    // UNIQUEMENT côté produit (l'établissement, lui, est toujours éligible, sans gating — cf.
    // EstablishmentAmenitiesBlock.tsx, même raisonnement que hasTags côté établissement). Table
    // dédiée `catalog_amenities`, jamais `catalog_tags` : mélanger polluerait les catégories
    // éditoriales d'activités branchées sur search_catalog/`/actividades`.
    hasAmenities: isLodging,
    hasPriceQtyFields: isActivity || isLodging || isTransport,
    // Bornes de quantité PAR RÉSERVATION (décision Jérôme du 2026-10-25, migration 20261025120000).
    // Un produit à cupo n'a plus de maximum : un client peut prendre tout ce qui reste — seul le
    // transport le garde. Le minimum reste pour l'activité (taille de groupe) et le transport, jamais
    // pour un logement (create_order ne l'a jamais vérifié). La base refuse les deux hors de ces
    // types (products_max_qty_only_without_cupo / products_min_qty_not_lodging).
    hasMinQty: (isActivity || isLodging || isTransport) && productTypeHasMinQty(type),
    hasMaxQty: (isActivity || isLodging || isTransport) && productTypeHasMaxQty(type),
    hasCheckInOut: isLodging,
    // Types qui matérialisent product_availability — seuls ceux-là peuvent porter un cupo par
    // défaut. evento : pas encore réellement réservable côté client, toujours hors périmètre.
    // lodging : INCLUS depuis le 2026-09-13 (migration 20260913100000_lodging_default_
    // availability.sql, décision Jérôme) — le calendrier d'une chambre est désormais ouvert par
    // défaut (fenêtre glissante de 6 mois matérialisée à la création + cron quotidien), le
    // partenaire ferme seulement les jours déjà pris. Si ce champ reste vide, la RPC calcule
    // elle-même la valeur (resolve_lodging_default_capacity) — le champ n'est PAS pré-rempli côté
    // formulaire (pas fait, resterait à ajouter si on veut que le partenaire voie/ajuste la valeur
    // avant de valider plutôt que de la découvrir après coup).
    // `isTransport` RETIRÉ le 2026-09-17 (décision Jérôme : un transport ne se réserve plus en
    // ligne, il se contacte). Sans calendrier, aucune ligne de `product_availability` n'est jamais
    // matérialisée pour ce type et `create_order` ne le traverse plus : le champ serait INERTE tout
    // en affichant « 40 », donc en faisant croire à un plafond réel. La migration 20260917100000
    // vide les valeurs posées par mockData. Aligne enfin l'écran sur docs/specs/14 §0, qui écrivait
    // depuis le début « pas de capacité produit, capacity_default=NULL en V1 — le transporteur
    // dispatche son propre parc ».
    hasDefaultCapacity: isActivity || isCamp || isLodging,
    // Remise par seuil de remplissage cumulé (migration 20260914130000, demande Jérôme du
    // 2026-09-14) — camp UNIQUEMENT, imposé aussi côté base (products_group_discount_camp_only) :
    // seul ce type a aujourd'hui un remplissage cumulé fiable par départ (product_availability).
    // Étendre à activité/transport/evento serait un chantier distinct, pas une omission ici.
    hasGroupDiscount: isCamp,
    // Programme jour par jour (migration 20260916130000, demande Jérôme du 2026-09-16) — camp
    // UNIQUEMENT, imposé aussi côté base (products_program_camp_only). L'evento portait lui aussi
    // un programme en V1 et docs/00-modele-de-donnees.md §4b le prévoit, mais Jérôme a scopé ce
    // lot au camp : l'ouvrir plus tard = relever ce booléen ET le CHECK, jamais l'un sans l'autre.
    hasProgram: isCamp,
  };
}

// Quel(s) écran(s) de cupos/disponibilité afficher pour un produit, à partir de son type et de la
// présence d'au moins une règle de créneaux (product_slot_rules) — SEULE définition de ce gating
// dans tout le projet (avant cette extraction, dupliqué ad hoc entre
// apps/admin/app/admin/products/[id]/edit/page.tsx — showAvailabilityLink/isHotel/isActivity &&
// slotRulesRaw.length > 0 — et apps/admin/app/partner/(app)/products/ProductsGrid.tsx, qui se
// contentait de commenter "même gating de type que .../edit/page.tsx" sans jamais rien importer).
// 'slot' N'EXCLUT PAS 'generic' : une activité qui porte des règles de créneaux garde son lien
// générique product_availability (cupo/estado par jour) EN PLUS du lien horaires×dates dédié — les
// deux calendriers sont indépendants, jamais l'un à la place de l'autre. Les appelants traitent
// donc 'slot' comme "afficher le lien générique ET le lien créneaux", pas comme un remplacement
// (cf. leur propre commentaire au point d'appel).
export function availabilityScreenFor(
  type: ProductType,
  hasSlotRules: boolean,
  isPmsBacked: boolean,
  // Evento réservable en ligne (2026-09-15) : un evento en mode 'metered' matérialise désormais
  // product_availability comme activity/camp — même écran générique. Les modes 'unlimited'/'rsvp'
  // et un evento non activé restent 'none' (rien à décompter, aucun calendrier de cupos à ouvrir).
  //
  // REQUIS lui aussi, pour la raison écrite juste en dessous pour `isPmsBacked` : posé d'abord avec
  // un `= null`, il avait laissé le portail socio compiler à trois arguments, donc afficher 'none'
  // là où l'admin affichait 'generic' pour le MÊME produit — la divergence exacte que ce défaut
  // était censé rendre impossible.
  eventoCapacityMode: "unlimited" | "metered" | "rsvp" | null,
): "generic" | "slot" | "none" | "pms" {
  // Ajouté le 2026-08-26. Un logement PMS-backed (lodging + lobby_category_id) ne décrémente
  // JAMAIS product_availability : create_order saute explicitement verrou et décrément pour lui,
  // Lobby étant seule source de vérité de la capacité (20260819130000_create_order_pms_backed.sql).
  // Sa table de cupos est donc structurellement vide, et le lien « Calendario & cupos » ouvrait un
  // calendrier inerte — un écran qui laisse croire qu'on peut y ouvrir ou fermer des dates alors
  // que rien de ce qu'on y ferait ne serait lu. 'pms' n'est pas 'none' : l'appelant doit dire
  // POURQUOI il n'y a pas de calendrier, pas se contenter de ne rien afficher.
  //
  // Le paramètre est volontairement REQUIS, pas optionnel avec un défaut : cette fonction est la
  // seule définition de ce gating et elle a deux appelants (admin et socio). Un défaut aurait
  // laissé le portail socio compiler en gardant l'ancien comportement, sans que rien ne le signale.
  if (isPmsBacked) return "pms";
  if (type === "evento") return eventoCapacityMode === "metered" ? "generic" : "none";
  if (type === "activity" && hasSlotRules) return "slot";
  return "generic";
}
