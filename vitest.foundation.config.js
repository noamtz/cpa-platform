import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "infra/sst/__tests__/**/*.test.ts",
      "infra/sst/__tests__/**/*.test.js",
      "backend/api/__tests__/**/*.test.ts",
    ],
    exclude: ["node_modules", "dist", ".sst"],
  },
});
