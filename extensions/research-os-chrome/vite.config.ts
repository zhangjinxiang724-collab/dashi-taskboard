import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = import.meta.dirname;
const researchOsBaseUrl = process.env.RESEARCH_OS_EXTENSION_BASE_URL ?? "http://127.0.0.1:47823";
const parsedBaseUrl = new URL(researchOsBaseUrl);
if (
  parsedBaseUrl.protocol !== "http:"
  || parsedBaseUrl.hostname !== "127.0.0.1"
  || parsedBaseUrl.pathname !== "/"
  || parsedBaseUrl.search
  || parsedBaseUrl.hash
) {
  throw new Error("RESEARCH_OS_EXTENSION_BASE_URL must be an exact http://127.0.0.1:<port> origin");
}

export default defineConfig({
  root,
  define: {
    __RESEARCH_OS_BASE_URL__: JSON.stringify(parsedBaseUrl.origin),
  },
  build: {
    outDir: resolve(root, "../../dist/research-os-chrome"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "service-worker": resolve(root, "src/background/service-worker.ts"),
        "capture-content": resolve(root, "src/content/capture-controller.ts"),
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
      manifest.host_permissions = [`${parsedBaseUrl.origin}/*`];
      writeFileSync(
        resolve(root, "../../dist/research-os-chrome/manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    },
  }],
});
