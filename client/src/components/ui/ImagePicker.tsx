import { Camera } from 'lucide-react'
import { useEffect, useId, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'

const MAX_BYTES = 2 * 1024 * 1024 // the server's limit (multer: 2 MiB per image)
const TYPES = ['image/jpeg', 'image/png', 'image/webp']

interface ImagePickerProps {
  label: string
  /** 'user' opens the front camera (the selfie). */
  capture?: 'user' | 'environment'
  onChange(file: File | null): void
  /** Already translated (e.g. "required" from the form). */
  error?: string
}

/** Camera or gallery, with a preview and "Retake". Refuses a wrong type or > 2 MB before anything is uploaded. */
export function ImagePicker({ label, capture, onChange, error }: ImagePickerProps) {
  const { t } = useTranslation()
  const id = useId()
  const [preview, setPreview] = useState<string | null>(null)
  const [ownError, setOwnError] = useState<string | null>(null)

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!TYPES.includes(file.type)) return setOwnError('errors.UNSUPPORTED_FILE_TYPE')
    if (file.size > MAX_BYTES) return setOwnError('errors.FILE_TOO_LARGE')
    setOwnError(null)
    setPreview(URL.createObjectURL(file))
    onChange(file)
  }

  function retake() {
    setPreview(null)
    onChange(null)
  }

  const shownError = ownError ? t(ownError) : error
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm text-text">
        {label}
      </label>
      {preview ? (
        <div className="flex flex-col gap-2">
          <img src={preview} alt={label} className="h-40 w-full rounded-xl border border-border object-cover" />
          <Button variant="ghost" onClick={retake} className="-ml-3 self-start">
            <Camera aria-hidden className="size-5" />
            {t('imagePicker.retake')}
          </Button>
        </div>
      ) : (
        <label
          className={`flex h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-surface-sunken text-sm text-text focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-dark ${shownError ? 'border-danger' : 'border-border-strong'}`}
        >
          <Camera aria-hidden className="size-6 text-primary" />
          {t('imagePicker.choose')}
          <input
            id={id}
            type="file"
            accept={TYPES.join(',')}
            capture={capture}
            onChange={handleFile}
            aria-invalid={shownError ? true : undefined}
            aria-describedby={shownError ? `${id}-error` : undefined}
            className="sr-only"
          />
        </label>
      )}
      {shownError && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {shownError}
        </p>
      )}
    </div>
  )
}
