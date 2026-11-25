import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests drive a running site the way a user would. They need
 * the site at SITE_URL (default http://127.0.0.1:4321), in demo mode,
 * pointed at a Monopane project that has been seeded with `npm run seed`.
 */
export default defineConfig({
	testDir: "tests/e2e",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
	use: {
		baseURL: process.env.SITE_URL ?? "http://127.0.0.1:4321",
		trace: "retain-on-failure",
	},
});
