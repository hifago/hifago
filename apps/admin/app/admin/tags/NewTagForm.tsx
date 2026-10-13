"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, TextField, toast } from "@hifago/ui";
import { createCatalogTag } from "@/lib/tags/createCatalogTag";

export function NewTagForm() {
  const router = useRouter();
  const [labelEs, setLabelEs] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!labelEs.trim()) {
      toast.danger("El nombre de la etiqueta es obligatorio.");
      return;
    }

    setIsSubmitting(true);
    const result = await createCatalogTag(labelEs);
    setIsSubmitting(false);

    if ("error" in result) {
      toast.danger(result.error);
      return;
    }

    toast.success("Tag creado.");
    setLabelEs("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-wrap items-end gap-4">
      <TextField fullWidth name="label-es" value={labelEs} onChange={setLabelEs} isRequired>
        <Label>Nueva etiqueta</Label>
        <Input id="label-es" data-testid="new-tag-input" />
      </TextField>
      <Button type="submit" isDisabled={isSubmitting} data-testid="create-tag-button">
        {isSubmitting ? "Creando…" : "Crear etiqueta"}
      </Button>
    </form>
  );
}
