import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CoquillaVitrine } from "./(vitrine)/CoquillaVitrine";
import { Title } from "@/components/atoms/Title";

// La 404 de la vitrine (spec 28 §0). `apps/web` n'en avait AUCUNE : un slug inconnu rendait la page
// nue de Next, ni traduite ni habillée — point ouvert relevé par la spec 26 §10.
//
// ⚠️ Placée au niveau de `[locale]`, PAS dans le groupe `(vitrine)`. Un `not-found.tsx` dans un
// groupe ne couvre que les `notFound()` appelés par les pages de ce groupe — une URL entièrement
// inconnue (`/es/nimportequoi`) ne correspond à aucun segment du groupe et retombe sur la 404 nue
// de Next. Ici elle couvre les deux cas, et rend elle-même la coquille pour garder l'en-tête et le
// pied de page.
//
// Sobre, volontairement : en-tête et pied de page rendus ici, un message
// traduit, un lien vers l'accueil. Pas de bloc de recherche, et surtout **jamais une redirection
// vers la catégorie** : Google traite ça comme un « soft 404 » et ça rend le débogage plus difficile
// (décision du 2026-09-07).
//
// ⚠️ Ce fichier n'importe rien de `@hifago/ui` : il est rendu par la coquille, donc côté serveur.

export default async function NoEncontrado() {
  const t = await getTranslations("NotFound");

  return (
    <CoquillaVitrine>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-4 p-8 text-center">
      <Title as="h1">{t("title")}</Title>
      <p className="text-muted">{t("body")}</p>
      <Link href="/" className="underline">
        {t("backHome")}
      </Link>
      </main>
    </CoquillaVitrine>
  );
}
