-- Le partenaire plateforme « Hifago », le lieu « Guatapé » et les quatre événements du municipio
-- qui lui reviennent (décision Jérôme, 2026-10-13) — une migration de DONNÉES, aucun schéma.
--
-- POURQUOI ICI ET PAS DANS mockData/. Ces lignes doivent exister dans toute base, préprod et prod
-- comprises, et `mockData/` ne peut pas y aller : ses partenaires portent des adresses fictives
-- alors que la préprod porte les vrais — le script y créerait 46 doublons (CLAUDE.md §7.5).
-- Jusqu'ici elles n'existaient qu'en local (`mockData/partners/hifago.json`,
-- `establishments/guatape.json`, puis un `update products` à la main) ; en préprod les quatre
-- événements portent encore « Casa Kayam » (relevé sur `/es/eventos` le 2026-10-13).
--
-- CE QU'ELLE POSE : les lignes de `create_partner_direct` puis de `create_establishment`, écrites en
-- clair parce que ces deux RPC exigent un admin connecté (`auth.uid()` est nul dans une migration)
-- — le partenaire, sa capacité `referrer`, l'établissement marqué `is_place` (20261013145953), la
-- capacité `operator` rattachée à lui. Aucune ligne d'audit : `log_admin_action` est nominative et
-- il n'y a personne ; la trace est ce fichier.
--
-- L'ADRESSE. `partners.email` est un champ de contact : facultatif, sans unicité, lu seulement par
-- la recherche de la liste admin. Rien ne le rapproche d'un compte de connexion — un compte se
-- rattache par `partner_accounts.partner_id`, posé à la consommation d'une invitation, jamais par
-- l'adresse ; et les e-mails aux partenaires partent vers leurs COMPTES. Qu'elle soit aussi celle
-- d'un compte admin ne lie donc rien. Elle n'est là que pour une raison : c'est la clé par laquelle
-- `seed-mock-data.mjs` reconnaît un partenaire. `mockData/partners/hifago.json` porte la même —
-- sans quoi chaque base locale reconstruite aurait deux « Hifago ».
-- ⚠️ Ce partenaire n'a et n'aura aucun compte : « Guatapé » se gère depuis /admin (Jérôme,
-- 2026-10-13). Ne jamais lui envoyer d'invitation.
--
-- REJOUABLE SUR TROIS ÉTATS. Le lieu se reconnaît à son slug (index unique). Base locale où
-- mockData l'avait déjà créé : rien n'est recréé, l'adresse fictive est seulement remplacée.
-- Préprod : tout est créé, les quatre événements changent de porteur. Base neuve (CI, prod) : tout
-- est créé, les événements n'existent pas encore et le rattachement ne touche rien.

do $$
declare
  c_email constant text := 'hifagotest@gmail.com';
  c_eventos constant text[] := array[
    'fiestas-zocalos-y-flores-silletas-y-colores',
    'festival-gastronomico-guatabandeja',
    'media-maraton-de-guatape-3-version',
    'convocatoria-oficial-guatape-film-fest-2026'
  ];
  v_partner_id uuid;
  v_partner_name text;
  v_place_id uuid;
  v_is_place boolean;
  v_retenus text;
begin
  select e.id, e.is_place, p.id, p.display_name
    into v_place_id, v_is_place, v_partner_id, v_partner_name
    from public.establishments e
    join public.partners p on p.id = e.partner_id
   where e.slug = 'guatape';

  if found then
    -- Échec fermé : un « guatape » qui ne serait pas ce lieu-là ne reçoit pas quatre événements.
    if v_partner_name <> 'Hifago' or not v_is_place then
      raise exception 'guatape_is_not_the_platform_place'
        using detail = 'Un établissement de slug « guatape » existe déjà, mais il n''est pas le lieu du partenaire « Hifago ». Rien n''a été modifié.';
    end if;

    update public.partners
       set email = c_email, updated_at = now()
     where id = v_partner_id
       and email = 'hifago-platform@mock.hifago.test';
  else
    insert into public.partners (display_name, partner_city, email)
    values ('Hifago', 'Guatapé', c_email)
    returning id into v_partner_id;

    -- `referrer` avant `operator` : le trigger `enforce_operator_implies_referrer` l'exige.
    insert into public.partner_capabilities (partner_id, role, source)
    values (v_partner_id, 'referrer', 'migration');

    -- Le slug est posé en clair, pas laissé au trigger : c'est la clé de tout ce fichier.
    insert into public.establishments (
      partner_id, slug, name, description, address, lat, lon, operated_directly, is_place
    )
    values (
      v_partner_id,
      'guatape',
      jsonb_build_object('es', 'Guatapé'),
      jsonb_build_object('es', 'El pueblo de los zócalos, a orillas del embalse: aquí están las fiestas, ferias y eventos del municipio que no dependen de ningún establecimiento.'),
      'Guatapé, Antioquia, Colombia',
      6.2326,
      -75.1592,
      false,
      true
    )
    returning id into v_place_id;

    insert into public.partner_capabilities (partner_id, establishment_id, role, source)
    values (v_partner_id, v_place_id, 'operator', 'migration');
  end if;

  -- La précondition vérifiée à la main en local le 2026-10-13, écrite ici : un événement qui porte
  -- une commande ou une proposition en attente ne change pas de porteur en silence
  -- (`ledger_entries` et `product_proposals` recopient l'établissement).
  select string_agg(pr.slug, ', ' order by pr.slug)
    into v_retenus
    from public.products pr
   where pr.slug = any (c_eventos)
     and pr.type = 'evento'
     and pr.establishment_id <> v_place_id
     and (
       exists (select 1 from public.order_lines ol where ol.product_id = pr.id)
       or exists (
         select 1 from public.product_proposals pp
          where pp.product_id = pr.id and pp.status = 'pending'
       )
     );

  if v_retenus is not null then
    raise exception 'guatape_events_have_dependents'
      using detail = 'Ces événements portent une commande ou une proposition en attente, leur rattachement à « Guatapé » demande une décision : ' || v_retenus || '. Rien n''a été modifié.';
  end if;

  update public.products
     set establishment_id = v_place_id,
         partner_id = v_partner_id,
         updated_at = now()
   where slug = any (c_eventos)
     and type = 'evento'
     and establishment_id <> v_place_id;
end;
$$;
