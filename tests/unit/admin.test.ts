import type { AstroCookies } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	backTo,
	fromThisSite,
	isAdminPath,
	protectAdminReply,
	resendNotice,
} from "../../src/lib/admin/pages";
import {
	adminCookieNames,
	adminCookieOptions,
	open,
	openAdminSession,
	openSignInStart,
	pkceChallenge,
	sameText,
	seal,
	sealAdminSession,
	sealSignInStart,
} from "../../src/lib/admin/session";
import { finishSignIn, signOutAdmin, startSignIn } from "../../src/lib/admin/sign-in";
import type { Config } from "../../src/lib/config";

const SECRET = "0123456789abcdef0123456789abcdef";
const TOKEN = "mpa_0123456789abcdef0123456789abcdef";
const HTTPS = new URL("https://academy.example.com/admin");
const config = {
	projectId: "prj_test",
	apiUrl: "https://api.example.test",
	sessionSecret: SECRET,
} as Config;

/** A cookie jar that records what was written, like the one Astro hands a page. */
function jar(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	const written: { op: string; name: string; options: Record<string, unknown> }[] = [];
	const cookies = {
		get: (name: string) => (values.has(name) ? { value: values.get(name) } : undefined),
		set: (name: string, value: string, options: Record<string, unknown>) => {
			values.set(name, value);
			written.push({ op: "set", name, options });
		},
		delete: (name: string, options: Record<string, unknown>) => {
			values.delete(name);
			written.push({ op: "delete", name, options });
		},
	} as unknown as AstroCookies;
	return { cookies, values, written };
}

afterEach(() => vi.unstubAllGlobals());

describe("the admin cookie", () => {
	it("cannot be read without the secret, and does not show the token", async () => {
		const value = await sealAdminSession({ token: TOKEN, expires: Date.now() + 60_000 }, SECRET);
		expect(value).not.toContain(TOKEN);
		expect(atob(value.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "")).not.toContain(
			"mpa_",
		);
		expect(await openAdminSession(value, SECRET)).toMatchObject({ token: TOKEN });
		expect(await openAdminSession(value, `${SECRET}x`)).toBeNull();
	});

	it("is refused when altered, expired, or made for something else", async () => {
		const value = await sealAdminSession({ token: TOKEN, expires: Date.now() + 60_000 }, SECRET);
		// Change one character of the sealed value (the second to last).
		const flipped = `${value.slice(0, -2)}${value.at(-2) === "A" ? "B" : "A"}${value.slice(-1)}`;
		expect(flipped).not.toBe(value);
		expect(await openAdminSession(flipped, SECRET)).toBeNull();
		expect(await openAdminSession(value, SECRET, Date.now() + 61_000)).toBeNull();
		expect(await openAdminSession(undefined, SECRET)).toBeNull();
		expect(await openAdminSession("not.a.cookie", SECRET)).toBeNull();
		// A sign-in-start cookie is not a session, and the reverse.
		const start = await sealSignInStart({ state: "s", verifier: "v", next: "/admin" }, SECRET);
		expect(await openAdminSession(start, SECRET)).toBeNull();
		expect(await openSignInStart(value, SECRET)).toBeNull();
		// Sealed as a session but without a token.
		expect(
			await openAdminSession(await seal("session", { expires: 9e15 }, SECRET), SECRET),
		).toBeNull();
		expect(await open("session", await seal("session", { a: 1 }, SECRET), SECRET)).toEqual({
			a: 1,
		});
	});

	it("is for this host only: __Host- prefix, HttpOnly, Secure, SameSite=Lax, no Domain", () => {
		expect(adminCookieNames(HTTPS)).toEqual({
			session: "__Host-admin",
			start: "__Host-admin_start",
		});
		const options = adminCookieOptions(HTTPS);
		expect(options).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
		expect(options).not.toHaveProperty("domain");
		// Over plain http (this machine only) the prefix cannot be used.
		expect(adminCookieNames(new URL("http://localhost:4321/")).session).toBe("admin");
	});
});

