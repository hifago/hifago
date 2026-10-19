-- Retour Jérôme (2026-08-19, refonte vue prestataire) — "Proponer un nuevo establecimiento" n'avait
-- jusqu'ici aucun champ photo (contrairement à la création de produit, product_creation_proposal.
-- test.sql, et à l'édition d'établissement, PhotosSocioBlock). Migration
-- 20260819200000_establishment_creation_proposal_photos.sql comble le gap en répliquant le patron
-- déjà couvert côté produit. Ce fichier ne re-teste jamais les garde-fous déjà exhaustivement
-- couverts avant cette session (identité/nom requis/plafond de création, cf. commentaire de tête de
-- 20260815170000_gestion_etablissement.sql, jamais eu son propre pgTAP mais stable depuis) — il
-- couvre uniquement le NOUVEAU comportement photos : whitelist/plafond à la soumission,
-- rattachement à establishment_media à l'approbation, préservation à travers p_corrected_payload.
begin;
select plan(14);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('88970000-0000-4000-8000-000000000001', 'Establishment Photos Test Partner');
insert into auth.users (id, email) values
  ('88970000-0000-4000-8000-000000000021', 'establishment-photos-partner@test.local'),
  ('88970000-0000-4000-8000-000000000022', 'establishment-photos-admin@test.local');
update partner_accounts set partner_id = '88970000-0000-4000-8000-000000000001'
 where id = '88970000-0000-4000-8000-000000000021';
