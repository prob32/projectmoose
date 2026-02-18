/** Copy text to clipboard with fallback for older browsers */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to fallback
  }
  // Fallback: textarea + execCommand
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.style.cssText = "position:fixed;opacity:0;pointer-events:none"
  document.body.appendChild(textarea)
  textarea.select()
  const ok = document.execCommand("copy")
  document.body.removeChild(textarea)
  return ok
}
