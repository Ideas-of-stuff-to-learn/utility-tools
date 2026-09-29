import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './landing.css'
import App from './App.jsx'

// GitHub Pages serves this app as the site-wide 404 page, so a reload or
// bookmark of a cashflow deep link (/utility-tools/cashflow/dashboard) lands
// here. Hand it back to cashflow's own index.html, which restores the path
// from ?p= (allowlisted there). Never re-forward a URL that already has ?p=,
// so a missing cashflow deploy can't turn into a redirect loop.
const CASHFLOW_BASE = '/utility-tools/cashflow/'
const { pathname, search } = window.location
const isCashflowDeepLink = import.meta.env.PROD
  && pathname.startsWith(CASHFLOW_BASE)
  && !new URLSearchParams(search).has('p')

if (isCashflowDeepLink) {
  window.location.replace(`${CASHFLOW_BASE}?p=${encodeURIComponent(pathname.slice(CASHFLOW_BASE.length - 1))}`)
} else {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