-- Invariant enforce_operator_implies_referrer : create_establishment (appelée à l'approbation)
-- attache toujours une capacité operator au partenaire, qui exige une capacité referrer
-- préexistante — même fixture que product_creation_proposal.test.sql.
insert into partner_capabilities (partner_id, role, source, status) values
  ('88970000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active');
insert into partner_capabilities (account_id, role, source, status) values
  ('88970000-0000-4000-8000-000000000022', 'admin', 'migration', 'active');

set local role authenticated;
select test_login('88970000-0000-4000-8000-000000000021');

-- Cas 1 : plafond 6 photos, même invariant que submit_product_creation_proposal ------------------
select is(
  (select submit_establishment_creation_proposal(jsonb_build_object(
     'name', jsonb_build_object('es', 'Hostal Cap Fotos'), 'contact_phone', '+573001234567',
     'photos', (select jsonb_agg(jsonb_build_object('storage_path', 'p/' || gs || '.webp'))
                  from generate_series(1, 7) gs)
   ))->>'reason'),
  'gallery_cap_exceeded',
  'cas 1 : 7 photos (>6) → gallery_cap_exceeded'
);

-- Cas 2 : whitelist stricte — seul storage_path est conservé, tout autre champ est ignoré, une
-- entrée sans storage_path (ou vide) est éliminée silencieusement (même discipline que la version
-- produit) ------------------------------------------------------------------------------------
create temp table tmp_create_photos as
  select submit_establishment_creation_proposal(jsonb_build_object(
    'name', jsonb_build_object('es', 'Hostal Con Fotos'), 'contact_phone', '+573001234567',
    'operated_directly', true,
    'photos', jsonb_build_array(
      jsonb_build_object('storage_path', 'estab/1.webp', 'evil_field', 'x'),
      jsonb_build_object('storage_path', ''),
      jsonb_build_object('storage_path', 'estab/2.webp')
    )
  )) as result;

select is(
  (select result->>'ok' from tmp_create_photos), 'true',
  'cas 2 : soumission avec 3 entrées photos (1 vide) → succès'
);
select is(
  (select jsonb_array_length(payload -> 'photos') from establishment_proposals
    where id = (select (result->>'proposal_id')::uuid from tmp_create_photos)),
  2,
  'cas 2 : l''entrée storage_path vide est éliminée, 2 photos valides conservées'
);
select is(
  (select payload -> 'photos' from establishment_proposals
    where id = (select (result->>'proposal_id')::uuid from tmp_create_photos)),
  jsonb_build_array(
    jsonb_build_object('storage_path', 'estab/1.webp'),
    jsonb_build_object('storage_path', 'estab/2.webp')
  ),
  'cas 2 : whitelist stricte — seul storage_path survit, evil_field jamais persisté'
);
select is(
  (select payload ? 'operated_directly' from establishment_proposals
    where id = (select (result->>'proposal_id')::uuid from tmp_create_photos)),
  false,
  'cas 2 : operated_directly jamais dans le payload whitelisté (classification admin-only)'
);

-- Cas 3 : approbation kind='create' rattache les 2 photos à establishment_media, sort continu
-- depuis 0 (établissement tout juste créé, aucune ligne media préexistante) ---------------------
reset role;
select test_login('88970000-0000-4000-8000-000000000022'); -- admin
set local role authenticated;

create temp table tmp_moderate as
  select moderate_establishment_proposal(
    (select (result->>'proposal_id')::uuid from tmp_create_photos),
    'approve', 1, null, null
  ) as result;

select is(
  (select (result->>'ok')::boolean from tmp_moderate), true,
  'cas 3 : approbation réussie'
);

create temp table tmp_new_establishment as
  select establishment_id as id from establishment_proposals
   where id = (select (result->>'proposal_id')::uuid from tmp_create_photos);

select is(
  (select count(*)::int from establishment_media
    where establishment_id = (select id from tmp_new_establishment)),
  2,
  'cas 3 : les 2 photos proposées sont rattachées à establishment_media après approbation'
);
select is(
  (select jsonb_agg(jsonb_build_object('storage_path', storage_path, 'sort', sort) order by sort)
     from establishment_media where establishment_id = (select id from tmp_new_establishment)),
  jsonb_build_array(
    jsonb_build_object('storage_path', 'estab/1.webp', 'sort', 0),
    jsonb_build_object('storage_path', 'estab/2.webp', 'sort', 1)
  ),
  'cas 3 : sort continu depuis 0, dans l''ordre de soumission'
);

-- Cas 4 : une correction admin sur le nom (p_corrected_payload) ne porte jamais de champ photos —
-- les photos restent celles de la soumission ORIGINALE du socio, jamais effacées silencieusement --
reset role;
select test_login('88970000-0000-4000-8000-000000000021');
set local role authenticated;

create temp table tmp_create_photos_2 as
  select submit_establishment_creation_proposal(jsonb_build_object(
    'name', jsonb_build_object('es', 'Hostal Corregido'), 'contact_phone', '+573001234567',
    'photos', jsonb_build_array(jsonb_build_object('storage_path', 'estab/3.webp'))
  )) as result;

reset role;
select test_login('88970000-0000-4000-8000-000000000022');
set local role authenticated;

create temp table tmp_moderate_2 as
  select moderate_establishment_proposal(
    (select (result->>'proposal_id')::uuid from tmp_create_photos_2),
    'approve', 1,
    jsonb_build_object('name', jsonb_build_object('es', 'Hostal Corregido Por Admin')),
    null
  ) as result;

select is(
  (select (result->>'ok')::boolean from tmp_moderate_2), true,
  'cas 4 : approbation avec correction du nom seule (pas de photos dans p_corrected_payload)'
);

create temp table tmp_new_establishment_2 as
  select establishment_id as id from establishment_proposals
   where id = (select (result->>'proposal_id')::uuid from tmp_create_photos_2);

select is(
  (select count(*)::int from establishment_media
    where establishment_id = (select id from tmp_new_establishment_2)),
  1,
  'cas 4 : la photo originale du socio survit malgré la correction admin sur un autre champ'
);
select is(
  (select name ->> 'es' from establishments
    where id = (select id from tmp_new_establishment_2)),
  'Hostal Corregido Por Admin',
  'cas 4 : le nom corrigé par l''admin est bien celui appliqué (p_corrected_payload prime)'
);

-- Cas 5 : plusieurs propositions de création pending simultanément — retrait du plafond "1 pending
-- par partenaire" (migration 20260819220000_establishment_creation_no_pending_cap.sql, retour
-- Jérôme 2026-08-19, même geste déjà fait côté produit le 2026-08-18). Cas 2/3 et 4 ont chacun
-- approuvé leur proposition avant de passer à la suivante : partenaire 001 n'a plus aucune
-- proposition pending à ce stade, terrain propre pour ce cas. Rebascule sur le partenaire (encore
-- connecté admin depuis le cas 4) avant d'appeler la RPC socio. ------------------------------------
reset role;
select test_login('88970000-0000-4000-8000-000000000021');
set local role authenticated;

select is(
  (select submit_establishment_creation_proposal(jsonb_build_object(
     'name', jsonb_build_object('es', 'Hostal Multi Un'), 'contact_phone', '+573001234567'
   ))->>'ok'),
  'true',
  'cas 5 : 1re proposition de création → succès'
);
select is(
  (select submit_establishment_creation_proposal(jsonb_build_object(
     'name', jsonb_build_object('es', 'Hostal Multi Deux'), 'contact_phone', '+573001234567'
   ))->>'ok'),
  'true',
  'cas 5 : 2e proposition de création alors que la 1re est toujours pending → succès (plus de pending_creation_exists)'
);
select is(
  (select count(*)::int from establishment_proposals
    where partner_id = '88970000-0000-4000-8000-000000000001' and kind = 'create' and status = 'pending'),
  2,
  'cas 5 : les 2 propositions coexistent bien en pending, aucune n''a évincé l''autre'
);

select * from finish();
rollback;
