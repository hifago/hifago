-- Correctif — journal d'audit admin (audit_log) : écriture RPC-only et immuable (même pour
-- l'admin, grants révoqués donc indépendant de la RLS), lecture réservée à l'admin,
-- log_admin_action auto-gardée par son propre contrôle is_admin().
begin;
select plan(12);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('77777777-7777-7777-7777-777777777777', 'Audit Test Partner');

insert into auth.users (id, email) values
  ('22220000-0000-4000-8000-000000000001', 'audit-admin@test.local'),
  ('22220000-0000-4000-8000-000000000002', 'audit-user@test.local');

insert into partner_capabilities (account_id, role, source, status)
  values ('22220000-0000-4000-8000-000000000001', 'admin', 'migration', 'active');

-- Une entrée pré-existante, insérée en tant que postgres (bypass RLS) pour prouver l'immutabilité
-- une fois la ligne écrite.
insert into audit_log (actor_id, action, entity_table, entity_id, before, after, note) values
  ('22220000-0000-4000-8000-000000000001', 'product.publish', 'products',
   '33330000-0000-4000-8000-000000000001', jsonb_build_object('sellable', false),
   jsonb_build_object('sellable', true), 'seed');

-- écriture directe refusée (grants révoqués), même pour l'admin -------------------------------
set local role authenticated;
select test_login('22220000-0000-4000-8000-000000000002');
select throws_ok(
  $$ insert into audit_log (actor_id, action, entity_table, entity_id)
     values ('22220000-0000-4000-8000-000000000002', 'test.forge', 'products', '33330000-0000-4000-8000-000000000001') $$,
  '42501'::char(5), null, 'un compte non-admin ne peut pas écrire dans audit_log en direct'
);

select test_login('22220000-0000-4000-8000-000000000001');
select throws_ok(
  $$ insert into audit_log (actor_id, action, entity_table, entity_id)
     values ('22220000-0000-4000-8000-000000000001', 'test.forge', 'products', '33330000-0000-4000-8000-000000000001') $$,
  '42501'::char(5), null, 'l''admin ne peut pas non plus écrire dans audit_log en direct (RPC-only, pas une question de RLS)'
);
select throws_ok(
  $$ update audit_log set note = 'maquillé' where entity_id = '33330000-0000-4000-8000-000000000001' $$,
  '42501'::char(5), null, 'l''admin ne peut pas modifier une entrée existante (journal immuable)'
);
select throws_ok(
  $$ delete from audit_log where entity_id = '33330000-0000-4000-8000-000000000001' $$,
  '42501'::char(5), null, 'l''admin ne peut pas supprimer une entrée existante (journal immuable)'
);

-- lecture : admin voit tout, non-admin ne voit rien --------------------------------------------
-- Comptes SCOPÉS aux entités de ce fichier (33330000-…), jamais en absolu : sur une base seedée ou
-- déjà utilisée, audit_log contient d'autres lignes et un `count(*)` global rougirait sans défaut.
-- Seul « non-admin ne voit rien » reste global : zéro ligne visible, quelle que soit la base.
select is(
  (select count(*) from audit_log where entity_id = '33330000-0000-4000-8000-000000000001')::int, 1,
  'admin voit les entrées existantes du journal'
);

select test_login('22220000-0000-4000-8000-000000000002');
select is(
  (select count(*) from audit_log)::int, 0,
  'non-admin ne voit aucune entrée du journal'
);

-- log_admin_action : appel non-admin refusé, aucune ligne insérée -------------------------------
select throws_ok(
  $$ select log_admin_action('test.action', 'products', '33330000-0000-4000-8000-000000000001') $$,
  '42501'::char(5),
  'log_admin_action réservé au rôle admin',
  'log_admin_action refuse un appelant non-admin'
);

select test_login('22220000-0000-4000-8000-000000000001');
select is(
  (select count(*) from audit_log where entity_id = '33330000-0000-4000-8000-000000000001')::int, 1,
  'aucune ligne ajoutée après un appel log_admin_action refusé'
);

-- log_admin_action : appel admin réussi, champs corrects -----------------------------------------
select lives_ok(
  $$ select log_admin_action('product.publish', 'products', '33330000-0000-4000-8000-000000000002',
       jsonb_build_object('sellable', false), jsonb_build_object('sellable', true), 'mise en ligne test') $$,
  'log_admin_action réussit pour un appelant admin'
);

select is(
  (select count(*) from audit_log where entity_id = '33330000-0000-4000-8000-000000000002')::int, 1,
  'une ligne a bien été ajoutée par l''appel admin'
);
select is(
  (select actor_id from audit_log where entity_id = '33330000-0000-4000-8000-000000000002'),
  '22220000-0000-4000-8000-000000000001'::uuid,
  'actor_id enregistré est bien l''appelant authentifié, pas une valeur fournie par le client'
);
select is(
  (select jsonb_build_object('action', action, 'before', before, 'after', after, 'note', note)
     from audit_log where entity_id = '33330000-0000-4000-8000-000000000002'),
  jsonb_build_object(
    'action', 'product.publish',
    'before', jsonb_build_object('sellable', false),
    'after', jsonb_build_object('sellable', true),
    'note', 'mise en ligne test'
  ),
  'log_admin_action enregistre action/before/after/note tels que fournis par l''appelant'
);

select * from finish();
rollback;