describe("signing an admin in", () => {
	it("sends them to Monopane with PKCE and a state kept in this browser", async () => {
		const { cookies, values, written } = jar();
		const address = new URL(await startSignIn(config, cookies, HTTPS, "/admin/courses/x"));
		expect(`${address.origin}${address.pathname}`).toBe("https://api.example.test/oauth/authorize");
		const params = address.searchParams;
		expect(params.get("client_id")).toBe("signin_prj_test");
		expect(params.get("redirect_uri")).toBe("https://academy.example.com/admin/callback");
		expect(params.get("scope")).toBe("deployment:admin");
		expect(params.get("code_challenge_method")).toBe("S256");

		const start = await openSignInStart(values.get("__Host-admin_start"), SECRET);
		expect(start?.state).toBe(params.get("state"));
		expect(start?.next).toBe("/admin/courses/x");
		// Monopane is sent the verifier's hash, never the verifier.
		expect(params.get("code_challenge")).toBe(await pkceChallenge(start?.verifier ?? ""));
		expect(address.toString()).not.toContain(start?.verifier);
		expect(written[0]?.options).toMatchObject({ httpOnly: true, secure: true, maxAge: 600 });
	});

	it("only ever returns to somewhere in the admin area", async () => {
		for (const next of [
			"https://evil.example/",
			"//evil.example",
			"/courses/x",
			"/administrator",
			null,
		]) {
			const { cookies, values } = jar();
			await startSignIn(config, cookies, HTTPS, next);
			expect(
				(await openSignInStart(values.get("__Host-admin_start"), SECRET))?.next,
				String(next),
			).toBe("/admin");
		}
	});

	async function started() {
		const store = jar();
		const address = new URL(await startSignIn(config, store.cookies, HTTPS, "/admin"));
		return { ...store, state: address.searchParams.get("state") ?? "" };
	}
	const callback = (query: string) =>
		new URL(`https://academy.example.com/admin/callback?${query}`);

	it("swaps the code for a token, with the verifier, and keeps it encrypted", async () => {
		const { cookies, values, state } = await started();
		const verifier = (await openSignInStart(values.get("__Host-admin_start"), SECRET))?.verifier;
		const fetched = vi.fn(async (_url: URL | string, init?: RequestInit) => {
			const body = init?.body as URLSearchParams;
			expect(body.get("code")).toBe("the-code");
			expect(body.get("code_verifier")).toBe(verifier);
			expect(body.get("redirect_uri")).toBe("https://academy.example.com/admin/callback");
			return Response.json({ access_token: TOKEN, expires_in: 3600, token_type: "Bearer" });
		});
		vi.stubGlobal("fetch", fetched);

		const outcome = await finishSignIn(config, cookies, callback(`code=the-code&state=${state}`));
		expect(outcome).toEqual({ ok: true, next: "/admin" });
		expect(String(fetched.mock.calls[0]?.[0])).toBe("https://api.example.test/oauth/token");
		expect(values.has("__Host-admin_start")).toBe(false);
		const cookie = values.get("__Host-admin") ?? "";
		expect(cookie).not.toContain(TOKEN);
		expect(await openAdminSession(cookie, SECRET)).toMatchObject({ token: TOKEN });
	});

	it("refuses a reply this browser did not ask for, without calling Monopane", async () => {
		const fetched = vi.fn();
		vi.stubGlobal("fetch", fetched);
		// No sign-in was started here.
		expect(await finishSignIn(config, jar().cookies, callback("code=c&state=anything"))).toEqual({
			ok: false,
			reason: "expired",
		});
		// One was, but the reply carries another state, or none.
		for (const query of ["code=c&state=wrong", "code=c"]) {
			const { cookies, values } = await started();
			expect(await finishSignIn(config, cookies, callback(query))).toEqual({
				ok: false,
				reason: "expired",
			});
			// The attempt is spent: the same reply cannot be tried again.
			expect(values.has("__Host-admin_start")).toBe(false);
			expect(values.has("__Host-admin")).toBe(false);
		}
		expect(fetched).not.toHaveBeenCalled();
	});

	it("signs nobody in when the person said no or Monopane refuses the code", async () => {
		const declined = await started();
		vi.stubGlobal("fetch", vi.fn());
		expect(
			await finishSignIn(
				config,
				declined.cookies,
				callback(`error=access_denied&state=${declined.state}`),
			),
		).toEqual({ ok: false, reason: "declined" });

		const refused = await started();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 400 })),
		);
		expect(
			await finishSignIn(config, refused.cookies, callback(`code=c&state=${refused.state}`)),
		).toEqual({ ok: false, reason: "refused" });
		expect(refused.values.has("__Host-admin")).toBe(false);
	});

	it("signing out ends the token at Monopane and forgets it, even if Monopane is unreachable", async () => {
		const fetched = vi.fn(async () => {
			throw new Error("unreachable");
		});
		vi.stubGlobal("fetch", fetched);
		const { cookies, values } = jar({ "__Host-admin": "x" });
		await signOutAdmin(config, cookies, HTTPS, { token: TOKEN, expires: Date.now() + 1000 });
		expect(values.has("__Host-admin")).toBe(false);
		const [url, init] = fetched.mock.calls[0] as unknown as [URL, RequestInit];
		expect(String(url)).toBe("https://api.example.test/oauth/revoke");
		expect((init.body as URLSearchParams).get("token")).toBe(TOKEN);
	});
});

