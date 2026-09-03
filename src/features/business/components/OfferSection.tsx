import { useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Business, Product } from '@/types'
import { EditActions, SectionCard, SourceTag } from './SectionCard'
import { formatPrice, fromMajorUnits, toMajorUnits, trimmedOrNull } from './fields'

/**
 * "What you offer" — the menu or product list MARKA read from the site.
 *
 * A product the owner edits is marked confirmed, so the next analysis leaves
 * it alone; untouched ones stay refreshable. Each row says which of the two it
 * is, because "MARKA found this price on your site" and "you told MARKA this
 * price" deserve different amounts of trust from the owner.
 */
export function OfferSection({
  business,
  startOpen = false,
  onSave,
}: {
  business: Business
  startOpen?: boolean
  onSave: (products: Product[]) => Promise<void>
}) {
  const [editing, setEditing] = useState(startOpen)
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<ProductRow[]>(() => business.products.map(toRow))

  function open() {
    setRows(business.products.map(toRow))
    setEditing(true)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await onSave(toProducts(business, rows))
      setEditing(false)
    } catch {
      // The message is rendered by the Brain container; keep the form open so
      // the owner does not lose what they typed.
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard
      title="What you offer"
      hint={
        business.products.length > 0
          ? `MARKA found ${business.products.length} ${business.products.length === 1 ? 'item' : 'items'}. Fix anything that looks wrong.`
          : 'Nothing found yet. Add what you sell so MARKA can write about it.'
      }
      editing={editing}
      onEdit={open}
    >
      {editing ? (
        <form onSubmit={handleSubmit}>
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={row.key} className="grid grid-cols-[1fr_7rem_auto] items-end gap-2">
                <div className="space-y-1.5">
                  {index === 0 ? <Label className="text-[13px]">Item</Label> : null}
                  <Input
                    value={row.name}
                    placeholder="Nasi lemak ayam"
                    onChange={(event) => update(setRows, index, { name: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  {index === 0 ? <Label className="text-[13px]">Price (RM)</Label> : null}
                  <Input
                    inputMode="decimal"
                    value={row.price}
                    placeholder="12.90"
                    onChange={(event) => update(setRows, index, { price: event.target.value })}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${row.name || 'item'}`}
                  onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-3"
            onClick={() => setRows((current) => [...current, blankRow()])}
          >
            <Plus aria-hidden />
            Add item
          </Button>

          <EditActions busy={busy} onCancel={() => setEditing(false)} />
        </form>
      ) : business.products.length === 0 ? (
        <p className="text-sm text-muted-foreground/60">Not known yet</p>
      ) : (
        <ul className="divide-y divide-border">
          {business.products.map((product) => (
            <li key={product.id} className="flex items-baseline justify-between gap-4 py-2 text-sm">
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-foreground">{product.name}</span>
                <SourceTag provenance={product} />
              </span>
              <span className="shrink-0 text-muted-foreground">
                {formatPrice(product.priceMinor, product.currency) ?? '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

interface ProductRow {
  key: string
  id: string | null
  name: string
  price: string
}

function toRow(product: Product): ProductRow {
  return {
    key: product.id,
    id: product.id,
    name: product.name,
    price: toMajorUnits(product.priceMinor),
  }
}

function blankRow(): ProductRow {
  return { key: `new-${Math.random().toString(36).slice(2)}`, id: null, name: '', price: '' }
}

function update(
  setRows: React.Dispatch<React.SetStateAction<ProductRow[]>>,
  index: number,
  patch: Partial<ProductRow>,
) {
  setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
}

/**
 * Rebuilds the product list from the form.
 *
 * An unchanged row keeps the provenance the analysis gave it. A changed or new
 * one becomes the owner's, at full confidence.
 */
function toProducts(business: Business, rows: ProductRow[]): Product[] {
  const existing = new Map(business.products.map((product) => [product.id, product]))
  const now = Date.now()

  return rows
    .filter((row) => row.name.trim().length > 0)
    .map((row, index) => {
      const previous = row.id ? existing.get(row.id) : undefined
      const name = row.name.trim()
      const priceMinor = fromMajorUnits(row.price)
      const changed = !previous || previous.name !== name || previous.priceMinor !== priceMinor

      if (previous && !changed) return previous

      return {
        id: previous?.id ?? `p-${now}-${index}`,
        name,
        description: previous?.description ?? null,
        priceMinor,
        currency: previous?.currency ?? 'MYR',
        category: previous?.category ?? null,
        imageUrl: previous?.imageUrl ?? null,
        isSignature: previous?.isSignature ?? false,
        attributes: previous?.attributes ?? [],
        source: 'user',
        sourceRef: trimmedOrNull(previous?.sourceRef ?? ''),
        confidence: 1,
        confirmed: true,
        confirmedAt: now,
      } satisfies Product
    })
}
