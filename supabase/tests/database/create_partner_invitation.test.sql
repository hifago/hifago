-- Feature 13 (Socio : rejoindre via une invitation) — create_partner_invitation : accès réservé à
-- l'admin, jeton opaque dont seul le hash SHA-256 persiste, partner_codes pré-créé/réutilisé selon
-- le cas, entrée audit_log par invitation créée. consume_partner_invitation n'est pas retestée ici
-- (déjà entièrement couverte et gatée depuis la Tranche 1, concurrence comprise).
begin;
select plan(17);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email) values
  ('33330000-0000-4000-8000-000000000001', 'invite-admin@test.local'),
  ('33330000-0000-4000-8000-000000000002', 'invite-user@test.local');

insert into partner_capabilities (account_id, role, source, status)
  values ('33330000-0000-4000-8000-000000000001', 'admin', 'migration', 'active');

-- Fixture pour le cas « code déjà existant » : insérée en tant que postgres (avant le passage au
-- rôle authenticated ci-dessous), partner_codes étant RPC-only (aucune écriture directe, même
-- pour un futur appelant admin, cf. hifago/CLAUDE.md §3).
insert into partner_codes (code) values ('TEST-EXISTING');

-- Fixture pour le cas « code déjà attribué à un autre socio » (2026-08-26, gap corrigé : ce cas
-- réattribuait le code en silence au lieu d'échouer) — distinct de TEST-EXISTING ci-dessus, dont
-- le partner_id reste NULL (pré-créé/whitelisté, jamais attribué).
insert into partners (display_name) values ('Otro Socio Test') returning id as taken_code_partner_id \gset
insert into partner_codes (code, partner_id) values ('TEST-TAKEN', :'taken_code_partner_id');

-- non-admin refusé, rien créé ------------------------------------------------------------------
set local role authenticated;
select test_login('33330000-0000-4000-8000-000000000002');

select throws_ok(
  $$ select create_partner_invitation('TEST-NONADMIN', 'referrer') $$,
  '42501'::char(5), null,
  'un compte non-admin ne peut pas créer d''invitation'
);
select is(
  (select count(*) from partner_invitations where promo_code = 'TEST-NONADMIN')::int, 0,
  'aucune invitation créée par un appel refusé'
);
-- Compté sous l'admin : depuis 20261014073414, un non-admin ne lit plus aucun code — un comptage
-- sous son identité vaudrait 0 même si l'appel refusé en avait créé un.
select test_login('33330000-0000-4000-8000-000000000001');
select is(
  (select count(*) from partner_codes where code = 'TEST-NONADMIN')::int, 0,
  'aucun code créé non plus par un appel refusé'
);

-- onboarding_path invalide (même en admin) → exception, rien créé -----------------------------
select throws_ok(
  $$ select create_partner_invitation('TEST-BADPATH', 'bogus') $$,
  null, 'onboarding_path invalide : bogus',
  'onboarding_path hors domaine (''referrer''/''provider'') refusé'
);
select is(
  (select count(*) from partner_invitations where promo_code = 'TEST-BADPATH')::int, 0,
  'aucune invitation créée quand onboarding_path est invalide'
);

-- admin, code inexistant → succès, partner_codes créé automatiquement -------------------------
select lives_ok(
  $$ select create_partner_invitation('TEST-NEWCODE', 'referrer') $$,
  'un appel admin avec un nouveau code réussit'
);
select is(
  (select count(*) from partner_codes where code = 'TEST-NEWCODE')::int, 1,
  'partner_codes créé automatiquement pour un code inexistant'
);
select is(
  (select count(*) from partner_invitations where promo_code = 'TEST-NEWCODE')::int, 1,
  'une invitation a bien été créée pour ce code'
);

-- token_hash stocké correspond bien au SHA-256 du jeton brut retourné -------------------------
-- Capturé dans une table temp par une instruction séparée de la comparaison : un appel RPC qui
-- écrit puis une lecture RLS de la même ligne dans UNE SEULE instruction partagent le même
-- snapshot de requête et ne se voient pas entre eux (comportement standard MVCC de Postgres,
-- pas une régression de la RPC ni de la policy) — deux instructions distinctes évitent le piège.
create temp table tmp_invite_result as
  select create_partner_invitation('TEST-HASHCHECK', 'provider') as result;

select is(
  (
    select token_hash from partner_invitations
     where id = ((select result from tmp_invite_result)->>'invitation_id')::uuid
  ) = (
    select encode(extensions.digest((select result from tmp_invite_result)->>'token', 'sha256'), 'hex')
  ),
  true,
  'token_hash persisté correspond au SHA-256 du jeton retourné par l''appel'
);

drop table tmp_invite_result;

-- admin, code déjà existant → réutilisé, pas recréé/dupliqué ----------------------------------
select lives_ok(
  $$ select create_partner_invitation('TEST-EXISTING', 'referrer') $$,
  'un appel avec un code déjà existant réussit (réutilisé, pas recréé)'
);
select is(
  (select count(*) from partner_codes where code = 'TEST-EXISTING')::int, 1,
  'le code existant n''est pas dupliqué'
);
select is(
  (select count(*) from partner_invitations where promo_code = 'TEST-EXISTING')::int, 1,
  'une invitation a bien été créée pour le code existant'
);

-- admin, code déjà attribué à un autre partenaire → rejeté (2026-08-26) ------------------------
select throws_ok(
  $$ select create_partner_invitation('TEST-TAKEN', 'referrer') $$,
  '23505'::char(5), 'Ese código ya está asignado a otro socio',
  'un code déjà attribué à un autre socio est refusé'
);
select is(
  (select count(*) from partner_invitations where promo_code = 'TEST-TAKEN')::int, 0,
  'aucune invitation créée pour un code déjà attribué'
);
select is(
  (select partner_id from partner_codes where code = 'TEST-TAKEN'),
  :'taken_code_partner_id'::uuid,
  'le code reste attribué à son partenaire d''origine, pas réassigné'
);

-- une entrée audit_log par invitation créée avec succès (3 : TEST-NEWCODE/HASHCHECK/EXISTING).
-- Scopé aux entity_id des 3 invitations de CE test, jamais un count global de la table : la base
-- locale est aussi écrite par de vraies exécutions e2e Playwright (create_partner_invitation
-- appelée pour de vrai depuis /admin/invitations/new), donc audit_log n'est jamais vide/stable
-- entre deux lancements de ce fichier — un count global rendrait ce test non reproductible.
select is(
  (select count(*) from audit_log
    where action = 'partner_invitation.create'
      and entity_id in (
        select id from partner_invitations
         where promo_code in ('TEST-NEWCODE', 'TEST-HASHCHECK', 'TEST-EXISTING')
      ))::int,
  3,
  'une entrée audit_log pour chacune des 3 invitations créées avec succès dans ce test'
);
select is(
  (select actor_id from audit_log
    where action = 'partner_invitation.create'
      and entity_id = (select id from partner_invitations where promo_code = 'TEST-NEWCODE')),
  '33330000-0000-4000-8000-000000000001'::uuid,
  'audit_log.actor_id enregistré est bien l''admin appelant, pas une valeur fournie par le client'
);

select * from finish();
rollback;
