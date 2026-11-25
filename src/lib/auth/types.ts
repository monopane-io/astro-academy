/**
 * Sign-in is an adapter: one small interface, with the way a person proves
 * who they are behind it. Two adapters ship with the starter (demo.ts and
 * magic-link.ts). To use your own identity provider, write a third and return
 * it from auth/index.ts; no page changes.
 */

/** Someone the adapter has identified. `id` must be stable for that person. */
export interface Identity {
	/** Becomes the learner's `externalId` in Monopane. */
	id: string;
	name: string;
	email: string;
}

/** The signed-in person as kept in the session cookie. */
export interface User extends Identity {
	/** The Monopane learner (`lrn_...`) created for this person at sign-in. */
	learnerId: string;
}

export type SignInResult =
	/** The person is identified; sign them in now. */
	| { kind: "signed-in"; identity: Identity }
	/** A link was sent (or would have been); show "check your email". */
	| { kind: "link-sent" }
	/** The form was filled in wrongly; show `message` and let them retry. */
	| { kind: "invalid"; message: string };

export interface SignInForm {
	name: string;
	email: string;
	/** The site's own origin, for building links back to it. */
	origin: string;
	/** Path to return to after signing in. */
	next: string;
}

export interface AuthAdapter {
	readonly mode: "demo" | "magic-link";
	/** False for adapters that must not be used on a real site. */
	readonly forProduction: boolean;
	/** Handle the sign-in form. */
	start(form: SignInForm): Promise<SignInResult>;
	/**
	 * Exchange a one-time token from an emailed link for the person it was
	 * sent to. Returns null if the token is unknown, used or expired. Adapters
	 * that sign in at `start` return null.
	 */
	finish(token: string): Promise<{ identity: Identity; next: string } | null>;
}

/** Key-value storage with expiry. A Cloudflare KV namespace satisfies this. */
export interface TokenStore {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
	delete(key: string): Promise<void>;
}

export interface EmailMessage {
	to: string;
	subject: string;
	text: string;
	/** The sign-in link in `text`, for a sender that writes the email itself. */
	link: string;
	/** The site's name, as in `subject`. */
	siteName: string;
}

/** Sends one email. resendSender() in email.ts is the documented one. */
export interface EmailSender {
	send(message: EmailMessage): Promise<void>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(value: string): string | null {
	const email = value.trim().toLowerCase();
	return email.length <= 255 && EMAIL.test(email) ? email : null;
}

export function normaliseName(value: string, email: string): string {
	const name = value.trim().replace(/\s+/g, " ").slice(0, 200);
	return name || email.split("@")[0] || "Learner";
}
