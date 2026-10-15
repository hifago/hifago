-- Fiche établissement : le partenaire propose tout ce que l'admin édite (migration 20261015004421,
-- demande du 2026-10-14) — séjour (check-in, check-out, mode), contact WhatsApp public, étiquettes
-- et équipements, en ÉDITION comme en CRÉATION.
--
-- Chaque clé traverse une validation au dépôt PUIS une écriture explicite à l'approbation. Un oubli
-- dans l'une ou l'autre jette la valeur EN SILENCE, entièrement côté Postgres : aucun test
-- TypeScript ne peut le voir (même classe de panne que proposal_edit_tags.test.sql).
--
-- Ce fichier prouve aussi ce qui ne se prouve qu'ici :
--   * la FORME GARDÉE — une proposition sans ces clés n'efface rien ;
--   * operated_directly, jamais proposable, survit à l'approbation ;
--   * une valeur invalide est refusée AU DÉPÔT, et une correction admin invalide n'écrit RIEN ;
--   * un lieu (is_place) refuse un mode d'hébergement avant que la contrainte ne casse l'approbation ;
--   * les deux fonctions internes ne sont exécutables ni par anon ni par authenticated.
begin;
select plan(36);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('e5ab0000-0000-4000-8000-000000000001', 'Paridad Ficha Test');

-- E : l'établissement édité, avec un état de départ complet. operated_directly = true : la seule
-- façon de prouver que l'approbation le relit au lieu de le remettre à sa valeur par défaut.
-- L : un LIEU du même partenaire.
insert into establishments (id, partner_id, name, operated_directly, check_in_time, check_out_time, mode, contact_phone) values
  ('e5ab0000-0000-4000-8000-000000000011', 'e5ab0000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Hostal Paridad'), true, '15:00', '11:00', 'rooms', '+573001112233');
insert into establishments (id, partner_id, name, is_place) values
  ('e5ab0000-0000-4000-8000-000000000012', 'e5ab0000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Pueblo Paridad'), true);

insert into auth.users (id, email) values
  ('e5ab0000-0000-4000-8000-000000000021', 'paridad-socio@test.local'),
  ('e5ab0000-0000-4000-8000-000000000024', 'paridad-admin@test.local');

update partner_accounts set partner_id = 'e5ab0000-0000-4000-8000-000000000001'
 where id = 'e5ab0000-0000-4000-8000-000000000021';

insert into partner_capabilities (partner_id, role, source, status, establishment_id) values
  ('e5ab0000-0000-4000-8000-000000000001', 'operator', 'migration', 'active',
   'e5ab0000-0000-4000-8000-000000000011'),
  ('e5ab0000-0000-4000-8000-000000000001', 'operator', 'migration', 'active',
   'e5ab0000-0000-4000-8000-000000000012');
insert into partner_capabilities (account_id, role, source, status) values
  ('e5ab0000-0000-4000-8000-000000000024', 'admin', 'migration', 'active');

insert into catalog_tags (id, label, slug) values
  ('e5ab0000-0000-4000-8000-0000000000b1', jsonb_build_object('es', 'Etiqueta Uno'), 'paridad-test-etiqueta-uno'),
  ('e5ab0000-0000-4000-8000-0000000000b2', jsonb_build_object('es', 'Etiqueta Dos'), 'paridad-test-etiqueta-dos');

insert into catalog_amenity_categories (key, label) values
  ('paridad_test', jsonb_build_object('es', 'Categoría de prueba'));
insert into catalog_amenities (id, label, slug, category_key) values
  ('e5ab0000-0000-4000-8000-0000000000a1', jsonb_build_object('es', 'Equipo Uno'), 'paridad-test-uno', 'paridad_test'),
  ('e5ab0000-0000-4000-8000-0000000000a2', jsonb_build_object('es', 'Equipo Dos'), 'paridad-test-dos', 'paridad_test'),
  ('e5ab0000-0000-4000-8000-0000000000a3', jsonb_build_object('es', 'Equipo Tres'), 'paridad-test-tres', 'paridad_test');

-- État de départ : E porte l'équipement « Uno » et l'étiquette « Uno ».
insert into establishment_amenity_assignments (establishment_id, amenity_id) values
  ('e5ab0000-0000-4000-8000-000000000011', 'e5ab0000-0000-4000-8000-0000000000a1');
insert into establishment_tag_assignments (establishment_id, tag_id) values
  ('e5ab0000-0000-4000-8000-000000000011', 'e5ab0000-0000-4000-8000-0000000000b1');

