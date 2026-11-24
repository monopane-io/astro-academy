import type { AstroCookies } from "astro";
import type { AuthAdapter, Identity, User } from "./auth/types";
import type { Config } from "./config";
import { findOrCreateLearner } from "./monopane";
import { SESSION_COOKIE, SESSION_MAX_AGE, sealSession } from "./session";

/**
 * Sign an identified person in: find or create their learner in Monopane and
 * set the session cookie. The same for every sign-in adapter.
 */
export async function signIn(
	identity: Identity,
	adapter: AuthAdapter,
	config: Config,
	cookies: AstroCookies,
	url: URL,
): Promise<User> {
	const learner = await findOrCreateLearner(identity, { emailVerified: adapter.forProduction });
	const user: User = { ...identity, learnerId: learner.id };
	cookies.set(SESSION_COOKIE, await sealSession(user, config.sessionSecret), {
		httpOnly: true,
		// Plain http only happens on localhost during development.
		secure: url.protocol === "https:",
		sameSite: "lax",
		path: "/",
		maxAge: SESSION_MAX_AGE,
	});
	return user;
}

export function signOut(cookies: AstroCookies): void {
	cookies.delete(SESSION_COOKIE, { path: "/" });
}

/** The sign-in page's address, remembering where the person was going. */
export function signInUrl(next: string): string {
	return `/sign-in?next=${encodeURIComponent(next)}`;
}
