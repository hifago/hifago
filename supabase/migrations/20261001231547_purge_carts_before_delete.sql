-- Paniers en base (spec 32) : les deux suppressions qu'ils bloquaient.
--
-- cart_items.account_id, carts.account_id et cart_items.product_id référencent partner_accounts et
-- products sans cascade (20260910150000). Volontairement : la spec 31 (inv. 9) garde toutes les FK
-- vers partner_accounts en NO ACTION, comme filet, et order_lines doit continuer de bloquer la
-- suppression d'un produit. Les deux fonctions qui suppriment ces lignes parentes purgent donc
-- elles-mêmes les paniers, comme create_order le fait déjà (20260929112240).
--
-- 1. purge_expired_anonymous_identities (20260910140000) : une identité anonyme sans commande porte
--    presque toujours des cart_items, donc le delete de auth.users cascadait jusqu'à
--    partner_accounts puis butait sur le panier → identité sautée, nuit après nuit, sans signal.
--    Les paniers du candidat sont supprimés dans son sous-bloc, juste avant l'identité ; un
--    warning nomme les identités encore sautées. Une identité qui porte une commande, quel qu'en
--    soit le statut, reste hors de la sélection (inchangé).
-- 2. delete_product (20260815220000) : un produit présent dans un panier, même abandonné, ne
--    pouvait plus être supprimé (23503, affiché comme « déjà réservé »). Ses lignes de panier sont
--    supprimées avec lui ; une ligne de commande le protège toujours.
--
-- Corps extraits par pg_get_functiondef, signatures inchangées.

CREATE OR REPLACE FUNCTION public.purge_expired_anonymous_identities()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_candidate record;
  v_purged_count int := 0;
  v_skipped_ids uuid[] := array[]::uuid[];
begin
  -- LIMIT 500 : filet de sécurité, pas une hypothèse de volume — rien n'empêche un run suivant
  -- (le lendemain) de reprendre le reste ; jamais un run qui tourne indéfiniment si la table
  -- grossit un jour bien au-delà de ce qui est mesuré aujourd'hui (§7.3 : préprod 100% synthétique,
  -- aucune donnée réelle).
  for v_candidate in
    select u.id
      from auth.users u
     where u.is_anonymous is true
       and u.created_at < now() - interval '30 days'
       and not exists (select 1 from public.orders o where o.account_id = u.id)
     order by u.created_at
     limit 500
  loop
    begin
      -- Le panier part avec l'identité : cart_items et carts référencent partner_accounts sans
      -- cascade, et presque toute identité anonyme sans commande en porte un (elle naît d'un ajout
      -- au panier, spec 31 inv. 1) — sans ces deux lignes, la quasi-totalité des candidats était
      -- sautée. Même geste que create_order (20260929112240). Si une AUTRE trace bloque ensuite le
      -- delete, le sous-bloc annule aussi ces deux suppressions : le panier reste intact.
      delete from public.cart_items where account_id = v_candidate.id;
      delete from public.carts where account_id = v_candidate.id;
      delete from auth.users where id = v_candidate.id;
      v_purged_count := v_purged_count + 1;
    exception when foreign_key_violation then
      -- Bloquée par une trace ailleurs (audit_log, campagne...) — ignorée, jamais retentée
      -- indéfiniment sans qu'on le sache : comptée et nommée dans le retour, et signalée par le
      -- warning ci-dessous.
      v_skipped_ids := v_skipped_ids || v_candidate.id;
    end;
  end loop;

  -- pg_cron ne conserve que le tag de commande (« 1 row ») : le jsonb rendu ci-dessous est perdu
  -- pour un run nocturne, et une identité sautée nuit après nuit restait invisible. Le warning va
  -- dans les journaux Postgres (même idiome que les jobs de 20260819140000).
  if coalesce(array_length(v_skipped_ids, 1), 0) > 0 then
    raise warning 'purge_expired_anonymous_identities : % identité(s) purgée(s), % sautée(s) (FK) : %',
      v_purged_count, array_length(v_skipped_ids, 1), v_skipped_ids;
  end if;

  -- 2026-09-10 (/simplify) : candidates était un compteur séparé, incrémenté en double de
  -- purged/skipped — toujours leur somme exacte (chaque candidat finit dans l'un ou l'autre),
  -- dérivé ici plutôt que maintenu comme un troisième état à garder synchronisé.
  return jsonb_build_object(
    'ok', true,
    'candidates', v_purged_count + coalesce(array_length(v_skipped_ids, 1), 0),
    'purged', v_purged_count,
    'skipped', v_skipped_ids
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_product(p_product_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_before jsonb;
  v_order_lines_count int;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'delete_product réservé au rôle admin' using errcode = '42501';
  end if;

  -- Snapshot COMPLET de la ligne (pas seulement les champs modifiés comme set_product_sellable) :
  -- seul moyen de reconstruire un "annuler" plus tard (pas construit ici) — après le DELETE plus
  -- bas, la ligne products n'existe plus nulle part ailleurs pour la retrouver.
  select to_jsonb(p) into v_before from public.products p where p.id = p_product_id;

  if v_before is null then
    raise exception 'produit introuvable';
  end if;

  -- order_lines est LE signal fiable de "déjà commandée" (RPC-only, aucune cascade) — n'importe
  -- quel statut de ligne compte, y compris une ligne annulée : elle prouve qu'une commande a
  -- existé, ce qui suffit à l'invariant "jamais supprimée", indépendamment de son issue.
  select count(*) into v_order_lines_count
    from public.order_lines where product_id = p_product_id;

  if v_order_lines_count > 0 then
    -- errcode dédié (23503, réutilisé pour sa justesse sémantique comme 23505 l'est déjà ailleurs
    -- pour "code déjà attribué", 20260814233000) : le client distingue ce cas sans dépendre du
    -- texte du message.
    raise exception 'esta actividad ya fue reservada : despublícala en lugar de eliminarla'
      using errcode = '23503';
  end if;

  -- Nettoyage des tables sans cascade — jamais de commande dessus (vérifié ci-dessus), donc rien
  -- d'irréversible ici. product_media, product_tag_assignments, product_slot_rules,
  -- product_date_rates, product_slot_availability et product_amenity_assignments cascadent déjà
  -- (on delete cascade), rien à faire pour elles. cart_items (spec 32, née après cette fonction)
  -- bloquait la suppression d'un produit dès qu'un panier, même abandonné, le portait : la ligne
  -- de panier disparaît avec le produit, qui n'existe plus.
  delete from public.product_calendar where product_id = p_product_id;
  delete from public.product_availability where product_id = p_product_id;
  delete from public.product_proposals where product_id = p_product_id;
  delete from public.cart_items where product_id = p_product_id;

  delete from public.products where id = p_product_id;

  perform public.log_admin_action('product.delete', 'products', p_product_id, v_before, null, p_note);
end;
$function$;
