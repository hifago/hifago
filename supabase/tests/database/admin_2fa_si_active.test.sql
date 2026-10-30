-- 2FA admin : exigence d'AAL2 CONDITIONNELLE (20261030090000, spec 07 §8/§10).
--
-- is_admin() n'exige l'AAL2 de la session que pour un compte qui a un facteur MFA VÉRIFIÉ. Qui n'a
-- rien activé, ou a abandonné un enrôlement (facteur `unverified`), n'est jamais bloqué — c'est
-- l'obligation générale de 20260815250000 qui avait verrouillé l'accès admin réel le 2026-08-15.
-- has_admin_capability() reste, elle, sans exigence d'AAL2 : le garde applicatif s'en sert pour
-- envoyer un admin AAL1 sur /mfa/verify au lieu de le renvoyer à `/` en boucle.
begin;
select plan(8);

-- Le claim `aal` est celui du JWT réel : auth.jwt()->>'aal' ('aal1' après mot de passe/Google,
-- 'aal2' après un challenge MFA vérifié). NULL = claim absent.
create function test_login(uid uuid, aal text default null) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', uid, 'role', 'authenticated', 'aal', aal))::text,
    true
  );
$$;

insert into auth.users (id, email) values
  ('a2fa0000-0000-4000-8000-000000000021', 'twofa-sans-facteur@test.local'),
  ('a2fa0000-0000-4000-8000-000000000022', 'twofa-facteur-verifie@test.local'),
  ('a2fa0000-0000-4000-8000-000000000023', 'twofa-facteur-abandonne@test.local'),
  ('a2fa0000-0000-4000-8000-000000000024', 'twofa-non-admin@test.local'),
  ('a2fa0000-0000-4000-8000-000000000025', 'twofa-cle-securite@test.local');

insert into partner_capabilities (account_id, role, source, status) values
  ('a2fa0000-0000-4000-8000-000000000021', 'admin', 'migration', 'active'),
  ('a2fa0000-0000-4000-8000-000000000022', 'admin', 'migration', 'active'),
  ('a2fa0000-0000-4000-8000-000000000023', 'admin', 'migration', 'active'),
  ('a2fa0000-0000-4000-8000-000000000025', 'admin', 'migration', 'active');

-- friendly_name '' (jamais NULL : un NULL casse toute connexion GoTrue, cf. seed.sql).
insert into auth.mfa_factors (id, user_id, factor_type, status, friendly_name, secret, created_at, updated_at) values
  ('a2fa0000-0000-4000-8000-0000000000f2', 'a2fa0000-0000-4000-8000-000000000022',
   'totp', 'verified', '', 'MUFUB2W7HB62XKO323JGYVPWPE7OJHI7', now(), now()),
  ('a2fa0000-0000-4000-8000-0000000000f3', 'a2fa0000-0000-4000-8000-000000000023',
   'totp', 'unverified', '', 'MUFUB2W7HB62XKO323JGYVPWPE7OJHI7', now(), now()),
  ('a2fa0000-0000-4000-8000-0000000000f4', 'a2fa0000-0000-4000-8000-000000000024',
   'totp', 'verified', '', 'MUFUB2W7HB62XKO323JGYVPWPE7OJHI7', now(), now());
insert into auth.mfa_factors (id, user_id, factor_type, status, friendly_name, created_at, updated_at) values
  ('a2fa0000-0000-4000-8000-0000000000f5', 'a2fa0000-0000-4000-8000-000000000025',
   'webauthn', 'verified', 'cle-test', now(), now());

-- ── Admin sans aucun facteur : jamais bloqué, quel que soit l'AAL ───────────────────────────────
select test_login('a2fa0000-0000-4000-8000-000000000021', 'aal1');
select is(is_admin(), true, 'admin sans facteur, session AAL1 : reste admin');

-- ── Admin avec un facteur vérifié : l'AAL2 devient obligatoire ──────────────────────────────────
select test_login('a2fa0000-0000-4000-8000-000000000022', 'aal1');
select is(is_admin(), false, 'admin avec facteur vérifié, session AAL1 : refusé');

select test_login('a2fa0000-0000-4000-8000-000000000022');
select is(is_admin(), false, 'admin avec facteur vérifié, claim aal absent : refusé (échec fermé)');

select test_login('a2fa0000-0000-4000-8000-000000000022', 'aal2');
select is(is_admin(), true, 'admin avec facteur vérifié, session AAL2 : admin');

-- ── Le garde applicatif doit pouvoir reconnaître l'admin AAL1 pour l'envoyer sur /mfa/verify ───
select test_login('a2fa0000-0000-4000-8000-000000000022', 'aal1');
select is(has_admin_capability(), true,
  'has_admin_capability reste vrai en AAL1 (le garde envoie sur /mfa/verify, pas en boucle sur /)');

-- ── Enrôlement abandonné : un facteur `unverified` ne bloque rien ───────────────────────────────
select test_login('a2fa0000-0000-4000-8000-000000000023', 'aal1');
select is(is_admin(), true, 'admin avec un facteur seulement unverified, AAL1 : reste admin');

-- ── Tous les types de facteur comptent ──────────────────────────────────────────────────────────
select test_login('a2fa0000-0000-4000-8000-000000000025', 'aal1');
select is(is_admin(), false, 'clé de sécurité (webauthn) vérifiée, session AAL1 : refusé');

-- ── Un facteur ne donne jamais la capacité admin ────────────────────────────────────────────────
select test_login('a2fa0000-0000-4000-8000-000000000024', 'aal2');
select is(is_admin(), false, 'non-admin avec facteur vérifié, AAL2 : toujours pas admin');

select * from finish();
rollback;
