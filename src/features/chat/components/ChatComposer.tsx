import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp, FileText, FolderOpen, ImageIcon, Paperclip, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/hooks/useAuth'
import { formatFileSize } from '@/features/assets/assetFile'
import {
  ACCEPTED_ATTACHMENT_MIME_TYPES,
  ATTACHMENT_FILE_ACCEPT,
  MAX_ATTACHMENTS_PER_MESSAGE,
  validateAttachmentFile,
} from '@/features/chat/attachmentFile'
import { observeAssets } from '@/services/assets/asset.service'
import type { Asset, AttachmentDraft } from '@/types'

const MAX_HEIGHT_PX = 200

/** One staged attachment, with its local preview when it is an image. */
interface PendingAttachment {
  id: string
  draft: AttachmentDraft
  fileName: string
  contentType: string
  sizeBytes: number
  /** Object URL for image files; revoked when the row leaves the strip. */
  previewUrl: string | null
}

/**
 * The chat input.
 *
 * Enter sends, Shift+Enter adds a newline — the convention users already know
 * from every other chat product. The field grows with the text up to a cap,
 * then scrolls internally so the composer never eats the conversation.
 *
 * Attachments are staged in a strip above the field: validated the moment
 * they are picked, removable until send, capped at three. The paperclip menu
 * offers a device upload and the owner's own Assets — an Asset is attached
 * as a reference, never re-uploaded.
 */
