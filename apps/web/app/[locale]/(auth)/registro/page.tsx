import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { safeNextPath } from "@hifago/domain";
import { SignupForm } from "./SignupForm";

export async function generateMetadata(
  props: Omit<PageProps<"/[locale]/registro">, "searchParams">
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "Signup" });
  // ⚠️ noindex plutôt qu'un Disallow dans robots.txt, et la distinction n'est pas cosmétique :
  // une page en Disallow n'est jamais CHARGÉE, donc sa balise noindex n'est jamais lue, et elle
  // peut finir indexée sans description si un lien externe la désigne. Disallow sert à économiser
  // du budget de crawl, noindex à empêcher l'indexation — jamais les deux sur la même page
  // (spec 26 §5.1).
  return { title: t("title"), robots: { index: false, follow: true } };
}

// Inscription libre générique (docs/01-cahier-des-charges-client.md §2, feature 32) — aucune
// capacité créée ici, un compte nu comme n'importe quel compte Supabase Auth via cet écran
// (même principe que l'ancien /signup admin, cf. SignupForm.tsx). Pas de rôle vérifié.
export default async function SignupPage({
  params,
  searchParams,
}: PageProps<"/[locale]/registro">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Signup");

  const resolvedSearchParams = await searchParams;
  const nextParam = resolvedSearchParams?.next;
  const next = safeNextPath(nextParam);

  // Spec 33 — `?email=` est posé par l'écran de résultat d'une commande (`/reserva/<jeton>`), qui
  // propose de créer un compte. Le pré-remplir n'est pas un confort : le rattachement des commandes
  // se fait PAR ADRESSE EMAIL (cahier §2b.9), donc un client qui s'inscrirait avec une autre
  // adresse ne retrouverait jamais sa réservation, sans comprendre pourquoi.
  // Le champ reste ÉDITABLE — un pré-remplissage, jamais un verrou (même règle que le checkout) —
  // et ne donne aucun droit : c'est l'email VÉRIFIÉ qui décide du rattachement, pas celui-ci.
  const emailParam = resolvedSearchParams?.email;
  const initialEmail = typeof emailParam === "string" ? emailParam : "";

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <SignupForm next={next} initialEmail={initialEmail} />
    </main>
  );
}
