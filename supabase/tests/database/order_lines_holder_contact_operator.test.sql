-- Refonte vue prestataire (2026-08-19) — migration 20260819180000. Lève la restriction "PII
-- minimale" documentée en 20260817180000 : create_order/create_manual_order_line/modify_order_line
-- propagent désormais holder_phone/holder_email sur order_lines (pas seulement holder_name). Ne
-- re-teste jamais la logique métier déjà couverte ailleurs (plafonds, verrouillage, calcul de
-- commission — create_order.test.sql/modify_order_line.test.sql/create_manual_order_line.test.sql)
-- : uniquement la propagation elle-même, sur les 3 sites touchés par cette migration.
--
-- RÉVISÉ 2026-09-10 (spec 31, Tranche 1) : create_order exige désormais auth.uid() non nul
-- (docs/journal/2026-09.md). Le bloc « achat client » ci-dessous simule donc une identité anonyme
-- réelle (test_login_anonymous), même patron que create_order.test.sql — pas un simple retrait du
-- rôle anon, qui échouerait maintenant en not_authenticated.
--
-- RÉVISÉ 2026-09-22 (fermeture de la fuite des colonnes de commission, docs/backlog.md) : ce
-- fichier lisait order_lines VIA l'operator (order_lines_select_operator) pour prouver, au passage,
-- que cette lecture RLS fonctionnait sur holder_phone/holder_email. Cette policy est supprimée
-- (20260922210000) — cet invariant est désormais couvert côté RPC par
-- partner_reservation_detail.test.sql (qui vérifie holder_phone pour l'operator propriétaire).
-- Les lectures-preuve ci-dessous passent donc en rôle privilégié (reset role) : ce fichier ne
-- prouve plus que la PROPAGATION elle-même, plus la lecture operator qui n'a plus lieu d'être ici.
begin;
select plan(8);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function test_logout() returns void language sql as $$
  reset request.jwt.claims;
$$;
-- Même patron que create_order.test.sql (spec 31) : simule un visiteur avec identité anonyme.
create function test_login_anonymous(uid uuid) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'is_anonymous', true)::text,
    true
  );
$$;

-- Fixtures : 1 partenaire/établissement, 1 compte operator actif sur cet établissement, 1 produit
-- activité simple. anon crée la réservation "achat client" (create_order) ; op1 crée la réservation
-- manuelle et modifie une ligne existante — l'operator n'est plus utilisé que pour APPELER les RPC
-- (autorisation), plus pour relire leur résultat (cf. entête).
insert into partners (id, display_name) values
  ('88960000-0000-4000-8000-000000000001', 'Holder Contact Test Partner');
insert into establishments (id, partner_id, name) values
  ('88960000-0000-4000-8000-000000000011', '88960000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Holder Contact'));
insert into auth.users (id, email) values
  ('88960000-0000-4000-8000-000000000021', 'holder-contact-op@test.local'),
  -- Compte TECHNIQUE fixe des réservations walk-in (`v_technical_account_id`,
  -- create_manual_order_line, 20260910140000) — provisionné ailleurs par `seed_auth_users.mjs`,
  -- jamais par ce fichier ; ce job pgTAP tourne délibérément SANS seed
  -- (`.github/workflows/hifago-ci.yml`, job `db`). Sans cette ligne, le cas
  -- create_manual_order_line plus bas violait `orders_account_id_fkey`.
  -- `on conflict do nothing` : cette base peut aussi être une base de DEV déjà seedée, où ce même
  -- UUID technique existe déjà — jamais un doublon à lever en erreur ici.
  ('e0000000-0000-4000-8000-000000000001', 'reserva-manual@hifago.local')
on conflict (id) do nothing;
update partner_accounts set partner_id = '88960000-0000-4000-8000-000000000001'
 where id = '88960000-0000-4000-8000-000000000021';
-- L'identité du client « achat direct » plus bas (RÉVISÉ 2026-09-10, cf. entête).
insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at) values
  ('88960000-0000-4000-8000-000000000099', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', true, now(), now());
insert into partner_capabilities (partner_id, role, source, status) values
  ('88960000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, establishment_id, source, status) values
  ('88960000-0000-4000-8000-000000000001', 'operator', '88960000-0000-4000-8000-000000000011',
   'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88960000-0000-4000-8000-000000000031', '88960000-0000-4000-8000-000000000001',
   '88960000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Holder Contact'), 10000, true, 'holder-contact-activity');
insert into product_availability (product_id, date, capacity, booked) values
  ('88960000-0000-4000-8000-000000000031', '2029-06-01', 10, 0),  -- create_order (anon)
  ('88960000-0000-4000-8000-000000000031', '2029-06-05', 10, 0),  -- create_manual_order_line (operator)
  -- booked 1 : la ligne 'reserved' (qty 1) posée en direct plus bas occupe 1 place ce jour-là, que
  -- modify_order_line rend en la remplaçant (booked >= 0 est une contrainte depuis 20260929112240).
  ('88960000-0000-4000-8000-000000000031', '2029-06-10', 10, 1),  -- modify_order_line, date source
  ('88960000-0000-4000-8000-000000000031', '2029-06-11', 10, 0);  -- modify_order_line, date cible

-- Fixture dédiée à modify_order_line (ligne 'reserved' construite directement, pas via create_order,
-- pour isoler le site modifié dans modify_order_line des autres) — posée ICI, avant tout switch de
-- rôle : orders/order_lines sont RPC-only en écriture (revoke insert sur authenticated/anon), seul
-- le rôle de connexion par défaut de ce fichier (avant tout `set local role`) a le grant nécessaire,
-- même contrainte que les inserts partners/establishments/products ci-dessus.
-- RÉVISÉ 2026-09-10 (spec 31, Tranche 2) : account_id ajouté aux deux colonnes (NOT NULL) — la
-- même identité anonyme (099) qui joue le client dans le bloc create_order plus bas, sans
-- conséquence ici (ce fixture ne teste aucune sémantique d'identité, seulement la copie
-- holder_phone/holder_email par modify_order_line).
insert into orders (id, account_id, holder_name, holder_email, holder_phone) values
  ('88960000-0000-4000-8000-000000000041', '88960000-0000-4000-8000-000000000099',
   'Holder Contact Modify', 'holder-contact-modify@hifago.test', '+57 300 555 6666');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name, holder_phone, holder_email,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88960000-0000-4000-8000-000000000042', '88960000-0000-4000-8000-000000000041',
  '88960000-0000-4000-8000-000000000099',
  '88960000-0000-4000-8000-000000000031', '2029-06-10', 1, 'reserved',
  'Holder Contact Modify', '+57 300 555 6666', 'holder-contact-modify@hifago.test',
  10000, 10000, 'direct', 0.17, 0, 0.17, 1700, 0, 1700
);

