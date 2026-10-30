import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "shared",
          root: "packages/shared",
          include: ["test/**/*.test.ts"],
          environment: "node",
          testTimeout: 20000,
        },
      },
      {
        test: {
          name: "server",
          root: "packages/server",
          include: ["test/**/*.test.ts"],
          environment: "node",
          testTimeout: 20000,
          hookTimeout: 20000,
        },
      },
      {
        test: {
          name: "client",
          root: "packages/client",
          include: ["test/**/*.test.ts"],
          environment: "node",
          testTimeout: 20000,
        },
      },
    ],
  },
});
