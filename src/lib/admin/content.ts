/**
 * The course editor: what the pages under /admin/courses do.
 *
 * Each page shows one thing and edits one thing: a course's lessons, its
 * details, a lesson's activities, one activity, one question. Every change is
 * an ordinary form post. The form says what to do in a field named `do`; the
 * function for the page carries it out at Monopane with the admin's token and
 * sends the browser on (so reloading never repeats a change). If Monopane
 * refuses, the page is drawn again with what it said and what was typed.
 *
 * A course is made of lessons, optionally grouped into modules; a lesson is
 * made of activities. Each of the four has its own "published" switch, and a
 * user only sees something when it and everything above it is published.
 */
import type { PageContext, PageResult } from "../pages";
import { type AdminApi, AdminRequestFailed } from "./api";
import { signedIn } from "./pages";

type Status = "draft" | "published" | "archived";

interface ApiCourse {
	id: string;
	title: string;
	slug: string;
	description?: string | null;
	imageUrl: string | null;
	tags: string[];
	estimatedMinutes: number | null;
	status: Status;
}
interface ApiModule {
	id: string;
	title: string;
	description?: string | null;
	position: number;
	status: Status;
}
interface ApiLesson {
	id: string;
	moduleId: string | null;
	title: string;
	description?: string | null;
	position: number;
	status: Status;
}
interface ApiActivity {
	id: string;
	title: string;
	type: "reading" | "video" | "external_link" | "quiz";
	config: Record<string, unknown>;
	position: number;
	status: Status;
}
interface ApiStats {
	totalEnrollments: number;
	activeEnrollments: number;
	completedEnrollments: number;
}

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

// --- Reading a form ---------------------------------------------------------

const text = (form: FormData, name: string): string => {
	const value = form.get(name);
	return typeof value === "string" ? value.trim() : "";
};
/** Left empty, a field is cleared rather than set to nothing. */
const optional = (form: FormData, name: string): string | undefined =>
	text(form, name) || undefined;
/** One item per line, blank lines dropped. */
const lines = (form: FormData, name: string): string[] =>
	text(form, name)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
const whole = (form: FormData, name: string): number | undefined => {
	const value = Number(text(form, name));
	return text(form, name) !== "" && Number.isInteger(value) && value > 0 ? value : undefined;
};

/** "Getting started!" becomes "getting-started": the last part of a course's address. */
export function slugFrom(title: string): string {
	return (
		title
			.toLowerCase()
			.normalize("NFKD")
			// Accents come apart from their letters above; drop them, keep the letters.
			.replace(/\p{M}/gu, "")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80)
	);
}

/** Move `id` one place up or down in `ids`. Unchanged if it is already at that end. */
export function moved(ids: string[], id: string, direction: string): string[] {
	const from = ids.indexOf(id);
	const to = direction === "up" ? from - 1 : from + 1;
	if (from < 0 || to < 0 || to >= ids.length) return ids;
	const next = [...ids];
	[next[from], next[to]] = [next[to] as string, next[from] as string];
	return next;
}

const flip = (status: string): Status => (status === "published" ? "draft" : "published");

/** What the last form did, shown once at the top of the page. */
const doneMessage = (context: PageContext) => context.url.searchParams.get("done")?.slice(0, 200);

// --- Shared ----------------------------------------------------------------

