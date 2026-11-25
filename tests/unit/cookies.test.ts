import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { AstroCookieSetOptions, AstroCookies } from "astro";
import { describe, expect, it, vi } from "vitest";

// Signing in creates the learner through the API; here it needs no network.
vi.mock("../../src/lib/monopane", () => ({
	findOrCreateLearner: vi.fn(async () => ({ id: "lrn_1" })),
}));

import type { AuthAdapter } from "../../src/lib/auth/types";
import type { Config } from "../../src/lib/config";
import { SESSION_MAX_AGE, sessionCookieName } from "../../src/lib/session";
import { sessionCookieOptions, signIn, signOut } from "../../src/lib/sign-in";

/**
 * The site may share a parent domain with other sites (each on its own
 * subdomain), so no cookie it sets may be scoped wider than its own hostname.
 * Every cookie must also be HttpOnly, Secure over https, SameSite=Lax or
 * stricter, and on Path=/.
 */

type Written = { op: "set" | "delete"; name: string; options: AstroCookieSetOptions };

/** A cookie jar that records every cookie the code sets or deletes, with its options. */
function recordingCookies(): { cookies: AstroCookies; written: Written[] } {
	const written: Written[] = [];
	const cookies = {
		set: (name: string, _value: unknown, options: AstroCookieSetOptions = {}) => {
			written.push({ op: "set", name, options });
		},
		delete: (name: string, options: AstroCookieSetOptions = {}) => {
			written.push({ op: "delete", name, options });
		},
		get: () => undefined,
		has: () => false,
		merge: () => {},
		headers: function* () {},
	} as unknown as AstroCookies;
	return { cookies, written };
}

const config = { sessionSecret: "s".repeat(32) } as Config;
const adapter = { mode: "demo", forProduction: false } as AuthAdapter;
const identity = { id: "demo:ada@example.com", name: "Ada", email: "ada@example.com" };

const HTTPS = new URL("https://academy.example.com/sign-in");
const HTTP = new URL("http://localhost:4321/sign-in");

/** Everything the site writes to cookies: signing in, then signing out. */
async function everyCookieWritten(url: URL): Promise<Written[]> {
	const { cookies, written } = recordingCookies();
	await signIn(identity, adapter, config, cookies, url);
	signOut(cookies, url);
	return written;
}

function expectHostOnly(cookie: Written, secure: boolean) {
	const { options } = cookie;
	expect(options, `${cookie.op} ${cookie.name}`).not.toHaveProperty("domain");
	expect(options.httpOnly).toBe(true);
	expect(options.secure).toBe(secure);
	expect(["lax", "strict", true]).toContain(options.sameSite);
	expect(options.path).toBe("/");
}

describe("cookies the site sets", () => {
	it("are the session cookie, set on sign-in and removed on sign-out", async () => {
		const written = await everyCookieWritten(HTTPS);
		expect(written.map((w) => [w.op, w.name])).toEqual([
			["set", "__Host-site_session"],
			["delete", "__Host-site_session"],
		]);
		// The prefix needs https; on this machine during development it is left off.
		expect(sessionCookieName(new URL("http://localhost:4321/"))).toBe("site_session");
		expect(written[0]?.options.maxAge).toBe(SESSION_MAX_AGE);
	});

	it("are host-only, HttpOnly, Secure, SameSite=Lax and on / over https", async () => {
		for (const cookie of await everyCookieWritten(HTTPS)) expectHostOnly(cookie, true);
	});

	it("drop only Secure on plain http, which is localhost during development", async () => {
		for (const cookie of await everyCookieWritten(HTTP)) expectHostOnly(cookie, false);
	});

	it("never name a Domain, whatever the hostname", () => {
		for (const host of ["academy.example.com", "a.b.example.co.uk", "localhost"]) {
			expect(sessionCookieOptions(new URL(`https://${host}/`))).not.toHaveProperty("domain");
		}
	});
});

describe("the site's source", () => {
	/** Every source file, so a cookie set anywhere else is noticed. */
	function sourceFiles(dir: string): string[] {
		return readdirSync(dir).flatMap((name) => {
			const path = join(dir, name);
			return statSync(path).isDirectory() ? sourceFiles(path) : [path];
		});
	}

	it("sets cookies only through the two sign-in modules, whose cookies are tested", () => {
		const root = join(__dirname, "../..");
		const touching = [...sourceFiles(join(root, "src")), ...sourceFiles(join(root, "public"))]
			.filter((path) => /\.(ts|js|mjs|astro|vue|tsx|jsx|svelte|html)$/.test(path))
			.filter((path) =>
				/cookies\.(set|delete)\(|set-cookie|document\.cookie/i.test(readFileSync(path, "utf8")),
			)
			.map((path) => relative(root, path).split("\\").join("/"));
		// The learner's (above) and the admin's (admin.test.ts).
		expect(touching.sort()).toEqual(["src/lib/admin/sign-in.ts", "src/lib/sign-in.ts"]);
	});
});
