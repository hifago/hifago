-- Spec 31 (Tranche 4), migration 20260910130000 — le job pg_cron de purge des identités
-- anonymes sans commande après 30 jours. Couvre les 5 cas de la spec (§0 cas limites) : purgeable,
-- protégée par une commande, trop jeune, bloquée par une FK (le piège central — ne doit JAMAIS
-- arrêter le lot), et un compte réel jamais touché quel que soit son âge.
--
-- Cas 6 et 7 (20261001231547) : le panier. Une identité anonyme sans commande porte presque
-- toujours des cart_items (elle naît d'un ajout au panier, spec 31 inv. 1), et cart_items/carts
-- référencent partner_accounts sans cascade : sans la purge des paniers dans la fonction, le cas 6
-- était sauté comme le cas 4. Le cas 7 prouve l'atomicité par candidat : bloquée par une autre trace,
-- l'identité est sautée ET son panier reste intact.
--
-- ⚠️ Assertions globales RELATIVES (`>=`, opérateur jsonb `?`) : sur une base locale non re-semée
-- depuis plus de 30 jours, d'autres identités anonymes sont aussi candidates et la purge les traite
-- dans la même transaction. Les assertions par id restent la preuve.
begin;
select plan(16);

-- Cas 1 : purgeable — anonyme, 31 jours, aucune commande.
insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at) values
  ('99995000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', true, now() - interval '31 days', now());

-- Cas 2 : protégée — anonyme, 31 jours, AVEC une commande (invariant 9 : jamais purgée, quel que
-- soit le statut/âge de la commande — celle-ci n'a même pas de order_lines, ça n'a pas d'importance).
insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at) values
  ('99995000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', true, now() - interval '31 days', now());
insert into orders (id, account_id, holder_name, holder_email) values
  ('99995000-0000-4000-8000-000000000012', '99995000-0000-4000-8000-000000000002',
   'Purge Test Avec Commande', 'purge-avec-commande@test.local');

-- Cas 3 : trop jeune — anonyme, 5 jours, aucune commande.
insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at) values
  ('99995000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', true, now() - interval '5 days', now());

-- Cas 4 : LE piège — purgeable en apparence (31 jours, aucune commande), mais bloquée par une FK
-- NO ACTION vers partner_accounts (ici audit_log.actor_id). Doit être SKIPPED, jamais faire
-- échouer le lot entier (ce qu'un simple `delete ... where ...` set-based ferait).
insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at) values
  ('99995000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', true, now() - interval '31 days', now());
insert into audit_log (actor_id, action, entity_table, entity_id, before, after, note) values
  ('99995000-0000-4000-8000-000000000004', 'test.action', 'orders', gen_random_uuid(), null, null,
   'fixture purge_expired_anonymous_identities.test.sql');

-- Cas 5 : compte RÉEL, 31 jours, aucune commande — jamais touché (is_anonymous=false).
insert into auth.users (id, instance_id, aud, role, is_anonymous, email, created_at, updated_at) values
  ('99995000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', false, 'purge-compte-reel@test.local',
   now() - interval '31 days', now());

-- Produit support des paniers des cas 6 et 7 (cart_items.product_id est obligatoire).
insert into partners (id, display_name) values
  ('99995000-0000-4000-8000-000000000101', 'Purge Test Partner');
insert into establishments (id, partner_id, name) values
  ('99995000-0000-4000-8000-000000000102', '99995000-0000-4000-8000-000000000101',
   jsonb_build_object('es', 'Establecimiento Purge'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('99995000-0000-4000-8000-000000000103', '99995000-0000-4000-8000-000000000101',
   '99995000-0000-4000-8000-000000000102', 'activity', jsonb_build_object('es', 'Actividad Purge'),
   30000, true, 'purge-test-actividad');

-- Cas 6 : purgeable AVEC un panier — anonyme, 31 jours, aucune commande, 1 cart_items + 1 carts.
insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at) values
  ('99995000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', true, now() - interval '31 days', now());
insert into cart_items (account_id, product_id, date, qty) values
  ('99995000-0000-4000-8000-000000000006', '99995000-0000-4000-8000-000000000103', '2029-10-10', 1);
insert into carts (account_id) values ('99995000-0000-4000-8000-000000000006');

-- Cas 7 : bloquée par audit_log (comme le cas 4) ET porteuse d'un panier.
insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at) values
  ('99995000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', true, now() - interval '31 days', now());
