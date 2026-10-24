-- Lobby après l'acompte (migration 20261023120000) — hold_pms_nights, la tenue anti-survente des
-- nuits PMS : cas unitaires, séquentiels.
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - les refus typés : commande inconnue, payée, sans ligne vivante, connecteur coupé, lecture
--     périmée (plus de 60 s) ou future (plus de 30 s), bornes comprises ;
--   - une nuit absente, nulle, non entière, négative, ou une ligne sans plage → not_quoted (échec
--     fermé, jamais « libre ») ; not_quoted passe avant full ;
--   - la règle D2 : dispo lue − « en vol » des AUTRES commandes ≥ demandé, où « en vol » = tenue sans
--     booking OU bookée après lecture − 30 s (pms_recorded_at, à défaut pms_booked_at) ; une ligne
--     non tenue, morte, ou de la commande elle-même ne compte pas ; une même catégorie compte pour
--     tous ses produits et pour son seul établissement ; les lignes d'une commande s'additionnent par
--     nuit ; la première nuit en défaut est rendue ;
--   - succès : pms_held_at et pms_checked_at posés, rien d'autre ; échec : rien n'est écrit ; une
--     ligne déjà bookée n'est ni revérifiée ni tenue ; les verrous de catégorie sont matérialisés ;
--   - service_role seul.
-- ⚠️ `now()` est constant dans la transaction : les instants des fixtures et p_read_at s'expriment par
-- rapport à lui, la fonction lisant la même horloge. La concurrence (verrou de catégorie, lecture
-- après verrou) relève de tests/concurrency/hold_pms_nights.concurrency.mjs.
begin;
select plan(49);

insert into partners (id, display_name) values ('7e110000-0000-4000-8000-000000000001', 'Hold Test Partner');
-- 011, 012 : connecteur actif + jeton ; 013 : connecteur coupé.
insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token) values
  ('7e110000-0000-4000-8000-000000000011', '7e110000-0000-4000-8000-000000000001', jsonb_build_object('es', 'Hold Uno'), true, 'tok-hold-1'),
  ('7e110000-0000-4000-8000-000000000012', '7e110000-0000-4000-8000-000000000001', jsonb_build_object('es', 'Hold Dos'), true, 'tok-hold-2'),
  ('7e110000-0000-4000-8000-000000000013', '7e110000-0000-4000-8000-000000000001', jsonb_build_object('es', 'Hold Apagado'), false, 'tok-hold-3');
insert into auth.users (id, email) values ('7e110000-0000-4000-8000-000000000021', 'hold-buyer@test.local');
-- 031 et 032 : DEUX produits hifago sur la même catégorie Lobby 7101 de 011 ; 033 : catégorie 7102 de
-- 011 ; 034 : catégorie 7101 de 012 (même numéro, autre établissement) ; 035 : 7103 de 013 (coupé) ;
-- 036 : logement local de 011.
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id) values
  ('7e110000-0000-4000-8000-000000000031', '7e110000-0000-4000-8000-000000000001', '7e110000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Hold A'), 100000, true, 'hold-a', 7101),
  ('7e110000-0000-4000-8000-000000000032', '7e110000-0000-4000-8000-000000000001', '7e110000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Hold A bis'), 100000, true, 'hold-a-bis', 7101),
  ('7e110000-0000-4000-8000-000000000033', '7e110000-0000-4000-8000-000000000001', '7e110000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Hold B'), 100000, true, 'hold-b', 7102),
  ('7e110000-0000-4000-8000-000000000034', '7e110000-0000-4000-8000-000000000001', '7e110000-0000-4000-8000-000000000012', 'lodging', jsonb_build_object('es', 'Hold C'), 100000, true, 'hold-c', 7101),
  ('7e110000-0000-4000-8000-000000000035', '7e110000-0000-4000-8000-000000000001', '7e110000-0000-4000-8000-000000000013', 'lodging', jsonb_build_object('es', 'Hold Apagado'), 100000, true, 'hold-off', 7103),
  ('7e110000-0000-4000-8000-000000000036', '7e110000-0000-4000-8000-000000000001', '7e110000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Hold Local'), 100000, true, 'hold-local', null);

