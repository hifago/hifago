import type { ProductType } from "@/lib/products/useProductTypeFieldsState";

// Miroir côté client de la même règle appliquée côté serveur, SOURCE DE VÉRITÉ :
// `create_manual_order_line`, dernière définition dans
// supabase/migrations/20261006203542_manual_order_line_evento.sql
// (`if v_product_type in ('lodging', 'camp') then ... unsupported_product_type`) — 'lodging'
// (chambre/tarif par nuit, hors périmètre d'une réservation manuelle walk-in) et 'camp' (séjour
// multi-jours sur la ressource partagée, toujours exclu). Depuis cette migration, la ressource
// partagée et le blocage d'agenda SONT répliqués pour un evento qui l'occupe (refus
// `resource_unavailable`) : l'evento est donc éligible, le camp ne l'est toujours pas. Ce littéral
// n'existe qu'ici côté TS : toute divergence future avec la migration SQL doit
// être répercutée aux deux endroits à la main (pas de dérivation automatique depuis un signal
// serveur — hors périmètre de ce nettoyage, cf. AGENTS.md/le commentaire de page.tsx qui l'utilise).
// `hotel` retiré de cette liste le 2026-08-27 avec l'étage lui-même (T3) : le type n'existe plus,
// ni côté application ni dans le filtre de la RPC.
export const MANUAL_ORDER_INELIGIBLE_TYPES: readonly ProductType[] = ["lodging", "camp"];
