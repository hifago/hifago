-- Proposition partenaire → modération admin : aucun champ ne se perd en route (migration
-- 20261013212500, constat de Jérôme du 2026-10-13 sur « Exposición Mirarte »).
--
-- Chaque champ d'une proposition traverse une whitelist jsonb au DÉPÔT
-- (submit_product_creation_proposal / submit_product_proposal) PUIS une écriture explicite à
-- l'APPROBATION (create_product_from_proposal / moderate_product_proposal). Un oubli dans l'une
-- des deux jette la valeur EN SILENCE, entièrement côté Postgres : aucun test TypeScript ne peut
-- le voir. Ce fichier prouve les quatre pertes que la migration referme :
--   A. evento, création   — les étiquettes arrivent ;
--   B/C. logement         — le cupo par défaut arrive, et l'approbation ne le vide plus ;
--   D/E/F. evento, édition — date, récurrence, heure et durée arrivent ; sans la clé rien ne
--                            bouge ; une date vide n'efface jamais la date ;
--   G/H. evento réservable — l'approbation ne touche ni au prix ni à l'aforo, et ouvre le cupo de
--                            la nouvelle date ;
--   I. gel                — la date d'un evento qui porte une réservation en cours ne change pas ;
--   J. garde de type      — ces colonnes ne s'écrivent que sur un evento.
--
-- Les payloads « corrigés » passés à moderate_product_proposal reproduisent ce que l'écran de
-- modération envoie (ModerateProposalForm reconstruit tout le payload) : c'est ce chemin-là, pas
-- le dépôt, qui effaçait le prix d'un evento et le cupo d'un logement.
begin;
select plan(30);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('7c880000-0000-4000-8000-000000000001', 'Paridad Test');

insert into establishments (id, partner_id, name) values
  ('7c880000-0000-4000-8000-000000000011', '7c880000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Casa Paridad'));

insert into auth.users (id, email) values
  ('7c880000-0000-4000-8000-000000000021', 'paridad-socio@test.local'),
  ('7c880000-0000-4000-8000-000000000024', 'paridad-admin@test.local'),
  ('7c880000-0000-4000-8000-000000000025', 'paridad-cliente@test.local');

update partner_accounts set partner_id = '7c880000-0000-4000-8000-000000000001'
 where id = '7c880000-0000-4000-8000-000000000021';

insert into partner_capabilities (partner_id, role, source, status) values
  ('7c880000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source, status, establishment_id) values
  ('7c880000-0000-4000-8000-000000000001', 'operator', 'migration', 'active',
   '7c880000-0000-4000-8000-000000000011');
insert into partner_capabilities (account_id, role, source, status) values
  ('7c880000-0000-4000-8000-000000000024', 'admin', 'migration', 'active');

insert into catalog_tags (id, label, slug) values
  ('7c880000-0000-4000-8000-0000000000a1', jsonb_build_object('es', 'Etiqueta Paridad'), 'paridad-test-etiqueta');

-- 031 logement (cupo par défaut 3) · 035 activité.
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                      default_capacity, capacity, unit_count, lodging_kind) values
  ('7c880000-0000-4000-8000-000000000031', '7c880000-0000-4000-8000-000000000001',
   '7c880000-0000-4000-8000-000000000011', 'lodging',
   jsonb_build_object('es', 'Cabaña Paridad'), 80000, false, 'paridad-test-cabana', 3, 2, 3, 'private'),
  ('7c880000-0000-4000-8000-000000000035', '7c880000-0000-4000-8000-000000000001',
   '7c880000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Caminata Paridad'), 50000, false, 'paridad-test-caminata', null, null, null, null);

-- 032 evento vitrine · 033 réservable payant sans cupo · 034 et 036 réservables à cupo compté.
insert into products (id, partner_id, establishment_id, type, name, sellable, slug, price_label,
                      price_cop, default_capacity, online_bookable, evento_capacity_mode,
                      evento_payment_mode, occurrence_type, occurrence_date, start_time) values
  ('7c880000-0000-4000-8000-000000000032', '7c880000-0000-4000-8000-000000000001',
   '7c880000-0000-4000-8000-000000000011', 'evento',
   jsonb_build_object('es', 'Expo Paridad'), false, 'paridad-test-expo', 'Entrada libre',
   null, null, false, null, null, 'once', '2029-12-01', '20:00'),
  ('7c880000-0000-4000-8000-000000000033', '7c880000-0000-4000-8000-000000000001',
   '7c880000-0000-4000-8000-000000000011', 'evento',
   jsonb_build_object('es', 'Concierto Paridad'), false, 'paridad-test-concierto', null,
   50000, null, true, 'unlimited', 'online', 'once', '2029-12-01', '20:00'),
  ('7c880000-0000-4000-8000-000000000034', '7c880000-0000-4000-8000-000000000001',
   '7c880000-0000-4000-8000-000000000011', 'evento',
   jsonb_build_object('es', 'Taller Paridad'), false, 'paridad-test-taller', null,
   50000, 40, true, 'metered', 'online', 'once', '2029-12-01', '20:00'),
  ('7c880000-0000-4000-8000-000000000036', '7c880000-0000-4000-8000-000000000001',
   '7c880000-0000-4000-8000-000000000011', 'evento',
   jsonb_build_object('es', 'Función Paridad'), false, 'paridad-test-funcion', null,
   50000, 40, true, 'metered', 'online', 'once', '2029-12-01', '20:00');

