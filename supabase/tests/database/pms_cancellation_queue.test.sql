-- C2 (spec 25) — le trigger d'enfilement des annulations LobbyPMS. Ce fichier couvre la SEULE
-- logique qui décide si une chambre reste bloquée chez un partenaire ou non ; l'appel HTTP, lui,
-- vit dans l'Edge Function et n'est pas testable ici.
--
-- Les trois cas qui ont fait re-spécifier C2 entièrement (spec 25 §2) sont chacun un test :
--   (a) l'annulation ne passe pas que par cancel_order — le trigger attrape TOUS les chemins ;
--   (b) pms_booking_id est PARTAGÉ — annuler une activité ne doit pas tuer la nuit ;
--   (c) sortir de `reserved` fait quitter claim_pms_poll_batch — d'où la file, qui prend le relais.
begin;
select plan(20);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Décor minimal : un établissement connecté, deux produits (une nuit + une activité), une commande
-- dont les deux lignes partagent le MÊME pms_booking_id — exactement ce que produit reserve-nights.
insert into public.partners (id, display_name)
values ('cc000000-0000-4000-8000-000000000001', 'Partenaire C2');

-- RÉVISÉ 2026-09-10 (spec 31, Tranche 2) : orders.account_id est NOT NULL. Une seule identité
-- pour les 4 commandes de ce fichier — aucune n'en dépend, ce fichier teste le trigger d'enfilement
-- PMS, pas une sémantique de propriétaire.
insert into auth.users (id, email) values
  ('cc000000-0000-4000-8000-0000000000c2', 'cliente-c2@test.local');

insert into public.establishments (id, partner_id, name, lobby_connector_active, lobby_api_token)
values ('cc000000-0000-4000-8000-000000000002', 'cc000000-0000-4000-8000-000000000001',
        '{"es":"Establecimiento C2"}'::jsonb, true, 'jeton-factice-c2');

insert into public.products (id, partner_id, establishment_id, type, name, slug, price_cop, lobby_category_id)
values
  ('cc000000-0000-4000-8000-000000000010', 'cc000000-0000-4000-8000-000000000001',
   'cc000000-0000-4000-8000-000000000002', 'lodging', '{"es":"Noche C2"}'::jsonb, 'noche-c2', 100000, 9631),
  ('cc000000-0000-4000-8000-000000000011', 'cc000000-0000-4000-8000-000000000001',
   'cc000000-0000-4000-8000-000000000002', 'activity', '{"es":"Yoga C2"}'::jsonb, 'yoga-c2', 22000, null);

insert into public.orders (id, account_id, holder_name, holder_email, status)
values ('cc000000-0000-4000-8000-000000000020', 'cc000000-0000-4000-8000-0000000000c2',
        'Cliente C2', 'c2@example.test', 'reserved');

insert into public.order_lines (id, order_id, account_id, product_id, status, qty, price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop, holder_name, date, pms_booking_id)
values
  ('cc000000-0000-4000-8000-000000000030', 'cc000000-0000-4000-8000-000000000020', 'cc000000-0000-4000-8000-0000000000c2',
   'cc000000-0000-4000-8000-000000000010', 'reserved', 1, 100000, 100000, 'direct', 0.15, 0, 0.10, 15000, 0, 10000,
   'Cliente C2', '2027-03-01', '90000001'),
  ('cc000000-0000-4000-8000-000000000031', 'cc000000-0000-4000-8000-000000000020', 'cc000000-0000-4000-8000-0000000000c2',
   'cc000000-0000-4000-8000-000000000011', 'reserved', 1, 22000, 22000, 'direct', 0.15, 0, 0.10, 3300, 0, 2200,
   'Cliente C2', '2027-03-01', '90000001');

select is(
  (select count(*)::int from public.pms_cancellation_queue),
  0,
  'décor posé : la file est vide tant que rien n''est annulé'
);

-- (b) LE cas qui aurait tout cassé : annuler l'activité ne doit RIEN enfiler, la nuit tient encore
-- le booking. Sans cette garde, retirer un yoga annulerait la chambre du client.
update public.order_lines set status = 'cancelled_by_client'
 where id = 'cc000000-0000-4000-8000-000000000031';

select is(
  (select count(*)::int from public.pms_cancellation_queue),
  0,
  'annuler la ligne ACTIVITÉ n''enfile rien : la nuit réserve toujours le même booking'
);

