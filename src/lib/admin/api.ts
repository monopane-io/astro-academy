/**
 * What the admin area asks of Monopane. Every call here is made with the
 * signed-in admin's own token, never with the site's API key, so it can do
 * exactly what Monopane lets that person do from a site and no more.
 *
 * Nothing read here is kept between requests: an admin sees drafts, and a
 * draft must never reach the cache the learner pages share.
 */
import type { Config } from "../config";
import type { AdminSession } from "./session";

/** The token has run out or been ended. The page sends the admin to sign in again. */
export class AdminSignedOut extends Error {
	constructor() {
		super("The admin session has ended");
		this.name = "AdminSignedOut";
	}
}

/** Monopane refused or could not do what was asked. `message` is safe to show. */
export class AdminRequestFailed extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "AdminRequestFailed";
	}
}

export interface AdminApi {
	get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
	send<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T>;
	/** Read a list to its end, following `nextCursor`. */
	all<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T[]>;
}

interface Page<T> {
	data: T[];
	nextCursor: string | null;
	hasMore: boolean;
}

/** An API for this request's admin. Paths are relative to the project: `/courses`. */
export function adminApi(config: Config, session: AdminSession): AdminApi {
	const base = `${config.apiUrl.replace(/\/$/, "")}/tenants/${config.tenantId}`;

	async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const response = await fetch(`${base}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${session.token}`,
				...(body === undefined ? {} : { "Content-Type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (response.status === 401) throw new AdminSignedOut();
		if (!response.ok) {
			const reply = (await response.json().catch(() => null)) as {
				error?: { message?: unknown };
			} | null;
			const message = reply?.error?.message;
			throw new AdminRequestFailed(
				response.status,
				typeof message === "string" ? message : "Monopane could not do that. Try again.",
			);
		}
		return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
	}

	const withQuery = (path: string, query?: Record<string, string | number | undefined>) => {
		const params = new URLSearchParams();
		for (const [name, value] of Object.entries(query ?? {})) {
			if (value !== undefined) params.set(name, String(value));
		}
		const text = params.toString();
		return text ? `${path}?${text}` : path;
	};

	return {
		get: (path, query) => request("GET", withQuery(path, query)),
		send: (method, path, body) => request(method, path, body),
		async all<T>(path: string, query?: Record<string, string | number | undefined>) {
			const items: T[] = [];
			let cursor: string | undefined;
			do {
				const page = await request<Page<T>>(
					"GET",
					withQuery(path, { ...query, limit: 100, cursor }),
				);
				items.push(...page.data);
				cursor = page.hasMore && page.nextCursor ? page.nextCursor : undefined;
			} while (cursor);
			return items;
		},
	};
}
