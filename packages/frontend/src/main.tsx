import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { CarPreview } from './components/CarPreview.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

const root = document.getElementById('root')!

// Standalone preview route for NFT thumbnail generation.
// Puppeteer navigates to /preview/:tokenId to render the car.
const previewMatch = window.location.pathname.match(/^\/preview\/(\d+)$/)
if (previewMatch) {
  const tokenId = Number(previewMatch[1])
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <CarPreview tokenId={tokenId} />
      </ErrorBoundary>
    </StrictMode>
  )
} else {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
}
