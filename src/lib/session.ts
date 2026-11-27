/**
 * The user's session: a cookie holding who they are, signed with
 * SESSION_SECRET so it cannot be forged or altered. Nothing is stored on the
 * server. Changing SESSION_SECRET signs everyone out.
 */
import type { User } from "./auth/types";

/**
 * The session cookie's name. Over https it carries the `__Host-` prefix: a
 * browser only accepts such a cookie from this exact host, so a neighbouring
 * site on the same parent domain cannot plant one of its own. Plain http is
 * only ever this machine during development, where the prefix cannot be used.
 */
export function sessionCookieName(url: URL): string {
	return url.protocol === "https:" ? "__Host-site_session" : "site_session";
}
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, in seconds

const encoder = new TextEncoder();

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

async function key(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

/** Turn a user into a signed cookie value that expires `maxAge` seconds from `now`. */
export async function sealSession(
	user: User,
	secret: string,
	now = Date.now(),
	maxAge = SESSION_MAX_AGE,
): Promise<string> {
	const payload = toBase64Url(
		encoder.encode(JSON.stringify({ user, exp: Math.floor(now / 1000) + maxAge })),
	);
	const signature = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload));
	return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** The user in a cookie value, or null if it is missing, altered or expired. */
export async function openSession(
	value: string | undefined,
	secret: string,
	now = Date.now(),
): Promise<User | null> {
	if (!value) return null;
	const [payload, signature, ...rest] = value.split(".");
	if (!payload || !signature || rest.length > 0) return null;
	try {
		const valid = await crypto.subtle.verify(
			"HMAC",
			await key(secret),
			fromBase64Url(signature),
			encoder.encode(payload),
		);
		if (!valid) return null;
		const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as {
			// `learnerId` is what `userId` was called in cookies set by an older
			// version of this site; reading it keeps those people signed in.
			user?: Partial<User> & { learnerId?: unknown };
			exp?: number;
		};
		if (typeof data.exp !== "number" || data.exp * 1000 <= now) return null;
		const user = data.user;
		const userId = user?.userId ?? user?.learnerId;
		if (
			!user ||
			typeof user.id !== "string" ||
			typeof user.name !== "string" ||
			typeof user.email !== "string" ||
			typeof userId !== "string"
		) {
			return null;
		}
		return { id: user.id, name: user.name, email: user.email, userId };
	} catch {
		return null;
	}
}

/** Stands for this site's own origin when checking where `next` leads. */
const HERE = "https://this-site.invalid";

/**
 * Where to send someone after signing in: a path on this site, never another
 * site. Anything else becomes the home page. `next` is resolved the way a
 * browser resolves it, which drops tabs and newlines (so `/<tab>/evil.example`
 * is `//evil.example`), and only an address on this same origin is kept, as
 * its path, query and fragment.
 */
export function safeNext(next: string | null | undefined): string {
	if (!next || !next.startsWith("/") || next.includes("\\")) return "/";
	let url: URL;
	try {
		url = new URL(next, HERE);
	} catch {
		return "/";
	}
	if (url.origin !== HERE) return "/";
	const path = `${url.pathname}${url.search}${url.hash}`;
	return path.startsWith("//") ? "/" : path;
}
