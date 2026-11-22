import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_PORT = Number(process.env.PORT ?? 4317);

export default defineConfig({
  root: "client",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": `http://127.0.0.1:${API_PORT}`,
    },
  },
});
