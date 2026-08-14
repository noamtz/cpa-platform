import "./instrument";              // Sentry — MUST be first import
import * as Sentry from "@sentry/react";
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <Sentry.ErrorBoundary fallback={<div dir="rtl" style={{padding: '2rem', textAlign: 'center'}}>אירעה שגיאה. אנא נסו שוב.</div>}>
    <App />
  </Sentry.ErrorBoundary>
)