create function t_order(p_id uuid, p_status text default 'unpaid') returns void language sql as $$
  insert into orders (id, account_id, holder_name, holder_email, payment_status)
  values (p_id, '7e110000-0000-4000-8000-000000000021', 'Hold', 'hold-buyer@test.local', p_status);
$$;
create function t_line(p_id uuid, p_order uuid, p_product uuid, p_date date, p_end date, p_qty int default 1,
                       p_status text default 'reserved', p_held timestamptz default null, p_booking text default null,
                       p_recorded timestamptz default null, p_booked timestamptz default null)
returns void language sql as $$
  insert into order_lines (
    id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop,
    pms_held_at, pms_booking_id, pms_recorded_at, pms_booked_at
  ) values (
    p_id, p_order, '7e110000-0000-4000-8000-000000000021', p_product, p_date, p_end, p_qty, p_status, 'Hold',
    100000, 100000 * p_qty, 'direct', 0.17, 0, 0.17, 17000 * p_qty, 0, 17000 * p_qty,
    p_held, p_booking, p_recorded, p_booked
  );
$$;
-- Une lecture d'une seule catégorie : {"<établissement>": {"<catégorie>": <nuits>}}.
create function t_snap(p_est text, p_cat int, p_nights jsonb) returns jsonb language sql as $$
  select jsonb_build_object('7e110000-0000-4000-8000-0000000000' || p_est, jsonb_build_object(p_cat::text, p_nights));
$$;
create function t_hold(p_order text, p_snapshot jsonb, p_read_at timestamptz default now()) returns jsonb language sql as $$
  select public.hold_pms_nights(('7e110000-0000-4000-8000-000000' || p_order)::uuid, p_snapshot, p_read_at);
$$;
create function t_id(p_suffix text) returns uuid language sql as $$
  select ('7e110000-0000-4000-8000-000000' || p_suffix)::uuid;
$$;

