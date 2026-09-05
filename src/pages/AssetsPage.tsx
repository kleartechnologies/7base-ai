import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { FileText, FolderOpen, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/hooks/useI18n'
import type { MessageKey } from '@/i18n/translate'
import {
  ASSET_FILE_ACCEPT,
  formatFileSize,
  isAssetType,
  normalizeTags,
  tagsToInput,
  validateAssetFile,
} from '@/features/assets/assetFile'
import {
  archiveAsset,
  createAssetFromFile,
  deleteAssetCompletely,
  observeAssets,
  updateAssetMetadata,
} from '@/services/assets/asset.service'
import { getAssetUrl } from '@/services/storage/storage.service'
import { ASSET_TYPES, type Asset, type AssetType, type Product } from '@/types'
import { cn } from '@/lib/utils'

/**
 * The owner's asset store: photos, menus, logos and documents EVA can draw
 * on. A file plus its meaning — what it shows, which product it belongs to,
 * whether EVA may use it. Upload first, refine metadata after; archiving is
 * the normal removal, deletion is a deliberate two-step.
 */

const TYPE_KEYS: Record<AssetType, MessageKey> = {
  product: 'asset.typeProduct',
  menu: 'asset.typeMenu',
  logo: 'asset.typeLogo',
  brand: 'asset.typeBrand',
  photo: 'asset.typePhoto',
  document: 'asset.typeDocument',
  promotional: 'asset.typePromotional',
  other: 'asset.typeOther',
}

type StatusFilter = 'active' | 'archived' | 'all'

const FILTERS: { key: StatusFilter; labelKey: MessageKey }[] = [
  { key: 'active', labelKey: 'asset.filterActive' },
  { key: 'archived', labelKey: 'asset.filterArchived' },
  { key: 'all', labelKey: 'asset.filterAll' },
]

const EMPTY_KEYS: Record<StatusFilter, MessageKey> = {
  active: 'asset.emptyActive',
  archived: 'asset.emptyArchived',
  all: 'asset.emptyAll',
}

export default function AssetsPage() {
  const { t } = useI18n()
  const { user, business } = useAuth()
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [filter, setFilter] = useState<StatusFilter>('active')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) return
    return observeAssets(
      user.uid,
      (next) => setAssets(next),
      () => {
        setAssets([])
        setLoadFailed(true)
      },
    )
  }, [user])

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !user || !business) return

    setUploadError(null)
    const check = validateAssetFile(file)
    if (!check.ok) {
      setUploadError(check.reason)
      return
    }

    setUploading(true)
    try {
      const created = await createAssetFromFile(user.uid, business.id, file)
      setEditingId(created.id)
    } catch {
      setUploadError(t('asset.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const visible = (assets ?? []).filter((asset) =>
    filter === 'all' ? true : asset.status === filter,
  )

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-12">
      <header>
        <h1 className="flex items-center gap-2.5 text-[22px] font-semibold tracking-[-0.01em] text-foreground">
          <FolderOpen className="size-5 text-muted-foreground" aria-hidden />
          {t('asset.pageTitle')}
        </h1>
        <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
          {t('asset.pageIntro')}
        </p>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept={ASSET_FILE_ACCEPT}
          className="sr-only"
          aria-label={t('asset.uploadFileAria')}
          onChange={(event) => void handleFileChange(event)}
        />
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || !business}
        >
          <Upload className="size-3.5" aria-hidden />
          {uploading ? t('asset.uploading') : t('asset.upload')}
        </Button>

        <div className="ml-auto flex items-center gap-1.5">
          {FILTERS.map(({ key, labelKey }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                'rounded-full border px-3 py-1 text-[12px] transition-colors',
                filter === key
                  ? 'border-foreground/30 bg-secondary text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      {!business ? (
        <p className="mt-4 text-[13px] text-muted-foreground">{t('asset.needBusiness')}</p>
      ) : null}
      {uploadError ? (
        <p className="mt-4 text-[13px] text-destructive">{uploadError}</p>
      ) : null}
      {loadFailed ? (
        <p className="mt-4 text-[13px] text-destructive">{t('asset.loadFailed')}</p>
      ) : null}

      {assets === null ? (
        <p className="mt-10 text-[14px] text-muted-foreground">{t('common.loadingEllipsis')}</p>
      ) : visible.length === 0 ? (
        <p className="mt-10 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
          {t(EMPTY_KEYS[filter])}
        </p>
      ) : (
        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {visible.map((asset) =>
            editingId === asset.id ? (
              <li key={asset.id} className="col-span-full">
                <AssetEditor
                  asset={asset}
                  products={business?.products ?? []}
                  onClose={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li key={asset.id}>
                <AssetCard
                  asset={asset}
                  products={business?.products ?? []}
                  showStatus={filter !== 'active'}
                  onEdit={() => setEditingId(asset.id)}
                />
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  )
}

/** Resolves a Storage path to a short-lived URL, keyed so stale paths drop. */
function useAssetDownloadUrl(storagePath: string): string | null {
  const [resolved, setResolved] = useState<{ path: string; url: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    getAssetUrl(storagePath)
      .then((url) => {
        if (!cancelled) setResolved({ path: storagePath, url })
      })
      .catch(() => {
        // Card renders without a preview; metadata and actions still work.
      })
    return () => {
      cancelled = true
    }
  }, [storagePath])

  return resolved && resolved.path === storagePath ? resolved.url : null
}

function AssetPreview({ asset, url }: { asset: Asset; url: string | null }) {
  if (asset.contentType === 'application/pdf') {
    return (
      <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1.5 bg-muted/40">
        <FileText className="size-8 text-muted-foreground/70" aria-hidden />
        <span className="text-[11px] font-medium text-muted-foreground">
          PDF · {formatFileSize(asset.sizeBytes)}
        </span>
      </div>
    )
  }
  return (
    <div className="aspect-[4/3] w-full overflow-hidden bg-muted/40">
      {url ? (
        <img
          src={url}
          alt={asset.description ?? asset.name}
          loading="lazy"
          className="size-full object-cover"
        />
      ) : null}
    </div>
  )
}

function AssetCard({
  asset,
  products,
  showStatus,
  onEdit,
}: {
  asset: Asset
  products: Product[]
  showStatus: boolean
  onEdit: () => void
}) {
  const { t } = useI18n()
  const url = useAssetDownloadUrl(asset.storagePath)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const productName = asset.productId
    ? products.find((product) => product.id === asset.productId)?.name ?? null
    : null

  const handleArchiveToggle = async () => {
    setBusy(true)
    setActionError(null)
    try {
      await archiveAsset(asset.id, asset.status === 'active')
    } catch {
      setActionError(t('asset.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    setBusy(true)
    setActionError(null)
    try {
      await deleteAssetCompletely(asset)
    } catch {
      setActionError(t('asset.deleteFailed'))
      setConfirmingDelete(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <AssetPreview asset={asset} url={url} />

      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 truncate text-[14px] font-semibold tracking-[-0.01em] text-foreground">
            {asset.name}
          </h2>
          {showStatus && asset.status === 'archived' ? (
            <span className="ml-auto shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground">
              {t('asset.statusArchived')}
            </span>
          ) : null}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
            {t(TYPE_KEYS[asset.type])}
          </span>
          {productName ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
              {productName}
            </span>
          ) : null}
          {asset.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {confirmingDelete ? (
            <>
              <span className="text-[12px] text-destructive">{t('asset.deleteConfirm')}</span>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void handleDelete()}
                disabled={busy}
              >
                {busy ? t('asset.deleting') : t('common.delete')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
              >
                {t('common.cancel')}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>
                {t('common.edit')}
              </Button>
              {asset.contentType === 'application/pdf' && url ? (
                <Button size="sm" variant="outline" asChild>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {t('asset.open')}
                  </a>
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void handleArchiveToggle()}
                disabled={busy}
              >
                {asset.status === 'active' ? t('asset.archive') : t('asset.restore')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
              >
                {t('common.delete')}
              </Button>
            </>
          )}
        </div>
        {actionError ? <p className="mt-2 text-[12px] text-destructive">{actionError}</p> : null}
      </div>
    </div>
  )
}

const selectClassName =
  'flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50'

function AssetEditor({
  asset,
  products,
  onClose,
}: {
  asset: Asset
  products: Product[]
  onClose: () => void
}) {
  const { t } = useI18n()
  const url = useAssetDownloadUrl(asset.storagePath)
  const [name, setName] = useState(asset.name)
  const [type, setType] = useState<AssetType>(asset.type)
  const [description, setDescription] = useState(asset.description ?? '')
  const [tags, setTags] = useState(tagsToInput(asset.tags))
  const [productId, setProductId] = useState(asset.productId ?? '')
  const [allowAiUse, setAllowAiUse] = useState(asset.allowAiUse)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(false)
    try {
      await updateAssetMetadata(asset.id, {
        name: name.trim() || asset.name,
        type,
        description: description.trim() || null,
        tags: normalizeTags(tags),
        productId: productId || null,
        allowAiUse,
      })
      onClose()
    } catch {
      setError(true)
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="rounded-xl border border-border bg-card px-5 py-4"
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="w-full shrink-0 overflow-hidden rounded-lg border border-border sm:w-40">
          <AssetPreview asset={asset} url={url} />
        </div>

        <div className="min-w-0 grow space-y-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="asset-name">{t('asset.fieldName')}</Label>
              <Input
                id="asset-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="asset-type">{t('asset.fieldType')}</Label>
              <select
                id="asset-type"
                value={type}
                onChange={(event) => {
                  if (isAssetType(event.target.value)) setType(event.target.value)
                }}
                disabled={busy}
                className={selectClassName}
              >
                {ASSET_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {t(TYPE_KEYS[option])}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="asset-description">{t('asset.fieldDescription')}</Label>
            <Textarea
              id="asset-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('asset.descriptionPlaceholder')}
              rows={2}
              disabled={busy}
            />
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="asset-tags">{t('asset.fieldTags')}</Label>
              <Input
                id="asset-tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder={t('asset.tagsPlaceholder')}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="asset-product">{t('asset.fieldProduct')}</Label>
              <select
                id="asset-product"
                value={productId}
                onChange={(event) => setProductId(event.target.value)}
                disabled={busy}
                className={selectClassName}
              >
                <option value="">{t('asset.noProduct')}</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-[13px] text-foreground">
            <input
              type="checkbox"
              checked={allowAiUse}
              onChange={(event) => setAllowAiUse(event.target.checked)}
              disabled={busy}
              className="size-4 accent-foreground"
            />
            {t('asset.allowAiUse')}
          </label>

          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <span className="ml-auto truncate text-[12px] text-muted-foreground">
              {asset.fileName} · {formatFileSize(asset.sizeBytes)}
            </span>
          </div>
          {error ? (
            <p className="text-[12px] text-destructive">{t('asset.saveFailed')}</p>
          ) : null}
        </div>
      </div>
    </form>
  )
}
