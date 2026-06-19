import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  if (mode === "production" && process.env.VERCEL === "1" && !process.env.VITE_API_URL?.trim()) {
    throw new Error(
      "VITE_API_URL is required for Vercel builds. Set it in Vercel → Project Settings → Environment Variables.",
    );
  }

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://localhost:4000",
          changeOrigin: true,
        },
      },
    },
  };
});
