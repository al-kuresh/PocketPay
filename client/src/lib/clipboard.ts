/**
 * Copies `text`; true when it worked. navigator.clipboard only exists in secure contexts (not on dev:phone's
 * plain http), so the fallback is a hidden textarea + execCommand('copy'). Call it straight from the tap handler:
 * execCommand needs the user gesture.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // permission denied: try the old way
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.readOnly = true // no keyboard pops up on the phone
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  area.setSelectionRange(0, text.length) // iOS ignores select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}
