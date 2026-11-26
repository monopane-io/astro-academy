/**
 * Users and how they are doing, for the admin area. Reading only: nothing
 * on these pages can change a user, an enrolment or their progress, and
 * the admin's token could not do it if they tried.
 */
import type { PageContext, PageResult } from "../pages";
import { AdminRequestFailed } from "./api";
import { signedIn } from "./pages";

interface ApiUser {
	id: string;
	externalId: string;
	displayName: string | null;
	email: string | null;
	createdAt: string;
}
interface ApiEnrollment {
	id: string;
	courseId: string;
	status: "active" | "completed" | "dropped";
	enrolledAt: string;
	completedAt: string | null;
}
interface ApiProgress {
	activityId: string;
	status: "not_started" | "in_progress" | "attempted" | "completed";
	completedAt: string | null;
}
interface ApiCourse {
	id: string;
	title: string;
}
interface Page<T> {
	data: T[];
	nextCursor: string | null;
	hasMore: boolean;
}

const dateAndTime = (iso: string) =>
	`${new Date(iso).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" })} UTC`;
const longDate = (iso: string) =>
	new Date(iso).toLocaleDateString("en-GB", { dateStyle: "long", timeZone: "UTC" });
const minutesLeft = (expires: number) => Math.max(1, Math.floor((expires - Date.now()) / 60000));

/** How many users one page of the list shows. */
const PAGE_SIZE = 50;

export interface UserRow {
	id: string;
	name: string;
	email: string | null;
	joinedOn: string;
	href: string;
}

export interface UsersData {
	users: UserRow[];
	/** The next page of the list, or null on the last. */
	moreHref: string | null;
	/** The first page, in the same search and order; null when on it. */
	firstHref: string | null;
	/** What was searched for; empty when nothing was. */
	search: string;
	/** The list without the search. */
	clearHref: string;
	/** Which column the list is ordered by, which way, and the link that orders by each. */
	sort: {
		name: { href: string; sorted?: "ascending" | "descending" };
		joined: { href: string; sorted?: "ascending" | "descending" };
	};
	/** A line under the table: "The newest 50", "12 found". */
	summary: string;
	minutesLeft: number;
}

const nameOf = (user: ApiUser) => user.displayName ?? user.email ?? user.externalId;

const SORTS = ["-createdAt", "createdAt", "displayName", "-displayName"] as const;
type Sort = (typeof SORTS)[number];

/** The address of the users page for a search, an order and a place in the list. */
function usersHref(search: string, sort: Sort, after?: string): string {
	const params = new URLSearchParams();
	if (search) params.set("q", search);
	if (sort !== "-createdAt") params.set("sort", sort);
	if (after) params.set("after", after);
	const query = params.toString();
	return query ? `/admin/users?${query}` : "/admin/users";
}

export function usersPage(context: PageContext): Promise<PageResult<UsersData>> {
	return signedIn(context, async (api, session) => {
		const asked = context.url.searchParams;
		const cursor = asked.get("after") ?? undefined;
		const search = (asked.get("q") ?? "").trim().slice(0, 200);
		const sort = SORTS.find((known) => known === asked.get("sort")) ?? "-createdAt";
		const page = await api.get<Page<ApiUser>>("/users", {
			limit: PAGE_SIZE,
			cursor,
			q: search || undefined,
			sort: sort === "-createdAt" ? undefined : sort,
		});
		const shown = page.data.length;
		return {
			users: page.data.map((user) => ({
				id: user.id,
				name: nameOf(user),
				email: user.email,
				joinedOn: longDate(user.createdAt),
				href: `/admin/users/${user.id}`,
			})),
			moreHref: page.hasMore && page.nextCursor ? usersHref(search, sort, page.nextCursor) : null,
			firstHref: cursor ? usersHref(search, sort) : null,
			search,
			clearHref: usersHref("", sort),
			sort: {
				// Pressing a heading orders by it; pressing it again turns the order round.
				name: {
					href: usersHref(search, sort === "displayName" ? "-displayName" : "displayName"),
					sorted:
						sort === "displayName"
							? "ascending"
							: sort === "-displayName"
								? "descending"
								: undefined,
				},
				joined: {
					href: usersHref(search, sort === "-createdAt" ? "createdAt" : "-createdAt"),
					sorted:
						sort === "createdAt" ? "ascending" : sort === "-createdAt" ? "descending" : undefined,
				},
			},
			summary: cursor
				? `${shown} more`
				: search
					? `${shown}${page.hasMore ? " or more" : ""} found`
					: page.hasMore
						? `The first ${shown}`
						: `${shown} in all`,
			minutesLeft: minutesLeft(session.expires),
		};
	});
}

