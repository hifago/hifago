import type { Metadata } from "next";
import { safeNextPath } from "@hifago/domain";
import { LoginForm } from "./LoginForm";

// Segment non localisé par next-intl (cf. docs/journal/2026-08.md) — texte en dur en espagnol,
// même convention que le reste d'apps/admin (Spanish, cf. AdminSidebar/NewInvitationForm) — pas
// le français de /partner/join, une exception isolée à ne pas propager (décision Jérôme,
// 2026-08-15). Login partagé admin+socio (sessions indépendantes d'apps/web depuis la scission
// monorepo du 2026-08-14) : pas de rôle vérifié ici, chaque garde de page
// (app/admin/layout.tsx via is_admin(), /partner/* via présence de session) reste seule
// responsable de son autorisation après connexion.
export const metadata: Metadata = {
  title: "Iniciar sesión",
};

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const resolvedSearchParams = await searchParams;
  const nextParam = resolvedSearchParams?.next;
  // Sans `next` explicite (arrivée directe sur /login, pas via une garde de page), la destination
  // par défaut est "/" — le dispatcher de app/page.tsx, qui aiguille selon le type d'utilisateur
  // une fois connecté. Jamais "/admin/establishments" en dur : un socio qui se connecterait sans
  // contexte de départ y serait renvoyé vers l'aiguillage `/` par la garde /admin — un détour
  // inutile, et jusqu'au 2026-10-01 une boucle (la garde le renvoyait au login).
  const next = safeNextPath(nextParam);

  // Feature 31 (docs/specs/07-connexion-inscription-complete.md §5) : /auth/callback redirige ici
  // avec ?error= en cas d'échec (code OAuth/token_hash invalide ou expiré, ou compte fraîchement
  // créé hors contexte d'invitation — cf. route.ts, "google_signup_blocked") — message générique
  // par type d'erreur, jamais le détail technique.
  const callbackError =
    resolvedSearchParams?.error === "google_signup_blocked"
      ? "google_signup_blocked"
      : resolvedSearchParams?.error === "auth_callback_failed"
        ? "auth_callback_failed"
        : undefined;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
      <LoginForm next={next} callbackError={callbackError} />
    </main>
  );
}
