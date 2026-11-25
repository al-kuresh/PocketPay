import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts (TASTE.md). Each file's @font-face carries a unicode-range per subset (Bengali, Latin),
// so a page only downloads the scripts it shows. Hind Siliguri: the weights in use (400/500/600).
// Anek Bangla: the variable file with both the weight and width axes (wdth.css), for the narrow amounts.
import '@fontsource/hind-siliguri/400.css'
import '@fontsource/hind-siliguri/500.css'
import '@fontsource/hind-siliguri/600.css'
import '@fontsource-variable/anek-bangla/wdth.css'
import './index.css'
import App from './App.tsx'
// Loads i18n and applies the saved language (and <html lang>) before the first render.
import './stores/language'
import { restoreSession } from './api/client'

// Started before the first render; until it settles the store is 'loading' and guarded pages show a skeleton.
void restoreSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
