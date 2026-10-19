-- Spec 33 Tranche 1 — `orders.reference` / `orders.access_token` et `get_order_by_token`.
-- Migrations 20260910170000 et 20260910170100, seules sources de vérité.
--
-- Ce que ce fichier doit prouver, et qui n'est prouvable QUE par un test :
--   1. le jeton fait foi SANS aucune session — c'est le destinataire principal de l'écran (un
--      client qui ouvre le lien depuis son email sur un appareil neuf), et aucun parcours manuel
--      sur cette machine ne peut l'exercer (Mercado Pago n'est pas configuré en local) ;
--   2. une session anonyme ÉTRANGÈRE ne change rien — ni ne débloque, ni ne bloque ;
--   3. la RPC ne distingue JAMAIS « jeton faux » de « commande absente » — quatre entrées
--      invalides, une seule et même réponse ;
--   4. la lecture directe d'`orders` par `anon` reste à zéro ligne : cette RPC n'est pas un trou
--      dans la RLS, elle est une porte à part, avec sa propre clé ;
--   5. les totaux ignorent les lignes mortes, alors que ces lignes restent LISTÉES.
begin;
select plan(34);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : 1 partenaire/établissement/produit, 1 acheteur, 1 tiers porteur d'une identité
-- anonyme (pour prouver le point 2 ci-dessus).
insert into partners (id, display_name) values
  ('89330000-0000-4000-8000-000000000001', 'Token Test Partner');
insert into establishments (id, partner_id, name) values
  ('89330000-0000-4000-8000-000000000011', '89330000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Token', 'en', 'Token Establishment'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '89330000-0000-4000-8000-000000000021', '89330000-0000-4000-8000-000000000001',
  '89330000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Token', 'en', 'Token Activity'), 100000, true, 'token-test'
);

insert into auth.users (id, email) values
  ('89330000-0000-4000-8000-000000000031', 'token-buyer@test.local'),
  ('89330000-0000-4000-8000-000000000032', 'token-stranger@test.local');
-- Le tiers est une identité ANONYME : c'est très exactement l'état d'un visiteur qui a mis
-- quelque chose au panier sur l'appareil où il ouvre le lien de quelqu'un d'autre.
update auth.users set is_anonymous = true
 where id = '89330000-0000-4000-8000-000000000032';

-- La commande de test : 3 lignes, dont 2 mortes (annulée + expirée). Les montants sont choisis
-- pour que « toutes les lignes » (300000) et « les lignes vivantes » (100000) ne puissent pas être
-- confondus par hasard.
insert into orders (id, account_id, holder_name, holder_email, holder_phone)
values ('89330000-0000-4000-8000-000000000041', '89330000-0000-4000-8000-000000000031',
        'Holder Token', 'holder-token@test.local', '+573001234567');

insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('89330000-0000-4000-8000-000000000051', '89330000-0000-4000-8000-000000000041',
   '89330000-0000-4000-8000-000000000031', '89330000-0000-4000-8000-000000000021',
   '2026-11-01', 1, 'reserved', 'Holder Token',
   100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000),
  ('89330000-0000-4000-8000-000000000052', '89330000-0000-4000-8000-000000000041',
   '89330000-0000-4000-8000-000000000031', '89330000-0000-4000-8000-000000000021',
   '2026-11-02', 1, 'cancelled_by_client', 'Holder Token',
   100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000),
  ('89330000-0000-4000-8000-000000000053', '89330000-0000-4000-8000-000000000041',
   '89330000-0000-4000-8000-000000000031', '89330000-0000-4000-8000-000000000021',
   '2026-11-03', 1, 'expired', 'Holder Token',
   100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000);

-- Le jeton n'est jamais tapé en dur : il vient du DÉFAUT de la colonne, donc ce test exerce aussi
-- la génération elle-même.
create temporary table t_token as
  select access_token, reference, id from orders where id = '89330000-0000-4000-8000-000000000041';
-- Les deux derniers blocs lisent ce jeton APRÈS `set local role anon`/`authenticated` : sans ce
-- grant, le test échouerait sur la table de fixtures elle-même (permission denied) et non sur ce
-- qu'il prétend mesurer. Table temporaire, détruite au rollback — aucune portée hors de ce test.
grant select on t_token to anon, authenticated;

-- ── Forme des colonnes ────────────────────────────────────────────────────────────────────────
select matches(
  (select reference from t_token), '^HFG-[0-9]{6}$',
  'reference a la forme HFG-000000, dictable au téléphone (spec 33 invariant 1)'
);
select matches(
  (select access_token from t_token), '^[0-9a-f]{32}$',
  'access_token fait 32 caractères hex, soit 128 bits — URL-safe sans encodage'
);
-- ⚠️ Ce sont les CONTRAINTES qu'on vérifie, pas leur effet observable. Une première version
-- comptait les nuls et comparait `count(*)` à `count(distinct …)` — trois assertions qui ne
-- peuvent pas rougir : un nul serait refusé à l'INSERT par le NOT NULL, et un doublon par l'index
-- unique, donc le test aurait échoué avant d'arriver à l'assertion. Du vert qui ne prouve rien.
select col_not_null('public', 'orders', 'reference', 'reference est NOT NULL — le backfill a couvert toutes les lignes existantes');
select col_not_null('public', 'orders', 'access_token', 'access_token est NOT NULL — idem');
select has_index('public', 'orders', 'orders_access_token_key', 'un index UNIQUE garde le jeton (et c''est le seul chemin de lecture de l''écran)');
select has_index('public', 'orders', 'orders_reference_key', 'un index UNIQUE garde le numéro de réservation');

