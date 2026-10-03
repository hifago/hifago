import { Link } from "@/i18n/navigation";

// Le lien de retour au catalogue (2026-09-01, vague 1 des atomes, prompts/vague1-agent-A.md §3.3).
// Remplace un motif écrit deux fois à l'identique — ProductDetailView.tsx:113 et
// EstablishmentDetailView.tsx:59 — auquel il ajoute les deux choses qui justifient qu'il devienne
// un composant :
//
//   1. ⚠️ Le `Link` de "@/i18n/navigation", jamais `next/link` ni `<a href>` : lui seul conserve le
//      préfixe de locale. C'est la règle la plus facile à violer sans que rien ne le signale — un
//      `<a href="/">` renvoie un hispanophone sur une page qui perd sa langue. Un composant la rend
//      vraie par construction plutôt que par vigilance.
//   2. Cible tactile ≥ 44 px (components/README.md) : le lien d'origine est une ligne de texte de
//      14 px, impossible à viser au pouce. `min-h-11` = 44 px.
//
// LA FLÈCHE (plan 41, item C4, 2026-10-02) : un SVG décoratif de 16 px devant le libellé,
// `aria-hidden` — le libellé (« Volver al catálogo ») reste compréhensible sans elle, et c'est lui
// seul qui fait le nom accessible. Elle était jusque-là ÉCRITE dans le message (« ← Volver… ») :
// un caractère que le lecteur d'écran prononce (« flèche gauche »), retiré des deux langues.
//
// Typographie et couleur de la charte : Poppins 500, 15 px ; `--link`, que la SURFACE règle —
// marine sur l'or (le bandeau des pages intérieures, S2), bleu moyen sur le clair.
//
// ⚠️ `self-start` n'est pas de la mise en page empruntée au parent, c'est l'atome qui RÉAFFIRME sa
// propre intention. Un enfant de conteneur flex voit son `inline-flex` blockifié, et
// `align-items: stretch` (défaut) l'étire alors sur toute la largeur : mesuré 342 px dans un
// PageShell à 390 px de viewport. Combiné à `min-h-11`, ça fait une bande cliquable de 44 px de
// haut sur toute la largeur, qui renvoie au catalogue au moindre appui dans le vide à droite du
// libellé. Le motif d'origine avait déjà le défaut, mais sur 20 px de haut ; la cible tactile le
// rend deux fois plus dangereux. Constaté par l'agent A le 2026-09-01, tranché par le
// coordinateur.
export type BackLinkProps = {
  href: string;
  /** Déjà traduit — un atome ne traduit rien. */
  label: string;
  testId?: string;
};

function FlecheRetour() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4 shrink-0"
    >
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
}

export function BackLink({ href, label, testId }: BackLinkProps) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-2 self-start text-[15px] font-medium text-link underline-offset-4 hover:underline"
      data-testid={testId}
    >
      <FlecheRetour />
      {label}
    </Link>
  );
}
