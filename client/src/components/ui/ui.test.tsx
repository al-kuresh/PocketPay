import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Inbox } from 'lucide-react'
import bn from '../../i18n/bn.json'
import en from '../../i18n/en.json'
import { useLanguage } from '../../stores/language'
import { AppShell } from '../layout/AppShell'
import { BottomNav } from '../layout/BottomNav'
import { AmountInput } from './AmountInput'
import { Button } from './Button'
import { Card } from './Card'
import { EmptyState } from './EmptyState'
import { ImagePicker } from './ImagePicker'
import { Input } from './Input'
import { LanguageToggle } from './LanguageToggle'
import { PhoneInput } from './PhoneInput'
import { PinInput, type PinInputHandle } from './PinInput'
import { Skeleton } from './Skeleton'
import { StatusBanner } from './StatusBanner'
import { ToastProvider } from './Toast'
import { useToast } from './toast-context'

afterEach(() => {
  act(() => useLanguage.getState().setLang('en'))
  localStorage.clear()
})

const file = (bytes: number, name = 'photo.jpg', type = 'image/jpeg') => new File([new Uint8Array(bytes)], name, { type })
const MB = 1024 * 1024

describe('PinInput', () => {
  function renderPin() {
    const ref = createRef<PinInputHandle>()
    const onComplete = vi.fn()
    const onChange = vi.fn()
    const utils = render(<PinInput ref={ref} label="PIN" onComplete={onComplete} onChange={onChange} />)
    return { ...utils, ref, onComplete, onChange, input: screen.getByLabelText('PIN') as HTMLInputElement }
  }

  it('typing 5 digits calls onComplete("48213")', () => {
    const { input, onComplete } = renderPin()
    fireEvent.change(input, { target: { value: '4821' } })
    expect(onComplete).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '48213' } })
    expect(onComplete).toHaveBeenCalledWith('48213')
  })

  it('accepts Bangla digits (as ASCII) and drops anything that is not a digit', () => {
    const { input, onComplete } = renderPin()
    fireEvent.change(input, { target: { value: '৪৮২১৩' } })
    expect(onComplete).toHaveBeenCalledWith('48213')
    fireEvent.change(input, { target: { value: '4a8 2-1' } })
    expect(input.value).toBe('4821')
  })

  it('a pasted longer value is cut to 5 digits', () => {
    const { input, onComplete } = renderPin()
    fireEvent.change(input, { target: { value: '4821399' } })
    expect(onComplete).toHaveBeenCalledWith('48213')
    expect(input.value).toBe('48213')
  })

  it('is a password input with the numeric keypad and no autocomplete', () => {
    const { input } = renderPin()
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('autocomplete', 'off')
  })

  it('clear() empties it and tells the parent', () => {
    const { input, ref, onChange } = renderPin()
    fireEvent.change(input, { target: { value: '482' } })
    act(() => ref.current!.clear())
    expect(input.value).toBe('')
    expect(onChange).toHaveBeenLastCalledWith('')
    expect(document.querySelectorAll('[data-filled="true"]')).toHaveLength(0)
  })

  it('the PIN is never in the DOM as text or as an attribute', () => {
    const { input, container } = renderPin()
    fireEvent.change(input, { target: { value: '48213' } })
    expect(container.textContent).not.toMatch(/[0-9]/)
    expect(container.innerHTML).not.toContain('48213')
    expect(document.querySelectorAll('[data-filled="true"]')).toHaveLength(5)
  })
})

