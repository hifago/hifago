-- Campagnes : jamais d'identité anonyme dans une audience ; la purge à 30 jours emporte ses cibles
-- (arbitrages de Gabriel au nom de Jérôme, 2026-10-14).
--
-- 1. list_audience_members : toute audience (all, clients, referrers, providers, partners) exclut
--    les identités anonymes (auth.users.is_anonymous). Elles n'étaient jamais joignables, et leurs
--    lignes comm_campaign_targets (FK sans cascade) bloquaient ensuite leur purge à 30 jours. Corps
--    repris de 20260820040000 (dernière définition) par deux remplacements comptés ; signature
--    inchangée. EXECUTE : authenticated seulement (revoke public et anon à la redéfinition, garde
--    is_admin inchangée).
-- 2. purge_expired_anonymous_identities : les cibles de campagne de l'identité purgée partent avec
--    elle, dans le même sous-bloc atomique que le panier (si une autre trace bloque, rien ne part).
--    Corps repris de 20261001231547 (dernière définition) par deux remplacements comptés.

-- ============================================================================================
-- 1. list_audience_members
-- ============================================================================================
create or replace function public.list_audience_members(p_audience text)
returns table (account_id uuid, email text, phone text, reachable boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'list_audience_members réservé au rôle admin' using errcode = '42501';
  end if;
  if p_audience not in ('clients', 'referrers', 'providers', 'partners', 'all') then
    raise exception 'audience invalide : %', p_audience;
  end if;

  return query
  select pa.id, au.email::text, au.phone,
    (au.email is not null or au.phone is not null) as reachable
  from public.partner_accounts pa
  join auth.users au on au.id = pa.id
  -- Migration 20261014 (arbitrage du 2026-10-14) : une identité ANONYME n'entre dans aucune
  -- audience — elle n'est jamais joignable (ni e-mail ni téléphone), et sa ligne de cible bloquerait
  -- sa purge à 30 jours.
  where au.is_anonymous is not true
    and (p_audience = 'all'
     or (p_audience = 'clients' and exists (
           select 1 from public.orders o where o.account_id = pa.id))
     or (p_audience = 'referrers'
           and exists (select 1 from public.partner_capabilities pc
                        where pc.partner_id = pa.partner_id and pc.role = 'referrer'
                          and pc.status = 'active')
           and not exists (select 1 from public.partner_capabilities pc
                            where pc.partner_id = pa.partner_id and pc.role = 'operator' and pc.status = 'active'))
     or (p_audience = 'providers' and exists (
           select 1 from public.partner_capabilities pc
            where pc.partner_id = pa.partner_id and pc.role = 'operator'
              and pc.status = 'active'))
     or (p_audience = 'partners' and exists (
           select 1 from public.partner_capabilities pc
            where pc.partner_id = pa.partner_id and pc.role in ('referrer', 'operator')
              and pc.status = 'active')));
end;
$$;

revoke all on function public.list_audience_members(text) from public, anon;
grant execute on function public.list_audience_members(text) to authenticated;

-- ============================================================================================
-- 2. purge_expired_anonymous_identities
-- ============================================================================================
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
      -- Migration 20261014 : ses lignes de cible de campagne partent aussi, dans le même sous-bloc
      -- (même FK sans cascade vers partner_accounts). Une audience incluait jusque-là les identités
      -- anonymes, toujours injoignables (skipped_unreachable, jamais envoyées) : leur cible les
      -- rendait impurgeables à vie. Rien d'autre n'est supprimé d'office.
      delete from public.comm_campaign_targets where account_id = v_candidate.id;
      delete from auth.users where id = v_candidate.id;
      v_purged_count := v_purged_count + 1;
    exception when foreign_key_violation then
      -- Bloquée par une trace ailleurs (audit_log...) — ignorée, jamais retentée
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
