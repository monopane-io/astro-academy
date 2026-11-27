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
	/** Present when asked for with include=progress. */
	progress?: { completed: number; total: number };
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
	/** The course and the enrolment state the list is narrowed to; empty for none. */
	course: string;
	status: string;
	/** The courses to narrow the list to. */
	courses: { value: string; label: string }[];
	/** The order, carried through the filter form. */
	keep: Record<string, string>;
	/** The list without the search or filters; null when none is in use. */
	clearHref: string | null;
	/** A search or a filter is in use. */
	narrowed: boolean;
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

/** What narrows the users list: a search, a course, an enrolment state. */
interface Narrowing {
	search: string;
	course: string;
	status: string;
}

/** The enrolment states a list can be narrowed to, as the API names them. */
export const ENROLLMENT_STATES = [
	{ value: "active", label: "In progress" },
	{ value: "completed", label: "Completed" },
	{ value: "dropped", label: "Dropped" },
];

/** The address of the users page for a search, filters, an order and a place in the list. */
function usersHref(narrowing: Narrowing, sort: Sort, after?: string): string {
	const params = new URLSearchParams();
	if (narrowing.search) params.set("q", narrowing.search);
	if (narrowing.course) params.set("course", narrowing.course);
	if (narrowing.status) params.set("status", narrowing.status);
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
		const courses = await api.all<ApiCourse>("/courses");
		const askedCourse = asked.get("course") ?? "";
		const course = courses.some((known) => known.id === askedCourse) ? askedCourse : "";
		const askedStatus = asked.get("status") ?? "";
		const status = ENROLLMENT_STATES.some((known) => known.value === askedStatus)
			? askedStatus
			: "";
		const narrowing = { search, course, status };
		const narrowed = Boolean(search || course || status);
		const page = await api.get<Page<ApiUser>>("/users", {
			limit: PAGE_SIZE,
			cursor,
			q: search || undefined,
			courseId: course || undefined,
			enrollmentStatus: status || undefined,
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
			moreHref:
				page.hasMore && page.nextCursor ? usersHref(narrowing, sort, page.nextCursor) : null,
			firstHref: cursor ? usersHref(narrowing, sort) : null,
			search,
			course,
			status,
			courses: courses.map((known) => ({ value: known.id, label: known.title })),
			keep: (sort === "-createdAt" ? {} : { sort }) as Record<string, string>,
			clearHref: narrowed ? usersHref({ search: "", course: "", status: "" }, sort) : null,
			narrowed,
			sort: {
				// Pressing a heading orders by it; pressing it again turns the order round.
				name: {
					href: usersHref(narrowing, sort === "displayName" ? "-displayName" : "displayName"),
					sorted:
						sort === "displayName"
							? "ascending"
							: sort === "-displayName"
								? "descending"
								: undefined,
				},
				joined: {
					href: usersHref(narrowing, sort === "-createdAt" ? "createdAt" : "-createdAt"),
					sorted:
						sort === "createdAt" ? "ascending" : sort === "-createdAt" ? "descending" : undefined,
				},
			},
			summary: cursor
				? `${shown} more`
				: narrowed
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
	/** Activities to finish in the course; null when the API does not say. */
	activitiesTotal: number | null;
	/** "3 of 8", or "3 done" when the total is not known. */
	progressLabel: string;
}

export interface UserData {
	user: { name: string; email: string | null; reference: string; joinedOn: string };
	/** The enrolments shown: narrowed to `status`, in `sort` order. */
	enrollments: UserEnrollment[];
	/** All the user's enrolments, before the filter. */
	enrollmentCount: number;
	/** The enrolment state the table is narrowed to; empty for none. */
	status: string;
	/** Order and filter links for the enrolments table. */
	sort: {
		course: { href: string; sorted?: "ascending" | "descending" };
		enrolled: { href: string; sorted?: "ascending" | "descending" };
	};
	keep: Record<string, string>;
	clearHref: string | null;
	/** What the user has done, newest first. */
	activity: {
		text: string;
		when: string;
		at: string;
		icon: "user-plus" | "book" | "check" | "award";
	}[];
	minutesLeft: number;
}

/** The orders of a user's enrolments; a leading "-" is descending. */
const ENROLLMENT_SORTS = ["-enrolled", "enrolled", "course", "-course"] as const;
type EnrollmentSort = (typeof ENROLLMENT_SORTS)[number];

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
			api.all<ApiEnrollment>(`/users/${userId}/enrollments`, { include: "progress" }),
			api.all<ApiCourse>("/courses"),
		]);
		const asked = context.url.searchParams;
		const askedStatus = asked.get("status") ?? "";
		const status = ENROLLMENT_STATES.some((known) => known.value === askedStatus)
			? askedStatus
			: "";
		const askedSort = asked.get("sort") ?? "";
		const sort = (ENROLLMENT_SORTS as readonly string[]).includes(askedSort)
			? (askedSort as EnrollmentSort)
			: "-enrolled";
		const here = `/admin/users/${userId}`;
		const enrollmentsHref = (narrowTo: string, order: EnrollmentSort) => {
			const params = new URLSearchParams();
			if (narrowTo) params.set("status", narrowTo);
			if (order !== "-enrolled") params.set("sort", order);
			const query = params.toString();
			return `${here}${query ? `?${query}` : ""}#courses`;
		};
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
				const done = progress.filter((record) => record.status === "completed").length;
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
					activitiesDone: enrollment.progress?.completed ?? done,
					activitiesTotal: enrollment.progress?.total ?? null,
					progressLabel: enrollment.progress
						? `${enrollment.progress.completed} of ${enrollment.progress.total}`
						: `${done} done`,
					apiStatus: enrollment.status,
					enrolledAt: enrollment.enrolledAt,
				};
			}),
		);
		const byCourse = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
			a.courseTitle.localeCompare(b.courseTitle);
		const byEnrolled = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
			a.enrolledAt.localeCompare(b.enrolledAt);
		const order = sort.endsWith("course") ? byCourse : byEnrolled;
		const shown = rows
			.filter((row) => !status || row.apiStatus === status)
			.sort((a, b) => (sort.startsWith("-") ? order(b, a) : order(a, b)))
			.map(({ apiStatus: _status, enrolledAt: _at, ...row }) => row);
		return {
			user: {
				name: nameOf(user),
				email: user.email,
				reference: user.externalId,
				joinedOn: longDate(user.createdAt),
			},
			enrollments: shown,
			enrollmentCount: rows.length,
			status,
			sort: {
				course: {
					href: enrollmentsHref(status, sort === "course" ? "-course" : "course"),
					sorted: sort === "course" ? "ascending" : sort === "-course" ? "descending" : undefined,
				},
				enrolled: {
					href: enrollmentsHref(status, sort === "-enrolled" ? "enrolled" : "-enrolled"),
					sorted:
						sort === "enrolled" ? "ascending" : sort === "-enrolled" ? "descending" : undefined,
				},
			},
			keep: (sort === "-enrolled" ? {} : { sort }) as Record<string, string>,
			clearHref: status ? enrollmentsHref("", sort) : null,
			activity: events
				.sort((a, b) => b.at.localeCompare(a.at))
				.slice(0, ACTIVITY_SHOWN)
				.map((event) => ({
					text: event.text,
					when: dateAndTime(event.at),
					at: event.at,
					icon: event.icon,
				})),
			minutesLeft: minutesLeft(session.expires),
		};
	});
}
