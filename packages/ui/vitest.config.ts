import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Execução local do pacote: `npm test -w @ln/ui`. Na raiz, o vitest.config.ts do monorepo roda os mesmos
// arquivos (cada .tsx declara `@vitest-environment jsdom`).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
