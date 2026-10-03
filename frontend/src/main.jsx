import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import "./components.css";
import App from "./App.jsx";
import { registerServiceWorker } from "./sw-register";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Registering the worker is what makes the app installable, and being installed
// is what puts Reelody in Android's share sheet.
registerServiceWorker();
