-- Spec 43 — activité par personne, par heure ou par activité complète (migration 20261025140000).
--   - à l'heure : 3 h à partir de 10:00 prennent 1 place sur 10:00, 11:00 et 12:00 ; une plage qui
--     chevauche est refusée (en base comme dans le panier) ; une plage qui sort des horaires, une
--     ligne sans créneau, une activité sans horaires sont refusées ; prix × heures ;
--   - instantané order_lines.pricing_unit, libération des N créneaux, verrouillage des N créneaux ;
--   - activité complète : prix × 1, une place du jour ; par personne sur créneau : inchangé ;
--   - gel du mode tant qu'une réservation est en cours ; horaires de 60 min exigés ; un type autre
--     qu'activité reste per_person ; personnes min ≤ max ;
--   - réservation manuelle prestataire à l'heure ; agenda et commande client exposent le mode ;
--   - propositions partenaire : création, approbation, édition transportent le mode et les personnes.
-- cart_lines_availability rend la MÊME raison que create_order pour chaque ligne testée.
begin;
select plan(41);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Le panier de l'appelant remplacé par les lignes données ; rend [raison panier (première ligne
-- indisponible, sinon 'ok'), raison create_order (ou 'ok')].
create function test_cart(p_lines jsonb) returns text[]
language plpgsql as $$
declare
  v_line jsonb;
  v_result jsonb;
  v_cla text;
begin
  delete from public.cart_items where account_id = auth.uid();
  for v_line in select value from jsonb_array_elements(p_lines) loop
    insert into public.cart_items (account_id, product_id, date, slot_start_time, qty)
    values (auth.uid(), ('d6a40000-0000-4000-8000-0000000000' || (v_line ->> 'p'))::uuid,
            public.today_in_bogota() + (v_line ->> 'd')::int, (v_line ->> 's')::time, (v_line ->> 'q')::int);
  end loop;
  select coalesce(min(reason) filter (where not available), 'ok') into v_cla
    from public.cart_lines_availability();
  v_result := create_order('Cliente Hora', p_holder_email => 'hora-' || auth.uid() || '@test.local');
  return array[v_cla, case when (v_result ->> 'ok')::boolean then 'ok' else v_result ->> 'reason' end];
end;
$$;

create function test_booked(p_product text, p_day int, p_slot time) returns int
language sql as $$
  select booked from public.product_slot_availability
   where product_id = ('d6a40000-0000-4000-8000-0000000000' || p_product)::uuid
     and slot_date = public.today_in_bogota() + p_day and slot_start_time = p_slot;
$$;

insert into partners (id, display_name) values ('d6a40000-0000-4000-8000-000000000001', 'Precio Hora');
insert into establishments (id, partner_id, name) values
  ('d6a40000-0000-4000-8000-000000000011', 'd6a40000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Lancha Precio Hora'));
insert into auth.users (id, email) values
  ('d6a40000-0000-4000-8000-000000000031', 'hora-a@test.local'),
  ('d6a40000-0000-4000-8000-000000000032', 'hora-b@test.local'),
  ('d6a40000-0000-4000-8000-000000000033', 'hora-operator@test.local'),
  ('d6a40000-0000-4000-8000-000000000034', 'hora-admin@test.local'),
  ('e0000000-0000-4000-8000-000000000001', 'reserva-manual@hifago.local')
on conflict (id) do nothing;
update partner_accounts set partner_id = 'd6a40000-0000-4000-8000-000000000001'
 where id = 'd6a40000-0000-4000-8000-000000000033';
