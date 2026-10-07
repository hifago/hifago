import Link from "next/link";

// Bandeau compact de l'accueil socio, quand toutes les capacités sont actives (partnerHomeHeader).
// Prestataire : son établissement. Référent seul : son code (page « Mi enlace y QR », qui liste
// ses codes, son lien et son QR) et ses commissions (décision de Gabriel, 2026-10-07).
// N'importe rien de @hifago/ui : rendu tel quel depuis le Server Component de la page.

const LIENS = {
  provider: {
    label: "Prestador activo",
    testId: "partner-status-compact",
    links: [{ href: "/partner/establishment", label: "Mi establecimiento" }],
  },
  referrer: {
    label: "Referente activo",
    testId: "partner-status-referrer",
    links: [
      { href: "/partner/tools", label: "Mi enlace y QR" },
      { href: "/partner/commissions", label: "Mis comisiones" },
    ],
  },
} as const;

export function PartnerHomeBanner({ kind }: { kind: keyof typeof LIENS }) {
  const { label, testId, links } = LIENS[kind];
  // Sous `sm`, les liens passent sous le libellé : rien n'est masqué selon la largeur.
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-border bg-surface px-4 py-2">
      <span className="text-sm font-medium" data-testid={testId}>
        {label}
      </span>
      <nav aria-label={label} className="flex flex-wrap gap-x-4 gap-y-1">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="text-sm hover:underline">
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