const minutesLeft = (expires: number) => Math.max(1, Math.floor((expires - Date.now()) / 60000));
const go = (context: PageContext, path: string, message: string, anchor = "") =>
	context.redirect(`${path}?done=${encodeURIComponent(message)}${anchor ? `#${anchor}` : ""}`, 303);

/** What a form held, to draw it again when it was refused. */
const formValues = (form: FormData): Record<string, string> =>
	Object.fromEntries(
		[...form.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string"),
	);

/** What every admin page carries besides its own data. */
export interface AdminPage {
	done?: string;
	error?: string;
	minutesLeft: number;
}

/**
 * Deal with a form if one was sent. Returns the redirect on success; when
 * Monopane refuses, the reason and what was typed, for the page to show.
 */
async function handle(
	context: PageContext,
	act: (form: FormData) => Promise<Response>,
): Promise<Response | { error?: string; typed?: Record<string, string> }> {
	if (context.request.method !== "POST") return {};
	const form = await context.request.formData();
	try {
		return await act(form);
	} catch (failure) {
		if (!(failure instanceof AdminRequestFailed)) throw failure;
		return { error: failure.message, typed: formValues(form) };
	}
}

/** Read something by its address, or answer "Page not found". */
async function found<T>(context: PageContext, read: Promise<T>): Promise<T | Response> {
	try {
		return await read;
	} catch (failure) {
		if (failure instanceof AdminRequestFailed && failure.status === 404)
			return context.rewrite("/404");
		throw failure;
	}
}

/** The top of every page about one course. */
export interface CourseHead {
	id: string;
	title: string;
	published: boolean;
	/** The lessons page, and the details page. */
	href: string;
	detailsHref: string;
	/** The course as users see it; null while it is a draft. */
	viewHref: string | null;
}

const coursePath = (courseId: string) => `/admin/courses/${courseId}`;
const lessonPath = (courseId: string, lessonId: string) =>
	`${coursePath(courseId)}/lessons/${lessonId}`;
const activityPath = (courseId: string, lessonId: string, activityId: string) =>
	`${lessonPath(courseId, lessonId)}/activities/${activityId}`;

function courseHead(course: ApiCourse): CourseHead {
	return {
		id: course.id,
		title: course.title,
		published: course.status === "published",
		href: coursePath(course.id),
		detailsHref: `${coursePath(course.id)}/details`,
		viewHref: course.status === "published" ? `/courses/${course.slug}` : null,
	};
}

async function readOutline(api: AdminApi, courseId: string) {
	const [modules, lessons] = await Promise.all([
		api.all<ApiModule>(`/courses/${courseId}/modules`),
		api.all<ApiLesson>(`/courses/${courseId}/lessons`),
	]);
	return { modules: modules.sort(byPosition), lessons: lessons.sort(byPosition) };
}

// --- A new course -----------------------------------------------------------

export interface NewCourseData extends AdminPage {
	values: Record<string, string>;
}

/** Make a draft course and go to it. Its address is made from its title. */
async function createCourse(
	context: PageContext,
	api: AdminApi,
	form: FormData,
): Promise<Response> {
	const title = text(form, "title");
	const base = slugFrom(title) || "course";
	// The address must be free; if it is taken, try the next few.
	for (const slug of [base, `${base}-2`, `${base}-3`, `${base}-${Date.now().toString(36)}`]) {
		try {
			const course = await api.send<ApiCourse>("POST", "/courses", {
				title,
				slug,
				description: optional(form, "description"),
			});
			return go(context, coursePath(course.id), "Course created as a draft");
		} catch (error) {
			if (!(error instanceof AdminRequestFailed) || error.status !== 409) throw error;
		}
	}
	throw new AdminRequestFailed(409, "A course already has that address. Try another title.");
}

export function newCoursePage(context: PageContext): Promise<PageResult<NewCourseData>> {
	return signedIn(context, async (api, session) => {
		const result = await handle(context, (form) => createCourse(context, api, form));
		if (result instanceof Response) return result;
		return {
			values: result.typed ?? {},
			error: result.error,
			minutesLeft: minutesLeft(session.expires),
		};
	});
}

// --- A course's lessons -----------------------------------------------------

export interface EditorLesson {
	id: string;
	title: string;
	published: boolean;
	href: string;
	first: boolean;
	last: boolean;
}

export interface EditorSection {
	/** Null for the lessons that sit directly under the course. */
	module: {
		id: string;
		title: string;
		description: string;
		published: boolean;
		first: boolean;
		last: boolean;
		editHref: string;
	} | null;
	lessons: EditorLesson[];
}

export interface CourseOutlineData extends AdminPage {
	course: CourseHead;
	sections: EditorSection[];
	enrolled: number;
	completed: number;
	/** True when something in the course is still a draft. */
	hasDrafts: boolean;
}

async function outlineAction(
	context: PageContext,
	api: AdminApi,
	courseId: string,
	form: FormData,
): Promise<Response> {
	const base = `/courses/${courseId}`;
	const here = coursePath(courseId);
	const id = text(form, "id");
	switch (text(form, "do")) {
		case "toggle-course": {
			const status = flip(text(form, "status"));
			await api.send("PATCH", base, { status });
			return go(
				context,
				here,
				status === "published" ? "Course published" : "Course moved back to draft",
			);
		}
		case "publish-all": {
			const { modules, lessons } = await readOutline(api, courseId);
			for (const module of modules) {
				if (module.status !== "published") {
					await api.send("PATCH", `${base}/modules/${module.id}`, { status: "published" });
				}
			}
			for (const lesson of lessons) {
				if (lesson.status !== "published") {
					await api.send("PATCH", `${base}/lessons/${lesson.id}`, { status: "published" });
				}
				const activities = await api.all<ApiActivity>(`${base}/lessons/${lesson.id}/activities`);
				for (const activity of activities) {
					if (activity.status !== "published") {
						await api.send("PATCH", `${base}/lessons/${lesson.id}/activities/${activity.id}`, {
							status: "published",
						});
					}
				}
			}
			await api.send("PATCH", base, { status: "published" });
			return go(context, here, "The course and everything in it is published");
		}
		case "add-module": {
			await api.send("POST", `${base}/modules`, { title: text(form, "title") });
			return go(context, here, "Module added");
		}
		case "toggle-module": {
			await api.send("PATCH", `${base}/modules/${id}`, { status: flip(text(form, "status")) });
			return go(context, here, "Module updated", id);
		}
		case "delete-module": {
			await api.send("DELETE", `${base}/modules/${id}`);
			return go(context, here, "Module deleted");
		}
		case "move-module": {
			const { modules } = await readOutline(api, courseId);
			const order = moved(
				modules.map((module) => module.id),
				id,
				text(form, "direction"),
			);
			await api.send("PUT", `${base}/modules/reorder`, { order });
			return go(context, here, "Module moved", id);
		}
		case "add-lesson": {
			const lesson = await api.send<ApiLesson>("POST", `${base}/lessons`, {
				title: text(form, "title"),
				moduleId: optional(form, "moduleId") ?? null,
			});
			return go(context, lessonPath(courseId, lesson.id), "Lesson added as a draft");
		}
		case "toggle-lesson": {
			await api.send("PATCH", `${base}/lessons/${id}`, { status: flip(text(form, "status")) });
			return go(context, here, "Lesson updated", id);
		}
		case "move-lesson": {
			// Within its own group: the lessons of one module, or those under the course.
			const { lessons } = await readOutline(api, courseId);
			const lesson = lessons.find((item) => item.id === id);
			const group = lessons.filter((item) => item.moduleId === (lesson?.moduleId ?? null));
			const order = moved(
				group.map((item) => item.id),
				id,
				text(form, "direction"),
			);
			await api.send("PUT", `${base}/lessons/reorder`, { order });
			return go(context, here, "Lesson moved", id);
		}
		default:
			throw new AdminRequestFailed(400, "That form is not one this page knows.");
	}
}

export function courseOutlinePage(context: PageContext): Promise<PageResult<CourseOutlineData>> {
	return signedIn(context, async (api, session) => {
		const courseId = context.params.courseId ?? "";
		const result = await handle(context, (form) => outlineAction(context, api, courseId, form));
		if (result instanceof Response) return result;

		const course = await found(context, api.get<ApiCourse>(`/courses/${courseId}`));
		if (course instanceof Response) return course;
		const [{ modules, lessons }, stats] = await Promise.all([
			readOutline(api, courseId),
			api.get<ApiStats>(`/courses/${courseId}/stats`),
		]);

		const rows = (group: ApiLesson[]): EditorLesson[] =>
			group.map((lesson, index) => ({
				id: lesson.id,
				title: lesson.title,
				published: lesson.status === "published",
				href: lessonPath(courseId, lesson.id),
				first: index === 0,
				last: index === group.length - 1,
			}));
		const loose = lessons.filter((lesson) => lesson.moduleId === null);
		const sections: EditorSection[] = [
			...(loose.length > 0 || modules.length === 0 ? [{ module: null, lessons: rows(loose) }] : []),
			...modules.map((module, index) => ({
				module: {
					id: module.id,
					title: module.title,
					description: module.description ?? "",
					published: module.status === "published",
					first: index === 0,
					last: index === modules.length - 1,
					editHref: `${coursePath(courseId)}/modules/${module.id}`,
				},
				lessons: rows(lessons.filter((lesson) => lesson.moduleId === module.id)),
			})),
		];

		return {
			course: courseHead(course),
			sections,
			enrolled: stats.totalEnrollments,
			completed: stats.completedEnrollments,
			hasDrafts:
				course.status !== "published" ||
				modules.some((module) => module.status !== "published") ||
				lessons.some((lesson) => lesson.status !== "published"),
			done: doneMessage(context),
			error: result.error,
			minutesLeft: minutesLeft(session.expires),
		};
	});
}

// --- A course's details -----------------------------------------------------

export interface CourseDetailsData extends AdminPage {
	course: CourseHead;
	values: Record<string, string>;
}

export function courseDetailsPage(context: PageContext): Promise<PageResult<CourseDetailsData>> {
	return signedIn(context, async (api, session) => {
		const courseId = context.params.courseId ?? "";
		const base = `/courses/${courseId}`;
		const result = await handle(context, async (form) => {
			if (text(form, "do") === "delete-course") {
				if (text(form, "confirm") !== "yes") {
					throw new AdminRequestFailed(400, "Tick the box to confirm deleting the course.");
				}
				await api.send("DELETE", base);
				return go(context, "/admin/courses", "Course deleted");
			}
			await api.send("PATCH", base, {
				title: text(form, "title"),
				slug: text(form, "slug"),
				description: text(form, "description"),
				imageUrl: optional(form, "imageUrl") ?? null,
				tags: text(form, "tags")
					.split(",")
					.map((tag) => tag.trim())
					.filter(Boolean),
				estimatedMinutes: whole(form, "estimatedMinutes") ?? null,
			});
			return go(context, `${coursePath(courseId)}/details`, "Course saved");
		});
		if (result instanceof Response) return result;

		const course = await found(context, api.get<ApiCourse>(base));
		if (course instanceof Response) return course;
		return {
			course: courseHead(course),
			values: result.typed ?? {
				title: course.title,
				slug: course.slug,
				description: course.description ?? "",
				imageUrl: course.imageUrl ?? "",
				tags: course.tags.join(", "),
				estimatedMinutes: course.estimatedMinutes ? String(course.estimatedMinutes) : "",
			},
			done: doneMessage(context),
			error: result.error,
			minutesLeft: minutesLeft(session.expires),
		};
	});
}

// --- A module ---------------------------------------------------------------

export interface ModuleData extends AdminPage {
	course: CourseHead;
	values: Record<string, string>;
}

export function modulePage(context: PageContext): Promise<PageResult<ModuleData>> {
	return signedIn(context, async (api, session) => {
		const courseId = context.params.courseId ?? "";
		const moduleId = context.params.moduleId ?? "";
		const path = `/courses/${courseId}/modules/${moduleId}`;
		const result = await handle(context, async (form) => {
			await api.send("PATCH", path, {
				title: text(form, "title"),
				description: text(form, "description"),
			});
			return go(context, coursePath(courseId), "Module saved", moduleId);
		});
		if (result instanceof Response) return result;

		const read = await found(
			context,
			Promise.all([api.get<ApiCourse>(`/courses/${courseId}`), api.get<ApiModule>(path)]),
		);
		if (read instanceof Response) return read;
		const [course, module] = read;
		return {
			course: courseHead(course),
			values: result.typed ?? { title: module.title, description: module.description ?? "" },
			error: result.error,
			minutesLeft: minutesLeft(session.expires),
		};
	});
}

// --- A lesson's activities --------------------------------------------------

export type QuestionKind = "multiple_choice" | "multi_select" | "fill_in_blank" | "short_answer";
type ActivityType = ApiActivity["type"];

export const QUESTION_KINDS: { value: QuestionKind; label: string }[] = [
	{ value: "multiple_choice", label: "One right answer" },
	{ value: "multi_select", label: "Several right answers" },
	{ value: "fill_in_blank", label: "Fill in the blank" },
	{ value: "short_answer", label: "Short answer" },
];
const KIND_LABELS = Object.fromEntries(
	QUESTION_KINDS.map((kind) => [kind.value, kind.label]),
) as Record<QuestionKind, string>;
export const ACTIVITY_TYPES: { value: ActivityType; label: string }[] = [
	{ value: "reading", label: "Reading" },
	{ value: "video", label: "Video" },
	{ value: "external_link", label: "Link" },
	{ value: "quiz", label: "Quiz" },
];
const TYPE_LABELS = Object.fromEntries(
	ACTIVITY_TYPES.map((type) => [type.value, type.label]),
) as Record<ActivityType, string>;

/** The top of every page about one lesson. */
export interface LessonHead {
	id: string;
	title: string;
	published: boolean;
	href: string;
	detailsHref: string;
	/** The lesson as users see it; null until it and what is above it are published. */
	viewHref: string | null;
}

export interface EditorActivity {
	id: string;
	typeLabel: string;
	title: string;
	/** One line about what it holds: "4 questions", "About 2 min". */
	summary: string;
	published: boolean;
	first: boolean;
	last: boolean;
	href: string;
}

export interface LessonData extends AdminPage {
	course: CourseHead;
	lesson: LessonHead;
	activities: EditorActivity[];
	/** One link per kind of activity that can be added. */
	add: { label: string; href: string }[];
}

const stringList = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const stringOf = (value: unknown): string => (typeof value === "string" ? value : "");

type RawQuestion = Record<string, unknown> & { id: string; type: QuestionKind; text: string };

function questionsOf(config: Record<string, unknown>): RawQuestion[] {
	return Array.isArray(config.questions) ? (config.questions as RawQuestion[]) : [];
}

function activitySummary(activity: ApiActivity): string {
	const config = activity.config ?? {};
	if (activity.type === "quiz") {
		const count = questionsOf(config).length;
		const pass = typeof config.passingThreshold === "number" ? config.passingThreshold : 0.7;
		return `${count} ${count === 1 ? "question" : "questions"}, ${Math.round(pass * 100)}% to pass`;
	}
	if (activity.type === "reading") {
		const words = stringOf(config.content).split(/\s+/).filter(Boolean).length;
		return `${words} ${words === 1 ? "word" : "words"}`;
	}
	return stringOf(config.url);
}

async function readLesson(context: PageContext, api: AdminApi, courseId: string, lessonId: string) {
	const read = await found(
		context,
		Promise.all([
			api.get<ApiCourse>(`/courses/${courseId}`),
			api.get<ApiLesson>(`/courses/${courseId}/lessons/${lessonId}`),
			api.all<ApiModule>(`/courses/${courseId}/modules`),
		]),
	);
	if (read instanceof Response) return read;
	const [course, lesson, modules] = read;
	const module = modules.find((item) => item.id === lesson.moduleId);
	const visible =
		course.status === "published" &&
		lesson.status === "published" &&
		(!module || module.status === "published");
	const head: LessonHead = {
		id: lesson.id,
		title: lesson.title,
		published: lesson.status === "published",
		href: lessonPath(courseId, lessonId),
		detailsHref: `${lessonPath(courseId, lessonId)}/details`,
		viewHref: visible ? `/courses/${course.slug}/${lesson.id}` : null,
	};
	return { course, lesson, modules: modules.sort(byPosition), head };
}

export function lessonPage(context: PageContext): Promise<PageResult<LessonData>> {
	return signedIn(context, async (api, session) => {
		const courseId = context.params.courseId ?? "";
		const lessonId = context.params.lessonId ?? "";
		const base = `/courses/${courseId}/lessons/${lessonId}`;
		const here = lessonPath(courseId, lessonId);
		const result = await handle(context, async (form) => {
			const id = text(form, "id");
			switch (text(form, "do")) {
				case "toggle-lesson": {
					const status = flip(text(form, "status"));
					await api.send("PATCH", base, { status });
					return go(
						context,
						here,
						status === "published" ? "Lesson published" : "Lesson moved back to draft",
					);
				}
				case "toggle-activity": {
					await api.send("PATCH", `${base}/activities/${id}`, {
						status: flip(text(form, "status")),
					});
					return go(context, here, "Activity updated", id);
				}
				case "delete-activity": {
					await api.send("DELETE", `${base}/activities/${id}`);
					return go(context, here, "Activity deleted");
				}
				case "move-activity": {
					const activities = (await api.all<ApiActivity>(`${base}/activities`)).sort(byPosition);
					const order = moved(
						activities.map((item) => item.id),
						id,
						text(form, "direction"),
					);
					await api.send("PUT", `${base}/activities/reorder`, { order });
					return go(context, here, "Activity moved", id);
				}
				default:
					throw new AdminRequestFailed(400, "That form is not one this page knows.");
			}
		});
		if (result instanceof Response) return result;

		const read = await readLesson(context, api, courseId, lessonId);
		if (read instanceof Response) return read;
		const activities = (await api.all<ApiActivity>(`${base}/activities`)).sort(byPosition);
		return {
			course: courseHead(read.course),
			lesson: read.head,
			activities: activities.map((activity, index) => ({
				id: activity.id,
				typeLabel: TYPE_LABELS[activity.type] ?? activity.type,
				title: activity.title,
				summary: activitySummary(activity),
				published: activity.status === "published",
				first: index === 0,
				last: index === activities.length - 1,
				href: activityPath(courseId, lessonId, activity.id),
			})),
			add: ACTIVITY_TYPES.map((type) => ({
				label: type.label,
				href: `${here}/activities/new?type=${type.value}`,
			})),
			done: doneMessage(context),
			error: result.error,
			minutesLeft: minutesLeft(session.expires),
		};
	});
}

// --- A lesson's details -----------------------------------------------------

export interface LessonDetailsData extends AdminPage {
	course: CourseHead;
	lesson: LessonHead;
	modules: { id: string; title: string }[];
	values: Record<string, string>;
}

export function lessonDetailsPage(context: PageContext): Promise<PageResult<LessonDetailsData>> {
	return signedIn(context, async (api, session) => {
		const courseId = context.params.courseId ?? "";
		const lessonId = context.params.lessonId ?? "";
		const base = `/courses/${courseId}/lessons/${lessonId}`;
		const result = await handle(context, async (form) => {
			if (text(form, "do") === "delete-lesson") {
				if (text(form, "confirm") !== "yes") {
					throw new AdminRequestFailed(400, "Tick the box to confirm deleting the lesson.");
				}
				await api.send("DELETE", base);
				return go(context, coursePath(courseId), "Lesson deleted");
			}
			await api.send("PATCH", base, {
				title: text(form, "title"),
				description: text(form, "description"),
				moduleId: optional(form, "moduleId") ?? null,
			});
			return go(context, `${lessonPath(courseId, lessonId)}/details`, "Lesson saved");
		});
		if (result instanceof Response) return result;

		const read = await readLesson(context, api, courseId, lessonId);
		if (read instanceof Response) return read;
		return {
			course: courseHead(read.course),
			lesson: read.head,
			modules: read.modules.map((module) => ({ id: module.id, title: module.title })),
			values: result.typed ?? {
				title: read.lesson.title,
				description: read.lesson.description ?? "",
				moduleId: read.lesson.moduleId ?? "",
			},
			done: doneMessage(context),
			error: result.error,
			minutesLeft: minutesLeft(session.expires),
		};
	});
}

// --- One activity -----------------------------------------------------------

export interface EditorQuestion {
	id: string;
	kindLabel: string;
	text: string;
	href: string;
}

export interface ActivityData extends AdminPage {
	course: CourseHead;
	lesson: LessonHead;
	/** Null for one that is being made. */
	activityId: string | null;
	type: ActivityType;
	typeLabel: string;
	published: boolean;
	values: Record<string, string>;
	/** A quiz's questions. Empty for the other kinds, and for a quiz being made. */
	questions: EditorQuestion[];
	addQuestionHref: string | null;
}

/** A question as Monopane stores it, from the fields of a form. */
export function questionFromForm(form: FormData, id: string, kind: string): RawQuestion {
	const base = { id, text: text(form, "text") };
	const answers = lines(form, "answers");
	if (kind === "multiple_choice") {
		return {
			...base,
			type: kind,
			options: lines(form, "options"),
			correctAnswer: answers[0] ?? "",
		};
	}
	if (kind === "multi_select") {
		return { ...base, type: kind, options: lines(form, "options"), correctAnswers: answers };
	}
	if (kind === "fill_in_blank") return { ...base, type: kind, acceptedAnswers: answers };
	if (kind === "short_answer") return { ...base, type: kind, acceptedPatterns: answers };
	throw new AdminRequestFailed(400, "Choose what kind of question this is.");
}

/** A right answer has to be one of the choices, letter for letter. */
function checkQuestion(question: RawQuestion): void {
	const options = stringList(question.options);
	const chosen =
		question.type === "multiple_choice"
			? [stringOf(question.correctAnswer)]
			: question.type === "multi_select"
				? stringList(question.correctAnswers)
				: [];
	for (const answer of chosen) {
		if (!options.includes(answer)) {
			throw new AdminRequestFailed(
				400,
				`"${answer}" is given as a right answer but is not one of the choices. Write it exactly as the choice is written.`,
			);
		}
	}
}

function configFromForm(form: FormData, type: string): Record<string, unknown> {
	if (type === "reading") {
		return { content: text(form, "content"), estimatedMinutes: whole(form, "minutes") };
	}
	if (type === "video") {
		const minutes = whole(form, "durationMinutes");
		return {
			url: text(form, "url"),
			description: optional(form, "description"),
			durationSeconds: minutes ? minutes * 60 : undefined,
		};
	}
	if (type === "external_link") {
		return {
			url: text(form, "url"),
			description: optional(form, "description"),
			openInNewTab: form.get("newTab") === "on",
		};
	}
	throw new AdminRequestFailed(400, "Choose what kind of activity this is.");
}

const percentToFraction = (form: FormData): number => {
	const percent = Number(text(form, "passPercent"));
	return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent / 100 : 0.7;
};

const newQuestionId = () => `q_${crypto.randomUUID().slice(0, 8)}`;
const isType = (value: string): value is ActivityType =>
	ACTIVITY_TYPES.some((type) => type.value === value);

function activityValues(activity: ApiActivity): Record<string, string> {
	const config = activity.config ?? {};
	const seconds = typeof config.durationSeconds === "number" ? config.durationSeconds : 0;
	const threshold = typeof config.passingThreshold === "number" ? config.passingThreshold : 0.7;
	return {
		title: activity.title,
		content: stringOf(config.content),
		minutes: typeof config.estimatedMinutes === "number" ? String(config.estimatedMinutes) : "",
		url: stringOf(config.url),
		description: stringOf(config.description),
		durationMinutes: seconds ? String(Math.max(1, Math.round(seconds / 60))) : "",
		newTab: config.openInNewTab === false ? "" : "on",
		passPercent: String(Math.round(threshold * 100)),
	};
}

export function activityPage(context: PageContext): Promise<PageResult<ActivityData>> {
	return signedIn(context, async (api, session) => {
		const courseId = context.params.courseId ?? "";
		const lessonId = context.params.lessonId ?? "";
		const activityId = context.params.activityId ?? "";
		const making = activityId === "new";
		const base = `/courses/${courseId}/lessons/${lessonId}/activities`;
		const lessonHref = lessonPath(courseId, lessonId);

		const readActivity = async () => {
			const activity = (await api.all<ApiActivity>(base)).find((item) => item.id === activityId);
			if (!activity) throw new AdminRequestFailed(404, "That activity is no longer there.");
			return activity;
		};

		const result = await handle(context, async (form) => {
			const action = text(form, "do");
			if (action === "add-activity") {
				const type = text(form, "type");
				let config: Record<string, unknown>;
				if (type === "quiz") {
					const question = questionFromForm(form, newQuestionId(), text(form, "kind"));
					checkQuestion(question);
					config = { passingThreshold: percentToFraction(form), questions: [question] };
				} else {
					config = configFromForm(form, type);
				}
				const activity = await api.send<ApiActivity>("POST", base, {
					title: text(form, "title"),
					type,
					config,
				});
				// A quiz usually wants more questions: stay with it. Anything else is done.
				return activity.type === "quiz"
					? go(context, activityPath(courseId, lessonId, activity.id), "Quiz added as a draft")
					: go(context, lessonHref, `${TYPE_LABELS[activity.type]} added as a draft`, activity.id);
			}
			const activity = await readActivity();
			if (action === "delete-question") {
				const questions = questionsOf(activity.config);
				if (questions.length <= 1) {
					throw new AdminRequestFailed(
						400,
						"A quiz needs at least one question. Delete the quiz instead.",
					);
				}
				await api.send("PATCH", `${base}/${activityId}`, {
					type: "quiz",
					config: {
						...activity.config,
						questions: questions.filter((question) => question.id !== text(form, "questionId")),
					},
				});
				return go(context, activityPath(courseId, lessonId, activityId), "Question deleted");
			}
			const config =
				activity.type === "quiz"
					? { ...activity.config, passingThreshold: percentToFraction(form) }
					: configFromForm(form, activity.type);
			await api.send("PATCH", `${base}/${activityId}`, {
				title: text(form, "title"),
				type: activity.type,
				config,
			});
			return activity.type === "quiz"
				? go(context, activityPath(courseId, lessonId, activityId), "Quiz saved")
				: go(context, lessonHref, `${TYPE_LABELS[activity.type]} saved`, activityId);
		});
		if (result instanceof Response) return result;

		const read = await readLesson(context, api, courseId, lessonId);
		if (read instanceof Response) return read;
		const shared = {
			course: courseHead(read.course),
			lesson: read.head,
			done: doneMessage(context),
			error: result.error,
			minutesLeft: minutesLeft(session.expires),
		};

		if (making) {
			const asked = context.url.searchParams.get("type") ?? result.typed?.type ?? "";
			if (!isType(asked)) return context.rewrite("/404");
			return {
				...shared,
				activityId: null,
				type: asked,
				typeLabel: TYPE_LABELS[asked],
				published: false,
				values: result.typed ?? { newTab: "on", passPercent: "70", kind: "multiple_choice" },
				questions: [],
				addQuestionHref: null,
			};
		}

		const activity = (await api.all<ApiActivity>(base)).find((item) => item.id === activityId);
		if (!activity) return context.rewrite("/404");
		const here = activityPath(courseId, lessonId, activityId);
		return {
			...shared,
			activityId: activity.id,
			type: activity.type,
			typeLabel: TYPE_LABELS[activity.type] ?? activity.type,
			published: activity.status === "published",
			values: result.typed ?? activityValues(activity),
			questions:
				activity.type === "quiz"
					? questionsOf(activity.config).map((question) => ({
							id: question.id,
							kindLabel: KIND_LABELS[question.type] ?? question.type,
							text: question.text,
							href: `${here}/questions/${question.id}`,
						}))
					: [],
			addQuestionHref: activity.type === "quiz" ? `${here}/questions/new` : null,
		};
	});
}

// --- One question of a quiz -------------------------------------------------

export interface QuestionData extends AdminPage {
	course: CourseHead;
	lesson: LessonHead;
	quiz: { title: string; href: string };
	/** Null for one that is being made. */
	questionId: string | null;
	/** Fixed once the question exists. */
	kind: QuestionKind | null;
	kindLabel: string | null;
	values: Record<string, string>;
}

function questionValues(question: RawQuestion): Record<string, string> {
	const answers =
		question.type === "multiple_choice"
			? [stringOf(question.correctAnswer)]
			: question.type === "multi_select"
				? stringList(question.correctAnswers)
				: question.type === "fill_in_blank"
					? stringList(question.acceptedAnswers)
					: stringList(question.acceptedPatterns);
	return {
		text: question.text,
		options: stringList(question.options).join("\n"),
		answers: answers.join("\n"),
	};
}

export function questionPage(context: PageContext): Promise<PageResult<QuestionData>> {
	return signedIn(context, async (api, session) => {
		const courseId = context.params.courseId ?? "";
		const lessonId = context.params.lessonId ?? "";
		const activityId = context.params.activityId ?? "";
		const questionId = context.params.questionId ?? "";
		const making = questionId === "new";
		const base = `/courses/${courseId}/lessons/${lessonId}/activities`;
		const quizHref = activityPath(courseId, lessonId, activityId);

		const readQuiz = async () => {
			const activity = (await api.all<ApiActivity>(base)).find((item) => item.id === activityId);
			if (!activity || activity.type !== "quiz") {
				throw new AdminRequestFailed(404, "That quiz is no longer there.");
			}
			return activity;
		};

		const result = await handle(context, async (form) => {
			const quiz = await readQuiz();
			let questions = questionsOf(quiz.config);
			if (making) {
				const question = questionFromForm(form, newQuestionId(), text(form, "kind"));
				checkQuestion(question);
				questions = [...questions, question];
			} else {
				const existing = questions.find((question) => question.id === questionId);
				if (!existing) throw new AdminRequestFailed(404, "That question is no longer there.");
				const question = questionFromForm(form, questionId, existing.type);
				checkQuestion(question);
				questions = questions.map((item) => (item.id === questionId ? question : item));
			}
			await api.send("PATCH", `${base}/${activityId}`, {
				type: "quiz",
				config: { ...quiz.config, questions },
			});
			return go(context, quizHref, making ? "Question added" : "Question saved");
		});
		if (result instanceof Response) return result;

		const read = await readLesson(context, api, courseId, lessonId);
		if (read instanceof Response) return read;
		const quiz = (await api.all<ApiActivity>(base)).find((item) => item.id === activityId);
		if (!quiz || quiz.type !== "quiz") return context.rewrite("/404");
		const question = questionsOf(quiz.config).find((item) => item.id === questionId);
		if (!making && !question) return context.rewrite("/404");

		return {
			course: courseHead(read.course),
			lesson: read.head,
			quiz: { title: quiz.title, href: quizHref },
			questionId: question?.id ?? null,
			kind: question?.type ?? null,
			kindLabel: question ? (KIND_LABELS[question.type] ?? question.type) : null,
			values: result.typed ?? (question ? questionValues(question) : { kind: "multiple_choice" }),
			error: result.error,
			minutesLeft: minutesLeft(session.expires),
		};
	});
}
