import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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