insert into partner_capabilities (partner_id, role, source, status) values
  ('d6a40000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, establishment_id, source, status) values
  ('d6a40000-0000-4000-8000-000000000001', 'operator', 'd6a40000-0000-4000-8000-000000000011', 'migration', 'active');
insert into partner_capabilities (account_id, role, source, status) values
  ('d6a40000-0000-4000-8000-000000000034', 'admin', 'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop,
                      pricing_unit, min_persons, max_persons, default_capacity) values
  -- 21 : bateau de wakeboard à l'heure, 1 à 10 personnes.
  ('d6a40000-0000-4000-8000-000000000021', 'd6a40000-0000-4000-8000-000000000001', 'd6a40000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'Wakeboard'), 'hora-wakeboard', true, 420000, 'per_hour', 1, 10, null),
  -- 22 : à l'heure, sans aucun horaire.
  ('d6a40000-0000-4000-8000-000000000022', 'd6a40000-0000-4000-8000-000000000001', 'd6a40000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'Sin horario'), 'hora-sin-horario', true, 100000, 'per_hour', null, null, 5),
  -- 23 : activité complète, deux par jour.
  ('d6a40000-0000-4000-8000-000000000023', 'd6a40000-0000-4000-8000-000000000001', 'd6a40000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'Tour privado'), 'hora-tour-privado', true, 300000, 'per_activity', 2, 8, 2),
  -- 24 : par personne, sur créneaux (le comportement d'avant).
  ('d6a40000-0000-4000-8000-000000000024', 'd6a40000-0000-4000-8000-000000000001', 'd6a40000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'Yoga'), 'hora-yoga', true, 20000, 'per_person', null, null, null),
  -- 25 : par personne, horaires de 30 min.
  ('d6a40000-0000-4000-8000-000000000025', 'd6a40000-0000-4000-8000-000000000001', 'd6a40000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'Clase corta'), 'hora-clase-corta', true, 20000, 'per_person', null, null, null);

insert into product_slot_rules (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity) values
  ('d6a40000-0000-4000-8000-000000000021', array[1, 2, 3, 4, 5, 6, 7]::smallint[], '08:00', '17:00', 60, 1),
  ('d6a40000-0000-4000-8000-000000000024', array[1, 2, 3, 4, 5, 6, 7]::smallint[], '09:00', '10:00', 60, 10),
  ('d6a40000-0000-4000-8000-000000000025', array[1, 2, 3, 4, 5, 6, 7]::smallint[], '09:00', '10:00', 30, 10);

-- ═══ A. À l'heure : réserver, chevaucher, sortir des horaires ════════════════════════════════════
set local role authenticated;
select test_login('d6a40000-0000-4000-8000-000000000031');
create temp table r (k text primary key, reasons text[]);
insert into r values ('a_10h_3h', test_cart('[{"p":"21","d":10,"s":"10:00","q":3}]'));
select test_login('d6a40000-0000-4000-8000-000000000032');
insert into r values
  ('b_12h_2h_chevauche', test_cart('[{"p":"21","d":10,"s":"12:00","q":2}]')),
  ('b_09h_2h_chevauche', test_cart('[{"p":"21","d":10,"s":"09:00","q":2}]')),
  ('b_13h_2h_libre',     test_cart('[{"p":"21","d":10,"s":"13:00","q":2}]')),
  ('b_16h_2h_hors',      test_cart('[{"p":"21","d":11,"s":"16:00","q":2}]')),
  ('b_sans_creneau',     test_cart('[{"p":"21","d":11,"q":2}]')),
  ('b_heure_absente',    test_cart('[{"p":"21","d":11,"s":"10:30","q":1}]')),
  ('b_sans_horaire',     test_cart('[{"p":"22","d":11,"q":1}]')),
  ('b_sans_horaire_h',   test_cart('[{"p":"22","d":11,"s":"10:00","q":1}]')),
  ('b_panier_chevauche', test_cart('[{"p":"21","d":12,"s":"09:00","q":2},{"p":"21","d":12,"s":"10:00","q":1}]')),
  ('b_panier_bout_a_bout', test_cart('[{"p":"21","d":13,"s":"09:00","q":2},{"p":"21","d":13,"s":"11:00","q":1}]')),
  ('c_activite_complete',  test_cart('[{"p":"23","d":10,"q":1}]')),
  ('c_par_personne_slot',  test_cart('[{"p":"24","d":10,"s":"09:00","q":3}]'));
reset role;

select is((select reasons from r where k = 'a_10h_3h'), array['ok', 'ok'], 'à l''heure : 10:00 × 3 h → acceptée');
select is(test_booked('21', 10, '10:00') || ',' || test_booked('21', 10, '11:00') || ',' || test_booked('21', 10, '12:00'),
  '1,1,1', 'à l''heure : une place prise sur CHACUN des trois créneaux 10:00, 11:00, 12:00');
select is((select reasons from r where k = 'b_12h_2h_chevauche'), array['full', 'full'],
  'à l''heure : 12:00 × 2 h chevauche 12:00 déjà pris → full (panier et commande)');
select is((select reasons from r where k = 'b_09h_2h_chevauche'), array['full', 'full'],
  'à l''heure : 09:00 × 2 h chevauche 10:00 → full');
select is((select reasons from r where k = 'b_13h_2h_libre'), array['ok', 'ok'],
  'à l''heure : 13:00 × 2 h, bout à bout avec 10:00-13:00 → acceptée');
select is((select reasons from r where k = 'b_16h_2h_hors'), array['slot_not_found', 'slot_not_found'],
  'à l''heure : 16:00 × 2 h sort des horaires (pas de créneau 17:00) → slot_not_found');
select is((select reasons from r where k = 'b_sans_creneau'), array['slot_required', 'slot_required'],
  'à l''heure : une ligne sans heure de début → slot_required');
select is((select reasons from r where k = 'b_heure_absente'), array['slot_not_found', 'slot_not_found'],
  'à l''heure : une heure de début qui n''est pas un créneau → slot_not_found');
select is((select reasons from r where k = 'b_sans_horaire'), array['slot_required', 'slot_required'],
  'à l''heure sans aucun horaire, sans créneau → slot_required (même sans règle)');
select is((select reasons from r where k = 'b_sans_horaire_h'), array['slot_not_found', 'slot_not_found'],
  'à l''heure sans aucun horaire, avec une heure → slot_not_found');
select is((select reasons from r where k = 'b_panier_chevauche'), array['full', 'full'],
  'à l''heure : deux lignes du MÊME panier qui se chevauchent (09-11 et 10-11) → full');
select is((select reasons from r where k = 'b_panier_bout_a_bout'), array['ok', 'ok'],
  'à l''heure : deux lignes du même panier bout à bout (09-11 et 11-12) → acceptées');
select is(test_booked('21', 13, '09:00') || ',' || test_booked('21', 13, '10:00') || ',' || test_booked('21', 13, '11:00'),
  '1,1,1', 'à l''heure : les deux lignes bout à bout ont pris 09:00, 10:00 et 11:00');
select ok(test_booked('21', 12, '09:00') is distinct from 1 and test_booked('21', 12, '10:00') is distinct from 1,
  'à l''heure : la commande refusée n''a rien pris (aucun compteur incrémenté)');

-- ═══ B. Prix et instantané ═══════════════════════════════════════════════════════════════════════
select is(
  (select array[ol.qty::text, ol.price_cop::text, ol.total_cop::text, ol.pricing_unit]
     from order_lines ol join orders o on o.id = ol.order_id
    where ol.product_id = 'd6a40000-0000-4000-8000-000000000021'
      and o.account_id = 'd6a40000-0000-4000-8000-000000000031'),
  array['3', '420000', '1260000', 'per_hour'],
  'à l''heure : 3 h × 420 000 = 1 260 000, instantané per_hour sur la ligne');
select is((select reasons from r where k = 'c_activite_complete'), array['ok', 'ok'], 'activité complète : acceptée');
select is(
  (select array[ol.total_cop::text, ol.pricing_unit] from order_lines ol
    where ol.product_id = 'd6a40000-0000-4000-8000-000000000023'),
  array['300000', 'per_activity'], 'activité complète : le prix de l''activité, une fois');
select is(
  (select booked from product_availability
    where product_id = 'd6a40000-0000-4000-8000-000000000023' and date = public.today_in_bogota() + 10),
  1, 'activité complète : une place du jour prise');
select is((select reasons from r where k = 'c_par_personne_slot'), array['ok', 'ok'], 'par personne sur créneau : accepté');
select is(test_booked('24', 10, '09:00'), 3, 'par personne sur créneau : 3 places sur le seul créneau, comme avant');
select is(
  (select pricing_unit from order_lines where product_id = 'd6a40000-0000-4000-8000-000000000024'),
  'per_person', 'par personne : instantané per_person');

-- ═══ C. Libération et verrouillage des N créneaux ═══════════════════════════════════════════════
create temp table tmp_line as
  select ol.id from order_lines ol join orders o on o.id = ol.order_id
   where ol.product_id = 'd6a40000-0000-4000-8000-000000000021'
     and o.account_id = 'd6a40000-0000-4000-8000-000000000031';
select lives_ok($$ select public.lock_order_capacity_rows(array(select id from tmp_line)) $$,
  'lock_order_capacity_rows verrouille les créneaux d''une ligne à l''heure');
select public.release_order_line_capacity((select id from tmp_line));
select is(test_booked('21', 10, '10:00') || ',' || test_booked('21', 10, '11:00') || ',' || test_booked('21', 10, '12:00'),
  '0,0,0', 'libération : les trois créneaux de la ligne sont rendus');
select is(test_booked('21', 10, '13:00') || ',' || test_booked('21', 10, '14:00'),
  '1,1', 'libération : les créneaux d''une AUTRE ligne ne bougent pas');

-- ═══ D. Gel, horaires de 60 min, type ═══════════════════════════════════════════════════════════
select throws_like(
  $$ update products set pricing_unit = 'per_person' where id = 'd6a40000-0000-4000-8000-000000000021' $$,
  '%capacity_flags_frozen_while_reserved%',
  'gel : le mode d''une activité qui porte une réservation en cours ne change pas');
select throws_like(
  $$ insert into product_slot_rules (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity)
     values ('d6a40000-0000-4000-8000-000000000022', array[1]::smallint[], '08:00', '10:00', 30, 1) $$,
  '%per_hour_requires_hourly_slots%',
  'à l''heure : un horaire de 30 min est refusé');
select throws_like(
  $$ update products set pricing_unit = 'per_hour' where id = 'd6a40000-0000-4000-8000-000000000025' $$,
  '%per_hour_requires_hourly_slots%',
  'à l''heure : passer à l''heure une activité qui a des horaires de 30 min est refusé');
select lives_ok(
  $$ update products set pricing_unit = 'per_activity' where id = 'd6a40000-0000-4000-8000-000000000025' $$,
  'sans réservation en cours, le mode change librement');
insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop, duration_days, pricing_unit)
values ('d6a40000-0000-4000-8000-000000000026', 'd6a40000-0000-4000-8000-000000000001',
        'd6a40000-0000-4000-8000-000000000011', 'camp', jsonb_build_object('es', 'Camp'), 'hora-camp', true,
        500000, 3, 'per_hour');
select is((select pricing_unit from products where id = 'd6a40000-0000-4000-8000-000000000026'), 'per_person',
  'un type autre qu''activité reste per_person');
select throws_like(
  $$ update products set min_persons = 5, max_persons = 2 where id = 'd6a40000-0000-4000-8000-000000000021' $$,
  '%products_persons_order%', 'personnes : minimum au-dessus du maximum refusé');

-- ═══ E. Réservation manuelle, agenda, commande client ═══════════════════════════════════════════
select test_login('d6a40000-0000-4000-8000-000000000033');
select is(
  (select create_manual_order_line('d6a40000-0000-4000-8000-000000000021'::uuid, public.today_in_bogota() + 14,
     2, 'Walk-in', '15:00'::time) ->> 'ok'),
  'true', 'manuelle à l''heure : 15:00 × 2 h acceptée');
select is(test_booked('21', 14, '15:00') || ',' || test_booked('21', 14, '16:00'), '1,1',
  'manuelle à l''heure : 15:00 et 16:00 pris');
select is(
  (select create_manual_order_line('d6a40000-0000-4000-8000-000000000021'::uuid, public.today_in_bogota() + 14,
     1, 'Walk-in 2', '16:00'::time) ->> 'reason'),
  'full', 'manuelle à l''heure : 16:00 déjà pris → full');
select is(
  (select create_manual_order_line('d6a40000-0000-4000-8000-000000000021'::uuid, public.today_in_bogota() + 14,
     1, 'Walk-in 3') ->> 'reason'),
  'slot_required', 'manuelle à l''heure sans heure → slot_required');
select is(
  (select pricing_unit from partner_agenda_order_lines(public.today_in_bogota() + 14, public.today_in_bogota() + 14)
    where holder_name = 'Walk-in'),
  'per_hour', 'agenda prestataire : la ligne porte son mode (bloc de qty heures)');
reset role;
select is(
  (select public.order_for_client_jsonb(o) -> 'lines' -> 0 ->> 'pricing_unit'
     from orders o where o.account_id = 'd6a40000-0000-4000-8000-000000000031'
     order by o.created_at limit 1),
  'per_hour', 'commande client : la ligne porte son mode');

-- ═══ F. Propositions partenaire ═══════════════════════════════════════════════════════════════════
select test_login('d6a40000-0000-4000-8000-000000000033');
create temp table tmp_prop as
  select (submit_product_creation_proposal(
    'd6a40000-0000-4000-8000-000000000011'::uuid, 'activity',
    jsonb_build_object(
      'name', jsonb_build_object('es', 'Lancha propuesta'), 'price_cop', 420000,
      'pricing_unit', 'per_hour', 'min_persons', 1, 'max_persons', 10,
      'slot_rules', jsonb_build_array(jsonb_build_object(
        'weekdays', jsonb_build_array(1, 2, 3, 4, 5, 6, 7), 'start_time', '08:00', 'end_time', '12:00',
        'slot_duration_minutes', 60, 'capacity', 1))
    )
  ) ->> 'proposal_id')::uuid as id;
select is(
  (select array[payload ->> 'pricing_unit', payload ->> 'min_persons', payload ->> 'max_persons']
     from product_proposals where id = (select id from tmp_prop)),
  array['per_hour', '1', '10'], 'proposition de création : le mode et les personnes traversent la whitelist');

select test_login('d6a40000-0000-4000-8000-000000000034');
create temp table tmp_prop_product as
  select (moderate_product_proposal((select id from tmp_prop), 'approve', 1) ->> 'product_id')::uuid as id;
select is(
  (select array[pricing_unit, min_persons::text, max_persons::text] from products
    where id = (select id from tmp_prop_product)),
  array['per_hour', '1', '10'], 'approbation : la fiche créée est à l''heure, 1 à 10 personnes');

select test_login('d6a40000-0000-4000-8000-000000000033');
create temp table tmp_edit as
  select (submit_product_proposal(
    (select id from tmp_prop_product),
    jsonb_build_object('name', jsonb_build_object('es', 'Lancha propuesta'), 'price_cop', 400000,
                       'pricing_unit', 'per_activity', 'min_persons', 2, 'max_persons', 6)
  ) ->> 'proposal_id')::uuid as id;
select test_login('d6a40000-0000-4000-8000-000000000034');
select moderate_product_proposal((select id from tmp_edit), 'approve', 1);
select is(
  (select array[pricing_unit, min_persons::text, max_persons::text] from products
    where id = (select id from tmp_prop_product)),
  array['per_activity', '2', '6'], 'proposition d''édition approuvée : mode et personnes mis à jour');

-- Un écran qui n'envoie pas le mode : la whitelist pose la clé à null — l'approbation garde le mode.
select test_login('d6a40000-0000-4000-8000-000000000033');
create temp table tmp_edit2 as
  select (submit_product_proposal(
    (select id from tmp_prop_product),
    jsonb_build_object('name', jsonb_build_object('es', 'Lancha propuesta'), 'price_cop', 400000,
                       'min_persons', 2, 'max_persons', 6)
  ) ->> 'proposal_id')::uuid as id;
select test_login('d6a40000-0000-4000-8000-000000000034');
select moderate_product_proposal((select id from tmp_edit2), 'approve', 1);
select is((select pricing_unit from products where id = (select id from tmp_prop_product)), 'per_activity',
  'proposition d''édition sans mode : le mode actuel est gardé, jamais remis à per_person');

select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'products' and column_name = 'qty_unit'),
  0, 'la colonne morte qty_unit a disparu');

select * from finish();
rollback;
