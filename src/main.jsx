import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './App.css'
import App from './App.jsx'
import { AuthGate } from './components/Auth/AuthGate.jsx'
import { I18nProvider } from './i18n.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider><AuthGate>
      {/* Key by user so switching accounts remounts the app — the gallery
          hooks load their tables on mount, so each user gets a fresh load. */}
      {(auth) => <App key={auth.user?.id || 'local'} auth={auth} />}
    </AuthGate></I18nProvider>
  </StrictMode>,
)
