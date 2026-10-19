-- Refonte parcours partenaire ↔ LobbyPMS (2026-08-25) — un socio peut désormais inclure son token
-- Lobby directement dans une proposition d'établissement (création ou édition), que l'admin teste
-- et active à l'approbation. Ce fichier couvre UNIQUEMENT le nouveau comportement : whitelist du
-- token à la soumission, application du connecteur à l'approbation (active/inactive selon
-- p_activate_pms_connector), et rédaction du token du payload stocké après décision (approve,
-- reject, withdraw) — jamais les garde-fous déjà couverts ailleurs (identité/nom requis/plafond,
-- cf. establishment_creation_proposal_photos.test.sql).
begin;
select plan(13);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('88972000-0000-4000-8000-000000000001', 'Lobby Token Proposal Test Partner');
insert into auth.users (id, email) values
  ('88972000-0000-4000-8000-000000000021', 'lobby-token-partner@test.local'),
  ('88972000-0000-4000-8000-000000000022', 'lobby-token-admin@test.local');
update partner_accounts set partner_id = '88972000-0000-4000-8000-000000000001'
 where id = '88972000-0000-4000-8000-000000000021';
insert into partner_capabilities (partner_id, role, source, status) values
  ('88972000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active');
insert into partner_capabilities (account_id, role, source, status) values
  ('88972000-0000-4000-8000-000000000022', 'admin', 'migration', 'active');

set local role authenticated;
select test_login('88972000-0000-4000-8000-000000000021');

-- Cas 1 : token présent et non vide → whitelisté tel quel -----------------------------------------
create temp table tmp_create_with_token as
  select submit_establishment_creation_proposal(jsonb_build_object(
    'name', jsonb_build_object('es', 'Hostal Con Lobby'), 'contact_phone', '+573001234567',
    'lobby_api_token', '  real-token-abc  '
  )) as result;

select is(
  (select payload ->> 'lobby_api_token' from establishment_proposals
    where id = (select (result->>'proposal_id')::uuid from tmp_create_with_token)),
  'real-token-abc',
  'cas 1 : token whitelisté et débarrassé de ses espaces (btrim)'
);

-- Cas 2 : token absent ou vide → jamais dans le payload stocké -------------------------------------
create temp table tmp_create_empty_token as
  select submit_establishment_creation_proposal(jsonb_build_object(
    'name', jsonb_build_object('es', 'Hostal Sans Lobby'), 'contact_phone', '+573001234567', 'lobby_api_token', '   '
  )) as result;

select is(
  (select result->>'ok' from tmp_create_empty_token),
  'true',
  'cas 2 : soumission avec token vide (espaces seulement) réussit quand même'
);
select is(
  (select payload ? 'lobby_api_token' from establishment_proposals
    where id = (select (result->>'proposal_id')::uuid from tmp_create_empty_token)),
  false,
  'cas 2 : token vide (espaces seulement) jamais persisté dans le payload'
);

-- Cas 3 : approbation SANS activation (p_activate_pms_connector omis/false) — le token est posé
-- mais le connecteur reste inactif -----------------------------------------------------------------
reset role;
select test_login('88972000-0000-4000-8000-000000000022');
set local role authenticated;

create temp table tmp_moderate_inactive as
  select moderate_establishment_proposal(
    (select (result->>'proposal_id')::uuid from tmp_create_with_token),
    'approve', 1, null, null, false
  ) as result;

select is(
  (select (result->>'ok')::boolean from tmp_moderate_inactive), true,
  'cas 3 : approbation réussie (connecteur non activé)'
);

create temp table tmp_new_establishment as
  select establishment_id as id from establishment_proposals
   where id = (select (result->>'proposal_id')::uuid from tmp_create_with_token);

select is(
  (select lobby_has_token from establishments where id = (select id from tmp_new_establishment)),
  true,
  'cas 3 : le token a bien été posé sur establishments (lobby_has_token=true)'
);
select is(
  (select lobby_connector_active from establishments where id = (select id from tmp_new_establishment)),
  false,
  'cas 3 : p_activate_pms_connector=false → connecteur posé mais INACTIF'
);
select is(
  (select payload ? 'lobby_api_token' from establishment_proposals
    where id = (select (result->>'proposal_id')::uuid from tmp_create_with_token)),
  false,
  'cas 3 : le token n''est plus JAMAIS en clair dans le payload stocké après approbation'
);
select is(
  (select payload ->> 'lobby_api_token_provided' from establishment_proposals
    where id = (select (result->>'proposal_id')::uuid from tmp_create_with_token)),
  'true',
  'cas 3 : la trace lobby_api_token_provided=true survit, elle, à la rédaction'
);

