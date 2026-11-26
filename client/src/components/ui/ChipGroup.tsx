const CHIP =
  // relative: the sr-only radio is absolute; inside a chip it scrolls (and clips) with it instead of widening the page.
  'relative flex min-h-11 shrink-0 cursor-pointer items-center rounded-full border border-border-strong bg-surface px-4 text-sm text-text transition duration-150 ease-out-quint active:scale-95 has-checked:border-primary-dark has-checked:bg-primary-50 has-checked:font-semibold has-checked:text-primary-darker has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary-dark'

interface ChipGroupProps<T extends string> {
  /** Already translated. */
  legend: string
  /** The radios' name, unique on the page. */
  name: string
  value: T
  options: Array<{ value: T; label: string }>
  // NoInfer: T comes from `value` and `options`, not from a setState passed here.
  onChange(value: NoInfer<T>): void
}

/** One choice as chips: a radio per option, scrolling sideways when they don't fit (History's filter, the admin lists). */
export function ChipGroup<T extends string>({ legend, name, value, options, onChange }: ChipGroupProps<T>) {
  return (
    // min-w-0: a fieldset is min-content wide by default, so the chips would widen the whole page (and push the fixed nav off a phone screen).
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm text-text">{legend}</legend>
      <div className="-mx-6 flex gap-2 overflow-x-auto px-6">
        {options.map((o) => (
          <label key={o.value} className={CHIP}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
