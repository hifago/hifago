-- product_slot_rules RPC-only en écriture (migration de suppression de l'écriture directe) : même
-- l'admin ne peut plus écrire la table en direct, la RPC replace_product_slot_rules reste le seul
-- chemin, et la lecture publique est intacte.
begin;
select plan(5);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('88a90000-0000-4000-8000-000000000001', 'Slot Rules Rpc Only Partner');
insert into establishments (id, partner_id, name) values
  ('88a90000-0000-4000-8000-000000000011', '88a90000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Rpc Only'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88a90000-0000-4000-8000-000000000021', '88a90000-0000-4000-8000-000000000001',
   '88a90000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Actividad Rpc Only'),
   30000, true, 'slot-rules-rpc-only-test');
insert into auth.users (id, email) values
  ('88a90000-0000-4000-8000-000000000031', 'slot-rules-rpc-only-admin@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('88a90000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');
insert into product_slot_rules (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity)
values ('88a90000-0000-4000-8000-000000000021', '{1}', '09:00', '10:00', 60, 4);

set local role authenticated;
select test_login('88a90000-0000-4000-8000-000000000031');
select throws_ok(
  $$ insert into product_slot_rules (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity)
     values ('88a90000-0000-4000-8000-000000000021', '{2}', '09:00', '10:00', 60, 4) $$,
  '42501', null,
  'même l''admin ne peut plus insérer une règle en direct'
);
select throws_ok(
  $$ delete from product_slot_rules where product_id = '88a90000-0000-4000-8000-000000000021' $$,
  '42501', null,
  'même l''admin ne peut plus supprimer une règle en direct'
);
select is(
  replace_product_slot_rules('88a90000-0000-4000-8000-000000000021', jsonb_build_array(jsonb_build_object(
    'weekdays', jsonb_build_array(2), 'start_time', '11:00', 'end_time', '12:00',
    'slot_duration_minutes', 60, 'capacity', 6))),
  jsonb_build_object('ok', true),
  'la RPC reste le chemin d''écriture'
);
reset role;

set local role anon;
select is(
  (select count(*)::int from product_slot_rules where product_id = '88a90000-0000-4000-8000-000000000021'),
  1,
  'la lecture publique des règles est intacte (la vitrine les lit directement)'
);
reset role;

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'product_slot_rules' and cmd <> 'SELECT'),
  0,
  'aucune policy d''écriture sur product_slot_rules'
);

select * from finish();
rollback;
