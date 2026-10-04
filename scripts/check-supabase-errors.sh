#!/usr/bin/env bash
# Garde-fou automatique — une lecture Supabase en échec n'est jamais une absence (lot du
# 2026-09-30).
#
# POURQUOI. supabase-js ne LÈVE pas sur échec : il rend `{ data: null, error }`. Une couche d'accès
# qui ne destructure que `data` change donc une panne en « rien » — et chaque « rien » était un
# défaut réel : une fiche en 404 (signal de désindexation), un panier « vacío » chez un client qui
# avait réservé, un profil pré-rempli à vide qu'un enregistrement écrasait, « rien à réconcilier »
# sur l'écran des exceptions de paiement. La règle : dans apps/{web,admin}/lib/ et dans les pages et
# routes des deux apps (apps/web/app/ depuis le 2026-10-01, apps/admin/app/ depuis le 2026-10-02),
# tout résultat Supabase attendu lit aussi son `error` (et lève, ou rend un échec explicite). Côté
# admin, les pages passent par apps/admin/lib/supabase/checkedRead.ts, ou lèvent en ligne.
#
# Quatre motifs, ceux par lesquels les sites corrigés étaient passés :
#   - `const { data } = await …`, `const { data: x } = await …`, `const { count } = await …` ;
#   - `.then(({ data }) => …)`, la même chose écrite en promesse ;
#   - `if (error || …) return [];` / `return null;` — `error` lu, puis noyé dans l'absence
#     (getCartLines, getOrderByToken) ;
#   - un résultat gardé dans une variable puis lu en `x.count ?? …` / `x.data ?? …` sans que le
#     fichier lise jamais `x.error` ni ne passe `x` à `checkedRead` (accueil admin, 2026-10-04 :
#     « 0 propuestas », « nada que conciliar » sur une panne). Contrôle par variable, dans le fichier.
# Ce que le script ne voit PAS : une destructuration sur plusieurs lignes ; une destructuration EN
# TABLEAU (`const [{ data: a }, { data: b }] = await Promise.all(…)`) ; un résultat gardé entier puis
# lu sans son `error` sous une autre forme que `x.data ?? …` (`(await supabase.rpc(…)).data`,
# `error ? [] : data`) ; `{ data: x, count }`.
# Chacune de ces formes a produit le même défaut sur apps/admin/app (corrigées le 2026-10-02) : la
# revue reste le seul garde-fou pour elles. Il ferme les écritures qui ont réellement produit les
# défauts, pas toutes celles qui pourraient en produire.
#
# Et une règle de structure : aucun `loading.tsx` sous apps/web/app. Il envelopperait les pages dans
# une <Suspense> : une erreur levée y serait STREAMÉE avec un statut 200, au lieu de 500 + noindex
# (Next 16, app-render) — tout le correctif ci-dessus redeviendrait un signal d'indexation.
#
#   ./scripts/check-supabase-errors.sh   (depuis hifago/)
#
# Sort en erreur (exit 1) si une règle est enfreinte, 2 si le contrôle ne peut pas s'exécuter.

set -euo pipefail
cd "$(dirname "$0")/.."

SANS_COMMENTAIRES="scripts/lib/sans-commentaires.pl"
# Même garde de VÉRACITÉ que check-data-layer.sh : sans ce filtre, `perl` échoue, `grep` reçoit du
# vide, `|| true` neutralise `pipefail` — et tout passerait au vert sans avoir rien lu.
if [ ! -r "$SANS_COMMENTAIRES" ]; then
  echo "✗ $SANS_COMMENTAIRES introuvable ou illisible — contrôle impossible, pas \"aucune violation\"." >&2
  exit 2
fi
fail=0

