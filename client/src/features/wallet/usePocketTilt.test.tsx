import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePocketTilt } from './usePocketTilt'

function Pocket() {
  const ref = usePocketTilt<HTMLDivElement>()
  return <div ref={ref} data-testid="pocket" />
}

/** A secure context or not, reduced motion on or off. jsdom has neither by default. */
function setUp({ secure, reduced }: { secure: boolean; reduced: boolean }) {
  vi.stubGlobal('isSecureContext', secure)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced })))
}

function tilt(beta: number, gamma: number) {
  const event = Object.assign(new Event('deviceorientation'), { beta, gamma })
  act(() => void window.dispatchEvent(event))
}

afterEach(() => vi.unstubAllGlobals())

describe('usePocketTilt', () => {
  it('plain http (not a secure context): no listener, the pocket stays flat', () => {
    setUp({ secure: false, reduced: false })
    const listen = vi.spyOn(window, 'addEventListener')
    render(<Pocket />)
    tilt(45, 30)
    expect(listen).not.toHaveBeenCalledWith('deviceorientation', expect.anything())
    expect(screen.getByTestId('pocket').style.transform).toBe('')
  })

  it('reduced motion on: no listener, the pocket stays flat', () => {
    setUp({ secure: true, reduced: true })
    const listen = vi.spyOn(window, 'addEventListener')
    render(<Pocket />)
    tilt(45, 30)
    expect(listen).not.toHaveBeenCalledWith('deviceorientation', expect.anything())
    expect(screen.getByTestId('pocket').style.transform).toBe('')
  })

  it('never asks for the iOS motion permission on load', () => {
    setUp({ secure: true, reduced: false })
    const requestPermission = vi.fn(() => Promise.resolve('granted'))
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(function DeviceOrientationEvent() {}, { requestPermission }))
    render(<Pocket />)
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('secure and motion allowed: tilts with the phone, never past ±6°', () => {
    setUp({ secure: true, reduced: false })
    render(<Pocket />)
    const pocket = screen.getByTestId('pocket')
    tilt(45, 6) // the first reading is how the user holds the phone: no front-back tilt yet
    expect(pocket.style.transform).toContain('rotateX(0deg) rotateY(2deg)')
    tilt(-90, 90)
    expect(pocket.style.transform).toContain('rotateX(6deg) rotateY(6deg)')
    tilt(180, -90)
    expect(pocket.style.transform).toContain('rotateX(-6deg) rotateY(-6deg)')
  })

  it('stops listening when the pocket goes away', () => {
    setUp({ secure: true, reduced: false })
    const unlisten = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<Pocket />)
    unmount()
    expect(unlisten).toHaveBeenCalledWith('deviceorientation', expect.any(Function))
  })
})
