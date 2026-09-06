import { useRef, useState, type ChangeEvent } from 'react'
import { FolderOpen, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/hooks/useI18n'
import { ASSET_FILE_ACCEPT, validateAssetFile } from '@/features/assets/assetFile'
import { createAssetFromFile, updateAssetMetadata } from '@/services/assets/asset.service'
import type { Asset, Business } from '@/types'
import { cn } from '@/lib/utils'
import { useStorageUrl } from './useStorageUrl'

/**
 * The official logo — a REFERENCE into Assets, never a second copy of the
 * file. Upload goes through the existing Assets pipeline (the file lands in
 * the library like any other upload, typed 'logo'); "Choose from Assets"
 * points the reference at a file already there; Remove clears the reference
 * and leaves the Asset untouched.
 */
export function LogoSection({
  business,
  ownerId,
  logoAssetId,
  assets,
  assetsFailed,
  onSetLogo,
  onRemoveLogo,
}: {
  business: Business
  ownerId: string
  logoAssetId: string | null
  /** The owner's active image assets, for the picker. */
  assets: Asset[]
  assetsFailed: boolean
  onSetLogo: (assetId: string) => Promise<void>
  onRemoveLogo: () => Promise<void>
}) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const logoAsset = logoAssetId ? assets.find((asset) => asset.id === logoAssetId) ?? null : null
  const logoUrl = useStorageUrl(logoAsset?.storagePath ?? null)
  const pickable = assets.filter((asset) => asset.contentType.startsWith('image/'))

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploadError(null)
    const check = validateAssetFile(file)
    if (!check.ok || !file.type.startsWith('image/')) {
      setUploadError(check.ok ? t('brand.logoNotImage') : check.reason)
      return
    }
    setBusy(true)
    try {
      const created = await createAssetFromFile(ownerId, business.id, file)
      // The upload is a normal Asset; only its type says what it is.
      await updateAssetMetadata(created.id, { type: 'logo' })
      await onSetLogo(created.id)
    } catch {
      // The previous logo (if any) is untouched — Retry re-opens the picker.
      setUploadError(t('brand.logoUploadFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handlePick = async (assetId: string) => {
    setBusy(true)
    setUploadError(null)
    try {
      await onSetLogo(assetId)
      setPicking(false)
    } catch {
      setUploadError(t('brand.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async () => {
    if (!window.confirm(t('brand.logoRemoveConfirm'))) return
    setBusy(true)
    setUploadError(null)
    try {
      await onRemoveLogo()
    } catch {
      setUploadError(t('brand.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card px-6 py-5">
      <header className="mb-4">
        <h2 className="text-[15px] font-semibold text-foreground">{t('brand.logoTitle')}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {t('brand.logoHint')}
        </p>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept={ASSET_FILE_ACCEPT}
        className="sr-only"
        aria-label={t('brand.logoUpload')}
        onChange={(event) => void handleFileChange(event)}
      />

      {logoAssetId ? (
        <div className="flex flex-wrap items-center gap-4">
          {/* Checkerboard so transparent logos read as transparent. */}
          <div
            className="flex h-24 w-32 items-center justify-center overflow-hidden rounded-lg border border-border p-2"
            style={{
              backgroundImage:
                'linear-gradient(45deg, rgba(0,0,0,0.06) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.06) 75%), linear-gradient(45deg, rgba(0,0,0,0.06) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.06) 75%)',
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0, 8px 8px',
            }}
          >
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={t('brand.logoAlt', { name: business.name })}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-[11px] text-muted-foreground">
                {logoAsset ? t('common.loading') : t('brand.logoMissing')}
              </span>
            )}
          </div>
          <div className="flex flex-col items-start gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setPicking((open) => !open)}
            >
              {t('brand.logoChange')}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void handleRemove()}>
              {t('brand.logoRemove')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-3.5" aria-hidden />
            {busy ? t('asset.uploading') : t('brand.logoUpload')}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || pickable.length === 0}
            onClick={() => setPicking((open) => !open)}
          >
            <FolderOpen className="size-3.5" aria-hidden />
            {t('brand.logoChoose')}
          </Button>
        </div>
      )}

      {uploadError ? (
        <p role="alert" className="mt-3 text-[13px] text-destructive">
          {uploadError}
        </p>
      ) : null}
      {assetsFailed ? (
        <p role="alert" className="mt-3 text-[13px] text-destructive">
          {t('brand.pickerFailed')}
        </p>
      ) : null}

      {picking ? (
        <div className="mt-4 rounded-lg border border-border bg-background p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-[13px] font-medium text-foreground">{t('brand.pickerTitle')}</p>
            <Button variant="ghost" size="sm" onClick={() => setPicking(false)}>
              {t('common.close')}
            </Button>
          </div>
          {pickable.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{t('brand.pickerEmpty')}</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {pickable.map((asset) => (
                <li key={asset.id}>
                  <PickerTile
                    asset={asset}
                    selected={asset.id === logoAssetId}
                    disabled={busy}
                    onPick={() => void handlePick(asset.id)}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 border-t border-border pt-2.5">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-3.5" aria-hidden />
              {t('brand.logoUpload')}
            </Button>
          </div>
        </div>
      ) : null}

      <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground/80">
        {t('brand.logoNote')}
      </p>
    </section>
  )
}

function PickerTile({
  asset,
  selected,
  disabled,
  onPick,
}: {
  asset: Asset
  selected: boolean
  disabled: boolean
  onPick: () => void
}) {
  const url = useStorageUrl(asset.storagePath)
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      aria-pressed={selected}
      className={cn(
        'block w-full overflow-hidden rounded-lg border text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring',
        selected ? 'border-foreground/50' : 'border-border hover:border-foreground/30',
      )}
    >
      <span className="block aspect-square w-full bg-muted/40">
        {url ? (
          <img src={url} alt={asset.name} loading="lazy" className="size-full object-cover" />
        ) : null}
      </span>
      <span className="block truncate px-1.5 py-1 text-[11px] text-muted-foreground">
        {asset.name}
      </span>
    </button>
  )
}