-- Puis la nuit part à son tour : plus aucune ligne ne réserve ce booking → enfilement.
update public.order_lines set status = 'cancelled_by_client'
 where id = 'cc000000-0000-4000-8000-000000000030';

select is(
  (select count(*)::int from public.pms_cancellation_queue where pms_booking_id = '90000001' and status = 'pending'),
  1,
  'la dernière ligne réservée qui tombe enfile le booking'
);

select is(
  (select establishment_id from public.pms_cancellation_queue where pms_booking_id = '90000001'),
  'cc000000-0000-4000-8000-000000000002'::uuid,
  'l''entrée porte l''établissement, seule source du jeton pour le drainage'
);

-- Idempotence : un second passage sur des lignes déjà annulées ne crée pas de doublon (index
-- unique partiel sur les entrées en attente).
update public.order_lines set status = 'cancelled_by_provider'
 where id = 'cc000000-0000-4000-8000-000000000030';

select is(
  (select count(*)::int from public.pms_cancellation_queue where pms_booking_id = '90000001'),
  1,
  'jamais deux entrées en attente pour le même booking'
);

-- (a) Le trigger attrape TOUS les chemins, pas seulement cancel_order. `expired` est produit par
-- expire_stale_payment_orders, et c'est probablement le cas le plus fréquent en volume :
-- reserve-nights tourne AVANT le paiement, donc une commande abandonnée au paiement a déjà son
-- booking chez Lobby quand elle expire.
insert into public.orders (id, account_id, holder_name, holder_email, status)
values ('cc000000-0000-4000-8000-000000000021', 'cc000000-0000-4000-8000-0000000000c2',
        'Cliente C2', 'c2@example.test', 'reserved');
insert into public.order_lines (id, order_id, account_id, product_id, status, qty, price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop, holder_name, date, pms_booking_id)
values ('cc000000-0000-4000-8000-000000000032', 'cc000000-0000-4000-8000-000000000021', 'cc000000-0000-4000-8000-0000000000c2',
        'cc000000-0000-4000-8000-000000000010', 'reserved', 1, 100000, 100000, 'direct', 0.15, 0, 0.10, 15000, 0, 10000,
        'Cliente C2', '2027-04-01', '90000002');

update public.order_lines set status = 'expired' where id = 'cc000000-0000-4000-8000-000000000032';

select is(
  (select count(*)::int from public.pms_cancellation_queue where pms_booking_id = '90000002' and status = 'pending'),
  1,
  'un `expired` enfile aussi — le trigger ne dépend d''aucune RPC particulière'
);

-- Une ligne sans booking Lobby ne concerne pas ce mécanisme.
insert into public.orders (id, account_id, holder_name, holder_email, status)
values ('cc000000-0000-4000-8000-000000000022', 'cc000000-0000-4000-8000-0000000000c2',
        'Cliente C2', 'c2@example.test', 'reserved');
insert into public.order_lines (id, order_id, account_id, product_id, status, qty, price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop, holder_name, date, pms_booking_id)
values ('cc000000-0000-4000-8000-000000000033', 'cc000000-0000-4000-8000-000000000022', 'cc000000-0000-4000-8000-0000000000c2',
        'cc000000-0000-4000-8000-000000000011', 'reserved', 1, 22000, 22000, 'direct', 0.15, 0, 0.10, 3300, 0, 2200,
        'Cliente C2', '2027-05-01', null);
update public.order_lines set status = 'cancelled_by_client' where id = 'cc000000-0000-4000-8000-000000000033';

select is(
  (select count(*)::int from public.pms_cancellation_queue where establishment_id = 'cc000000-0000-4000-8000-000000000002'),
  2,
  'une ligne sans pms_booking_id n''enfile rien'
);

-- LE DÉFAUT TROUVÉ PAR LE TEST LIVE du 2026-08-27, et que ces tests ne voyaient pas : la première
-- version enfilait sur « tout statut <> reserved », donc AUSSI sur `fulfilled` et `no_show`. hifago
-- aurait demandé à Lobby d'annuler des séjours DÉJÀ EFFECTUÉS, au cas le plus nominal qui soit —
-- une réservation qui se termine bien. Ces tests ne l'attrapaient pas parce qu'ils n'exerçaient que
-- des statuts d'annulation : un test qui ne vérifie que les cas où l'on veut que ça marche ne
-- prouve jamais que ça s'abstient.
insert into public.orders (id, account_id, holder_name, holder_email, status)
values ('cc000000-0000-4000-8000-000000000023', 'cc000000-0000-4000-8000-0000000000c2',
        'Cliente C2', 'c2@example.test', 'reserved');
