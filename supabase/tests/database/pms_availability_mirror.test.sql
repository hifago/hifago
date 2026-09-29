-- Miroir de disponibilité LobbyPMS (20260917140000) et le filtre de recherche qu'il alimente
-- (20260917150000).
--
-- CE QUE CE FICHIER PROTÈGE, et qui n'était protégé par rien : jusqu'au 2026-09-17, `search_catalog`
-- portait `or e.lobby_connector_active`, un court-circuit TOTAL du filtre de dates pour tout
-- établissement connecté — et AUCUN test du dépôt ne rougissait si on retirait cette ligne.
-- `search_catalog.test.sql` ne crée aucun établissement `lobby_connector_active` : le mot n'y
-- apparaît nulle part.
--
-- ⚠️ `p_limite => 100000` sur CHAQUE appel de search_catalog, pour la raison écrite en tête de
-- `search_catalog.test.sql` : la fenêtre par défaut (24) se referme avant les couchages dès que la
-- base locale accumule des activités d'e2e, et l'assertion filtrerait alors un ensemble qui ne
-- contient déjà plus la fixture.
--
-- ⚠️ Établissement de test à UN SEUL couchage : avec deux, la carte groupée
-- (`n_alojamientos >= 2`) masquerait le filtre — elle est calculée HORS filtre de dates, donc
-- l'établissement resterait visible grâce à son autre couchage et on ne mesurerait rien.
--
-- ⚠️ DATES ANCRÉES SUR LE 1ER DU MOIS SUIVANT, JAMAIS `today_in_bogota() + k`. L'« ancre » est
-- `(date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date`, répétée telle
-- quelle (même forme que les rangs 5/6 plus bas) ; « +k » dans les commentaires de ce fichier veut
-- dire « ancre + k ». Pourquoi : `sync_pms_availability_month` n'écrit QUE les nuits du mois qu'on
-- lui passe et ignore les autres sans rien dire (20260918170000). Ce fichier écrivait le mois
-- COURANT avec des nuits `today_in_bogota() + k` : elles sortaient du mois dès que la date du jour
-- approchait sa fin. #29 (+8) rougissait du ~23 à la fin de chaque mois — CI de `main` rouge du 26
-- au 29/09/2026 sans que personne ne le voie —, #5 et #8 les deux derniers jours, et #9/#25/#30
-- passaient alors PAR ACCIDENT (repli par plage). Depuis le 1er du mois suivant, ancre + k reste
-- dans le même mois pour tout k ≤ 27, quel que soit le jour où le test tourne. Vérifié en rejouant
-- ce fichier sous une `today_in_bogota()` gelée (30/09, 31/10, 31/12, 31/01, 28/02, 01/10) dans une
-- transaction annulée — un geste de PREUVE, jamais un dispositif du test : le dépôt vieillit la
-- donnée, pas l'horloge (`clients_stage_timezone.test.sql`).

begin;
select plan(30);

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
insert into partners (id, display_name) values
  ('bbbb2222-0000-0000-0000-000000000001', 'PMS Mirror Test Partner');

insert into establishments (id, partner_id, name, slug, status, lobby_connector_active, lobby_api_token) values
  ('bbbb2222-0000-0000-0000-00000000000a', 'bbbb2222-0000-0000-0000-000000000001',
   '{"es":"Hotel PMS Mirror"}'::jsonb, 'bbbb-hotel-pms-mirror', 'active', true, 'fake-token-test'),
  -- Établissement NON connecté, même partenaire : sert de témoin — rien de ce lot ne doit changer
  -- pour lui.
  ('bbbb2222-0000-0000-0000-00000000000b', 'bbbb2222-0000-0000-0000-000000000001',
   '{"es":"Hotel Sans PMS"}'::jsonb, 'bbbb-hotel-sans-pms', 'active', false, null);

insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop,
                      lobby_category_id, capacity, unit_count, lodging_kind) values
  ('bbbb2222-0000-0000-0000-0000000000c1', 'bbbb2222-0000-0000-0000-000000000001',
   'bbbb2222-0000-0000-0000-00000000000a', 'lodging', '{"es":"Chambre PMS"}'::jsonb,
   'bbbb-chambre-pms', true, 100000, 777001, 2, 1, 'private'),
  -- Une ACTIVITÉ du même établissement connecté : elle doit rester NON filtrée par dates, comme
  -- avant ce lot. Lobby ne connaît que des nuits ; élargir le filtre à elle serait un changement
  -- de comportement non demandé.
  ('bbbb2222-0000-0000-0000-0000000000c2', 'bbbb2222-0000-0000-0000-000000000001',
   'bbbb2222-0000-0000-0000-00000000000a', 'activity', '{"es":"Actividad PMS Hotel"}'::jsonb,
   'bbbb-actividad-pms', true, 50000, null, null, null, null);

-- ── 1. La frontière RPC-only ────────────────────────────────────────────────────────────────────
-- ⚠️ Les GRANTS des quatre RPC de ce lot (les trois du miroir + `invoke_pms_sync_availability`) ne
-- sont PAS vérifiés ici : `service_role_only_functions.test.sql` les porte, et son en-tête dit
-- explicitement d'y ajouter toute RPC réservée à une Edge Function ou à un cron. Une copie locale
-- coderait les signatures en dur (`(int, interval, interval, interval)`) et rougirait au premier
-- paramètre ajouté, pour une raison sans rapport avec la sécurité. Un seul jugement, un seul site.
select ok(
  has_table_privilege('anon', 'public.pms_availability_mirror', 'SELECT'),
  'le miroir est lisible par anon — search_catalog est security invoker, elle lit avec ses droits'
);
select ok(
  not has_table_privilege('anon', 'public.pms_availability_mirror', 'INSERT')
  and not has_table_privilege('anon', 'public.pms_availability_mirror', 'UPDATE')
  and not has_table_privilege('anon', 'public.pms_availability_mirror', 'DELETE'),
  'le miroir est en écriture RPC-only : anon ne peut rien y écrire'
);
select ok(
  not has_table_privilege('authenticated', 'public.pms_sync_state', 'SELECT'),
  'pms_sync_state est une file de travail interne : même authenticated ne la lit pas'
);

