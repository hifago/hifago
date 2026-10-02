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
#
# ET L'EXPIRATION (contrôle ajouté avec la migration 20261002185102) : une commande impayée expire
# 30 min après sa création. Ce « 30 » vit dans ORDER_EXPIRY_MINUTES (client.ts) et dans trois
# fonctions SQL : reconcile_order, expire_payment_order, claim_orders_to_reconcile. Ils doivent être
# égaux, et la limite de paiement doit rester STRICTEMENT avant l'expiration : sinon un paiement
# ouvert à la dernière minute arrive sur une commande déjà détruite. Non contrôlés ici : les textes
# affichés au client qui disent « 30 minutos / 30 minutes » (messages es/en).
# Une colonne générée aurait gardé UN seul littéral, mais timestamptz + interval est STABLE :
# Postgres la refuse. D'où ce contrôle (CLAUDE.md §11.20).
#
# ÉCHEC FERMÉ : une valeur introuvable (constante renommée, écrite autrement) est une erreur, jamais
# un succès silencieux. Chaque motif doit apparaître exactement une fois.
#
# CÔTÉ SQL, la valeur lue est celle de la DERNIÈRE migration qui CRÉE ou REDÉFINIT la fonction — en
# majuscules comme `pg_get_functiondef` l'écrit (règle 7), avec ou sans `public.`, guillemets ou non ;
# un `revoke`/`grant`/`comment on function` ultérieur n'est pas une définition et n'est pas lu. Les
# commentaires `--` du corps sont retirés avant lecture (un ancien littéral cité en commentaire n'est
# pas la valeur vivante) ; une fonction supprimée ou renommée par une migration POSTÉRIEURE à sa
# dernière définition rend la valeur illisible (exit 2), jamais la valeur morte.
set -uo pipefail

racine="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$racine"

ts_fichier="apps/web/lib/mercadopago/client.ts"
deno_fichier="supabase/functions/payments-reconcile/index.ts"
# Classes `[.]` et `[(]` plutôt que des antislashs : `awk -v` les retirerait. Ancré en début de ligne :
# un commentaire qui cite la fonction n'est pas une définition.
definition_de() {
  printf '%s' '^[[:space:]]*create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?function[[:space:]]+("?public"?[.])?"?'"$1"'"?[[:space:]]*[(]'
}
definition="$(definition_de order_payment_deadline)"
sql_fichier="$(grep -i -l -E "$definition" supabase/migrations/*.sql 2>/dev/null | sort | tail -1)"

# Le corps (en minuscules) de la DERNIÈRE migration qui crée ou redéfinit la fonction $1 : du
# `create … function nom(` jusqu'au second délimiteur `$…$` (ouverture puis fermeture du corps, quel
# que soit le style : `as $$ … $$;`, `AS $function$ … $function$` puis `;` à la ligne) ; awk
# portable (BSD sur macOS, GNU en CI). Vide si aucune migration ne la définit.
# La dernière migration qui crée ou redéfinit la fonction $1 — vide si aucune, ou si une migration
# postérieure la supprime (`drop function`, seule ou dans une liste, `cascade` ou non) ou la renomme
# ou la déplace (`alter function … rename` / `set schema`). Ces migrations sont lues INSTRUCTION par
# instruction (minuscules, commentaires `--` et `/* */` retirés, lignes jointes, découpe sur `;`) :
# une instruction écrite sur plusieurs lignes est vue.
instructions() {
  tr '[:upper:]' '[:lower:]' < "$1" | sed -E 's/--.*$//' | tr '\n' ' ' |
    sed -E 's#/[*]([^*]|[*]+[^*/])*[*]+/# #g' | tr ';' '\n'
}

