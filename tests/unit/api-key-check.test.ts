import { client } from "@monopane/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { type Config, SetupError } from "../../src/lib/config";
import { REQUIRED_SCOPES, checkApiKey, configure } from "../../src/lib/monopane";

/**
 * The start-up check: the site asks Monopane what its key may do and
 * refuses to run, naming what is missing, if that is not enough.
 */

let n = 0;
/** A fresh config each time, so the remembered result of an earlier check is dropped. */
function config(): Config {
	n++;
	return {
		apiKey: `mpk_live_test_${n}`,
		tenantId: "tnt_test",
		sessionSecret: "s".repeat(32),
		environment: "production",
		apiUrl: "https://api.example.test",
		authMode: "demo",
		siteName: "Academy",
		tagline: "",
		emailVia: "resend",
		resendApiKey: null,
		emailFrom: null,
	};
}

const requests: Request[] = [];

function answerWith(status: number, body: unknown): void {
	client.setConfig({
		fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
			requests.push(new Request(input, init));
			return new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			});
		},
	});
}

async function problemsFrom(check: Promise<void>): Promise<string[]> {
	try {
		await check;
	} catch (error) {
		if (error instanceof SetupError) return error.problems;
		throw error;
	}
	return [];
}

const key = (scopes: string[]) => ({
	id: "key_1",
	tenantId: "tnt_test",
	name: "academy",
	mode: "live",
	prefix: "mpk_live_test",
	scopes,
	createdAt: "2026-01-01T00:00:00.000Z",
	revokedAt: null,
});

afterEach(() => {
	requests.length = 0;
});

describe("checkApiKey", () => {
	it("passes with exactly the seven scopes the README lists", async () => {
		const c = config();
		configure(c);
		answerWith(200, key([...REQUIRED_SCOPES]));

		expect(await problemsFrom(checkApiKey())).toEqual([]);
		expect(REQUIRED_SCOPES).toHaveLength(7);
		// It asked about its own key, with the key and the environment.
		expect(requests).toHaveLength(1);
		expect(new URL(requests[0]?.url ?? "").pathname).toBe("/tenants/tnt_test/api-keys/current");
		expect(requests[0]?.headers.get("Authorization")).toBe(`Bearer ${c.apiKey}`);
		expect(requests[0]?.headers.get("X-Environment")).toBe("production");
	});

	it("passes with an unrestricted key", async () => {
		configure(config());
		answerWith(200, key(["*"]));
		expect(await problemsFrom(checkApiKey())).toEqual([]);
	});

	it("names each missing scope", async () => {
		configure(config());
		answerWith(200, key(["content:read", "learners:read", "enrollments:read", "analytics:read"]));
		expect(await problemsFrom(checkApiKey())).toEqual([
			"MONOPANE_API_KEY is missing the scope learners:write.",
			"MONOPANE_API_KEY is missing the scope enrollments:write.",
			"MONOPANE_API_KEY is missing the scope progress:write.",
		]);
	});

	it("says so when the key is rejected or belongs to another tenant", async () => {
		configure(config());
		answerWith(401, { error: { code: "UNAUTHORIZED", message: "no" } });
		expect(await problemsFrom(checkApiKey())).toEqual([
			"Monopane rejected MONOPANE_API_KEY (401).",
		]);

		configure(config());
		answerWith(403, { error: { code: "FORBIDDEN", message: "no" } });
		expect((await problemsFrom(checkApiKey()))[0]).toContain(
			"does not belong to MONOPANE_TENANT_ID",
		);
	});

	it("says so when Monopane cannot be reached", async () => {
		configure(config());
		client.setConfig({
			fetch: async () => {
				throw new TypeError("fetch failed");
			},
		});
		expect(await problemsFrom(checkApiKey())).toEqual([
			"The Monopane API at https://api.example.test could not be reached.",
		]);
	});

	it("asks once, then remembers a good answer; a bad one is asked again", async () => {
		configure(config());
		answerWith(200, key(["content:read"]));
		await problemsFrom(checkApiKey());
		await problemsFrom(checkApiKey());
		expect(requests).toHaveLength(2);

		requests.length = 0;
		answerWith(200, key(["*"]));
		await checkApiKey();
		await checkApiKey();
		await checkApiKey();
		expect(requests).toHaveLength(1);
	});
});
