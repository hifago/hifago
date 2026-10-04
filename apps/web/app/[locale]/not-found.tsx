import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { CoquillaVitrine } from "./(vitrine)/CoquillaVitrine";
import { COLUMNA_PORTADA, PageShell } from "@/components/atoms/PageShell";
import { Title } from "@/components/atoms/Title";
import { LinkButton } from "@/components/atoms/LinkButton";
import { MenuTiposPortada } from "@/components/organisms/MenuTiposPortada";
import { tiposDeBarra } from "./(vitrine)/tiposDeBarra";
import type { Locale } from "@/messages";

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
  const locale = (await getLocale()) as Locale;
  const [t, tCommon, tipos] = await Promise.all([
    getTranslations("NotFound"),
    getTranslations("Common"),
    tiposDeBarra(locale, ""),
  ]);

  return (
    <CoquillaVitrine>
      <PageShell variant="portada" fondo="acento" testId="not-found-page">
        <div
          className={`${COLUMNA_PORTADA} @container relative flex flex-1 overflow-hidden py-12 sm:py-16`}
        >
          <Image
            src="/brand/calle-zocalos-auth.webp"
            alt=""
            width={900}
            height={600}
            sizes="(min-width: 1024px) 560px, 90vw"
            loading="lazy"
            aria-hidden="true"
            className="pointer-events-none absolute right-[-20%] bottom-[-18%] w-[min(90vw,35rem)] opacity-20"
          />
          <div className="relative z-10 flex max-w-3xl flex-col items-start gap-6">
            <div className="flex max-w-prose flex-col gap-3">
              <Title as="h1">{t("title")}</Title>
              <p>{t("body")}</p>
            </div>
            <LinkButton href="/" color="marine" size="lg" testId="not-found-home">
              {t("backHome")}
            </LinkButton>
            <MenuTiposPortada
              tipos={tipos}
              etiqueta={tCommon("selectorTipoEtiqueta")}
              testId="not-found-types"
            />
          </div>
        </div>
      </PageShell>
    </CoquillaVitrine>
  );
}
