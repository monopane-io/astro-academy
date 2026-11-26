/**
 * Signing an admin in with their Monopane account.
 *
 * The site sends the person to Monopane, which asks who they are and whether
 * this site may act for them, and sends them back with a one-time code. The
 * site swaps the code for a token. Three things keep that safe:
 *
 * - `state`: a random value kept in this browser's cookie and echoed by
 *   Monopane. A reply that does not carry it was not asked for by this
 *   browser, and is refused.
 * - PKCE: the site keeps a secret (the verifier) and sends Monopane only its
 *   hash. The code is useless to anyone who does not hold the verifier.
 * - Monopane only ever sends people back to this project's own addresses.
 *
 * The site holds no password and no key that can change content: what the
 * admin can do is decided by Monopane, and ends when the token does.
 */
import type { AstroCookies } from "astro";
import type { Config } from "../config";
import { safeNext } from "../session";
import {
	type AdminSession,
	SIGN_IN_START_MAX_AGE,
	adminCookieNames,
	adminCookieOptions,
	openSignInStart,
	pkceChallenge,
	randomToken,
	sameText,
	sealAdminSession,
	sealSignInStart,
} from "./session";

/** What the site asks Monopane for. Monopane grants a project's site this and nothing else. */
const SCOPE = "deployment:admin";
/** Where Monopane sends the person back to, on this site. */
export const CALLBACK_PATH = "/admin/callback";
export const ADMIN_HOME = "/admin";

/** This project's sign-in client at Monopane: worked out from the project ID, with nothing to set up. */
const clientId = (config: Config) => `signin_${config.projectId}`;

/** Where to go after signing in: somewhere in the admin area, or its front page. */
function adminNext(next: string | null | undefined): string {
	const path = safeNext(next);
	return path === ADMIN_HOME || path.startsWith(`${ADMIN_HOME}/`) ? path : ADMIN_HOME;
}

/** The address at Monopane to send the person to, having remembered what is needed to finish. */
export async function startSignIn(
	config: Config,
	cookies: AstroCookies,
	url: URL,
	next: string | null,
): Promise<string> {
	const state = randomToken();
	const verifier = randomToken();
	cookies.set(
		adminCookieNames(url).start,
		await sealSignInStart({ state, verifier, next: adminNext(next) }, config.sessionSecret),
		{ ...adminCookieOptions(url), maxAge: SIGN_IN_START_MAX_AGE },
	);
	const authorize = new URL("/oauth/authorize", config.apiUrl);
	authorize.search = new URLSearchParams({
		response_type: "code",
		client_id: clientId(config),
		redirect_uri: `${url.origin}${CALLBACK_PATH}`,
		scope: SCOPE,
		state,
		code_challenge: await pkceChallenge(verifier),
		code_challenge_method: "S256",
	}).toString();
	return authorize.toString();
}

export type SignInOutcome =
	| { ok: true; next: string }
	| { ok: false; reason: "declined" | "expired" | "refused" };

/**
 * Finish signing in: check the reply is the one this browser asked for, swap
 * the code for a token, and keep it in the admin cookie.
 */
export async function finishSignIn(
	config: Config,
	cookies: AstroCookies,
	url: URL,
): Promise<SignInOutcome> {
	const names = adminCookieNames(url);
	const start = await openSignInStart(cookies.get(names.start)?.value, config.sessionSecret);
	// Whatever happens next, this attempt is over.
	cookies.delete(names.start, adminCookieOptions(url));

	const state = url.searchParams.get("state");
	if (!start || !state || !sameText(state, start.state)) return { ok: false, reason: "expired" };
	if (url.searchParams.get("error")) return { ok: false, reason: "declined" };
	const code = url.searchParams.get("code");
	if (!code) return { ok: false, reason: "refused" };

	const response = await fetch(new URL("/oauth/token", config.apiUrl), {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			client_id: clientId(config),
			redirect_uri: `${url.origin}${CALLBACK_PATH}`,
			code_verifier: start.verifier,
		}),
	});
	if (!response.ok) return { ok: false, reason: "refused" };
	const reply = (await response.json()) as {
		access_token?: unknown;
		expires_in?: unknown;
		account?: { name?: unknown; email?: unknown };
	};
	if (typeof reply.access_token !== "string" || typeof reply.expires_in !== "number") {
		return { ok: false, reason: "refused" };
	}

	const session: AdminSession = {
		token: reply.access_token,
		expires: Date.now() + reply.expires_in * 1000,
		...(typeof reply.account?.name === "string" ? { name: reply.account.name.slice(0, 200) } : {}),
		...(typeof reply.account?.email === "string"
			? { email: reply.account.email.slice(0, 320) }
			: {}),
	};
	cookies.set(names.session, await sealAdminSession(session, config.sessionSecret), {
		...adminCookieOptions(url),
		maxAge: reply.expires_in,
	});
	return { ok: true, next: start.next };
}

/** Sign the admin out: end the token at Monopane, then forget it here. */
export async function signOutAdmin(
	config: Config,
	cookies: AstroCookies,
	url: URL,
	session: AdminSession | null,
): Promise<void> {
	cookies.delete(adminCookieNames(url).session, adminCookieOptions(url));
	if (!session) return;
	// If Monopane cannot be reached the cookie is gone all the same, and the
	// token runs out by itself within the hour.
	await fetch(new URL("/oauth/revoke", config.apiUrl), {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ token: session.token, client_id: clientId(config) }),
	}).catch(() => undefined);
}
