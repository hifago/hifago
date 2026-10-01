-- delete_product (20260815220000, paniers purgés par 20261001231547).
--
-- Un produit présent dans un panier, même abandonné, ne pouvait plus être supprimé : cart_items
-- (spec 32) référence products sans cascade, et la fonction ne la nettoyait pas → 23503, que l'écran
-- admin affiche comme « déjà réservé ». Désormais la ligne de panier part avec le produit, et une
-- ligne de commande, elle, protège toujours le produit.
--
-- ⚠️ Les deux refus partagent le code 23503 : celui « déjà commandé » est vérifié par son MESSAGE,
-- sinon un 23503 de clé étrangère (le défaut corrigé ici) le ferait passer pour vert.
begin;
select plan(8);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('88a50000-0000-4000-8000-000000000001', 'Delete Product Partner');
insert into establishments (id, partner_id, name) values
  ('88a50000-0000-4000-8000-000000000011', '88a50000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Delete Product'));

-- 021 : présent dans un panier, jamais commandé ; 022 : commandé.
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88a50000-0000-4000-8000-000000000021', '88a50000-0000-4000-8000-000000000001',
   '88a50000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'En Un Carrito'),
   30000, true, 'delete-product-en-carrito'),
  ('88a50000-0000-4000-8000-000000000022', '88a50000-0000-4000-8000-000000000001',
   '88a50000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Ya Reservada'),
   30000, true, 'delete-product-reservada');

insert into auth.users (id, email) values
  ('88a50000-0000-4000-8000-000000000031', 'delete-product-admin@test.local'),
  ('88a50000-0000-4000-8000-000000000032', 'delete-product-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('88a50000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

-- Deux lignes de panier sur le même compte : une sur le produit supprimé, une sur l'autre.
insert into cart_items (account_id, product_id, date, qty) values
  ('88a50000-0000-4000-8000-000000000032', '88a50000-0000-4000-8000-000000000021', '2029-10-20', 2),
  ('88a50000-0000-4000-8000-000000000032', '88a50000-0000-4000-8000-000000000022', '2029-10-22', 1);
insert into orders (id, account_id, holder_name, holder_email) values
  ('88a50000-0000-4000-8000-000000000041', '88a50000-0000-4000-8000-000000000032',
   'Delete Product Holder', 'delete-product-holder@test.local');
insert into order_lines (
  order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88a50000-0000-4000-8000-000000000041', '88a50000-0000-4000-8000-000000000032',
  '88a50000-0000-4000-8000-000000000022', '2029-10-21', 1, 'cancelled_by_client', 'Delete Product Holder',
  30000, 30000, 'direct', 0, 0, 0, 0, 0, 0
);

set local role authenticated;

select test_login('88a50000-0000-4000-8000-000000000032');
select throws_ok(
  $$ select delete_product('88a50000-0000-4000-8000-000000000021') $$,
  '42501',
  'delete_product réservé au rôle admin',
  'un compte non admin est refusé'
);

select test_login('88a50000-0000-4000-8000-000000000031');
select lives_ok(
  $$ select delete_product('88a50000-0000-4000-8000-000000000021', 'test panier') $$,
  'un produit présent dans un panier, jamais commandé, se supprime'
);
-- Une ligne de commande, même annulée, protège toujours le produit.
select throws_ok(
  $$ select delete_product('88a50000-0000-4000-8000-000000000022') $$,
  '23503',
  'esta actividad ya fue reservada : despublícala en lugar de eliminarla',
  'un produit déjà commandé reste refusé, avec son message propre'
);

-- ⚠️ Les comptages se lisent APRÈS `reset role` : sous `authenticated`, la RLS de cart_items ne
-- montre à un compte que SES lignes — celles de l'acheteur seraient invisibles à l'admin, et
-- « 0 ligne de panier » serait vrai même si la suppression avait échoué (constaté par mutation).
reset role;

select is(
  (select count(*)::int from products where id = '88a50000-0000-4000-8000-000000000021'),
  0,
  'le produit n''existe plus'
);
select is(
  (select count(*)::int from cart_items where product_id = '88a50000-0000-4000-8000-000000000021'),
  0,
  'sa ligne de panier est partie avec lui'
);
select is(
  (select count(*)::int from audit_log
    where action = 'product.delete' and entity_id = '88a50000-0000-4000-8000-000000000021'),
  1,
  'la suppression est journalisée (audit_log product.delete)'
);
select is(
  (select count(*)::int from products where id = '88a50000-0000-4000-8000-000000000022'),
  1,
  'le produit commandé est toujours là'
);
select is(
  (select count(*)::int from cart_items
    where account_id = '88a50000-0000-4000-8000-000000000032'
      and product_id = '88a50000-0000-4000-8000-000000000022'),
  1,
  'la ligne de panier d''un AUTRE produit, sur le même compte, est intacte'
);

select * from finish();
rollback;
