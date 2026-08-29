import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../design/tokens.css'
import './app.css'
import { App } from './App.tsx'
import { Boundary } from './Boundary.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
)
