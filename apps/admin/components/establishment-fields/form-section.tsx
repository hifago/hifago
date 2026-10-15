import type { ReactNode } from "react";

// Carte de section d'une fiche établissement — la forme des blocs « Alojamiento » et « Contacto
// público » de l'admin, reprise par les formulaires du partenaire pour que les deux écrans se
// lisent de la même façon (constat du 2026-10-14 : « ce n'est pas du tout la même »).
export function FormSection({
  title,
  testId,
  children,
}: {
  title: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-surface p-4" data-testid={testId}>
      <h2 className="text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}
