import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ConfirmHost } from './ConfirmDialog'
import { ErrorBoundary } from './ErrorBoundary'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <ConfirmHost />
    </ErrorBoundary>
  </StrictMode>,
)
