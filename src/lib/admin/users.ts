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
	/** True on any page after the first. */
	later: boolean;
	minutesLeft: number;
}

const nameOf = (user: ApiUser) => user.displayName ?? user.email ?? user.externalId;

export function usersPage(context: PageContext): Promise<PageResult<UsersData>> {
	return signedIn(context, async (api, session) => {
		const cursor = context.url.searchParams.get("after") ?? undefined;
		const page = await api.get<Page<ApiUser>>("/users", { limit: PAGE_SIZE, cursor });
		return {
			users: page.data.map((user) => ({
				id: user.id,
				name: nameOf(user),
				email: user.email,
				joinedOn: longDate(user.createdAt),
				href: `/admin/users/${user.id}`,
			})),
			moreHref:
				page.hasMore && page.nextCursor
					? `/admin/users?after=${encodeURIComponent(page.nextCursor)}`
					: null,
			later: cursor !== undefined,
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
	minutesLeft: number;
}

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
		const rows = await Promise.all(
			enrollments.map(async (enrollment) => {
				const progress = await api.all<ApiProgress>(`/enrollments/${enrollment.id}/progress`);
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
			minutesLeft: minutesLeft(session.expires),
		};
	});
}
