import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" a unit/integrációs tesztekben: üres stub (Next biztosítja a valódi védelmet)
      "server-only": fileURLToPath(new URL("./tests/helpers/server-only.ts", import.meta.url)),
    },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"], setupFiles: ["tests/helpers/nodeSetup.ts"] },
});
