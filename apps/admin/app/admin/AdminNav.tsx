"use client";

import { AppNavShell } from "@hifago/ui";
import { LogoHifago } from "@/components/logo-hifago";
import { LogoutButton } from "@/components/LogoutButton";
import { getAdminNavItems } from "./nav-items";

// Wrapper local autour d'AppNavShell (packages/ui) — jamais importer "@hifago/ui" directement
// depuis layout.tsx (Server Component) : constaté à la compilation (`next build`) que ça fait
// planter la collecte de page data sur les routes dynamiques ("(0, g.createContext) is not a
// function") ; même patron que l'ancien AdminSidebar.tsx/PartnerNav.tsx, qui n'étaient jamais
// importés que via un fichier local "use client".
export function AdminNav({ pendingProposalsCount }: { pendingProposalsCount: number }) {
  return (
    <AppNavShell
      navItems={getAdminNavItems(pendingProposalsCount)}
      ariaLabel="Navegación admin"
      fallbackTitle="Hifago admin"
      testIds={{
        desktopNav: "admin-sidebar",
        desktopLinkPrefix: "sidebar-link",
        mobileTrigger: "admin-mobile-nav-trigger",
        mobileTitle: "admin-mobile-nav-title",
        mobileLinkPrefix: "admin-mobile-nav-link",
      }}
      brand={<LogoHifago variante="sombre" hauteur="h-10 md:h-16" href="/admin" />}
      desktopFooter={<LogoutButton className="w-full" data-testid="logout-button-nav" />}
      mobileFooter={<LogoutButton className="w-full" data-testid="logout-button-mobile-nav" />}
    />
  );
}