-- Lectures uniques pour toutes les assertions.
create function sejour(p_id uuid) returns text language sql as $$
  select concat_ws(' / ', check_in_time::text, check_out_time::text, mode)
    from public.establishments where id = p_id;
$$;
create function contacto(p_id uuid) returns text language sql as $$
  select contact_phone from public.establishments where id = p_id;
$$;
create function equipos(p_id uuid) returns text language sql as $$
  select coalesce(string_agg(c.slug, ',' order by c.slug), '')
    from public.establishment_amenity_assignments a join public.catalog_amenities c on c.id = a.amenity_id
   where a.establishment_id = p_id;
$$;
create function etiquetas(p_id uuid) returns text language sql as $$
  select coalesce(string_agg(t.slug, ',' order by t.slug), '')
    from public.establishment_tag_assignments a join public.catalog_tags t on t.id = a.tag_id
   where a.establishment_id = p_id;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- A. ÉDITION — dépôt : tout entre, filtré et normalisé ; rien n'est écrit
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('e5ab0000-0000-4000-8000-000000000021');
create temp table tmp_a as
  select submit_establishment_edit_proposal(
    'e5ab0000-0000-4000-8000-000000000011'::uuid,
    jsonb_build_object(
      'name', jsonb_build_object('es', 'Hostal Paridad'),
      'check_in_time', '14:00', 'check_out_time', '10:30', 'mode', 'whole_house',
      'contact_phone', ' +573009998877 ',
      'amenity_ids', jsonb_build_array(
        'e5ab0000-0000-4000-8000-0000000000a3', 'e5ab0000-0000-4000-8000-0000000000a2',
        'esto-no-es-un-uuid', 'e5ab0000-0000-4000-8000-0000000000ff'),
      'tag_ids', jsonb_build_array('e5ab0000-0000-4000-8000-0000000000b2')
    )
  ) as r;

select is((select r->>'ok' from tmp_a), 'true', 'édition, dépôt : la proposition complète est acceptée');

select is(
  (select jsonb_build_array(payload -> 'check_in_time', payload -> 'check_out_time', payload -> 'mode')
     from establishment_proposals where id = (select (r->>'proposal_id')::uuid from tmp_a)),
  jsonb_build_array('14:00', '10:30', 'whole_house'),
  'édition, dépôt : les trois clés du séjour traversent ensemble'
);

select is(
  (select payload ->> 'contact_phone' from establishment_proposals
    where id = (select (r->>'proposal_id')::uuid from tmp_a)),
  '+573009998877',
  'édition, dépôt : le contact est nettoyé de ses espaces'
);

select is(
  (select payload -> 'amenity_ids' from establishment_proposals
    where id = (select (r->>'proposal_id')::uuid from tmp_a)),
  -- Ordre du slug (« dos » avant « tres ») : le tableau est RECONSTRUIT depuis catalog_amenities.
  jsonb_build_array('e5ab0000-0000-4000-8000-0000000000a2', 'e5ab0000-0000-4000-8000-0000000000a3'),
  'édition, dépôt : l''id mal formé et l''id inconnu sont écartés des équipements'
);

select is(
  concat_ws(' | ', sejour('e5ab0000-0000-4000-8000-000000000011'), contacto('e5ab0000-0000-4000-8000-000000000011'),
            equipos('e5ab0000-0000-4000-8000-000000000011')),
  '15:00:00 / 11:00:00 / rooms | +573001112233 | paridad-test-uno',
  'édition, dépôt : rien n''est écrit avant l''approbation'
);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- B. ÉDITION — approbation : tout est écrit, operated_directly survit
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('e5ab0000-0000-4000-8000-000000000024');
select is(
  (select moderate_establishment_proposal((select (r->>'proposal_id')::uuid from tmp_a), 'approve', 1)->>'ok'),
  'true', 'édition : l''approbation réussit');

select is(sejour('e5ab0000-0000-4000-8000-000000000011'), '14:00:00 / 10:30:00 / whole_house',
  'édition, approbation : check-in, check-out et mode écrits');
select is(contacto('e5ab0000-0000-4000-8000-000000000011'), '+573009998877',
  'édition, approbation : contact écrit');
select is(equipos('e5ab0000-0000-4000-8000-000000000011'), 'paridad-test-dos,paridad-test-tres',
  'édition, approbation : « Uno » retiré, « Dos » et « Tres » posés');
select is(etiquetas('e5ab0000-0000-4000-8000-000000000011'), 'paridad-test-etiqueta-dos',
  'édition, approbation : les étiquettes passent toujours par le même chemin');
