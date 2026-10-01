"use client";

import Link from "next/link";
import { useEffect } from "react";

// LA FRONTIÈRE D'ERREUR DE TOUTE L'APP (admin, socio, auth). Aucune n'existait : une lecture qui
// lève rendait la page d'erreur nue de Next, en anglais. Placée à la RACINE d'`app/` : elle couvre
// tous les segments sans toucher à leurs layouts.
//
// ⚠️ Espagnol en dur : cette app n'est pas localisée (même convention que login/page.tsx).
// ⚠️ Rien de `@hifago/ui` : un écran d'erreur qui monterait HeroUI ne pourrait plus s'afficher le
// jour où c'est justement le rendu de HeroUI qui a échoué.
// ⚠️ Le message de l'erreur n'est JAMAIS affiché (fragment SQL, nom de table) : il part au journal
// du navigateur, où le `digest` permet de le rapprocher de la trace serveur.
// ⚠️ `retry`, jamais `reset` : seul `retry()` relance la lecture serveur (`router.refresh()`) ;
// `reset()` réafficherait le même échec après une erreur levée côté serveur.
export default function ErrorAdmin({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[admin] rendu interrompu par une erreur", error);
  }, [error]);

  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-4 p-6 text-center sm:p-8"
      data-testid="error-admin"
    >
      <h1 className="text-2xl font-semibold">Algo salió mal</h1>
      <p className="max-w-prose text-muted">
        No pudimos cargar esta pantalla. Vuelve a intentarlo en un momento.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <button
          type="button"
          onClick={retry}
          className="min-h-11 underline"
          data-testid="error-admin-reintentar"
        >
          Reintentar
        </button>
        <Link href="/" className="min-h-11 underline" data-testid="error-admin-volver">
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
