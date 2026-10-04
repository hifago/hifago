-- Agrégats de l'accueil admin (20260930221527) : admin_dashboard_totals, _daily_series,
-- _referrer_commissions, _top_partners.
--
-- ⚠️ ASSERTIONS EN DELTA. Ces fonctions somment TOUT `order_lines` : sur une base seedée, un total
-- absolu serait faux (c'était le défaut de admin_dashboard_order_lines.test.sql, supprimé avec les
-- fonctions qu'il testait, 20260930222511). Ici chaque fonction est lue AVANT l'insertion des
-- lignes de ce fichier, puis APRÈS ; seule la différence est affirmée. Patron :
-- payments_reconcile.test.sql (table temporaire « before »).
--
-- Montants des six lignes : des puissances de deux distinctes, pour qu'une somme fausse désigne
-- d'elle-même la ligne comptée à tort ou oubliée.
--   L1 reserved  2029-06-10  10 000 (date passée par rapport à p_today = 2029-06-15)
--   L2 fulfilled 2029-06-11  20 000
--   L3 cancelled_by_client 2029-06-12  40 000  — jamais une vente
--   L4 no_show   2029-06-13  80 000
--   L5 expired   2029-06-14 160 000  — jamais une vente
--   L6 reserved  2029-06-20 320 000 (date à venir : vendue, mais pas « en attente d'action »)
-- Ventes (spec 02 §5.2, « non annulées ») = L1 + L2 + L4 + L6 = 430 000.
-- Commissions (lignes fulfilled seulement) = L2 : référent 2 000, plateforme 1 400.
begin;
select plan(19);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('88a20000-0000-4000-8000-000000000001', 'Dashboard Seller'),
  ('88a20000-0000-4000-8000-000000000002', 'Dashboard Referrer');
insert into establishments (id, partner_id, name) values
  ('88a20000-0000-4000-8000-000000000011', '88a20000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Dashboard'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88a20000-0000-4000-8000-000000000021', '88a20000-0000-4000-8000-000000000001',
   '88a20000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Dashboard'), 10000, true, 'dashboard-aggregates-test');

insert into auth.users (id, email) values
  ('88a20000-0000-4000-8000-000000000031', 'dashboard-admin@test.local'),
  ('88a20000-0000-4000-8000-000000000032', 'dashboard-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('88a20000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source, status)
values ('88a20000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active');

insert into orders (id, account_id, holder_name, holder_email) values
  ('88a20000-0000-4000-8000-000000000041', '88a20000-0000-4000-8000-000000000032',
   'Dashboard Holder', 'dashboard-holder@test.local');

-- ── AVANT : lecture de chaque agrégat, avant la moindre ligne de ce fichier ─────────────────────
select test_login('88a20000-0000-4000-8000-000000000031');
create temp table before_totals as select * from admin_dashboard_totals('2029-06-15');
create temp table before_series as select * from admin_dashboard_daily_series('2029-06-01');
create temp table before_referrers as select * from admin_dashboard_referrer_commissions();
create temp table before_top as select * from admin_dashboard_top_partners(1000);

insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop, referrer_partner_id
)
select
  ('88a20000-0000-4000-8000-00000000005' || n)::uuid,
  '88a20000-0000-4000-8000-000000000041', '88a20000-0000-4000-8000-000000000032',
  '88a20000-0000-4000-8000-000000000021', d::date, 1, s, 'Dashboard Holder',
  t, t, 'external_referrer', 0.17, 0.10, 0.07, t * 17 / 100, t / 10, t * 7 / 100,
  '88a20000-0000-4000-8000-000000000002'
from (values
  (1, '2029-06-10', 'reserved', 10000),
  (2, '2029-06-11', 'fulfilled', 20000),
  (3, '2029-06-12', 'cancelled_by_client', 40000),
  (4, '2029-06-13', 'no_show', 80000),
  (5, '2029-06-14', 'expired', 160000),
  (6, '2029-06-20', 'reserved', 320000)
) as l(n, d, s, t);

-- ── Garde : un compte non admin est refusé partout ──────────────────────────────────────────────
set local role authenticated;
select test_login('88a20000-0000-4000-8000-000000000032');
select throws_ok($$ select * from admin_dashboard_totals('2029-06-15') $$, '42501',
  'admin_dashboard_totals réservé au rôle admin',
  'admin_dashboard_totals refuse un compte non admin (42501, message du garde : pas un simple grant manquant)');
select throws_ok($$ select * from admin_dashboard_daily_series('2029-06-01') $$, '42501',
  'admin_dashboard_daily_series réservé au rôle admin',
  'admin_dashboard_daily_series refuse un compte non admin (42501, message du garde : pas un simple grant manquant)');
select throws_ok($$ select * from admin_dashboard_referrer_commissions() $$, '42501',
  'admin_dashboard_referrer_commissions réservé au rôle admin',
  'admin_dashboard_referrer_commissions refuse un compte non admin (42501, message du garde : pas un simple grant manquant)');
select throws_ok($$ select * from admin_dashboard_top_partners(8) $$, '42501',
  'admin_dashboard_top_partners réservé au rôle admin',
  'admin_dashboard_top_partners refuse un compte non admin (42501, message du garde : pas un simple grant manquant)');

