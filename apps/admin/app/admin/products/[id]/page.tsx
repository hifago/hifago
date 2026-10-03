import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@hifago/supabase/server";
import { checkedRead } from "@/lib/supabase/checkedRead";
import { requireUuidParam } from "@/lib/routing/requireUuidParam";
import { asLocalizedField, formatCop, resolveLocalizedField } from "@hifago/domain";
import { buttonVariants, Chip } from "@hifago/ui";
import { DeleteProductButton } from "./DeleteProductButton";

// Fiche simple, en lecture — jusqu'ici un produit ne se rejoignait que via son formulaire
// d'édition (spec §5.5), jamais une vue neutre.
export default async function AdminProductDetailPage({
  params,
}: PageProps<"/admin/products/[id]">) {
  const id = requireUuidParam((await params).id);
  const supabase = await createClient();

  // Une panne LÈVE (lib/supabase/checkedRead.ts) : lue comme une absence, elle répondait
  // « introuvable ».
  const { data: product } = checkedRead(
    await supabase
      .from("products")
      .select("id, name, type, price_cop, sellable, establishments(id, name)")
      .eq("id", id)
      .maybeSingle(),
    "products",
  );

  if (!product) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {resolveLocalizedField(asLocalizedField(product.name), "es") ?? product.id}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted">
            <span>
              {resolveLocalizedField(asLocalizedField(product.establishments?.name), "es") ?? "—"} ·{" "}
              {product.type}
            </span>
            <Chip
              variant="soft"
              color={product.sellable ? "success" : "default"}
              data-testid="product-sellable-badge"
            >
              {product.sellable ? "Publicado" : "Borrador"}
            </Chip>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/admin/products/${product.id}/edit`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
            data-testid="product-edit-link"
          >
            Editar
          </Link>
          <Link
            href={`/admin/products/${product.id}/availability`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
            data-testid="product-availability-link"
          >
            Disponibilidad
          </Link>
          <DeleteProductButton productId={product.id} />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface p-4 text-sm sm:w-fit">
        <dt className="text-muted">Precio</dt>
        <dd>{formatCop(product.price_cop ?? 0)}</dd>
        {product.establishments ? (
          <>
            <dt className="text-muted">Establecimiento</dt>
            <dd>
              <Link href={`/admin/establishments/${product.establishments.id}`} className="hover:underline">
                {resolveLocalizedField(asLocalizedField(product.establishments.name), "es") ?? product.establishments.id}
              </Link>
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
