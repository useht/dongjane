import { readdirSync } from "node:fs";
import { defineConfig } from "vitest/config";

// `import.meta.glob` in the client's asset registry lists models/venues/ when that file is transformed, and the transform cache (keyed by
// the file's own source) cannot see a model added to the directory afterwards. Mixing the listing into the client's cache key makes a
// new venue's model reach the registry's tests the first time they run.
const venueModels = (): string => readdirSync(new URL("packages/client/src/assets/models/venues/", import.meta.url)).sort().join(",");

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
        plugins: [{ name: "venue-models", configureVitest: ({ defineCacheKeyGenerator }) => defineCacheKeyGenerator(venueModels) }],
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
