-- Produit (admin) : règles de créneaux remplacées en une transaction, slug dédoublonné en base.
--
-- 1. replace_product_slot_rules. ProductSlotRulesBlock.tsx remplaçait les règles en deux requêtes
--    depuis le navigateur (delete, puis insert) : un échec entre les deux — insert refusé par une
--    contrainte, onglet fermé, réseau — laissait l'activité SANS règle, donc sans aucun créneau
--    dérivé, invendable jusqu'à une nouvelle sauvegarde. Une seule RPC fait désormais les deux dans
--    la même transaction : si une règle est refusée (contraintes de product_slot_rules), le delete
--    est annulé avec elle et les règles d'origine restent en place. Pas une opération critique au
--    sens de CLAUDE.md §4.1 (product_slot_rules ne porte aucun compteur de places — booked vit dans
--    product_slot_availability) : pas de squelette anti-survente, mais un `for update` sur le
--    produit sérialise deux admins qui enregistrent les horaires du même produit.
--    Garde admin identique à provision_evento_availability ; boucle de transposition copiée de
--    create_product_from_proposal (20260916140000), même forme JSON que toSlotRuleRows
--    (apps/admin/lib/products/slotRules.ts).
--    ⚠️ La policy d'écriture directe product_slot_rules_write_admin reste en place tant que le code
--    déployé l'utilise encore : son retrait (table RPC-only) est une migration séparée, poussée
--    APRÈS le déploiement du code qui appelle cette RPC.
--
-- 2. Slug produit. products_slug_key est UNIQUE, et le formulaire admin envoie slugify(nombre) :
--    deux produits de même nom (« Habitación privada » dans deux hôtels) se heurtaient en 23505,
--    affiché comme un échec générique de création. Même mécanisme que les établissements
--    (establishments_set_slug → set_establishment_slug → establishment_slug_from_name) : un trigger
--    BEFORE INSERT dérive le slug du nom et le suffixe (-2, -3…) si le slug est absent OU déjà pris.
--    Le slug envoyé par le formulaire est slugify(nombre), donc la même base : en cas de collision,
--    le résultat est celui qu'aurait donné un suffixe. Un slug explicite et libre n'est pas touché.
--    product_slug_from_name n'est exécutable par aucun rôle d'API (même leçon que
--    establishment_slug_from_name, 20260922110000 : un helper qui sonde l'unicité des slugs ne doit
--    pas être appelable de l'extérieur) ; la fonction trigger est SECURITY DEFINER, comme
--    set_establishment_slug, pour pouvoir l'appeler quel que soit le rôle qui insère.

-- ── 1. replace_product_slot_rules ────────────────────────────────────────────────────────────────
create or replace function public.replace_product_slot_rules(p_product_id uuid, p_rules jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot jsonb;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'replace_product_slot_rules réservé au rôle admin' using errcode = '42501';
  end if;

  perform 1 from public.products where id = p_product_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found');
  end if;

  if jsonb_typeof(coalesce(p_rules, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_rules');
  end if;

  delete from public.product_slot_rules where product_id = p_product_id;

  for v_slot in select value from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) loop
    insert into public.product_slot_rules
      (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity)
    values (
      p_product_id,
      (select array_agg((w)::int order by (w)::int) from jsonb_array_elements_text(v_slot -> 'weekdays') w),
      (v_slot ->> 'start_time')::time,
      (v_slot ->> 'end_time')::time,
      (v_slot ->> 'slot_duration_minutes')::int,
      (v_slot ->> 'capacity')::int
    );
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.replace_product_slot_rules(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_product_slot_rules(uuid, jsonb) to authenticated;

-- ── 2. Slug produit ──────────────────────────────────────────────────────────────────────────────
create or replace function public.product_slug_from_name(p_name jsonb, p_exclude uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_slug text;
  v_suffix int := 1;
begin
  v_base := public.slugify(coalesce(p_name ->> 'es', 'producto'));
  if v_base = '' then
    v_base := 'producto';
  end if;
  v_slug := v_base;
  while exists (
    select 1 from public.products
     where slug = v_slug and (p_exclude is null or id <> p_exclude)
  ) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base || '-' || v_suffix;
  end loop;
  return v_slug;
end;
$$;

revoke all on function public.product_slug_from_name(jsonb, uuid) from public, anon, authenticated;

create or replace function public.set_product_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.slug is null or exists (select 1 from public.products where slug = new.slug) then
    new.slug := public.product_slug_from_name(new.name, new.id);
  end if;
  return new;
end;
$$;

create trigger products_set_slug
  before insert on public.products
  for each row execute function public.set_product_slug();
