import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { LogoHifago } from "@/components/atoms/LogoHifago";

// Zone AUTH — connexion, inscription, vérification, mot de passe (spec 27 §0). Jamais indexée.
//
// `follow: true` volontaire : la page ne doit pas être indexée, mais ses liens (retour à l'accueil,
// bascule connexion/inscription) doivent rester suivis. `Disallow` et `noindex` ne se cumulent
// jamais sur une même page — `.claude/rules/seo.md` point 5.

export const metadata: Metadata = { robots: { index: false, follow: true } };

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Le mot-marque était écrit en TEXTE ici (« Hifago », en pile système) tant que le logo
          n'existait pas. Depuis la charte du 2026-10-01 il n'y a plus de raison : cette zone porte
          le même logo que le reste du site. `aria-label` parce que le logo est décoratif —
          l'atome ne porte aucun texte, c'est le lien qui nomme la destination. */}
      <header className="px-4 py-3">
        <Link href="/" aria-label="Hifago" className="inline-flex min-h-11 items-center">
          <LogoHifago />
        </Link>
      </header>
      {children}
    </>
  );
}
