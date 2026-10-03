import { Price } from "@/components/atoms/Price";
import type { Locale } from "@/messages";

export type MontanteLigne = { label: string; amountCop: number; testId: string };

/**
 * Les montants d'UNE prestation, en colonne à droite de son identité : une `<dl>` parce que ce
 * sont des couples libellé/valeur, jamais deux `<span>` alignés à la main.
 *
 * ⚠️ Le balisage était recopié à l'identique entre `/cuenta/reservas` (`OrderCard`, payé + total,
 * décision ④ spec 34) et l'écran de résultat (`OrderResult`, total + reste dû, décision Gabriel du
 * 2026-09-16) — mêmes classes responsive, jusqu'au `testId` `line-total-<id>` présent des deux
 * côtés. Le SEUL écart réel entre les deux écrans est la paire de montants affichée : c'est donc
 * la seule chose que ce composant prend en paramètre. Les deux écrans doivent se ressembler, et
 * c'est maintenant structurel plutôt que surveillé à la relecture.
 *
 * ⚠️ Deux montants, jamais trois : un troisième alourdirait une carte qui en porte déjà deux par
 * prestation (décision ④). Rien ne l'interdit techniquement — c'est une règle de lisibilité.
 *
 * Plan 41, P8 : 14 px au lieu de 12, libellé discret, montant en Poppins 600 (chiffres tabulaires,
 * posés par `Price`) — c'est le montant qu'on cherche, pas le libellé. Le résultat de
 * réservation (P7) en hérite.
 *
 * Les libellés arrivent DÉJÀ TRADUITS : une molécule ne traduit rien (convention du dépôt, cf.
 * `atoms/Field.tsx`), les deux écrans n'utilisant d'ailleurs pas le même namespace.
 */
export function MontantsLigne({
  montants,
  locale,
}: {
  montants: MontanteLigne[];
  locale: Locale;
}) {
  return (
    <dl className="flex shrink-0 flex-col gap-1 text-sm sm:text-right">
      {montants.map((montant) => (
        <div key={montant.testId} className="flex gap-2 sm:justify-end">
          <dt className="text-muted">{montant.label}</dt>
          <dd className="font-semibold">
            <Price amountCop={montant.amountCop} locale={locale} testId={montant.testId} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