-- Une réservation EN COURS sur 036 : c'est elle qui gèle sa date (section I).
insert into orders (id, account_id, holder_name, holder_email) values
  ('7c880000-0000-4000-8000-000000000041', '7c880000-0000-4000-8000-000000000025',
   'Paridad Holder', 'paridad-cliente@test.local');
insert into order_lines (
  order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '7c880000-0000-4000-8000-000000000041', '7c880000-0000-4000-8000-000000000025',
  '7c880000-0000-4000-8000-000000000036', '2029-12-01', 1, 'reserved', 'Paridad Holder',
  50000, 50000, 'direct', 0, 0, 0, 0, 0, 0
);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- A. CRÉATION d'un evento — les étiquettes choisies par le partenaire arrivent
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7c880000-0000-4000-8000-000000000021');
create temp table tmp_a as
  select (submit_product_creation_proposal(
    '7c880000-0000-4000-8000-000000000011'::uuid, 'evento',
    jsonb_build_object(
      'name', jsonb_build_object('es', 'Expo Nueva Paridad'), 'price_label', 'Gratis',
      'occurrence_type', 'once', 'occurrence_date', '2029-11-01', 'start_time', '16:00',
      'tag_ids', jsonb_build_array('7c880000-0000-4000-8000-0000000000a1')
    )
  )->>'proposal_id')::uuid as id;

select is(
  (select payload -> 'tag_ids' from product_proposals where id = (select id from tmp_a)),
  jsonb_build_array('7c880000-0000-4000-8000-0000000000a1'),
  'création d''un evento, dépôt : tag_ids traverse la whitelist'
);

select test_login('7c880000-0000-4000-8000-000000000024');
create temp table tmp_a_product as
  select (moderate_product_proposal((select id from tmp_a), 'approve', 1)->>'product_id')::uuid as id;

select is(
  (select count(*)::int from product_tag_assignments
    where product_id = (select id from tmp_a_product)
      and tag_id = '7c880000-0000-4000-8000-0000000000a1'),
  1, 'création d''un evento, approbation : l''étiquette proposée est posée');

select is(
  (select occurrence_date::text || ' ' || start_time::text from products where id = (select id from tmp_a_product)),
  '2029-11-01 16:00:00', 'création d''un evento : la date et l''heure arrivent sur la fiche créée');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- B. CRÉATION d'un logement — le cupo par défaut saisi arrive ; sans saisie, il est calculé
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7c880000-0000-4000-8000-000000000021');
create temp table tmp_b as
  select (submit_product_creation_proposal(
    '7c880000-0000-4000-8000-000000000011'::uuid, 'lodging',
    jsonb_build_object('name', jsonb_build_object('es', 'Cabaña Nueva Paridad'), 'price_cop', 90000,
                       'capacity', 2, 'unit_count', 3, 'lodging_kind', 'private', 'default_capacity', 5)
  )->>'proposal_id')::uuid as id;
create temp table tmp_b2 as
  select (submit_product_creation_proposal(
    '7c880000-0000-4000-8000-000000000011'::uuid, 'lodging',
    jsonb_build_object('name', jsonb_build_object('es', 'Cabaña Calculada Paridad'), 'price_cop', 90000,
                       'capacity', 2, 'unit_count', 3, 'lodging_kind', 'private')
  )->>'proposal_id')::uuid as id;

select is(
  (select payload ->> 'default_capacity' from product_proposals where id = (select id from tmp_b)),
  '5', 'création d''un logement, dépôt : default_capacity traverse la whitelist');

select test_login('7c880000-0000-4000-8000-000000000024');
create temp table tmp_b_product as
  select (moderate_product_proposal((select id from tmp_b), 'approve', 1)->>'product_id')::uuid as id;
