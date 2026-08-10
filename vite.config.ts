import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// suitfold is a static site. There is no server: peers find each other through
// public relays and then talk directly over WebRTC.
//
// GitHub Pages serves a project site from /<repo>/, so assets need that prefix.
// BASE_PATH is set by the deploy workflow; local dev stays at the root.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
})
