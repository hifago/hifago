-- Montant vérifié en base pour le webhook Mercado Pago aussi.
--
-- apply_payment_webhook_checked devient l'unique autorité sur le montant d'un paiement approuvé :
-- la route /api/payments/webhook l'appelle désormais (comme le job de réconciliation), au lieu de
-- la version sans contrôle de montant. Deux changements :
--   - un `approved` dont le montant est ABSENT part en `refund_required` / `amount_mismatch` au lieu
--     d'être appliqué (CLAUDE.md §4.4 : échec fermé) — pour tous les appelants : la route, et le
--     job (reconcile_order, record_mp_payment_status, Edge Function) (décision du 2026-10-02). La route passe aussi null pour une devise autre que COP ; le job ne
--     regarde pas encore la devise (Edge Function payments-reconcile, hors de cette migration) ;
--   - un paiement DÉJÀ approuvé (rejeu, second paiement MP) n'est jamais un écart : relu sous le
--     verrou, il est délégué (already_applied / double_payment) comme avant.
--
-- Signature, grants (service_role seul), verrous (orders puis payments, .claude/rules/supabase.md
-- règle 8) inchangés ; redéfinition depuis pg_get_functiondef (règle 7), remplacements comptés.

CREATE OR REPLACE FUNCTION public.apply_payment_webhook_checked(p_mp_payment_id text, p_external_reference uuid, p_status text, p_transaction_amount numeric, p_raw_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payment record;
  v_locked_status text;
begin
  select p.id, p.order_id, p.status, p.amount_cop into v_payment
    from public.payments p where p.id = p_external_reference;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  -- Migration 20261002021045 : un montant ABSENT (ou écarté par l'appelant — la route le fait pour une
  -- devise autre que COP) ne prouve rien — échec fermé (CLAUDE.md §4.4), jamais une approbation.
  if p_status = 'approved'
     and (p_transaction_amount is null
          or round(p_transaction_amount) <> v_payment.amount_cop) then
    perform 1 from public.orders where id = v_payment.order_id for update;
    select p.status into v_locked_status from public.payments p where p.id = v_payment.id for update;
    -- Migration 20261002021045 : un paiement DÉJÀ approuvé (rejeu d'une livraison, ou second
    -- paiement MP) n'est jamais un écart de montant — la délégation le classe (already_applied /
    -- double_payment). Relu ICI, sous le verrou : un `approved` posé entre la lecture non
    -- verrouillée ci-dessus et ce point est vu.
    if v_locked_status = 'approved' then
      return public.apply_payment_webhook(p_mp_payment_id, p_external_reference, p_status, p_raw_event);
    end if;
    -- L'argent EST encaissé (au mauvais montant) : de quoi rembourser (id MP, événement brut),
    -- sans jamais approuver. Le paiement n'est pas approuvé ici (relu sous le verrou ci-dessus).
    update public.payments
       set mp_payment_id = p_mp_payment_id,
           raw_last_event = p_raw_event, updated_at = now()
     where id = v_payment.id;
    insert into public.payment_reconciliation_entries (
      payment_id, mp_payment_id, external_reference, raw_event, failure_reason, kind, reason_code
    )
    values (
      v_payment.id, p_mp_payment_id, p_external_reference::text, p_raw_event,
      case when p_transaction_amount is null
           then 'montant Mercado Pago absent ou inexploitable (acompte attendu ' || v_payment.amount_cop || ' COP)'
           else 'montant Mercado Pago (' || p_transaction_amount || ') ≠ acompte attendu (' || v_payment.amount_cop || ' COP)'
      end,
      'refund_required', 'amount_mismatch'
    )
    on conflict (mp_payment_id) where kind = 'refund_required' do nothing;
    return jsonb_build_object('ok', true, 'reason', 'amount_mismatch');
  end if;

  return public.apply_payment_webhook(p_mp_payment_id, p_external_reference, p_status, p_raw_event);
end;
$function$;