select is(
  (select operated_directly from establishments where id = 'e5ab0000-0000-4000-8000-000000000011'),
  true, 'édition, approbation : operated_directly, jamais proposable, n''est pas remis à false');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- C. FORME GARDÉE — une simple correction de nom n'efface rien
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('e5ab0000-0000-4000-8000-000000000021');
create temp table tmp_c as
  select (submit_establishment_edit_proposal(
    'e5ab0000-0000-4000-8000-000000000011'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Hostal Paridad Renombrado'))
  )->>'proposal_id')::uuid as id;

select is(
  (select payload ?| array['check_in_time', 'check_out_time', 'mode', 'contact_phone', 'amenity_ids', 'tag_ids']
     from establishment_proposals where id = (select id from tmp_c)),
  false, 'forme gardée, dépôt : aucune des clés n''entre dans le payload (ni même à null)');

select test_login('e5ab0000-0000-4000-8000-000000000024');
select is(
  (select moderate_establishment_proposal((select id from tmp_c), 'approve', 1)->>'ok'),
  'true', 'forme gardée : l''approbation réussit');

select is(
  concat_ws(' | ', sejour('e5ab0000-0000-4000-8000-000000000011'), contacto('e5ab0000-0000-4000-8000-000000000011'),
            equipos('e5ab0000-0000-4000-8000-000000000011'), etiquetas('e5ab0000-0000-4000-8000-000000000011')),
  '14:00:00 / 10:30:00 / whole_house | +573009998877 | paridad-test-dos,paridad-test-tres | paridad-test-etiqueta-dos',
  'forme gardée, approbation : séjour, contact, équipements et étiquettes intacts'
);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- D. REFUS AU DÉPÔT — une valeur invalide ne devient jamais une proposition
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('e5ab0000-0000-4000-8000-000000000021');
create temp table tmp_d_avant as
  select count(*) as n from establishment_proposals where partner_id = 'e5ab0000-0000-4000-8000-000000000001';

select is(
  submit_establishment_edit_proposal('e5ab0000-0000-4000-8000-000000000011'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Hostal Paridad'), 'contact_phone', '3001234567')) ->> 'reason',
  'invalid_phone', 'dépôt : un numéro hors E.164 est refusé');

select is(
  submit_establishment_edit_proposal('e5ab0000-0000-4000-8000-000000000011'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Hostal Paridad'),
                       'check_in_time', '25:00', 'check_out_time', '10:00', 'mode', null)) ->> 'reason',
  'invalid_time', 'dépôt : une heure hors domaine est refusée');

select is(
  submit_establishment_edit_proposal('e5ab0000-0000-4000-8000-000000000011'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Hostal Paridad'),
                       'check_in_time', null, 'check_out_time', null, 'mode', 'hotel')) ->> 'reason',
  'invalid_mode', 'dépôt : un mode hors domaine est refusé');

select is(
  submit_establishment_edit_proposal('e5ab0000-0000-4000-8000-000000000011'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Hostal Paridad'), 'check_in_time', '13:00')) ->> 'reason',
  'stay_incomplete',
  'dépôt : une heure seule est refusée — elle ferait effacer les deux autres valeurs du séjour');

select is(
  submit_establishment_edit_proposal('e5ab0000-0000-4000-8000-000000000012'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Pueblo Paridad'),
                       'check_in_time', null, 'check_out_time', null, 'mode', 'rooms')) ->> 'reason',
  'place_has_no_stay_mode', 'dépôt : un lieu ne reçoit pas de mode d''hébergement');

select is(
  (select count(*) from establishment_proposals where partner_id = 'e5ab0000-0000-4000-8000-000000000001'),
  (select n from tmp_d_avant), 'dépôt : aucun refus n''a créé de proposition');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- E. CORRECTION ADMIN — invalide, elle n'écrit RIEN ; vide, elle retire le contact
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
create temp table tmp_e as
  select (submit_establishment_edit_proposal(
    'e5ab0000-0000-4000-8000-000000000011'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Hostal Paridad Corregido'), 'contact_phone', '+573001110000')
  )->>'proposal_id')::uuid as id;

select test_login('e5ab0000-0000-4000-8000-000000000024');
select is(
  (select moderate_establishment_proposal((select id from tmp_e), 'approve', 1,
     jsonb_build_object('name', jsonb_build_object('es', 'Hostal Paridad Corregido'), 'contact_phone', 'abc')) ->> 'reason'),
  'invalid_phone', 'correction admin : un numéro invalide est refusé à l''approbation');

