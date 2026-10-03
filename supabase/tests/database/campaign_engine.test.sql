-- Feature 25 (Admin : audiences serveur + moteur de campagne, envoi simulé) —
-- list_audience_members, create_campaign, process_campaign_batch.
begin;
select plan(32);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures ---------------------------------------------------------------------------------------
-- Partenaires : référent seul (actif) ; opérateur+référent (operator actif — preuve d'exclusion
-- mutuelle) ; référent à suspendre plus bas (test process_campaign_batch, inéligibilité survenue
-- entre création et traitement). Fixtures "référent onboarding" et "référent pending_review"
-- retirées (2026-08-20, migration 20260820010000_partner_capabilities_active_by_default.sql) :
-- partner_capabilities.status n'a plus que 2 valeurs (active/suspended), plus d'état "incomplet" à
-- couvrir — include_incomplete lui-même retiré de list_audience_members/create_campaign
-- (20260820040000_campaign_drop_include_incomplete.sql), plus rien de spécifique à tester ici.
insert into partners (id, display_name) values
  ('dd110000-0000-4000-8000-000000000001', 'Campaign Test Referrer Only'),
  ('dd110000-0000-4000-8000-000000000002', 'Campaign Test Operator And Referrer'),
  ('dd110000-0000-4000-8000-000000000005', 'Campaign Test Referrer To Suspend');

-- referrer AVANT operator pour dd...0002 : le trigger enforce_operator_implies_referrer exige que
-- la ligne referrer existe déjà (il ne la crée jamais lui-même, contrairement à grant_capability).
insert into partner_capabilities (partner_id, role, source, status) values
  ('dd110000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active'),
  ('dd110000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active'),
  ('dd110000-0000-4000-8000-000000000002', 'operator', 'migration', 'active'),
  ('dd110000-0000-4000-8000-000000000005', 'referrer', 'migration', 'active');

-- Comptes. ACC_CLIENT_UNREACHABLE : email/phone tous deux null (autorisé, is_nullable=YES sur les
-- deux colonnes) — seul moyen de forcer reachable=false.
insert into auth.users (id, email) values
  ('dd110000-0000-4000-8000-000000000021', 'campaign-referrer-only@test.local'),
  ('dd110000-0000-4000-8000-000000000022', 'campaign-op-and-ref@test.local'),
  ('dd110000-0000-4000-8000-000000000025', 'campaign-ref-to-suspend@test.local'),
  ('dd110000-0000-4000-8000-000000000026', 'campaign-client-consent@test.local'),
  ('dd110000-0000-4000-8000-000000000027', 'campaign-client-no-consent@test.local'),
  ('dd110000-0000-4000-8000-000000000029', 'campaign-no-relation@test.local'),
  ('dd110000-0000-4000-8000-000000000031', 'campaign-admin@test.local');
insert into auth.users (id, email, phone) values
  ('dd110000-0000-4000-8000-000000000028', null, null);

update partner_accounts set partner_id = 'dd110000-0000-4000-8000-000000000001'
 where id = 'dd110000-0000-4000-8000-000000000021';
update partner_accounts set partner_id = 'dd110000-0000-4000-8000-000000000002'
 where id = 'dd110000-0000-4000-8000-000000000022';
update partner_accounts set partner_id = 'dd110000-0000-4000-8000-000000000005'
 where id = 'dd110000-0000-4000-8000-000000000025';
-- 021/026/027/028/029 restent sans partner_id : clients ou comptes sans aucune relation.