describe("coming back after signing in again", () => {
	it("returns to the page the admin was on, with its query", async () => {
		const { cookies, values } = jar();
		await startSignIn(config, cookies, HTTPS, "/admin/users?q=ada&status=active");
		expect((await openSignInStart(values.get("__Host-admin_start"), SECRET))?.next).toBe(
			"/admin/users?q=ada&status=active",
		);
	});

	it("after a form post, returns to the form's page and says the change was not sent", () => {
		const page = new URL("https://academy.example.com/admin/courses/crs_1?done=Saved");
		expect(backTo(page, "GET")).toBe("/admin/courses/crs_1?done=Saved");
		const sent = backTo(page, "POST");
		expect(sent).toBe("/admin/courses/crs_1?done=Saved&resend=1");
		expect(resendNotice(new URL(sent, page))).toMatch(/nothing was changed\. Send it again/);
		expect(resendNotice(page)).toBeNull();
		// Not added twice.
		expect(backTo(new URL(sent, page), "POST")).toBe(sent);
	});

	it("after Leave admin, the next sign-in asks Monopane for the password, once", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("{}")),
		);
		const { cookies, values } = jar({ "__Host-admin": "x" });
		await signOutAdmin(config, cookies, HTTPS, { token: TOKEN, expires: Date.now() + 1000 });
		expect(values.get("__Host-admin_left")).toBe("1");

		const first = new URL(await startSignIn(config, cookies, HTTPS, "/admin"));
		expect(first.searchParams.get("prompt")).toBe("login");
		const second = new URL(await startSignIn(config, cookies, HTTPS, "/admin"));
		expect(second.searchParams.get("prompt")).toBeNull();
	});
});

describe("the admin area's protection", () => {
	const url = new URL("https://academy.example.com/admin/courses");
	const post = (origin?: string) =>
		new Request(url, { method: "POST", headers: origin ? { Origin: origin } : {} });

	it("accepts a form only from this site", () => {
		expect(fromThisSite(new Request(url), url)).toBe(true);
		expect(fromThisSite(post("https://academy.example.com"), url)).toBe(true);
		for (const origin of [
			"https://evil.example",
			"https://academy.example.com.evil.example",
			"http://academy.example.com",
			"https://other.example.com",
			"null",
			undefined,
		]) {
			expect(fromThisSite(post(origin), url), String(origin)).toBe(false);
		}
	});

	it("covers /admin and everything under it, and nothing that only looks like it", () => {
		for (const path of ["/admin", "/admin/", "/admin/callback", "/admin/courses/x"]) {
			expect(isAdminPath(path), path).toBe(true);
		}
		for (const path of ["/", "/administrator", "/courses/admin", "/admins"]) {
			expect(isAdminPath(path), path).toBe(false);
		}
	});

	it("marks every reply as private and not to be framed", () => {
		const headers = new Headers();
		protectAdminReply(headers);
		expect(headers.get("Cache-Control")).toBe("private, no-store");
		expect(headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
	});

	it("compares secrets in full", () => {
		expect(sameText("abc", "abc")).toBe(true);
		expect(sameText("abc", "abd")).toBe(false);
		expect(sameText("abc", "abcd")).toBe(false);
	});
});