-- Cas 4 : approbation AVEC activation (p_activate_pms_connector=true) — sur une 2e proposition,
-- même partenaire ------------------------------------------------------------------------------
reset role;
select test_login('88972000-0000-4000-8000-000000000021');
set local role authenticated;

create temp table tmp_create_with_token_2 as
  select submit_establishment_creation_proposal(jsonb_build_object(
    'name', jsonb_build_object('es', 'Hostal Con Lobby Actif'), 'contact_phone', '+573001234567',
    'lobby_api_token', 'real-token-xyz'
  )) as result;

reset role;
select test_login('88972000-0000-4000-8000-000000000022');
set local role authenticated;

create temp table tmp_moderate_active as
  select moderate_establishment_proposal(
    (select (result->>'proposal_id')::uuid from tmp_create_with_token_2),
    'approve', 1, null, null, true
  ) as result;

create temp table tmp_new_establishment_2 as
  select establishment_id as id from establishment_proposals
   where id = (select (result->>'proposal_id')::uuid from tmp_create_with_token_2);

select is(
  (select lobby_connector_active from establishments where id = (select id from tmp_new_establishment_2)),
  true,
  'cas 4 : p_activate_pms_connector=true → connecteur bien ACTIF à l''approbation'
);

-- Cas 5 : approbation SANS token du tout — set_establishment_pms_connector n'est jamais appelée
-- (une création qui ne parle pas de Lobby n'y touche pas) ------------------------------------------
reset role;
select test_login('88972000-0000-4000-8000-000000000021');
set local role authenticated;

create temp table tmp_create_no_token as
  select submit_establishment_creation_proposal(jsonb_build_object(
    'name', jsonb_build_object('es', 'Hostal Sans Lobby Du Tout'), 'contact_phone', '+573001234567'
  )) as result;

reset role;
select test_login('88972000-0000-4000-8000-000000000022');
set local role authenticated;

create temp table tmp_moderate_no_token as
  select moderate_establishment_proposal(
    (select (result->>'proposal_id')::uuid from tmp_create_no_token),
    'approve', 1, null, null, true
  ) as result;

create temp table tmp_new_establishment_3 as
  select establishment_id as id from establishment_proposals
   where id = (select (result->>'proposal_id')::uuid from tmp_create_no_token);

select is(
  (select lobby_has_token from establishments where id = (select id from tmp_new_establishment_3)),
  false,
  'cas 5 : aucun token proposé → lobby_has_token reste false, jamais touché'
);

-- Cas 6 : rejet — le token est rédigé du payload même sur un rejet (pas seulement une approbation) -
reset role;
select test_login('88972000-0000-4000-8000-000000000021');
set local role authenticated;

create temp table tmp_create_to_reject as
  select submit_establishment_creation_proposal(jsonb_build_object(
    'name', jsonb_build_object('es', 'Hostal A Rejeter'), 'contact_phone', '+573001234567',
    'lobby_api_token', 'real-token-reject'
  )) as result;

reset role;
select test_login('88972000-0000-4000-8000-000000000022');
set local role authenticated;

select moderate_establishment_proposal(
  (select (result->>'proposal_id')::uuid from tmp_create_to_reject),
  'reject', 1, null, 'no cumple criterios', false
);

select is(
  (select payload ? 'lobby_api_token' from establishment_proposals
    where id = (select (result->>'proposal_id')::uuid from tmp_create_to_reject)),
  false,
  'cas 6 : token rédigé du payload après un REJET aussi (pas seulement une approbation)'
);

-- Cas 7 : retrait (withdraw) par le socio — même rédaction ------------------------------------------
reset role;
select test_login('88972000-0000-4000-8000-000000000021');
set local role authenticated;

create temp table tmp_create_to_withdraw as
  select submit_establishment_creation_proposal(jsonb_build_object(
    'name', jsonb_build_object('es', 'Hostal A Retirer'), 'contact_phone', '+573001234567',
    'lobby_api_token', 'real-token-withdraw'
  )) as result;

select withdraw_establishment_proposal((select (result->>'proposal_id')::uuid from tmp_create_to_withdraw));

select is(
  (select payload ? 'lobby_api_token' from establishment_proposals
    where id = (select (result->>'proposal_id')::uuid from tmp_create_to_withdraw)),
  false,
  'cas 7 : token rédigé du payload après un RETRAIT par le socio lui-même'
);
select is(
  (select status from establishment_proposals
    where id = (select (result->>'proposal_id')::uuid from tmp_create_to_withdraw)),
  'withdrawn',
  'cas 7 : le retrait lui-même fonctionne toujours normalement (pas cassé par la rédaction)'
);

select * from finish();
