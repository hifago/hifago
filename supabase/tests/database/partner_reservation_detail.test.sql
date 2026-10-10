-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, 2026-09-11) — site 7/10, le
-- plus sensible du lot : apps/admin/app/partner/(app)/reservations/[id]/page.tsx n'a AUCUN filtre
-- applicatif, la garde de partner_reservation_detail (20260922200000, has_capability scope
-- établissement) EST le seul rempart. Ce test existe pour ça : prouver qu'un socio d'un AUTRE
-- établissement ne peut PAS lire une réservation en devinant son UUID, symétriquement à la preuve
-- que le bon operator, lui, la voit — jamais l'un sans l'autre.
begin;
select plan(6);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('88970000-0000-4000-8000-000000000001', 'Reservation Detail Own'),
  ('88970000-0000-4000-8000-000000000002', 'Reservation Detail Other');
insert into establishments (id, partner_id, name) values
  ('88970000-0000-4000-8000-000000000011', '88970000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Reservation Detail Own')),
  ('88970000-0000-4000-8000-000000000012', '88970000-0000-4000-8000-000000000002',
   jsonb_build_object('es', 'Establecimiento Reservation Detail Other'));

insert into auth.users (id, email) values
  ('88970000-0000-4000-8000-000000000021', 'reservation-detail-own@test.local'),
  ('88970000-0000-4000-8000-000000000022', 'reservation-detail-other@test.local'),
  ('88970000-0000-4000-8000-000000000023', 'reservation-detail-buyer@test.local');
update partner_accounts set partner_id = '88970000-0000-4000-8000-000000000001'
 where id = '88970000-0000-4000-8000-000000000021';
update partner_accounts set partner_id = '88970000-0000-4000-8000-000000000002'
 where id = '88970000-0000-4000-8000-000000000022';
-- operator ⇒ referrer (trigger enforce_operator_implies_referrer).
insert into partner_capabilities (partner_id, role, source, status) values
  ('88970000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active'),
  ('88970000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, establishment_id, source, status) values
  ('88970000-0000-4000-8000-000000000001', 'operator', '88970000-0000-4000-8000-000000000011',
   'migration', 'active'),
  ('88970000-0000-4000-8000-000000000002', 'operator', '88970000-0000-4000-8000-000000000012',
   'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88970000-0000-4000-8000-000000000031', '88970000-0000-4000-8000-000000000001',
   '88970000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Reservation Detail'), 50000, true, 'reservation-detail-test');

insert into orders (id, account_id, holder_name, holder_email) values
  ('88970000-0000-4000-8000-000000000041', '88970000-0000-4000-8000-000000000023',
   'Reservation Detail Holder', 'rd-holder@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name, holder_phone,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88970000-0000-4000-8000-000000000051', '88970000-0000-4000-8000-000000000041',
  '88970000-0000-4000-8000-000000000023', '88970000-0000-4000-8000-000000000031',
  '2029-07-01', 1, 'reserved', 'Reservation Detail Holder', '+57 300 000 1111',
  50000, 50000, 'external_referrer', 0.17, 0.10, 0.07, 8500, 5000, 3500
);

set local role authenticated;

-- Le rempart : operator d'un AUTRE établissement → AUCUNE ligne (jamais une exception qui
-- distinguerait "existe mais interdit" de "n'existe pas" — même non-divulgation que le reste du
-- projet, cf. cancel_order_line.test.sql cas 3-4).
select test_login('88970000-0000-4000-8000-000000000022'); -- operator_other, établissement 012
select is(
  (select count(*)::int from partner_reservation_detail('88970000-0000-4000-8000-000000000051')),
  0,
  'operator d''un AUTRE établissement ne voit RIEN — le seul rempart de cette fiche'
);

-- Le cas symétrique : le bon operator voit la ligne, avec les bonnes colonnes (jamais de
-- commission).
select test_login('88970000-0000-4000-8000-000000000021'); -- operator_own, établissement 011
select is(
  (select count(*)::int from partner_reservation_detail('88970000-0000-4000-8000-000000000051')),
  1,
  'operator de l''établissement propriétaire voit la ligne'
);
select is(
  (select jsonb_build_object('holder_name', holder_name, 'holder_phone', holder_phone, 'total_cop', total_cop)
     from partner_reservation_detail('88970000-0000-4000-8000-000000000051')),
  jsonb_build_object('holder_name', 'Reservation Detail Holder', 'holder_phone', '+57 300 000 1111', 'total_cop', 50000),
  'operator propriétaire : colonnes attendues (PII + montant), correctes'
);

-- Colonnes rendues : liste EXACTE, lue dans `proargnames`/`proargmodes` (mode 't' = colonne de
-- `returns table`), même idiome que partner_commissions_list.test.sql. L'ancienne assertion joignait
-- `pg_attribute` via `pg_type.typrelid`, nul pour un `returns table` (type `record`) : elle ne
-- trouvait aucune colonne et passait quoi que la fonction rende. La liste exacte rougit sur une
-- colonne de commission ajoutée comme sur tout autre ajout non relu.
select is(
  (select string_agg(a.n, ', ' order by a.n)
     from pg_proc p, unnest(p.proargnames, p.proargmodes) as a(n, m)
    where p.oid = 'public.partner_reservation_detail'::regproc and a.m = 't'),
  'created_at, date, end_date, establishment_name, holder_email, holder_name, holder_phone, '
  'id, product_name, product_type, qty, slot_start_time, status, total_cop',
  'partner_reservation_detail rend exactement ses colonnes d''affichage — aucune colonne de commission'
);

-- Ligne inexistante : même comportement (aucune ligne, pas d'exception) — non-divulgation.
select is(
  (select count(*)::int from partner_reservation_detail('00000000-0000-4000-8000-000000000099')),
  0,
  'ligne inexistante → aucune ligne, symétrique au refus par établissement'
);

-- Grants : anon ne doit jamais pouvoir l'exécuter, authenticated seul.
select is(
  array[
    has_function_privilege('anon', 'public.partner_reservation_detail(uuid)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.partner_reservation_detail(uuid)', 'EXECUTE')
  ],
  array[false, true],
  'authenticated seul peut l''exécuter'
);

select * from finish();
rollback;