create temp table tmp_b2_product as
  select (moderate_product_proposal((select id from tmp_b2), 'approve', 1)->>'product_id')::uuid as id;

select is((select default_capacity from products where id = (select id from tmp_b_product)), 5,
  'création d''un logement, approbation : le cupo SAISI par le partenaire est posé');
select is((select default_capacity from products where id = (select id from tmp_b2_product)), 3,
  'création d''un logement sans saisie : le cupo reste calculé (3 unités privées)');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- C. ÉDITION d'un logement — le cupo proposé arrive, et l'approbation ne le vide plus
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7c880000-0000-4000-8000-000000000021');
create temp table tmp_c as
  select (submit_product_proposal(
    '7c880000-0000-4000-8000-000000000031'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Cabaña Paridad'), 'price_cop', 80000,
                       'capacity', 2, 'unit_count', 3, 'lodging_kind', 'private', 'default_capacity', 5)
  )->>'proposal_id')::uuid as id;

select is(
  (select payload ->> 'default_capacity' from product_proposals where id = (select id from tmp_c)),
  '5', 'édition d''un logement, dépôt : default_capacity traverse la whitelist');

select test_login('7c880000-0000-4000-8000-000000000024');
select is((select moderate_product_proposal((select id from tmp_c), 'approve', 1)->>'ok'), 'true',
  'édition d''un logement : l''approbation réussit');
select is((select default_capacity from products where id = '7c880000-0000-4000-8000-000000000031'), 5,
  'édition d''un logement, approbation : le cupo proposé est écrit');

-- Forme gardée : un payload sans la clé (proposition déposée avant la migration) ne vide rien.
select test_login('7c880000-0000-4000-8000-000000000021');
create temp table tmp_c2 as
  select (submit_product_proposal(
    '7c880000-0000-4000-8000-000000000031'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Cabaña Paridad'), 'price_cop', 80000)
  )->>'proposal_id')::uuid as id;
select test_login('7c880000-0000-4000-8000-000000000024');
select moderate_product_proposal(
  (select id from tmp_c2), 'approve', 1,
  jsonb_build_object('name', jsonb_build_object('es', 'Cabaña Paridad'), 'price_cop', 80000,
                     'capacity', 2, 'unit_count', 3, 'lodging_kind', 'private'));
select is((select default_capacity from products where id = '7c880000-0000-4000-8000-000000000031'), 5,
  'édition d''un logement, forme gardée : sans la clé, le cupo par défaut n''est pas vidé');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- D. ÉDITION d'un evento — date, heure, durée puis récurrence : dépôt et approbation
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7c880000-0000-4000-8000-000000000021');
create temp table tmp_d as
  select (submit_product_proposal(
    '7c880000-0000-4000-8000-000000000032'::uuid,
    jsonb_build_object(
      'name', jsonb_build_object('es', 'Expo Paridad'), 'price_label', 'Entrada libre',
      'occurrence_type', 'once', 'occurrence_date', '2029-12-05', 'start_time', '16:00',
      'duration_minutes', 90, 'recurrence_frequency_days', null, 'recurrence_end_date', null,
      'recurrence_end_count', null
    )
  )->>'proposal_id')::uuid as id;

select is(
  (select concat_ws(' | ', payload ->> 'occurrence_type', payload ->> 'occurrence_date',
                    payload ->> 'start_time', payload ->> 'duration_minutes')
     from product_proposals where id = (select id from tmp_d)),
  'once | 2029-12-05 | 16:00 | 90',
  'édition d''un evento, dépôt : date, heure et durée traversent la whitelist');

select is((select occurrence_date::text from products where id = '7c880000-0000-4000-8000-000000000032'),
  '2029-12-01', 'édition d''un evento, dépôt : rien n''est écrit avant l''approbation');

select test_login('7c880000-0000-4000-8000-000000000024');
select is((select moderate_product_proposal((select id from tmp_d), 'approve', 1)->>'ok'), 'true',
  'édition d''un evento : l''approbation réussit');

select is(
  (select concat_ws(' | ', occurrence_date::text, start_time::text, duration_minutes::text)
     from products where id = '7c880000-0000-4000-8000-000000000032'),
  '2029-12-05 | 16:00:00 | 90',
  'édition d''un evento, approbation : la date, l''heure et la durée proposées sont écrites');

select test_login('7c880000-0000-4000-8000-000000000021');
create temp table tmp_d2 as
  select (submit_product_proposal(
    '7c880000-0000-4000-8000-000000000032'::uuid,
    jsonb_build_object(
      'name', jsonb_build_object('es', 'Expo Paridad'), 'price_label', 'Entrada libre',
      'occurrence_type', 'recurring', 'occurrence_date', '2029-12-05', 'start_time', '16:00',
      'duration_minutes', 90, 'recurrence_frequency_days', 7, 'recurrence_end_date', null,
      'recurrence_end_count', 4
    )
  )->>'proposal_id')::uuid as id;
