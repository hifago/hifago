import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@hifago/supabase/server";
import { REF_COOKIE, normalizeRefCode } from "@/lib/attribution/refCookie";

// Spec 32 (panier en base) — capture l'attribution d'un visiteur dans `carts.attribution_code`,
// au lieu du paramètre `p_attribution_code` que `create_order` recevait jusqu'ici. Appelé par
// `CartContext.addLine` à CHAQUE ajout (pas seulement le premier) : un `?ref=` qui arrive pendant
// qu'un panier est déjà ouvert écrase la valeur précédente, comme le faisait déjà le cookie relu à
// chaque checkout (décision du 2026-09-10, spec 32 §0).
//
// Route Handler plutôt qu'un appel direct depuis CartContext (composant client) : le cookie
// `hifago_ref` est `httpOnly` (proxy.ts) — volontairement illisible en JavaScript navigateur,
// donc `document.cookie` ne peut pas le voir. Seul du code SERVEUR (celui-ci, via `cookies()`)
// y accède. Best-effort : un échec ne bloque jamais l'ajout au panier, l'attribution n'est jamais
// une obligation (cahier §3e).
export async function POST() {
  const cookieStore = await cookies();
  // Même borne que `proxy.ts` à l'écriture : le cookie revient du navigateur tel quel et peut avoir
  // été forgé sans passer par le proxy — un code trop long n'est jamais recopié dans `carts`.
  const attributionCode = normalizeRefCode(cookieStore.get(REF_COOKIE)?.value);
  if (!attributionCode) {
    return NextResponse.json({ ok: true, captured: false });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // RLS directe (carts_insert/carts_update, account_id = auth.uid()) : cette route agit avec la
  // session du visiteur, jamais service_role — elle ne peut écrire que sa PROPRE ligne.
  const { error } = await supabase
    .from("carts")
    .upsert(
      { account_id: user.id, attribution_code: attributionCode, attribution_source: "link" },
      { onConflict: "account_id" }
    );
  if (error) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true, captured: true });
}
