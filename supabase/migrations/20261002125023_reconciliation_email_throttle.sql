-- E-mails admin des exceptions de paiement : étranglement des échecs de signature, échappement HTML.
--
-- 1. public.html_text(text) : texte échappé pour un corps HTML d'e-mail (xmltext pour & < > ", plus
--    l'apostrophe, que xmltext laisse passer). IMMUTABLE STRICT : NULL → NULL. Appelé par des
--    fonctions SECURITY DEFINER ; révoqué pour public, anon et authenticated (service_role le garde
--    par les droits par défaut). Une fonction SECURITY INVOKER exécutée par authenticated ne
--    pourrait donc pas l'appeler.
-- 2. notify_admin_new_reconciliation_exception, redéfinie une seule fois (depuis pg_get_functiondef,
--    .claude/rules/supabase.md règle 7, remplacements comptés) :
--    - au plus une entrée notifiée par heure glissante pour les échecs de signature du webhook (donc
--      au plus un e-mail par admin) — jamais pour une entrée corrélée, un remboursement à décider,
--      un autre échec, ni une exception PMS ; une seule transaction décide à la fois (verrou
--      consultatif non bloquant), et un index partiel borne la lecture ;
--    - les valeurs du corps venues des données passent par html_text : le nom du titulaire (saisi
--      par un visiteur), le nom de produit (saisi par un partenaire) et, par uniformité, la
--      référence de commande.
-- Rien d'autre ne change : sujets, destinataires, déduplication par entrée (notification_emails_
-- dedup_idx), lien d'administration, isolation des pannes (bloc exception).

create function public.html_text(p_value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select replace(xmltext(p_value)::text, '''', '&#39;')
$$;

comment on function public.html_text(text) is
  'Texte échappé pour un corps HTML d''e-mail : & < > " (xmltext) et l''apostrophe. NULL → NULL.';

revoke all on function public.html_text(text) from public, anon, authenticated;

-- La fenêtre de l'étranglement ne lit que les e-mails récents de cette classe.
create index notification_emails_admin_reconciliation_created_idx
  on public.notification_emails (created_at)
  where event_type = 'admin_new_reconciliation_exception'
    and related_table = 'payment_reconciliation_entries';

CREATE OR REPLACE FUNCTION public.notify_admin_new_reconciliation_exception()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_label text;
  v_subject text;
  v_body text;
  v_app_base_url text;
begin
  begin
    -- Migration 20261002125023 — étranglement des échecs de signature du webhook (`failure_reason`
    -- « signature invalide (…) », écrit par apps/web/app/api/payments/webhook/route.ts, sans
    -- payment_id). Leur nombre ne dépend d'aucun paiement réel : au plus UNE entrée de cette classe
    -- est notifiée par HEURE GLISSANTE (donc au plus un e-mail par admin). La fenêtre compte les
    -- e-mails de la classe MIS EN FILE, quel que soit leur statut — elle est donc par classe : un
    -- admin ajouté pendant l'heure attend la suivante, et un envoi raté n'est pas rejoué. L'entrée,
    -- elle, est toujours écrite (matériel de rejeu). Une seule transaction décide à la fois : verrou
    -- consultatif NON bloquant — les autres, sans attendre, se taisent (sans lui, chaque insertion
    -- concurrente passerait avant que la première notification soit validée) ; si celle qui le
    -- tient est annulée, la prochaine entrée de la classe notifie. Testé AVANT la lecture du secret
    -- Vault, qu'une entrée étranglée ne lit donc pas. Jamais étranglés : refund_required, une entrée
    -- corrélée (payment_id), les autres échecs du webhook, refunded_externally, et tout ce qui vient
    -- de pms_reconciliation_entries.
    if tg_table_name = 'payment_reconciliation_entries' then
      if new.kind = 'webhook_failure' and new.payment_id is null
         and new.failure_reason like 'signature invalide (%' then
        -- Le verrou AVANT la fenêtre, en deux instructions : l'`exists` prend alors un instantané
        -- postérieur au verrou, et voit la notification de la transaction qui le tenait.
        if not pg_try_advisory_xact_lock(hashtext('notify_admin_new_reconciliation_exception:signature')) then
          return new;
        end if;
        if exists (
             select 1
               from public.notification_emails ne
               join public.payment_reconciliation_entries e on e.id = ne.related_id
              where ne.event_type = 'admin_new_reconciliation_exception'
                and ne.related_table = 'payment_reconciliation_entries'
                and ne.created_at > now() - interval '1 hour'
                and e.kind = 'webhook_failure' and e.payment_id is null
                and e.failure_reason like 'signature invalide (%'
           ) then
          return new;
        end if;
      end if;
    end if;

    -- Lien absolu : sans le secret, on retombe sur le chemin relatif (jamais un e-mail en moins).
    select decrypted_secret into v_app_base_url
      from vault.decrypted_secrets where name = 'admin_app_public_url';
    if v_app_base_url is null then
      raise warning 'notify_admin_new_reconciliation_exception: secret Vault admin_app_public_url manquant — lien relatif dans l''e-mail';
    end if;

    if tg_table_name = 'pms_reconciliation_entries' then
      select coalesce(public.html_text(p.name ->> 'es'), 'Producto sin nombre')
        into v_label
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
       where ol.id = new.order_line_id;
      v_subject := 'Nueva excepción de reconciliación PMS';
    else
      -- payment_id nullable (spec 23 §9, cas limite) : un webhook peut échouer avant même d'être
      -- corrélé à un payments connu — libellé générique plutôt qu'un crash de construction.
      -- Migration 20261002125023 : valeurs tierces échappées (html_text) — le nom du
      -- titulaire vient d'un visiteur, le nom d'un produit d'un partenaire.
      select 'Pedido ' || public.html_text(o.reference) || ' de ' || public.html_text(o.holder_name) || ' — ' || pay.amount_cop || ' COP'
        into v_label
        from public.payments pay
        join public.orders o on o.id = pay.order_id
       where pay.id = new.payment_id;
      v_label := coalesce(v_label, 'Pedido no identificado');
      if new.kind = 'refund_required' then
        v_subject := 'Pago recibido sin reserva que honrar — reembolso requerido';
      else
        v_subject := 'Nueva excepción de reconciliación de pago';
      end if;
    end if;

    v_body := '<p>' || coalesce(v_label, 'Sin identificar') || '</p>'
      || '<p><a href="' || coalesce(v_app_base_url, '') || '/admin/reconciliation">Ver reconciliaciones pendientes</a></p>';

    perform public.notify_all_admins(
      'admin_new_reconciliation_exception', v_subject, v_body, tg_table_name, new.id
    );
  exception
    when query_canceled then
      raise warning 'notify_admin_new_reconciliation_exception: annulé (query_canceled) pour % % — %', tg_table_name, new.id, sqlerrm;
    when others then
      raise warning 'notify_admin_new_reconciliation_exception: échec pour % % — %', tg_table_name, new.id, sqlerrm;
  end;

  return new;
end;
$function$;
