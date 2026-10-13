import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initNative } from './native/bootstrap'
import { applyEffectsLevel, readEffectsPreference, resolveStaticLevel } from './lib/effects'

// Apply the low-power level before the first paint so low-end devices never
// start the expensive effects (EffectsProvider keeps it in sync afterwards).
applyEffectsLevel(resolveStaticLevel(readEffectsPreference()).level)

/** Mount the React app. */
function render(): void {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

// Native builds apply the stored server URL before any request is made.
// A failure must not leave a blank screen: log it and render with defaults
// (the Settings page shows the effective server URL and lets the user fix it).
initNative()
  .catch((error: unknown) => console.error('Native initialisation failed', error))
  .finally(render)
