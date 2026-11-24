/**
 * The learner's session: a cookie holding who they are, signed with
 * SESSION_SECRET so it cannot be forged or altered. Nothing is stored on the
 * server. Changing SESSION_SECRET signs everyone out.
 */
import type { User } from "./auth/types";

export const SESSION_COOKIE = "site_session";
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
			user?: Partial<User>;
			exp?: number;
		};
		if (typeof data.exp !== "number" || data.exp * 1000 <= now) return null;
		const user = data.user;
		if (
			!user ||
			typeof user.id !== "string" ||
			typeof user.name !== "string" ||
			typeof user.email !== "string" ||
			typeof user.learnerId !== "string"
		) {
			return null;
		}
		return { id: user.id, name: user.name, email: user.email, learnerId: user.learnerId };
	} catch {
		return null;
	}
}

/**
 * Where to send someone after signing in: a path on this site, never another
 * site. Anything else becomes the home page.
 */
export function safeNext(next: string | null | undefined): string {
	if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
	return next;
}
