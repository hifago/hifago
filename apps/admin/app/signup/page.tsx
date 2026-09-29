import { redirect } from "next/navigation";
import { safeNextPath } from "@hifago/domain";

// Feature 31 — révision 2026-08-19 (docs/specs/07-connexion-inscription-complete.md §10) :
// inscription libre bloquée (supabase/config.toml enable_signup=false, décision Jérôme). Route
// conservée (jamais un 404 pour un vieux lien déjà partagé), redirige vers /login en préservant
// `next` si présent.
export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const resolvedSearchParams = await searchParams;
  const nextParam = resolvedSearchParams?.next;
  const next = safeNextPath(nextParam);

  redirect(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
}