-- ── Fixtures, une fenêtre de dates par scénario (aucune interférence entre eux) ──────────────
-- A : refus. A01 payée ; A02 sans ligne vivante ; A03 connecteur coupé ; A04 logement local seul.
select t_order(t_id('0000a1'), 'paid');
select t_line(t_id('0001a1'), t_id('0000a1'), t_id('000031'), '2029-01-01', '2029-01-02');
select t_order(t_id('0000a2'));
select t_line(t_id('0001a2'), t_id('0000a2'), t_id('000031'), '2029-01-01', '2029-01-02', 1, 'expired');
select t_order(t_id('0000a3'));
select t_line(t_id('0001a3'), t_id('0000a3'), t_id('000035'), '2029-01-01', '2029-01-02');
select t_order(t_id('0000a4'));
select t_line(t_id('0001a4'), t_id('0000a4'), t_id('000036'), '2029-01-01', '2029-01-02');
-- B : lecture périmée, une nuit.
select t_order(t_id('0000b1'));
select t_line(t_id('0001b1'), t_id('0000b1'), t_id('000031'), '2029-02-01', '2029-02-02');
-- C : cotation. C1 deux nuits ; C2 sans date de fin ; C3 date de fin = date ; C4 une nuit complète
-- ET une nuit non cotée (deux catégories).
select t_order(t_id('0000c1'));
select t_line(t_id('0001c1'), t_id('0000c1'), t_id('000031'), '2029-03-01', '2029-03-03');
select t_order(t_id('0000c2'));
select t_line(t_id('0001c2'), t_id('0000c2'), t_id('000031'), '2029-03-05', null);
select t_order(t_id('0000c3'));
select t_line(t_id('0001c3'), t_id('0000c3'), t_id('000031'), '2029-03-06', '2029-03-06');
select t_order(t_id('0000c4'));
select t_line(t_id('0001c4'), t_id('0000c4'), t_id('000031'), '2029-03-10', '2029-03-11');
select t_line(t_id('0002c4'), t_id('0000c4'), t_id('000033'), '2029-03-10', '2029-03-11');
-- D : « en vol » (a) — nuit du 2029-04-01. Une tenue sans booking (compte) ; une non tenue (5 unités,
-- ne compte pas) ; une tenue expirée et une bookée annulée (mortes, ne comptent pas).
select t_order(t_id('0000d0'));
select t_line(t_id('0001d0'), t_id('0000d0'), t_id('000031'), '2029-04-01', '2029-04-02', 1, 'reserved', now() - interval '20 minutes');
select t_order(t_id('0000d9'));
select t_line(t_id('0001d9'), t_id('0000d9'), t_id('000031'), '2029-04-01', '2029-04-02', 5);
select t_order(t_id('0000d8'));
select t_line(t_id('0001d8'), t_id('0000d8'), t_id('000031'), '2029-04-01', '2029-04-02', 1, 'expired', now() - interval '20 minutes');
select t_order(t_id('0000d7'));
select t_line(t_id('0001d7'), t_id('0000d7'), t_id('000031'), '2029-04-01', '2029-04-02', 1, 'cancelled_by_client', now() - interval '20 minutes', 'BK-D7', now() - interval '5 seconds', now() - interval '6 seconds');
select t_order(t_id('0000d1'));
select t_line(t_id('0001d1'), t_id('0000d1'), t_id('000031'), '2029-04-01', '2029-04-02');
-- E : « en vol » (b) — lecture à now() − 5 s, donc seuil = now() − 35 s. Une nuit par cas, une
-- autre commande bookée par nuit : E0 enregistrée à now() − 10 s (compte) ; E9 à now() − 50 s (ne
-- compte pas) ; E8 exactement au seuil (ne compte pas, `>` strict) ; E7 sans pms_recorded_at, claim
-- à now() − 10 s (repli, compte) ; E6 ni l'un ni l'autre (booking ancien, ne compte pas).
select t_order(t_id('0000e0'), 'paid');
select t_line(t_id('0001e0'), t_id('0000e0'), t_id('000031'), '2029-05-01', '2029-05-02', 1, 'reserved', now() - interval '1 hour', 'BK-E0', now() - interval '10 seconds', now() - interval '20 seconds');
select t_order(t_id('0000e9'), 'paid');
select t_line(t_id('0001e9'), t_id('0000e9'), t_id('000031'), '2029-05-02', '2029-05-03', 1, 'reserved', now() - interval '1 hour', 'BK-E9', now() - interval '50 seconds', now() - interval '60 seconds');
select t_order(t_id('0000e8'), 'paid');
select t_line(t_id('0001e8'), t_id('0000e8'), t_id('000031'), '2029-05-03', '2029-05-04', 1, 'reserved', now() - interval '1 hour', 'BK-E8', now() - interval '35 seconds', now() - interval '40 seconds');
select t_order(t_id('0000e7'), 'paid');
select t_line(t_id('0001e7'), t_id('0000e7'), t_id('000031'), '2029-05-04', '2029-05-05', 1, 'reserved', null, 'BK-E7', null, now() - interval '10 seconds');
select t_order(t_id('0000e6'), 'paid');
select t_line(t_id('0001e6'), t_id('0000e6'), t_id('000031'), '2029-05-05', '2029-05-06', 1, 'reserved', null, 'BK-E6', null, null);
select t_order(t_id('0000e1'));
select t_line(t_id('0001e1'), t_id('0000e1'), t_id('000031'), '2029-05-01', '2029-05-02');
select t_order(t_id('0000e2'));
select t_line(t_id('0001e2'), t_id('0000e2'), t_id('000031'), '2029-05-02', '2029-05-03');
select t_order(t_id('0000e3'));
select t_line(t_id('0001e3'), t_id('0000e3'), t_id('000031'), '2029-05-03', '2029-05-04');
select t_order(t_id('0000e4'));
select t_line(t_id('0001e4'), t_id('0000e4'), t_id('000031'), '2029-05-04', '2029-05-05');
select t_order(t_id('0000e5'));
select t_line(t_id('0001e5'), t_id('0000e5'), t_id('000031'), '2029-05-05', '2029-05-06');
-- F : plusieurs lignes, plusieurs nuits. F1 : deux lignes (nuits 06-01/02 et 06-02/03) ; F2 même
-- catégorie ; F3 autre catégorie ; F4 même numéro de catégorie, autre établissement ; F5 autre
-- produit hifago, même catégorie.
select t_order(t_id('0000f1'));
select t_line(t_id('0001f1'), t_id('0000f1'), t_id('000031'), '2029-06-01', '2029-06-03');
select t_line(t_id('0002f1'), t_id('0000f1'), t_id('000031'), '2029-06-02', '2029-06-04');
select t_order(t_id('0000f2'));
select t_line(t_id('0001f2'), t_id('0000f2'), t_id('000031'), '2029-06-02', '2029-06-03');
select t_order(t_id('0000f3'));
select t_line(t_id('0001f3'), t_id('0000f3'), t_id('000033'), '2029-06-02', '2029-06-03');
select t_order(t_id('0000f4'));
select t_line(t_id('0001f4'), t_id('0000f4'), t_id('000034'), '2029-06-02', '2029-06-03');
select t_order(t_id('0000f5'));
select t_line(t_id('0001f5'), t_id('0000f5'), t_id('000032'), '2029-06-02', '2029-06-03');
-- G : la première nuit en défaut. G0 tient 07-02 et 07-03 ; G1 demande 07-01 → 07-04.
select t_order(t_id('0000ab'));
select t_line(t_id('0001ab'), t_id('0000ab'), t_id('000031'), '2029-07-02', '2029-07-04', 1, 'reserved', now() - interval '1 minute');
select t_order(t_id('0000ac'));
select t_line(t_id('0001ac'), t_id('0000ac'), t_id('000031'), '2029-07-01', '2029-07-04');
-- H : une nuit DÉJÀ bookée de la commande (ancien flux) n'est ni revérifiée ni tenue.
select t_order(t_id('0000ad'));
select t_line(t_id('0001ad'), t_id('0000ad'), t_id('000031'), '2029-08-01', '2029-08-02', 1, 'reserved', null, 'BK-H1', now() - interval '2 hours', now() - interval '2 hours');
select t_line(t_id('0002ad'), t_id('0000ad'), t_id('000033'), '2029-08-01', '2029-08-02');
-- I : des quantités. I0 tient 2 unités ; I1 en demande 2.
select t_order(t_id('0000ae'));
select t_line(t_id('0001ae'), t_id('0000ae'), t_id('000031'), '2029-09-01', '2029-09-02', 2, 'reserved', now() - interval '1 minute');
select t_order(t_id('0000af'));
select t_line(t_id('0001af'), t_id('0000af'), t_id('000031'), '2029-09-01', '2029-09-02', 2);

