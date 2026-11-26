/**
 * The admin's session. Someone who runs the academy signs in with their
 * Monopane account (see sign-in.ts) and the site is handed a token that acts
 * for them: it can edit this project's courses and see its users, in one
 * environment, for an hour, and nothing else.
 *
 * That token is the one powerful thing the site ever holds, so it is kept
 * where only this server can read it: in a cookie that is encrypted
 * (AES-GCM, with a key made from SESSION_SECRET), not just signed. The
 * browser carries it and cannot read it, and neither can a script on the
 * page (`HttpOnly`). Nothing is stored on the server.
 *
 * It is separate from the user's session: an admin is not a user, and a
 * user is never an admin.
 */
import type { AstroCookieSetOptions } from "astro";

export interface AdminSession {
	/** Acts for the signed-in admin at Monopane. Never sent to the browser. */
	token: string;
	/** When the token stops working, in milliseconds. */
	expires: number;
	/** Who signed in, as Monopane told us, to show in the admin area. */
	name?: string;
	email?: string;
}

/** What is kept while someone is away signing in at Monopane. */
export interface SignInStart {
	state: string;
	verifier: string;
	next: string;
}

/** Signing in must be finished within this long. */
export const SIGN_IN_START_MAX_AGE = 10 * 60;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Cookie names. Over https they carry the `__Host-` prefix: a browser only
 * accepts such a cookie from this exact host, over https, with no `Domain`,
 * so a neighbouring site on the same parent domain can neither read it nor
 * plant one of its own. Plain http is only ever this machine during
 * development, where the prefix cannot be used.
 */
export function adminCookieNames(url: URL): { session: string; start: string } {
	const prefix = url.protocol === "https:" ? "__Host-" : "";
	return { session: `${prefix}admin`, start: `${prefix}admin_start` };
}

export function adminCookieOptions(
	url: URL,
): Required<Pick<AstroCookieSetOptions, "httpOnly" | "secure" | "sameSite" | "path">> {
	return {
		httpOnly: true,
		secure: url.protocol === "https:",
		// Lax, not Strict: coming back from Monopane is a link from another site,
		// and the cookie that remembers the sign-in must come with it.
		sameSite: "lax",
		path: "/",
	};
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
	const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** A key for admin cookies only: the user's cookie is signed with a different one. */
async function key(secret: string): Promise<CryptoKey> {
	const material = await crypto.subtle.digest("SHA-256", encoder.encode(`admin-cookie:${secret}`));
	return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Encrypt `data` into a cookie value. `kind` keeps one cookie from being used as another. */
export async function seal(kind: string, data: unknown, secret: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
	const sealed = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData: encoder.encode(kind) },
		await key(secret),
		encoder.encode(JSON.stringify(data)),
	);
	return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(sealed))}`;
}

/** What was sealed, or null if the value is missing, altered, or not of this kind. */
export async function open<T>(
	kind: string,
	value: string | undefined,
	secret: string,
): Promise<T | null> {
	if (!value) return null;
	const [iv, sealed, ...rest] = value.split(".");
	if (!iv || !sealed || rest.length > 0) return null;
	try {
		const plain = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: fromBase64Url(iv), additionalData: encoder.encode(kind) },
			await key(secret),
			fromBase64Url(sealed),
		);
		return JSON.parse(decoder.decode(plain)) as T;
	} catch {
		return null;
	}
}

export const sealAdminSession = (session: AdminSession, secret: string) =>
	seal("session", session, secret);

/** The admin's session from a cookie value, or null if there is none or it has run out. */
export async function openAdminSession(
	value: string | undefined,
	secret: string,
	now = Date.now(),
): Promise<AdminSession | null> {
	const session = await open<Partial<AdminSession>>("session", value, secret);
	if (!session || typeof session.token !== "string" || typeof session.expires !== "number") {
		return null;
	}
	if (session.expires <= now) return null;
	return {
		token: session.token,
		expires: session.expires,
		...(typeof session.name === "string" ? { name: session.name } : {}),
		...(typeof session.email === "string" ? { email: session.email } : {}),
	};
}

export const sealSignInStart = (start: SignInStart, secret: string) => seal("start", start, secret);

export async function openSignInStart(
	value: string | undefined,
	secret: string,
): Promise<SignInStart | null> {
	const start = await open<Partial<SignInStart>>("start", value, secret);
	if (
		!start ||
		typeof start.state !== "string" ||
		typeof start.verifier !== "string" ||
		typeof start.next !== "string"
	) {
		return null;
	}
	return { state: start.state, verifier: start.verifier, next: start.next };
}

/** Random bytes as text that is safe in a URL: a `state`, or a PKCE verifier. */
export function randomToken(bytes = 32): string {
	return toBase64Url(crypto.getRandomValues(new Uint8Array(new ArrayBuffer(bytes))));
}

/** The PKCE challenge for a verifier: its SHA-256, as Monopane expects it (S256). */
export async function pkceChallenge(verifier: string): Promise<string> {
	return toBase64Url(
		new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))),
	);
}

/** Compare two secrets without stopping at the first difference. */
export function sameText(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let difference = 0;
	for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return difference === 0;
}
