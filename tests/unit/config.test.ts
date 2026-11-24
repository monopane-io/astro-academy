import { describe, expect, it } from "vitest";
import { SetupError, readConfig } from "../../src/lib/config";

const base = {
	MONOPANE_API_KEY: "mpk_live_x",
	MONOPANE_TENANT_ID: "tnt_x",
	SESSION_SECRET: "s".repeat(32),
};

function problems(env: Record<string, unknown>): string[] {
	try {
		readConfig(env);
	} catch (error) {
		if (error instanceof SetupError) return error.problems;
		throw error;
	}
	return [];
}

describe("readConfig", () => {
	it("needs only the key, the tenant and a session secret", () => {
		expect(readConfig(base)).toEqual({
			apiKey: "mpk_live_x",
			tenantId: "tnt_x",
			sessionSecret: "s".repeat(32),
			environment: "production",
			apiUrl: "https://api.monopane.io",
			authMode: "demo",
			siteName: "Site",
			tagline: "Courses to help you get the most out of the product.",
			resendApiKey: null,
			emailFrom: null,
		});
	});

	it("takes the optional settings", () => {
		const config = readConfig({
			...base,
			MONOPANE_ENVIRONMENT: "staging",
			MONOPANE_API_URL: "http://localhost:8787/",
			SITE_NAME: "Acme Academy",
		});
		expect(config.environment).toBe("staging");
		expect(config.apiUrl).toBe("http://localhost:8787");
		expect(config.siteName).toBe("Acme Academy");
	});

	it("names every missing setting at once", () => {
		expect(problems({})).toEqual([
			"MONOPANE_API_KEY is not set.",
			"MONOPANE_TENANT_ID is not set.",
			"SESSION_SECRET is not set.",
		]);
	});

	it("refuses a short session secret and an unknown sign-in mode", () => {
		expect(problems({ ...base, SESSION_SECRET: "short" })).toEqual([
			"SESSION_SECRET is too short. Use at least 32 random characters.",
		]);
		expect(problems({ ...base, AUTH_MODE: "password" })).toEqual([
			'AUTH_MODE is "password". Use "demo" or "magic-link".',
		]);
	});

	it("needs a sender and a token store before magic links can be switched on", () => {
		expect(problems({ ...base, AUTH_MODE: "magic-link" })).toEqual([
			"AUTH_MODE is magic-link but RESEND_API_KEY is not set.",
			"AUTH_MODE is magic-link but EMAIL_FROM is not set.",
			"AUTH_MODE is magic-link but the MAGIC_LINKS KV binding is missing.",
		]);
		const config = readConfig({
			...base,
			AUTH_MODE: "magic-link",
			RESEND_API_KEY: "re_x",
			EMAIL_FROM: "Academy <a@example.com>",
			MAGIC_LINKS: {},
		});
		expect(config.authMode).toBe("magic-link");
	});
});