-- ── Droits ───────────────────────────────────────────────────────────────────────────────────
select ok(
  not has_function_privilege('anon', 'public.hold_pms_nights(uuid, jsonb, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.hold_pms_nights(uuid, jsonb, timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.hold_pms_nights(uuid, jsonb, timestamptz)', 'execute'),
  'H1 : service_role seul exécute hold_pms_nights');
set local role anon;
select throws_ok(
  $$ select public.hold_pms_nights('7e110000-0000-4000-8000-0000000000d1', '{}'::jsonb, now()) $$,
  '42501', null, 'H1b : un appel anonyme est refusé par le grant (42501)');
reset role;

set local role service_role;
-- ── A : refus typés ──────────────────────────────────────────────────────────────────────────
select is(public.hold_pms_nights('00000000-0000-4000-8000-000000000000', '{}'::jsonb, now()),
  jsonb_build_object('ok', false, 'reason', 'order_not_found'), 'A1 : commande inconnue → order_not_found');
select is(public.hold_pms_nights(null, '{}'::jsonb, now()),
  jsonb_build_object('ok', false, 'reason', 'order_not_found'), 'A1b : commande nulle → order_not_found');
select is(t_hold('0000a1', t_snap('11', 7101, '{"2029-01-01": 9}')),
  jsonb_build_object('ok', false, 'reason', 'order_paid'), 'A2 : commande payée → order_paid (jamais revérifiée)');
select is(t_hold('0000a2', t_snap('11', 7101, '{"2029-01-01": 9}')),
  jsonb_build_object('ok', false, 'reason', 'order_not_active'), 'A3 : aucune ligne vivante → order_not_active');
