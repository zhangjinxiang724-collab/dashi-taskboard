import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initializeTaskboardStorage } from "./storage";
import "./styles.css";
import "./quiet-workspace.css";
import "./quiet-workspace-polish.css";

async function main() {
  await initializeTaskboardStorage();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void main();
