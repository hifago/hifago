-- admin_update_product_inline / admin_rename_establishment / admin_rename_partner (20261013145629).
--
-- L'édition en ligne des listes admin valide une ligne en UN appel. Ce fichier prouve :
--   * la garde de rôle et la liste blanche des clés ;
--   * qu'un renommage ne touche que la clé `es` (les autres langues et le slug restent) ;
--   * les refus du prix (paliers, evento gratuit, valeur invalide) ;
--   * l'enveloppe du changement de type / d'établissement, refus par refus, puis ses effets
--     (colonnes de l'ancien type remises à zéro, default_capacity vidé, partner_id qui suit) ;
--   * qu'un refus ne laisse RIEN derrière lui, même quand une autre clé du même appel était valide ;
--   * la trace d'audit, comptée sur les seuls identifiants de ces fixtures.
begin;
select plan(38);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('1e11e000-0000-4000-8000-000000000001', 'Inline Partner Uno'),
  ('1e11e000-0000-4000-8000-000000000002', 'Inline Partner Dos');
insert into establishments (id, partner_id, name) values
  ('1e11e000-0000-4000-8000-000000000011', '1e11e000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Inline Uno', 'en', 'Inline One')),
  ('1e11e000-0000-4000-8000-000000000012', '1e11e000-0000-4000-8000-000000000002',
   jsonb_build_object('es', 'Establecimiento Inline Dos'));

-- 021 simple, publiée · 022 dépubliée, vierge · 023 dépubliée, déjà commandée · 024 dépubliée, liée
-- à Lobby · 025 dépubliée, avec cupos · 026 à paliers · 027 evento gratuit · 028 transport dépublié.
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('1e11e000-0000-4000-8000-000000000021', '1e11e000-0000-4000-8000-000000000001',
   '1e11e000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Kayak Inline', 'en', 'Inline Kayak'), 50000, true, 'inline-kayak'),
  ('1e11e000-0000-4000-8000-000000000022', '1e11e000-0000-4000-8000-000000000001',
   '1e11e000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Vierge Inline'), 40000, false, 'inline-vierge'),
  ('1e11e000-0000-4000-8000-000000000023', '1e11e000-0000-4000-8000-000000000001',
   '1e11e000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Commandée Inline'), 40000, false, 'inline-commandee'),
  ('1e11e000-0000-4000-8000-000000000024', '1e11e000-0000-4000-8000-000000000001',
   '1e11e000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Lobby Inline'), 40000, false, 'inline-lobby'),
  ('1e11e000-0000-4000-8000-000000000025', '1e11e000-0000-4000-8000-000000000001',
   '1e11e000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Cupos Inline'), 40000, false, 'inline-cupos'),
  ('1e11e000-0000-4000-8000-000000000026', '1e11e000-0000-4000-8000-000000000001',
   '1e11e000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Paliers Inline'), 30000, true, 'inline-paliers'),
  ('1e11e000-0000-4000-8000-000000000027', '1e11e000-0000-4000-8000-000000000001',
   '1e11e000-0000-4000-8000-000000000011', 'evento',
   jsonb_build_object('es', 'Evento Gratis Inline'), null, true, 'inline-evento-gratis'),
  ('1e11e000-0000-4000-8000-000000000028', '1e11e000-0000-4000-8000-000000000001',
   '1e11e000-0000-4000-8000-000000000011', 'transport',
   jsonb_build_object('es', 'Transporte Inline'), 80000, false, 'inline-transporte');

update products set default_capacity = 12 where id = '1e11e000-0000-4000-8000-000000000022';
update products set lobby_product_id = 4242 where id = '1e11e000-0000-4000-8000-000000000024';
update products
   set price_tiers = '[{"min_qty": 1, "price_cop": 30000}, {"min_qty": 4, "price_cop": 25000}]'::jsonb
 where id = '1e11e000-0000-4000-8000-000000000026';
update products set is_free = true where id = '1e11e000-0000-4000-8000-000000000027';
update products
   set transport_departure_address = 'Terminal del Norte', transport_contact_phone = '+573001112233'
 where id = '1e11e000-0000-4000-8000-000000000028';