# ─────────────────────────────────────────────────────────────────────────────────────────────
# Exemptions NOMMÉES, chacune avec sa raison. Les PERMANENTES portent une décision écrite (la lecture
# est volontairement best-effort, ou son échec est déjà signalé autrement) ; celles de DETTE VISIBLE
# existent pour rendre le contrôle bloquant AUJOURD'HUI sur tout code neuf, et doivent RÉTRÉCIR. Une
# exemption qui ne correspond plus à rien fait échouer le contrôle (plus bas) : la retirer d'ici.
# ⚠️ Les exemptions d'apps/web/app sont nées AVEC l'extension du périmètre (2026-10-01), celle
# d'apps/admin/app avec la sienne (2026-10-02), jamais après : une exemption ajoutée plus tard pour
# faire passer du code neuf serait une régression.
# ─────────────────────────────────────────────────────────────────────────────────────────────
est_exempte() {
  case "$1" in
    # Permanente — état d'authentification (`getUser().then`), pas une lecture de données.
    "apps/web/lib/auth/useIsAuthenticated.ts") return 0 ;;
    # Permanente — copie navigateur du panier pour le badge de l'en-tête. L'écran qui fait foi,
    # /mi-viaje, relit côté serveur par getCartLines, qui lève.
    "apps/web/lib/cart/CartContext.tsx") return 0 ;;
    # Permanente — `null` y EST l'échec, affiché comme tel par /cuenta/reservas (message d'erreur
    # en ligne, `orders-load-error`), jamais une liste vide.
    "apps/web/lib/orders/getMyOrders.ts") return 0 ;;
    # Permanente — décision écrite dans le fichier : bloc de confort (« reprendre une commande »),
    # `[]` sur erreur pour ne jamais casser /mi-viaje ni /pago ; leur lecture principale lève.
    "apps/web/lib/orders/getPendingOrdersForViewer.ts") return 0 ;;
    # Dette — garde 2FA ouverte en cas d'erreur, traitée avec le 2FA.
    "apps/admin/lib/mfaGuard.ts") return 0 ;;
    # Dette — lectures de rattachement d'invitations, non traitées.
    "apps/admin/lib/invitations/resolveMissingEstablishment.ts") return 0 ;;
    # Permanente — transfert du panier anonyme à la connexion, best-effort écrit dans le fichier :
    # une erreur ne bloque jamais la connexion elle-même.
    "apps/web/app/[locale]/(auth)/entrar/LoginForm.tsx") return 0 ;;
    # Permanente — `null` y EST l'échec : jeton illisible après une commande prise, signalé au client
    # (`order_placed_unreadable`) avec reprise possible, jamais pris pour une absence.
    "apps/web/app/[locale]/(tunnel)/pago/CheckoutForm.tsx") return 0 ;;
    # Permanente — simulateur de paiement (jamais en production déclarée) : un 404 y suffit.
    "apps/web/app/api/payments/mock-checkout/route.ts") return 0 ;;
    "apps/web/app/api/payments/mock-confirm/route.ts") return 0 ;;
    # Dette — lien/QR imprimé : sur une panne, le code est lu comme inconnu et la redirection perd
    # ?ref= (attribution perdue). Correctif : garder ?ref= sur erreur, create_order revérifie le code.
    "apps/web/app/[locale]/r/[code]/route.ts") return 0 ;;
    # Dette — vérification 2FA : la liste des facteurs est relue sans son error (traitée avec le 2FA,
    # qui reprend ce fichier).
    "apps/admin/app/mfa/verify/page.tsx") return 0 ;;
  esac
  return 1
}
EXEMPTIONS=(
  "apps/web/lib/auth/useIsAuthenticated.ts"
  "apps/web/lib/cart/CartContext.tsx"
  "apps/web/lib/orders/getMyOrders.ts"
  "apps/web/lib/orders/getPendingOrdersForViewer.ts"
  "apps/admin/lib/mfaGuard.ts"
  "apps/admin/lib/invitations/resolveMissingEstablishment.ts"
  "apps/web/app/[locale]/(auth)/entrar/LoginForm.tsx"
  "apps/web/app/[locale]/(tunnel)/pago/CheckoutForm.tsx"
  "apps/web/app/[locale]/r/[code]/route.ts"
  "apps/web/app/api/payments/mock-checkout/route.ts"
  "apps/web/app/api/payments/mock-confirm/route.ts"
  "apps/admin/app/mfa/verify/page.tsx"
)