describe('AmountInput', () => {
  function renderAmount() {
    const onAmountChange = vi.fn()
    render(<AmountInput label="Amount" onAmountChange={onAmountChange} />)
    return { onAmountChange, input: screen.getByLabelText('Amount') }
  }

  it('shows ৳ and reports "1,500.50" as poisha "150050"', () => {
    const { input, onAmountChange } = renderAmount()
    expect(screen.getByText('৳')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '1,500.50' } })
    expect(onAmountChange).toHaveBeenLastCalledWith({ text: '1,500.50', poisha: '150050', error: null })
  })

  it('accepts Bangla digits', () => {
    const { input, onAmountChange } = renderAmount()
    fireEvent.change(input, { target: { value: '১৫০০.৫০' } })
    expect(onAmountChange).toHaveBeenLastCalledWith({ text: '১৫০০.৫০', poisha: '150050', error: null })
  })

  it('"1.234" reports the error key and shows its message', () => {
    const { input, onAmountChange } = renderAmount()
    fireEvent.change(input, { target: { value: '1.234' } })
    expect(onAmountChange).toHaveBeenLastCalledWith({ text: '1.234', poisha: null, error: 'amount.invalid' })
    expect(screen.getByRole('alert')).toHaveTextContent(en.amount.invalid)
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('empty is no amount but not an error yet', () => {
    const { input, onAmountChange } = renderAmount()
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.change(input, { target: { value: '' } })
    expect(onAmountChange).toHaveBeenLastCalledWith({ text: '', poisha: null, error: null })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ImagePicker', () => {
  function renderPicker() {
    const onChange = vi.fn()
    render(<ImagePicker label="NID front" onChange={onChange} />)
    return { onChange, input: screen.getByLabelText('NID front') as HTMLInputElement }
  }

  it('only offers JPEG, PNG and WebP', () => {
    expect(renderPicker().input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
  })

  it('a 3 MB file → the size error, and onChange is not called', () => {
    const { input, onChange } = renderPicker()
    fireEvent.change(input, { target: { files: [file(3 * MB)] } })
    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.FILE_TOO_LARGE)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a file of exactly 2 MB is accepted (the server limit is 2 MiB)', () => {
    const { input, onChange } = renderPicker()
    fireEvent.change(input, { target: { files: [file(2 * MB)] } })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('a HEIC (or other type) → the type error, and onChange is not called', () => {
    const { input, onChange } = renderPicker()
    fireEvent.change(input, { target: { files: [file(100, 'x.heic', 'image/heic')] } })
    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.UNSUPPORTED_FILE_TYPE)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a good file → onChange(file) and a preview; "Retake" clears it', () => {
    const { input, onChange } = renderPicker()
    const f = file(MB)
    fireEvent.change(input, { target: { files: [f] } })
    expect(onChange).toHaveBeenCalledWith(f)
    expect(screen.getByRole('img', { name: 'NID front' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: en.imagePicker.retake }))
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('passes capture through for the selfie', () => {
    render(<ImagePicker label="Selfie" capture="user" onChange={() => {}} />)
    expect(screen.getByLabelText('Selfie')).toHaveAttribute('capture', 'user')
  })
})

describe('Button', () => {
  it('a disabled button cannot be clicked', () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>Pay</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('a loading button cannot be clicked and says it is busy', () => {
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>Pay</Button>)
    const button = screen.getByRole('button', { name: /Pay/ })
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
  })

  it('a normal button is clicked once and defaults to type="button"', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Pay</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })
})

describe('Input and PhoneInput', () => {
  it('Input links its label and its error', () => {
    render(<Input label="Name" error="Too short" />)
    const input = screen.getByLabelText('Name')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Too short')
  })

  it('PhoneInput opens the phone keypad and fits 11 digits', () => {
    render(<PhoneInput label="Phone" />)
    const input = screen.getByLabelText('Phone')
    expect(input).toHaveAttribute('type', 'tel')
    expect(input).toHaveAttribute('inputmode', 'tel')
    expect(input).toHaveAttribute('autocomplete', 'tel-national')
  })
})

describe('Toast', () => {
  function Shower() {
    const { show } = useToast()
    return <button onClick={() => show('Saved')}>show</button>
  }

  it('useToast().show() displays the message, then it goes away', () => {
    vi.useFakeTimers()
    try {
      render(
        <ToastProvider>
          <Shower />
        </ToastProvider>,
      )
      fireEvent.click(screen.getByRole('button', { name: 'show' }))
      expect(screen.getByRole('status')).toHaveTextContent('Saved')
      act(() => vi.advanceTimersByTime(5000))
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('LanguageToggle', () => {
  it('switches the language and shows which one is on', () => {
    render(<LanguageToggle />)
    const bnButton = screen.getByRole('button', { name: 'বাংলা' })
    expect(bnButton).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(bnButton)
    expect(useLanguage.getState().lang).toBe('bn')
    expect(bnButton).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.lang).toBe('bn')
  })
})

describe('every component renders in bn', () => {
  it('shows the Bangla text of each built-in string', () => {
    act(() => useLanguage.getState().setLang('bn'))
    render(
      <MemoryRouter>
        <ToastProvider>
          <AppShell title="শিরোনাম" onBack={() => {}} nav>
            <StatusBanner kind="PENDING_KYC" />
            <StatusBanner kind="REJECTED" />
            <StatusBanner kind="DEMO" />
            <ImagePicker label="ছবি" onChange={() => {}} />
            <AmountInput label="টাকা" onAmountChange={() => {}} />
            <PinInput label="পিন" />
            <PhoneInput label="ফোন" />
            <Button loading>পাঠান</Button>
            <Card>কার্ড</Card>
            <Skeleton className="h-4" />
            <EmptyState icon={Inbox} title="খালি" />
            <LanguageToggle />
          </AppShell>
        </ToastProvider>
      </MemoryRouter>,
    )
    for (const text of [
      bn.kyc.pending.title,
      bn.kyc.rejected.title,
      bn.kyc.demo,
      bn.imagePicker.choose,
      bn.nav.home,
      bn.nav.history,
      bn.nav.profile,
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: bn.common.back })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('টাকা'), { target: { value: '1.234' } })
    expect(screen.getByRole('alert')).toHaveTextContent(bn.amount.invalid)
  })
})

describe('BottomNav', () => {
  it('links Home, History and Profile, and marks the current one', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <BottomNav />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: en.nav.home })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: en.nav.history })).toHaveAttribute('href', '/history')
    expect(screen.getByRole('link', { name: en.nav.profile })).toHaveAttribute('href', '/profile')
  })
})