-- La suite se lit sous le rôle propriétaire des tables temporaires `before_*`, avec l'identité de
-- l'admin : c'est `auth.uid()` (les claims), pas le rôle SQL, que le garde des quatre fonctions lit.
reset role;
select test_login('88a20000-0000-4000-8000-000000000031');

-- ── Totaux : une ligne, et le delta exact ───────────────────────────────────────────────────────
select is(
  (select count(*)::int from admin_dashboard_totals('2029-06-15')),
  1,
  'admin_dashboard_totals rend UNE ligne (somme faite en SQL : rien à tronquer par max_rows)'
);
select is(
  (select revenue_cop from admin_dashboard_totals('2029-06-15')) - (select revenue_cop from before_totals),
  430000::bigint,
  'revenus : reserved + fulfilled + no_show (L1+L2+L4+L6), jamais une annulation ni une expiration'
);
select is(
  (select referrer_commission_cop from admin_dashboard_totals('2029-06-15'))
    - (select referrer_commission_cop from before_totals),
  2000::bigint,
  'commission référent : lignes fulfilled seulement (L2)'
);
select is(
  (select app_commission_cop from admin_dashboard_totals('2029-06-15'))
    - (select app_commission_cop from before_totals),
  1400::bigint,
  'commission plateforme : lignes fulfilled seulement (L2)'
);
select is(
  (select pending_count from admin_dashboard_totals('2029-06-15')) - (select pending_count from before_totals),
  1::bigint,
  'pedidos pendientes : une ligne reserved dont la date est passée (L1), pas celle à venir (L6) — '
  'l''ancien filtre sur ''confirmed'' rendait toujours 0'
);

-- ── Série journalière : une ligne par jour, deltas par jour ─────────────────────────────────────
create temp table after_series as select * from admin_dashboard_daily_series('2029-06-01');
select is(
  (select count(*) - count(distinct date) from after_series),
  0::bigint,
  'la série rend une ligne PAR JOUR (agrégée en SQL), jamais une par ligne de commande'
);
create temp table series_delta as
  select a.date,
         a.sales_cop - coalesce(b.sales_cop, 0) as sales,
         a.referrer_commission_cop - coalesce(b.referrer_commission_cop, 0) as referrer,
         a.app_commission_cop - coalesce(b.app_commission_cop, 0) as app
    from after_series a
    left join before_series b on b.date = a.date
   where a.date between '2029-06-10' and '2029-06-20';
select is(
  (select string_agg(date || ':' || sales || '/' || referrer || '/' || app, ' ' order by date)
     from series_delta where sales <> 0 or referrer <> 0 or app <> 0),
  '2029-06-10:10000/0/0 2029-06-11:20000/2000/1400 2029-06-13:80000/0/0 2029-06-20:320000/0/0',
  'série : ventes des jours L1, L2, L4, L6 ; commissions le seul jour fulfilled ; rien les jours '
  'de l''annulation (L3) et de l''expiration (L5)'
);
select is(
  (select count(*)::int from admin_dashboard_daily_series('2029-06-21') where date < '2029-06-21'),
  0,
  'p_since borne la série : aucun jour antérieur'
);

-- ── Chips des référents ─────────────────────────────────────────────────────────────────────────
select is(
  (select referrer_commission_cop from admin_dashboard_referrer_commissions()
    where referrer_partner_id = '88a20000-0000-4000-8000-000000000002')
    - coalesce((select referrer_commission_cop from before_referrers
                 where referrer_partner_id = '88a20000-0000-4000-8000-000000000002'), 0),
  2000::bigint,
  'commission du référent : lignes fulfilled seulement (L2)'
);
select is(
  (select count(*) - count(distinct referrer_partner_id) from admin_dashboard_referrer_commissions()),
  0::bigint,
  'une ligne par référent'
);

-- ── Top partenaires ─────────────────────────────────────────────────────────────────────────────
select is(
  (select total_cop from admin_dashboard_top_partners(1000)
    where partner_id = '88a20000-0000-4000-8000-000000000001')
    - coalesce((select total_cop from before_top
                 where partner_id = '88a20000-0000-4000-8000-000000000001'), 0),
  430000::bigint,
  'volume du partenaire VENDEUR (propriétaire de l''établissement) : mêmes statuts que les revenus'
);
select is(
  (select display_name from partners where id = '88a20000-0000-4000-8000-000000000002')
    = any(select partner_display_name from admin_dashboard_top_partners(1000)),
  false,
  'le référent n''apparaît pas au top : le volume revient au vendeur, pas à qui a apporté la vente'
);
select is(
  (select count(*)::int from admin_dashboard_top_partners(1)),
  1,
  'p_limit borne le nombre de partenaires'
);
select ok(
  (select bool_and(total_cop >= coalesce(next_total, total_cop))
     from (select total_cop, lead(total_cop) over (order by ordinality) as next_total
             from admin_dashboard_top_partners(1000) with ordinality) t),
  'top partenaires trié par volume décroissant'
);

select ok(
  not has_function_privilege('anon', 'public.admin_dashboard_totals(date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_dashboard_daily_series(date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_dashboard_referrer_commissions()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_dashboard_top_partners(int)', 'EXECUTE'),
  'aucun des quatre agrégats n''est exécutable par anon'
);

select * from finish();
rollback;