MOTIF='const \{ (data|count)(: [A-Za-z_]+)? \} = await|\.then\(\(\{ (data|count)(: [A-Za-z_]+)? \}(: [^)]*)?\)|if \((error|[A-Za-z]+Error) \|\| [^)]*\) return (\[\]|null)'

signale() { # fichier, lignes, explication
  echo "✗ $1"
  echo "$2" | sed 's/^/    /'
  echo "    → $3"
  fail=1
}

fichiers_lib() {
  find apps/web/lib apps/admin/lib apps/web/app apps/admin/app \
    \( -name node_modules -o -name .next \) -prune -o \
    -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.stories.tsx' -print 2>/dev/null | sort
}

# 4ᵉ motif : `x.count ?? …` / `x.data ?? …` dont la variable `x` n'a jamais son `error` lu dans le
# fichier, ni n'est passée à `checkedRead`. Ligne rapportée dans le texte sans commentaires.
VARIABLE_NON_CONTROLEE='
  my $s = $_;
  while ($s =~ /\b([A-Za-z_]\w*)\.(count|data)\s*\?\?/g) {
    my ($v, $champ, $pos) = ($1, $2, $-[0]);
    next if $s =~ /\b\Q$v\E\.error\b/ || $s =~ /checkedRead\(\s*\Q$v\E\b/;
    my $ligne = (substr($s, 0, $pos) =~ tr/\n//) + 1;
    print "$ligne:$v.$champ ?? (ni $v.error ni checkedRead($v))\n";
  }'

echo "== Résultat Supabase lu sans son error (apps/*/lib, apps/*/app) =="
while IFS= read -r f; do
  est_exempte "$f" && continue
  sans_commentaires="$(perl -0777 -p "$SANS_COMMENTAIRES" "$f")"
  hits="$(printf '%s\n' "$sans_commentaires" | grep -nE "$MOTIF" || true)"
  variables="$(printf '%s\n' "$sans_commentaires" | perl -0777 -ne "$VARIABLE_NON_CONTROLEE")"
  [ -n "$variables" ] && hits="$(printf '%s\n%s' "$hits" "$variables" | sed '/^$/d')"
  [ -z "$hits" ] && continue
  signale "$f" "$hits" \
    "Lire aussi \`error\` et lever (motif de lib/catalog/buscar.ts, ou checkedRead côté admin) — ou rendre un échec explicite : une panne n'est jamais une absence."
done < <(fichiers_lib)

echo
echo "== Exemption devenue sans objet =="
for f in "${EXEMPTIONS[@]}"; do
  if [ ! -f "$f" ]; then
    signale "$f" "(fichier absent)" "Retirer cette exemption de scripts/check-supabase-errors.sh."
    continue
  fi
  hits="$(perl -0777 -p "$SANS_COMMENTAIRES" "$f" | grep -nE "$MOTIF" || true)"
  [ -n "$hits" ] && continue
  signale "$f" "(plus aucune lecture concernée)" \
    "Bonne nouvelle : retirer cette exemption de scripts/check-supabase-errors.sh — la liste ne fait que rétrécir."
done

echo
echo "== loading.tsx sous apps/web/app =="
while IFS= read -r f; do
  signale "$f" "(fichier présent)" \
    "Pas de loading.tsx au-dessus d'un segment qui lit Supabase : ses 500 deviendraient des 200 streamés (.claude/rules/apps.md)."
done < <(find apps/web/app \( -name node_modules -o -name .next \) -prune -o -type f -name 'loading.tsx' -print 2>/dev/null | sort)

echo
if [ "$fail" -eq 0 ]; then
  echo "✓ Aucune lecture Supabase de lib/ ni des pages des deux apps ne confond panne et absence, aucun loading.tsx en vitrine."
else
  echo "✗ Voir ci-dessus. La liste des exemptions doit RÉTRÉCIR, jamais grandir."
fi
exit $fail
