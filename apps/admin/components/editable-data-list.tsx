"use client";

import { useRef } from "react";
import { DataList, type DataListEditingHandle, type DataListProps } from "@hifago/ui";
import { useUnsavedChangesSource } from "./unsaved-changes";

// `DataList` + son inscription au garde-fou « cambios sin guardar » (unsaved-changes.tsx). Toute
// liste de /admin qui passe `onSave` s'écrit avec ce composant plutôt qu'avec `DataList` nu : c'est
// ce qui fait qu'un changement d'onglet avec des cellules non enregistrées ouvre le dialogue.
//
// Des refs, pas un état : le compteur de cellules modifiées n'a rien à faire re-rendre ici, il
// n'est lu qu'au moment d'un clic sur un lien.
export function EditableDataList<Row>(props: DataListProps<Row>) {
  const handle = useRef<DataListEditingHandle>(null);
  const dirtyCount = useRef(0);

  useUnsavedChangesSource({
    isDirty: () => dirtyCount.current > 0,
    save: () => handle.current?.save() ?? Promise.resolve(true),
    discard: () => handle.current?.discard(),
  });

  return (
    <DataList
      {...props}
      editingRef={handle}
      onDirtyCountChange={(count) => {
        dirtyCount.current = count;
      }}
    />
  );
}
