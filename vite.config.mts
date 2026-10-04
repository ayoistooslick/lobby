import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.PORT || 3000;

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    hmr: false,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
});
