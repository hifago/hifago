import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/atoms/PageShell";
import { Title } from "@/components/atoms/Title";
import { BandeauPagina } from "@/components/organisms/BandeauPagina";
import { identidadCompleta, rellenarIdentidad, VIGENCIA_TEXTOS_LEGALES } from "@/lib/legal/identidad";
import { buildPageMetadata } from "@/lib/seo/pageMetadata";
import type { Locale } from "@/messages";

// La page commune aux cinq pages institutionnelles (aviso legal, condiciones, privacidad, ayuda,
// contacto — cahier client §1, règle du 2026-08-11). Le texte vit dans `messages/<locale>/Legal.json`,
// une clé par page ; ce composant ne fait que le mettre en page.
//
// Une section = un `<h2>` puis, dans cet ordre : paragraphes, liste, paragraphes de suite, liens
// externes. L'ordre est fixe : un texte juridique se lit de haut en bas, aucune section n'a besoin
// d'un autre agencement.
//
// ⚠️ Composant SERVEUR : il n'importe rien de `@hifago/ui` (CLAUDE.md §11.16). Le lien e-mail de
// la page de contact arrive déjà rendu par `avantSections`.

export type SeccionInstitucional = {
  titulo: string;
  parrafos?: string[];
  lista?: string[];
  parrafos2?: string[];
  enlaces?: { texto: string; href: string }[];
};

export type CleInstitucionnelle = "legal" | "terminos" | "privacidad" | "ayuda" | "contacto";

/** Métadonnées d'une page institutionnelle : `noindex` tant que l'identité légale est incomplète. */
export async function metadataInstitucional(cle: CleInstitucionnelle, locale: Locale): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "Legal" });
  const metadata = buildPageMetadata({
    locale,
    pathFor: (l) => `/${l}/${cle}`,
    title: t(`${cle}.metaTitle`),
    description: t(`${cle}.metaDescription`),
  });
  // Une page légale qui affiche « [por completar] » à la place du NIT ne doit pas être indexée.
  // Le sitemap applique le même prédicat (`app/sitemap.ts`).
  return identidadCompleta() ? metadata : { ...metadata, robots: { index: false, follow: true } };
}

export async function PaginaInstitucional({
  cle,
  locale,
  avantSections,
}: {
  cle: CleInstitucionnelle;
  locale: Locale;
  /** Contenu rendu entre le bandeau et la première section (lien e-mail du contact). */
  avantSections?: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: "Legal" });
  const pendiente = t("pendiente");
  const rellenar = (texto: string) => rellenarIdentidad(texto, pendiente);
  const secciones = t.raw(`${cle}.secciones`) as SeccionInstitucional[];

  // Midi à Bogotá : la date ne glisse jamais d'un jour selon le fuseau du serveur.
  const fecha = new Intl.DateTimeFormat(locale === "es" ? "es-CO" : "en-US", {
    dateStyle: "long",
    timeZone: "America/Bogota",
  }).format(new Date(`${VIGENCIA_TEXTOS_LEGALES}T12:00:00-05:00`));

  return (
    <PageShell variant="pagina" testId={`institucional-${cle}`}>
      <BandeauPagina
        variante="contenido"
        titulo={t(`${cle}.titulo`)}
        chapo={t(`${cle}.chapo`)}
        testId={`institucional-${cle}-bandeau`}
      />

      <div className="flex max-w-prose flex-col gap-8">
        <p className="text-sm text-muted" data-testid={`institucional-${cle}-actualizado`}>
          {t("actualizado", { fecha })}
        </p>

        {avantSections}

        {secciones.map((seccion) => (
          <section key={seccion.titulo} className="flex flex-col gap-3">
            <Title as="h2" size="bloque">
              {seccion.titulo}
            </Title>
            {seccion.parrafos?.map((parrafo) => <p key={parrafo}>{rellenar(parrafo)}</p>)}
            {seccion.lista ? (
              <ul className="flex list-disc flex-col gap-2 pl-5">
                {seccion.lista.map((item) => (
                  <li key={item}>{rellenar(item)}</li>
                ))}
              </ul>
            ) : null}
            {seccion.parrafos2?.map((parrafo) => <p key={parrafo}>{rellenar(parrafo)}</p>)}
            {seccion.enlaces?.map((enlace) => (
              // Lien externe (autorité publique) : un `<a>` nu est voulu, le `Link` localisé de
              // `@/i18n/navigation` ne sert qu'aux pages du site.
              <a
                key={enlace.href}
                href={enlace.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center self-start font-semibold underline underline-offset-4"
              >
                {enlace.texto}
                <span className="sr-only"> {t("enlaceExterno")}</span>
              </a>
            ))}
          </section>
        ))}
      </div>
    </PageShell>
  );
}