select is(t_hold('0000a3', jsonb_build_object('7e110000-0000-4000-8000-000000000013', jsonb_build_object('7103', '{"2029-01-01": 9}'::jsonb))),
  jsonb_build_object('ok', false, 'reason', 'pms_unavailable'), 'A4 : connecteur coupé → pms_unavailable (§4.4), même avec une lecture');
select is(t_hold('0000a4', '{}'::jsonb),
  jsonb_build_object('ok', true, 'held_lines', 0, 'checked_at', now()), 'A5 : aucune nuit PMS à tenir → ok, 0 ligne');

-- ── B : lecture périmée ou future (bornes comprises) ────────────────────────────────────────
select is(t_hold('0000b1', t_snap('11', 7101, '{"2029-02-01": 9}'), null) ->> 'reason', 'stale_read',
  'B1 : instant de lecture absent → stale_read');
select is(t_hold('0000b1', t_snap('11', 7101, '{"2029-02-01": 9}'), now() - interval '60 seconds' - interval '1 millisecond') ->> 'reason', 'stale_read',
  'B2 : lecture de plus de 60 s → stale_read');
select is(t_hold('0000b1', t_snap('11', 7101, '{"2029-02-01": 9}'), now() + interval '30 seconds' + interval '1 millisecond') ->> 'reason', 'stale_read',
  'B3 : lecture datée de plus de 30 s dans le futur → stale_read');
select is(
  (select jsonb_build_object('held', pms_held_at, 'checked', (select pms_checked_at from orders where id = t_id('0000b1')))
     from order_lines where id = t_id('0001b1')),
  jsonb_build_object('held', null, 'checked', null),
  'B4 : un refus n''écrit rien');
select is(t_hold('0000b1', t_snap('11', 7101, '{"2029-02-01": 9}'), now() - interval '60 seconds') ->> 'ok', 'true',
  'B5 : lecture de 60 s pile → acceptée');
select is(t_hold('0000b1', t_snap('11', 7101, '{"2029-02-01": 9}'), now() + interval '30 seconds') ->> 'ok', 'true',
  'B6 : lecture à +30 s pile (dérive d''horloge) → acceptée');

-- ── C : cotation ─────────────────────────────────────────────────────────────────────────────
select is(t_hold('0000c1', t_snap('11', 7101, '{"2029-03-01": 5}')),
  jsonb_build_object('ok', false, 'reason', 'not_quoted', 'line_id', t_id('0001c1'), 'night', '2029-03-02', 'lobby_category_id', 7101),
  'C1 : une nuit absente de la lecture → not_quoted, sa ligne et sa nuit (jamais « libre »)');
select is(t_hold('0000c1', t_snap('11', 7101, '{"2029-03-01": 5, "2029-03-02": null}')) ->> 'reason', 'not_quoted',
  'C2 : une nuit nulle → not_quoted');
select is(t_hold('0000c1', t_snap('11', 7101, '{"2029-03-01": 5, "2029-03-02": "3"}')) ->> 'reason', 'not_quoted',
  'C3 : une nuit en texte → not_quoted');
select is(t_hold('0000c1', t_snap('11', 7101, '{"2029-03-01": 5, "2029-03-02": -1}')) ->> 'reason', 'not_quoted',
  'C4 : une nuit négative → not_quoted');
select is(t_hold('0000c1', t_snap('11', 7101, '{"2029-03-01": 5, "2029-03-02": 1.5}')) ->> 'reason', 'not_quoted',
  'C5 : une nuit non entière → not_quoted');
select is(t_hold('0000c1', null) ->> 'night', '2029-03-01',
  'C6 : aucune lecture → not_quoted dès la première nuit');
select is(t_hold('0000c1', t_snap('12', 7101, '{"2029-03-01": 5, "2029-03-02": 5}')) ->> 'reason', 'not_quoted',
  'C7 : la lecture d''un AUTRE établissement ne cote pas celui-ci');
select is(t_hold('0000c2', t_snap('11', 7101, '{"2029-03-05": 5}')),
  jsonb_build_object('ok', false, 'reason', 'not_quoted', 'line_id', t_id('0001c2'), 'night', '2029-03-05', 'invalid_range', true),
  'C8 : une ligne sans date de fin → not_quoted (invalid_range), jamais ignorée');