export interface UserEnrollment {
	courseTitle: string;
	/** The course in the editor. */
	courseHref: string;
	status: "In progress" | "Completed" | "Dropped";
	completed: boolean;
	enrolledOn: string;
	completedOn: string | null;
	/** Activities the user has finished in this course. */
	activitiesDone: number;
}

export interface UserData {
	user: { name: string; email: string | null; reference: string; joinedOn: string };
	enrollments: UserEnrollment[];
	/** What the user has done, newest first. */
	activity: { text: string; when: string; icon: "user-plus" | "book" | "check" | "award" }[];
	minutesLeft: number;
}

/** How many lines of a user's activity their page shows. */
const ACTIVITY_SHOWN = 12;

const STATUS_LABELS = {
	active: "In progress",
	completed: "Completed",
	dropped: "Dropped",
} as const;

export function userPage(context: PageContext): Promise<PageResult<UserData>> {
	return signedIn(context, async (api, session) => {
		const userId = context.params.userId ?? "";
		let user: ApiUser;
		try {
			user = await api.get<ApiUser>(`/users/${userId}`);
		} catch (failure) {
			if (failure instanceof AdminRequestFailed && failure.status === 404) {
				return context.rewrite("/404");
			}
			throw failure;
		}
		const [enrollments, courses] = await Promise.all([
			api.all<ApiEnrollment>(`/users/${userId}/enrollments`),
			api.all<ApiCourse>("/courses"),
		]);
		const titles = new Map(courses.map((course) => [course.id, course.title]));
		const events: { at: string; text: string; icon: UserData["activity"][number]["icon"] }[] = [
			{ at: user.createdAt, text: "Signed in for the first time", icon: "user-plus" },
		];
		const rows = await Promise.all(
			enrollments.map(async (enrollment) => {
				const course = titles.get(enrollment.courseId) ?? "a course that has been deleted";
				events.push({ at: enrollment.enrolledAt, text: `Enrolled in ${course}`, icon: "book" });
				if (enrollment.completedAt) {
					events.push({ at: enrollment.completedAt, text: `Completed ${course}`, icon: "award" });
				}
				const progress = await api.all<ApiProgress>(`/enrollments/${enrollment.id}/progress`);
				for (const record of progress) {
					if (record.status === "completed" && record.completedAt) {
						events.push({
							at: record.completedAt,
							text: `Finished an activity in ${course}`,
							icon: "check",
						});
					}
				}
				return {
					courseTitle: titles.get(enrollment.courseId) ?? "A course that has been deleted",
					courseHref: `/admin/courses/${enrollment.courseId}`,
					status: STATUS_LABELS[enrollment.status] ?? "In progress",
					completed: enrollment.status === "completed",
					enrolledOn: longDate(enrollment.enrolledAt),
					completedOn: enrollment.completedAt ? longDate(enrollment.completedAt) : null,
					activitiesDone: progress.filter((record) => record.status === "completed").length,
				};
			}),
		);
		return {
			user: {
				name: nameOf(user),
				email: user.email,
				reference: user.externalId,
				joinedOn: longDate(user.createdAt),
			},
			enrollments: rows,
			activity: events
				.sort((a, b) => b.at.localeCompare(a.at))
				.slice(0, ACTIVITY_SHOWN)
				.map((event) => ({ text: event.text, when: dateAndTime(event.at), icon: event.icon })),
			minutesLeft: minutesLeft(session.expires),
		};
	});
}
