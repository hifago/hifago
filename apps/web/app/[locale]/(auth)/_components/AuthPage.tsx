import type { ReactNode } from "react";
import { Title } from "@/components/atoms/Title";

// Le cadre commun des cinq écrans d'authentification (plan 41, P10). Le panneau de marque vit dans
// le layout ; ce composant garde le seul <main>, la carte claire et le seul <h1> de chaque page.
// Il n'importe rien de `@hifago/ui` : les pages qui l'emploient restent des Server Components.
export type AuthPageProps = {
  title: string;
  children: ReactNode;
};

export function AuthPage({ title, children }: AuthPageProps) {
  return (
    <main className="relative z-10 -mt-8 flex min-h-[calc(100dvh-10rem)] w-full items-start justify-center px-5 pb-10 lg:mt-0 lg:min-h-dvh lg:items-center lg:px-8 lg:py-12">
      <div
        data-superficie="clara"
        className="w-full max-w-md rounded-[24px] border border-foreground bg-surface p-8 text-foreground"
      >
        <div className="flex flex-col gap-6">
          <div className="text-center">
            <Title as="h1" size="pagina">
              {title}
            </Title>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
