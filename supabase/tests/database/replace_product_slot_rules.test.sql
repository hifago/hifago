-- replace_product_slot_rules (20261001235031) : remplacement des règles de créneaux d'un produit en
-- une seule transaction. L'objet du test est l'atomicité : une règle refusée par une contrainte de
-- product_slot_rules annule aussi le delete, les règles d'origine restent en place — là où les deux
-- requêtes séparées du navigateur laissaient l'activité sans règle.
--
-- Les comptages se lisent sous `postgres` (après `reset role`) : la preuve porte sur l'état réel de
-- la table, pas sur ce qu'une policy laisse voir à un rôle.
begin;
select plan(11);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('88a70000-0000-4000-8000-000000000001', 'Slot Rules RPC Partner');
insert into establishments (id, partner_id, name) values
  ('88a70000-0000-4000-8000-000000000011', '88a70000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Slot Rules'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88a70000-0000-4000-8000-000000000021', '88a70000-0000-4000-8000-000000000001',
   '88a70000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Actividad Slot Rules'),
   30000, true, 'slot-rules-rpc-test');

insert into auth.users (id, email) values
  ('88a70000-0000-4000-8000-000000000031', 'slot-rules-admin@test.local'),
  ('88a70000-0000-4000-8000-000000000032', 'slot-rules-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('88a70000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

-- Deux règles d'origine.
insert into product_slot_rules (id, product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity) values
  ('88a70000-0000-4000-8000-000000000041', '88a70000-0000-4000-8000-000000000021', '{1,2}', '09:00', '11:00', 60, 5),
  ('88a70000-0000-4000-8000-000000000042', '88a70000-0000-4000-8000-000000000021', '{6}', '15:00', '17:00', 120, 3);

set local role authenticated;

select test_login('88a70000-0000-4000-8000-000000000032');
select throws_ok(
  $$ select replace_product_slot_rules('88a70000-0000-4000-8000-000000000021', '[]'::jsonb) $$,
  '42501',
  'replace_product_slot_rules réservé au rôle admin',
  'un compte non admin est refusé'
);

select test_login('88a70000-0000-4000-8000-000000000031');
select is(
  replace_product_slot_rules('88a70000-0000-4000-8000-000000000021', jsonb_build_array(jsonb_build_object(
    'weekdays', jsonb_build_array(3, 1), 'start_time', '10:00', 'end_time', '13:00',
    'slot_duration_minutes', 90, 'capacity', 8))),
  jsonb_build_object('ok', true),
  'l''admin remplace les deux règles par une seule'
);

reset role;
select is(
  (select count(*)::int from product_slot_rules
    where id in ('88a70000-0000-4000-8000-000000000041', '88a70000-0000-4000-8000-000000000042')),
  0,
  'les anciennes règles n''existent plus'
);
select is(
  (select row(weekdays, start_time, end_time, slot_duration_minutes, capacity)::text
     from product_slot_rules where product_id = '88a70000-0000-4000-8000-000000000021'),
  row('{1,3}'::smallint[], '10:00'::time, '13:00'::time, 90, 8)::text,
  'la nouvelle règle est en place, jours triés'
);
create temp table regle_avant_echec as
  select id from product_slot_rules where product_id = '88a70000-0000-4000-8000-000000000021';

-- Une règle valide puis une règle refusée (capacité 0, contrainte product_slot_rules_capacity_positive).
set local role authenticated;
select test_login('88a70000-0000-4000-8000-000000000031');
select throws_ok(
  $$ select replace_product_slot_rules('88a70000-0000-4000-8000-000000000021', jsonb_build_array(
       jsonb_build_object('weekdays', jsonb_build_array(4), 'start_time', '08:00', 'end_time', '09:00',
                          'slot_duration_minutes', 60, 'capacity', 4),
       jsonb_build_object('weekdays', jsonb_build_array(5), 'start_time', '08:00', 'end_time', '09:00',
                          'slot_duration_minutes', 60, 'capacity', 0))) $$,
  '23514',
  null,
  'une règle refusée par une contrainte fait échouer tout le remplacement'
);

reset role;
select is(
  (select array_agg(id) from product_slot_rules where product_id = '88a70000-0000-4000-8000-000000000021'),
  (select array_agg(id) from regle_avant_echec),
  'LE POINT DU LOT — après l''échec, la règle d''avant est toujours là (le delete est annulé avec l''insert refusé)'
);
select is(
  (select count(*)::int from product_slot_rules where product_id = '88a70000-0000-4000-8000-000000000021'),
  1,
  'et aucune règle de la tentative refusée n''a été écrite'
);

set local role authenticated;
select test_login('88a70000-0000-4000-8000-000000000031');
select is(
  replace_product_slot_rules('00000000-0000-4000-8000-000000000000', '[]'::jsonb) ->> 'reason',
  'product_not_found',
  'produit inconnu : refus métier, rien n''est écrit'
);
select is(
  replace_product_slot_rules('88a70000-0000-4000-8000-000000000021', '[]'::jsonb),
  jsonb_build_object('ok', true),
  'une liste vide retire toutes les règles'
);

reset role;
select is(
  (select count(*)::int from product_slot_rules where product_id = '88a70000-0000-4000-8000-000000000021'),
  0,
  'plus aucune règle après une liste vide'
);
select ok(
  not has_function_privilege('anon', 'public.replace_product_slot_rules(uuid, jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.replace_product_slot_rules(uuid, jsonb)', 'EXECUTE'),
  'exécutable par authenticated (garde admin interne), jamais par anon'
);

select * from finish();
rollback;
