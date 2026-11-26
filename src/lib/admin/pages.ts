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
import { type AdminApi, AdminSignedOut, adminApi } from "./api";
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

// --- The courses page: every course, drafts included --------------------------

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
	published: number;
	drafts: number;
	/** How much longer this sign-in lasts, in whole minutes. */
	minutesLeft: number;
}

const longDate = (iso: string) =>
	new Date(iso).toLocaleDateString("en-GB", { dateStyle: "long", timeZone: "UTC" });

export function coursesPage(context: PageContext): Promise<PageResult<AdminHomeData>> {
	return signedIn(context, async (api, session) => {
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
			published: rows.filter((course) => course.published).length,
			drafts: rows.filter((course) => !course.published).length,
			minutesLeft: Math.max(1, Math.floor((session.expires - Date.now()) / 60000)),
		};
	});
}

// --- The front page: how the academy is doing --------------------------------

interface ApiCourseStats {
	totalEnrollments: number;
	activeEnrollments: number;
	completedEnrollments: number;
}
interface ApiUser {
	id: string;
	externalId: string;
	displayName: string | null;
	email: string | null;
	createdAt: string;
}
interface Listed<T> {
	data: T[];
	hasMore: boolean;
}

export interface OverviewData {
	stats: { label: string; value: string | number; hint?: string }[];
	/** What is left to do before the academy is in use; empty once all is done. */
	steps: { label: string; hint?: string; done: boolean; href?: string }[];
	setUp: boolean;
	recentUsers: { name: string; email: string | null; joinedOn: string; href: string }[];
	courses: {
		title: string;
		href: string;
		published: boolean;
		enrolled: number;
		completed: number;
	}[];
	minutesLeft: number;
}

/** How many of the newest users the front page shows. */
const RECENT_USERS = 5;

export function overviewPage(context: PageContext): Promise<PageResult<OverviewData>> {
	return signedIn(context, async (api, session) => {
		const [courses, users] = await Promise.all([
			api.all<ApiCourse>("/courses"),
			api.get<Listed<ApiUser>>("/users", { limit: RECENT_USERS }),
		]);
		const numbers = await Promise.all(
			courses.map((course) => api.get<ApiCourseStats>(`/courses/${course.id}/stats`)),
		);
		const sum = (pick: (stats: ApiCourseStats) => number) =>
			numbers.reduce((total, stats) => total + pick(stats), 0);
		const enrolled = sum((stats) => stats.totalEnrollments);
		const completed = sum((stats) => stats.completedEnrollments);
		const published = courses.filter((course) => course.status === "published").length;
		const steps = [
			{
				label: "Make a course",
				hint: "A course is a set of lessons. It starts as a draft.",
				done: courses.length > 0,
				href: "/admin/courses/new",
			},
			{
				label: "Publish a course",
				hint: "Users see a course once it, its lessons and their activities are published.",
				done: published > 0,
				href: "/admin/courses",
			},
			{
				label: "Have someone sign in",
				hint: "Send people the address of the academy. They appear under Users.",
				done: users.data.length > 0,
				href: "/",
			},
			{
				label: "See a first enrolment",
				hint: "A user enrols from a course's page.",
				done: enrolled > 0,
			},
		];
		return {
			stats: [
				{
					label: "Published courses",
					value: published,
					hint: `${courses.length - published} in draft`,
				},
				{
					label: "Enrolments",
					value: enrolled,
					hint: `${sum((stats) => stats.activeEnrollments)} in progress`,
				},
				{ label: "Completions", value: completed },
				{
					label: "Completion rate",
					value: enrolled > 0 ? `${Math.round((completed / enrolled) * 100)}%` : "–",
				},
			],
			steps,
			setUp: steps.every((step) => step.done),
			recentUsers: users.data.map((user) => ({
				name: user.displayName ?? user.email ?? user.externalId,
				email: user.email,
				joinedOn: longDate(user.createdAt),
				href: `/admin/users/${user.id}`,
			})),
			courses: courses.map((course, index) => ({
				title: course.title,
				href: `/admin/courses/${course.id}`,
				published: course.status === "published",
				enrolled: numbers[index]?.totalEnrollments ?? 0,
				completed: numbers[index]?.completedEnrollments ?? 0,
			})),
			minutesLeft: Math.max(1, Math.floor((session.expires - Date.now()) / 60000)),
		};
	});
}
