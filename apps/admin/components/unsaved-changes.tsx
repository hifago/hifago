"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal } from "@hifago/ui";

// Garde-fou « cambios sin guardar » des listes éditables de /admin (demande Jérôme, 2026-10-13) :
// quitter un onglet avec des cellules modifiées et non enregistrées ouvre un dialogue — enregistrer
// et sortir, abandonner et sortir, ou rester.
//
// POURQUOI un écouteur global et pas le `onNavigate` de `next/link` (le patron que documente Next,
// `node_modules/next/dist/docs/.../link.md` § Blocking navigation) : ce patron exige un `Link`
// maison posé sur CHAQUE lien, et `DataList` navigue par des `<a href>` nus (tri, pagination,
// lien de ligne — des rechargements complets, voulus par la spec 10). Un seul écouteur en phase de
// capture sur `window` voit les deux sortes de liens, y compris ceux de la barre latérale
// (`AppNavShell`, packages/ui) sans avoir à les réécrire.
//
// Ce qu'il NE couvre PAS, et qui retombe sur l'invite native du navigateur (`beforeunload`) :
// fermer l'onglet, recharger, taper une URL. Le bouton « retour » du navigateur à l'intérieur de
// l'app n'est couvert par aucun des deux — App Router n'expose rien pour retenir un `popstate`.

type UnsavedSource = {
  isDirty: () => boolean;
  save: () => Promise<boolean>;
  discard: () => void;
};

type UnsavedRegistry = { register: (source: UnsavedSource) => () => void };

const UnsavedChangesContext = createContext<UnsavedRegistry | null>(null);

/** Inscrit une liste éditable auprès du garde-fou ; sans fournisseur au-dessus, ne fait rien. */
export function useUnsavedChangesSource(source: UnsavedSource): void {
  const registry = useContext(UnsavedChangesContext);
  // L'inscription est posée une fois ; elle lit toujours la dernière version des trois fonctions.
  const latest = useRef(source);
  useEffect(() => {
    latest.current = source;
  });
  useEffect(() => {
    if (!registry) return;
    return registry.register({
      isDirty: () => latest.current.isDirty(),
      save: () => latest.current.save(),
      discard: () => latest.current.discard(),
    });
  }, [registry]);
}

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const sources = useRef(new Set<UnsavedSource>());
  // Posé juste avant une sortie vers un autre site : l'abandon vient d'être confirmé dans NOTRE
  // dialogue, l'invite native du navigateur ne doit pas le redemander.
  const leaving = useRef(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const registry = useMemo<UnsavedRegistry>(
    () => ({
      register(source) {
        sources.current.add(source);
        return () => {
          sources.current.delete(source);
        };
      },
    }),
    []
  );

  useEffect(() => {
    const hasUnsaved = () => !leaving.current && [...sources.current].some((source) => source.isDirty());

    function onClick(event: MouseEvent) {
      // Clic milieu, Ctrl/Cmd/Maj+clic, `target="_blank"`, téléchargement : la page courante reste
      // ouverte, rien n'est perdu.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const destination = new URL(anchor.href, window.location.href);
      const here = window.location;
      // Même page (au fragment près) : pas une sortie.
      if (
        destination.origin === here.origin &&
        destination.pathname === here.pathname &&
        destination.search === here.search
      ) {
        return;
      }
      if (!hasUnsaved()) return;
      // Capture sur `window` + stopPropagation : ni le navigateur ni le `onClick` de `next/link`
      // ne voient ce clic.
      event.preventDefault();
      event.stopPropagation();
      setPendingHref(destination.href);
    }

    // Le formulaire de filtres des listes (`ServerFilters`) est un `<form method="GET">` natif :
    // « Buscar » recharge la page, donc vide les cellules modifiées. Seuls les formulaires qui
    // DÉCLARENT `method="GET"` sont retenus — ceux des dialogues (gérés par React, sans attribut)
    // ne naviguent pas.
    function onSubmit(event: SubmitEvent) {
      const form = event.target as HTMLFormElement | null;
      if (!form || form.getAttribute("method")?.toLowerCase() !== "get") return;
      if (!hasUnsaved()) return;
      event.preventDefault();
      event.stopPropagation();
      const destination = new URL(form.action, window.location.href);
      const params = new URLSearchParams();
      for (const [name, value] of new FormData(form, event.submitter)) {
        if (typeof value === "string") params.append(name, value);
      }
      destination.search = params.toString();
      setPendingHref(destination.href);
    }

    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasUnsaved()) return;
      event.preventDefault();
      // Chrome n'affiche l'invite que si `returnValue` est posé.
      event.returnValue = "";
    }

    window.addEventListener("click", onClick, true);
    window.addEventListener("submit", onSubmit, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  function leave(href: string) {
    setPendingHref(null);
    const destination = new URL(href);
    if (destination.origin === window.location.origin) {
      router.push(`${destination.pathname}${destination.search}${destination.hash}`);
      return;
    }
    leaving.current = true;
    window.location.assign(href);
  }

  function discardAndLeave() {
    if (!pendingHref) return;
    for (const source of sources.current) source.discard();
    leave(pendingHref);
  }

  async function saveAndLeave() {
    if (!pendingHref) return;
    setIsSaving(true);
    const results = await Promise.all([...sources.current].map((source) => source.save()));
    setIsSaving(false);
    // Un enregistrement en échec retient la navigation : la liste a déjà dit pourquoi (toast) et
    // garde les cellules fautives, l'admin corrige sur place.
    if (results.every(Boolean)) {
      leave(pendingHref);
    } else {
      setPendingHref(null);
    }
  }

  return (
    <UnsavedChangesContext.Provider value={registry}>
      {children}
      <Modal>
        <Modal.Backdrop
          isOpen={pendingHref !== null}
          onOpenChange={(open) => {
            if (!open && !isSaving) setPendingHref(null);
          }}
        >
          <Modal.Container size="lg">
            <Modal.Dialog data-testid="unsaved-changes-dialog">
              <Modal.Header>
                <Modal.Heading>Cambios sin guardar</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className="text-sm text-muted">
                  Tienes cambios sin guardar en esta tabla. Si sales sin guardar, se perderán.
                </p>
              </Modal.Body>
              <Modal.Footer className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  isDisabled={isSaving}
                  onPress={() => setPendingHref(null)}
                  data-testid="unsaved-stay-button"
                >
                  Seguir editando
                </Button>
                <Button
                  variant="danger"
                  isDisabled={isSaving}
                  onPress={discardAndLeave}
                  data-testid="unsaved-discard-button"
                >
                  Descartar y salir
                </Button>
                <Button isDisabled={isSaving} onPress={() => void saveAndLeave()} data-testid="unsaved-save-button">
                  {isSaving ? "Guardando…" : "Guardar y salir"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </UnsavedChangesContext.Provider>
  );
}