select is(t_hold('0000c3', t_snap('11', 7101, '{"2029-03-06": 5}')) ->> 'invalid_range', 'true',
  'C9 : une ligne dont la fin égale le début → not_quoted (invalid_range)');
select is(
  t_hold('0000c4', jsonb_build_object('7e110000-0000-4000-8000-000000000011', jsonb_build_object('7101', '{"2029-03-10": 0}'::jsonb))) ->> 'reason',
  'not_quoted',
  'C10 : une nuit complète (7101) ET une non cotée (7102) → not_quoted d''abord (échec fermé)');

-- ── D : « en vol » (a), tenue sans booking ──────────────────────────────────────────────────
select is(t_hold('0000d1', t_snap('11', 7101, '{"2029-04-01": 1}')),
  jsonb_build_object('ok', false, 'reason', 'full', 'line_id', t_id('0001d1'), 'night', '2029-04-01',
                     'available', 1, 'in_flight', 1, 'requested', 1, 'lobby_category_id', 7101),
  'D1 : dernière unité tenue par une autre commande → full ; ni la non tenue (5), ni l''expirée, ni l''annulée bookée ne comptent');
select is(t_hold('0000d1', t_snap('11', 7101, '{"2029-04-01": 2}')) ->> 'ok', 'true',
  'D2 : une unité de plus → tenue');

-- ── E : « en vol » (b), booking récent ──────────────────────────────────────────────────────
select is(t_hold('0000e1', t_snap('11', 7101, '{"2029-05-01": 1}'), now() - interval '5 seconds') ->> 'in_flight', '1',
  'E1 : booking enregistré après lecture − 30 s → en vol (la lecture ne le reflète peut-être pas)');
select is(t_hold('0000e2', t_snap('11', 7101, '{"2029-05-02": 1}'), now() - interval '5 seconds') ->> 'ok', 'true',
  'E2 : booking enregistré bien avant la lecture (− 50 s) → reflété par Lobby, plus en vol');
select is(t_hold('0000e3', t_snap('11', 7101, '{"2029-05-03": 1}'), now() - interval '5 seconds') ->> 'ok', 'true',
  'E3 : booking enregistré exactement à lecture − 30 s → plus en vol (borne stricte)');
select is(t_hold('0000e4', t_snap('11', 7101, '{"2029-05-04": 1}'), now() - interval '5 seconds') ->> 'in_flight', '1',
  'E4 : sans pms_recorded_at, l''heure du claim (pms_booked_at) récente → en vol');
select is(t_hold('0000e5', t_snap('11', 7101, '{"2029-05-05": 1}'), now() - interval '5 seconds') ->> 'ok', 'true',
  'E5 : booking ancien sans aucun horodatage → plus en vol');

-- ── F : plusieurs lignes, plusieurs nuits, périmètre de la catégorie ────────────────────────
select is(t_hold('0000f1', t_snap('11', 7101, '{"2029-06-01": 1, "2029-06-02": 1, "2029-06-03": 1}')),
  jsonb_build_object('ok', false, 'reason', 'full', 'line_id', least(t_id('0001f1'), t_id('0002f1')), 'night', '2029-06-02',
                     'available', 1, 'in_flight', 0, 'requested', 2, 'lobby_category_id', 7101),
  'F1 : deux lignes de la commande sur la même nuit s''additionnent (2 > 1) — la nuit commune est rendue');
select is(t_hold('0000f1', t_snap('11', 7101, '{"2029-06-01": 1, "2029-06-02": 2, "2029-06-03": 1}')),
  jsonb_build_object('ok', true, 'held_lines', 2, 'checked_at', now()),
  'F2 : assez pour les deux → les deux lignes tenues');
select is(t_hold('0000f1', t_snap('11', 7101, '{"2029-06-01": 1, "2029-06-02": 2, "2029-06-03": 1}')) ->> 'ok', 'true',
  'F3 : retenir la même commande ne la compte jamais contre elle-même');
select is(t_hold('0000f2', t_snap('11', 7101, '{"2029-06-02": 2}')) ->> 'in_flight', '2',
  'F4 : les deux lignes tenues de F1 sont en vol pour une autre commande → full');
select is(t_hold('0000f3', t_snap('11', 7102, '{"2029-06-02": 1}')) ->> 'ok', 'true',
  'F5 : une autre catégorie du même établissement n''est pas concernée');
