import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './App.css'
import App from './App.jsx'
import { AuthGate } from './components/Auth/AuthGate.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthGate>
      {/* Key by user so switching accounts remounts the app — the gallery
          hooks load their tables on mount, so each user gets a fresh load. */}
      {(auth) => <App key={auth.user?.id || 'local'} auth={auth} />}
    </AuthGate>
  </StrictMode>,
)