insert into audit_log (actor_id, action, entity_table, entity_id, before, after, note) values
  ('99995000-0000-4000-8000-000000000007', 'test.action', 'orders', gen_random_uuid(), null, null,
   'fixture purge_expired_anonymous_identities.test.sql');
insert into cart_items (account_id, product_id, date, qty) values
  ('99995000-0000-4000-8000-000000000007', '99995000-0000-4000-8000-000000000103', '2029-10-10', 1);
insert into carts (account_id) values ('99995000-0000-4000-8000-000000000007');

create temp table premier_passage as select purge_expired_anonymous_identities() as r;

select ok(
  (select (r ->> 'purged')::int >= 2 from premier_passage),
  'au moins deux candidats purgés sur ce lot (cas 1 et 6)'
);
select ok(
  (select (r -> 'skipped') ? '99995000-0000-4000-8000-000000000004' from premier_passage),
  'la ligne bloquée par audit_log (cas 4) est nommée dans skipped'
);
select ok(
  (select (r -> 'skipped') ? '99995000-0000-4000-8000-000000000007' from premier_passage),
  'la ligne bloquée par audit_log ET porteuse d''un panier (cas 7) est nommée dans skipped'
);
select ok(
  (select not ((r -> 'skipped') ? '99995000-0000-4000-8000-000000000006') from premier_passage),
  'le panier ne fait plus sauter une identité (cas 6 absent de skipped)'
);
select ok(
  (select (purge_expired_anonymous_identities() -> 'skipped') ? '99995000-0000-4000-8000-000000000004'),
  -- Second appel : la ligne bloquée réapparaît, preuve qu'elle n'a jamais été réessayée en silence
  -- ni oubliée.
  'la ligne bloquée par audit_log reste nommée dans skipped, jamais silencieusement perdue'
);

select is(
  (select count(*)::int from auth.users where id = '99995000-0000-4000-8000-000000000001'),
  0,
  'cas 1 : identité purgeable réellement supprimée'
);
select is(
  (select count(*)::int from auth.users where id = '99995000-0000-4000-8000-000000000002'),
  1,
  'cas 2 : identité avec une commande JAMAIS purgée (invariant 9)'
);
select is(
  (select count(*)::int from auth.users where id = '99995000-0000-4000-8000-000000000003'),
  1,
  'cas 3 : identité trop jeune (5 jours) jamais purgée'
);
select is(
  (select count(*)::int from auth.users where id = '99995000-0000-4000-8000-000000000004'),
  1,
  'cas 4 : identité bloquée par une FK reste en place (skip, jamais un delete forcé)'
);
select is(
  (select count(*)::int from auth.users where id = '99995000-0000-4000-8000-000000000005'),
  1,
  'cas 5 : compte réel (is_anonymous=false) jamais candidat, quel que soit son âge'
);
select is(
  (select count(*)::int from auth.users where id = '99995000-0000-4000-8000-000000000006'),
  0,
  'cas 6 : identité purgeable avec un panier réellement supprimée'
);
select is(
  (select count(*)::int from cart_items where account_id = '99995000-0000-4000-8000-000000000006'),
  0,
  'cas 6 : ses lignes de panier sont parties avec elle'
);
select is(
  (select count(*)::int from carts where account_id = '99995000-0000-4000-8000-000000000006'),
  0,
  'cas 6 : sa ligne carts est partie avec elle'
);
select is(
  (select count(*)::int from auth.users where id = '99995000-0000-4000-8000-000000000007'),
  1,
  'cas 7 : identité bloquée par une autre trace reste en place'
);
select is(
  (select count(*)::int from cart_items where account_id = '99995000-0000-4000-8000-000000000007'),
  1,
  'cas 7 : son panier est intact (le sous-bloc annule aussi la purge du panier)'
);
select is(
  (select count(*)::int from carts where account_id = '99995000-0000-4000-8000-000000000007'),
  1,
  'cas 7 : sa ligne carts est intacte'
);

select * from finish();
rollback;