select test_login('7c880000-0000-4000-8000-000000000024');
select moderate_product_proposal((select id from tmp_d2), 'approve', 1);

select is(
  (select concat_ws(' | ', occurrence_type, recurrence_frequency_days::text,
                    coalesce(recurrence_end_date::text, 'sin fecha'), recurrence_end_count::text)
     from products where id = '7c880000-0000-4000-8000-000000000032'),
  'recurring | 7 | sin fecha | 4',
  'édition d''un evento, approbation : la récurrence proposée est écrite');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- E. ÉDITION d'un evento — forme gardée : sans les clés, rien ne bouge
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7c880000-0000-4000-8000-000000000021');
create temp table tmp_e as
  select (submit_product_proposal(
    '7c880000-0000-4000-8000-000000000032'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Expo Paridad renombrada'))
  )->>'proposal_id')::uuid as id;

select is(
  (select (payload ? 'occurrence_date') or (payload ? 'start_time') or (payload ? 'duration_minutes')
     from product_proposals where id = (select id from tmp_e)),
  false,
  'édition d''un evento, dépôt sans date : les clés n''entrent PAS dans le payload (ni même à null)');

select test_login('7c880000-0000-4000-8000-000000000024');
select moderate_product_proposal((select id from tmp_e), 'approve', 1);

select is(
  (select concat_ws(' | ', occurrence_type, occurrence_date::text, start_time::text,
                    duration_minutes::text, recurrence_frequency_days::text)
     from products where id = '7c880000-0000-4000-8000-000000000032'),
  'recurring | 2029-12-05 | 16:00:00 | 90 | 7',
  'édition d''un evento, forme gardée : une simple correction de nom ne touche ni date ni heure');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- F. ÉDITION d'un evento — une date VIDE n'efface pas la date ; une heure vide, elle, s'efface
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7c880000-0000-4000-8000-000000000021');
create temp table tmp_f as
  select (submit_product_proposal(
    '7c880000-0000-4000-8000-000000000032'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Expo Paridad'))
  )->>'proposal_id')::uuid as id;
select test_login('7c880000-0000-4000-8000-000000000024');
select moderate_product_proposal(
  (select id from tmp_f), 'approve', 1,
  jsonb_build_object('name', jsonb_build_object('es', 'Expo Paridad'),
                     'occurrence_type', null, 'occurrence_date', null, 'start_time', null));

select is(
  (select concat_ws(' | ', occurrence_type, occurrence_date::text)
     from products where id = '7c880000-0000-4000-8000-000000000032'),
  'recurring | 2029-12-05',
  'édition d''un evento : une date vide garde la date en place (un evento sans date disparaît)');
select is((select start_time from products where id = '7c880000-0000-4000-8000-000000000032'), null,
  'édition d''un evento : une heure de début présente à null est bien effacée (demande explicite)');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- G. Evento RÉSERVABLE EN LIGNE — l'approbation ne touche ni au prix, ni à l'aforo, ni au libellé
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Le payload corrigé est celui d'un écran qui ne connaît pas la réservabilité de l'evento : prix
-- et aforo à null, libellé de prix saisi.
select test_login('7c880000-0000-4000-8000-000000000021');
create temp table tmp_g as
  select (submit_product_proposal(
    '7c880000-0000-4000-8000-000000000033'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Concierto Paridad v2'))
  )->>'proposal_id')::uuid as id;
create temp table tmp_g2 as
  select (submit_product_proposal(
    '7c880000-0000-4000-8000-000000000034'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Taller Paridad v2'))
  )->>'proposal_id')::uuid as id;

select test_login('7c880000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal(
     (select id from tmp_g), 'approve', 1,
     jsonb_build_object('name', jsonb_build_object('es', 'Concierto Paridad v2'), 'description', null,
       'price_cop', null, 'price_tiers', null, 'default_capacity', null, 'price_label', '50.000',
       'online_bookable', false, 'evento_capacity_mode', null, 'is_free', false,
       'evento_payment_mode', null, 'evento_occupies_resource', true)
   )->>'ok'),
  'true', 'evento réservable payant : l''approbation réussit');

select is((select price_cop from products where id = '7c880000-0000-4000-8000-000000000033'), 50000::bigint,
  'evento réservable payant : le prix n''est PAS effacé par l''approbation');
