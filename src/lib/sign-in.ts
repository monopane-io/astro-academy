import type { AstroCookieSetOptions, AstroCookies } from "astro";
import type { AuthAdapter, Identity, User } from "./auth/types";
import type { Config } from "./config";
import { findOrCreateUser } from "./monopane";
import { SESSION_MAX_AGE, sealSession, sessionCookieName } from "./session";

/**
 * The attributes of the user's session cookie (the admin's are in
 * admin/session.ts and follow the same rules). It
 * belongs to this hostname alone: there is no `Domain`, so neighbouring sites
 * on the same parent domain never receive it. Scripts cannot read it
 * (`HttpOnly`), it is sent only over https (plain http is only ever
 * localhost during development), and other sites cannot make the browser
 * send it with a form post (`SameSite=Lax`). Signing in and signing out use
 * the same attributes, so the browser replaces exactly this cookie.
 */
export function sessionCookieOptions(
	url: URL,
): Required<Pick<AstroCookieSetOptions, "httpOnly" | "secure" | "sameSite" | "path">> {
	return {
		httpOnly: true,
		secure: url.protocol === "https:",
		sameSite: "lax",
		path: "/",
	};
}

/**
 * Sign an identified person in: find or create their user in Monopane and
 * set the session cookie. The same for every sign-in adapter.
 */
export async function signIn(
	identity: Identity,
	adapter: AuthAdapter,
	config: Config,
	cookies: AstroCookies,
	url: URL,
): Promise<User> {
	const record = await findOrCreateUser(identity, { emailVerified: adapter.forProduction });
	const user: User = { ...identity, userId: record.id };
	cookies.set(sessionCookieName(url), await sealSession(user, config.sessionSecret), {
		...sessionCookieOptions(url),
		maxAge: SESSION_MAX_AGE,
	});
	return user;
}

export function signOut(cookies: AstroCookies, url: URL): void {
	cookies.delete(sessionCookieName(url), sessionCookieOptions(url));
}

/** The sign-in page's address, remembering where the person was going. */
export function signInUrl(next: string): string {
	return `/sign-in?next=${encodeURIComponent(next)}`;
}
