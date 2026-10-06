-- Rendu des réclamations non traitées par les jobs (migration 20261006124933) : un passage dont le
-- budget de temps s'épuise rend ce qu'il a réclamé sans le tenter.
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - release_pms_cancellation_claim : claim puis rendu = la tentative du claim est rendue
--     (attempts revient à sa valeur d'avant), `last_error` intact ; jamais sous zéro ; une entrée
--     close (done, failed) n'est ni touchée ni comptée ;
--   - release_pms_poll_claim : la ligne représentante rendue redevient « jamais interrogée »
--     (tête du lot suivant, `nulls first`) ; ses sœurs gardent leur marque ; une ligne morte ou sans
--     booking n'est ni touchée ni comptée ;
--   - les deux rendent le nombre de lignes touchées, 0 sur un tableau vide ou NULL ;
--   - droits : service_role seul (et la liste de service_role_only_functions.test.sql).
-- Le `skip locked` de release_pms_poll_claim n'est pas prouvable ici (une seule session) : il est
-- le même que celui de claim_pms_poll_batch, et la fonction ne prend aucun autre verrou.
begin;
select plan(17);

insert into auth.users (id, email) values ('6b200000-0000-4000-8000-000000000001', 'job-release-buyer@test.local');
insert into partners (id, display_name) values ('6b200000-0000-4000-8000-000000000003', 'Job Release Owner');
insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token) values
  ('6b200000-0000-4000-8000-000000000011', '6b200000-0000-4000-8000-000000000003', jsonb_build_object('es', 'Rendu uno'), true, 'tok-release');
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id) values
  ('6b200000-0000-4000-8000-000000000021', '6b200000-0000-4000-8000-000000000003', '6b200000-0000-4000-8000-000000000011',
   'lodging', jsonb_build_object('es', 'JR Noche'), 100000, true, 'jr-noche', 9961),
  ('6b200000-0000-4000-8000-000000000022', '6b200000-0000-4000-8000-000000000003', '6b200000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'JR Actividad'), 50000, true, 'jr-actividad', null);
insert into orders (id, account_id, holder_name, holder_email, payment_status, reference) values
  ('6b200000-0000-4000-8000-000000000031', '6b200000-0000-4000-8000-000000000001', 'JR', 'job-release-buyer@test.local', 'paid', 'JR-31');

create function jr_line(p_id text, p_product text, p_status text, p_booking text) returns void
language sql as $$
  insert into order_lines (
    id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop, pms_booking_id, pms_booked_at
  ) values (
    ('6b200000-0000-4000-8000-0000000000' || p_id)::uuid, '6b200000-0000-4000-8000-000000000031',
    '6b200000-0000-4000-8000-000000000001', ('6b200000-0000-4000-8000-0000000000' || p_product)::uuid,
    '2029-10-01', case when p_product = '21' then '2029-10-03'::date end, 1, p_status, 'JR',
    100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000, p_booking, case when p_booking is not null then now() end
  );
$$;
-- JR-B1 = une nuit (41, représentante) et une activité (42, sœur) ; 43 = une ligne morte ; 44 = une
-- nuit sans booking.
select jr_line('41', '21', 'reserved', 'JR-B1');
select jr_line('42', '22', 'reserved', 'JR-B1');
select jr_line('43', '21', 'cancelled_by_client', 'JR-B2');
select jr_line('44', '21', 'reserved', null);

-- 51 : jamais tentée ; 52 : à sa dernière tentative ; 53 : close ; 54 : en échec.
insert into pms_cancellation_queue (id, pms_booking_id, establishment_id, hifago_status, status, attempts, last_error) values
  ('6b200000-0000-4000-8000-000000000051', 'JR-C1', '6b200000-0000-4000-8000-000000000011', 'expired', 'pending', 0, null),
  ('6b200000-0000-4000-8000-000000000052', 'JR-C2', '6b200000-0000-4000-8000-000000000011', 'expired', 'pending', 2, 'HTTP 503 — motif réel'),
  ('6b200000-0000-4000-8000-000000000053', 'JR-C3', '6b200000-0000-4000-8000-000000000011', 'expired', 'done', 1, null),
  ('6b200000-0000-4000-8000-000000000054', 'JR-C4', '6b200000-0000-4000-8000-000000000011', 'expired', 'failed', 3, 'HTTP 404 — échec');

create temp table jr_ids (name text primary key, id uuid);
insert into jr_ids values
  ('c1', '6b200000-0000-4000-8000-000000000051'), ('c2', '6b200000-0000-4000-8000-000000000052'),
  ('c3', '6b200000-0000-4000-8000-000000000053'), ('c4', '6b200000-0000-4000-8000-000000000054'),
  ('rep', '6b200000-0000-4000-8000-000000000041'), ('sister', '6b200000-0000-4000-8000-000000000042'),
  ('dead', '6b200000-0000-4000-8000-000000000043'), ('unbooked', '6b200000-0000-4000-8000-000000000044');

-- ── release_pms_cancellation_claim ─────────────────────────────────────────────────────────────
-- Le claim est global : seules les entrées de ce fichier sont regardées.
create temp table jr_cancel_claimed as
  select c.entry_id, c.attempts from public.claim_pms_cancellation_batch(1000) c
   where c.entry_id in (select id from jr_ids where name in ('c1', 'c2'));

select is(
  (select string_agg(attempts::text, ',' order by entry_id) from jr_cancel_claimed),
  '1,3',
  'le claim compte une tentative à chaque entrée réclamée (0 → 1, 2 → 3)'
);

select is(
  public.release_pms_cancellation_claim(array(select id from jr_ids where name in ('c1', 'c2', 'c3', 'c4'))),
  2,
  'rendu : seules les deux entrées en attente sont comptées (close et en échec exclues)'
);

select is(
  (select string_agg(attempts::text, ',' order by id) from pms_cancellation_queue
    where id in (select id from jr_ids where name in ('c1', 'c2'))),
  '0,2',
  'la tentative du claim est rendue : attempts revient à sa valeur d''avant'
);

select is(
  (select last_error from pms_cancellation_queue where id = '6b200000-0000-4000-8000-000000000052'),
  'HTTP 503 — motif réel',
  'last_error garde le dernier motif réel'
);

select is(
  (select string_agg(status || ':' || attempts || ':' || coalesce(last_error, '-'), ',' order by id) from pms_cancellation_queue
    where id in (select id from jr_ids where name in ('c3', 'c4'))),
  'done:1:-,failed:3:HTTP 404 — échec',
  'une entrée close ou en échec n''est jamais touchée'
);

select is(
  public.release_pms_cancellation_claim(array['6b200000-0000-4000-8000-000000000051'::uuid]),
  1,
  'une entrée à 0 tentative reste comptée…'
);
select is(
  (select attempts from pms_cancellation_queue where id = '6b200000-0000-4000-8000-000000000051'),
  0,
  '… mais jamais sous zéro'
);

select is(public.release_pms_cancellation_claim(array[]::uuid[]), 0, 'tableau vide : 0');
select is(public.release_pms_cancellation_claim(null), 0, 'NULL : 0');

-- ── release_pms_poll_claim ─────────────────────────────────────────────────────────────────────
create temp table jr_poll_claimed as
  select c.order_line_id from public.claim_pms_poll_batch(1000) c
   where c.order_line_id in (select id from jr_ids where name in ('rep', 'sister'));

select is(
  (select array_agg(order_line_id) from jr_poll_claimed),
  array['6b200000-0000-4000-8000-000000000041'::uuid],
  'le claim rend la représentante seule (la plus petite ligne du booking)'
);

select is(
  (select count(*)::int from order_lines
    where id in (select id from jr_ids where name in ('rep', 'sister')) and pms_last_polled_at is not null),
  2,
  'le claim marque interrogées la représentante et sa sœur'
);

select is(
  public.release_pms_poll_claim(array(select id from jr_ids where name in ('rep', 'dead', 'unbooked'))),
  1,
  'rendu : seule la ligne vivante et bookée est comptée (ligne morte et ligne sans booking exclues)'
);

select is(
  (select pms_last_polled_at from order_lines where id = '6b200000-0000-4000-8000-000000000041'),
  null,
  'la représentante redevient « jamais interrogée » : tête du lot suivant (nulls first)'
);

select isnt(
  (select pms_last_polled_at from order_lines where id = '6b200000-0000-4000-8000-000000000042'),
  null,
  'la sœur garde sa marque (la représentante la ramène au lot suivant)'
);

select is(
  (select count(*)::int from order_lines
    where id in (select id from jr_ids where name in ('dead', 'unbooked')) and pms_last_polled_at is not null),
  0,
  'ligne morte et ligne sans booking : jamais marquées, jamais touchées'
);

select is(public.release_pms_poll_claim(array[]::uuid[]) + public.release_pms_poll_claim(null), 0, 'tableau vide ou NULL : 0');

-- ── Droits ─────────────────────────────────────────────────────────────────────────────────────
select ok(
  has_function_privilege('service_role', 'public.release_pms_cancellation_claim(uuid[])', 'EXECUTE')
    and has_function_privilege('service_role', 'public.release_pms_poll_claim(uuid[])', 'EXECUTE')
    and not has_function_privilege('anon', 'public.release_pms_cancellation_claim(uuid[])', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.release_pms_cancellation_claim(uuid[])', 'EXECUTE')
    and not has_function_privilege('anon', 'public.release_pms_poll_claim(uuid[])', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.release_pms_poll_claim(uuid[])', 'EXECUTE'),
  'service_role seul exécute les deux fonctions de rendu'
);

select * from finish();
rollback;
