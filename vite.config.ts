import { defineConfig } from "vite";

const appOrigins = ["http://localhost:4180", "http://127.0.0.1:4180"];

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 4180,
    strictPort: true,
    // Only the app's own pages may make cross-origin reads from the dev server.
    cors: { origin: appOrigins },
    proxy: { "/api": "http://127.0.0.1:4181" },
    fs: {
      // Vite's defaults plus the local workspace database and its backups.
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        "**/data/**",
        "**/data-*/**",
        "**/*.sqlite*",
      ],
    },
  },
  build: { outDir: "dist" },
});
