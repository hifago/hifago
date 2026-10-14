import { formatCop } from "@hifago/domain";
import { createServiceRoleClient } from "@hifago/supabase/service";
import { isPaymentsMockEnabled } from "@/lib/mercadopago/mock";

export const runtime = "nodejs";

// Mode dev — remplace la page Checkout Pro externe (apps/web/lib/mercadopago/mock.ts). Répond en
// HTML brut plutôt qu'un page.tsx React : cette adresse n'est pas un écran de la vitrine (elle émule
// un site externe), ce qui évite complètement la frontière Server/Client Component et les règles
// i18n/@hifago/ui de .claude/rules/apps.md — un bandeau explicite dit que c'est un simulateur.
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

export async function GET(request: Request) {
  if (!isPaymentsMockEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const paymentId = url.searchParams.get("paymentId");
  const returnUrl = url.searchParams.get("returnUrl");
  if (!paymentId || !returnUrl) {
    return new Response("Bad request", { status: 400 });
  }

  // Jamais le montant de la query string — même principe que create/route.ts : relu en base.
  const service = createServiceRoleClient();
  const { data: payment } = await service
    .from("payments")
    .select("amount_cop, status")
    .eq("id", paymentId)
    .maybeSingle();

  if (!payment) {
    return new Response("Not found", { status: 404 });
  }

  // Le format des montants du site (formatCop), jamais un second : « 3.400 COP ».
  const amount = formatCop(payment.amount_cop);

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Simulador de pago</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; }
  .banner { background: #fef3c7; border: 1px solid #d97706; border-radius: 0.5rem; padding: 0.75rem 1rem; margin-bottom: 1.5rem; font-size: 0.875rem; }
  .amount { font-size: 1.5rem; font-weight: 600; margin: 1.5rem 0; }
  form { display: inline-block; margin-right: 0.75rem; }
  button { font-size: 1rem; padding: 0.6rem 1.2rem; border-radius: 0.375rem; border: 1px solid #d1d5db; cursor: pointer; }
  button[name="outcome"][value="approved"] { background: #16a34a; color: white; border-color: #16a34a; }
  button[name="outcome"][value="rejected"] { background: #dc2626; color: white; border-color: #dc2626; }
</style>
</head>
<body>
  <p class="banner">⚠️ SIMULADOR DE PAGO — modo dev, jamás en producción. No es Mercado Pago real.</p>
  <p class="amount">${escapeHtml(amount)}</p>
  <form method="POST" action="/api/payments/mock-confirm">
    <input type="hidden" name="paymentId" value="${escapeAttr(paymentId)}" />
    <input type="hidden" name="returnUrl" value="${escapeAttr(returnUrl)}" />
    <button type="submit" name="outcome" value="approved">Pagar (simulado)</button>
  </form>
  <form method="POST" action="/api/payments/mock-confirm">
    <input type="hidden" name="paymentId" value="${escapeAttr(paymentId)}" />
    <input type="hidden" name="returnUrl" value="${escapeAttr(returnUrl)}" />
    <button type="submit" name="outcome" value="rejected">Rechazar (simulado)</button>
  </form>
</body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