select is((select price_label from products where id = '7c880000-0000-4000-8000-000000000033'), null,
  'evento réservable : aucun libellé de prix libre n''est posé à côté du prix chiffré');

select is(
  (select moderate_product_proposal(
     (select id from tmp_g2), 'approve', 1,
     jsonb_build_object('name', jsonb_build_object('es', 'Taller Paridad v2'), 'description', null,
       'price_cop', null, 'price_tiers', null, 'default_capacity', null, 'price_label', null,
       'online_bookable', false, 'evento_capacity_mode', null, 'is_free', false,
       'evento_payment_mode', null, 'evento_occupies_resource', true)
   )->>'ok'),
  'true', 'evento à cupo compté : l''approbation n''échoue plus sur la contrainte d''aforo');

select is((select default_capacity from products where id = '7c880000-0000-4000-8000-000000000034'), 40,
  'evento à cupo compté : l''aforo n''est PAS vidé par l''approbation');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- H. Evento à cupo compté SANS réservation — changer la date ouvre le cupo de la nouvelle date
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7c880000-0000-4000-8000-000000000021');
create temp table tmp_h as
  select (submit_product_proposal(
    '7c880000-0000-4000-8000-000000000034'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Taller Paridad v2'), 'occurrence_type', 'once',
                       'occurrence_date', (public.today_in_bogota() + 30)::text)
  )->>'proposal_id')::uuid as id;
select test_login('7c880000-0000-4000-8000-000000000024');
select moderate_product_proposal((select id from tmp_h), 'approve', 1);

select is(
  (select capacity from product_availability
    where product_id = '7c880000-0000-4000-8000-000000000034' and date = public.today_in_bogota() + 30),
  40, 'evento à cupo compté : la nouvelle date reçoit sa ligne de disponibilité à l''approbation');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- I. Evento qui porte une réservation EN COURS — sa date ne bouge pas si la réservation en
--    sortait (migration 20261014204354 : HF002), son heure reste libre
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7c880000-0000-4000-8000-000000000021');
create temp table tmp_i as
  select (submit_product_proposal(
    '7c880000-0000-4000-8000-000000000036'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Función Paridad'), 'occurrence_type', 'once',
                       'occurrence_date', '2029-12-09', 'start_time', '18:30')
  )->>'proposal_id')::uuid as id;

select test_login('7c880000-0000-4000-8000-000000000024');
select throws_ok(
  $$select moderate_product_proposal((select id from tmp_i), 'approve', 1)$$,
  'HF002', 'occurrence_change_orphans_reservations',
  'evento réservé : l''approbation d''un changement de date qui laisserait la réservation hors date est refusée');

select is((select status from product_proposals where id = (select id from tmp_i)), 'pending',
  'evento réservé : la proposition refusée reste en attente, rien n''est écrit à moitié');

-- La même proposition, corrigée pour ne déplacer que l'heure : elle passe.
select is(
  (select moderate_product_proposal(
     (select id from tmp_i), 'approve', 1,
     jsonb_build_object('name', jsonb_build_object('es', 'Función Paridad'), 'occurrence_type', 'once',
                        'occurrence_date', '2029-12-01', 'start_time', '18:30')
   )->>'ok'),
  'true', 'evento réservé : un changement d''heure seul est accepté');

select is(
  (select concat_ws(' | ', occurrence_date::text, start_time::text)
     from products where id = '7c880000-0000-4000-8000-000000000036'),
  '2029-12-01 | 18:30:00', 'evento réservé : la date n''a pas bougé, l''heure oui');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- J. Garde de type — une date dans le payload corrigé d'une ACTIVITÉ n'est pas écrite
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7c880000-0000-4000-8000-000000000021');
create temp table tmp_j as
  select (submit_product_proposal(
    '7c880000-0000-4000-8000-000000000035'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Caminata Paridad'), 'price_cop', 50000,
                       'occurrence_date', '2029-12-09')
  )->>'proposal_id')::uuid as id;
select test_login('7c880000-0000-4000-8000-000000000024');
select moderate_product_proposal(
  (select id from tmp_j), 'approve', 1,
  jsonb_build_object('name', jsonb_build_object('es', 'Caminata Paridad'), 'price_cop', 50000,
                     'occurrence_type', 'once', 'occurrence_date', '2029-12-09', 'start_time', '09:00'));

select is(
  (select coalesce(occurrence_date::text, 'sin fecha') || ' | ' || coalesce(start_time::text, 'sin hora')
     from products where id = '7c880000-0000-4000-8000-000000000035'),
  'sin fecha | sin hora', 'activité : les colonnes d''occurrence ne s''écrivent que sur un evento');

select * from finish();
rollback;