insert into public.order_lines (id, order_id, account_id, product_id, status, qty, price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop, holder_name, date, pms_booking_id)
values ('cc000000-0000-4000-8000-000000000034', 'cc000000-0000-4000-8000-000000000023', 'cc000000-0000-4000-8000-0000000000c2',
        'cc000000-0000-4000-8000-000000000010', 'reserved', 1, 100000, 100000, 'direct', 0.15, 0, 0.10, 15000, 0, 10000,
        'Cliente C2', '2027-06-01', '90000003');

update public.order_lines set status = 'fulfilled' where id = 'cc000000-0000-4000-8000-000000000034';
select is(
  (select count(*)::int from public.pms_cancellation_queue where pms_booking_id = '90000003'),
  0,
  'un séjour `fulfilled` n''enfile RIEN — le séjour a eu lieu, l''annuler chez le partenaire serait une faute'
);

update public.order_lines set status = 'no_show' where id = 'cc000000-0000-4000-8000-000000000034';
select is(
  (select count(*)::int from public.pms_cancellation_queue where pms_booking_id = '90000003'),
  0,
  'un `no_show` n''enfile rien non plus — le client n''est pas venu, la nuit reste due'
);

-- Le statut hifago est conservé : LobbyPMS n'accepte pas un motif libre mais un CODE fermé, et le
-- bon code en dépend (cancelled_by_client → TTC, le reste → OTH).
--
-- C'est le PREMIER statut d'annulation qui est retenu, pas le dernier : l'entrée est créée une
-- seule fois (`on conflict do nothing`), et un changement ultérieur de statut ne la réécrit pas.
-- Voulu — la ligne est passée `cancelled_by_client` plus haut, puis `cancelled_by_provider` au
-- test d'idempotence ; c'est bien l'annulation d'origine qui décrit le mieux ce qui s'est passé.
select is(
  (select hifago_status from public.pms_cancellation_queue where pms_booking_id = '90000001'),
  'cancelled_by_client',
  'le premier statut d''annulation est conservé, pour choisir le code de motif Lobby'
);

-- Le drainage réclame, incrémente les tentatives, et rend le jeton — miroir de claim_pms_poll_batch.
select is(
  (select count(*)::int from claim_pms_cancellation_batch(10)),
  2,
  'claim_pms_cancellation_batch réclame les entrées en attente'
);

-- Clôture : 422 et 404 sont des SUCCÈS documentés, jamais des échecs (spec 21 §0). Les traiter
-- comme des incidents produirait une salve d'e-mails via notify_all_admins, sans dédup — c'est le
-- défaut C9, corrigé le 26/08 sur le chemin jumeau.
select resolve_pms_cancellation(
  (select id from public.pms_cancellation_queue where pms_booking_id = '90000001'),
  'done', 422, '{"error_code":"RESTRICTED_RESERVATION"}'
);

select is(
  (select status from public.pms_cancellation_queue where pms_booking_id = '90000001'),
  'done',
  'un 422 RESTRICTED_RESERVATION clôt l''entrée en succès, jamais en échec'
);

-- Migration 20261003223900 : le trigger ne filtre plus le connecteur actif. Une commande qui expire
-- pendant que le connecteur est coupé ne laisse plus son booking orphelin chez Lobby : l'entrée est
-- enfilée et attend la réactivation, le drainage ne la réclamant pas tant que le connecteur est coupé.
insert into public.establishments (id, partner_id, name, lobby_connector_active, lobby_api_token)
values ('cc000000-0000-4000-8000-0000000000e3', 'cc000000-0000-4000-8000-000000000001',
        '{"es":"Establecimiento C2 desconectado"}'::jsonb, false, 'jeton-factice-c2b');
insert into public.products (id, partner_id, establishment_id, type, name, slug, price_cop, lobby_category_id)
values ('cc000000-0000-4000-8000-0000000000e2', 'cc000000-0000-4000-8000-000000000001',
        'cc000000-0000-4000-8000-0000000000e3', 'lodging', '{"es":"Noche C2 desconectada"}'::jsonb, 'noche-c2-desconectada', 100000, 9632);
insert into public.orders (id, account_id, holder_name, holder_email, status)
values ('cc000000-0000-4000-8000-0000000000e1', 'cc000000-0000-4000-8000-0000000000c2',
        'Cliente C2', 'c2@example.test', 'reserved');