select is(
  (select concat_ws(' | ', p.status, e.name ->> 'es', e.contact_phone)
     from establishment_proposals p join establishments e on e.id = p.establishment_id
    where p.id = (select id from tmp_e)),
  'pending | Hostal Paridad Renombrado | +573009998877',
  'correction admin refusée : la proposition reste en attente et RIEN n''est écrit, pas même le nom');

select is(
  (select moderate_establishment_proposal((select id from tmp_e), 'approve', 1,
     jsonb_build_object('name', jsonb_build_object('es', 'Hostal Paridad Corregido'), 'contact_phone', null)) ->> 'ok'),
  'true', 'correction admin : vider le contact est accepté');

select is(contacto('e5ab0000-0000-4000-8000-000000000011'), null::text,
  'correction admin : le contact vidé par l''admin retire le bouton WhatsApp');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- F. Un tableau VIDE retire tous les équipements (demande explicite, pas une absence)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('e5ab0000-0000-4000-8000-000000000021');
create temp table tmp_f as
  select (submit_establishment_edit_proposal(
    'e5ab0000-0000-4000-8000-000000000011'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Hostal Paridad Corregido'), 'amenity_ids', '[]'::jsonb)
  )->>'proposal_id')::uuid as id;

select test_login('e5ab0000-0000-4000-8000-000000000024');
select is(
  (select moderate_establishment_proposal((select id from tmp_f), 'approve', 1)->>'ok'),
  'true', 'tableau vide : l''approbation réussit');
select is(equipos('e5ab0000-0000-4000-8000-000000000011'), '',
  'tableau vide : tous les équipements sont retirés');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- G. CRÉATION — tout ce que le partenaire remplit est posé sur le nouvel établissement
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('e5ab0000-0000-4000-8000-000000000021');
create temp table tmp_g as
  select (submit_establishment_creation_proposal(
    jsonb_build_object(
      'name', jsonb_build_object('es', 'Hostal Paridad Nuevo'),
      'check_in_time', '09:00', 'check_out_time', '12:00', 'mode', 'rooms',
      'contact_phone', '+573004445566',
      'amenity_ids', jsonb_build_array('e5ab0000-0000-4000-8000-0000000000a1'),
      'tag_ids', jsonb_build_array('e5ab0000-0000-4000-8000-0000000000b1', 'esto-no-es-un-uuid')
    )
  )->>'proposal_id')::uuid as id;

select is(
  (select payload -> 'tag_ids' from establishment_proposals where id = (select id from tmp_g)),
  jsonb_build_array('e5ab0000-0000-4000-8000-0000000000b1'),
  'création, dépôt : les étiquettes entrent désormais, filtrées comme en édition'
);

select test_login('e5ab0000-0000-4000-8000-000000000024');
select is(
  (select moderate_establishment_proposal((select id from tmp_g), 'approve', 1)->>'ok'),
  'true', 'création : l''approbation réussit');

create temp table tmp_g_nuevo as
  select establishment_id as id from establishment_proposals where id = (select id from tmp_g);

select isnt((select id from tmp_g_nuevo), null, 'création : l''établissement existe');
select is(sejour((select id from tmp_g_nuevo)), '09:00:00 / 12:00:00 / rooms',
  'création, approbation : le séjour est posé');
select is(contacto((select id from tmp_g_nuevo)), '+573004445566',
  'création, approbation : le contact est posé');
select is(
  concat_ws(' | ', equipos((select id from tmp_g_nuevo)), etiquetas((select id from tmp_g_nuevo))),
  'paridad-test-uno | paridad-test-etiqueta-uno',
  'création, approbation : équipements et étiquettes sont posés');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- H. Les deux fonctions internes restent internes
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select is(has_function_privilege('anon', 'public.establishment_proposal_details(jsonb)', 'execute'), false,
  'establishment_proposal_details : fermée à anon');
select is(has_function_privilege('authenticated', 'public.establishment_proposal_details(jsonb)', 'execute'), false,
  'establishment_proposal_details : fermée à authenticated');
select is(has_function_privilege('anon', 'public.apply_establishment_proposal_details(uuid, jsonb)', 'execute'), false,
  'apply_establishment_proposal_details : fermée à anon');
select is(has_function_privilege('authenticated', 'public.apply_establishment_proposal_details(uuid, jsonb)', 'execute'), false,
  'apply_establishment_proposal_details : fermée à authenticated — un socio ne s''écrit jamais rien lui-même');

select * from finish();
rollback;
