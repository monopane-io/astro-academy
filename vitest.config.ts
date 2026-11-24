import { defineConfig } from "vitest/config";

// Unit tests run in Node and cover the code that needs no Worker: settings,
// the session cookie, both sign-in adapters, quiz forms, text rendering and
// the deploy script.
export default defineConfig({
	test: { include: ["tests/unit/**/*.test.ts"] },
});