insert into public.order_lines (id, order_id, account_id, product_id, status, qty, price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop, holder_name, date, pms_booking_id)
values ('cc000000-0000-4000-8000-0000000000e4', 'cc000000-0000-4000-8000-0000000000e1', 'cc000000-0000-4000-8000-0000000000c2',
        'cc000000-0000-4000-8000-0000000000e2', 'reserved', 1, 100000, 100000, 'direct', 0.15, 0, 0.10, 15000, 0, 10000,
        'Cliente C2', '2027-03-02', '90000099');
update public.order_lines set status = 'expired' where id = 'cc000000-0000-4000-8000-0000000000e4';

select is(
  (select status from public.pms_cancellation_queue where pms_booking_id = '90000099'),
  'pending',
  'connecteur coupé : le booking de la commande expirée est enfilé (il attend la réactivation)'
);
select is(
  (select count(*)::int from claim_pms_cancellation_batch(10) c where c.pms_booking_id = '90000099'),
  0,
  '… et le drainage ne le réclame pas tant que le connecteur est coupé'
);

-- Un jeton REMPLACÉ peut ouvrir un autre compte Lobby : l'annulation en attente ne part pas vers lui,
-- elle passe en échec pour une vérification manuelle (le contrôle nocturne compte les échecs).
insert into auth.users (id, email) values ('cc000000-0000-4000-8000-0000000000ad', 'admin-c2@test.local');
insert into public.partner_capabilities (account_id, role, source, status)
values ('cc000000-0000-4000-8000-0000000000ad', 'admin', 'migration', 'active');
-- Un établissement SANS jeton, avec une annulation en attente : son premier jeton ne déclenche rien.
insert into public.establishments (id, partner_id, name, lobby_connector_active, lobby_api_token)
values ('cc000000-0000-4000-8000-0000000000e5', 'cc000000-0000-4000-8000-000000000001',
        '{"es":"Establecimiento C2 sin token"}'::jsonb, false, null);
insert into public.pms_cancellation_queue (pms_booking_id, establishment_id, hifago_status)
values ('90000098', 'cc000000-0000-4000-8000-0000000000e5', 'expired');
select test_login('cc000000-0000-4000-8000-0000000000ad');
set local role authenticated;
-- « Remplacé » se juge sur les jetons normalisés (nullif(btrim(…), '')).
select set_establishment_pms_connector('cc000000-0000-4000-8000-0000000000e5', 'premier-jeton', false, 'premier jeton');
select set_establishment_pms_connector('cc000000-0000-4000-8000-0000000000e3', E'  jeton-factice-c2b\t\n', false, 'même jeton, recollé');
select set_establishment_pms_connector('cc000000-0000-4000-8000-0000000000e3', '   ', false, 'champ vide');
reset role;
select is(
  (select status from public.pms_cancellation_queue where pms_booking_id = '90000098'),
  'pending',
  'un PREMIER jeton (aucun avant) ne fait rien échouer'
);
select is(
  (select jsonb_build_object('file', (select status from public.pms_cancellation_queue where pms_booking_id = '90000099'),
                             'jeton', (select lobby_api_token from public.establishments where id = 'cc000000-0000-4000-8000-0000000000e3'))),
  jsonb_build_object('file', 'pending', 'jeton', 'jeton-factice-c2b'),
  'le même jeton recollé avec des espaces, puis un champ vide : rien n''échoue, le jeton reste (sans espaces)'
);
set local role authenticated;
select set_establishment_pms_connector('cc000000-0000-4000-8000-0000000000e3', ' jeton-factice-c2c ', true, 'nouveau compte Lobby');
reset role;
select is(
  (select status from public.pms_cancellation_queue where pms_booking_id = '90000099'),
  'failed',
  'jeton remplacé : l''annulation en attente passe en échec, jamais envoyée au nouveau compte'
);
select ok(
  (select last_error like 'jeton Lobby remplacé%' from public.pms_cancellation_queue where pms_booking_id = '90000099'),
  '… avec le motif, pour la vérification manuelle'
);
select is(
  (select lobby_api_token from public.establishments where id = 'cc000000-0000-4000-8000-0000000000e3'),
  'jeton-factice-c2c',
  'le nouveau jeton est stocké sans ses espaces'
);
select is(
  (select status from public.pms_cancellation_queue where pms_booking_id = '90000098'),
  'pending',
  'seulement CET établissement : l''annulation en attente d''un autre établissement ne bouge pas'
);

select * from finish();
rollback;
