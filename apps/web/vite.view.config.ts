import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist/mcp-view",
    lib: {
      entry: "src/mcp-view.tsx",
      formats: ["es"],
      fileName: () => "body-view.js",
      cssFileName: "body-view",
    },
    minify: true,
  },
});
