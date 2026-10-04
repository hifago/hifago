"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { Title } from "@/components/atoms/Title";
import { Link } from "@/i18n/navigation";

// L'ÉCRAN D'ERREUR DE LA VITRINE — un seul, partagé par les frontières de zone `(vitrine)`,
// `(tunnel)` et `(cuenta)`, et par `app/global-error.tsx` (spec 27 § « Cas limites »).
//
// POURQUOI IL EXISTE. Les lectures de `lib/` lèvent franchement quand Supabase répond une erreur, et
// c'est une décision : « un catalogue vide rendu comme un catalogue normal est pire qu'une erreur —
// le client croit qu'il n'y a rien à vendre » (spec 27 §9). Il en va de même d'un panier, d'une
// commande ou d'un profil lus en panne. Sans cet écran, l'échec franc rendait la page d'erreur NUE
// de Next : ni traduite, ni habillée.
//
// ⚠️ `"use client"` n'est pas un choix : Next l'exige de tout `error.tsx`, qui doit s'attacher à une
// frontière d'erreur React côté navigateur. Les actions passent par les mêmes variantes que le reste
// de la vitrine (plan 41, P11), mais l'écran ne lit aucune donnée : il reste affichable quand la base
// est justement la source de la panne.
//
// ⚠️ Il ne rend PAS la coquille : une frontière de zone est rendue À L'INTÉRIEUR du layout de sa
// zone, l'en-tête y est déjà — le rendre une seconde fois donnerait deux en-têtes. Il pose en
// revanche l'unique `<main>` de la page (aucun des layouts de zone n'en pose), nu, sur la même
// largeur de lecture que les pages `pagina` : `PageShell` n'est pas importable ici sans risquer de
// faire échouer l'écran d'erreur lui-même sur le même défaut.
//
// ⚠️ `retry`, jamais `reset`. `reset()` ne fait que remonter le sous-arbre côté navigateur : sur une
// erreur levée par un Server Component, il réaffiche le même échec. `retry()` (Next 16) relance la
// lecture serveur (`router.refresh()`) avant de remonter le sous-arbre — c'est le seul « réessayer »
// qui ait un sens après une panne passagère de la base.

export function ErrorScreen({
  error,
  retry,
  zone,
  testId,
  inicioHref,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  /** Étiquette du journal navigateur (`[vitrine]`, `[tunnel]`…), jamais affichée. */
  zone: string;
  testId: string;
  /**
   * Seulement pour `global-error.tsx`, rendu HORS du routage localisé : lien d'accueil complet
   * (`/es`, `/en`), suivi par un rechargement. Partout ailleurs, le `Link` localisé.
   */
  inicioHref?: string;
}) {
  const t = useTranslations("Common");

  // ⚠️ Le message n'est JAMAIS affiché au visiteur — il peut porter un fragment de requête SQL ou
  // un nom de table. Il part au journal du navigateur, où le `digest` permet de le rapprocher de la
  // trace serveur. Ce que le visiteur lit est un texte traduit, écrit pour lui.
  useEffect(() => {
    console.error(`[${zone}] rendu interrompu par une erreur`, error);
  }, [error, zone]);

  // Cette frontière reste volontairement indépendante du graphe HeroUI : elle doit pouvoir
  // s'afficher même si le chargement d'un composant applicatif a provoqué la panne.
  const classesAction =
    "inline-flex h-11 items-center justify-center rounded-[var(--rayon-bouton)] px-4 text-base font-semibold transition-colors focus-visible:status-focused motion-reduce:transition-none";

  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 p-6 text-center sm:p-8"
      data-testid={testId}
    >
      <Image
        src="/brand/motif-bleu-ciel.webp"
        alt=""
        width={96}
        height={103}
        sizes="96px"
        loading="lazy"
        aria-hidden="true"
        className="size-24 rounded-full object-cover opacity-70"
      />
      <div className="flex max-w-prose flex-col gap-3">
        <Title as="h1">{t("error.titulo")}</Title>
        <p className="text-muted">{t("error.descripcion")}</p>
      </div>
      <div className="flex flex-row items-center justify-center gap-3">
        <button
          type="button"
          onClick={retry}
          className={`${classesAction} bg-accent text-accent-foreground hover:bg-[var(--accent-hover)]`}
          data-testid={`${testId}-reintentar`}
        >
          {t("error.reintentar")}
        </button>
        {inicioHref ? (
          <a
            href={inicioHref}
            className={`${classesAction} bg-default text-default-foreground hover:bg-[var(--default-hover)]`}
            data-testid={`${testId}-volver`}
          >
            {t("error.volver")}
          </a>
        ) : (
          <Link
            href="/"
            className={`${classesAction} bg-default text-default-foreground hover:bg-[var(--default-hover)]`}
            data-testid={`${testId}-volver`}
          >
            {t("error.volver")}
          </Link>
        )}
      </div>
    </main>
  );
}
