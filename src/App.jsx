import React, { Suspense } from "react";
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import CpaDashboard from "./pages/CpaDashboard";
import ClientQuestionnaire from "./pages/ClientQuestionnaire";
import UserManagement from "./pages/UserManagement";
import Settings from "./pages/Settings";
import QuestionnaireSettings from "./pages/QuestionnaireSettings";
import CpaFillQuestionnaire from "./pages/CpaFillQuestionnaire";
import ClientsPage from "./pages/ClientsPage";
import AuthCallback from "./pages/AuthCallback";

// Lazy-loaded — pdfme is ~2MB, only load when needed
const PdfTemplateEditor = React.lazy(() => import("./pages/PdfTemplateEditor"));
const PdfTestPage = import.meta.env.DEV
  ? React.lazy(() => import("./pages/PdfTestPage"))
  : null;
const PdfSignTest = import.meta.env.DEV
  ? React.lazy(() => import("./pages/PdfSignTest"))
  : null;
// [POC TEST] Temporarily disabled to prevent pdfme from loading
// const PdfSignPage = React.lazy(() => import("./pages/PdfSignPage"));
const PdfSignPage = null;
const PdfSignIframeOverlay = React.lazy(() => import("./pages/PdfSignIframeOverlay"));
const PdfSignPageMobile = import.meta.env.DEV
  ? React.lazy(() => import("./pages/PdfSignPageMobile"))
  : null;
const PdfSignCanvasOverlay = import.meta.env.DEV
  ? React.lazy(() => import("./pages/PdfSignCanvasOverlay"))
  : null;

const suspenseSpinner = <div className="min-h-screen bg-background flex items-center justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>;

function App() {
  const pathname = window.location.pathname;

  const isDev = import.meta.env.DEV;

  // Routes that bypass auth (public)
  if (pathname === '/questionnaire' || pathname.startsWith('/questionnaire/') || (isDev && (pathname === '/pdf-test' || pathname === '/pdf-sign-test'))) {
    return (
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <Routes>
            <Route path="/questionnaire" element={<ClientQuestionnaire />} />
            <Route path="/questionnaire/sign" element={<Suspense fallback={suspenseSpinner}><PdfSignIframeOverlay /></Suspense>} />
            {isDev && PdfSignIframeOverlay && (
              <Route path="/questionnaire/sign-poc-iframe" element={<Suspense fallback={suspenseSpinner}><PdfSignIframeOverlay /></Suspense>} />
            )}
            {isDev && PdfSignPageMobile && (
              <>
                <Route path="/questionnaire/sign-poc" element={<Suspense fallback={suspenseSpinner}><PdfSignPageMobile /></Suspense>} />
                <Route path="/questionnaire/sign-poc-wizard" element={<Suspense fallback={suspenseSpinner}><PdfSignPageMobile /></Suspense>} />
              </>
            )}
            {isDev && PdfSignCanvasOverlay && (
              <Route path="/questionnaire/sign-poc-canvas" element={<Suspense fallback={suspenseSpinner}><PdfSignCanvasOverlay /></Suspense>} />
            )}
            {isDev && PdfTestPage && (
              <Route path="/pdf-test" element={<Suspense fallback={suspenseSpinner}><PdfTestPage /></Suspense>} />
            )}
            {isDev && PdfSignTest && (
              <Route path="/pdf-sign-test" element={<Suspense fallback={suspenseSpinner}><PdfSignTest /></Suspense>} />
            )}
          </Routes>
        </Router>
        <Toaster />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/" element={<CpaDashboard />} />
          <Route path="/users" element={<UserManagement />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/questionnaire-settings" element={<QuestionnaireSettings />} />
          <Route path="/pdf-templates" element={<Suspense fallback={suspenseSpinner}><PdfTemplateEditor /></Suspense>} />
          <Route path="/cpa-fill" element={<CpaFillQuestionnaire />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="*" element={<PageNotFound />} />
        </Routes>
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App
