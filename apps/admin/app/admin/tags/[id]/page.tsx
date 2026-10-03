import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { requireUuidParam } from "@/lib/routing/requireUuidParam";
import { asLocalizedField, formatDateTimeInBogota, resolveLocalizedField } from "@hifago/domain";
import { RenameTagButton } from "../RenameTagButton";
import { DeleteTagButton } from "../DeleteTagButton";
import { CategoriaEditorialBlock } from "./CategoriaEditorialBlock";
import type { LocalizedValue } from "@/components/localized-text-field";

// docs/specs/10-listes-standardisees-admin-socio.md §5.4 — fiche minimale, n'existait pas avant
// (seule la liste montrait ces champs, via modal). Eliminar réservé ici (décision Jérôme, jamais
// une action de ligne sur /admin/tags) ; Editar (renommer) reste disponible ici aussi, même
// composant modal que sur la liste.
export default async function AdminTagDetailPage({ params }: PageProps<"/admin/tags/[id]">) {
  const id = requireUuidParam((await params).id);
  const supabase = await createClient();

  // Les deux requêtes ne dépendent que du paramètre de route `id`, jamais l'une de l'autre —
  // lancées en concurrence plutôt qu'attendre `tag` avant de lancer `assignments`.
  const [tagResult, assignmentsResult] = await Promise.all([
    supabase
      .from("catalog_tags")
      .select("id, label, slug, created_at, description, image_path")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("product_tag_assignments").select("product:products(id, name)").eq("tag_id", id),
  ]);
  // Une panne LÈVE (lib/supabase/checkedRead.ts) : lue comme une absence, elle répondait
  // « introuvable », ou une étiquette sans activités.
  const { data: tag } = checkedRead(tagResult, "catalog_tags");
  const { data: assignments } = checkedRead(assignmentsResult, "product_tag_assignments");

  if (!tag) {
    notFound();
  }

  const label = resolveLocalizedField(asLocalizedField(tag.label), "es") ?? tag.slug;

  const products = (assignments ?? [])
    .map((assignment) => assignment.product)
    .filter((product) => product !== null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold" data-testid="tag-detail-label">
          {label}
        </h1>
        <div className="flex gap-2">
          <RenameTagButton tagId={tag.id} currentLabel={label} />
          <DeleteTagButton tagId={tag.id} label={label} usageCount={products.length} />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <div>
          <dt className="text-muted">Slug</dt>
          <dd>{tag.slug}</dd>
        </div>
        <div>
          <dt className="text-muted">Creada</dt>
          <dd>{formatDateTimeInBogota(tag.created_at, "es")}</dd>
        </div>
      </dl>

      {/* Le contenu éditorial (spec 29 Tranche 3) : c'est ce que la vitrine affiche sur
          `/es/actividades`. Placé AVANT la liste des activités — c'est ce qu'un admin vient
          remplir, la liste étant une conséquence des assignations faites ailleurs. */}
      <CategoriaEditorialBlock
        tagId={tag.id}
        // ⚠️ `asLocalizedField` est un cast SANS validation : un JSONB scalaire passerait au
        // travers. On rend donc un objet de chaînes, en écartant tout ce qui n'en est pas une —
        // sinon `LocalizedTextField` recevrait un `undefined` par langue et afficherait « [object
        // Object] » dans son champ.
        initialDescription={Object.fromEntries(
          Object.entries((tag.description ?? {}) as Record<string, unknown>).filter(
            (entree): entree is [string, string] => typeof entree[1] === "string"
          )
        ) satisfies LocalizedValue}
        initialImagePath={tag.image_path}
      />

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Actividades con esta etiqueta ({products.length})</h2>
        {products.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {products.map((product) => (
              <li key={product.id}>
                <Link href={`/admin/products/${product.id}`} className="text-sm hover:underline">
                  {resolveLocalizedField(asLocalizedField(product.name), "es") ?? product.id}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Ninguna actividad usa esta etiqueta todavía.</p>
        )}
      </div>
    </div>
  );
}
