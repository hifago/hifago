import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/atoms/Card";
import { MontantsLigne } from "@/components/molecules/MontantsLigne";
import { EnlaceGo } from "@/components/atoms/EnlaceGo";
import { PuceEstado, TONO_POR_ESTADO_PEDIDO, tonoDeLinea } from "@/components/atoms/PuceEstado";
import { formatLineScheduleLisible } from "@/lib/orders/formatLineSchedule";
import { computeTripRange, formatTripLabel } from "@/lib/orders/tripRange";
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

  const tripLabel = formatTripLabel(computeTripRange(order.lines), locale, tEtat);

  // Plan 41, P8 : en-tête = référence (`titre-bloc`), puis la puce d'état (S7) et les dates du
  // voyage ; lignes à séparateurs (F6) ; pied = « GO → » vers le détail (S5).
  return (
    <Card
      title={t("orderReference", { reference: order.reference })}
      titleAs="h3"
      titleSize="bloque"
      testId={`order-card-${order.id}`}
      contentGap="md"
      padding="lg"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PuceEstado tono={TONO_POR_ESTADO_PEDIDO[state]} testId={`order-state-${order.id}`}>
          {tEtat(`status.${state}`)}
        </PuceEstado>
        <span className="text-sm font-medium text-muted" data-testid={`order-trip-${order.id}`}>
          {tripLabel}
        </span>
      </div>

      {/* Plan 41, F6 : des rangées séparées par le filet `--separator`, plus des boîtes bordées
          de marine dans la carte bordée de marine. Même balisage que `CartSummary` et
          `OrderResult`. Une prestation annulée ne se signale plus par une bordure pâle : son
          texte grisé, son nom barré et sa puce d'état le disent. */}
      <ul className="flex flex-col divide-y divide-separator">
        {order.lines.map((line) => {
          const isDead = isDeadLine(line.status);
          // Dernière prestation encore active : la confirmation doit alors prévenir qu'il n'en
          // restera aucune en attente. `activeLines` est calculé sur la commande entière, pas sur la
          // ligne — c'est justement l'information qu'une ligne seule ne peut pas connaître.
          const isLastActiveLine = activeLines.length === 1 && line.status === "reserved";
          const fecha = formatLineScheduleLisible(line, locale);

          return (
            <li
              key={line.id}
              data-testid={`order-line-${line.id}`}
              data-status={line.status}
              className={`flex flex-col gap-2 py-4 first:pt-0 last:pb-0 ${isDead ? "text-muted" : ""}`}
            >
              {/* Sous `sm`, les montants passent SOUS le libellé plutôt qu'à sa droite : rien n'est
                  masqué selon la largeur, on réorganise (.claude/rules/ui.md). */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className={`text-base font-semibold ${isDead ? "line-through" : ""}`}>
                    {line.productName}
                  </span>
                  <span className="text-sm text-muted">
                    {line.establishmentSlug ? (
                      <Link
                        href={`/establecimientos/${line.establishmentSlug}`}
                        data-testid={`establishment-link-${line.id}`}
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        {line.establishmentName}
                      </Link>
                    ) : (
                      line.establishmentName
                    )}
                    {" · "}
                    {fecha}
                    {" · "}
                    {t("lineQty", { count: line.qty })}
                  </span>
                  <span className="pt-1">
                    <PuceEstado tono={tonoDeLinea(line.status)} testId={`line-status-${line.id}`}>
                      {tEtat(`lineStatus.${line.status}`)}
                    </PuceEstado>
                  </span>
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

              {/* Rendu pour CHAQUE ligne : il ne montre rien si elle n'est pas annulable, mais garde
                  son message après une annulation (voir l'en-tête de CancelLineButton). */}
              <CancelLineButton
                lineId={line.id}
                productName={line.productName}
                dateLabel={fecha}
                isLastActiveLine={isLastActiveLine}
                cancellable={line.cancellable}
                // Acompte acquis (décidé en base) ET non nul : une prestation à acompte nul (evento
                // gratuit, paiement sur place) n'a rien encaissé à garder.
                depositRetained={line.depositKeptOnCancel && line.acompteCop > 0}
                testId={`cancel-line-${line.id}`}
              />
            </li>
          );
        })}
      </ul>

      {/* Décision ③ : le détail est /reserva/<jeton>, celui que l'email porte déjà — jamais un
          second écran de détail à tenir en parallèle. Le nom accessible dit la référence : dix
          « GO » vers dix commandes ne doivent pas porter le même nom (S5). */}
      <div className="flex justify-end border-t border-separator pt-2">
        <EnlaceGo
          href={`/reserva/${order.accessToken}`}
          label={t("viewDetail", { reference: order.reference })}
          tamano="normal"
          testId={`order-detail-link-${order.id}`}
        />
      </div>
    </Card>
  );
}