select is(t_hold('0000f4', t_snap('12', 7101, '{"2029-06-02": 1}')) ->> 'ok', 'true',
  'F6 : le même numéro de catégorie dans un autre établissement n''est pas concerné');
select is(t_hold('0000f5', t_snap('11', 7101, '{"2029-06-02": 2}')) ->> 'in_flight', '2',
  'F7 : un autre produit hifago de la MÊME catégorie compte les tenues de F1');

-- ── G, H, I ──────────────────────────────────────────────────────────────────────────────────
select is(t_hold('0000ac', t_snap('11', 7101, '{"2029-07-01": 1, "2029-07-02": 1, "2029-07-03": 1}')) ->> 'night', '2029-07-02',
  'G1 : la PREMIÈRE nuit en défaut est rendue');
select is(t_hold('0000ad', t_snap('11', 7102, '{"2029-08-01": 1}')),
  jsonb_build_object('ok', true, 'held_lines', 1, 'checked_at', now()),
  'H1 : une nuit déjà bookée n''est pas revérifiée (aucune lecture pour elle) — seule l''autre est tenue');
select is(
  (select array_agg(id::text || ':' || (pms_held_at is not null) order by id) from order_lines where order_id = t_id('0000ad')),
  array[t_id('0001ad')::text || ':false', t_id('0002ad')::text || ':true'],
  'H2 : la nuit déjà bookée n''est pas tenue, l''autre l''est');
select is(t_hold('0000af', t_snap('11', 7101, '{"2029-09-01": 3}')) ->> 'reason', 'full',
  'I1 : 3 libres − 2 tenues < 2 demandées → full (quantités, pas des lignes)');
select is(t_hold('0000af', t_snap('11', 7101, '{"2029-09-01": 4}')) ->> 'ok', 'true',
  'I2 : 4 libres − 2 tenues ≥ 2 → tenue');
reset role;

-- ── Écritures ────────────────────────────────────────────────────────────────────────────────
select is(
  (select jsonb_build_object('held', pms_held_at = now(), 'checked', (select pms_checked_at = now() from orders where id = t_id('0000d1')))
     from order_lines where id = t_id('0001d1')),
  jsonb_build_object('held', true, 'checked', true),
  'W1 : succès → pms_held_at et orders.pms_checked_at = now()');
select is(
  (select jsonb_build_object('held', pms_held_at, 'checked', (select pms_checked_at from orders where id = t_id('0000f2')))
     from order_lines where id = t_id('0001f2')),
  jsonb_build_object('held', null, 'checked', null),
  'W2 : échec (full) → rien n''est écrit');
select is((select pms_checked_at = now() from orders where id = t_id('0000a4')), true,
  'W3 : rien à tenir → la vérification est datée quand même');
select is(
  (select array_agg(establishment_id::text || '/' || lobby_category_id order by establishment_id, lobby_category_id)
     from pms_category_locks where establishment_id in (t_id('000011'), t_id('000012'), t_id('000013'))),
  array[t_id('000011')::text || '/7101', t_id('000011')::text || '/7102', t_id('000012')::text || '/7101'],
  'W4 : les verrous des catégories tenues sont matérialisés — jamais celui d''un établissement coupé');
select is(
  (select jsonb_build_object('rls', c.relrowsecurity, 'policies', (select count(*)::int from pg_policies p where p.tablename = 'pms_category_locks'))
     from pg_class c where c.oid = 'public.pms_category_locks'::regclass),
  jsonb_build_object('rls', true, 'policies', 0),
  'W5 : pms_category_locks sous RLS, sans aucune policy');
select ok(
  not has_table_privilege('anon', 'public.pms_category_locks', 'select')
  and not has_table_privilege('authenticated', 'public.pms_category_locks', 'select')
  and not has_table_privilege('authenticated', 'public.pms_category_locks', 'insert')
  and not has_table_privilege('authenticated', 'public.pms_category_locks', 'update')
  and not has_table_privilege('authenticated', 'public.pms_category_locks', 'delete'),
  'W6 : ni anon ni authenticated n''y lisent ou n''y écrivent');

select * from finish();
rollback;