insert into partner_capabilities (account_id, role, source, status) values
  ('dd110000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

-- orders : uniquement la table orders (list_audience_members/process_campaign_batch ne lisent
-- jamais order_lines) — account_id + holder_name + marketing_consent suffisent.
insert into orders (account_id, holder_name, holder_email, marketing_consent) values
  ('dd110000-0000-4000-8000-000000000026', 'Cliente Consentimiento OK', 'consentimiento-ok@test.local', true),
  ('dd110000-0000-4000-8000-000000000027', 'Cliente Sin Consentimiento', 'sin-consentimiento@test.local', false),
  ('dd110000-0000-4000-8000-000000000028', 'Cliente Inalcanzable', 'inalcanzable@test.local', true);

set local role authenticated;

-- Non-admin : chaque RPC refusée -----------------------------------------------------------------
select test_login('dd110000-0000-4000-8000-000000000021'); -- référent, pas admin
select throws_ok(
  $$ select list_audience_members('clients') $$,
  '42501'::char(5), 'list_audience_members réservé au rôle admin',
  'list_audience_members refuse un appelant non-admin'
);
select throws_ok(
  $$ select create_campaign('clients', 'whatsapp', 'Hola') $$,
  '42501'::char(5), 'create_campaign réservé au rôle admin',
  'create_campaign refuse un appelant non-admin'
);
select throws_ok(
  $$ select process_campaign_batch('00000000-0000-4000-8000-000000000099'::uuid) $$,
  '42501'::char(5), 'process_campaign_batch réservé au rôle admin',
  'process_campaign_batch refuse un appelant non-admin'
);

select test_login('dd110000-0000-4000-8000-000000000031'); -- admin

-- audience invalide → exception --------------------------------------------------------------
select throws_ok(
  $$ select list_audience_members('bogus') $$,
  'P0001'::char(5), null,
  'list_audience_members refuse une audience invalide'
);

-- providers : opérateur actif apparaît -------------------------------------------------------
select is(
  (select count(*) from list_audience_members('providers')
    where account_id = 'dd110000-0000-4000-8000-000000000022')::int,
  1,
  'providers : le compte avec operator actif apparaît'
);
-- referrers : le MÊME compte n'apparaît JAMAIS, malgré sa ligne referrer active (invariant) ------
select is(
  (select count(*) from list_audience_members('referrers')
    where account_id = 'dd110000-0000-4000-8000-000000000022')::int,
  0,
  'referrers : le compte avec operator actif N''apparaît PAS, même avec une ligne referrer active'
);
select is(
  (select count(*) from list_audience_members('referrers')
    where account_id = 'dd110000-0000-4000-8000-000000000021')::int,
  1,
  'referrers : le référent pur (sans operator) apparaît'
);

-- clients : uniquement les comptes avec >=1 commande ------------------------------------------
select is(
  (select count(*) from list_audience_members('clients')
    where account_id in (
      'dd110000-0000-4000-8000-000000000026', 'dd110000-0000-4000-8000-000000000027',
      'dd110000-0000-4000-8000-000000000028'
    ))::int,
  3,
  'clients : les 3 comptes avec au moins une commande apparaissent'
);
select is(
  (select count(*) from list_audience_members('clients')
    where account_id = 'dd110000-0000-4000-8000-000000000021')::int,
  0,
  'clients : un référent sans commande N''apparaît PAS'
);

-- all : n''importe quel compte, même sans aucune relation ----------------------------------------
select is(
  (select count(*) from list_audience_members('all')
    where account_id = 'dd110000-0000-4000-8000-000000000029')::int,
  1,
  'all : un compte sans aucune relation apparaît quand même'
);

-- partners : referrer OU operator ----------------------------------------------------------------
select is(
  (select count(*) from list_audience_members('partners')
    where account_id in (
      'dd110000-0000-4000-8000-000000000021', 'dd110000-0000-4000-8000-000000000022'
    ))::int,
  2,
  'partners : référent seul ET opérateur+référent apparaissent tous les deux'
);

-- create_campaign : snapshote les bonnes cibles avec le bon statut initial ----------------------
create temp table tmp_campaign_clients as
  select create_campaign('clients', 'whatsapp', 'Hola {nombre}') as result;

select is(
  (select result->>'ok' from tmp_campaign_clients), 'true', 'create_campaign réussit (audience clients)'
);
select is(
  (select status from comm_campaigns
    where id = (select (result->>'campaign_id')::uuid from tmp_campaign_clients)),
  'draft',
  'comm_campaigns créée avec status=draft'
);
select is(
  (select status from comm_campaign_targets
    where campaign_id = (select (result->>'campaign_id')::uuid from tmp_campaign_clients)
      and account_id = 'dd110000-0000-4000-8000-000000000026'),
  'pending',
  'cible joignable avec consentement → pending à la création (le consentement n''est PAS vérifié ici)'
);
select is(
  (select status from comm_campaign_targets
    where campaign_id = (select (result->>'campaign_id')::uuid from tmp_campaign_clients)
      and account_id = 'dd110000-0000-4000-8000-000000000027'),
  'pending',
  'cible joignable SANS consentement → pending quand même à la création (filtré plus tard, pas ici)'
);
select is(
  (select status from comm_campaign_targets
    where campaign_id = (select (result->>'campaign_id')::uuid from tmp_campaign_clients)
      and account_id = 'dd110000-0000-4000-8000-000000000028'),
  'skipped_unreachable',
  'cible sans email ni téléphone → skipped_unreachable dès la création'
);
select is(
  (select jsonb_build_object('action', action, 'entity_table', entity_table) from audit_log
    where entity_id = (select (result->>'campaign_id')::uuid from tmp_campaign_clients)),
  jsonb_build_object('action', 'campaign.create', 'entity_table', 'comm_campaigns'),
  'audit_log enregistre campaign.create'
);

-- process_campaign_batch : consentement (campagne clients ci-dessus) ----------------------------
select is(
  (select (process_campaign_batch(
     (select (result->>'campaign_id')::uuid from tmp_campaign_clients)
   )->>'ok')),
  'true',
  'process_campaign_batch traite le lot sans erreur'
);
select is(
  (select status from comm_campaign_targets
    where campaign_id = (select (result->>'campaign_id')::uuid from tmp_campaign_clients)
      and account_id = 'dd110000-0000-4000-8000-000000000026'),
  'sent',
  'cible avec consentement → sent (envoi simulé)'
);
select is(
  (select sent_at is not null from comm_campaign_targets
    where campaign_id = (select (result->>'campaign_id')::uuid from tmp_campaign_clients)
      and account_id = 'dd110000-0000-4000-8000-000000000026'),
  true,
  'sent_at renseigné pour la cible envoyée'
);
select is(
  (select status from comm_campaign_targets
    where campaign_id = (select (result->>'campaign_id')::uuid from tmp_campaign_clients)
      and account_id = 'dd110000-0000-4000-8000-000000000027'),
  'skipped_no_consent',
  'cible SANS consentement sur sa dernière commande → skipped_no_consent'
);
select is(
  (select status from comm_campaign_targets
    where campaign_id = (select (result->>'campaign_id')::uuid from tmp_campaign_clients)
      and account_id = 'dd110000-0000-4000-8000-000000000028'),
  'skipped_unreachable',
  'cible skipped_unreachable N''est PAS reprise par process_campaign_batch (seul status=pending l''est)'
);
select is(
  (select status from comm_campaigns
    where id = (select (result->>'campaign_id')::uuid from tmp_campaign_clients)),
  'completed',
  'campagne passe à completed une fois toutes les cibles pending traitées'
);
-- Identifiant gardé pour admin_campaign_target_counts, en fin de fichier : là, les autres campagnes
-- du test existent aussi, et une RPC qui ne filtrerait plus par campagne serait détectée.
create temp table tmp_campaign_clients_id as
  select (result->>'campaign_id')::uuid as id from tmp_campaign_clients;
drop table tmp_campaign_clients;

-- process_campaign_batch : référent sans AUCUNE commande, jamais soumis au filtre de consentement -
create temp table tmp_campaign_referrers as
  select create_campaign('referrers', 'email', 'Hola referente') as result;

select is(
  (select (process_campaign_batch(
     (select (result->>'campaign_id')::uuid from tmp_campaign_referrers)
   )->>'ok')),
  'true',
  'process_campaign_batch (audience referrers) traite le lot sans erreur'
);
select is(
  (select status from comm_campaign_targets
    where campaign_id = (select (result->>'campaign_id')::uuid from tmp_campaign_referrers)
      and account_id = 'dd110000-0000-4000-8000-000000000021'),
  'sent',
  'référent pur (aucune commande) → sent, jamais soumis au filtre de consentement'
);
drop table tmp_campaign_referrers;

-- process_campaign_batch : inéligibilité survenue ENTRE la création et le traitement ------------
create temp table tmp_campaign_to_suspend as
  select create_campaign('referrers', 'whatsapp', 'Hola') as result;

select is(
  (select status from comm_campaign_targets
    where campaign_id = (select (result->>'campaign_id')::uuid from tmp_campaign_to_suspend)
      and account_id = 'dd110000-0000-4000-8000-000000000025'),
  'pending',
  'cible active à la création → pending (avant suspension)'
);

-- partner_capabilities est RPC-only (grants insert/update/delete révoqués pour authenticated) —
-- reset role le temps de cette seule mutation de fixture (contexte privilégié pré-switch), comme
-- toutes les autres fixtures de ce fichier, authenticated+admin repris juste après.
reset role;
update partner_capabilities set status = 'suspended'
 where partner_id = 'dd110000-0000-4000-8000-000000000005' and role = 'referrer';
set local role authenticated;
select test_login('dd110000-0000-4000-8000-000000000031');

select is(
  (select (process_campaign_batch(
     (select (result->>'campaign_id')::uuid from tmp_campaign_to_suspend)
   )->>'ok')),
  'true',
  'process_campaign_batch traite le lot malgré la suspension entre-temps'
);
select is(
  (select status from comm_campaign_targets
    where campaign_id = (select (result->>'campaign_id')::uuid from tmp_campaign_to_suspend)
      and account_id = 'dd110000-0000-4000-8000-000000000025'),
  'skipped_ineligible',
  'capacité suspendue ENTRE création et traitement → skipped_ineligible (preuve de la revalidation à l''envoi)'
);
drop table tmp_campaign_to_suspend;

-- admin_campaign_target_counts (20261002155922) : compteurs agrégés en SQL --------------------
-- Comparés au décompte DIRECT de la table, jamais à des nombres absolus : l'audience `clients`
-- inclut toute commande présente sur la base, seed compris.
select is(
  (select jsonb_object_agg(status, n order by status)
     from admin_campaign_target_counts(array[(select id from tmp_campaign_clients_id)])),
  (select jsonb_object_agg(status, c order by status)
     from (select status, count(*) as c from comm_campaign_targets
            where campaign_id = (select id from tmp_campaign_clients_id)
            group by status) t),
  'admin_campaign_target_counts rend, par statut, exactement le décompte de la table'
);
select ok(
  (select count(distinct campaign_id) = 1 and count(*) = count(distinct status)
     from admin_campaign_target_counts(array[(select id from tmp_campaign_clients_id)])),
  'une seule campagne demandée, une ligne par statut (agrégée en SQL : rien que max_rows puisse tronquer)'
);
select test_login('dd110000-0000-4000-8000-000000000021'); -- référent, pas admin
select is(
  (select count(*)::int
     from admin_campaign_target_counts(array[(select id from tmp_campaign_clients_id)])),
  0,
  'un non-admin obtient zéro ligne, pas une erreur : la RLS admin de comm_campaign_targets filtre (INVOKER)'
);
select test_login('dd110000-0000-4000-8000-000000000031'); -- admin, pour la suite du fichier

-- process_campaign_batch : campagne introuvable ------------------------------------------------
select throws_ok(
  $$ select process_campaign_batch('00000000-0000-4000-8000-000000000098'::uuid) $$,
  'P0001'::char(5), 'campagne introuvable',
  'process_campaign_batch refuse un campaign_id inexistant'
);

select * from finish();
rollback;
