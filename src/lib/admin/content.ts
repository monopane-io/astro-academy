/**
 * The course editor: what the pages under /admin/courses do.
 *
 * Every change is an ordinary form post. The form says what to do in a field
 * named `do`; the function for the page carries it out at Monopane with the
 * admin's token and sends the browser back to the page (so reloading never
 * repeats a change). If Monopane refuses, the page is drawn again with what
 * it said.
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

/** Back to the page a form was sent from, saying what was done. */
function done(context: PageContext, message: string, anchor = ""): Response {
	const hash = anchor ? `#${anchor}` : "";
	return context.redirect(
		`${context.url.pathname}?done=${encodeURIComponent(message)}${hash}`,
		303,
	);
}

/** What the last form did, shown once at the top of the page. */
const doneMessage = (context: PageContext) => context.url.searchParams.get("done")?.slice(0, 200);

// --- The list of courses: making a new one ----------------------------------

/** Make a draft course from the form on /admin and go to its editor. */
export async function createCourse(
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
			return context.redirect(
				`/admin/courses/${course.id}?done=${encodeURIComponent("Course created as a draft")}`,
				303,
			);
		} catch (error) {
			if (!(error instanceof AdminRequestFailed) || error.status !== 409) throw error;
		}
	}
	throw new AdminRequestFailed(409, "A course already has that address. Try another title.");
}

// --- One course -------------------------------------------------------------

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
	} | null;
	lessons: EditorLesson[];
}

export interface CourseEditorData {
	course: {
		id: string;
		title: string;
		slug: string;
		description: string;
		imageUrl: string;
		tags: string;
		estimatedMinutes: string;
		published: boolean;
	};
	sections: EditorSection[];
	hasModules: boolean;
	/** How many lessons, modules and activities a user cannot see yet. */
	enrolled: number;
	completed: number;
	/** The course as users see it; null while it is a draft. */
	viewHref: string | null;
	done?: string;
	error?: string;
	minutesLeft: number;
}

async function readOutline(api: AdminApi, courseId: string) {
	const [modules, lessons] = await Promise.all([
		api.all<ApiModule>(`/courses/${courseId}/modules`),
		api.all<ApiLesson>(`/courses/${courseId}/lessons`),
	]);
	return { modules: modules.sort(byPosition), lessons: lessons.sort(byPosition) };
}