-- Deux commandes neuves d'affilée : c'est la seule façon de prouver que le défaut est réévalué
-- PAR LIGNE, et pas figé une fois pour toutes.
insert into orders (id, account_id, holder_name, holder_email)
values ('89330000-0000-4000-8000-000000000042', '89330000-0000-4000-8000-000000000031',
        'Holder Deux', 'deux@test.local'),
       ('89330000-0000-4000-8000-000000000043', '89330000-0000-4000-8000-000000000031',
        'Holder Trois', 'trois@test.local');
select ok(
  (select reference from orders where id = '89330000-0000-4000-8000-000000000043')
  > (select reference from orders where id = '89330000-0000-4000-8000-000000000042'),
  'la séquence avance : la commande suivante porte un numéro strictement plus grand'
);

-- ── Contenu rendu par la RPC ──────────────────────────────────────────────────────────────────
select is(
  (public.get_order_by_token((select access_token from t_token))->>'ok')::boolean, true,
  'un jeton valide rend ok=true'
);
select is(
  public.get_order_by_token((select access_token from t_token))#>>'{order,reference}',
  (select reference from t_token),
  'la commande rendue porte bien SON numéro'
);
select is(
  public.get_order_by_token((select access_token from t_token))#>>'{order,id}',
  '89330000-0000-4000-8000-000000000041',
  'la commande rendue est bien celle du jeton'
);
select is(
  jsonb_array_length(public.get_order_by_token((select access_token from t_token))#>'{order,lines}'),
  3,
  'les TROIS lignes sont listées, y compris l''annulée et l''expirée (jamais masquées)'
);
select is(
  (public.get_order_by_token((select access_token from t_token))#>>'{order,total_cop}')::bigint,
  100000::bigint,
  'total_cop ne compte QUE les lignes vivantes (100000), jamais les 300000 de toutes les lignes'
);
select is(
  (public.get_order_by_token((select access_token from t_token))#>>'{order,acompte_cop}')::bigint,
  17000::bigint,
  'acompte_cop suit la même règle que total_cop'
);
select is(
  (select count(*) from jsonb_array_elements(
     public.get_order_by_token((select access_token from t_token))#>'{order,lines}'
   ) l where l->>'status' in ('cancelled_by_client', 'expired'))::int,
  2,
  'chaque ligne morte est rendue AVEC son statut — l''écran doit pouvoir la montrer barrée'
);
select is(
  public.get_order_by_token((select access_token from t_token))#>>'{order,lines,0,product_name,en}',
  'Token Activity',
  'les libellés sortent BRUTS en jsonb multilingue — la RPC ne traduit rien (comme getCartLines)'
);
select is(
  public.get_order_by_token((select access_token from t_token))#>>'{order,lines,0,establishment_name,es}',
  'Establecimiento Token',
  'le nom d''établissement est joint et rendu brut lui aussi'
);
-- Assumé PAR ÉCRIT au cahier §2b.9 : qui détient le lien voit ces trois champs. Le test existe
-- pour que ce soit une DÉCISION vérifiée, jamais un oubli de filtrage découvert plus tard.
select is(
  public.get_order_by_token((select access_token from t_token))#>>'{order,holder_email}',
  'holder-token@test.local',
  'le jeton donne accès à l''email du client — tradeoff assumé, cahier client §2b.9'
);
select is(
  public.get_order_by_token((select access_token from t_token))#>>'{order,holder_phone}',
  '+573001234567',
  'et à son téléphone — même tradeoff, même décision'
);

-- ── Les quatre entrées invalides, une seule réponse ───────────────────────────────────────────
select is(
  public.get_order_by_token(repeat('a', 32))->>'reason', 'order_not_found',
  'un jeton bien formé mais inconnu : order_not_found'
);
select is(
  public.get_order_by_token('pas-un-jeton')->>'reason', 'order_not_found',
  'un jeton malformé : LA MÊME réponse, jamais un message qui trahirait le format attendu'
);
select is(
  public.get_order_by_token(null)->>'reason', 'order_not_found',
  'un jeton nul : la même réponse encore'
);
select is(
  public.get_order_by_token(upper((select access_token from t_token)))->>'reason', 'order_not_found',
  'le jeton est sensible à la casse — un hex en majuscules n''ouvre rien'
);

-- ── Le vrai cas d'usage : aucune session du tout ──────────────────────────────────────────────
set local role anon;
select is(
  (public.get_order_by_token((select access_token from t_token))->>'ok')::boolean, true,
  'SANS AUCUNE SESSION, le jeton ouvre la commande — le cas du client qui clique le lien de son email'
);
select is(
  (select count(*) from orders)::int, 0,
  'et pourtant anon ne lit AUCUNE commande en direct : la RPC est une porte à part, pas un trou RLS'
);
reset role;

-- ── Une session anonyme étrangère ne change rien ──────────────────────────────────────────────
select test_login('89330000-0000-4000-8000-000000000032');
set local role authenticated;
select is(
  (public.get_order_by_token((select access_token from t_token))->>'ok')::boolean, true,
  'une identité anonyme ÉTRANGÈRE ouvre le lien aussi : le jeton fait foi, jamais l''identité'
);
reset role;

-- ── Les grants sont ceux qu''on croit ─────────────────────────────────────────────────────────
select ok(
  has_function_privilege('anon', 'public.get_order_by_token(text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_order_by_token(text)', 'EXECUTE'),
  'anon ET authenticated peuvent l''exécuter — vérifié sur l''ACL, jamais déduit du corps'
);

-- ── Spec 34 : ce que le contrat PARTAGÉ ajoute, et ce qu'il retire ────────────────────────────
-- Depuis 20260911100000, le payload vient de order_for_client_jsonb, partagée avec
-- list_my_orders. Les assertions ci-dessous tiennent les trois changements de forme — les 26
-- au-dessus, inchangées, tiennent le reste.

select is(
  (public.get_order_by_token((select access_token from t_token)) #>> '{order,lines,0,establishment_slug}'),
  (select slug from establishments where id = '89330000-0000-4000-8000-000000000011'),
  'chaque ligne porte le slug de son établissement — le lien vers sa fiche (spec 34 décision ③)'
);

-- La colonne est NULLABLE (20260908202000) et cette fixture ne la renseigne pas : l'écran doit
-- pouvoir distinguer « pas de numéro » de « numéro vide », et ne rendre AUCUN bouton dans ce cas.
select ok(
  (public.get_order_by_token((select access_token from t_token)) #> '{order,lines,0,establishment_contact_phone}') = 'null'::jsonb,
  'un établissement sans contact_phone rend null — jamais une chaîne vide, jamais un bouton mort'
);

update establishments set contact_phone = '+573001234567'
 where id = '89330000-0000-4000-8000-000000000011';

-- 20261019170000 (décision Jérôme) : le numéro existe, mais la commande n'est pas finalisée (un
-- acompte de 17000 reste dû en ligne) — il ne sort PAS.
select ok(
  (public.get_order_by_token((select access_token from t_token)) #> '{order,lines,0,establishment_contact_phone}') = 'null'::jsonb,
  'le WhatsApp du prestataire ne sort pas tant que la commande n''est pas payée (20261019170000)'
);

update orders set payment_status = 'paid' where id = '89330000-0000-4000-8000-000000000041';

select is(
  (public.get_order_by_token((select access_token from t_token)) #>> '{order,lines,0,establishment_contact_phone}'),
  '+573001234567',
  'payée, la commande rend le contact de l''établissement (spec 34 décision ⑥, 20261019170000)'
);

update orders set payment_status = 'unpaid' where id = '89330000-0000-4000-8000-000000000041';

-- Le produit de fixture est de type 'activity' : `duration_days` y est NUL par défaut, comme pour
-- toute ligne hors camp (contrainte products_duration_days_required_for_camp, 20260814220000).
select ok(
  (public.get_order_by_token((select access_token from t_token)) #> '{order,lines,0,duration_days}') = 'null'::jsonb,
  'duration_days est null pour une ligne hors camp — jamais une valeur inventée'
);

update products set duration_days = 7 where id = '89330000-0000-4000-8000-000000000021';

select is(
  (public.get_order_by_token((select access_token from t_token)) #>> '{order,lines,0,duration_days}')::int,
  7,
  'duration_days sort du contrat quand il existe (20260916) — l''écran reconstitue la date de fin d''un camp'
);

-- orders.status vaut 'confirmed' sur toute ligne et aucun update ne l'écrit nulle part
-- (20260814161500 l''assume par écrit). Le RETIRER du payload fait passer « ne pas l''afficher »
-- d''une discipline à une impossibilité (spec 34 invariant 4).
select ok(
  not ((public.get_order_by_token((select access_token from t_token)) -> 'order') ? 'status'),
  'orders.status n''est plus transmis — placeholder jamais calculé'
);

-- ⚠️ L''assertion qui compte. order_lines_select autorise `account_id = auth.uid()` sur TOUTES les
-- colonnes : rien en base ne s''oppose à la lecture des commissions, l''exclusion est applicative.
-- C''est exactement la faute que le portail LEGACY commet en production (commission_estimee_cop
-- renvoyée au front client). Cette liste blanche est le seul rempart de ce chemin — donc elle se
-- teste (CLAUDE.md §11.20).
select is(
  (select count(*)::int
     from jsonb_array_elements(public.get_order_by_token((select access_token from t_token)) #> '{order,lines}') l,
          lateral jsonb_object_keys(l) k
    where k like '%commission%' or k like '%\_pct' or k = 'referrer_partner_id'),
  0,
  'AUCUNE colonne de commission ne sort du contrat « commande vue par son client »'
);

select * from finish();
rollback;
