"use client";

import ErrorAdmin from "./error";
import "./globals.css";

// LA DERNIÈRE FRONTIÈRE : elle REMPLACE le layout racine quand c'est lui qui échoue. Next exige
// qu'elle pose son propre `<html>`/`<body>` ; la feuille de style et le thème `admin` sont
// reposés ici (Next ne les injecte pas pour cet écran), sans les polices `next/font` — une
// dépendance de moins qui pourrait échouer. L'écran lui-même est celui de `error.tsx`, réutilisé.
export default function GlobalErrorAdmin({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="es" data-theme="admin" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ErrorAdmin error={error} retry={retry} />
      </body>
    </html>
  );
}
