import { Link } from "@/i18n/navigation";
import { Aviso } from "@/components/molecules/Aviso";
import type { PendingOrderForViewer } from "@/lib/orders/getPendingOrdersForViewer";

// Partagé entre `/mi-viaje` et `/pago` : les deux affichent ce bloc dans les mêmes conditions
// (panier vide ET au moins une commande encore ouverte pour la même identité). Colocalisé à la
// racine de `(tunnel)/` plutôt que remonté dans `components/organisms/` — même précédent que
// `CoquillaTunel.tsx`, déjà ici, consommé par les deux écrans du dossier.
//
// ⚠️ SERVER COMPONENT, et il le reste : n'importe rien de `@hifago/ui` (barrel interdit dans un
// fichier de route par transitivité, `.claude/rules/apps.md`), `Link` de `@/i18n/navigation` est
// SSR-compatible sans `"use client"` (précédent réel : `cuenta/reservas/OrderCard.tsx`).
//
// ⚠️ Les libellés arrivent déjà résolus, jamais via un `getTranslations()` interne : `CartPage` et
// `CheckoutPage` sont deux namespaces i18n séparés (`apps.md`, aucune clé partagée) — ce fichier ne
// peut pas décider lui-même dans lequel lire, chaque appelant résout dans le sien.
export type PendingOrdersNoticeProps = {
  orders: PendingOrderForViewer[];
  title: string;
  linkLabel: (reference: string) => string;
};

export function PendingOrdersNotice({ orders, title, linkLabel }: PendingOrdersNoticeProps) {
  if (orders.length === 0) return null;

  return (
    <Aviso tono="info" titulo={title} testId="pending-orders">
      <ul className="flex flex-col gap-2">
        {orders.map((order) => (
          <li key={order.id}>
            <Link
              href={`/reserva/${order.accessToken}`}
              data-testid={`pending-order-link-${order.reference}`}
              className="underline underline-offset-2"
            >
              {linkLabel(order.reference)}
            </Link>
          </li>
        ))}
      </ul>
    </Aviso>
  );
}
