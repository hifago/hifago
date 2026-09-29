-- Feature 6 (Client : composer un panier à plusieurs lignes sur une même commande,
-- multi-établissement) — create_order. Séquencement en 4 phases testé dans l'ordre de la
-- migration (20260813243000_create_order_rpc.sql, seule source de vérité pour les seuils/reasons) :
--   1. Plafonds globaux (lodging lignes>4 OU unités>12 ; prestation lignes>20 ; qty individuelle>20
--      pour le non-lodging) — aucun verrou pris, product_availability jamais consultée.
--   2. Verrouillage FOR UPDATE de toutes les ressources (product_id, date) visées, un seul ordre
--      stable, une seule requête.
--   3. Validation par ligne contre l'état verrouillé (sellable, calendrier ouvert, capacité —
--      sommée entre lignes visant le même produit+date), aucune écriture avant cette étape.
--   4. Écriture tout-ou-rien (orders + order_lines + product_availability.booked).
--
-- N'importe quel compte authentifié (ou, depuis le correctif réservation invité ci-dessous, aucun
-- compte du tout) peut acheter n'importe quel produit sellable de n'importe quel établissement
-- (contrairement à submit_product_proposal, feature 15, qui exige une capacité socio) : un seul
-- compte acheteur suffit pour tous les cas authentifiés, sauf le cas positif multi-établissement
-- (12) qui a besoin d'un second partenaire/établissement/produit.
--
-- Correctif — réservation invité (2026-08-14) : create_order n'exigeait plus auth.uid() non nul —
-- v_account_id (potentiellement null) était écrit tel quel. Cas 14 ci-dessous (après le cas 13)
-- rejoue les principaux garde-fous déjà prouvés sous authenticated, mais sous un invité, pour
-- prouver l'absence de régression. grant execute élargi à anon dans la même migration.
--
-- ⚠️ RÉVISÉ le 2026-09-10 (spec 31, Tranche 1) : la garde `not_authenticated` est RÉINTRODUITE, et
-- « invité » change de sens sans que la décision du 2026-08-14 soit renversée. Ce qu'elle
-- garantissait — acheter SANS COMPTE, sans mot de passe — reste intact : depuis ce lot, un invité a
-- une IDENTITÉ ANONYME Supabase (créée par CartContext au premier ajout au panier, jamais par cette
-- RPC), donc `auth.uid()` n'est plus jamais nul pour lui. Les blocs `test_logout(); set local role
-- anon;` ci-dessous, qui simulaient « aucune identité du tout », deviennent `test_login_anonymous`
-- (identité anonyme réelle, cf. plus bas) — c'est la SEULE façon dont un invité atteint désormais
-- cette RPC. Le cas 1 (vraiment aucune identité) reste seul à tester la garde elle-même.
--
-- Feature 7 — attribution (2026-08-14) : create_order gagne p_attribution_code/p_attribution_source
-- et résout orders.referrer_partner_id/attribution_code/attribution_source (+ persistance
-- partner_accounts.saved_attribution_code pour un compte enregistré). Cas 15 ci-dessous.
--
-- Feature 11 — snapshot commission (2026-08-14) : order_lines gagne price_cop/total_cop +
-- commission_case/acompte_pct/referrer_pct/app_pct/acompte_cop/referrer_commission_cop/
-- app_commission_cop, calculés dans la même boucle d'écriture Phase 4 que le update
-- product_availability/insert order_lines déjà couverts ci-dessus (cas 9-14). Cas 16 ci-dessous :
-- les 3 cas de la table de décision, l'arrondi sur un total non rond, l'indépendance par ligne d'un
-- panier multi-établissement, et l'immutabilité du snapshot face à un prix modifié après coup.
--
-- Feature 20 — camp multi-jours (2026-08-14) : pour une ligne type='camp', Phase 2/3/4 gagnent
-- chacune une sous-étape conditionnelle (verrouillage + validation + écriture de
-- provider_resource_calendar/availability_blocks, cf. migration). Cas 17 ci-dessous : plage
-- entièrement disponible → succès ; un seul jour indisponible sur la ressource PARTAGÉE →
-- resource_unavailable tout-ou-rien ; camp + prestation qui échoue dans le même panier → aucune
-- écriture non plus sur la ressource partagée du camp.
--
-- Spec 19 §0 Tranche 0 (2026-08-18) : create_order écrit désormais une ledger_entries initiale
-- (beneficiary_type='referrer', status='estimated') pour toute ligne external_referrer — jamais
-- pour self_referral/direct (referrer_pct=0). 3 assertions ajoutées juste après le cas 16b/16c
-- ci-dessous, mêmes fixtures, aucune nouvelle commande.
--
-- Migration 20260929112240 (2026-09-29) : un logement exige une end_date (date_range_required) —
-- les cas 5, 6 et 14c posent donc une nuit par ligne. Cas 24 ci-dessous pour les nouvelles gardes
-- (plafond par ligne d'un logement, plage obligatoire, ressource partagée sommée sur le panier,
-- e-mail camp échappé).
begin;
select plan(124);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Correctif réservation invité : reset_config plutôt qu'un simple changement de rôle — test_login
-- pose request.jwt.claims pour toute la transaction (set_config(..., true) = SET LOCAL, pas
-- SET LOCAL par statement) ; passer role à anon plus loin dans ce fichier NE suffit PAS à lui seul
-- à simuler un vrai invité si un test_login a déjà tourné avant dans la même transaction — sans
-- cet appel explicite, auth.uid() continuerait de résoudre la dernière identité connectée malgré
-- le rôle anon. Utilisé par les cas 14/15 (invité) plus bas.
create function test_logout() returns void language sql as $$
  reset request.jwt.claims;
$$;

-- Ajouté 2026-09-10 (spec 31) : simule un VISITEUR avec identité anonyme (is_anonymous:true dans
-- le claim, comme le JWT réel émis par signInAnonymously()) — distinct de test_logout(), qui
-- simule l'ABSENCE totale d'identité (cas 1 seul, désormais). uid doit correspondre à une ligne
-- auth.users(is_anonymous=true) déjà posée (fixture V_GUEST plus bas), sinon
-- is_anonymous_session() (lue par create_order) renverrait false et les cas 14/15/16 se
-- comporteraient comme un compte enregistré au lieu d'un invité.
create function test_login_anonymous(uid uuid) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'is_anonymous', true)::text,
    true
  );
$$;

-- Ajoutés 2026-09-10 (spec 32, panier en base) : create_order lit désormais cart_items/carts pour
-- auth.uid(), plus un paramètre — ces deux helpers reposent le panier/l'attribution SOUS
-- L'IDENTITÉ ACTIVE (après test_login/test_login_anonymous) juste avant chaque appel, avec
-- exactement le même jeu de données jsonb qu'avant, simplement relocalisé. Non SECURITY DEFINER
-- exprès : passent par la même RLS directe (cart_items_insert/carts_insert) qu'un vrai client,
-- preuve en passant que ce chemin fonctionne, pas seulement une commodité de test.
create function test_set_cart(p_lines jsonb) returns void language plpgsql as $$
begin
  delete from public.cart_items where account_id = auth.uid();
  insert into public.cart_items (account_id, product_id, date, end_date, slot_start_time, qty)
  select auth.uid(), (l->>'product_id')::uuid, (l->>'date')::date,
         (l->>'end_date')::date, (l->>'slot_start_time')::time, (l->>'qty')::int
  from jsonb_array_elements(p_lines) as l;
end;
$$;

create function test_set_attribution(p_code text, p_source text default 'link') returns void language plpgsql as $$
begin
  insert into public.carts (account_id, attribution_code, attribution_source)
  values (auth.uid(), p_code, p_source)
  on conflict (account_id) do update
    set attribution_code = excluded.attribution_code, attribution_source = excluded.attribution_source;
end;
$$;

-- Cas 1 : AUCUNE identité du tout, EN PREMIER, avant toute fixture (aucun claim JWT actif). Rôle
-- anon pur — le seul cas de ce fichier qui reste ainsi : c'est exactement le chemin qu'aucune
-- interface réelle ne peut plus emprunter depuis que CartContext crée une identité anonyme au
-- premier ajout au panier (spec 31 invariant 1), mais qu'un appel direct à la RPC (curl, test)
-- peut toujours tenter. RÉVISÉ 2026-09-10 : la garde est réintroduite, ce cas prouve désormais
-- qu'elle est évaluée AVANT empty_cart (l'identité manque, même un panier vide n'est pas atteint).
set local role anon;
select is(
  (select create_order('Nobody',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'not_authenticated',
  'panier vide, rôle anon, aucune identité → not_authenticated, évalué avant empty_cart'
);
reset role;

-- Fixtures : 2 partenaires (A = la plupart des cas, B = second établissement pour le cas positif
-- multi-établissement 12), 1 compte acheteur (aucune capacité requise pour acheter).
insert into partners (id, display_name) values
  ('88880000-0000-4000-8000-000000000001', 'Order Test Partner A'),
  ('88880000-0000-4000-8000-000000000002', 'Order Test Partner B');

insert into establishments (id, partner_id, name) values
  ('88880000-0000-4000-8000-000000000011', '88880000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Order A')),
  ('88880000-0000-4000-8000-000000000012', '88880000-0000-4000-8000-000000000002',
   jsonb_build_object('es', 'Establecimiento Order B'));

insert into auth.users (id, email) values
  ('88880000-0000-4000-8000-000000000021', 'order-buyer@test.local');
-- Pas de partner_id sur partner_accounts pour l'acheteur : c'est un simple client, pas un socio.

-- L'identité de TOUS les cas « invité » ci-dessous (14/15/16), depuis le 2026-09-10 : is_anonymous
-- = true, aucun email — exactement ce que produit signInAnonymously() côté navigateur. Le trigger
-- on_auth_user_created (inchangé, décision ④) lui pose sa ligne partner_accounts comme pour tout
-- compte ; c'est justement ce que le cas 16 s'appuyait sur l'ABSENCE de (cf. son commentaire) et
-- qui est corrigé plus bas.
insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at) values
  ('88880000-0000-4000-8000-000000000099', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', true, now(), now());

-- Produits :
--   031 lodging sellable       → cas 5 (plafond lignes) et 6 (plafond unités)
--   032 activity sellable      → cas 7 (plafond lignes prestation) et 8 (plafond qty individuel)
--   033 activity NON sellable  → cas 4
--   034 activity sellable      → cas 9 (tout-ou-rien)
--   035 activity sellable      → cas 10 (somme inter-lignes même produit+date)
--   036 activity sellable      → cas 11 (marketing_consent)
--   037 activity sellable (établissement A) → cas 12, 1ère ligne
--   038 activity sellable (établissement B, partenaire B) → cas 12, 2ème ligne
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88880000-0000-4000-8000-000000000031', '88880000-0000-4000-8000-000000000001',
   '88880000-0000-4000-8000-000000000011', 'lodging',
   jsonb_build_object('es', 'Alojamiento Order Test'), 100000, true, 'order-test-lodging'),
  ('88880000-0000-4000-8000-000000000032', '88880000-0000-4000-8000-000000000001',
   '88880000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Order Test'), 50000, true, 'order-test-prestation'),
  ('88880000-0000-4000-8000-000000000033', '88880000-0000-4000-8000-000000000001',
   '88880000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad No Vendible'), 50000, false, 'order-test-not-sellable'),
  ('88880000-0000-4000-8000-000000000034', '88880000-0000-4000-8000-000000000001',
   '88880000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Atomicidad'), 50000, true, 'order-test-atomicity'),
  ('88880000-0000-4000-8000-000000000035', '88880000-0000-4000-8000-000000000001',
   '88880000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Suma'), 50000, true, 'order-test-sum'),
  ('88880000-0000-4000-8000-000000000036', '88880000-0000-4000-8000-000000000001',
   '88880000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Consentimiento'), 50000, true, 'order-test-consent'),
  ('88880000-0000-4000-8000-000000000037', '88880000-0000-4000-8000-000000000001',
   '88880000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Multi A'), 50000, true, 'order-test-multi-a'),
  ('88880000-0000-4000-8000-000000000038', '88880000-0000-4000-8000-000000000002',
   '88880000-0000-4000-8000-000000000012', 'activity',
   jsonb_build_object('es', 'Actividad Multi B'), 70000, true, 'order-test-multi-b');

-- Produits 039/040 : cas 13 (fermeture de calendrier). Insérés ici, avant le switch de rôle, pour
-- les mêmes raisons RLS que les produits 031-038 ci-dessus.
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '88880000-0000-4000-8000-000000000039', '88880000-0000-4000-8000-000000000001',
  '88880000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Calendario Defecto Abierto'), 50000, true, 'order-test-calendar-open'
);
insert into products (
  id, partner_id, establishment_id, type, name, price_cop, sellable, slug, calendar_default_open
)
values (
  '88880000-0000-4000-8000-000000000040', '88880000-0000-4000-8000-000000000001',
  '88880000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Calendario Defecto Cerrado'), 50000, true,
  'order-test-calendar-closed', false
);

-- product_availability : uniquement pour les produits/dates qui doivent atteindre la phase 3
-- (la phase 1 — cas 4 à 8 — ne consulte jamais cette table, cf. migration).
insert into product_availability (product_id, date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000034', '2028-04-01', 10, 0),  -- cas 9, ligne valide isolément
  ('88880000-0000-4000-8000-000000000034', '2028-04-02', 5, 5),   -- cas 9, déjà complète
  ('88880000-0000-4000-8000-000000000035', '2028-05-01', 10, 8),  -- cas 10, remaining=2
  ('88880000-0000-4000-8000-000000000036', '2028-06-01', 10, 0),  -- cas 11a (consent=true)
  ('88880000-0000-4000-8000-000000000036', '2028-06-02', 10, 0),  -- cas 11b (consent par défaut)
  ('88880000-0000-4000-8000-000000000037', '2028-07-01', 10, 0),  -- cas 12, ligne 1 (établissement A)
  ('88880000-0000-4000-8000-000000000038', '2028-07-01', 10, 0),  -- cas 12, ligne 2 (établissement B)
  ('88880000-0000-4000-8000-000000000039', '2028-08-01', 5, 0),   -- cas 13a, ligne calendar explicite fermée
  ('88880000-0000-4000-8000-000000000039', '2028-08-02', 5, 0),   -- cas 13b, pas de ligne calendar, défaut ouvert
  ('88880000-0000-4000-8000-000000000040', '2028-08-03', 5, 0);   -- cas 13c, pas de ligne calendar, défaut fermé

insert into product_calendar (product_id, date, open) values
  ('88880000-0000-4000-8000-000000000039', '2028-08-01', false);

-- Cas 14 (correctif réservation invité) : rejoue not_sellable (033)/lodging_cap_exceeded (031)/
-- date_closed (040, calendar_default_open=false) sous anon, à des dates neuves pour ne pas
-- collisionner avec les cas 4/5/13c déjà exécutés sous authenticated — mêmes produits, mêmes
-- garde-fous, seul l'appelant change. Produit 041 dédié au cas positif (succès) et au cas de
-- capacité déjà pleine (tout-ou-rien à 1 ligne).
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '88880000-0000-4000-8000-000000000041', '88880000-0000-4000-8000-000000000001',
  '88880000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Invitado'), 50000, true, 'order-test-guest'
);
insert into product_availability (product_id, date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000041', '2028-09-01', 10, 0),  -- cas 14a, succès invité
  ('88880000-0000-4000-8000-000000000041', '2028-09-02', 1, 1);   -- cas 14e, déjà complète

-- Cas 15 (feature 7 — attribution) : 1 partenaire référent + 3 codes (actif, inactif, "nouveau"
-- pour le remplacement compte enregistré) + 1 produit dédié avec 6 dates (a→f), capacité large
-- partout (l'attribution ne touche jamais le verrouillage product_availability).
insert into partners (id, display_name) values
  ('88880000-0000-4000-8000-000000000005', 'Order Test Referrer Partner');
insert into partner_codes (code, partner_id, active) values
  ('ORDER-TEST-ACTIVE', '88880000-0000-4000-8000-000000000005', true),
  ('ORDER-TEST-INACTIVE', '88880000-0000-4000-8000-000000000005', false),
  ('ORDER-TEST-NEW', '88880000-0000-4000-8000-000000000005', true);
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '88880000-0000-4000-8000-000000000042', '88880000-0000-4000-8000-000000000001',
  '88880000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Atribución'), 50000, true, 'order-test-attribution'
);
insert into product_availability (product_id, date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000042', '2028-10-01', 10, 0),  -- cas 15a, invité sans code
  ('88880000-0000-4000-8000-000000000042', '2028-10-02', 10, 0),  -- cas 15b, invité code valide
  ('88880000-0000-4000-8000-000000000042', '2028-10-03', 10, 0),  -- cas 15c, invité code invalide/inactif
  ('88880000-0000-4000-8000-000000000042', '2028-10-04', 10, 0),  -- cas 15d, compte + code frais
  ('88880000-0000-4000-8000-000000000042', '2028-10-05', 10, 0),  -- cas 15e, compte sans code, saved existant
  ('88880000-0000-4000-8000-000000000042', '2028-10-06', 10, 0);  -- cas 15f, compte + nouveau code (remplace)

-- Cas 16 (feature 11 — snapshot commission) : 1 code supplémentaire ORDER-TEST-SELF, appartenant
-- au partenaire A (001) lui-même — propriétaire du produit 043 ci-dessous — pour le cas
-- self_referral (le référent résolu doit être le PROPRIÉTAIRE DU PRODUIT, pas un partenaire
-- quelconque). ORDER-TEST-ACTIVE (référent 005, déjà posé pour le cas 15) sert de référent externe
-- ici aussi : 005 ≠ 001 (propriétaire de 043) et 005 ≠ 002 (propriétaire de 038, réutilisé au cas
-- 16e), donc bien "externe" dans les deux cas. Produit 043 : prix volontairement NON rond (33333)
-- pour prouver l'arrondi, pas seulement les pourcentages.
insert into partner_codes (code, partner_id, active) values
  ('ORDER-TEST-SELF', '88880000-0000-4000-8000-000000000001', true);
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '88880000-0000-4000-8000-000000000043', '88880000-0000-4000-8000-000000000001',
  '88880000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Comisión'), 33333, true, 'order-test-commission'
);
insert into product_availability (product_id, date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000043', '2028-11-01', 10, 0),  -- cas 16a, direct
  ('88880000-0000-4000-8000-000000000043', '2028-11-02', 10, 0),  -- cas 16b, référent externe
  ('88880000-0000-4000-8000-000000000043', '2028-11-03', 10, 0),  -- cas 16c, auto-référence
  ('88880000-0000-4000-8000-000000000043', '2028-11-04', 10, 0),  -- cas 16d, total non rond (qty=3)
  ('88880000-0000-4000-8000-000000000043', '2028-11-05', 10, 0),  -- cas 16e, ligne 1 (self, produit 043)
  ('88880000-0000-4000-8000-000000000038', '2028-11-05', 10, 0);  -- cas 16e, ligne 2 (external, produit 038)

-- Cas 17 (feature 20 — camp multi-jours) : 2 produits type='camp', duration_days=3, établissement A
-- (011). product_availability porte la capacité PROPRE du camp (participants par départ, une seule
-- ligne à la date de départ) ; provider_resource_calendar porte la ressource PARTAGÉE de
-- l'établissement, une ligne par jour de la plage [date, date+duration_days-1].
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, duration_days)
values
  ('88880000-0000-4000-8000-000000000044', '88880000-0000-4000-8000-000000000001',
   '88880000-0000-4000-8000-000000000011', 'camp',
   jsonb_build_object('es', 'Campamento Éxito'), 90000, true, 'order-test-camp-success', 3),
  ('88880000-0000-4000-8000-000000000045', '88880000-0000-4000-8000-000000000001',
   '88880000-0000-4000-8000-000000000011', 'camp',
   jsonb_build_object('es', 'Campamento Recurso Indisponible'), 90000, true,
   'order-test-camp-unavailable', 3);

-- Produit 055 (lodging) — 2026-09-15, migration 20260915100000_camp_requires_compatible_lodging :
-- un camp de plus d'un jour exige désormais une ligne lodging compatible dans le MÊME panier
-- (cf. cas 23 plus bas). Les camps 044/045 ci-dessus (duration_days=3) sont couverts par CETTE
-- migration : chaque cas 17x ci-dessous ajoute donc une ligne 055 couvrant ses nuits requises,
-- sans quoi l'appel serait désormais rejeté par camp_missing_lodging AVANT d'atteindre ce que ces
-- cas testent réellement (succès/resource_unavailable/not_sellable). 055 n'a aucun rapport
-- fonctionnel avec ces cas : sa seule raison d'être est de satisfaire la nouvelle obligation.
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '88880000-0000-4000-8000-000000000055', '88880000-0000-4000-8000-000000000001',
  '88880000-0000-4000-8000-000000000011', 'lodging',
  jsonb_build_object('es', 'Alojamiento Order Test Camp'), 50000, true, 'order-test-lodging-camp'
);

-- cas 17a : plage 2028-12-10..12 entièrement disponible (capacité propre ET ressource partagée).
insert into product_availability (product_id, date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000044', '2028-12-10', 5, 0),
  ('88880000-0000-4000-8000-000000000055', '2028-12-10', 5, 0),
  ('88880000-0000-4000-8000-000000000055', '2028-12-11', 5, 0);
insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000011', '2028-12-10', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2028-12-11', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2028-12-12', 5, 0);

-- cas 17b : plage 2028-12-20..22, jour central (12-21) déjà plein sur la ressource PARTAGÉE — la
-- capacité PROPRE du camp (product_availability) est, elle, entièrement disponible sur les 3 jours
-- (elle ne porte qu'UNE ligne, à la date de départ) : preuve que resource_unavailable vient bien de
-- provider_resource_calendar, pas d'une confusion avec la capacité propre.
insert into product_availability (product_id, date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000045', '2028-12-20', 5, 0),
  ('88880000-0000-4000-8000-000000000055', '2028-12-20', 5, 0),
  ('88880000-0000-4000-8000-000000000055', '2028-12-21', 5, 0);
insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000011', '2028-12-20', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2028-12-21', 1, 1),  -- déjà plein : booked=capacity=1
  ('88880000-0000-4000-8000-000000000011', '2028-12-22', 5, 0);

-- cas 17c : camp + prestation ordinaire dans le même panier, la prestation échoue (produit 033,
-- déjà fixturé plus haut, sellable=false) — plage 2028-12-15..17 du camp 044 entièrement
-- disponible isolément (nouvelle date de départ, sans rapport avec le cas 17a).
insert into product_availability (product_id, date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000044', '2028-12-15', 5, 0),
  ('88880000-0000-4000-8000-000000000055', '2028-12-15', 5, 0),
  ('88880000-0000-4000-8000-000000000055', '2028-12-16', 5, 0);
insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000011', '2028-12-15', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2028-12-16', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2028-12-17', 5, 0);

set local role authenticated;
select test_login('88880000-0000-4000-8000-000000000021');

-- Cas 2 : panier vide -----------------------------------------------------------------------------
select is(
  (select create_order('Holder Empty',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'empty_cart',
  'aucune ligne cart_items pour ce compte → empty_cart'
);

-- ⚠️ Cas 3 (produit inexistant) RETIRÉ le 2026-09-10 (spec 32) : cart_items.product_id porte une
-- FK vers products (aucun ON DELETE CASCADE) — un product_id inexistant ne peut structurellement
-- plus jamais atteindre create_order, il échoue à l'INSERT dans cart_items avant même l'appel.
-- Le garde-fou product_not_found reste dans create_order (défense en profondeur, inoffensif) mais
-- n'est plus atteignable par ce chemin ; aucun autre chemin connu ne l'atteint non plus (supprimer
-- un produit encore référencé par un panier échouerait lui-même sur la même FK). Pas remplacé par
-- un contournement de la contrainte (rendre la FK deferrable uniquement pour ce test durcirait la
-- suite pour un cas qui ne peut plus se produire) — signalé, pas retesté artificiellement.

-- Cas 4 : produit non vendable (sellable=false) ------------------------------------------------------
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000033', 'date', '2028-01-01', 'qty', 1
)));
select is(
  (select create_order(
     'Holder NotSellable',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'not_sellable',
  'produit sellable=false → not_sellable'
);

-- Cas 5 : plafond lodging, dimension NOMBRE DE LIGNES (13 lignes > 12, unités=13 <= 36, dates
-- fictives puisque la phase 1 ne touche jamais product_availability) — valeurs relevées le
-- 2026-09-07 (cahier §3e), corrigées dans create_order en préparant la spec 32 (§10). Une nuit
-- par ligne (end_date = date + 1) : depuis 20260929112240, un logement sans end_date est refusé
-- (date_range_required) avant d'atteindre les plafonds ------------------------------------------
select test_set_cart((select jsonb_agg(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000031',
  'date', (date '2028-01-01' + (gs || ' days')::interval)::date,
  'end_date', (date '2028-01-01' + (gs + 1 || ' days')::interval)::date,
  'qty', 1
)) from generate_series(0, 12) as gs));
select is(
  (select create_order(
     'Holder LodgingLines',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'lodging_cap_exceeded',
  '13 lignes lodging (>12) mais 13 unités (<=36) → lodging_cap_exceeded par le nombre de lignes'
);

-- Cas 6 : plafond lodging, dimension SOMME DES UNITÉS (2 lignes <= 12, mais 19+19=38 unités > 36 ;
-- 19 reste sous le plafond par ligne coalesce(max_qty, 20)) -------------------------------------
select test_set_cart(jsonb_build_array(
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000031',
    'date', '2028-02-01', 'end_date', '2028-02-02', 'qty', 19),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000031',
    'date', '2028-02-02', 'end_date', '2028-02-03', 'qty', 19)
));
select is(
  (select create_order(
     'Holder LodgingUnits',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'lodging_cap_exceeded',
  '2 lignes lodging (<=12) mais 38 unités (>36) → lodging_cap_exceeded par la somme des unités'
);

-- Cas 7 : plafond prestation, NOMBRE DE LIGNES (41 lignes > 40, qty=1 chacune pour ne pas
-- déclencher le plafond individuel), tableau construit dynamiquement -------------------------------
select test_set_cart((select jsonb_agg(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000032',
  'date', (date '2028-03-01' + (gs || ' days')::interval)::date,
  'qty', 1
)) from generate_series(1, 41) as gs));
select is(
  (select create_order(
     'Holder PrestationLines',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'prestation_cap_exceeded',
  '41 lignes non-lodging (>40), qty=1 chacune → prestation_cap_exceeded'
);

-- Cas 8 : plafond individuel par ligne (qty=21 > 20 sur une seule ligne non-lodging) ---------------
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000032', 'date', '2028-03-01', 'qty', 21
)));
select is(
  (select create_order(
     'Holder QtyCap',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'qty_cap_exceeded',
  'une ligne non-lodging avec qty=21 (>20) → qty_cap_exceeded'
);

-- Cas 9 : tout-ou-rien. Ligne 1 (2028-04-01, capacity=10, booked=0) valide isolément ; ligne 2
-- (2028-04-02, capacity=5, booked=5) déjà complète → échec sur la ligne 2, ET aucune écriture,
-- y compris pour la ligne 1 qui aurait pourtant réussi seule ---------------------------------------
select test_set_cart(jsonb_build_array(
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000034', 'date', '2028-04-01', 'qty', 3),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000034', 'date', '2028-04-02', 'qty', 1)
));
select is(
  (select create_order(
     'Holder Atomicity',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'full',
  'ligne 2 sur une date déjà complète (booked=capacity=5) → full'
);
select is(
  (select count(*) from orders where holder_name = 'Holder Atomicity')::int,
  0,
  'tout-ou-rien : aucune commande créée malgré la ligne 1 valide isolément'
);
reset role;
select is(
  (select count(*) from order_lines where product_id = '88880000-0000-4000-8000-000000000034')::int,
  0,
  'tout-ou-rien : aucune order_line créée, ni pour la ligne 1 ni pour la ligne 2'
);
set local role authenticated;
select is(
  (select booked from product_availability
    where product_id = '88880000-0000-4000-8000-000000000034' and date = '2028-04-01'),
  0,
  'tout-ou-rien : booked de la date 1 (valide isolément) inchangé'
);
select is(
  (select booked from product_availability
    where product_id = '88880000-0000-4000-8000-000000000034' and date = '2028-04-02'),
  5,
  'tout-ou-rien : booked de la date 2 (déjà complète) inchangé'
);

-- Cas 10 : somme inter-lignes sur le même produit+date. capacity=10, booked=8 (remaining=2) ;
-- qty=1 puis qty=2 individuellement acceptables, mais la somme demandée=3 > remaining=2 -----------
select test_set_cart(jsonb_build_array(
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000035', 'date', '2028-05-01', 'qty', 1),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000035', 'date', '2028-05-01', 'qty', 2)
));
select is(
  (select create_order(
     'Holder Sum',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'full',
  '2 lignes même produit+date, qty individuellement ok mais somme=3 > remaining=2 → full'
);
select is(
  (select count(*) from orders where holder_name = 'Holder Sum')::int,
  0,
  'somme inter-lignes : aucune commande créée'
);
reset role;
select is(
  (select count(*) from order_lines where product_id = '88880000-0000-4000-8000-000000000035')::int,
  0,
  'somme inter-lignes : aucune order_line créée'
);
set local role authenticated;
select is(
  (select booked from product_availability
    where product_id = '88880000-0000-4000-8000-000000000035' and date = '2028-05-01'),
  8,
  'somme inter-lignes : booked inchangé (toujours 8)'
);

-- Cas 11 : p_marketing_consent. Panier valide à une ligne, une fois avec true explicite, une fois
-- sans passer le paramètre du tout (défaut false) — ne bloque jamais la commande. Table temporaire
-- obligatoire ici : une sous-requête corrélée ne verrait pas l'order_id que create_order vient
-- d'écrire dans la MÊME transaction si on rappelait la fonction une seconde fois dans la sous-
-- requête — on capture donc le résultat une seule fois par appel. -----------------------------------
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000036', 'date', '2028-06-01', 'qty', 1
)));
create temp table tmp_mc_true as
  select create_order(
    'Holder MC True', 'buyer-fixture@hifago.test', null, true
   ) as result;

select is(
  (select result->>'ok' from tmp_mc_true),
  'true',
  'p_marketing_consent=true explicite : la commande réussit'
);
select is(
  (select marketing_consent from orders where id = (select (result->>'order_id')::uuid from tmp_mc_true)),
  true,
  'p_marketing_consent=true explicite : orders.marketing_consent = true'
);
drop table tmp_mc_true;

select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000036', 'date', '2028-06-02', 'qty', 1
)));
create temp table tmp_mc_default as
  select create_order(
    'Holder MC Default',
     p_holder_email => 'buyer-fixture@hifago.test'
   ) as result;

select is(
  (select result->>'ok' from tmp_mc_default),
  'true',
  'p_marketing_consent omis : la commande réussit quand même'
);
select is(
  (select marketing_consent from orders where id = (select (result->>'order_id')::uuid from tmp_mc_default)),
  false,
  'p_marketing_consent omis : orders.marketing_consent retombe sur le défaut false'
);
drop table tmp_mc_default;

-- Cas 12 : succès de référence, 2 lignes valides sur 2 produits de 2 établissements/partenaires
-- différents → une seule commande, exactement 2 order_lines, les 2 compteurs booked incrémentés du
-- bon montant. Même pattern table temporaire : on capture le résultat une seule fois. --------------
select test_set_cart(jsonb_build_array(
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000037', 'date', '2028-07-01', 'qty', 2),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000038', 'date', '2028-07-01', 'qty', 3)
));
create temp table tmp_multi as
  select create_order(
    'Holder Multi', 'buyer-fixture@hifago.test', null, true
   ) as result;

select is(
  (select result->>'ok' from tmp_multi),
  'true',
  'panier de 2 lignes sur 2 établissements différents → succès'
);
select is(
  (select count(*) from orders where id = (select (result->>'order_id')::uuid from tmp_multi))::int,
  1,
  'une seule ligne dans orders pour cette commande'
);
reset role;
select is(
  (select count(*) from order_lines
    where order_id = (select (result->>'order_id')::uuid from tmp_multi))::int,
  2,
  'exactement 2 lignes dans order_lines'
);
set local role authenticated;
select is(
  (select booked from product_availability
    where product_id = '88880000-0000-4000-8000-000000000037' and date = '2028-07-01'),
  2,
  'booked du produit de l''établissement A incrémenté de 2 (qty de la ligne 1)'
);
select is(
  (select booked from product_availability
    where product_id = '88880000-0000-4000-8000-000000000038' and date = '2028-07-01'),
  3,
  'booked du produit de l''établissement B incrémenté de 3 (qty de la ligne 2)'
);
drop table tmp_multi;

-- Cas 13 : fermeture de calendrier (product_calendar.open / products.calendar_default_open),
-- lue en phase 3 APRÈS le verrou — même logique que l'ancienne reserve_order_line, désormais
-- portée par create_order (cf. product_availability_rpc.test.sql, où les 3 cas équivalents ont
-- été retirés lors du remplacement de reserve_order_line par create_order dans cette feature).
-- Fixtures (produits 039/040, leur product_availability et la ligne product_calendar) posées plus
-- haut, avant le switch de rôle authenticated (mêmes contraintes RLS que les produits 031-038). --

-- Cas 13a : date fermée explicitement (product_calendar.open=false) → date_closed, rien écrit.
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000039', 'date', '2028-08-01', 'qty', 1
)));
select is(
  (select create_order(
     'Holder CalendarClosedExplicit',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'date_closed',
  'product_calendar.open=false explicite → date_closed'
);
select is(
  (select booked from product_availability
    where product_id = '88880000-0000-4000-8000-000000000039' and date = '2028-08-01'),
  0,
  'cas 13a : booked inchangé après un refus date_closed'
);

-- Cas 13b : pas de ligne product_calendar, calendar_default_open=true (défaut) → succès normal.
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000039', 'date', '2028-08-02', 'qty', 1
)));
select is(
  (select (create_order(
     'Holder CalendarOpenDefault',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'ok')::boolean),
  true,
  'aucune ligne product_calendar, calendar_default_open=true (défaut) → aucune régression'
);
select is(
  (select booked from product_availability
    where product_id = '88880000-0000-4000-8000-000000000039' and date = '2028-08-02'),
  1,
  'cas 13b : booked incrémenté normalement quand le calendrier est ouvert par défaut'
);

-- Cas 13c : pas de ligne product_calendar, calendar_default_open=false (défaut produit) → date_closed.
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000040', 'date', '2028-08-03', 'qty', 1
)));
select is(
  (select create_order(
     'Holder CalendarClosedDefault',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'date_closed',
  'aucune ligne product_calendar, calendar_default_open=false (défaut produit) → date_closed'
);
select is(
  (select booked from product_availability
    where product_id = '88880000-0000-4000-8000-000000000040' and date = '2028-08-03'),
  0,
  'cas 13c : booked inchangé après un refus date_closed (défaut produit)'
);

-- Cas 14 (correctif réservation invité) : create_order ouvert à anon (aucune session), mêmes
-- garde-fous qu'un appel authentifié — rejoue not_sellable/lodging_cap_exceeded/date_closed/full
-- sous anon, plus le cas positif (succès, account_id null des deux côtés). test_logout()
-- obligatoire avant chaque bloc invité (RÉVISÉ 2026-09-10 : test_login_anonymous plutôt que
-- set local role anon — cf. entête du fichier) : test_login('...021') a tourné plus haut
-- (cas 2) et reste actif pour toute la transaction sinon (set_config(..., true) = portée
-- transaction, pas statement).

-- Cas 14a : invité (identité anonyme), panier valide 1 ligne → succès, account_id = l'identité
-- anonyme des deux côtés (RÉVISÉ 2026-09-10 : plus null, cf. entête), booked incrémenté.
set local role authenticated;
select test_login_anonymous('88880000-0000-4000-8000-000000000099');
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000041', 'date', '2028-09-01', 'qty', 2
)));
select create_order(
  'Holder Guest Success',
     p_holder_email => 'buyer-fixture@hifago.test'
   );
reset role;
select is(
  (select account_id from orders where holder_name = 'Holder Guest Success'),
  '88880000-0000-4000-8000-000000000099'::uuid,
  'cas 14a : invité → orders.account_id = l''identité anonyme (plus jamais null)'
);
select is(
  (select ol.account_id from order_lines ol join orders o on o.id = ol.order_id
    where o.holder_name = 'Holder Guest Success'),
  '88880000-0000-4000-8000-000000000099'::uuid,
  'cas 14a : invité → order_lines.account_id = l''identité anonyme (plus jamais null)'
);
select is(
  (select booked from product_availability
    where product_id = '88880000-0000-4000-8000-000000000041' and date = '2028-09-01'),
  2,
  'cas 14a : invité → booked incrémenté normalement (même écriture qu''un appel authentifié)'
);

-- Cas 14b : invité, produit non vendable → not_sellable (même garde-fou que le cas 4).
set local role authenticated;
select test_login_anonymous('88880000-0000-4000-8000-000000000099');
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000033', 'date', '2028-09-05', 'qty', 1
)));
select is(
  (select create_order(
     'Holder Guest NotSellable',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'not_sellable',
  'cas 14b : invité, sellable=false → not_sellable (aucune régression du garde-fou)'
);
reset role;

-- Cas 14c : invité, plafond lodging → lodging_cap_exceeded (même garde-fou que le cas 5, même
-- forme de ligne : une nuit par ligne).
set local role authenticated;
select test_login_anonymous('88880000-0000-4000-8000-000000000099');
select test_set_cart((select jsonb_agg(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000031',
  'date', (date '2028-09-10' + (gs || ' days')::interval)::date,
  'end_date', (date '2028-09-10' + (gs + 1 || ' days')::interval)::date,
  'qty', 1
)) from generate_series(0, 12) as gs));
select is(
  (select create_order(
     'Holder Guest LodgingCap',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'lodging_cap_exceeded',
  'cas 14c : invité, 13 lignes lodging (>12) → lodging_cap_exceeded (aucune régression du garde-fou)'
);
reset role;

-- Cas 14d : invité, date fermée par défaut produit → date_closed (même garde-fou que le cas 13c).
set local role authenticated;
select test_login_anonymous('88880000-0000-4000-8000-000000000099');
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000040', 'date', '2028-09-15', 'qty', 1
)));
select is(
  (select create_order(
     'Holder Guest CalendarClosed',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'date_closed',
  'cas 14d : invité, calendar_default_open=false → date_closed (aucune régression du garde-fou)'
);
reset role;

-- Cas 14e : invité, ressource déjà pleine → full, rien écrit (même garde-fou que le cas 9).
set local role authenticated;
select test_login_anonymous('88880000-0000-4000-8000-000000000099');
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000041', 'date', '2028-09-02', 'qty', 1
)));
select is(
  (select create_order(
     'Holder Guest Full',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'full',
  'cas 14e : invité, capacity=booked=1 → full (aucune régression du garde-fou)'
);
reset role;
select is(
  (select booked from product_availability
    where product_id = '88880000-0000-4000-8000-000000000041' and date = '2028-09-02'),
  1,
  'cas 14e : invité, échec full → booked inchangé'
);

-- Cas 15 (feature 7 — attribution) : résolution code présenté > code sauvegardé du compte > direct.
-- Ne touche jamais le verrouillage product_availability (capacité large partout ci-dessus) —
-- aucun nouveau test de concurrence, cf. plan.

-- Cas 15a : invité sans code → commande directe, les 3 colonnes null.
set local role authenticated;
select test_login_anonymous('88880000-0000-4000-8000-000000000099');
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000042', 'date', '2028-10-01', 'qty', 1
)));
select create_order(
  'Holder Attrib Guest NoCode',
     p_holder_email => 'buyer-fixture@hifago.test'
   );
reset role;
select is(
  (select jsonb_build_object(
     'referrer_partner_id', referrer_partner_id,
     'attribution_code', attribution_code,
     'attribution_source', attribution_source
   ) from orders where holder_name = 'Holder Attrib Guest NoCode'),
  jsonb_build_object('referrer_partner_id', null, 'attribution_code', null, 'attribution_source', null),
  'cas 15a : invité sans code → commande directe (3 colonnes null)'
);

-- Cas 15b : invité, ?ref= valide → referrer_partner_id résolu, attribution_source='link'.
set local role authenticated;
select test_login_anonymous('88880000-0000-4000-8000-000000000099');
select test_set_attribution('ORDER-TEST-ACTIVE', 'link');
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000042', 'date', '2028-10-02', 'qty', 1
)));
select create_order(
  'Holder Attrib Guest Link', 'buyer-fixture@hifago.test', null, false
   );
reset role;
select is(
  (select jsonb_build_object(
     'referrer_partner_id', referrer_partner_id,
     'attribution_code', attribution_code,
     'attribution_source', attribution_source
   ) from orders where holder_name = 'Holder Attrib Guest Link'),
  jsonb_build_object(
    'referrer_partner_id', '88880000-0000-4000-8000-000000000005',
    'attribution_code', 'ORDER-TEST-ACTIVE',
    'attribution_source', 'link'
  ),
  'cas 15b : invité, code valide via ?ref= → attribution résolue, source=link'
);

-- Cas 15b bis (spec 31 invariant 3, ajouté 2026-09-10) : c'est PRÉCISÉMENT le cas où l'ancien code
-- aurait persisté saved_attribution_code — un compte, un code frais valide présenté (même forme
-- que le cas 15d ci-dessous, qui EST censé persister pour un compte enregistré). Seule l'exclusion
-- explicite d'is_anonymous_session() dans create_order fait la différence. Sans elle, ce test
-- resterait vert pour la mauvaise raison (une identité anonyme dépourvue de la colonne aurait aussi
-- affiché null ici avant le 2026-09-10) — ce n'est plus le cas depuis que la ligne partner_accounts
-- de tout anonyme existe (décision ④).
select is(
  (select saved_attribution_code from partner_accounts
    where id = '88880000-0000-4000-8000-000000000099'),
  null,
  'cas 15b bis : identité anonyme, code présenté → saved_attribution_code JAMAIS persisté (invariant 3)'
);

-- Cas 15c : invité, code invalide/inactif → commande créée normalement, attribution null (jamais
-- un blocage).
set local role authenticated;
select test_login_anonymous('88880000-0000-4000-8000-000000000099');
select test_set_attribution('ORDER-TEST-INACTIVE', 'link');
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000042', 'date', '2028-10-03', 'qty', 1
)));
select create_order(
  'Holder Attrib Guest Invalid', 'buyer-fixture@hifago.test', null, false
   );
reset role;
select is(
  (select jsonb_build_object(
     'referrer_partner_id', referrer_partner_id,
     'attribution_code', attribution_code,
     'attribution_source', attribution_source
   ) from orders where holder_name = 'Holder Attrib Guest Invalid'),
  jsonb_build_object('referrer_partner_id', null, 'attribution_code', null, 'attribution_source', null),
  'cas 15c : invité, code inactif → commande créée normalement, attribution null (jamais un blocage)'
);

-- Cas 15d/e/f : compte enregistré (buyer 021), enchaînés intentionnellement pour prouver la
-- séquence complète « code frais → lu depuis le compte sans nouveau code → nouveau code remplace
-- l'ancien » sur le même compte, chacun s'appuyant sur l'état laissé par le précédent.
set local role authenticated;
select test_login('88880000-0000-4000-8000-000000000021');

-- Cas 15d : compte enregistré, code frais valide → attribution résolue ET saved_attribution_code
-- mis à jour (aucune valeur sauvegardée avant ce test pour ce compte).
select test_set_attribution('ORDER-TEST-ACTIVE', 'link');
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000042', 'date', '2028-10-04', 'qty', 1
)));
select create_order(
  'Holder Attrib Account Fresh', 'buyer-fixture@hifago.test', null, false
   );
select is(
  (select jsonb_build_object(
     'referrer_partner_id', referrer_partner_id,
     'attribution_code', attribution_code,
     'attribution_source', attribution_source
   ) from orders where holder_name = 'Holder Attrib Account Fresh'),
  jsonb_build_object(
    'referrer_partner_id', '88880000-0000-4000-8000-000000000005',
    'attribution_code', 'ORDER-TEST-ACTIVE',
    'attribution_source', 'link'
  ),
  'cas 15d : compte enregistré, code frais valide → attribution résolue'
);
select is(
  (select saved_attribution_code from partner_accounts
    where id = '88880000-0000-4000-8000-000000000021'),
  'ORDER-TEST-ACTIVE',
  'cas 15d : saved_attribution_code mis à jour avec le code frais présenté'
);

-- Cas 15e : même compte, AUCUN code présenté cette session → résolution depuis
-- saved_attribution_code (posé par 15d), attribution_source='account'.
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000042', 'date', '2028-10-05', 'qty', 1
)));
select create_order(
  'Holder Attrib Account Saved',
     p_holder_email => 'buyer-fixture@hifago.test'
   );
select is(
  (select jsonb_build_object(
     'referrer_partner_id', referrer_partner_id,
     'attribution_code', attribution_code,
     'attribution_source', attribution_source
   ) from orders where holder_name = 'Holder Attrib Account Saved'),
  jsonb_build_object(
    'referrer_partner_id', '88880000-0000-4000-8000-000000000005',
    'attribution_code', 'ORDER-TEST-ACTIVE',
    'attribution_source', 'account'
  ),
  'cas 15e : compte enregistré, aucun code présenté → résolution depuis saved_attribution_code, source=account'
);
select is(
  (select saved_attribution_code from partner_accounts
    where id = '88880000-0000-4000-8000-000000000021'),
  'ORDER-TEST-ACTIVE',
  'cas 15e : saved_attribution_code inchangé (aucun code présenté cette session)'
);

-- Cas 15f : même compte, présente un NOUVEAU code différent du sauvegardé → le nouveau prime,
-- saved_attribution_code remplacé (pas cumulé, pas ignoré).
select test_set_attribution('ORDER-TEST-NEW', 'link');
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000042', 'date', '2028-10-06', 'qty', 1
)));
select create_order(
  'Holder Attrib Account Replace', 'buyer-fixture@hifago.test', null, false
   );
select is(
  (select jsonb_build_object(
     'referrer_partner_id', referrer_partner_id,
     'attribution_code', attribution_code,
     'attribution_source', attribution_source
   ) from orders where holder_name = 'Holder Attrib Account Replace'),
  jsonb_build_object(
    'referrer_partner_id', '88880000-0000-4000-8000-000000000005',
    'attribution_code', 'ORDER-TEST-NEW',
    'attribution_source', 'link'
  ),
  'cas 15f : compte enregistré, nouveau code présenté → le nouveau prime'
);
select is(
  (select saved_attribution_code from partner_accounts
    where id = '88880000-0000-4000-8000-000000000021'),
  'ORDER-TEST-NEW',
  'cas 15f : saved_attribution_code remplacé (pas cumulé, pas ignoré)'
);

-- Cas 16 (feature 11 — snapshot commission) : identité anonyme (099) délibérément, PAS le compte
-- 021 encore actif ci-dessus — 021 porte désormais saved_attribution_code='ORDER-TEST-NEW' (cas
-- 15f), qui réapparaîtrait silencieusement sur tout appel 16a/16d omettant un code explicite
-- (résolution « code sauvegardé du compte », feature 7) et fausserait le cas "direct" attendu.
--
-- ⚠️ RAISON RÉVISÉE le 2026-09-10 (spec 31) — l'ancienne (« anon n'a pas de ligne
-- partner_accounts ») est devenue FAUSSE : depuis la décision ④, TOUTE identité anonyme en a une
-- (trigger on_auth_user_created inchangé). L'isolation tient désormais à DEUX choses : 099 est une
-- identité distincte de 021 (aucune collision par construction), ET son propre
-- saved_attribution_code est garanti null à ce point — pas parce qu'aucun code n'y a jamais été
-- présenté (15b EN présente un), mais parce qu'invariant 3 (is_anonymous_session() exclue de la
-- persistance) l'a empêché d'y entrer, prouvé par le cas 15b bis juste au-dessus.
--
-- Tous les create_order ci-dessous s'exécutent D'ABORD ; reset role vient APRÈS, une seule fois,
-- avant TOUTE lecture — pattern conservé du cas 14a, simplement batché sur 5 créations plutôt
-- qu'une seule (⚠️ sa justification RLS d'origine — « anon ne peut jamais relire sa propre ligne,
-- account_id = auth.uid() vaut NULL = NULL » — ne tient plus non plus : l'identité anonyme a
-- désormais un account_id réel, donc orders_select la laisserait potentiellement se relire. Le
-- `reset role` reste néanmoins correct et suffisant, juste plus l'unique voie possible). Chaque
-- assertion compare TOUTES les colonnes du snapshot en un seul jsonb — pct castés en text
-- (numeric(5,4) stocke le texte à l'échelle déclarée, ex. '0.1700', sans ambiguïté de
-- représentation JSON contrairement à un cast float).
set local role authenticated;
select test_login_anonymous('88880000-0000-4000-8000-000000000099');

-- Cas 16a : direct (aucun code) → commission_case='direct', 17/0/17, price_cop=33333 (non rond).
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000043', 'date', '2028-11-01', 'qty', 1
)));
select create_order(
  'Holder Commission Direct',
     p_holder_email => 'buyer-fixture@hifago.test'
   );

-- Cas 16b : référent externe (ORDER-TEST-ACTIVE → partenaire 005, ≠ propriétaire 001 du produit
-- 043) → external_referrer, 17/10/7.
select test_set_attribution('ORDER-TEST-ACTIVE', 'link');
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000043', 'date', '2028-11-02', 'qty', 1
)));
select create_order(
  'Holder Commission External', 'buyer-fixture@hifago.test', null, false
   );

-- Cas 16c : auto-référence (ORDER-TEST-SELF → partenaire 001, PROPRIÉTAIRE du produit 043) →
-- self_referral, 7/0/7.
select test_set_attribution('ORDER-TEST-SELF', 'link');
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000043', 'date', '2028-11-03', 'qty', 1
)));
select create_order(
  'Holder Commission Self', 'buyer-fixture@hifago.test', null, false
   );

-- Cas 16d : total non rond via qty=3 (33333*3=99999) → prouve total_cop=price_cop*qty ET l'arrondi
-- sur un montant plus grand (16999.83 → 17000), pas seulement les pourcentages du cas 16a.
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000043', 'date', '2028-11-04', 'qty', 3
)));
select create_order(
  'Holder Commission NonRound',
     p_holder_email => 'buyer-fixture@hifago.test'
   );

-- Cas 16e : panier multi-lignes, MÊME référent résolu (ORDER-TEST-SELF → 001) mais 2 propriétaires
-- différents → chaque ligne porte son propre commission_case, indépendamment de l'autre. Ligne 1 =
-- produit 043 (propriétaire 001 = référent) → self_referral. Ligne 2 = produit 038 (propriétaire
-- 002 ≠ référent 001) → external_referrer. Même commande, même référent, deux cas différents.
-- Table temporaire créée MAINTENANT (encore sous l'identité anonyme) pour capturer l'order_id retourné, mais lue plus
-- bas seulement, après reset role.
select test_set_attribution('ORDER-TEST-SELF', 'link');
select test_set_cart(jsonb_build_array(
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000043', 'date', '2028-11-05', 'qty', 1),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000038', 'date', '2028-11-05', 'qty', 1)
));
create temp table tmp_commission_multi as
  select create_order(
    'Holder Commission Multi', 'buyer-fixture@hifago.test', null, false
   ) as result;

reset role;

select is(
  (select jsonb_build_object(
     'commission_case', commission_case, 'price_cop', price_cop, 'total_cop', total_cop,
     'acompte_pct', acompte_pct::text, 'referrer_pct', referrer_pct::text, 'app_pct', app_pct::text,
     'acompte_cop', acompte_cop, 'referrer_commission_cop', referrer_commission_cop,
     'app_commission_cop', app_commission_cop
   ) from order_lines where product_id = '88880000-0000-4000-8000-000000000043' and date = '2028-11-01'),
  jsonb_build_object(
    'commission_case', 'direct', 'price_cop', 33333, 'total_cop', 33333,
    'acompte_pct', '0.1700', 'referrer_pct', '0.0000', 'app_pct', '0.1700',
    'acompte_cop', 5667, 'referrer_commission_cop', 0, 'app_commission_cop', 5667
  ),
  'cas 16a : direct → commission_case=direct, 17/0/17, montants arrondis corrects'
);
select is(
  (select jsonb_build_object(
     'commission_case', commission_case, 'price_cop', price_cop, 'total_cop', total_cop,
     'acompte_pct', acompte_pct::text, 'referrer_pct', referrer_pct::text, 'app_pct', app_pct::text,
     'acompte_cop', acompte_cop, 'referrer_commission_cop', referrer_commission_cop,
     'app_commission_cop', app_commission_cop
   ) from order_lines where product_id = '88880000-0000-4000-8000-000000000043' and date = '2028-11-02'),
  jsonb_build_object(
    'commission_case', 'external_referrer', 'price_cop', 33333, 'total_cop', 33333,
    'acompte_pct', '0.1700', 'referrer_pct', '0.1000', 'app_pct', '0.0700',
    'acompte_cop', 5667, 'referrer_commission_cop', 3333, 'app_commission_cop', 2333
  ),
  'cas 16b : référent externe → commission_case=external_referrer, 17/10/7, montants arrondis corrects'
);

-- Spec 19 §0 Tranche 0 : ledger_entries créée pour 16b (external_referrer), montant = referrer_
-- commission_cop (3333), status initial 'estimated', beneficiary_type='referrer'.
select is(
  (select jsonb_build_object(
     'beneficiary_type', beneficiary_type, 'referrer_partner_id', referrer_partner_id,
     'establishment_id', establishment_id, 'entry_type', entry_type,
     'amount_cop', amount_cop, 'status', status
   ) from ledger_entries where order_line_id = (
     select id from order_lines
      where product_id = '88880000-0000-4000-8000-000000000043' and date = '2028-11-02'
   )),
  jsonb_build_object(
    'beneficiary_type', 'referrer', 'referrer_partner_id', '88880000-0000-4000-8000-000000000005',
    'establishment_id', null, 'entry_type', 'referral_earned', 'amount_cop', 3333, 'status', 'estimated'
  ),
  'cas 16b (spec 19) : ledger_entries initiale créée, referrer/estimated, amount_cop=referrer_commission_cop'
);
select is(
  (select count(*)::int from ledger_entries where order_line_id = (
     select id from order_lines
      where product_id = '88880000-0000-4000-8000-000000000043' and date = '2028-11-01'
   )),
  0,
  'cas 16a (spec 19) : direct → aucune ledger_entries (rien dû à personne)'
);
select is(
  (select jsonb_build_object(
     'commission_case', commission_case, 'price_cop', price_cop, 'total_cop', total_cop,
     'acompte_pct', acompte_pct::text, 'referrer_pct', referrer_pct::text, 'app_pct', app_pct::text,
     'acompte_cop', acompte_cop, 'referrer_commission_cop', referrer_commission_cop,
     'app_commission_cop', app_commission_cop
   ) from order_lines where product_id = '88880000-0000-4000-8000-000000000043' and date = '2028-11-03'),
  jsonb_build_object(
    'commission_case', 'self_referral', 'price_cop', 33333, 'total_cop', 33333,
    'acompte_pct', '0.0700', 'referrer_pct', '0.0000', 'app_pct', '0.0700',
    'acompte_cop', 2333, 'referrer_commission_cop', 0, 'app_commission_cop', 2333
  ),
  'cas 16c : auto-référence (référent = propriétaire du produit) → commission_case=self_referral, 7/0/7'
);
select is(
  (select count(*)::int from ledger_entries where order_line_id = (
     select id from order_lines
      where product_id = '88880000-0000-4000-8000-000000000043' and date = '2028-11-03'
   )),
  0,
  'cas 16c (spec 19) : self_referral → aucune ledger_entries (rien dû à personne)'
);
select is(
  (select jsonb_build_object(
     'price_cop', price_cop, 'total_cop', total_cop,
     'acompte_cop', acompte_cop, 'app_commission_cop', app_commission_cop
   ) from order_lines where product_id = '88880000-0000-4000-8000-000000000043' and date = '2028-11-04'),
  jsonb_build_object(
    'price_cop', 33333, 'total_cop', 99999, 'acompte_cop', 17000, 'app_commission_cop', 17000
  ),
  'cas 16d : qty=3, total_cop=99999 (non rond) → arrondi correct (16999.83 → 17000)'
);
select is(
  (select commission_case from order_lines
    where order_id = (select (result->>'order_id')::uuid from tmp_commission_multi)
      and product_id = '88880000-0000-4000-8000-000000000043'),
  'self_referral',
  'cas 16e : ligne 1 (propriétaire = référent) → self_referral'
);
select is(
  (select commission_case from order_lines
    where order_id = (select (result->>'order_id')::uuid from tmp_commission_multi)
      and product_id = '88880000-0000-4000-8000-000000000038'),
  'external_referrer',
  'cas 16e : ligne 2 (propriétaire ≠ référent, même commande) → external_referrer, indépendamment de la ligne 1'
);
drop table tmp_commission_multi;

-- Cas 16f : modifier products.price_cop après coup (feature 3) ne change JAMAIS
-- order_lines.price_cop d'une ligne déjà créée — preuve du snapshot, pas une jointure vivante.
-- Exécuté en dernier : mute le prix du produit 043, utilisé par les cas 16a-d ci-dessus. Rôle déjà
-- réinitialisé (reset role plus haut) : products est RLS-directe admin en écriture
-- (products_write_admin), anon ne pourrait pas modifier cette ligne — un échec silencieux (0 ligne
-- affectée par RLS) ferait passer ce test pour une mauvaise raison (rien n'aurait vraiment changé).
update products set price_cop = 999999 where id = '88880000-0000-4000-8000-000000000043';
select is(
  (select price_cop from order_lines
    where product_id = '88880000-0000-4000-8000-000000000043' and date = '2028-11-01'),
  33333::bigint,
  'cas 16f : price_cop de la ligne 16a reste 33333 malgré products.price_cop modifié après coup à 999999'
);

-- Cas 17 (feature 20 — camp multi-jours). Rôle réinitialisé par le cas 16f ci-dessus (privilégié,
-- post reset role) : repasse explicitement en authenticated, acheteur 021 comme la majorité de ce
-- fichier — l'attribution/le référent ne sont pas le sujet ici, aucun code présenté.
set local role authenticated;
select test_login('88880000-0000-4000-8000-000000000021');

-- Cas 17a : plage entièrement disponible → succès, booked incrémenté sur CHAQUE jour de la plage
-- (pas seulement la date de départ), un availability_blocks créé avec la bonne plage. Ligne 055
-- (lodging, 2026-09-15) ajoutée pour satisfaire camp_missing_lodging — sans rapport avec le sujet
-- de ce cas, cf. commentaire à sa fixture.
select test_set_cart(jsonb_build_array(
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000044', 'date', '2028-12-10', 'qty', 2),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000055',
    'date', '2028-12-10', 'end_date', '2028-12-12', 'qty', 1)
));
create temp table tmp_camp_success as
  select create_order(
    'Holder Camp Success',
     p_holder_email => 'buyer-fixture@hifago.test'
   ) as result;

select is(
  (select result->>'ok' from tmp_camp_success),
  'true',
  'cas 17a : plage entièrement disponible → succès'
);
select is(
  (select booked from product_availability
    where product_id = '88880000-0000-4000-8000-000000000044' and date = '2028-12-10'),
  2,
  'cas 17a : capacité PROPRE du camp (product_availability) incrémentée de qty=2'
);
select is(
  (select jsonb_agg(booked order by slot_date) from provider_resource_calendar
    where establishment_id = '88880000-0000-4000-8000-000000000011'
      and slot_date between '2028-12-10' and '2028-12-12'),
  jsonb_build_array(2, 2, 2),
  'cas 17a : booked incrémenté de qty=2 sur les 3 jours de la plage (ressource PARTAGÉE)'
);
-- availability_blocks_select_admin restreint la lecture à is_admin() (« voir la cause du blocage »,
-- admin seul) — l'acheteur 021 n'est pas admin, reset role le temps de cette seule vérification
-- (contexte privilégié pré-switch, comme les fixtures), authenticated repris juste après pour le
-- reste du fichier (claims déjà posés par test_login, persistants pour la transaction).
reset role;
select is(
  (select jsonb_build_object('start_date', start_date, 'end_date', end_date, 'count', 1)
     from availability_blocks
    where establishment_id = '88880000-0000-4000-8000-000000000011'
      and start_date = '2028-12-10'),
  jsonb_build_object('start_date', '2028-12-10', 'end_date', '2028-12-12', 'count', 1),
  'cas 17a : un availability_blocks créé, start/end = la plage exacte du camp'
);
set local role authenticated;
drop table tmp_camp_success;

-- Cas 17b : un seul jour indisponible sur la ressource PARTAGÉE (12-21, déjà pleine) →
-- resource_unavailable, AUCUNE écriture — y compris sur les jours par ailleurs disponibles de la
-- même plage et sur la capacité PROPRE du camp (product_availability), qui elle est entièrement
-- disponible isolément.
-- Ligne 055 (lodging, 2026-09-15) ajoutée pour satisfaire camp_missing_lodging — sans elle, cet
-- appel serait désormais rejeté avant même d'atteindre la vérification de ressource partagée.
select test_set_cart(jsonb_build_array(
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000045', 'date', '2028-12-20', 'qty', 1),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000055',
    'date', '2028-12-20', 'end_date', '2028-12-22', 'qty', 1)
));
select is(
  (select create_order(
     'Holder Camp Unavailable',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'resource_unavailable',
  'cas 17b : un jour indisponible sur la plage → resource_unavailable'
);
select is(
  (select count(*) from orders where holder_name = 'Holder Camp Unavailable')::int,
  0,
  'cas 17b : aucune commande créée'
);
select is(
  (select jsonb_agg(booked order by slot_date) from provider_resource_calendar
    where establishment_id = '88880000-0000-4000-8000-000000000011'
      and slot_date between '2028-12-20' and '2028-12-22'),
  jsonb_build_array(0, 1, 0),
  'cas 17b : booked inchangé sur les 3 jours (y compris le 12-20 et le 12-22, par ailleurs disponibles)'
);
select is(
  (select booked from product_availability
    where product_id = '88880000-0000-4000-8000-000000000045' and date = '2028-12-20'),
  0,
  'cas 17b : capacité PROPRE du camp inchangée aussi (elle était pourtant disponible isolément)'
);

-- Cas 17c : camp (plage entièrement disponible) + prestation ordinaire qui échoue (produit 033,
-- sellable=false) dans le MÊME panier → aucune écriture, y compris sur la ressource partagée du
-- camp qui aurait pourtant réussi seule (même invariant tout-ou-rien que la feature 6, étendu à
-- deux types de ressources dans le même panier).
-- Ligne 055 (lodging, 2026-09-15) ajoutée pour satisfaire camp_missing_lodging — sans elle, cet
-- appel serait désormais rejeté avant même d'atteindre la prestation not_sellable testée ici.
select test_set_cart(jsonb_build_array(
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000044', 'date', '2028-12-15', 'qty', 1),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000033', 'date', '2028-12-15', 'qty', 1),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000055',
    'date', '2028-12-15', 'end_date', '2028-12-17', 'qty', 1)
));
select is(
  (select create_order(
     'Holder Camp Combo',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'not_sellable',
  'cas 17c : la prestation ordinaire du panier échoue (not_sellable)'
);
select is(
  (select count(*) from orders where holder_name = 'Holder Camp Combo')::int,
  0,
  'cas 17c : aucune commande créée'
);
select is(
  (select booked from product_availability
    where product_id = '88880000-0000-4000-8000-000000000044' and date = '2028-12-15'),
  0,
  'cas 17c : capacité PROPRE du camp inchangée malgré sa propre plage disponible'
);
select is(
  (select jsonb_agg(booked order by slot_date) from provider_resource_calendar
    where establishment_id = '88880000-0000-4000-8000-000000000011'
      and slot_date between '2028-12-15' and '2028-12-17'),
  jsonb_build_array(0, 0, 0),
  'cas 17c : ressource partagée du camp inchangée, alors qu''elle aurait réussi isolément'
);

-- Cas 18 (spec 17 §0 Tranche 0, migration 20260817160000_calendar_tranche0_fixes) : produit sans
-- price_tiers ET sans price_cop → refus price_missing en Phase 3, AUCUNE écriture (preuve que le
-- garde-fou vit bien en Phase 3/validation, pas en Phase 4/écriture où un refus tardif ne ferait
-- pas rollback des lignes déjà traitées plus tôt dans le même appel).
--
-- Fixture type='evento', et c'est forcé : depuis T3 étape 2 (20260827220000), 'evento' est le SEUL
-- type dont la contrainte products_price_cop_required_unless_evento autorise un price_cop null.
-- C'est donc le seul fixture capable d'atteindre le garde price_missing de Phase 3 — tout autre
-- type serait refusé par la contrainte à l'insertion, avant même d'appeler create_order.
reset role;
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88880000-0000-4000-8000-000000000046', '88880000-0000-4000-8000-000000000001',
   '88880000-0000-4000-8000-000000000011', 'evento',
   jsonb_build_object('es', 'Evento Sin Precio'), null, true, 'order-test-evento-no-price');
insert into product_availability (product_id, date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000046', '2028-12-25', 5, 0);
set local role authenticated;

select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000046', 'date', '2028-12-25', 'qty', 1
)));
select is(
  (select create_order(
     'Holder Price Missing',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'price_missing',
  'cas 18 : produit sans price_tiers ni price_cop → price_missing'
);
select is(
  (select count(*) from orders where holder_name = 'Holder Price Missing')::int,
  0,
  'cas 18 : aucune commande créée'
);
select is(
  (select booked from product_availability
    where product_id = '88880000-0000-4000-8000-000000000046' and date = '2028-12-25'),
  0,
  'cas 18 : capacité inchangée (refus en Phase 3, avant toute écriture)'
);

-- Cas 20 (gap découvert en session, produit jetski réel — 20260818090000) : products.
-- default_capacity, matérialisation automatique de product_availability tant qu'aucune ligne
-- explicite n'existe pour la date. Produit isolé (jamais réutilisé par un cas précédent), dates
-- volontairement absentes de toute fixture existante.
reset role;
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                       default_capacity) values
  ('88880000-0000-4000-8000-000000000048', '88880000-0000-4000-8000-000000000001',
   '88880000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Default Capacity'), 20000, true,
   'order-test-default-capacity', 3);
set local role authenticated;

-- Cas 20a : aucune ligne product_availability pour 2029-01-10 avant l'appel → succès (qty=2 ≤
-- default_capacity=3), et la ligne est désormais matérialisée avec capacity=3/booked=2.
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000048', 'date', '2029-01-10', 'qty', 2
)));
select is(
  (select create_order(
     'Holder Default Capacity A',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'ok'),
  'true',
  'cas 20a : succès sans ligne product_availability préalable (default_capacity comble le vide)'
);
select is(
  (select jsonb_build_object('capacity', capacity, 'booked', booked)
     from product_availability
    where product_id = '88880000-0000-4000-8000-000000000048' and date = '2029-01-10'),
  jsonb_build_object('capacity', 3, 'booked', 2),
  'cas 20a : ligne product_availability matérialisée avec capacity=default_capacity, booked=qty'
);

-- Cas 20b : nouvelle tentative qty=2 sur la MÊME date déjà matérialisée (booked=2, capacity=3) →
-- 2+2=4 > 3 → full, aucune écriture supplémentaire (la matérialisation Phase 2 est un ON CONFLICT
-- DO NOTHING, jamais un écrasement de la ligne déjà posée par le cas 20a).
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000048', 'date', '2029-01-10', 'qty', 2
)));
select is(
  (select create_order(
     'Holder Default Capacity B',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'full',
  'cas 20b : capacité par défaut respectée (2+2 > 3) → full'
);
select is(
  (select booked from product_availability
    where product_id = '88880000-0000-4000-8000-000000000048' and date = '2029-01-10'),
  2,
  'cas 20b : booked inchangé après le refus'
);

-- Cas 20c : qty=1 sur la même date (2+1=3, exactement à capacité) → succès, comble le dernier cupo.
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000048', 'date', '2029-01-10', 'qty', 1
)));
select is(
  (select create_order(
     'Holder Default Capacity C',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'ok'),
  'true',
  'cas 20c : dernier cupo par défaut consommé (2+1 = 3)'
);
select is(
  (select booked from product_availability
    where product_id = '88880000-0000-4000-8000-000000000048' and date = '2029-01-10'),
  3,
  'cas 20c : booked=3, capacité par défaut exactement atteinte'
);

-- Cas 20d : override admin explicite prioritaire sur le défaut — une date où l'admin a DÉJÀ posé
-- une capacité différente (1, via set_product_availability normalement, ici insérée directement
-- pour isoler ce test) ne doit JAMAIS être réécrite par la matérialisation par défaut.
reset role;
insert into product_availability (product_id, date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000048', '2029-01-11', 1, 0);
set local role authenticated;
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000048', 'date', '2029-01-11', 'qty', 2
)));
select is(
  (select create_order(
     'Holder Default Capacity D',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'full',
  'cas 20d : override admin (capacity=1) jamais écrasé par default_capacity=3 → full sur qty=2'
);
select is(
  (select capacity from product_availability
    where product_id = '88880000-0000-4000-8000-000000000048' and date = '2029-01-11'),
  1,
  'cas 20d : capacity reste celle posée par l''admin (1), jamais remplacée par default_capacity'
);

-- Cas 21 (spec 18 Tranche 1) : product_slot_rules devient réellement réservable — matérialisation
-- product_slot_availability, non-coexistence avec la branche date unique, refus des combinaisons
-- invalides. Produit isolé, règle couvrant tous les jours (weekdays 1..7) pour ignorer le jour de
-- semaine réel de la date de test — 2 créneaux d'1h (09:00-10:00, 10:00-11:00), capacité 2 chacun.
reset role;
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '88880000-0000-4000-8000-000000000049', '88880000-0000-4000-8000-000000000001',
  '88880000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Créneaux'), 30000, true, 'order-test-slot'
);
insert into product_slot_rules (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity)
values (
  '88880000-0000-4000-8000-000000000049', array[1, 2, 3, 4, 5, 6, 7]::smallint[], '09:00', '11:00', 60, 2
);
set local role authenticated;

-- Cas 21a : aucune ligne product_slot_availability avant l'appel → succès (qty=1 ≤ capacité=2),
-- matérialise capacity=2/booked=1 depuis la règle.
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000049', 'date', '2029-03-05',
  'slot_start_time', '09:00', 'qty', 1
)));
select is(
  (select create_order(
     'Holder Slot A',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'ok'),
  'true',
  'cas 21a : succès sans ligne product_slot_availability préalable (matérialisée depuis la règle)'
);
select is(
  (select jsonb_build_object('capacity', capacity, 'booked', booked)
     from product_slot_availability
    where product_id = '88880000-0000-4000-8000-000000000049'
      and slot_date = '2029-03-05' and slot_start_time = '09:00'),
  jsonb_build_object('capacity', 2, 'booked', 1),
  'cas 21a : ligne matérialisée avec capacity=2 (règle), booked=qty'
);

-- Cas 21b : qty=2 sur le même créneau déjà à booked=1/capacity=2 → 1+2=3 > 2 → full, aucune
-- écriture supplémentaire.
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000049', 'date', '2029-03-05',
  'slot_start_time', '09:00', 'qty', 2
)));
select is(
  (select create_order(
     'Holder Slot B',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'full',
  'cas 21b : capacité du créneau respectée (1+2 > 2) → full'
);
select is(
  (select booked from product_slot_availability
    where product_id = '88880000-0000-4000-8000-000000000049'
      and slot_date = '2029-03-05' and slot_start_time = '09:00'),
  1,
  'cas 21b : booked inchangé après le refus'
);

-- Cas 21c : qty=1 sur le même créneau (1+1=2, exactement à capacité) → succès, comble le dernier
-- cupo.
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000049', 'date', '2029-03-05',
  'slot_start_time', '09:00', 'qty', 1
)));
select is(
  (select create_order(
     'Holder Slot C',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'ok'),
  'true',
  'cas 21c : dernier cupo du créneau consommé (1+1 = 2)'
);
select is(
  (select booked from product_slot_availability
    where product_id = '88880000-0000-4000-8000-000000000049'
      and slot_date = '2029-03-05' and slot_start_time = '09:00'),
  2,
  'cas 21c : booked=2, capacité du créneau exactement atteinte'
);

-- Cas 21d : override admin explicite prioritaire sur le créneau dérivé de la règle — un créneau où
-- l'admin a DÉJÀ posé une capacité différente (1, insérée directement pour isoler ce test) ne doit
-- JAMAIS être réécrit par la matérialisation.
reset role;
insert into product_slot_availability (product_id, slot_date, slot_start_time, slot_duration_minutes, capacity, booked)
values ('88880000-0000-4000-8000-000000000049', '2029-03-05', '10:00', 60, 1, 0);
set local role authenticated;
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000049', 'date', '2029-03-05',
  'slot_start_time', '10:00', 'qty', 2
)));
select is(
  (select create_order(
     'Holder Slot D',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'full',
  'cas 21d : override admin (capacity=1) jamais écrasé par la règle (capacité=2) → full sur qty=2'
);
select is(
  (select capacity from product_slot_availability
    where product_id = '88880000-0000-4000-8000-000000000049'
      and slot_date = '2029-03-05' and slot_start_time = '10:00'),
  1,
  'cas 21d : capacity reste celle posée par l''admin (1), jamais remplacée par la règle (2)'
);

-- Cas 21e : ligne date unique (sans slot_start_time) sur un produit qui porte au moins une règle
-- product_slot_rules → non-coexistence stricte, slot_required (§10 point 4 de la spec 18).
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000049', 'date', '2029-03-06', 'qty', 1
)));
select is(
  (select create_order(
     'Holder Slot E',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'slot_required',
  'cas 21e : produit à créneaux vendu "en gros" par date unique → slot_required'
);

-- Cas 21f : slot_start_time combiné à end_date (ligne alojamiento — produit 031, sans rapport avec
-- product_slot_rules) → unsupported_slot_combination, refus explicite plutôt qu'une ligne
-- corrompue silencieusement.
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000031', 'date', '2029-03-05',
  'end_date', '2029-03-07', 'slot_start_time', '09:00', 'qty', 1
)));
select is(
  (select create_order(
     'Holder Slot F',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'unsupported_slot_combination',
  'cas 21f : slot_start_time combiné à end_date → unsupported_slot_combination'
);

-- Cas 21g : slot_start_time qui ne correspond à AUCUN créneau réellement généré par la règle
-- courante (14:00, hors plage 09:00-11:00) → rien matérialisé en Phase 2, slot_not_found en Phase 3
-- (jamais une confiance aveugle dans une valeur cliente).
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000049', 'date', '2029-03-05',
  'slot_start_time', '14:00', 'qty', 1
)));
select is(
  (select create_order(
     'Holder Slot G',
     p_holder_email => 'buyer-fixture@hifago.test'
   )->>'reason'),
  'slot_not_found',
  'cas 21g : slot_start_time hors plage de la règle → slot_not_found (rien matérialisé)'
);

-- Cas 22 (remise par seuil de remplissage cumulé, camps — demande Jérôme du 2026-09-14, migration
-- 20260914130000). Produit dédié 050 (046 déjà pris par le cas 18), group_discount_threshold_qty=16,
-- group_discount_pct=0.20 (mêmes valeurs que l'exemple donné par Jérôme : camp 20 places, -20% à
-- partir de 16 personnes), price_cop=100000, duration_days=1 (un seul jour, sans rapport avec le
-- multi-jours du cas 17 — pas le sujet ici). product_availability.booked porte le remplissage AVANT
-- chaque scénario ; provider_resource_calendar réglée large (capacité 20, booked=0) pour ne jamais
-- interférer — seul product_availability doit gouverner le déclenchement de la remise (§0 du plan :
-- c'est la bonne table, provider_resource_calendar est la ressource partagée de l'établissement).
-- reset role avant chaque insert de fixture, authenticated + test_login restaurés juste avant
-- l'appel RPC — même patron que les cas 18/20 ci-dessus (products_write_admin exige is_admin()).
reset role;
insert into products (
  id, partner_id, establishment_id, type, name, price_cop, sellable, slug, duration_days,
  group_discount_threshold_qty, group_discount_pct
) values (
  '88880000-0000-4000-8000-000000000050', '88880000-0000-4000-8000-000000000001',
  '88880000-0000-4000-8000-000000000011', 'camp',
  jsonb_build_object('es', 'Campamento Remise Seuil'), 100000, true,
  'order-test-camp-group-discount', 1, 16, 0.20
);

-- Cas 22a : remplissage avant=10, qty=3 → après=13, strictement sous le seuil (16) → prix plein,
-- aucune remise. Preuve que la comparaison ne se déclenche pas trop tôt.
insert into product_availability (product_id, date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000050', '2028-12-25', 20, 10);
insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000011', '2028-12-25', 20, 0);
set local role authenticated;
select test_login('88880000-0000-4000-8000-000000000021');
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000050', 'date', '2028-12-25', 'qty', 3
)));
create temp table tmp_camp_discount_below as
  select create_order('Holder Camp Discount Below', p_holder_email => 'buyer-fixture@hifago.test') as result;
select is(
  (select result->>'ok' from tmp_camp_discount_below), 'true',
  'cas 22a : remplissage avant (10) + qty (3) = 13 < seuil (16) → succès'
);
reset role;
select is(
  (select jsonb_build_object('price_cop', price_cop, 'total_cop', total_cop) from order_lines
    where product_id = '88880000-0000-4000-8000-000000000050' and date = '2028-12-25'),
  jsonb_build_object('price_cop', 100000, 'total_cop', 300000),
  'cas 22a : price_cop inchangé, total_cop = prix plein (100000*3), aucune remise sous le seuil'
);
drop table tmp_camp_discount_below;

-- Cas 22b : remplissage avant=13, qty=3 → après=16, EXACTEMENT le seuil → remise appliquée.
-- Décision actée avec Jérôme : la ligne qui franchit elle-même le seuil en bénéficie (comparaison
-- >=, pas >) — date distincte de 22a, même produit, pour isoler les deux remplissages.
reset role;
insert into product_availability (product_id, date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000050', '2028-12-26', 20, 13);
insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000011', '2028-12-26', 20, 0);
set local role authenticated;
select test_login('88880000-0000-4000-8000-000000000021');
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000050', 'date', '2028-12-26', 'qty', 3
)));
create temp table tmp_camp_discount_at as
  select create_order('Holder Camp Discount At', p_holder_email => 'buyer-fixture@hifago.test') as result;
select is(
  (select result->>'ok' from tmp_camp_discount_at), 'true',
  'cas 22b : remplissage avant (13) + qty (3) = 16, exactement le seuil → succès'
);
reset role;
select is(
  (select jsonb_build_object('price_cop', price_cop, 'total_cop', total_cop) from order_lines
    where product_id = '88880000-0000-4000-8000-000000000050' and date = '2028-12-26'),
  jsonb_build_object('price_cop', 100000, 'total_cop', 240000),
  'cas 22b : price_cop inchangé, total_cop = 100000*3*(1-0.20) = 240000, remise dès l''égalité (>=)'
);
drop table tmp_camp_discount_at;

-- Cas 22c (non-régression) : camp SANS group_discount configuré (produit 044, déjà fixturé au cas
-- 17, group_discount_threshold_qty/pct laissés null) — même avec un remplissage avant élevé et une
-- quantité qui franchirait n'importe quel seuil plausible, aucune remise ne s'applique. Date neuve
-- (2028-12-30), sans rapport avec les cas 17a/c sur ce même produit.
reset role;
insert into product_availability (product_id, date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000044', '2028-12-30', 20, 15),
  ('88880000-0000-4000-8000-000000000055', '2028-12-30', 5, 0),
  ('88880000-0000-4000-8000-000000000055', '2028-12-31', 5, 0);
insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000011', '2028-12-30', 20, 0),
  ('88880000-0000-4000-8000-000000000011', '2028-12-31', 20, 0),
  ('88880000-0000-4000-8000-000000000011', '2029-01-01', 20, 0);
set local role authenticated;
select test_login('88880000-0000-4000-8000-000000000021');
-- Ligne 055 (lodging, 2026-09-15) ajoutée pour satisfaire camp_missing_lodging — sans rapport avec
-- le sujet de ce cas (non-régression de la remise de groupe).
select test_set_cart(jsonb_build_array(
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000044', 'date', '2028-12-30', 'qty', 3),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000055',
    'date', '2028-12-30', 'end_date', '2029-01-01', 'qty', 1)
));
create temp table tmp_camp_no_discount as
  select create_order('Holder Camp No Discount', p_holder_email => 'buyer-fixture@hifago.test') as result;
select is(
  (select result->>'ok' from tmp_camp_no_discount), 'true',
  'cas 22c : camp sans group_discount configuré → succès normal'
);
reset role;
select is(
  (select total_cop::int from order_lines
    where product_id = '88880000-0000-4000-8000-000000000044' and date = '2028-12-30'),
  270000,
  'cas 22c : total_cop = 90000*3, comportement inchangé sans configuration (non-régression)'
);
drop table tmp_camp_no_discount;

-- Cas 23 (camp exige un hébergement compatible dans le même panier — migration
-- 20260915100000_camp_requires_compatible_lodging.sql, retour Jérôme du 2026-09-15). Produits
-- dédiés : 051 (camp, duration_days=5), 053 (camp, duration_days=3), 054 (camp, duration_days=1 —
-- day trip, preuve de l'exception "0 nuit requise"), 052 (lodging, établissement B/012 —
-- DÉLIBÉRÉMENT différent de l'établissement du camp, 011/partenaire A, pour prouver l'absence de
-- filtre géographique/établissement). reset role avant chaque insert de fixture, même patron que
-- les cas 18/20/22 ci-dessus.
reset role;
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, duration_days)
values
  ('88880000-0000-4000-8000-000000000051', '88880000-0000-4000-8000-000000000001',
   '88880000-0000-4000-8000-000000000011', 'camp',
   jsonb_build_object('es', 'Campamento Exige Alojamiento'), 90000, true,
   'order-test-camp-needs-lodging', 5),
  ('88880000-0000-4000-8000-000000000053', '88880000-0000-4000-8000-000000000001',
   '88880000-0000-4000-8000-000000000011', 'camp',
   jsonb_build_object('es', 'Campamento Exige Alojamiento B'), 90000, true,
   'order-test-camp-needs-lodging-b', 3),
  ('88880000-0000-4000-8000-000000000054', '88880000-0000-4000-8000-000000000001',
   '88880000-0000-4000-8000-000000000011', 'camp',
   jsonb_build_object('es', 'Campamento Un Dia'), 90000, true,
   'order-test-camp-one-day', 1);
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '88880000-0000-4000-8000-000000000052', '88880000-0000-4000-8000-000000000002',
  '88880000-0000-4000-8000-000000000012', 'lodging',
  jsonb_build_object('es', 'Alojamiento Compatible'), 50000, true, 'order-test-lodging-compat'
);

-- Cas 23a : camp seul, aucune ligne lodging dans le panier → camp_missing_lodging. Rejeté AVANT
-- tout verrou (aucune fixture de disponibilité nécessaire — même raison que empty_cart, cas 2).
set local role authenticated;
select test_login('88880000-0000-4000-8000-000000000021');
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000051', 'date', '2029-03-05', 'qty', 2
)));
select is(
  (select create_order('Holder Camp Solo', p_holder_email => 'buyer-fixture@hifago.test')->>'reason'),
  'camp_missing_lodging',
  'cas 23a : camp seul, aucune ligne lodging dans le panier → camp_missing_lodging'
);

-- Cas 23b : camp (051, duration_days=5, départ 2029-03-05, dernier jour 2029-03-09) + lodging (052)
-- couvrant EXACTEMENT les 4 nuits requises (03-05→03-09) → succès. Fixtures réelles nécessaires
-- pour aller jusqu'en Phase 3 : capacité propre du camp, ressource partagée de l'établissement 011
-- sur les 5 jours de la plage, capacité du lodging sur ses 4 nuits.
reset role;
insert into product_availability (product_id, date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000051', '2029-03-05', 5, 0),
  ('88880000-0000-4000-8000-000000000052', '2029-03-05', 5, 0),
  ('88880000-0000-4000-8000-000000000052', '2029-03-06', 5, 0),
  ('88880000-0000-4000-8000-000000000052', '2029-03-07', 5, 0),
  ('88880000-0000-4000-8000-000000000052', '2029-03-08', 5, 0);
insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000011', '2029-03-05', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2029-03-06', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2029-03-07', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2029-03-08', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2029-03-09', 5, 0);
set local role authenticated;
select test_login('88880000-0000-4000-8000-000000000021');
select test_set_cart(jsonb_build_array(
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000051', 'date', '2029-03-05', 'qty', 2),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000052',
    'date', '2029-03-05', 'end_date', '2029-03-09', 'qty', 1)
));
select is(
  (select create_order('Holder Camp Exact', p_holder_email => 'buyer-fixture@hifago.test')->>'ok'),
  'true',
  'cas 23b : camp + lodging couvrant EXACTEMENT les 4 nuits requises → succès'
);

-- Cas 23c : lodging PLUS LARGE que les nuits requises (arrivée avant, départ après) → succès.
-- Camp 051, départ 2029-04-10 (dernier jour 04-14) ; lodging 052 du 04-09 au 04-15 (une nuit de
-- marge de chaque côté).
reset role;
insert into product_availability (product_id, date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000051', '2029-04-10', 5, 0),
  ('88880000-0000-4000-8000-000000000052', '2029-04-09', 5, 0),
  ('88880000-0000-4000-8000-000000000052', '2029-04-10', 5, 0),
  ('88880000-0000-4000-8000-000000000052', '2029-04-11', 5, 0),
  ('88880000-0000-4000-8000-000000000052', '2029-04-12', 5, 0),
  ('88880000-0000-4000-8000-000000000052', '2029-04-13', 5, 0),
  ('88880000-0000-4000-8000-000000000052', '2029-04-14', 5, 0);
insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000011', '2029-04-10', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2029-04-11', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2029-04-12', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2029-04-13', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2029-04-14', 5, 0);
set local role authenticated;
select test_login('88880000-0000-4000-8000-000000000021');
select test_set_cart(jsonb_build_array(
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000051', 'date', '2029-04-10', 'qty', 2),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000052',
    'date', '2029-04-09', 'end_date', '2029-04-15', 'qty', 1)
));
select is(
  (select create_order('Holder Camp Wide', p_holder_email => 'buyer-fixture@hifago.test')->>'ok'),
  'true',
  'cas 23c : lodging plus large que les nuits requises (arrivée avant, départ après) → succès'
);

-- Cas 23d : hébergement avec un TROU au milieu des nuits requises — deux lignes lodging
-- contiguës, mais AUCUNE ne couvre seule toute la plage (limite assumée : jamais une somme de
-- plusieurs lignes, cf. en-tête de la migration) → camp_missing_lodging. Camp 051, départ
-- 2029-06-01 (dernier jour 06-05, nuits requises 06-01..06-04) ; lodging A 06-01→06-03 (nuits
-- 01,02), lodging B 06-04→06-06 (nuits 04,05) : la nuit du 06-03 n'est couverte par aucune des
-- deux prises isolément. Rejeté avant tout verrou, aucune fixture de disponibilité nécessaire
-- (même raison que 23a) — rôle déjà `authenticated` depuis le cas 23c.
select test_login('88880000-0000-4000-8000-000000000021');
select test_set_cart(jsonb_build_array(
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000051', 'date', '2029-06-01', 'qty', 2),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000052',
    'date', '2029-06-01', 'end_date', '2029-06-03', 'qty', 1),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000052',
    'date', '2029-06-04', 'end_date', '2029-06-06', 'qty', 1)
));
select is(
  (select create_order('Holder Camp Gap', p_holder_email => 'buyer-fixture@hifago.test')->>'reason'),
  'camp_missing_lodging',
  'cas 23d : deux lignes lodging contiguës mais aucune ne couvre seule toute la plage → camp_missing_lodging'
);

-- Cas 23e : deux camps dans le même panier, chacun sa propre lodging compatible → succès, preuve
-- que l'exists() par ligne camp fonctionne indépendamment pour chacune, sans exclusivité entre
-- elles (limite assumée, cf. en-tête de la migration). Camp 051 (2029-07-01, dernier jour 07-05)
-- + lodging 052 (07-01→07-05) ; camp 053 (duration_days=3, 2029-07-10, dernier jour 07-12) +
-- lodging 052 réutilisé sur une plage disjointe (07-10→07-12).
reset role;
insert into product_availability (product_id, date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000051', '2029-07-01', 5, 0),
  ('88880000-0000-4000-8000-000000000052', '2029-07-01', 5, 0),
  ('88880000-0000-4000-8000-000000000052', '2029-07-02', 5, 0),
  ('88880000-0000-4000-8000-000000000052', '2029-07-03', 5, 0),
  ('88880000-0000-4000-8000-000000000052', '2029-07-04', 5, 0),
  ('88880000-0000-4000-8000-000000000053', '2029-07-10', 5, 0),
  ('88880000-0000-4000-8000-000000000052', '2029-07-10', 5, 0),
  ('88880000-0000-4000-8000-000000000052', '2029-07-11', 5, 0);
insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000011', '2029-07-01', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2029-07-02', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2029-07-03', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2029-07-04', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2029-07-05', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2029-07-10', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2029-07-11', 5, 0),
  ('88880000-0000-4000-8000-000000000011', '2029-07-12', 5, 0);
set local role authenticated;
select test_login('88880000-0000-4000-8000-000000000021');
select test_set_cart(jsonb_build_array(
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000051', 'date', '2029-07-01', 'qty', 2),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000052',
    'date', '2029-07-01', 'end_date', '2029-07-05', 'qty', 1),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000053', 'date', '2029-07-10', 'qty', 2),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000052',
    'date', '2029-07-10', 'end_date', '2029-07-12', 'qty', 1)
));
create temp table tmp_two_camps_two_lodgings as
  select create_order('Holder Two Camps', p_holder_email => 'buyer-fixture@hifago.test') as result;
select is(
  (select result->>'ok' from tmp_two_camps_two_lodgings), 'true',
  'cas 23e : deux camps, chacun sa propre lodging compatible → succès'
);
reset role;
select is(
  (select count(*)::int from order_lines
    where product_id in (
      '88880000-0000-4000-8000-000000000051', '88880000-0000-4000-8000-000000000052',
      '88880000-0000-4000-8000-000000000053'
    ) and date in ('2029-07-01', '2029-07-10')),
  4,
  'cas 23e : les 4 lignes (2 camps + 2 lodgings) sont bien écrites'
);
drop table tmp_two_camps_two_lodgings;

-- Cas 23f : camp duration_days=1 (0 nuit requise, day trip) sans aucune ligne lodging → succès —
-- preuve de l'exception nécessaire (sans elle, un camp d'une seule journée légitime serait refusé
-- à tort, régression sur tout futur camp "day trip").
reset role;
insert into product_availability (product_id, date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000054', '2029-08-01', 5, 0);
insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000011', '2029-08-01', 5, 0);
set local role authenticated;
select test_login('88880000-0000-4000-8000-000000000021');
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000054', 'date', '2029-08-01', 'qty', 2
)));
select is(
  (select create_order('Holder Day Camp', p_holder_email => 'buyer-fixture@hifago.test')->>'ok'),
  'true',
  'cas 23f : camp duration_days=1 (0 nuit requise) sans aucune lodging → succès'
);

-- Cas 24 (migration 20260929112240) : bornes de quantité d'un logement, plage obligatoire,
-- ressource partagée sommée sur le panier, nom de produit échappé dans l'e-mail camp. Fixtures
-- dédiées (partenaire 301, établissement 311) : leurs dates et leur ressource partagée ne croisent
-- aucun cas précédent. Les quantités ≤ 0 et les contraintes CHECK sont dans
-- create_order_qty_guard.test.sql (il faut y retirer une contrainte le temps du fichier) ; le
-- logement PMS à connecteur coupé est dans create_order_pms_backed.test.sql.
reset role;
insert into partners (id, display_name) values
  ('88880000-0000-4000-8000-000000000301', 'Order Test Partner P3');
insert into establishments (id, partner_id, name) values
  ('88880000-0000-4000-8000-000000000311', '88880000-0000-4000-8000-000000000301',
   jsonb_build_object('es', 'Establecimiento Order P3'));
-- Compte du partenaire 301 : destinataire de l'e-mail « recurso bloqueado » (cas 24k). Le trigger
-- on_auth_user_created lui pose sa ligne partner_accounts, rattachée ici au partenaire.
insert into auth.users (id, email) values
  ('88880000-0000-4000-8000-000000000321', 'order-p3-owner@test.local');
update partner_accounts set partner_id = '88880000-0000-4000-8000-000000000301'
 where id = '88880000-0000-4000-8000-000000000321';

-- 331 : logement sans min/max produit → plafond par défaut 20 (24a/24b).
-- 332 : logement min_qty = max_qty = 2 → plafond produit 2 (24c), min_qty ignoré (24d).
-- 333 : logement à default_capacity → sans end_date, la branche « date unique » l'acceptait (24e).
-- 334/335 : deux camps d'un jour du même établissement (24g, 24i, 24j).
-- 336 : camp de 3 jours (24h), couvert par le logement 339 dans le même panier.
-- 338 : camp d'un jour dont le nom porte du HTML (24k).
insert into products (
  id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
  min_qty, max_qty, default_capacity, duration_days
)
values
  ('88880000-0000-4000-8000-000000000331', '88880000-0000-4000-8000-000000000301',
   '88880000-0000-4000-8000-000000000311', 'lodging', jsonb_build_object('es', 'Alojamiento P3 Tope'),
   80000, true, 'order-test-p3-lodging-cap', null, null, null, null),
  ('88880000-0000-4000-8000-000000000332', '88880000-0000-4000-8000-000000000301',
   '88880000-0000-4000-8000-000000000311', 'lodging', jsonb_build_object('es', 'Alojamiento P3 Bornes'),
   80000, true, 'order-test-p3-lodging-bounds', 2, 2, null, null),
  ('88880000-0000-4000-8000-000000000333', '88880000-0000-4000-8000-000000000301',
   '88880000-0000-4000-8000-000000000311', 'lodging', jsonb_build_object('es', 'Alojamiento P3 Sin Salida'),
   80000, true, 'order-test-p3-lodging-no-end', null, null, 5, null),
  ('88880000-0000-4000-8000-000000000334', '88880000-0000-4000-8000-000000000301',
   '88880000-0000-4000-8000-000000000311', 'camp', jsonb_build_object('es', 'Campamento P3 A'),
   90000, true, 'order-test-p3-camp-a', null, null, 10, 1),
  ('88880000-0000-4000-8000-000000000335', '88880000-0000-4000-8000-000000000301',
   '88880000-0000-4000-8000-000000000311', 'camp', jsonb_build_object('es', 'Campamento P3 B'),
   90000, true, 'order-test-p3-camp-b', null, null, 10, 1),
  ('88880000-0000-4000-8000-000000000336', '88880000-0000-4000-8000-000000000301',
   '88880000-0000-4000-8000-000000000311', 'camp', jsonb_build_object('es', 'Campamento P3 Tres Dias'),
   90000, true, 'order-test-p3-camp-3d', null, null, 10, 3),
  ('88880000-0000-4000-8000-000000000338', '88880000-0000-4000-8000-000000000301',
   '88880000-0000-4000-8000-000000000311', 'camp',
   jsonb_build_object('es', '<a href="https://x.test">clic</a> & co'),
   90000, true, 'order-test-p3-camp-html', null, null, 10, 1),
  ('88880000-0000-4000-8000-000000000339', '88880000-0000-4000-8000-000000000301',
   '88880000-0000-4000-8000-000000000311', 'lodging', jsonb_build_object('es', 'Alojamiento P3 Campamento'),
   50000, true, 'order-test-p3-lodging-camp', null, null, null, null);
-- 337 : evento réservable en ligne, sans décompte propre ('unlimited'), qui OCCUPE la ressource
-- partagée (evento_occupies_resource, défaut true) — occurrence unique le 2029-10-21 (24h). Premier
-- evento réservable de ce fichier : ce chemin de create_order n'avait aucune couverture pgTAP.
insert into products (
  id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
  online_bookable, evento_capacity_mode, evento_payment_mode, occurrence_type, occurrence_date
)
values (
  '88880000-0000-4000-8000-000000000337', '88880000-0000-4000-8000-000000000301',
  '88880000-0000-4000-8000-000000000311', 'evento', jsonb_build_object('es', 'Evento P3 Ocupa Recurso'),
  30000, true, 'order-test-p3-evento', true, 'unlimited', 'online', 'once', '2029-10-21'
);

insert into product_availability (product_id, date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000331', '2029-10-01', 30, 0),
  ('88880000-0000-4000-8000-000000000332', '2029-10-03', 10, 0),
  ('88880000-0000-4000-8000-000000000339', '2029-10-11', 5, 0),
  ('88880000-0000-4000-8000-000000000339', '2029-10-20', 5, 0),
  ('88880000-0000-4000-8000-000000000339', '2029-10-21', 5, 0);
insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('88880000-0000-4000-8000-000000000311', '2029-10-05', 1, 0),
  ('88880000-0000-4000-8000-000000000311', '2029-10-08', 3, 2),
  ('88880000-0000-4000-8000-000000000311', '2029-10-11', 2, 0),
  ('88880000-0000-4000-8000-000000000311', '2029-10-14', 5, 0),
  ('88880000-0000-4000-8000-000000000311', '2029-10-20', 1, 0),
  ('88880000-0000-4000-8000-000000000311', '2029-10-21', 1, 0),
  ('88880000-0000-4000-8000-000000000311', '2029-10-22', 1, 0);

set local role authenticated;
select test_login('88880000-0000-4000-8000-000000000021');

-- Cas 24a : logement qty 21 > coalesce(max_qty, 20), alors que la nuit a 30 places → refusé en
-- Phase 1. Sans la garde, la commande passait (aucune borne par ligne pour un logement).
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000331',
  'date', '2029-10-01', 'end_date', '2029-10-02', 'qty', 21
)));
select is(
  (select create_order('Holder P3 Tope', p_holder_email => 'buyer-fixture@hifago.test')->>'reason'),
  'qty_cap_exceeded',
  'cas 24a : logement qty 21 > plafond par défaut 20 → qty_cap_exceeded'
);

-- Cas 24b : qty 20 = le plafond → accepté (borne incluse).
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000331',
  'date', '2029-10-01', 'end_date', '2029-10-02', 'qty', 20
)));
select is(
  (select create_order('Holder P3 Tope Exacto', p_holder_email => 'buyer-fixture@hifago.test')->>'ok'),
  'true',
  'cas 24b : logement qty 20 = plafond → accepté'
);

-- Cas 24c : max_qty produit (2) prime sur le défaut 20.
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000332',
  'date', '2029-10-03', 'end_date', '2029-10-04', 'qty', 3
)));
select is(
  (select create_order('Holder P3 Bornes Max', p_holder_email => 'buyer-fixture@hifago.test')->>'reason'),
  'qty_cap_exceeded',
  'cas 24c : logement qty 3 > max_qty produit 2 → qty_cap_exceeded'
);

-- Cas 24d : min_qty produit (2) N'EST PAS appliqué à un logement — la vitrine le réserve avec un
-- minimum fixé à 1 (apps/web/lib/reservas/cantidad.ts) ; l'appliquer refuserait des paniers
-- qu'elle accepte.
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000332',
  'date', '2029-10-03', 'end_date', '2029-10-04', 'qty', 1
)));
select is(
  (select create_order('Holder P3 Bornes Min', p_holder_email => 'buyer-fixture@hifago.test')->>'ok'),
  'true',
  'cas 24d : logement qty 1 < min_qty produit 2 → accepté (min_qty jamais appliqué à un logement)'
);

-- Cas 24e : logement sans end_date → date_range_required, avant tout verrou et avant la
-- matérialisation des disponibilités (aucune ligne product_availability créée pour 333).
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000333', 'date', '2029-10-06', 'qty', 1
)));
select is(
  (select create_order('Holder P3 Sin Salida', p_holder_email => 'buyer-fixture@hifago.test')->>'reason'),
  'date_range_required',
  'cas 24e : logement sans end_date → date_range_required'
);
select is(
  (select count(*)::int from cart_items where account_id = '88880000-0000-4000-8000-000000000021'),
  1,
  'cas 24e : panier intact après le refus'
);
reset role;
select is(
  (select count(*)::int from product_availability where product_id = '88880000-0000-4000-8000-000000000333'),
  0,
  'cas 24e : aucune ligne product_availability matérialisée pour le logement refusé'
);
set local role authenticated;

-- Cas 24g : deux camps DIFFÉRENTS du même établissement, le même jour, ressource partagée de
-- capacité 1 → la somme du panier (2) dépasse : resource_unavailable, aucune écriture.
select test_set_cart(jsonb_build_array(
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000334', 'date', '2029-10-05', 'qty', 1),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000335', 'date', '2029-10-05', 'qty', 1)
));
select is(
  (select create_order('Holder P3 Dos Campamentos', p_holder_email => 'buyer-fixture@hifago.test')->>'reason'),
  'resource_unavailable',
  'cas 24g : deux camps du même établissement le même jour, ressource 1 → resource_unavailable'
);
reset role;
select is(
  (select booked from provider_resource_calendar
    where establishment_id = '88880000-0000-4000-8000-000000000311' and slot_date = '2029-10-05'),
  0,
  'cas 24g : ressource partagée intacte (booked 0)'
);
set local role authenticated;

-- Cas 24h : camp de 3 jours (20→22) + evento qui occupe la ressource le 21, ressource de capacité
-- 1 sur les trois jours → le 21 porte 2 : resource_unavailable, aucun des trois jours écrit.
select test_set_cart(jsonb_build_array(
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000336', 'date', '2029-10-20', 'qty', 1),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000339',
    'date', '2029-10-20', 'end_date', '2029-10-22', 'qty', 1),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000337', 'date', '2029-10-21', 'qty', 1)
));
select is(
  (select create_order('Holder P3 Campamento Evento', p_holder_email => 'buyer-fixture@hifago.test')->>'reason'),
  'resource_unavailable',
  'cas 24h : camp 3 jours + evento occupant le jour 2, ressource 1 → resource_unavailable'
);
reset role;
select is(
  (select sum(booked)::int from provider_resource_calendar
    where establishment_id = '88880000-0000-4000-8000-000000000311'
      and slot_date between '2029-10-20' and '2029-10-22'),
  0,
  'cas 24h : aucun des trois jours de la ressource écrit'
);
set local role authenticated;

-- Cas 24i : le même camp deux fois dans le panier, ressource 3 dont 2 déjà prises → 2 + 2 > 3 :
-- resource_unavailable (la capacité propre du camp, 10, suffit ; seule la ressource bloque).
select test_set_cart(jsonb_build_array(
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000334', 'date', '2029-10-08', 'qty', 1),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000334', 'date', '2029-10-08', 'qty', 1)
));
select is(
  (select create_order('Holder P3 Mismo Campamento', p_holder_email => 'buyer-fixture@hifago.test')->>'reason'),
  'resource_unavailable',
  'cas 24i : deux lignes du même camp, ressource 3 dont 2 prises → resource_unavailable'
);
reset role;
select is(
  (select booked from provider_resource_calendar
    where establishment_id = '88880000-0000-4000-8000-000000000311' and slot_date = '2029-10-08'),
  2,
  'cas 24i : ressource partagée inchangée (booked 2)'
);
set local role authenticated;

-- Cas 24j : témoin positif — deux camps d'un jour (1 + 1) sur une ressource de capacité 2, plus un
-- logement du MÊME établissement (hors ressource partagée, jamais compté) → accepté, booked = 2
-- exactement.
select test_set_cart(jsonb_build_array(
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000334', 'date', '2029-10-11', 'qty', 1),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000335', 'date', '2029-10-11', 'qty', 1),
  jsonb_build_object('product_id', '88880000-0000-4000-8000-000000000339',
    'date', '2029-10-11', 'end_date', '2029-10-12', 'qty', 1)
));
select is(
  (select create_order('Holder P3 Capacidad Justa', p_holder_email => 'buyer-fixture@hifago.test')->>'ok'),
  'true',
  'cas 24j : deux camps sur une ressource de capacité 2 + un logement du même établissement → accepté'
);
reset role;
select is(
  (select booked from provider_resource_calendar
    where establishment_id = '88880000-0000-4000-8000-000000000311' and slot_date = '2029-10-11'),
  2,
  'cas 24j : ressource partagée à booked 2 = capacité (le logement n''est pas compté)'
);
set local role authenticated;

-- Cas 24k : e-mail « recurso bloqueado » — le nom du produit est échappé avant d'entrer dans le
-- HTML. L'envoi est isolé dans un bloc exception qui avale toute erreur : l'existence de la ligne
-- est vérifiée AVANT son contenu, sans quoi un échec avalé passerait pour un échappement réussi.
select test_set_cart(jsonb_build_array(jsonb_build_object(
  'product_id', '88880000-0000-4000-8000-000000000338', 'date', '2029-10-14', 'qty', 1
)));
select is(
  (select create_order('Holder P3 Nombre HTML', p_holder_email => 'buyer-fixture@hifago.test')->>'ok'),
  'true',
  'cas 24k : camp au nom porteur de HTML → commande acceptée'
);
reset role;
select is(
  (select count(*)::int from notification_emails n
     join order_lines ol on ol.id = n.related_id
    where n.event_type = 'partner_camp_evento_blocked' and n.related_table = 'order_lines'
      and n.recipient_account_id = '88880000-0000-4000-8000-000000000321'
      and ol.product_id = '88880000-0000-4000-8000-000000000338'),
  1,
  'cas 24k : e-mail « recurso bloqueado » bien mis en file pour le compte du partenaire'
);
select ok(
  (select bool_and(strpos(n.body_html,
            '&lt;a href=&quot;https://x.test&quot;&gt;clic&lt;/a&gt; &amp; co') > 0
          and strpos(n.body_html, '<a href') = 0)
     from notification_emails n
     join order_lines ol on ol.id = n.related_id
    where n.event_type = 'partner_camp_evento_blocked'
      and ol.product_id = '88880000-0000-4000-8000-000000000338'),
  'cas 24k : nom du produit échappé dans le corps HTML (aucune balise brute)'
);

select * from finish();
rollback;
