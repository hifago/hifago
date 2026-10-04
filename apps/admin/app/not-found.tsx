import Link from "next/link";

// Écran 404 de toute l'app : les `notFound()` des écrans admin/socio (produit, établissement,
// commande introuvables) et les URL inconnues. Sans lui, Next rendait sa page 404 anglaise. Espagnol
// en dur (app non localisée), rien de `@hifago/ui`, comme `error.tsx`.
export default function NotFoundAdmin() {
  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-4 p-6 text-center sm:p-8"
      data-testid="not-found-admin"
    >
      <h1 className="text-2xl font-semibold">Página no encontrada</h1>
      <p className="max-w-prose text-muted">
        Esta página no existe o ya no está disponible.
      </p>
      <Link href="/" className="min-h-11 underline" data-testid="not-found-admin-volver">
        Volver al inicio
      </Link>
    </main>
  );
}
