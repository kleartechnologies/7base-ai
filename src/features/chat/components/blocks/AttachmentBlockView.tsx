import { useEffect, useState } from 'react'
import { FileText, FolderCheck, ImageOff } from 'lucide-react'
import { formatFileSize } from '@/features/assets/assetFile'
import { isPdfAttachment } from '@/features/chat/attachmentFile'
import { saveAttachmentToAssets } from '@/services/chat/attachment.service'
import { getAssetUrl } from '@/services/storage/storage.service'
import type { AttachmentBlock } from '@/types'

/**
 * One attachment in the thread — the historical record of what was sent.
 *
 * Everything shown comes from the immutable block, so the message stays
 * renderable even if a referenced Asset is later archived or the underlying
 * file goes away (that case degrades to an honest "unavailable" row, never a
 * broken image). The download URL is resolved up front, the same pattern as
 * the creative preview, so the PDF "Open" action is a plain link — no
 * async-then-open for popup blockers to eat.
 */
export function AttachmentBlockView({
  block,
  conversationId,
}: {
  block: AttachmentBlock
  /** Enables "Save to Assets"; absent in contexts without a thread. */
  conversationId?: string
}) {
  const storagePath = block.storagePath
  const [resolved, setResolved] = useState<{ path: string; url: string } | null>(null)
  const [failedPath, setFailedPath] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const url = resolved && resolved.path === storagePath ? resolved.url : null
  const unavailable = failedPath === storagePath

  useEffect(() => {
    let cancelled = false
    getAssetUrl(storagePath)
      .then((resolvedUrl) => {
        if (!cancelled) setResolved({ path: storagePath, url: resolvedUrl })
      })
      .catch(() => {
        if (!cancelled) setFailedPath(storagePath)
      })
    return () => {
      cancelled = true
    }
  }, [storagePath])

  const handleSave = async () => {
    if (!conversationId) return
    setSaveState('saving')
    const result = await saveAttachmentToAssets(conversationId, block.attachmentId)
    setSaveState(result.ok ? 'saved' : 'error')
  }

  const isPdf = isPdfAttachment(block.contentType)

  const meta = (
    <span className="text-[12px] text-muted-foreground">
      {formatFileSize(block.sizeBytes)}
      {isPdf ? ' · PDF' : null}
    </span>
  )

  // An Asset reference is already in the library; an upload can be promoted.
  const saveAction = block.assetId ? (
    <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
      <FolderCheck className="size-3.5" aria-hidden />
      {saveState === 'saved' ? 'Saved to Assets' : 'From your Assets'}
    </span>
  ) : conversationId ? (
    saveState === 'saved' ? (
      <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
        <FolderCheck className="size-3.5" aria-hidden />
        Saved to Assets
      </span>
    ) : (
      <button
        type="button"
        onClick={handleSave}
        disabled={saveState === 'saving'}
        className="rounded-full border border-border px-2 py-px text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        {saveState === 'saving' ? 'Saving…' : 'Save to Assets'}
      </button>
    )
  ) : null

  if (unavailable) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
        <ImageOff className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{block.fileName}</span>
        <span className="shrink-0">— no longer available</span>
      </div>
    )
  }

  if (isPdf) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
        <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground">{block.fileName}</p>
          <p className="flex items-center gap-2">{meta}</p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-border px-2 py-px text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Open
            </a>
          ) : null}
          {saveAction}
        </div>
      </div>
    )
  }

  return (
    <figure className="max-w-xs">
      {url ? (
        <img
          src={url}
          alt={block.fileName}
          loading="lazy"
          className="max-h-64 w-auto max-w-full rounded-lg border border-border object-contain"
          onError={() => setFailedPath(storagePath)}
        />
      ) : (
        <div className="h-40 w-56 animate-pulse rounded-lg bg-muted" aria-hidden />
      )}
      <figcaption className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <span className="max-w-40 truncate" title={block.fileName}>
          {block.fileName}
        </span>
        {meta}
        {saveAction}
      </figcaption>
      {saveState === 'error' ? (
        <p className="mt-1 text-[12px] text-destructive">
          Could not save to Assets. Please try again.
        </p>
      ) : null}
    </figure>
  )
}
