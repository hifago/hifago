"use client";

import { AppNavShell } from "@hifago/ui";
import { LogoHifago } from "@/components/logo-hifago";
import { LogoutButton } from "@/components/LogoutButton";
import { buildWhatsAppLink, SUPPORT_WHATSAPP_NUMBER } from "@/lib/whatsapp";
import { EXTRA_TITLE_ROUTES, getNavItems } from "./nav-items";

const SUPPORT_WHATSAPP_MESSAGE = "Hola Jérome, tengo un problema con mi cuenta de socio. Me puedes ayudar porfa?";

// Wrapper local autour d'AppNavShell (packages/ui) — jamais importer "@hifago/ui" directement
// depuis layout.tsx (Server Component) : constaté à la compilation (`next build`) que ça fait
// planter la collecte de page data sur les routes dynamiques ("(0, g.createContext) is not a
// function") ; même patron que l'ancien PartnerNav.tsx/PartnerMobileNav.tsx, qui n'étaient jamais
// importés que via un fichier local "use client".
export function PartnerAppNav({ hasOperatorCapability }: { hasOperatorCapability: boolean }) {
  const whatsappHref = buildWhatsAppLink(SUPPORT_WHATSAPP_NUMBER, SUPPORT_WHATSAPP_MESSAGE);

  return (
    <AppNavShell
      navItems={getNavItems(hasOperatorCapability)}
      extraTitleRoutes={EXTRA_TITLE_ROUTES}
      ariaLabel="Navegación socio"
      fallbackTitle="Hifago socio"
      testIds={{
        desktopNav: "partner-nav",
        desktopLinkPrefix: "partner-nav-link",
        mobileTrigger: "partner-mobile-nav-trigger",
        mobileTitle: "partner-mobile-nav-title",
        mobileLinkPrefix: "partner-mobile-nav-link",
      }}
      brand={<LogoHifago variante="sombre" hauteur="h-10 md:h-16" href="/partner" />}
      desktopFooter={
        <>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="partner-nav-whatsapp"
            className="rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
          >
            WhatsApp Hifago
          </a>
          <LogoutButton className="w-full" data-testid="logout-button-nav" />
        </>
      }
      mobileFooter={
        <>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="partner-mobile-nav-whatsapp"
            className="rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-secondary"
          >
            WhatsApp Hifago
          </a>
          <LogoutButton className="w-full" data-testid="logout-button-mobile-nav" />
        </>
      }
    />
  );
}
