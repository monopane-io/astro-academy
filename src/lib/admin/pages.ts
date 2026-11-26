/**
 * What each page of the admin area does. As with the user pages
 * (../pages.ts), a page file calls one function here and draws the result.
 *
 * Every function starts with `signedIn`: no admin session, no page. The
 * middleware (src/middleware.ts) adds the rest of the protection to every
 * address under /admin: it refuses a form sent from another site, and marks
 * the reply as private and not to be shown inside another page.
 */
import { forgetContent } from "../monopane";
import type { PageContext, PageResult } from "../pages";
import { type AdminApi, AdminRequestFailed, AdminSignedOut, adminApi } from "./api";
import { createCourse } from "./content";
import type { AdminSession } from "./session";
import { ADMIN_HOME } from "./sign-in";

const page = <T>(data: T): PageResult<T> => ({ data });
const respond = <T>(response: Response): PageResult<T> => ({ response });

/** Where signing in starts, coming back to `path` afterwards. */
export const signInPath = (path: string) => `/admin/sign-in?next=${encodeURIComponent(path)}`;

/**
 * Run `load` for the signed-in admin. Without a session, or when Monopane
 * says the session has ended, the admin is sent to sign in and brought back.
 * `load` returns what the page draws, or a reply of its own (a redirect after
 * a form was dealt with).
 */
export async function signedIn<T>(
	context: PageContext,
	load: (api: AdminApi, session: AdminSession) => Promise<T | Response>,
): Promise<PageResult<T>> {
	// After signing in again the admin comes back to the page, never to a form post.
	const here = context.url.pathname;
	const session = context.locals.admin;
	if (!session) return respond(context.redirect(signInPath(here)));
	try {
		const result = await load(adminApi(context.locals.config, session), session);
		if (!(result instanceof Response)) return page(result);
		// A form was dealt with, so what users see may have changed.
		if (context.request.method !== "GET") forgetContent();
		return respond(result);
	} catch (error) {
		if (error instanceof AdminSignedOut) return respond(context.redirect(signInPath(here)));
		throw error;
	}
}

/**
 * Whether a request that changes something came from this site's own pages.
 * A browser always says where a form was sent from (`Origin`); a form on
 * another site cannot pretend to be this one. Used by the middleware for
 * every such request under /admin.
 */
export function fromThisSite(request: Request, url: URL): boolean {
	if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
	return request.headers.get("Origin") === url.origin;
}

/** Whether an address is part of the admin area. */
export function isAdminPath(pathname: string): boolean {
	return pathname === ADMIN_HOME || pathname.startsWith(`${ADMIN_HOME}/`);
}

/** Headers for every reply from the admin area: never stored, never framed. */
export function protectAdminReply(headers: Headers): void {
	headers.set("Cache-Control", "private, no-store");
	headers.set("Content-Security-Policy", "frame-ancestors 'none'");
	headers.set("X-Frame-Options", "DENY");
	headers.set("Referrer-Policy", "same-origin");
}

// --- The front page: every course, drafts included --------------------------

interface ApiCourse {
	id: string;
	title: string;
	slug: string;
	description?: string | null;
	status: "draft" | "published" | "archived";
	updatedAt: string;
}

export interface AdminCourseRow {
	id: string;
	title: string;
	slug: string;
	description: string | null;
	published: boolean;
	/** "25 November 2026" */
	updatedOn: string;
	/** The course as users see it; null for a draft, which they cannot. */
	viewHref: string | null;
	editHref: string;
}

export interface AdminHomeData {
	courses: AdminCourseRow[];
	done?: string;
	error?: string;
	published: number;
	drafts: number;
	/** How much longer this sign-in lasts, in whole minutes. */
	minutesLeft: number;
}

const longDate = (iso: string) =>
	new Date(iso).toLocaleDateString("en-GB", { dateStyle: "long", timeZone: "UTC" });

export function adminHomePage(context: PageContext): Promise<PageResult<AdminHomeData>> {
	return signedIn(context, async (api, session) => {
		let error: string | undefined;
		if (context.request.method === "POST") {
			try {
				return await createCourse(context, api, await context.request.formData());
			} catch (failure) {
				if (!(failure instanceof AdminRequestFailed)) throw failure;
				error = failure.message;
			}
		}
		const courses = await api.all<ApiCourse>("/courses");
		const rows = courses.map((course) => ({
			id: course.id,
			title: course.title,
			slug: course.slug,
			description: course.description ?? null,
			published: course.status === "published",
			updatedOn: longDate(course.updatedAt),
			viewHref: course.status === "published" ? `/courses/${course.slug}` : null,
			editHref: `/admin/courses/${course.id}`,
		}));
		return {
			courses: rows,
			done: context.url.searchParams.get("done")?.slice(0, 200),
			error,
			published: rows.filter((course) => course.published).length,
			drafts: rows.filter((course) => !course.published).length,
			minutesLeft: Math.max(1, Math.floor((session.expires - Date.now()) / 60000)),
		};
	});
}
