-- Campagnes sans identités anonymes ; la purge à 30 jours emporte leurs cibles (20261014031546).
--
-- Aucune audience ne retient une identité anonyme (jamais joignable). La purge efface, avec
-- l'identité, ses lignes comm_campaign_targets, dans le même sous-bloc que le panier : si une autre
-- trace bloque l'identité, la cible reste intacte (patron P10). Les comptes sont scopés aux
-- identités de ce fichier.
begin;
select plan(5);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Admin et compte réel (avec une commande : il est aussi « client »).
insert into auth.users (id, email) values
  ('aa000000-0000-4000-8000-000000000001', 'audiencia-admin@test.local'),
  ('aa000000-0000-4000-8000-000000000002', 'audiencia-real@test.local');
insert into partner_capabilities (account_id, role, source, status) values
  ('aa000000-0000-4000-8000-000000000001', 'admin', 'migration', 'active');
insert into orders (id, account_id, holder_name, holder_email) values
  ('aa000000-0000-4000-8000-000000000012', 'aa000000-0000-4000-8000-000000000002',
   'Audiencia Real', 'audiencia-real@test.local');

-- Z1 : anonyme, 31 jours, rien. Z2 : anonyme AVEC une commande (invité). Z3 : anonyme, 31 jours,
-- cible d'une campagne passée. Z4 : comme Z3, mais aussi bloquée par une ligne de journal.
insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at) values
  ('aa000000-0000-4000-8000-000000000021', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', true, now() - interval '31 days', now()),
  ('aa000000-0000-4000-8000-000000000022', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', true, now() - interval '31 days', now()),
  ('aa000000-0000-4000-8000-000000000023', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', true, now() - interval '31 days', now()),
  ('aa000000-0000-4000-8000-000000000024', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', true, now() - interval '31 days', now());
insert into orders (id, account_id, holder_name, holder_email) values
  ('aa000000-0000-4000-8000-000000000032', 'aa000000-0000-4000-8000-000000000022',
   'Audiencia Invitado', 'audiencia-invitado@test.local');
insert into comm_campaigns (id, audience, channel, message_template, status, created_by) values
  ('aa000000-0000-4000-8000-000000000041', 'all', 'email', 'Hola', 'completed',
   'aa000000-0000-4000-8000-000000000001');
insert into comm_campaign_targets (campaign_id, account_id, status) values
  ('aa000000-0000-4000-8000-000000000041', 'aa000000-0000-4000-8000-000000000023', 'skipped_unreachable'),
  ('aa000000-0000-4000-8000-000000000041', 'aa000000-0000-4000-8000-000000000024', 'skipped_unreachable');
insert into audit_log (actor_id, action, entity_table) values
  ('aa000000-0000-4000-8000-000000000024', 'test.trace', 'auth.users');

-- Audiences --------------------------------------------------------------------------------------
set local role authenticated;
select test_login('aa000000-0000-4000-8000-000000000001');
select is(
  (select array[bool_or(account_id = 'aa000000-0000-4000-8000-000000000002'),
                bool_or(account_id = 'aa000000-0000-4000-8000-000000000021')]
     from list_audience_members('all')),
  array[true, false],
  'audience all : le compte réel y est, l''identité anonyme jamais'
);
select is(
  (select array[bool_or(account_id = 'aa000000-0000-4000-8000-000000000002'),
                bool_or(account_id = 'aa000000-0000-4000-8000-000000000022')]
     from list_audience_members('clients')),
  array[true, false],
  'audience clients : une identité anonyme n''y entre pas, même avec une commande'
);
reset role;

-- Purge à 30 jours -------------------------------------------------------------------------------
create temp table passage as select purge_expired_anonymous_identities() as r;
select is(
  jsonb_build_object(
    'z3_presente', exists (select 1 from auth.users where id = 'aa000000-0000-4000-8000-000000000023'),
    'z3_cibles', (select count(*) from comm_campaign_targets where account_id = 'aa000000-0000-4000-8000-000000000023')),
  jsonb_build_object('z3_presente', false, 'z3_cibles', 0),
  'la purge efface l''identité anonyme ET ses cibles de campagne (elles ne la bloquent plus)'
);
select ok(
  (select (r -> 'skipped') ? 'aa000000-0000-4000-8000-000000000024' from passage),
  'une identité bloquée par une autre trace (journal) reste sautée'
);
select is(
  (select count(*)::int from comm_campaign_targets where account_id = 'aa000000-0000-4000-8000-000000000024'),
  1,
  'atomicité : la cible d''une identité sautée reste intacte (le sous-bloc annule tout)'
);

select * from finish();
rollback;