-- ===== create_order : holder_phone/holder_email propagés sur order_lines =========================
-- Résultat non capturé (jamais relu depuis anon, cf. commentaire ci-dessous) — même idiome que
-- create_order.test.sql cas 14a : un simple `select create_order(...)`, sans temp table (une temp
-- table créée sous un rôle ne peut être ni relue ni droppée sous un autre rôle : "must be owner").
set local role authenticated;
select test_login_anonymous('88960000-0000-4000-8000-000000000099');
-- Panier posé en cart_items (spec 32) : create_order lit désormais ses propres lignes pour
-- auth.uid(), plus un paramètre.
insert into cart_items (account_id, product_id, date, qty) values
  ('88960000-0000-4000-8000-000000000099', '88960000-0000-4000-8000-000000000031', '2029-06-01', 1);
select create_order(
  'Holder Contact Buyer', 'holder-contact-buyer@hifago.test', '+57 300 111 2222'
);
reset role;

-- Lu en rôle privilégié — order_lines n'a plus aucun accès SELECT direct pour authenticated/anon
-- depuis 20260922210000 ; ce bloc ne prouve plus que la PROPAGATION elle-même (la lecture operator
-- via has_capability est couverte par partner_reservation_detail.test.sql).
select is(
  (select holder_phone from order_lines where product_id = '88960000-0000-4000-8000-000000000031'
    and date = '2029-06-01'),
  '+57 300 111 2222',
  'create_order : holder_phone propagé sur order_lines'
);
select is(
  (select holder_email from order_lines where product_id = '88960000-0000-4000-8000-000000000031'
    and date = '2029-06-01'),
  'holder-contact-buyer@hifago.test',
  'create_order : holder_email propagé sur order_lines'
);

-- ===== create_manual_order_line : p_holder_phone propagé, holder_email = sentinelle ===============
set local role authenticated;
select test_login('88960000-0000-4000-8000-000000000021'); -- operator, pour l'autorisation de l'appel
create temp table tmp_manual_contact as
  select create_manual_order_line(
    '88960000-0000-4000-8000-000000000031', '2029-06-05', 1, 'Holder Contact Manual', null,
    '+57 300 333 4444'
  ) as result;
reset role;

select is(
  (select holder_phone from order_lines
    where id = (select (result->>'order_line_id')::uuid from tmp_manual_contact)),
  '+57 300 333 4444',
  'create_manual_order_line : p_holder_phone (déjà existant) propagé sur order_lines.holder_phone'
);
select is(
  (select holder_email from order_lines
    where id = (select (result->>'order_line_id')::uuid from tmp_manual_contact)),
  'reserva-manual@hifago.local',
  'create_manual_order_line : order_lines.holder_email reçoit la sentinelle walk-in (aucun email réel collecté)'
);
drop table tmp_manual_contact;

-- ===== modify_order_line : holder_phone/holder_email survivent au remplacement de ligne ===========
-- Fixture posée plus haut (avant le switch de rôle).
set local role authenticated;
select test_login('88960000-0000-4000-8000-000000000021'); -- operator, pour l'autorisation de l'appel
create temp table tmp_modify_contact as
  select modify_order_line(
    '88960000-0000-4000-8000-000000000042', '2029-06-11', 1, 'test PII holder_phone/holder_email'
  ) as result;
reset role;

select is(
  (select status from order_lines where id = '88960000-0000-4000-8000-000000000042'),
  'superseded',
  'modify_order_line : ancienne ligne bien marquée superseded (contrôle du fixture, pas le vrai objet du test)'
);
select is(
  (select holder_phone from order_lines
    where id = (select (result->>'order_line_id')::uuid from tmp_modify_contact)),
  '+57 300 555 6666',
  'modify_order_line : holder_phone copié depuis v_old_line sur la nouvelle ligne de remplacement'
);
select is(
  (select holder_email from order_lines
    where id = (select (result->>'order_line_id')::uuid from tmp_modify_contact)),
  'holder-contact-modify@hifago.test',
  'modify_order_line : holder_email copié depuis v_old_line sur la nouvelle ligne de remplacement'
);
select is(
  (select (result->>'ok')::boolean from tmp_modify_contact),
  true,
  'modify_order_line : appel réussi (contrôle du fixture)'
);
drop table tmp_modify_contact;

select * from finish();
rollback;