export function ChatComposer({
  onSend,
  disabled,
  placeholder = 'Tell EVA what you want to achieve…',
  autoFocus = false,
}: {
  onSend: (text: string, attachments: AttachmentDraft[]) => void
  disabled?: boolean
  placeholder?: string
  autoFocus?: boolean
}) {
  const { user, business } = useAuth()
  const [value, setValue] = useState('')
  const [pending, setPending] = useState<PendingAttachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  // Assets are only fetched once the owner opens the attach menu.
  const [pickerWanted, setPickerWanted] = useState(false)
  const [assets, setAssets] = useState<Asset[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef<PendingAttachment[]>([])

  useEffect(() => {
    pendingRef.current = pending
  }, [pending])

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [value])

  useEffect(() => {
    if (!pickerWanted || !user) return
    return observeAssets(user.uid, setAssets, () => {
      // Say so rather than showing an empty picker that looks like "no assets".
      setAttachError('Your Assets could not be loaded. Please try again.')
    })
  }, [pickerWanted, user])

  // Preview URLs for rows still staged at unmount are released here; rows
  // removed or sent release theirs at that moment.
  useEffect(
    () => () => {
      for (const item of pendingRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      }
    },
    [],
  )

  const canAttachMore = pending.length < MAX_ATTACHMENTS_PER_MESSAGE
  const canSend = (value.trim().length > 0 || pending.length > 0) && !disabled

  // Only Assets that could actually be attached: active, cleared for EVA,
  // and a type chat accepts. Mirrors what security rules will verify.
  const attachableAssets = assets.filter(
    (asset) =>
      asset.status === 'active' &&
      asset.allowAiUse &&
      (ACCEPTED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(asset.contentType),
  )

  function addFiles(files: FileList | null) {
    if (!files) return
    setAttachError(null)
    let staged = pending
    for (const file of Array.from(files)) {
      if (staged.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
        setAttachError(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`)
        break
      }
      const check = validateAttachmentFile(file)
      if (!check.ok) {
        setAttachError(check.reason)
        continue
      }
      staged = [
        ...staged,
        {
          id: crypto.randomUUID(),
          draft: { kind: 'file', file },
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        },
      ]
    }
    setPending(staged)
  }

  function addAsset(asset: Asset) {
    setAttachError(null)
    if (pending.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
      setAttachError(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`)
      return
    }
    if (pending.some((item) => item.draft.kind === 'asset' && item.draft.asset.id === asset.id)) {
      return
    }
    setPending([
      ...pending,
      {
        id: crypto.randomUUID(),
        draft: {
          kind: 'asset',
          asset: {
            id: asset.id,
            fileName: asset.fileName,
            contentType: asset.contentType,
            sizeBytes: asset.sizeBytes,
            storagePath: asset.storagePath,
          },
        },
        fileName: asset.name || asset.fileName,
        contentType: asset.contentType,
        sizeBytes: asset.sizeBytes,
        previewUrl: null,
      },
    ])
  }

  function removePending(id: string) {
    const item = pending.find((candidate) => candidate.id === id)
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
    setPending(pending.filter((candidate) => candidate.id !== id))
    setAttachError(null)
  }

  function submit() {
    if (!canSend) return
    const attachments = pending.map((item) => item.draft)
    for (const item of pending) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
    }
    onSend(value.trim(), attachments)
    setValue('')
    setPending([])
    setAttachError(null)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    submit()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="rounded-2xl border border-input bg-card px-3.5 py-2.5 shadow-xs transition-colors focus-within:border-ring">
        {pending.length > 0 ? (
          <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attachments to send">
            {pending.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 py-1 pl-1.5 pr-1 text-[13px]"
              >
                {item.previewUrl ? (
                  <img
                    src={item.previewUrl}
                    alt=""
                    className="size-8 rounded-md object-cover"
                  />
                ) : item.contentType === 'application/pdf' ? (
                  <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <ImageIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="max-w-40 truncate" title={item.fileName}>
                  {item.fileName}
                </span>
                <span className="text-muted-foreground">{formatFileSize(item.sizeBytes)}</span>
                <button
                  type="button"
                  onClick={() => removePending(item.id)}
                  aria-label={`Remove ${item.fileName}`}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ATTACHMENT_FILE_ACCEPT}
            multiple
            hidden
            onChange={(event) => {
              addFiles(event.target.files)
              event.target.value = ''
            }}
          />
          <DropdownMenu onOpenChange={(open) => open && setPickerWanted(true)}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={disabled || !canAttachMore}
                aria-label="Attach a file"
                className="mb-0.5 rounded-full text-muted-foreground"
              >
                <Paperclip />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                <Upload aria-hidden />
                Upload from device
              </DropdownMenuItem>
              {business ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>
                    <span className="flex items-center gap-1.5">
                      <FolderOpen className="size-3.5" aria-hidden />
                      From your Assets
                    </span>
                  </DropdownMenuLabel>
                  {attachableAssets.length === 0 ? (
                    <p className="px-2 pb-1.5 text-xs text-muted-foreground">
                      No usable assets yet.
                    </p>
                  ) : (
                    attachableAssets.slice(0, 8).map((asset) => (
                      <DropdownMenuItem key={asset.id} onSelect={() => addAsset(asset)}>
                        {asset.contentType === 'application/pdf' ? (
                          <FileText aria-hidden />
                        ) : (
                          <ImageIcon aria-hidden />
                        )}
                        <span className="max-w-48 truncate">{asset.name}</span>
                      </DropdownMenuItem>
                    ))
                  )}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          <label htmlFor="chat-composer" className="sr-only">
            Message EVA
          </label>
          <Textarea
            id="chat-composer"
            ref={textareaRef}
            variant="chromeless"
            rows={1}
            value={value}
            autoFocus={autoFocus}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            className="max-h-[200px] py-1.5 text-[15px] leading-[1.6]"
          />
          <Button
            type="submit"
            size="icon-sm"
            disabled={!canSend}
            aria-label="Send message"
            className="mb-0.5 rounded-full"
          >
            <ArrowUp />
          </Button>
        </div>
      </div>
      {attachError ? (
        <p role="alert" className="mt-2 text-center text-xs text-destructive">
          {attachError}
        </p>
      ) : null}
      <p className="mt-2 text-center text-xs text-muted-foreground">
        EVA can make mistakes. Review important details before publishing.
      </p>
    </form>
  )
}
