import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "https://328b3a1e392cac36ff482e326ccc5317@o4511688080162816.ingest.de.sentry.io/4511688083505232",
  environment: import.meta.env.MODE,

  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      maskAllText: false,   // Hebrew text is important for debugging
      blockAllMedia: false,  // We need to see the PDF images
    }),
  ],

  // Tracing — sample everything in dev, 20% in production
  tracesSampleRate: import.meta.env.MODE === "production" ? 0.2 : 1.0,
  tracePropagationTargets: [
    "localhost",
    /^https:\/\/app\.ddcpa\.co\.il/,
    /^https:\/\/hickopn9f0\.execute-api\.il-central-1\.amazonaws\.com/,
  ],

  // Session Replay — record all error sessions, 10% of normal sessions
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
