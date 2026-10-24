-- create_order et cart_lines_availability : le jour même, l'heure de début compte (migration
-- 20261024130000, raison start_time_passed).
--   - créneau du jour à 00:00 → refusé ; créneau du jour à 23:58 → accepté ; créneau de 00:00 demain → accepté ;
--   - evento du jour à 00:00 → refusé ; evento du jour à 23:58 → accepté ;
--   - activité à la journée (sans heure) aujourd'hui → acceptée (rien ne change).
-- Les deux fonctions rendent la MÊME raison pour la même ligne.
--
-- ⚠️ Heures fixes, pas relatives à l'horloge : seul `00:00` est toujours passé dans la journée. Les
-- cas « accepté » à 23:58 deviennent faux entre 23 h 58 et minuit à Guatapé — fenêtre connue,
-- assumée (deux minutes par jour) plutôt qu'une heure calculée qui déborderait sur le lendemain.
begin;
select plan(9);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
-- Un panier d'une ligne : la raison de cart_lines_availability, puis celle de create_order (ou 'ok').
create function test_line(p_product text, p_date date, p_slot time default null) returns text[]
language plpgsql as $$
declare
  v_result jsonb;
  v_cla text;
begin
  delete from public.cart_items where account_id = auth.uid();
  insert into public.cart_items (account_id, product_id, date, slot_start_time, qty)
  values (auth.uid(), ('d5e10000-0000-4000-8000-0000000000' || p_product)::uuid, p_date, p_slot, 1);
  select coalesce(reason, 'ok') into v_cla from public.cart_lines_availability();
  v_result := create_order('Cliente Hora', p_holder_email => 'hora@test.local');
  return array[v_cla, case when (v_result ->> 'ok')::boolean then 'ok' else v_result ->> 'reason' end];
end;
$$;

insert into partners (id, display_name) values ('d5e10000-0000-4000-8000-000000000001', 'Hora Guards');
insert into establishments (id, partner_id, name) values
  ('d5e10000-0000-4000-8000-000000000011', 'd5e10000-0000-4000-8000-000000000001', jsonb_build_object('es', 'Hora Guards'));
insert into auth.users (id, email) values ('d5e10000-0000-4000-8000-000000000031', 'hora-buyer@test.local');

insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop,
                      online_bookable, evento_capacity_mode, evento_payment_mode, default_capacity,
                      occurrence_type, occurrence_date, start_time, evento_occupies_resource) values
  -- 21 : activité à créneaux (yoga), tous les jours.
  ('d5e10000-0000-4000-8000-000000000021', 'd5e10000-0000-4000-8000-000000000001', 'd5e10000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'Yoga'), 'hora-yoga', true, 22000, false, null, null, 10, null, null, null, true),
  -- 22 : evento réservable, occurrence aujourd'hui à 00:00.
  ('d5e10000-0000-4000-8000-000000000022', 'd5e10000-0000-4000-8000-000000000001', 'd5e10000-0000-4000-8000-000000000011',
   'evento', jsonb_build_object('es', 'Madrugada'), 'hora-madrugada', true, 20000, true, 'metered', 'online', 10,
   'once', public.today_in_bogota(), '00:00', false),
  -- 23 : evento réservable, occurrence aujourd'hui à 23:58.
  ('d5e10000-0000-4000-8000-000000000023', 'd5e10000-0000-4000-8000-000000000001', 'd5e10000-0000-4000-8000-000000000011',
   'evento', jsonb_build_object('es', 'Noche'), 'hora-noche', true, 20000, true, 'metered', 'online', 10,
   'once', public.today_in_bogota(), '23:58', false),
  -- 24 : activité à la journée, sans heure.
  ('d5e10000-0000-4000-8000-000000000024', 'd5e10000-0000-4000-8000-000000000001', 'd5e10000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'Kayak'), 'hora-kayak', true, 30000, false, null, null, 10, null, null, null, true);

insert into product_slot_rules (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity) values
  ('d5e10000-0000-4000-8000-000000000021', array[1, 2, 3, 4, 5, 6, 7]::smallint[], '00:00', '01:00', 60, 10),
  ('d5e10000-0000-4000-8000-000000000021', array[1, 2, 3, 4, 5, 6, 7]::smallint[], '23:58', '23:59', 1, 10);
insert into product_availability (product_id, date, capacity, booked) values
  ('d5e10000-0000-4000-8000-000000000024', public.today_in_bogota(), 10, 0);

set local role authenticated;
select test_login('d5e10000-0000-4000-8000-000000000031');
create temp table r (k text primary key, reasons text[]);
insert into r values
  ('creneau_passe',       test_line('21', public.today_in_bogota(), '00:00')),
  ('creneau_a_venir',     test_line('21', public.today_in_bogota(), '23:58')),
  ('creneau_demain',      test_line('21', public.today_in_bogota() + 1, '00:00')),
  ('evento_passe',        test_line('22', public.today_in_bogota())),
  ('evento_a_venir',      test_line('23', public.today_in_bogota())),
  ('journee_sans_heure',  test_line('24', public.today_in_bogota()));
reset role;

select is((select reasons from r where k = 'creneau_passe'), array['start_time_passed', 'start_time_passed'],
  'créneau du jour déjà commencé → start_time_passed (panier et commande)');
select is((select reasons from r where k = 'creneau_a_venir'), array['ok', 'ok'], 'créneau du jour pas encore commencé → accepté');
select is((select reasons from r where k = 'creneau_demain'), array['ok', 'ok'], 'créneau de 00:00 demain → accepté (seul le jour même est concerné)');
select is((select reasons from r where k = 'evento_passe'), array['start_time_passed', 'start_time_passed'],
  'evento du jour déjà commencé (products.start_time) → start_time_passed');
select is((select reasons from r where k = 'evento_a_venir'), array['ok', 'ok'], 'evento du jour pas encore commencé → accepté');
select is((select reasons from r where k = 'journee_sans_heure'), array['ok', 'ok'], 'activité à la journée, sans heure → acceptée (rien ne change)');

select is(public.start_time_has_passed(public.today_in_bogota(), null), false, 'sans heure → jamais passé');
select is(public.start_time_has_passed(public.today_in_bogota() - 1, '23:59'), true, 'hier 23:59 → passé');

select is(
  (select count(*)::int from orders where account_id = 'd5e10000-0000-4000-8000-000000000031'),
  (select count(*)::int from r where reasons[2] = 'ok'),
  'une commande par acceptation, aucune pour les refus');

select * from finish();
rollback;
