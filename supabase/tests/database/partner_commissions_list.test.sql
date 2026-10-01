-- partner_commissions_list et partner_commission_totals (20260930211348) — remplacent les embeds
-- `order_lines!inner` de apps/admin/app/partner/(app)/commissions/page.tsx (liste, totaux) et
-- [id]/page.tsx (fiche), cassés par le revoke du 2026-09-22 (20260922210000).
--
-- Le périmètre est l'objet du test : un référent ne voit que SES entrées `referrer`, jamais celles
-- d'un autre référent ni une entrée `establishment_compensation`, y compris en devinant un id.
begin;
select plan(15);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('88a10000-0000-4000-8000-000000000101', 'Commissions List Owner'),
  ('88a10000-0000-4000-8000-000000000102', 'Commissions List Referrer A'),
  ('88a10000-0000-4000-8000-000000000103', 'Commissions List Referrer B');
insert into establishments (id, partner_id, name) values
  ('88a10000-0000-4000-8000-000000000111', '88a10000-0000-4000-8000-000000000101',
   jsonb_build_object('es', 'Establecimiento Commissions List'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88a10000-0000-4000-8000-000000000121', '88a10000-0000-4000-8000-000000000101',
   '88a10000-0000-4000-8000-000000000111', 'activity',
   jsonb_build_object('es', 'Actividad Commissions List'), 50000, true, 'commissions-list-test');

insert into auth.users (id, email) values
  ('88a10000-0000-4000-8000-000000000131', 'commissions-list-referrer-a@test.local'),
  ('88a10000-0000-4000-8000-000000000132', 'commissions-list-referrer-b@test.local'),
  ('88a10000-0000-4000-8000-000000000133', 'commissions-list-buyer@test.local');
insert into partner_capabilities (partner_id, role, source, status) values
  ('88a10000-0000-4000-8000-000000000102', 'referrer', 'migration', 'active'),
  ('88a10000-0000-4000-8000-000000000103', 'referrer', 'migration', 'active');
-- Le trigger on_auth_user_created provisionne déjà partner_accounts (partner_id null) : UPDATE,
-- jamais un second INSERT (même correctif que ledger_entries.test.sql).
update partner_accounts set partner_id = '88a10000-0000-4000-8000-000000000102'
 where id = '88a10000-0000-4000-8000-000000000131';
update partner_accounts set partner_id = '88a10000-0000-4000-8000-000000000103'
 where id = '88a10000-0000-4000-8000-000000000132';

insert into orders (id, account_id, holder_name, holder_email) values
  ('88a10000-0000-4000-8000-000000000141', '88a10000-0000-4000-8000-000000000133',
   'Holder Commissions List', 'holder-commissions-list@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('88a10000-0000-4000-8000-000000000151', '88a10000-0000-4000-8000-000000000141',
   '88a10000-0000-4000-8000-000000000133', '88a10000-0000-4000-8000-000000000121',
   '2029-05-10', 1, 'fulfilled', 'Holder Commissions List',
   50000, 50000, 'external_referrer', 0.17, 0.10, 0.07, 8500, 5000, 3500),
  ('88a10000-0000-4000-8000-000000000152', '88a10000-0000-4000-8000-000000000141',
   '88a10000-0000-4000-8000-000000000133', '88a10000-0000-4000-8000-000000000121',
   '2029-06-20', 1, 'reserved', 'Holder Commissions List',
   50000, 50000, 'external_referrer', 0.17, 0.10, 0.07, 8500, 5000, 3500);

insert into ledger_entries (id, order_line_id, beneficiary_type, referrer_partner_id, establishment_id,
                            entry_type, amount_cop, status, paid_at) values
  -- Référent A : une « due » et une « paid » sur la ligne de mai.
  ('88a10000-0000-4000-8000-000000000161', '88a10000-0000-4000-8000-000000000151',
   'referrer', '88a10000-0000-4000-8000-000000000102', null, 'referral_earned', 3000, 'due', null),
  ('88a10000-0000-4000-8000-000000000162', '88a10000-0000-4000-8000-000000000151',
   'referrer', '88a10000-0000-4000-8000-000000000102', null, 'referral_earned', 2000, 'paid',
   now() - interval '1 day'),
  -- Entrée établissement sur la même ligne : jamais visible à un référent.
  ('88a10000-0000-4000-8000-000000000163', '88a10000-0000-4000-8000-000000000151',
   'establishment', null, '88a10000-0000-4000-8000-000000000111', 'establishment_compensation', 4000,
   'due', null),
  -- Référent B : une « estimated » sur la ligne de juin.
  ('88a10000-0000-4000-8000-000000000164', '88a10000-0000-4000-8000-000000000152',
   'referrer', '88a10000-0000-4000-8000-000000000103', null, 'referral_earned', 5000, 'estimated', null);

set local role authenticated;

-- ── Périmètre de la liste ───────────────────────────────────────────────────────────────────────
select test_login('88a10000-0000-4000-8000-000000000131'); -- référent A
select is(
  (select array_agg(id order by id) from partner_commissions_list(p_limit => 100)),
  array['88a10000-0000-4000-8000-000000000161', '88a10000-0000-4000-8000-000000000162']::uuid[],
  'le référent A voit exactement ses deux entrées — ni celle de B, ni l''entrée établissement'
);
select is(
  (select array_agg(total_count) from partner_commissions_list(p_limit => 1)),
  array[2]::bigint[],
  'pagination : une ligne rendue, total_count compte les deux entrées du référent'
);
select is(
  (select row(amount_cop, status, date, total_cop, holder_name, referrer_pct,
              product_name ->> 'es', establishment_name ->> 'es')::text
     from partner_commissions_list(p_entry_id => '88a10000-0000-4000-8000-000000000161')),
  row(3000::bigint, 'due'::text, '2029-05-10'::date, 50000::bigint, 'Holder Commissions List'::text,
      0.1000::numeric, 'Actividad Commissions List'::text, 'Establecimiento Commissions List'::text)::text,
  'la fiche (p_entry_id) rend les colonnes que l''écran affiche'
);
select is(
  (select count(*)::int from partner_commissions_list(p_entry_id => '88a10000-0000-4000-8000-000000000164')),
  0,
  'la fiche d''une entrée du référent B, demandée par A avec son id, ne rend rien'
);
select is(
  (select count(*)::int from partner_commissions_list(p_entry_id => '88a10000-0000-4000-8000-000000000163')),
  0,
  'la fiche d''une entrée établissement, demandée par un référent avec son id, ne rend rien'
);
select is(
  (select array_agg(id) from partner_commissions_list(p_status => 'paid', p_limit => 100)),
  array['88a10000-0000-4000-8000-000000000162']::uuid[],
  'filtre statut'
);
select is(
  (select count(*)::int from partner_commissions_list(p_date_from => '2029-05-11', p_limit => 100)),
  0,
  'filtre date : porte sur la date de la ligne de commande (2029-05-10)'
);

-- ── Totaux ──────────────────────────────────────────────────────────────────────────────────────
select is(
  (select string_agg(status || ':' || amount_cop, ',' order by status) from partner_commission_totals()),
  'due:3000,paid:2000',
  'totaux du référent A : une ligne par statut, sommée en SQL, sur ses seules entrées'
);
select is(
  (select string_agg(status || ':' || amount_cop, ',' order by status)
     from partner_commission_totals(p_status => 'due')),
  'due:3000',
  'totaux filtrés par statut : mêmes filtres que la liste'
);

select test_login('88a10000-0000-4000-8000-000000000132'); -- référent B
select is(
  (select array_agg(id) from partner_commissions_list(p_limit => 100)),
  array['88a10000-0000-4000-8000-000000000164']::uuid[],
  'symétrique : le référent B ne voit que son entrée'
);
select is(
  (select string_agg(status || ':' || amount_cop, ',' order by status) from partner_commission_totals()),
  'estimated:5000',
  'totaux du référent B : jamais ceux de A'
);

select test_login('88a10000-0000-4000-8000-000000000133'); -- compte sans partenaire
select is(
  (select count(*)::int from partner_commissions_list(p_limit => 100)),
  0,
  'un compte sans partenaire n''obtient aucune commission'
);
select is(
  (select count(*)::int from partner_commission_totals()),
  0,
  'un compte sans partenaire n''obtient aucun total'
);

reset role;

-- ── Colonnes rendues : liste EXACTE ─────────────────────────────────────────────────────────────
-- ⚠️ Lues dans `proargnames`/`proargmodes` (mode 't' = colonne de `returns table`), JAMAIS via
-- `pg_type.typrelid` : une fonction `returns table` a pour type de retour `record`, sans relation
-- (`typrelid = 0`), donc une jointure sur `pg_attribute` ne trouve AUCUNE colonne et une assertion
-- « aucune colonne de commission » passe quoi que la fonction rende. La liste exacte rougit aussi
-- bien sur une colonne de commission ajoutée que sur n'importe quel autre ajout non relu.
select is(
  (select string_agg(a.n, ', ' order by a.n)
     from pg_proc p, unnest(p.proargnames, p.proargmodes) as a(n, m)
    where p.oid = 'public.partner_commissions_list'::regproc and a.m = 't'),
  'amount_cop, date, establishment_name, holder_name, id, product_name, referrer_pct, status, '
  'total_cop, total_count',
  'partner_commissions_list rend exactement les colonnes affichées — aucune colonne de commission '
  '(app_commission_cop, acompte_cop, commission_case, app_pct)'
);
select is(
  (select string_agg(a.n, ', ' order by a.n)
     from pg_proc p, unnest(p.proargnames, p.proargmodes) as a(n, m)
    where p.oid = 'public.partner_commission_totals'::regproc and a.m = 't'),
  'amount_cop, status',
  'partner_commission_totals ne rend que statut et montant'
);

select * from finish();
rollback;
