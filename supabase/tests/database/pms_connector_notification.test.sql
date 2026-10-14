-- Prestataire prévenu quand la réservation en ligne de ses logements est coupée ou rétablie
-- (set_establishment_pms_connector, 20261014030722).
--
-- À la TRANSITION seulement (actif → inactif : partner_pms_connector_deactivated ; inactif → actif :
-- partner_pms_connector_reactivated), un e-mail par compte du partenaire propriétaire, jamais vers
-- une adresse sentinelle `@hifago.local`, nom échappé, aucun jeton. Un appel qui ne change rien, ou
-- un remplacement de jeton sur un connecteur déjà actif, reste muet. Une coupure qui suit une
-- reprise est bien envoyée : sans related_id, la déduplication de la file ne l'avale pas.
-- Comptes scopés aux comptes de ce fichier.
begin;
select plan(9);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('a8000000-0000-4000-8000-000000000001', 'Conector Aviso Partner');
insert into establishments (id, partner_id, name, status, lobby_connector_active, lobby_api_token) values
  ('a8000000-0000-4000-8000-000000000011', 'a8000000-0000-4000-8000-000000000001',
   jsonb_build_object('es', '<b>Casa</b> Aviso'), 'active', true, 'conector-aviso-token-1');
insert into auth.users (id, email) values
  ('a8000000-0000-4000-8000-000000000021', 'conector-aviso-a1@test.local'),
  ('a8000000-0000-4000-8000-000000000022', 'conector-aviso-legacy@hifago.local'),
  ('a8000000-0000-4000-8000-000000000023', 'conector-aviso-admin@test.local');
update partner_accounts set partner_id = 'a8000000-0000-4000-8000-000000000001'
 where id in ('a8000000-0000-4000-8000-000000000021', 'a8000000-0000-4000-8000-000000000022');
insert into partner_capabilities (account_id, role, source, status) values
  ('a8000000-0000-4000-8000-000000000023', 'admin', 'migration', 'active');

-- Nombre d'e-mails d'un type pour les comptes de ce fichier, compte réel et sentinelle.
create function avis(p_event text) returns jsonb language sql as $$
  select jsonb_build_object(
    'compte', (select count(*) from public.notification_emails
                where event_type = p_event and recipient_account_id = 'a8000000-0000-4000-8000-000000000021'),
    'sentinelle', (select count(*) from public.notification_emails
                    where event_type = p_event and recipient_account_id = 'a8000000-0000-4000-8000-000000000022'));
$$;

set local role authenticated;
select test_login('a8000000-0000-4000-8000-000000000023');

-- Coupure (actif → inactif) ---------------------------------------------------------------------
select lives_ok(
  $$ select set_establishment_pms_connector('a8000000-0000-4000-8000-000000000011'::uuid, null, false, 'coupure test') $$,
  'l''admin coupe le connecteur'
);
reset role;
select is(avis('partner_pms_connector_deactivated'), '{"compte": 1, "sentinelle": 0}'::jsonb,
  'coupure : un e-mail au compte du partenaire, aucun vers l''adresse sentinelle');
select ok(
  (select strpos(body_html, '&lt;b&gt;Casa&lt;/b&gt;') > 0
          and strpos(body_html, '<b>Casa') = 0
          and strpos(body_html, 'conector-aviso-token') = 0
          and strpos(body_html, 'búsqueda por fechas') > 0
     from notification_emails
    where event_type = 'partner_pms_connector_deactivated'
      and recipient_account_id = 'a8000000-0000-4000-8000-000000000021'),
  'coupure : nom échappé, aucun jeton, la recherche par dates est nommée'
);

-- Appel sans changement : muet ------------------------------------------------------------------
set local role authenticated;
select test_login('a8000000-0000-4000-8000-000000000023');
select set_establishment_pms_connector('a8000000-0000-4000-8000-000000000011'::uuid, null, false, 'rien ne change');
reset role;
select is(avis('partner_pms_connector_deactivated'), '{"compte": 1, "sentinelle": 0}'::jsonb,
  'un appel qui ne change pas l''état n''envoie rien');

-- Reprise (inactif → actif) ---------------------------------------------------------------------
set local role authenticated;
select test_login('a8000000-0000-4000-8000-000000000023');
select set_establishment_pms_connector('a8000000-0000-4000-8000-000000000011'::uuid, null, true, 'reprise test');
reset role;
select is(avis('partner_pms_connector_reactivated'), '{"compte": 1, "sentinelle": 0}'::jsonb,
  'reprise : un e-mail au compte du partenaire, aucun vers l''adresse sentinelle');
select ok(
  (select strpos(body_html, 'vuelven a reservarse en línea') > 0
          and strpos(body_html, 'búsqueda por fechas') > 0
     from notification_emails
    where event_type = 'partner_pms_connector_reactivated'
      and recipient_account_id = 'a8000000-0000-4000-8000-000000000021'),
  'reprise : le texte annonce le retour à la réservation en ligne et à la recherche par dates'
);

-- Seconde coupure : envoyée, jamais avalée par la déduplication ---------------------------------
set local role authenticated;
select test_login('a8000000-0000-4000-8000-000000000023');
select set_establishment_pms_connector('a8000000-0000-4000-8000-000000000011'::uuid, null, false, 'seconde coupure');
select set_establishment_pms_connector('a8000000-0000-4000-8000-000000000011'::uuid, null, true, 'seconde reprise');
reset role;
select is(
  jsonb_build_array(avis('partner_pms_connector_deactivated'), avis('partner_pms_connector_reactivated')),
  '[{"compte": 2, "sentinelle": 0}, {"compte": 2, "sentinelle": 0}]'::jsonb,
  'une seconde coupure et une seconde reprise sont envoyées (pas de déduplication par établissement)'
);

-- Remplacement de jeton sur un connecteur actif : muet ------------------------------------------
set local role authenticated;
select test_login('a8000000-0000-4000-8000-000000000023');
select lives_ok(
  $$ select set_establishment_pms_connector('a8000000-0000-4000-8000-000000000011'::uuid,
       'conector-aviso-token-2', true, 'jeton remplacé') $$,
  'remplacement du jeton, connecteur déjà actif'
);
reset role;
select is(
  jsonb_build_array(avis('partner_pms_connector_deactivated'), avis('partner_pms_connector_reactivated')),
  '[{"compte": 2, "sentinelle": 0}, {"compte": 2, "sentinelle": 0}]'::jsonb,
  'un remplacement de jeton sans changement d''état n''écrit rien au prestataire'
);

select * from finish();
rollback;
