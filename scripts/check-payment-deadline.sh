#!/usr/bin/env bash
# Garde-fou automatique — la limite de paiement d'une commande a la même valeur partout.
#
#   ./scripts/check-payment-deadline.sh   (depuis hifago/)   — exit 1 si les valeurs divergent,
#                                                              exit 2 si l'une d'elles est illisible.
#
# POURQUOI CE SCRIPT EXISTE. Une commande ne se paie que jusqu'à created_at + 28 min. Cette limite
# vit en TROIS langages, et aucune ne peut lire les autres :
#   - TypeScript : ORDER_EXPIRY_MINUTES − PREFERENCE_EXPIRY_MARGIN_MINUTES
#                  (apps/web/lib/mercadopago/client.ts) — refus `order_expiring` de payments/create
#                  et `expiration_date_to` de la préférence Mercado Pago ;
#   - Deno       : PREFERENCE_LIFETIME_MS (supabase/functions/payments-reconcile/index.ts) ;
#   - SQL        : public.order_payment_deadline (dernière migration qui la définit) — refus
#                  `order_expiring` de create_payment_intent et de claim_order_for_pms_booking.
# Si l'une bouge seule, la base laisse créer un paiement que payments/create refusera (ou
# l'inverse), et la reprise PMS pose chez Lobby un booking impayable (migration 20261001194704).
# Une colonne générée aurait gardé UN seul littéral, mais timestamptz + interval est STABLE :
# Postgres la refuse. D'où ce contrôle (CLAUDE.md §11.20).
#
# ÉCHEC FERMÉ : une valeur introuvable (constante renommée, écrite autrement) est une erreur, jamais
# un succès silencieux. Chaque motif doit apparaître exactement une fois.
#
# CÔTÉ SQL, la valeur lue est celle de la DERNIÈRE migration qui CRÉE ou REDÉFINIT la fonction — en
# majuscules comme `pg_get_functiondef` l'écrit (règle 7), avec ou sans `public.`, guillemets ou non ;
# un `revoke`/`grant`/`comment on function` ultérieur n'est pas une définition et n'est pas lu.
set -uo pipefail

racine="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$racine"

ts_fichier="apps/web/lib/mercadopago/client.ts"
deno_fichier="supabase/functions/payments-reconcile/index.ts"
# Classes `[.]` et `[(]` plutôt que des antislashs : `awk -v` les retirerait. Ancré en début de ligne :
# un commentaire qui cite la fonction n'est pas une définition.
definition='^[[:space:]]*create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?function[[:space:]]+("?public"?[.])?"?order_payment_deadline"?[[:space:]]*[(]'
sql_fichier="$(grep -i -l -E "$definition" supabase/migrations/*.sql 2>/dev/null | sort | tail -1)"

# Extrait l'unique valeur d'un motif `sed -E` ; vide si absente ou multiple.
unique() {
  local valeurs
  valeurs="$(sed -n -E "$1" "$2" 2>/dev/null)"
  [ "$(printf '%s' "$valeurs" | grep -c .)" -eq 1 ] && printf '%s' "$valeurs"
}

ts_expiration="$(unique 's/^export const ORDER_EXPIRY_MINUTES = ([0-9]+);.*/\1/p' "$ts_fichier")"
ts_marge="$(unique 's/^export const PREFERENCE_EXPIRY_MARGIN_MINUTES = ([0-9]+);.*/\1/p' "$ts_fichier")"
deno="$(unique 's/^const PREFERENCE_LIFETIME_MS = ([0-9]+) \* 60_000;.*/\1/p' "$deno_fichier")"
sql=""
if [ -n "$sql_fichier" ]; then
  # Du `create … function order_payment_deadline(` jusqu'au second délimiteur `$…$` (ouverture puis
  # fermeture du corps, quel que soit le style : `as $$ … $$;`, `AS $function$ … $function$` puis `;`
  # à la ligne), en minuscules ; awk portable (BSD sur macOS, GNU en CI).
  sql="$(tr '[:upper:]' '[:lower:]' < "$sql_fichier" |
    awk -v def="$definition" '
      !dedans && $0 ~ def { dedans = 1; n = 0 }
      dedans { print; n += gsub(/\$[a-z_]*\$/, "&"); if (n >= 2) dedans = 0 }' |
    sed -n -E "s/.*[a-z_]+ \+ interval '([0-9]+) minutes?'.*/\1/p")"
  [ "$(printf '%s' "$sql" | grep -c .)" -eq 1 ] || sql=""
fi

illisible=0
[ -n "$ts_expiration" ] || { echo "  ✗ $ts_fichier : ORDER_EXPIRY_MINUTES introuvable (ou en double)"; illisible=1; }
[ -n "$ts_marge" ] || { echo "  ✗ $ts_fichier : PREFERENCE_EXPIRY_MARGIN_MINUTES introuvable (ou en double)"; illisible=1; }
[ -n "$deno" ] || { echo "  ✗ $deno_fichier : PREFERENCE_LIFETIME_MS = N * 60_000 introuvable (ou en double)"; illisible=1; }
[ -n "$sql" ] || { echo "  ✗ supabase/migrations : order_payment_deadline (« p_created_at + interval 'N minutes' ») introuvable"; illisible=1; }
[ "$illisible" -eq 0 ] || exit 2

ts=$((ts_expiration - ts_marge))
if [ "$ts" -ne "$deno" ] || [ "$ts" -ne "$sql" ]; then
  echo "  ✗ La limite de paiement diverge :"
  echo "      TypeScript ($ts_fichier) : $ts_expiration − $ts_marge = $ts min"
  echo "      Deno       ($deno_fichier) : $deno min"
  echo "      SQL        ($sql_fichier) : $sql min"
  exit 1
fi
exit 0