-- L'HORIZON DU CRON DOIT COUVRIR CELUI DE LA VENTE, et rien ne le tenait avant le 2026-09-18 :
-- `generate_series(0, 5)` s'arrêtait un mois trop tôt, donc le mois de `lastBookableDateIso`
-- (aujourd'hui + 6 mois) n'entrait jamais dans le miroir — et une recherche datée dessus faisait
-- disparaître tous les logements PMS. Le dépôt met nommément en garde contre la divergence des
-- horizons (20260913100000_lodging_default_availability.sql) ; cette assertion est ce qui rend la
-- mise en garde exécutable plutôt que déclarative (CLAUDE.md §11.20).
select ok(
  (select max(month) from public.claim_pms_sync_batch(100))
    >= to_char(today_in_bogota() + interval '6 months', 'YYYY-MM'),
  'le cron sème jusqu''au mois de lastBookableDateIso inclus — sinon le dernier mois vendable est un trou'
);

-- ── 2. Écriture d'un mois ───────────────────────────────────────────────────────────────────────
select is(
  (select public.sync_pms_availability_month(
     'bbbb2222-0000-0000-0000-00000000000a',
     to_char((date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date, 'YYYY-MM'),
     jsonb_build_array(
       jsonb_build_object('category_id', 777001,
         'date', to_char((date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date + 1, 'YYYY-MM-DD'),
         'available_units', 3),
       jsonb_build_object('category_id', 777001,
         'date', to_char((date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date + 2, 'YYYY-MM-DD'),
         'available_units', 0),
       -- Hors du mois demandé : doit être IGNORÉE, jamais écrite sous prétexte qu'elle est là.
       jsonb_build_object('category_id', 777001, 'date', '2099-01-05', 'available_units', 9)
     )) ->> 'written')::int,
  2,
  'sync_pms_availability_month n''écrit que les nuits DU mois demandé'
);

select is(
  (select count(*)::int from pms_availability_mirror
    where establishment_id = 'bbbb2222-0000-0000-0000-00000000000a' and date = '2099-01-05'),
  0,
  'une nuit hors du mois demandé n''entre pas dans le miroir'
);

select is(
  (select public.sync_pms_availability_month('bbbb2222-0000-0000-0000-00000000000a', '2026-13', '[]'::jsonb) ->> 'reason'),
  'invalid_month',
  'un mois mal formé est refusé, jamais interprété'
);

-- Le point que la première version ratait : `now()` est FIGÉ dans une transaction, donc un
-- mécanisme fondé sur « synced_at < maintenant » ne retirait rien quand deux syncs se suivaient.
-- Le remplacement du mois (delete puis insert) est déterministe — et ce test le prouve, puisqu'il
-- tourne précisément dans une transaction unique.
select is(
  (select public.sync_pms_availability_month(
     'bbbb2222-0000-0000-0000-00000000000a',
     to_char((date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date, 'YYYY-MM'),
     jsonb_build_array(
       jsonb_build_object('category_id', 777001,
         'date', to_char((date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date + 1, 'YYYY-MM-DD'),
         'available_units', 5)
     )) ->> 'written')::int,
  1,
  'un resync du même mois ne conserve que ce que Lobby cote ENCORE'
);
select is(
  (select count(*)::int from pms_availability_mirror
    where establishment_id = 'bbbb2222-0000-0000-0000-00000000000a'
      and date = (date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date + 2),
  0,
  'une nuit que Lobby ne cote plus DISPARAÎT du miroir (sinon elle resterait vendable à jamais)'
);

select ok(
  (select lobby_last_synced_at is not null from establishments
    where id = 'bbbb2222-0000-0000-0000-00000000000a'),
  'lobby_last_synced_at est enfin écrite — colonne posée le 2026-08-19 et morte depuis'
);

-- ── 2bis. Invalidation par un événement hifago (lot A), backoff après échec (lot C) ────────────────
-- Migration 20260918170000. Nouvel établissement/produit : la claim(100) de la section 1 a déjà
-- réclamé les 7 mois de l'établissement 'a' (claimed_at posé) — inutile ici, et ça empêcherait de
-- prouver le cas où un mois est écrit SANS jamais passer par un claim (exactement ce que fera le
-- repli du lot B : night-availability écrit le miroir directement, jamais via le cron).
insert into establishments (id, partner_id, name, slug, status, lobby_connector_active, lobby_api_token) values
  ('bbbb2222-0000-0000-0000-00000000000c', 'bbbb2222-0000-0000-0000-000000000001',
   '{"es":"Hotel PMS Invalidation"}'::jsonb, 'bbbb-hotel-pms-invalidation', 'active', true, 'fake-token-test-2');

insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop,
                      lobby_category_id, capacity, unit_count, lodging_kind) values
  ('bbbb2222-0000-0000-0000-0000000000c3', 'bbbb2222-0000-0000-0000-000000000001',
   'bbbb2222-0000-0000-0000-00000000000c', 'lodging', '{"es":"Chambre Invalidation"}'::jsonb,
   'bbbb-chambre-invalidation', true, 100000, 777002, 2, 1, 'private');

-- Écrit SANS passer par claim_pms_sync_batch — exactement le chemin du repli (lot B, à venir).
select public.sync_pms_availability_month(
  'bbbb2222-0000-0000-0000-00000000000c',
  to_char((date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date, 'YYYY-MM'),
  jsonb_build_array(jsonb_build_object(
    'category_id', 777002,
    'date', to_char((date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date + 1, 'YYYY-MM-DD'),
    'available_units', 4
  )));

select is(
  (select claimed_at from pms_sync_state
    where establishment_id = 'bbbb2222-0000-0000-0000-00000000000c'
      and month = to_char((date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date, 'YYYY-MM')),
  null,
  'un mois écrit par sync_pms_availability_month SANS claim préalable a claimed_at NULL (le cas du repli)'
);

select is(
  (select count(*)::int from claim_pms_sync_batch(100)
    where establishment_id = 'bbbb2222-0000-0000-0000-00000000000c'
      and month = to_char((date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date, 'YYYY-MM')),
  0,
  'ce mois vient d''être synchronisé : frais, donc pas dû — même sans claimed_at'
);

select public.mark_pms_sync_due(
  'bbbb2222-0000-0000-0000-00000000000c',
  (date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date,
  (date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date + 1);

select is(
  (select count(*)::int from claim_pms_sync_batch(100)
    where establishment_id = 'bbbb2222-0000-0000-0000-00000000000c'
      and month = to_char((date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date, 'YYYY-MM')),
  1,
  'LE POINT DU LOT — invalidé après coup malgré claimed_at NULL, le mois redevient dû immédiatement '
  '(sans coalesce(claimed_at, ''-infinity''), invalidated_at > claimed_at vaut NULL et cette '
  'assertion rougit — c''est le défaut trouvé en écrivant ce test)'
);

-- Backoff : trois échecs successifs sur un mois « rang 3 ». ⚠️ Les deux claim(100) ci-dessus ont
-- réclamé TOUS les mois dus de l'établissement c en tant qu'effet de bord (limit=100, jamais filtré
-- par mois côté claim lui-même) — rang 3 compris, avec attempts=1 posé par ce claim. Repartir d'un
-- état connu plutôt que de faire porter l'assertion sur un compte contaminé par un appel sans
-- rapport (même piège que le `p_limite => 100000` déjà documenté en tête de fichier).
delete from pms_sync_state
 where establishment_id = 'bbbb2222-0000-0000-0000-00000000000c'
   and month = to_char(today_in_bogota() + interval '3 months', 'YYYY-MM');

select public.fail_pms_sync(
  'bbbb2222-0000-0000-0000-00000000000c',
  to_char(today_in_bogota() + interval '3 months', 'YYYY-MM'), 'panne 1');
select public.fail_pms_sync(
  'bbbb2222-0000-0000-0000-00000000000c',
  to_char(today_in_bogota() + interval '3 months', 'YYYY-MM'), 'panne 2');
select public.fail_pms_sync(
  'bbbb2222-0000-0000-0000-00000000000c',
  to_char(today_in_bogota() + interval '3 months', 'YYYY-MM'), 'panne 3');

select is(
  (select attempts from pms_sync_state
    where establishment_id = 'bbbb2222-0000-0000-0000-00000000000c'
      and month = to_char(today_in_bogota() + interval '3 months', 'YYYY-MM')),
  3,
  'trois échecs successifs : attempts vaut 3 — la première version le figeait à 1 pour toujours'
);
select ok(
  (select next_attempt_at > now() from pms_sync_state
    where establishment_id = 'bbbb2222-0000-0000-0000-00000000000c'
      and month = to_char(today_in_bogota() + interval '3 months', 'YYYY-MM')),
  'un couple en échec porte une date de prochaine tentative dans le futur (backoff exponentiel)'
);
select is(
  (select count(*)::int from claim_pms_sync_batch(100)
    where establishment_id = 'bbbb2222-0000-0000-0000-00000000000c'
      and month = to_char(today_in_bogota() + interval '3 months', 'YYYY-MM')),
  0,
  'LE POINT DU LOT — un couple en backoff n''est PAS réclamé, même par ailleurs dû (sans '
  'next_attempt_at, c''est le défaut qui laissait un jeton révoqué monopoliser le lot de 6)'
);

update pms_sync_state set next_attempt_at = now() - interval '1 second'
 where establishment_id = 'bbbb2222-0000-0000-0000-00000000000c'
   and month = to_char(today_in_bogota() + interval '3 months', 'YYYY-MM');

select is(
  (select count(*)::int from claim_pms_sync_batch(100)
    where establishment_id = 'bbbb2222-0000-0000-0000-00000000000c'
      and month = to_char(today_in_bogota() + interval '3 months', 'YYYY-MM')),
  1,
  'le backoff expiré redevient réclamable'
);

select public.sync_pms_availability_month(
  'bbbb2222-0000-0000-0000-00000000000c',
  to_char(today_in_bogota() + interval '3 months', 'YYYY-MM'), '[]'::jsonb);

select is(
  (select attempts from pms_sync_state
    where establishment_id = 'bbbb2222-0000-0000-0000-00000000000c'
      and month = to_char(today_in_bogota() + interval '3 months', 'YYYY-MM')),
  0,
  'un succès remet attempts à zéro'
);
select is(
  (select next_attempt_at from pms_sync_state
    where establishment_id = 'bbbb2222-0000-0000-0000-00000000000c'
      and month = to_char(today_in_bogota() + interval '3 months', 'YYYY-MM')),
  null,
  'un succès efface le backoff'
);

-- mark_pms_sync_due_for_order_line : le poll des bookings (pms-poll-bookings) ne connaît qu'un
-- order_line_id, jamais un établissement ni une plage de dates — la fonction doit les retrouver
-- elle-même. Rang 5 de l'horizon, tronqué au mois pour ne jamais chevaucher un autre test.
-- `partner_accounts` se provisionne automatiquement depuis un trigger sur `auth.users`
-- (20260813163438_identity_account_provisioning.sql) — un insert explicite ici ferait doublon.
insert into auth.users (id, email) values
  ('bbbb2222-0000-0000-0000-0000000000f1', 'pms-invalidation-test@test.local');
insert into orders (id, account_id, holder_name, holder_email) values
  ('bbbb2222-0000-0000-0000-0000000000d1', 'bbbb2222-0000-0000-0000-0000000000f1',
   'Test Invalidation PMS', 'pms-invalidation-test@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, end_date, qty, holder_name, pms_booking_id,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('bbbb2222-0000-0000-0000-0000000000d2', 'bbbb2222-0000-0000-0000-0000000000d1',
   'bbbb2222-0000-0000-0000-0000000000f1', 'bbbb2222-0000-0000-0000-0000000000c3',
   (date_trunc('month', today_in_bogota()::timestamp) + interval '5 months')::date + 9,
   (date_trunc('month', today_in_bogota()::timestamp) + interval '5 months')::date + 11,
   1, 'Test Invalidation PMS', '90000555',
   100000, 100000, 'direct', 0.17, 0.10, 0.07, 17000, 10000, 7000);

-- Même piège que rang 3 plus haut : les claim(100) précédents ont déjà réclamé rang 5 en effet de
-- bord (claimed_at posé). sync_pms_availability_month ne touche jamais claimed_at — reset explicite
-- pour retrouver claimed_at NULL, seul état où invalidated_at > claimed_at est comparable dans une
-- transaction où now() ne bouge pas (sinon les deux valent EXACTEMENT le même now() figé, et
-- l'inégalité STRICTE échoue pour une raison qui n'a rien à voir avec la fonction testée).
delete from pms_sync_state
 where establishment_id = 'bbbb2222-0000-0000-0000-00000000000c'
   and month = to_char(date_trunc('month', today_in_bogota()::timestamp) + interval '5 months', 'YYYY-MM');

select public.sync_pms_availability_month(
  'bbbb2222-0000-0000-0000-00000000000c',
  to_char(date_trunc('month', today_in_bogota()::timestamp) + interval '5 months', 'YYYY-MM'),
  '[]'::jsonb);

select is(
  (select count(*)::int from claim_pms_sync_batch(100)
    where establishment_id = 'bbbb2222-0000-0000-0000-00000000000c'
      and month = to_char(date_trunc('month', today_in_bogota()::timestamp) + interval '5 months', 'YYYY-MM')),
  0,
  'mois tout juste synchronisé : pas dû, avant tout appel de mark_pms_sync_due_for_order_line'
);

select public.mark_pms_sync_due_for_order_line('bbbb2222-0000-0000-0000-0000000000d2');

select is(
  (select count(*)::int from claim_pms_sync_batch(100)
    where establishment_id = 'bbbb2222-0000-0000-0000-00000000000c'
      and month = to_char(date_trunc('month', today_in_bogota()::timestamp) + interval '5 months', 'YYYY-MM')),
  1,
  'mark_pms_sync_due_for_order_line retrouve établissement + mois depuis le SEUL order_line_id — '
  'c''est ce que pms-poll-bookings appelle sur une annulation détectée côté Lobby (404)'
);

-- resolve_pms_cancellation : une annulation ACTÉE côté Lobby doit invalider le mois retrouvé depuis
-- order_lines.pms_booking_id (le booking est parfois partagé entre la nuit et ses activités).
-- Rang 6, dernier mois de l'horizon — jamais touché par un autre test de ce fichier.
insert into pms_cancellation_queue (id, pms_booking_id, establishment_id, status) values
  ('bbbb2222-0000-0000-0000-0000000000e1', '90000777', 'bbbb2222-0000-0000-0000-00000000000c', 'pending');
insert into order_lines (
  id, order_id, account_id, product_id, date, end_date, qty, holder_name, pms_booking_id,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('bbbb2222-0000-0000-0000-0000000000e2', 'bbbb2222-0000-0000-0000-0000000000d1',
   'bbbb2222-0000-0000-0000-0000000000f1', 'bbbb2222-0000-0000-0000-0000000000c3',
   (date_trunc('month', today_in_bogota()::timestamp) + interval '6 months')::date + 4,
   (date_trunc('month', today_in_bogota()::timestamp) + interval '6 months')::date + 6,
   1, 'Test Invalidation PMS', '90000777',
   100000, 100000, 'direct', 0.17, 0.10, 0.07, 17000, 10000, 7000);

-- Même raison que rang 5 ci-dessus.
delete from pms_sync_state
 where establishment_id = 'bbbb2222-0000-0000-0000-00000000000c'
   and month = to_char(date_trunc('month', today_in_bogota()::timestamp) + interval '6 months', 'YYYY-MM');

select public.sync_pms_availability_month(
  'bbbb2222-0000-0000-0000-00000000000c',
  to_char(date_trunc('month', today_in_bogota()::timestamp) + interval '6 months', 'YYYY-MM'),
  '[]'::jsonb);

select is(
  (select count(*)::int from claim_pms_sync_batch(100)
    where establishment_id = 'bbbb2222-0000-0000-0000-00000000000c'
      and month = to_char(date_trunc('month', today_in_bogota()::timestamp) + interval '6 months', 'YYYY-MM')),
  0,
  'mois tout juste synchronisé : pas dû, avant la résolution de l''annulation'
);

select public.resolve_pms_cancellation('bbbb2222-0000-0000-0000-0000000000e1', 'done', 200, null);

select is(
  (select count(*)::int from claim_pms_sync_batch(100)
    where establishment_id = 'bbbb2222-0000-0000-0000-00000000000c'
      and month = to_char(date_trunc('month', today_in_bogota()::timestamp) + interval '6 months', 'YYYY-MM')),
  1,
  'LE POINT DU LOT — resolve_pms_cancellation(''done'') invalide le mois retrouvé depuis '
  'order_lines.pms_booking_id — sans lui, jusqu''à 24 h de miroir faux après une vraie annulation'
);
select is(
  (select status from pms_cancellation_queue where id = 'bbbb2222-0000-0000-0000-0000000000e1'),
  'done',
  'resolve_pms_cancellation continue de faire son travail d''origine : clore l''entrée'
);

-- ── 3. Le filtre de recherche ───────────────────────────────────────────────────────────────────
set local role anon;

-- Le miroir ne porte à cet instant que la nuit +1 (disponible), pour le mois de l'ancre.
select is(
  (select count(*)::int from search_catalog(
     p_desde => (date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date + 1,
     p_hasta => (date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date + 1,
     p_limite => 100000)
    where slug = 'bbbb-chambre-pms'),
  1,
  'une nuit disponible dans la plage : le logement PMS apparaît'
);

-- LOT D (20260918180000) : cette plage n'a JAMAIS été synchronisée (aucune ligne du tout dans le
-- miroir, pas même à 0), alors que l'établissement est par ailleurs frais (+1 vient de réussir).
-- Repli PAR PLAGE désormais : elle réapparaît. Avant ce lot, ce test affirmait 0 — c'était le
-- défaut que le lot referme : « frais dans l'ensemble » ne veut pas dire « frais pour CE mois ».
select is(
  (select count(*)::int from search_catalog(
     p_desde => (date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date + 5,
     p_hasta => (date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date + 6,
     p_limite => 100000)
    where slug = 'bbbb-chambre-pms'),
  1,
  'LE POINT DU LOT D — une plage JAMAIS synchronisée (aucune ligne, pas un zéro) réapparaît même si '
  'l''établissement est frais par ailleurs (sans le repli par plage, cette assertion rougit à 0)'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000) where slug = 'bbbb-chambre-pms'),
  1,
  'recherche SANS dates : le filtre ne joue pas, le logement apparaît normalement'
);

select is(
  (select count(*)::int from search_catalog(
     p_desde => (date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date + 5,
     p_hasta => (date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date + 6,
     p_limite => 100000)
    where slug = 'bbbb-actividad-pms'),
  1,
  'une ACTIVITÉ du même établissement connecté reste non filtrée par dates, comme avant ce lot'
);

reset role;

-- Le CONTRE-EXEMPLE qui rend le test ci-dessus significatif : une nuit RÉELLEMENT complète (une
-- ligne ÉCRITE à available_units = 0), et pas la simple absence d'une ligne, doit continuer à faire
-- disparaître le logement. C'est exactement la distinction que `not exists(...)` (sans le filtre
-- `available_units > 0`) est censée tenir — sans elle, un « complet » réel deviendrait invisible.
select public.sync_pms_availability_month(
  'bbbb2222-0000-0000-0000-00000000000a',
  to_char((date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date, 'YYYY-MM'),
  jsonb_build_array(
    jsonb_build_object('category_id', 777001,
      'date', to_char((date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date + 1, 'YYYY-MM-DD'),
      'available_units', 5),
    jsonb_build_object('category_id', 777001,
      'date', to_char((date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date + 8, 'YYYY-MM-DD'),
      'available_units', 0)
  ));
set local role anon;
select is(
  (select count(*)::int from search_catalog(
     p_desde => (date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date + 8,
     p_hasta => (date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date + 8,
     p_limite => 100000)
    where slug = 'bbbb-chambre-pms'),
  0,
  'une nuit RÉELLEMENT complète (ligne ÉCRITE à 0) reste absente — le repli par plage ne joue que '
  'sur une ABSENCE de ligne, jamais sur un vrai zéro'
);
reset role;

-- Miroir périmé : échec OUVERT. Un cron arrêté ou un Lobby injoignable ne doit jamais faire
-- disparaître le partenaire du site — CLAUDE.md §4.4 impose l'échec fermé sur une RÉSERVATION,
-- jamais sur un affichage.
-- ⚠️ C'est `establishments.lobby_last_synced_at` qui porte la fraîcheur depuis le 2026-09-18, plus
-- `pms_availability_mirror.synced_at` : la première version de `search_catalog` balayait le miroir
-- entier pour chaque chambre invendable (51 ms contre 7,7 ms mesurés), alors que l'information est
-- déjà sur la ligne `establishments` déjà jointe. Les deux colonnes sont écrites dans la MÊME
-- transaction par `sync_pms_availability_month`, donc elles ne peuvent pas diverger — mais ce test
-- doit vieillir celle qui est lue, sinon il prouverait un mécanisme qui n'existe plus.
-- ⚠️ CIBLE : +8, pas +5/+6. Depuis le lot D, +5/+6 (aucune ligne) réapparaît DÉJÀ via le repli par
-- plage, frais ou pas — ce test-ci doit isoler le mécanisme par ÉTABLISSEMENT, donc viser une date
-- qui PORTE une ligne (+8, écrite à 0 juste au-dessus) : le repli par plage n'a alors AUCUNE prise
-- (une ligne existe), seul le repli par établissement peut expliquer la réapparition.
update establishments set lobby_last_synced_at = now() - interval '7 hours'
 where id = 'bbbb2222-0000-0000-0000-00000000000a';
update pms_availability_mirror set synced_at = now() - interval '7 hours'
 where establishment_id = 'bbbb2222-0000-0000-0000-00000000000a';
set local role anon;
select is(
  (select count(*)::int from search_catalog(
     p_desde => (date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date + 8,
     p_hasta => (date_trunc('month', today_in_bogota()::timestamp) + interval '1 month')::date + 8,
     p_limite => 100000)
    where slug = 'bbbb-chambre-pms'),
  1,
  'miroir périmé (plus de 6 h) : retour à la doctrine optimiste MÊME sur une nuit qui porte une '
  'ligne à 0 (isole le repli par établissement du repli par plage ajouté juste au-dessus)'
);
reset role;

select * from finish();
rollback;
