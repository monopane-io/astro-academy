import { safeNext } from "../session";
import {
	type AuthAdapter,
	type EmailSender,
	type SignInForm,
	type SignInResult,
	type TokenStore,
	normaliseEmail,
	normaliseName,
} from "./types";

/** How long a link works, in seconds. */
export const MAGIC_LINK_TTL = 15 * 60;

export interface MagicLinkOptions {
	store: TokenStore;
	sender: EmailSender;
	siteName: string;
	/** Injected in tests. */
	now?: () => number;
	randomToken?: () => string;
}

interface Pending {
	email: string;
	name: string;
	next: string;
	/** Unix time in milliseconds after which the link is dead. */
	expires: number;
}

function defaultToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Only a hash of the token is stored, so reading the store does not yield links. */
async function storageKey(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
	return `magic-link:${hex}`;
}

/**
 * Email magic link: the learner enters an address and gets a link that signs
 * in that address, once, within 15 minutes. Open to anyone with an email
 * address; there are no passwords and no list of allowed people.
 *
 * `start` answers the same way whatever happens, so the form cannot be used
 * to learn anything about an address.
 */
export function createMagicLinkAdapter(options: MagicLinkOptions): AuthAdapter {
	const now = options.now ?? Date.now;
	const randomToken = options.randomToken ?? defaultToken;

	return {
		mode: "magic-link",
		forProduction: true,

		async start(form: SignInForm): Promise<SignInResult> {
			const email = normaliseEmail(form.email);
			if (!email) return { kind: "invalid", message: "Enter a valid email address." };

			const token = randomToken();
			const pending: Pending = {
				email,
				name: normaliseName(form.name, email),
				next: safeNext(form.next),
				expires: now() + MAGIC_LINK_TTL * 1000,
			};
			await options.store.put(await storageKey(token), JSON.stringify(pending), {
				expirationTtl: MAGIC_LINK_TTL,
			});

			const link = `${form.origin}/auth/verify?token=${token}`;
			try {
				await options.sender.send({
					to: email,
					subject: `Sign in to ${options.siteName}`,
					text: [
						`Use this link to sign in to ${options.siteName}:`,
						"",
						link,
						"",
						"It works once and expires in 15 minutes.",
						"If you did not ask for it, ignore this email.",
					].join("\n"),
				});
			} catch (error) {
				// The learner gets the same answer either way; the cause goes to the logs.
				console.error("Magic link email could not be sent:", error);
			}
			return { kind: "link-sent" };
		},

		async finish(token: string) {
			if (!/^[0-9a-f]{64}$/.test(token)) return null;
			const key = await storageKey(token);
			const stored = await options.store.get(key);
			if (!stored) return null;
			// Used once: the token is gone before anyone is signed in.
			await options.store.delete(key);

			let pending: Pending;
			try {
				pending = JSON.parse(stored) as Pending;
			} catch {
				return null;
			}
			if (typeof pending.expires !== "number" || pending.expires <= now()) return null;
			return {
				identity: { id: `email:${pending.email}`, name: pending.name, email: pending.email },
				next: safeNext(pending.next),
			};
		},
	};
}