async function courseAction(
	context: PageContext,
	api: AdminApi,
	courseId: string,
	form: FormData,
): Promise<Response> {
	const base = `/courses/${courseId}`;
	const id = text(form, "id");
	switch (text(form, "do")) {
		case "save-course": {
			const minutes = whole(form, "estimatedMinutes");
			await api.send("PATCH", base, {
				title: text(form, "title"),
				slug: text(form, "slug"),
				description: text(form, "description"),
				imageUrl: optional(form, "imageUrl") ?? null,
				tags: text(form, "tags")
					.split(",")
					.map((tag) => tag.trim())
					.filter(Boolean),
				estimatedMinutes: minutes ?? null,
			});
			return done(context, "Course saved");
		}
		case "toggle-course": {
			const status = flip(text(form, "status"));
			await api.send("PATCH", base, { status });
			return done(
				context,
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
			return done(context, "The course and everything in it is published");
		}
		case "delete-course": {
			if (text(form, "confirm") !== "yes") {
				throw new AdminRequestFailed(400, "Tick the box to confirm deleting the course.");
			}
			await api.send("DELETE", base);
			return context.redirect(`/admin?done=${encodeURIComponent("Course deleted")}`, 303);
		}
		case "add-module": {
			await api.send("POST", `${base}/modules`, {
				title: text(form, "title"),
				description: optional(form, "description"),
			});
			return done(context, "Module added", "outline");
		}
		case "save-module": {
			await api.send("PATCH", `${base}/modules/${id}`, {
				title: text(form, "title"),
				description: text(form, "description"),
			});
			return done(context, "Module saved", id);
		}
		case "toggle-module": {
			await api.send("PATCH", `${base}/modules/${id}`, { status: flip(text(form, "status")) });
			return done(context, "Module updated", id);
		}
		case "delete-module": {
			await api.send("DELETE", `${base}/modules/${id}`);
			return done(context, "Module deleted", "outline");
		}
		case "move-module": {
			const { modules } = await readOutline(api, courseId);
			const order = moved(
				modules.map((module) => module.id),
				id,
				text(form, "direction"),
			);
			await api.send("PUT", `${base}/modules/reorder`, { order });
			return done(context, "Module moved", id);
		}
		case "add-lesson": {
			const lesson = await api.send<ApiLesson>("POST", `${base}/lessons`, {
				title: text(form, "title"),
				moduleId: optional(form, "moduleId") ?? null,
			});
			return context.redirect(
				`/admin/courses/${courseId}/lessons/${lesson.id}?done=${encodeURIComponent("Lesson added as a draft")}`,
				303,
			);
		}
		case "toggle-lesson": {
			await api.send("PATCH", `${base}/lessons/${id}`, { status: flip(text(form, "status")) });
			return done(context, "Lesson updated", id);
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
			return done(context, "Lesson moved", id);
		}
		default:
			throw new AdminRequestFailed(400, "That form is not one this page knows.");
	}
}

export function courseEditorPage(context: PageContext): Promise<PageResult<CourseEditorData>> {
	return signedIn(context, async (api, session) => {
		const courseId = context.params.courseId ?? "";
		let error: string | undefined;
		if (context.request.method === "POST") {
			try {
				return await courseAction(context, api, courseId, await context.request.formData());
			} catch (failure) {
				if (!(failure instanceof AdminRequestFailed)) throw failure;
				error = failure.message;
			}
		}

		let course: ApiCourse;
		try {
			course = await api.get<ApiCourse>(`/courses/${courseId}`);
		} catch (failure) {
			if (failure instanceof AdminRequestFailed && failure.status === 404) {
				return context.rewrite("/404");
			}
			throw failure;
		}
		const [{ modules, lessons }, stats] = await Promise.all([
			readOutline(api, courseId),
			api.get<ApiStats>(`/courses/${courseId}/stats`),
		]);

		const lessonRows = (group: ApiLesson[]): EditorLesson[] =>
			group.map((lesson, index) => ({
				id: lesson.id,
				title: lesson.title,
				published: lesson.status === "published",
				href: `/admin/courses/${courseId}/lessons/${lesson.id}`,
				first: index === 0,
				last: index === group.length - 1,
			}));
		const loose = lessons.filter((lesson) => lesson.moduleId === null);
		const sections: EditorSection[] = [
			...(loose.length > 0 || modules.length === 0
				? [{ module: null, lessons: lessonRows(loose) }]
				: []),
			...modules.map((module, index) => ({
				module: {
					id: module.id,
					title: module.title,
					description: module.description ?? "",
					published: module.status === "published",
					first: index === 0,
					last: index === modules.length - 1,
				},
				lessons: lessonRows(lessons.filter((lesson) => lesson.moduleId === module.id)),
			})),
		];

		return {
			course: {
				id: course.id,
				title: course.title,
				slug: course.slug,
				description: course.description ?? "",
				imageUrl: course.imageUrl ?? "",
				tags: course.tags.join(", "),
				estimatedMinutes: course.estimatedMinutes ? String(course.estimatedMinutes) : "",
				published: course.status === "published",
			},
			sections,
			hasModules: modules.length > 0,
			enrolled: stats.totalEnrollments,
			completed: stats.completedEnrollments,
			viewHref: course.status === "published" ? `/courses/${course.slug}` : null,
			done: doneMessage(context),
			error,
			minutesLeft: Math.max(1, Math.floor((session.expires - Date.now()) / 60000)),
		};
	});
}

// --- One lesson and its activities ------------------------------------------

export type QuestionKind = "multiple_choice" | "multi_select" | "fill_in_blank" | "short_answer";

export interface EditorQuestion {
	id: string;
	kind: QuestionKind;
	kindLabel: string;
	text: string;
	/** One per line. Empty for the two kinds without choices. */
	options: string;
	/** The right answer or answers, one per line; or what is accepted. */
	answers: string;
}

export interface EditorActivity {
	id: string;
	type: ApiActivity["type"];
	typeLabel: string;
	title: string;
	published: boolean;
	first: boolean;
	last: boolean;
	// reading
	content: string;
	minutes: string;
	// video and link
	url: string;
	description: string;
	durationMinutes: string;
	newTab: boolean;
	// quiz
	passPercent: string;
	questions: EditorQuestion[];
}

export interface LessonEditorData {
	course: { id: string; title: string; href: string };
	lesson: {
		id: string;
		title: string;
		description: string;
		moduleId: string;
		published: boolean;
	};
	modules: { id: string; title: string }[];
	activities: EditorActivity[];
	/** The lesson as users see it; null until it and its course are published. */
	viewHref: string | null;
	done?: string;
	error?: string;
	minutesLeft: number;
}

const KIND_LABELS: Record<QuestionKind, string> = {
	multiple_choice: "One right answer",
	multi_select: "Several right answers",
	fill_in_blank: "Fill in the blank",
	short_answer: "Short answer",
};
const TYPE_LABELS: Record<ApiActivity["type"], string> = {
	reading: "Reading",
	video: "Video",
	external_link: "Link",
	quiz: "Quiz",
};

const stringList = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const stringOf = (value: unknown): string => (typeof value === "string" ? value : "");

type RawQuestion = Record<string, unknown> & { id: string; type: QuestionKind; text: string };

function questionsOf(config: Record<string, unknown>): RawQuestion[] {
	return Array.isArray(config.questions) ? (config.questions as RawQuestion[]) : [];
}

function questionView(question: RawQuestion): EditorQuestion {
	const answers =
		question.type === "multiple_choice"
			? [stringOf(question.correctAnswer)]
			: question.type === "multi_select"
				? stringList(question.correctAnswers)
				: question.type === "fill_in_blank"
					? stringList(question.acceptedAnswers)
					: stringList(question.acceptedPatterns);
	return {
		id: question.id,
		kind: question.type,
		kindLabel: KIND_LABELS[question.type] ?? question.type,
		text: question.text,
		options: stringList(question.options).join("\n"),
		answers: answers.join("\n"),
	};
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

/** What a new activity of each kind holds, from the "add" form. */
function activityConfigFromForm(form: FormData, type: string): Record<string, unknown> {
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

async function lessonAction(
	context: PageContext,
	api: AdminApi,
	courseId: string,
	lessonId: string,
	form: FormData,
): Promise<Response> {
	const lessonPath = `/courses/${courseId}/lessons/${lessonId}`;
	const id = text(form, "id");
	const activityPath = `${lessonPath}/activities/${id}`;
	const readActivity = async () => {
		const activities = await api.all<ApiActivity>(`${lessonPath}/activities`);
		const activity = activities.find((item) => item.id === id);
		if (!activity) throw new AdminRequestFailed(404, "That activity is no longer there.");
		return activity;
	};

	switch (text(form, "do")) {
		case "save-lesson": {
			await api.send("PATCH", lessonPath, {
				title: text(form, "title"),
				description: text(form, "description"),
				moduleId: optional(form, "moduleId") ?? null,
			});
			return done(context, "Lesson saved");
		}
		case "toggle-lesson": {
			const status = flip(text(form, "status"));
			await api.send("PATCH", lessonPath, { status });
			return done(
				context,
				status === "published" ? "Lesson published" : "Lesson moved back to draft",
			);
		}
		case "delete-lesson": {
			if (text(form, "confirm") !== "yes") {
				throw new AdminRequestFailed(400, "Tick the box to confirm deleting the lesson.");
			}
			await api.send("DELETE", lessonPath);
			return context.redirect(
				`/admin/courses/${courseId}?done=${encodeURIComponent("Lesson deleted")}#outline`,
				303,
			);
		}
		case "add-activity": {
			const type = text(form, "type");
			let config: Record<string, unknown>;
			if (type === "quiz") {
				const question = questionFromForm(form, newQuestionId(), text(form, "kind"));
				checkQuestion(question);
				config = { passingThreshold: percentToFraction(form), questions: [question] };
			} else {
				config = activityConfigFromForm(form, type);
			}
			const activity = await api.send<ApiActivity>("POST", `${lessonPath}/activities`, {
				title: text(form, "title"),
				type,
				config,
			});
			return done(context, `${TYPE_LABELS[activity.type]} added as a draft`, activity.id);
		}
		case "save-activity": {
			const activity = await readActivity();
			const config =
				activity.type === "quiz"
					? { ...activity.config, passingThreshold: percentToFraction(form) }
					: activityConfigFromForm(form, activity.type);
			await api.send("PATCH", activityPath, {
				title: text(form, "title"),
				type: activity.type,
				config,
			});
			return done(context, `${TYPE_LABELS[activity.type]} saved`, id);
		}
		case "toggle-activity": {
			await api.send("PATCH", activityPath, { status: flip(text(form, "status")) });
			return done(context, "Activity updated", id);
		}
		case "delete-activity": {
			await api.send("DELETE", activityPath);
			return done(context, "Activity deleted", "activities");
		}
		case "move-activity": {
			const activities = (await api.all<ApiActivity>(`${lessonPath}/activities`)).sort(byPosition);
			const order = moved(
				activities.map((item) => item.id),
				id,
				text(form, "direction"),
			);
			await api.send("PUT", `${lessonPath}/activities/reorder`, { order });
			return done(context, "Activity moved", id);
		}
		case "add-question":
		case "save-question":
		case "delete-question": {
			const activity = await readActivity();
			const questionId = text(form, "questionId");
			let questions = questionsOf(activity.config);
			if (text(form, "do") === "delete-question") {
				if (questions.length <= 1) {
					throw new AdminRequestFailed(
						400,
						"A quiz needs at least one question. Delete the quiz instead.",
					);
				}
				questions = questions.filter((question) => question.id !== questionId);
			} else if (text(form, "do") === "add-question") {
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
			await api.send("PATCH", activityPath, {
				type: "quiz",
				config: { ...activity.config, questions },
			});
			return done(context, "Quiz saved", id);
		}
		default:
			throw new AdminRequestFailed(400, "That form is not one this page knows.");
	}
}

function activityView(activity: ApiActivity, index: number, count: number): EditorActivity {
	const config = activity.config ?? {};
	const seconds = typeof config.durationSeconds === "number" ? config.durationSeconds : 0;
	const threshold = typeof config.passingThreshold === "number" ? config.passingThreshold : 0.7;
	return {
		id: activity.id,
		type: activity.type,
		typeLabel: TYPE_LABELS[activity.type] ?? activity.type,
		title: activity.title,
		published: activity.status === "published",
		first: index === 0,
		last: index === count - 1,
		content: stringOf(config.content),
		minutes: typeof config.estimatedMinutes === "number" ? String(config.estimatedMinutes) : "",
		url: stringOf(config.url),
		description: stringOf(config.description),
		durationMinutes: seconds ? String(Math.max(1, Math.round(seconds / 60))) : "",
		newTab: config.openInNewTab !== false,
		passPercent: String(Math.round(threshold * 100)),
		questions: activity.type === "quiz" ? questionsOf(config).map(questionView) : [],
	};
}

export function lessonEditorPage(context: PageContext): Promise<PageResult<LessonEditorData>> {
	return signedIn(context, async (api, session) => {
		const courseId = context.params.courseId ?? "";
		const lessonId = context.params.lessonId ?? "";
		let error: string | undefined;
		if (context.request.method === "POST") {
			try {
				return await lessonAction(
					context,
					api,
					courseId,
					lessonId,
					await context.request.formData(),
				);
			} catch (failure) {
				if (!(failure instanceof AdminRequestFailed)) throw failure;
				error = failure.message;
			}
		}

		let course: ApiCourse;
		let lesson: ApiLesson;
		try {
			[course, lesson] = await Promise.all([
				api.get<ApiCourse>(`/courses/${courseId}`),
				api.get<ApiLesson>(`/courses/${courseId}/lessons/${lessonId}`),
			]);
		} catch (failure) {
			if (failure instanceof AdminRequestFailed && failure.status === 404) {
				return context.rewrite("/404");
			}
			throw failure;
		}
		const [modules, activities] = await Promise.all([
			api.all<ApiModule>(`/courses/${courseId}/modules`),
			api.all<ApiActivity>(`/courses/${courseId}/lessons/${lessonId}/activities`),
		]);
		activities.sort(byPosition);
		const module = modules.find((item) => item.id === lesson.moduleId);
		const visible =
			course.status === "published" &&
			lesson.status === "published" &&
			(!module || module.status === "published");

		return {
			course: { id: course.id, title: course.title, href: `/admin/courses/${course.id}` },
			lesson: {
				id: lesson.id,
				title: lesson.title,
				description: lesson.description ?? "",
				moduleId: lesson.moduleId ?? "",
				published: lesson.status === "published",
			},
			modules: modules.sort(byPosition).map((item) => ({ id: item.id, title: item.title })),
			activities: activities.map((activity, index) =>
				activityView(activity, index, activities.length),
			),
			viewHref: visible ? `/courses/${course.slug}/${lesson.id}` : null,
			done: doneMessage(context),
			error,
			minutesLeft: Math.max(1, Math.floor((session.expires - Date.now()) / 60000)),
		};
	});
}
