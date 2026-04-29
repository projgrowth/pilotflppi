import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Top-level boundary catches crashes in the providers (Auth, Router, Query)
// before AppLayout's inner boundary gets a chance — without this, an early
// network blip during initial session fetch could white-screen the app.
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
