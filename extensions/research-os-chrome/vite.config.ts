import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = import.meta.dirname;

export default defineConfig({
  root,
  build: {
    outDir: resolve(root, "../../dist/research-os-chrome"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "service-worker": resolve(root, "src/background/service-worker.ts"),
        "capture-content": resolve(root, "src/content/capture-controller.ts"),
        "page-data-observer": resolve(root, "src/page/page-data-observer.ts"),
        "page-data-bridge": resolve(root, "src/content/page-data-bridge.ts"),
        popup: resolve(root, "src/popup/popup.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  plugins: [{
    name: "research-os-extension-manifest",
    closeBundle() {
      const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
      writeFileSync(
        resolve(root, "../../dist/research-os-chrome/manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    },
  }],
});