fichier_de() {
  local def fichier suivant nom
  def="$(definition_de "$1")"
  nom="$1"
  fichier="$(grep -i -l -E "$def" supabase/migrations/*.sql 2>/dev/null | sort | tail -1)"
  [ -n "$fichier" ] || return 0
  for suivant in supabase/migrations/*.sql; do
    [[ "$suivant" > "$fichier" ]] || continue
    if instructions "$suivant" | grep -q -E \
         -e "^[[:space:]]*drop[[:space:]]+function[[:space:]](.*[^a-z0-9_])?${nom}([^a-z0-9_]|\$)" \
         -e "^[[:space:]]*alter[[:space:]]+function[[:space:]]+(\"?public\"?[.])?\"?${nom}([^a-z0-9_].*)?[[:space:]](rename|set[[:space:]]+schema)([^a-z0-9_]|\$)"; then
      return 0
    fi
  done
  printf '%s' "$fichier"
}

corps_de() {
  local def fichier
  def="$(definition_de "$1")"
  fichier="$(fichier_de "$1")"
  [ -n "$fichier" ] || return 0
  tr '[:upper:]' '[:lower:]' < "$fichier" | sed -E 's/--.*$//' |
    awk -v def="$def" '
      !dedans && $0 ~ def { dedans = 1; n = 0 }
      dedans { print; n += gsub(/\$[a-z_]*\$/, "&"); if (n >= 2) dedans = 0 }'
}

# L'unique valeur d'un motif `sed -E` dans le corps de la fonction $1 ; vide si absente, multiple, ou
# si la fonction a été supprimée ou renommée depuis.
unique_sql() {
  local valeurs
  valeurs="$(corps_de "$1" | sed -n -E "$2")"
  [ "$(printf '%s' "$valeurs" | grep -c .)" -eq 1 ] && printf '%s' "$valeurs"
}

# Extrait l'unique valeur d'un motif `sed -E` ; vide si absente ou multiple.
unique() {
  local valeurs
  valeurs="$(sed -n -E "$1" "$2" 2>/dev/null)"
  [ "$(printf '%s' "$valeurs" | grep -c .)" -eq 1 ] && printf '%s' "$valeurs"
}

ts_expiration="$(unique 's/^export const ORDER_EXPIRY_MINUTES = ([0-9]+);.*/\1/p' "$ts_fichier")"
ts_marge="$(unique 's/^export const PREFERENCE_EXPIRY_MARGIN_MINUTES = ([0-9]+);.*/\1/p' "$ts_fichier")"
deno="$(unique 's/^const PREFERENCE_LIFETIME_MS = ([0-9]+) \* 60_000;.*/\1/p' "$deno_fichier")"
sql="$(unique_sql order_payment_deadline "s/.*[a-z_]+ \+ interval '([0-9]+) minutes?'.*/\1/p")"
# L'expiration : chaque motif est propre à sa fonction (les autres intervalles, 2 min, n'y répondent pas).
exp_reconcile="$(unique_sql reconcile_order "s/.*created_at \+ interval '([0-9]+) minutes?' \+ p_expiry_margin.*/\1/p")"
exp_expire="$(unique_sql expire_payment_order "s/.*created_at >= now\(\) - interval '([0-9]+) minutes?'.*/\1/p")"
exp_claim="$(unique_sql claim_orders_to_reconcile "s/.*or o[.]created_at < now\(\) - interval '([0-9]+) minutes?'[)].*/\1/p")"

illisible=0
[ -n "$ts_expiration" ] || { echo "  ✗ $ts_fichier : ORDER_EXPIRY_MINUTES introuvable (ou en double)"; illisible=1; }
[ -n "$ts_marge" ] || { echo "  ✗ $ts_fichier : PREFERENCE_EXPIRY_MARGIN_MINUTES introuvable (ou en double)"; illisible=1; }
[ -n "$deno" ] || { echo "  ✗ $deno_fichier : PREFERENCE_LIFETIME_MS = N * 60_000 introuvable (ou en double)"; illisible=1; }
[ -n "$sql" ] || { echo "  ✗ supabase/migrations : order_payment_deadline (« p_created_at + interval 'N minutes' ») introuvable, en double, ou fonction supprimée/renommée depuis"; illisible=1; }
[ -n "$exp_reconcile" ] || { echo "  ✗ supabase/migrations : reconcile_order (« created_at + interval 'N minutes' + p_expiry_margin ») introuvable, en double, ou fonction supprimée/renommée depuis"; illisible=1; }
[ -n "$exp_expire" ] || { echo "  ✗ supabase/migrations : expire_payment_order (« created_at >= now() - interval 'N minutes' ») introuvable, en double, ou fonction supprimée/renommée depuis"; illisible=1; }
[ -n "$exp_claim" ] || { echo "  ✗ supabase/migrations : claim_orders_to_reconcile (« or o.created_at < now() - interval 'N minutes') ») introuvable, en double, ou fonction supprimée/renommée depuis"; illisible=1; }
[ "$illisible" -eq 0 ] || exit 2

ts=$((ts_expiration - ts_marge))
if [ "$ts" -ne "$deno" ] || [ "$ts" -ne "$sql" ]; then
  echo "  ✗ La limite de paiement diverge :"
  echo "      TypeScript ($ts_fichier) : $ts_expiration − $ts_marge = $ts min"
  echo "      Deno       ($deno_fichier) : $deno min"
  echo "      SQL        ($sql_fichier) : $sql min"
  exit 1
fi

if [ "$ts_expiration" -ne "$exp_reconcile" ] || [ "$ts_expiration" -ne "$exp_expire" ] || [ "$ts_expiration" -ne "$exp_claim" ]; then
  echo "  ✗ L'expiration d'une commande impayée diverge :"
  echo "      TypeScript ($ts_fichier) : ORDER_EXPIRY_MINUTES = $ts_expiration min"
  echo "      SQL reconcile_order ($(fichier_de reconcile_order)) : $exp_reconcile min"
  echo "      SQL expire_payment_order ($(fichier_de expire_payment_order)) : $exp_expire min"
  echo "      SQL claim_orders_to_reconcile ($(fichier_de claim_orders_to_reconcile)) : $exp_claim min"
  exit 1
fi

if [ "$sql" -ge "$ts_expiration" ]; then
  echo "  ✗ La limite de paiement ($sql min) doit précéder l'expiration ($ts_expiration min)"
  exit 1
fi
exit 0
