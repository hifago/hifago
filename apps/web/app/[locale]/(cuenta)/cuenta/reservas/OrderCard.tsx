import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/atoms/Card";
import { MontantsLigne } from "@/components/molecules/MontantsLigne";
import { formatLineSchedule } from "@/lib/orders/formatLineSchedule";
import { deriveOrderState, isDeadLine } from "@/lib/orders/orderState";
import { CancelLineButton } from "./CancelLineButton";
import type { MyOrder } from "@/lib/orders/getMyOrders";
import type { Locale } from "@/messages";

// Spec 34 décision ① — une carte par COMMANDE, toutes ses prestations DÉPLIÉES dedans.
//
// Jérôme, en entretien : « si la personne prend 1 hôtel pour x jours plus des activités, ce serait
// peut-être mieux » tout déplié. La structure s'y prête — un hébergement de cinq nuits est UNE
// ligne (`date` + `end_date`), pas cinq : « 1 hôtel + 3 activités » tient en quatre lignes.
//
// ⚠️ SERVER COMPONENT, et il le reste. Il n'importe rien de `@hifago/ui` — le barrel casserait
// `next build` par transitivité (`.claude/rules/apps.md`) — seulement les atomes de la vitrine, qui
// portent eux-mêmes `"use client"` quand il le faut. C'est le montage déjà en place dans
// `(tunnel)/mi-viaje/page.tsx`. Le seul enfant client est `CancelLineButton`, qui a un état.
//
// ⚠️ AUCUN TOTAL DE COMMANDE ICI, et c'est une décision (④) : avec l'annulation par prestation, un
// total global baisserait à chaque annulation alors que rien n'est remboursé (§7/A3) — le client
// lirait « déjà payé » moins que ce qu'il a versé. Les deux montants vivent donc au niveau de la
// prestation, où ils sont figés et restent vrais même une fois la prestation annulée.

export type OrderCardProps = {
  order: MyOrder;
  locale: Locale;
};

export async function OrderCard({ order, locale }: OrderCardProps) {
  const t = await getTranslations("AccountOrdersPage");
  // Les libellés d'état et de statut de ligne sont lus depuis le namespace de l'écran de résultat,
  // JAMAIS recopiés : les mêmes sept mots en deux exemplaires divergeraient, et `parity.test.ts`
  // ne voit pas les doublons. Leur déménagement vers un namespace transverse est un lot à part
  // (spec 34 §10 pt 6) — il toucherait deux fichiers partagés avec un autre chantier en cours.
  const tEtat = await getTranslations("OrderResultPage");

  // `order.acompteCop` vient de la RPC (`order_for_client_jsonb` : sum filter (where vivante)) —
  // jamais resommé ici. Le resommer ferait vivre « ligne vivante » une seconde fois, en TypeScript,
  // en face de `DEAD_LINE_STATUSES` : c'est exactement ce que la spec 34 a centralisé.
  const state = deriveOrderState(order);
  const activeLines = order.lines.filter((line) => line.status === "reserved");

  return (
    <Card
      title={t("orderReference", { reference: order.reference })}
      titleAs="h3"
      titleSize="bloque"
      subtitle={tEtat(`status.${state}`)}
      testId={`order-card-${order.id}`}
      contentGap="md"
    >
      <ul className="flex flex-col gap-3">
        {order.lines.map((line) => {
          const isDead = isDeadLine(line.status);
          // Dernière prestation encore active : la confirmation doit alors prévenir que toute la
          // réservation va tomber. `activeLines` est calculé sur la commande entière, pas sur la
          // ligne — c'est justement l'information qu'une ligne seule ne peut pas connaître.
          const isLastActiveLine = activeLines.length === 1 && line.status === "reserved";

          return (
            <li
              key={line.id}
              data-testid={`order-line-${line.id}`}
              data-status={line.status}
              className={`flex flex-col gap-2 rounded-lg border p-3 text-sm ${
                isDead ? "border-default-200 text-muted" : "border"
              }`}
            >
              {/* Sous `md`, les montants passent SOUS le libellé plutôt qu'à sa droite : rien n'est
                  masqué selon la largeur, on réorganise (.claude/rules/ui.md). */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col">
                  <span className={`font-medium ${isDead ? "line-through" : ""}`}>
                    {line.productName}
                  </span>
                  <span className="text-muted">
                    {line.establishmentSlug ? (
                      <Link
                        href={`/establecimientos/${line.establishmentSlug}`}
                        data-testid={`establishment-link-${line.id}`}
                        className="underline underline-offset-2"
                      >
                        {line.establishmentName}
                      </Link>
                    ) : (
                      line.establishmentName
                    )}
                    {" · "}
                    {formatLineSchedule(line)}
                    {" · "}
                    {t("lineQty", { count: line.qty })}
                  </span>
                  <span className="text-xs text-muted">{tEtat(`lineStatus.${line.status}`)}</span>
                </div>

                {/* Décision ④ : ce qui a été payé POUR CETTE prestation, et son prix total. Le
                    reste dû sur place se lit par différence, et vit sur le détail — un troisième
                    montant ici alourdirait une carte qui en porte déjà deux par prestation. */}
                <MontantsLigne
                  locale={locale}
                  montants={[
                    { label: t("linePaid"), amountCop: line.acompteCop, testId: `line-paid-${line.id}` },
                    { label: t("lineTotal"), amountCop: line.totalCop, testId: `line-total-${line.id}` },
                  ]}
                />
              </div>

              {line.status === "reserved" ? (
                <CancelLineButton
                  lineId={line.id}
                  productName={line.productName}
                  dateLabel={formatLineSchedule(line)}
                  isLastActiveLine={isLastActiveLine}
                  testId={`cancel-line-${line.id}`}
                />
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* Décision ③ : le détail est /reserva/<jeton>, celui que l'email porte déjà — jamais un
          second écran de détail à tenir en parallèle. */}
      <Link
        href={`/reserva/${order.accessToken}`}
        data-testid={`order-detail-link-${order.id}`}
        className="text-sm underline underline-offset-2"
      >
        {t("viewDetail")}
      </Link>
    </Card>
  );
}