insert into product_availability (product_id, date, capacity, booked) values
  ('1e11e000-0000-4000-8000-000000000025', '2029-11-01', 12, 0);

insert into catalog_tags (id, label, slug) values
  ('1e11e000-0000-4000-8000-000000000051', jsonb_build_object('es', 'Inline Tag Uno'), 'inline-tag-uno'),
  ('1e11e000-0000-4000-8000-000000000052', jsonb_build_object('es', 'Inline Tag Dos'), 'inline-tag-dos');
insert into product_tag_assignments (product_id, tag_id) values
  ('1e11e000-0000-4000-8000-000000000021', '1e11e000-0000-4000-8000-000000000051');

insert into auth.users (id, email) values
  ('1e11e000-0000-4000-8000-000000000031', 'inline-admin@test.local'),
  ('1e11e000-0000-4000-8000-000000000032', 'inline-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('1e11e000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

insert into orders (id, account_id, holder_name, holder_email) values
  ('1e11e000-0000-4000-8000-000000000041', '1e11e000-0000-4000-8000-000000000032',
   'Inline Holder', 'inline-holder@test.local');
-- Une ligne ANNULÉE suffit à figer la fiche : elle prouve qu'une commande a existé.
insert into order_lines (
  order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '1e11e000-0000-4000-8000-000000000041', '1e11e000-0000-4000-8000-000000000032',
  '1e11e000-0000-4000-8000-000000000023', '2029-11-02', 1, 'cancelled_by_client', 'Inline Holder',
  40000, 40000, 'direct', 0, 0, 0, 0, 0, 0
);

set local role authenticated;

-- ---------- Garde de rôle, liste blanche ---------------------------------------------------------
select test_login('1e11e000-0000-4000-8000-000000000032');
select throws_ok(
  $$ select admin_update_product_inline('1e11e000-0000-4000-8000-000000000021', '{"name_es": "Pirate"}') $$,
  '42501', 'admin_update_product_inline réservé au rôle admin',
  'un compte non admin est refusé (produit)'
);
select throws_ok(
  $$ select admin_rename_establishment('1e11e000-0000-4000-8000-000000000011', 'Pirate') $$,
  '42501', 'admin_rename_establishment réservé au rôle admin',
  'un compte non admin est refusé (établissement)'
);
select throws_ok(
  $$ select admin_rename_partner('1e11e000-0000-4000-8000-000000000001', 'Pirate') $$,
  '42501', 'admin_rename_partner réservé au rôle admin',
  'un compte non admin est refusé (partenaire)'
);

select test_login('1e11e000-0000-4000-8000-000000000031');
select throws_ok(
  $$ select admin_update_product_inline('1e11e000-0000-4000-8000-000000000021', '{"slug": "pirate"}') $$,
  'P0001', 'clé non autorisée : slug',
  'une clé hors liste blanche lève'
);
select is(
  admin_update_product_inline('1e11e000-0000-4000-8000-0000000000ff', '{"name_es": "Fantôme"}') ->> 'reason',
  'not_found', 'un produit inexistant rend not_found'
);

-- ---------- Nom, prix, étiquettes, état : une ligne, un appel ------------------------------------
select is(
  admin_update_product_inline(
    '1e11e000-0000-4000-8000-000000000021',
    jsonb_build_object(
      'name_es', '  Kayak Renombrado  ', 'price_cop', 65000, 'sellable', false,
      'tag_ids', jsonb_build_array(
        '1e11e000-0000-4000-8000-000000000052', '1e11e000-0000-4000-8000-0000000000ee', 'pas-un-uuid'
      )
    )
  ) ->> 'ok',
  'true', 'nom + prix + état + étiquettes passent en un seul appel'
);

-- ---------- Refus du prix ------------------------------------------------------------------------
select is(
  admin_update_product_inline('1e11e000-0000-4000-8000-000000000026', '{"price_cop": 99000}') ->> 'reason',
  'price_has_tiers', 'un prix à paliers ne s''édite pas en ligne'
);
select is(
  admin_update_product_inline('1e11e000-0000-4000-8000-000000000027', '{"price_cop": 99000}') ->> 'reason',
  'price_free_evento', 'un evento gratuit n''a pas de prix'
);
select is(
  admin_update_product_inline('1e11e000-0000-4000-8000-000000000022', '{"price_cop": 0}') ->> 'reason',
  'invalid_price', 'un prix nul est refusé'
);
select is(
  admin_update_product_inline('1e11e000-0000-4000-8000-000000000022', '{"price_cop": 100.5}') ->> 'reason',
  'invalid_price', 'un prix décimal est refusé'
);
select is(
  admin_update_product_inline('1e11e000-0000-4000-8000-000000000022', '{"name_es": "   "}') ->> 'reason',
  'invalid_name', 'un nom vide est refusé'
);

-- ---------- Enveloppe du changement de type / d'établissement ------------------------------------
-- 026 est publiée : le refus doit emporter AUSSI le renommage valide du même appel.
select is(
  admin_update_product_inline(
    '1e11e000-0000-4000-8000-000000000026', '{"type": "transport", "name_es": "Ne Doit Pas Passer"}'
  ) ->> 'reason',
  'must_unpublish_first', 'changer le type d''une fiche publiée est refusé'
);
select is(
  admin_update_product_inline(
    '1e11e000-0000-4000-8000-000000000023', '{"type": "transport"}'
  ) ->> 'reason',
  'has_orders', 'une fiche déjà commandée (même annulée) garde son type'
);
select is(
  admin_update_product_inline(
    '1e11e000-0000-4000-8000-000000000023',
    '{"establishment_id": "1e11e000-0000-4000-8000-000000000012"}'
  ) ->> 'reason',
  'has_orders', 'une fiche déjà commandée garde son établissement'
);
select is(
  admin_update_product_inline('1e11e000-0000-4000-8000-000000000024', '{"type": "transport"}') ->> 'reason',
  'pms_linked', 'une fiche liée à LobbyPMS garde son type'
);
select is(
  admin_update_product_inline('1e11e000-0000-4000-8000-000000000025', '{"type": "transport"}') ->> 'reason',
  'has_capacity_config', 'une fiche qui porte des cupos garde son type'
);
select is(
  admin_update_product_inline('1e11e000-0000-4000-8000-000000000022', '{"type": "camp"}') ->> 'reason',
  'camp_needs_duration', 'devenir campamento exige une durée déjà saisie'
);
select is(
  admin_update_product_inline('1e11e000-0000-4000-8000-000000000022', '{"type": "evento"}') ->> 'reason',
  'evento_needs_date', 'devenir evento exige une date déjà saisie'
);
select is(
  admin_update_product_inline('1e11e000-0000-4000-8000-000000000022', '{"type": "hotel"}') ->> 'reason',
  'invalid_type', 'un type hors liste est refusé'
);
select is(
  admin_update_product_inline(
    '1e11e000-0000-4000-8000-000000000022', '{"establishment_id": "pas-un-uuid"}'
  ) ->> 'reason',
  'establishment_not_found', 'un établissement malformé rend introuvable, jamais une erreur de cast'
);

-- Les deux changements de structure qui passent.
select is(
  admin_update_product_inline(
    '1e11e000-0000-4000-8000-000000000022',
    '{"type": "lodging", "establishment_id": "1e11e000-0000-4000-8000-000000000012"}'
  ) ->> 'ok',
  'true', 'une fiche dépubliée et vierge change de type et d''établissement'
);
select is(
  admin_update_product_inline('1e11e000-0000-4000-8000-000000000028', '{"type": "activity"}') ->> 'ok',
  'true', 'un transport dépublié et vierge devient une activité'
);
-- Même valeur qu'en base : rien à écrire, rien à journaliser.
select is(
  admin_update_product_inline(
    '1e11e000-0000-4000-8000-000000000028', '{"type": "activity", "price_cop": 80000}'
  ) ->> 'ok',
  'true', 'un appel sans changement réel réussit'
);

-- ---------- Renommages établissement / partenaire -------------------------------------------------
select is(
  admin_rename_establishment('1e11e000-0000-4000-8000-000000000011', ' Establecimiento Renombrado ') ->> 'ok',
  'true', 'un établissement se renomme'
);
select is(
  admin_rename_establishment('1e11e000-0000-4000-8000-000000000011', '') ->> 'reason',
  'invalid_name', 'un nom d''établissement vide est refusé'
);
select is(
  admin_rename_partner('1e11e000-0000-4000-8000-000000000001', 'Inline Partner Renombrado') ->> 'ok',
  'true', 'un partenaire se renomme'
);

-- ⚠️ Lectures APRÈS `reset role` : audit_log n'est lisible que par l'admin, et les comptages
-- doivent voir toutes les lignes (même raison que delete_product.test.sql).
reset role;

select is(
  (select name from products where id = '1e11e000-0000-4000-8000-000000000021'),
  jsonb_build_object('es', 'Kayak Renombrado', 'en', 'Inline Kayak'),
  'le renommage ne touche que `es` : la traduction `en` est conservée, le nom est rogné'
);
select is(
  (select slug || '|' || price_cop || '|' || sellable from products where id = '1e11e000-0000-4000-8000-000000000021'),
  'inline-kayak|65000|false',
  'le slug ne bouge pas, le prix et l''état sont écrits'
);
select is(
  (select array_agg(tag_id::text order by tag_id) from product_tag_assignments
    where product_id = '1e11e000-0000-4000-8000-000000000021'),
  array['1e11e000-0000-4000-8000-000000000052'],
  'les étiquettes sont REMPLACÉES ; un identifiant inconnu ou malformé disparaît sans erreur'
);
select is(
  (select name ->> 'es' || '|' || type || '|' || sellable from products where id = '1e11e000-0000-4000-8000-000000000026'),
  'Paliers Inline|activity|true',
  'un refus n''écrit rien, pas même le renommage valide du même appel'
);
select is(
  (select type || '|' || establishment_id || '|' || partner_id || '|' || coalesce(default_capacity::text, 'null')
     from products where id = '1e11e000-0000-4000-8000-000000000022'),
  'lodging|1e11e000-0000-4000-8000-000000000012|1e11e000-0000-4000-8000-000000000002|null',
  'type et établissement écrits, partner_id suit l''établissement, default_capacity vidé (le cron n''ouvrira aucune nuit)'
);
select is(
  (select type || '|' || coalesce(transport_departure_address, 'null') || '|' || coalesce(transport_contact_phone, 'null')
     from products where id = '1e11e000-0000-4000-8000-000000000028'),
  'activity|null|null',
  'les colonnes réservées à l''ancien type sont vidées (sinon le CHECK transport_only refuserait)'
);
select is(
  (select type from products where id = '1e11e000-0000-4000-8000-000000000025'),
  'activity', 'la fiche qui porte des cupos n''a pas bougé'
);
select is(
  (select count(*)::int from product_availability where product_id = '1e11e000-0000-4000-8000-000000000025'),
  1, 'ses cupos sont intacts : la fonction les lit, elle ne les écrit jamais'
);
select is(
  (select name from establishments where id = '1e11e000-0000-4000-8000-000000000011'),
  jsonb_build_object('es', 'Establecimiento Renombrado', 'en', 'Inline One'),
  'l''établissement renommé garde sa traduction'
);
select is(
  (select display_name from partners where id = '1e11e000-0000-4000-8000-000000000001'),
  'Inline Partner Renombrado', 'le partenaire est renommé'
);
select is(
  (select array_agg(action order by action) from audit_log
    where entity_id = '1e11e000-0000-4000-8000-000000000021'),
  array['product.unpublish', 'product.update_inline'],
  'la ligne modifiée laisse deux traces : le contenu, et la dépublication sous son nom habituel'
);
select is(
  (select count(*)::int from audit_log
    where entity_id in (
      '1e11e000-0000-4000-8000-000000000023', '1e11e000-0000-4000-8000-000000000024',
      '1e11e000-0000-4000-8000-000000000025', '1e11e000-0000-4000-8000-000000000026',
      '1e11e000-0000-4000-8000-000000000027'
    )),
  0, 'aucun refus n''est journalisé'
);

select * from finish();
rollback;
