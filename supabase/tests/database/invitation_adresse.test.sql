-- Invitation liée à son adresse (20261014031203, option B du 2026-10-14).
--
-- Une invitation envoyée à une adresse ne se consomme que par un compte de cette adresse (casse et
-- espaces ignorés) ; sinon `email_mismatch`, AVANT toute écriture, invitation laissée `pending`. Un
-- lien partagé (sans adresse) se consomme comme avant. check_partner_invitation rend l'adresse
-- invitée (ou null) au détenteur du jeton.
begin;
select plan(8);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partner_codes (code) values ('INVADR-1'), ('INVADR-2'), ('INVADR-3');
insert into partner_invitations (id, token_hash, promo_code, onboarding_path, expires_at, email) values
  -- adresse en casse mixte et entourée d'espaces : la comparaison les ignore
  ('a9000000-0000-4000-8000-000000000031', encode(extensions.digest('invadr-jeton-1', 'sha256'), 'hex'),
   'INVADR-1', 'referrer', now() + interval '7 days', '  Invite.Adresse@Test.local '),
  ('a9000000-0000-4000-8000-000000000032', encode(extensions.digest('invadr-jeton-2', 'sha256'), 'hex'),
   'INVADR-2', 'referrer', now() + interval '7 days', 'invite-adresse-2@test.local'),
  -- lien partagé : aucune adresse
  ('a9000000-0000-4000-8000-000000000033', encode(extensions.digest('invadr-jeton-3', 'sha256'), 'hex'),
   'INVADR-3', 'referrer', now() + interval '7 days', null);

insert into auth.users (id, email) values
  ('a9000000-0000-4000-8000-000000000021', 'invite.adresse@test.local'),
  ('a9000000-0000-4000-8000-000000000022', 'otra-persona@test.local'),
  ('a9000000-0000-4000-8000-000000000023', 'enlace-compartido@test.local');

-- check_partner_invitation : l'adresse invitée, au détenteur du jeton ---------------------------
set local role anon;
select set_config('request.jwt.claims', '', true);
select is(
  check_partner_invitation('invadr-jeton-1') ->> 'invited_email',
  'Invite.Adresse@Test.local',
  'check_partner_invitation rend l''adresse invitée (sans les espaces autour)'
);
select is(
  check_partner_invitation('invadr-jeton-3') -> 'invited_email',
  'null'::jsonb,
  'check_partner_invitation : lien partagé → invited_email null'
);
reset role;

-- Un autre compte : email_mismatch, rien d'écrit -------------------------------------------------
set local role authenticated;
select test_login('a9000000-0000-4000-8000-000000000022');
select is(
  consume_partner_invitation('invadr-jeton-2', 'Otra Persona', 'v1') ->> 'reason',
  'email_mismatch',
  'un compte d''une autre adresse ne consomme pas l''invitation (email_mismatch)'
);
reset role;
select is(
  jsonb_build_object(
    'statut', (select status from partner_invitations where id = 'a9000000-0000-4000-8000-000000000032'),
    'partenaire_du_compte', (select partner_id from partner_accounts where id = 'a9000000-0000-4000-8000-000000000022'),
    'code_attribue', (select partner_id from partner_codes where code = 'INVADR-2'),
    'accords', (select count(*) from role_agreements where account_id = 'a9000000-0000-4000-8000-000000000022')),
  jsonb_build_object('statut', 'pending', 'partenaire_du_compte', null, 'code_attribue', null, 'accords', 0),
  'email_mismatch : invitation toujours pending, aucun partenaire, code ni accord'
);

-- Le bon compte, casse et espaces différents : consommée ---------------------------------------
set local role authenticated;
select test_login('a9000000-0000-4000-8000-000000000021');
select is(
  consume_partner_invitation('invadr-jeton-1', 'Invite Adresse', 'v1') ->> 'ok',
  'true',
  'le compte de l''adresse invitée consomme l''invitation (casse et espaces ignorés)'
);
reset role;
select is(
  (select status from partner_invitations where id = 'a9000000-0000-4000-8000-000000000031'),
  'consumed',
  'invitation consommée par le bon compte'
);

-- Lien partagé (sans adresse) : inchangé, n'importe quel compte ---------------------------------
set local role authenticated;
select test_login('a9000000-0000-4000-8000-000000000023');
select is(
  consume_partner_invitation('invadr-jeton-3', 'Enlace Compartido', 'v1') ->> 'ok',
  'true',
  'une invitation sans adresse se consomme par n''importe quel compte, comme avant'
);
reset role;

-- La règle ne devance que les écritures, jamais les refus existants (invitation déjà consommée) --
set local role authenticated;
select test_login('a9000000-0000-4000-8000-000000000022');
select is(
  consume_partner_invitation('invadr-jeton-1', 'Otra Persona', 'v1') ->> 'reason',
  'already_consumed',
  'une invitation déjà consommée reste « already_consumed », même pour une autre adresse'
);
reset role;

select * from finish();
rollback;
