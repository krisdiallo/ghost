import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.GHOST_PORT ?? 3001}`,
        changeOrigin: true,
      },
      "/mcp": {
        target: `http://127.0.0.1:${process.env.GHOST_PORT ?? 3001}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: { main: "index.html", sensor: "sensor.html" },
      output: {
        manualChunks: (id: string) =>
          id.includes("node_modules/three/") ||
          id.includes("node_modules/@react-three/fiber/")
            ? "three"
            : undefined,
      },
    },
  },
});
