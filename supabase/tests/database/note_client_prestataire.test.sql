-- La note du client côté prestataire (20261112170000) : partner_reservation_detail rend `client_note`,
-- partner_reservations_list rend `has_client_note`. Les deux suivent la règle des coordonnées
-- (`line_never_paid`, 20261024120000) : rien pour une ligne d'une commande jamais payée.
begin;
select plan(7);

create function t_id(p text) returns uuid language sql as $$
  select ('c1e70000-0000-4000-8000-' || lpad(p, 12, '0'))::uuid;
$$;
create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values (t_id('1'), 'Nota Own'), (t_id('2'), 'Nota Other');
insert into establishments (id, partner_id, name) values
  (t_id('11'), t_id('1'), jsonb_build_object('es', 'Nota Own')),
  (t_id('12'), t_id('2'), jsonb_build_object('es', 'Nota Other'));
insert into auth.users (id, email) values
  (t_id('21'), 'nota-own@test.local'), (t_id('22'), 'nota-other@test.local'), (t_id('23'), 'nota-buyer@test.local');
update partner_accounts set partner_id = t_id('1') where id = t_id('21');
update partner_accounts set partner_id = t_id('2') where id = t_id('22');
insert into partner_capabilities (partner_id, role, source, status) values
  (t_id('1'), 'referrer', 'migration', 'active'), (t_id('2'), 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, establishment_id, source, status) values
  (t_id('1'), 'operator', t_id('11'), 'migration', 'active'),
  (t_id('2'), 'operator', t_id('12'), 'migration', 'active');
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  (t_id('31'), t_id('1'), t_id('11'), 'activity', jsonb_build_object('es', 'Actividad Nota'), 50000, true, 'nota-own');

create function t_order(p text, p_payment text, p_note text) returns void language sql as $$
  insert into orders (id, account_id, holder_name, holder_email, payment_status, client_note)
  values (t_id(p), t_id('23'), 'Nota Holder', 'nota-' || p || '@test.local', p_payment, p_note);
$$;
create function t_line(p text, p_order text, p_status text) returns void language sql as $$
  insert into order_lines (
    id, order_id, account_id, product_id, date, qty, status, holder_name, holder_phone, holder_email,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop
  ) values (
    t_id(p), t_id(p_order), t_id('23'), t_id('31'), '2029-09-10', 1, p_status, 'Nota Holder',
    '+573000000002', 'cliente-' || p || '@test.local',
    50000, 50000, 'direct', 0, 0, 0, 17000, 0, 0
  );
$$;

-- 201 payée, avec note (multiligne) · 202 payée, sans note · 203 jamais payée, ligne expirée, avec note
-- (visible dans l'historique, mais sans coordonnées ni note).
select t_order('101', 'paid', E'Llegamos a las 15h.\nUn niño de 4 años.'); select t_line('201', '101', 'reserved');
select t_order('102', 'paid', null);                                       select t_line('202', '102', 'reserved');
select t_order('103', 'unpaid', 'Llámame al 300 000 0000');                select t_line('203', '103', 'expired');

set local role authenticated;
select test_login(t_id('21'));

select is(
  (select client_note from partner_reservation_detail(t_id('201'))),
  E'Llegamos a las 15h.\nUn niño de 4 años.',
  'N1 : la fiche du prestataire rend la note du client, retours à la ligne compris');
select is(
  (select client_note from partner_reservation_detail(t_id('202'))),
  null,
  'N2 : sans note, la fiche rend null');
select is(
  (select jsonb_build_object('note', client_note, 'phone', holder_phone)
     from partner_reservation_detail(t_id('203'))),
  jsonb_build_object('note', null, 'phone', null),
  'N3 : ligne jamais payée — ni note ni coordonnées, même règle');
select is(
  (select jsonb_object_agg(right(id::text, 3), has_client_note)
     from partner_reservations_list(p_date_from => '2029-09-10', p_date_to => '2029-09-10',
                                    p_status => null, p_limit => 20, p_offset => 0)),
  jsonb_build_object('201', true, '202', false, '203', false),
  'N4 : la liste marque la ligne avec note, jamais la ligne sans note ni la ligne jamais payée');

-- Un prestataire d'un autre établissement ne lit ni la fiche ni la note.
select test_login(t_id('22'));
select is(
  (select count(*)::int from partner_reservation_detail(t_id('201'))),
  0,
  'N5 : autre établissement — aucune ligne, donc aucune note');
select is(
  (select count(*)::int from partner_reservations_list(p_date_from => '2029-09-10', p_date_to => '2029-09-10',
                                                       p_limit => 20, p_offset => 0)),
  0,
  'N6 : autre établissement — la liste ne rend aucune de ces lignes');

reset role;
select is(
  array[
    has_function_privilege('anon', 'public.partner_reservation_detail(uuid)', 'EXECUTE'),
    has_function_privilege('anon', 'public.partner_reservations_list(date, date, uuid, text, text, text, boolean, int, int)', 'EXECUTE')
  ],
  array[false, false],
  'N7 : anon n''exécute aucune des deux RPC (grants reposés après le drop)');

select * from finish();
rollback;
