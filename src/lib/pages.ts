/**
 * What each page does, with no markup. A page file calls one function here,
 * returns its `response` if there is one (a redirect, or "Page not found"),
 * and otherwise draws `data`.
 *
 * Everything about how the site behaves is in this file and the ones it
 * imports; everything about how it looks is in src/pages, src/layouts,
 * src/components and src/styles. To restyle the site, or rebuild it on
 * another UI library, change the second group and leave this alone.
 */
import { env } from "cloudflare:workers";
import type { APIContext } from "astro";
import { getAuthAdapter } from "./auth";
import { formatMinutes, formatSeconds } from "./format";
import {
	type Activity,
	type Course,
	type Credential,
	type Enrollment,
	type Lesson,
	type OutlineSection,
	type Progress,
	type Submission,
	completeActivity,
	enrol,
	findEnrollment,
	getOutline,
	getPublishedCourse,
	issueCredential,
	listEnrollments,
	listLessonActivities,
	listPublishedCourses,
	progressByActivity,
	publishedTags,
	readEnrollment,
	submitQuiz,
	verify,
} from "./monopane";
import { type LessonState, isDone, lessonStates, totals } from "./progress";
import { type Question, answersFromForm, fieldName, passingThreshold, readQuestions } from "./quiz";
import { safeNext } from "./session";
import { signIn, signInUrl, signOut } from "./sign-in";
import { renderText } from "./text";
import { type VideoPlayer, videoPlayer } from "./video";

/** The parts of Astro a page hands over. `Astro` itself satisfies this. */
export type PageContext = Pick<
	APIContext,
	"locals" | "params" | "url" | "request" | "cookies" | "redirect" | "rewrite"
>;

/** A page either answers at once (redirect, not found) or has data to draw. */
export type PageResult<T> =
	| { response: Response; data?: undefined }
	| { response?: undefined; data: T };

const page = <T>(data: T): PageResult<T> => ({ data });
const respond = <T>(response: Response): PageResult<T> => ({ response });
const notFound = async <T>(context: PageContext): Promise<PageResult<T>> =>
	respond(await context.rewrite("/404"));

const longDate = (iso: string) =>
	new Date(iso).toLocaleDateString("en-GB", { dateStyle: "long", timeZone: "UTC" });
const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

// --- Shared view models -----------------------------------------------------

export type LessonStatus = "todo" | "started" | "done";

export interface CourseCard {
	slug: string;
	title: string;
	description: string | null;
	href: string;
	imageUrl: string | null;
	tags: { name: string; href: string }[];
	/** "45 min", or null when the course does not say. */
	duration: string | null;
	/** The signed-in learner's standing in the course, if enrolled. */
	enrolled: "active" | "completed" | null;
}

export interface OutlineLesson {
	id: string;
	title: string;
	description: string | null;
	href: string;
	status: LessonStatus;
	/** "Done", "Not started", "1 of 2 done", or "" when the visitor is not enrolled. */
	statusLabel: string;
	current: boolean;
}

export interface Outline {
	/** Null for lessons that sit directly under the course. */
	moduleTitle: string | null;
	moduleDescription: string | null;
	lessons: OutlineLesson[];
}

const tagHref = (tag: string) => `/?tag=${encodeURIComponent(tag)}`;

function courseCard(course: Course, enrolled?: Enrollment["status"]): CourseCard {
	return {
		slug: course.slug,
		title: course.title,
		description: course.description ?? null,
		href: `/courses/${course.slug}`,
		imageUrl: course.imageUrl,
		tags: course.tags.map((name) => ({ name, href: tagHref(name) })),
		duration: course.estimatedMinutes ? formatMinutes(course.estimatedMinutes) : null,
		enrolled: enrolled === "active" || enrolled === "completed" ? enrolled : null,
	};
}

function lessonStatus(state: LessonState | undefined): LessonStatus {
	if (!state || state.done === 0) return "todo";
	return state.done >= state.total ? "done" : "started";
}

function lessonStatusLabel(state: LessonState | undefined): string {
	if (!state) return "";
	if (state.total === 0) return "Nothing to do yet";
	if (state.done >= state.total) return "Done";
	if (state.done === 0) return "Not started";
	return `${state.done} of ${state.total} done`;
}

function outline(
	course: Course,
	sections: OutlineSection[],
	states: Map<string, LessonState>,
	currentLessonId?: string,
): Outline[] {
	return sections.map((section) => ({
		moduleTitle: section.module?.title ?? null,
		moduleDescription: section.module?.description ?? null,
		lessons: section.lessons.map((lesson) => ({
			id: lesson.id,
			title: lesson.title,
			description: lesson.description ?? null,
			href: `/courses/${course.slug}/${lesson.id}`,
			status: lessonStatus(states.get(lesson.id)),
			statusLabel: lessonStatusLabel(states.get(lesson.id)),
			current: lesson.id === currentLessonId,
		})),
	}));
}

/** The first lesson with something left to do, else the first lesson. */
function nextLesson(lessons: Lesson[], states: Map<string, LessonState>): Lesson | undefined {
	return (
		lessons.find((lesson) => {
			const state = states.get(lesson.id);
			return !state || state.done < state.total;
		}) ?? lessons[0]
	);
}

// --- Home -------------------------------------------------------------------

export interface HomePage {
	/** The topic the catalogue is narrowed to, if any. */
	tag: string | null;
	/** Every topic, for the filter. Empty when no course has one. */
	filters: { name: string; href: string; current: boolean }[];
	courses: CourseCard[];
}

export async function homePage(context: PageContext): Promise<PageResult<HomePage>> {
	const { user } = context.locals;
	const tags = await publishedTags();
	const wanted = context.url.searchParams.get("tag");
	const tag = wanted && tags.includes(wanted) ? wanted : null;
	const courses = await listPublishedCourses(tag ?? undefined);
	const enrolled = new Map(
		user ? (await listEnrollments(user.learnerId)).map((e) => [e.courseId, e.status]) : [],
	);
	return page({
		tag,
		filters:
			tags.length === 0
				? []
				: [
						{ name: "All", href: "/", current: tag === null },
						...tags.map((name) => ({ name, href: tagHref(name), current: name === tag })),
					],
		courses: courses.map((course) => courseCard(course, enrolled.get(course.id))),
	});
}

// --- A course ---------------------------------------------------------------

export interface CoursePage {
	course: CourseCard;
	outline: Outline[];
	hasLessons: boolean;
	signedIn: boolean;
	enrolled: boolean;
	completed: boolean;
	/** Activities done and in total, for an enrolled learner. */
	progress: LessonState | null;
	/** Where "Start" or "Continue" goes. */
	nextHref: string | null;
	certificateHref: string;
}

/** GET shows the course. POST enrols the learner (after sign-in) and shows it again. */
export async function coursePage(context: PageContext): Promise<PageResult<CoursePage>> {
	const { user } = context.locals;
	const course = await getPublishedCourse(context.params.slug ?? "");
	if (!course) return notFound(context);
	const here = `/courses/${course.slug}`;

	if (context.request.method === "POST") {
		if (!user) return respond(context.redirect(signInUrl(here)));
		await enrol(user.learnerId, course.id);
		return respond(context.redirect(here, 303));
	}

	const sections = await getOutline(course.id);
	const lessons = sections.flatMap((section) => section.lessons);
	const enrollment = user ? await findEnrollment(user.learnerId, course.id) : null;
	const states = enrollment
		? await lessonStates(course.id, sections, await progressByActivity(enrollment.id))
		: new Map<string, LessonState>();
	const next = nextLesson(lessons, states);

	return page({
		course: courseCard(course, enrollment?.status),
		outline: outline(course, sections, states),
		hasLessons: lessons.length > 0,
		signedIn: user !== null,
		enrolled: enrollment !== null,
		completed: enrollment?.status === "completed",
		progress: enrollment ? totals(states) : null,
		nextHref: next ? `${here}/${next.id}` : null,
		certificateHref: `${here}/complete`,
	});
}

// --- A lesson ---------------------------------------------------------------

interface ActivityBase {
	id: string;
	title: string;
	done: boolean;
}

export interface ReadingView extends ActivityBase {
	type: "reading";
	/** Safe HTML made from the reading's text. */
	html: string;
	minutes: number | null;
}

export interface LinkView extends ActivityBase {
	type: "external_link";
	/** Null when the stored address is not an http(s) link. */
	url: string | null;
	description: string | null;
	newTab: boolean;
}

export interface VideoView extends ActivityBase {
	type: "video";
	/** How to show it, or null when the address cannot be played. */
	player: VideoPlayer | null;
	duration: string | null;
	description: string | null;
}

export interface QuestionView extends Question {
	/** The name of this question's form field. */
	field: string;
	/** What the learner answered in the attempt just submitted. */
	given: string[];
	/** Whether that answer was right; null when no attempt was just submitted. */
	correct: boolean | null;
}

export interface QuizView extends ActivityBase {
	type: "quiz";
	questions: QuestionView[];
	/** "Passed", "Not passed yet" or "Not attempted". */
	status: "passed" | "failed" | "unattempted";
	/** Set when this request submitted this quiz. */
	result: { passed: boolean; score: string; needed: string } | null;
	bestScore: string | null;
	/** Whether to draw the form: always, except for a quiz passed earlier. */
	showForm: boolean;
	canSubmit: boolean;
	submitLabel: string;
}

export type ActivityView = ReadingView | LinkView | VideoView | QuizView;

export interface LessonPage {
	course: { title: string; href: string };
	lesson: { title: string; description: string | null };
	/** Where this page's forms post to. */
	action: string;
	outline: Outline[];
	activities: ActivityView[];
	/** True once every activity in the course is done. */
	courseCompleted: boolean;
	certificateHref: string;
	previous: { title: string; href: string } | null;
	following: { title: string; href: string } | null;
}

function activityView(
	activity: Activity,
	record: Progress | undefined,
	graded: { activityId: string; submission: Submission } | null,
	given: Map<string, string[]>,
): ActivityView | null {
	const config = activity.config ?? {};
	const base = { id: activity.id, title: activity.title, done: isDone(record) };
	const text = (value: unknown) => (typeof value === "string" ? value : null);

	if (activity.type === "reading") {
		return {
			...base,
			type: "reading",
			html: renderText(text(config.content) ?? ""),
			minutes: typeof config.estimatedMinutes === "number" ? config.estimatedMinutes : null,
		};
	}
	if (activity.type === "external_link") {
		const url = text(config.url);
		return {
			...base,
			type: "external_link",
			url: url && /^https?:\/\//.test(url) ? url : null,
			description: text(config.description),
			newTab: config.openInNewTab !== false,
		};
	}
	if (activity.type === "video") {
		return {
			...base,
			type: "video",
			player: videoPlayer(text(config.url) ?? ""),
			duration:
				typeof config.durationSeconds === "number" ? formatSeconds(config.durationSeconds) : null,
			description: text(config.description),
		};
	}
	if (activity.type === "quiz") {
		const submission = graded?.activityId === activity.id ? graded.submission : null;
		const correct = new Map(submission?.results.map((r) => [r.questionId, r.correct]) ?? []);
		const failedBefore = !base.done && (record?.attempts ?? 0) > 0;
		return {
			...base,
			type: "quiz",
			questions: readQuestions(config).map((question) => ({
				...question,
				field: fieldName(question.id),
				given: submission ? (given.get(question.id) ?? []) : [],
				correct: submission ? (correct.get(question.id) ?? false) : null,
			})),
			status: base.done ? "passed" : failedBefore ? "failed" : "unattempted",
			result: submission
				? {
						passed: submission.passed,
						score: percent(submission.score),
						needed: percent(passingThreshold(config)),
					}
				: null,
			bestScore: record?.bestScore != null ? percent(record.bestScore) : null,
			showForm: !base.done || submission !== null,
			canSubmit: !base.done,
			submitLabel: failedBefore || submission ? "Submit answers again" : "Submit answers",
		};
	}
	// A kind of activity this site does not know yet is left out.
	return null;
}

/**
 * GET shows a lesson to an enrolled learner. POST marks a reading, link or
 * video as done, or submits a quiz; a quiz's result is shown in the reply.
 */
export async function lessonPage(context: PageContext): Promise<PageResult<LessonPage>> {
	const { user } = context.locals;
	const course = await getPublishedCourse(context.params.slug ?? "");
	if (!course) return notFound(context);
	const coursePath = `/courses/${course.slug}`;

	const sections = await getOutline(course.id);
	const lessons = sections.flatMap((section) => section.lessons);
	const index = lessons.findIndex((item) => item.id === context.params.lessonId);
	const lesson = lessons[index];
	if (!lesson) return notFound(context);
	const here = `${coursePath}/${lesson.id}`;

	// Lessons are for enrolled learners.
	if (!user) return respond(context.redirect(signInUrl(here)));
	let enrollment = await findEnrollment(user.learnerId, course.id);
	if (!enrollment) return respond(context.redirect(coursePath));

	const activities = await listLessonActivities(course.id, lesson.id);
	let graded: { activityId: string; submission: Submission } | null = null;
	const given = new Map<string, string[]>();

	if (context.request.method === "POST") {
		const form = await context.request.formData();
		const activity = activities.find((item) => item.id === form.get("activityId"));
		if (!activity) return notFound(context);

		if (activity.type === "quiz") {
			const answers = answersFromForm(readQuestions(activity.config ?? {}), form);
			for (const answer of answers) {
				given.set(answer.questionId, "answers" in answer ? answer.answers : [answer.answer]);
			}
			graded = {
				activityId: activity.id,
				submission: await submitQuiz(enrollment.id, activity.id, answers),
			};
			enrollment = await readEnrollment(enrollment.id);
		} else {
			await completeActivity(enrollment.id, activity.id);
			return respond(context.redirect(`${here}#${activity.id}`, 303));
		}
	}

	const progress = await progressByActivity(enrollment.id);
	const states = await lessonStates(course.id, sections, progress);
	const link = (item: Lesson | undefined) =>
		item ? { title: item.title, href: `${coursePath}/${item.id}` } : null;

	return page({
		course: { title: course.title, href: coursePath },
		lesson: { title: lesson.title, description: lesson.description ?? null },
		action: here,
		outline: outline(course, sections, states, lesson.id),
		activities: activities
			.map((activity) => activityView(activity, progress.get(activity.id), graded, given))
			.filter((view) => view !== null),
		courseCompleted: enrollment.status === "completed",
		certificateHref: `${coursePath}/complete`,
		previous: link(lessons[index - 1]),
		following: link(lessons[index + 1]),
	});
}

// --- My learning ------------------------------------------------------------

export interface LearningItem {
	course: CourseCard;
	progress: LessonState;
	/** Where "Start" or "Continue" goes. */
	nextHref: string | null;
	started: boolean;
	completedOn: string | null;
	certificateHref: string;
}

export interface MyLearningPage {
	inProgress: LearningItem[];
	completed: LearningItem[];
}

export async function myLearningPage(context: PageContext): Promise<PageResult<MyLearningPage>> {
	const { user } = context.locals;
	if (!user) return respond(context.redirect(signInUrl("/my-learning")));

	const [enrollments, courses] = await Promise.all([
		listEnrollments(user.learnerId),
		listPublishedCourses(),
	]);
	// A course that has since been unpublished drops off the list; its progress is kept in Monopane.
	const items = (
		await Promise.all(
			enrollments.map(async (enrollment): Promise<LearningItem | null> => {
				const course = courses.find((c) => c.id === enrollment.courseId);
				if (!course) return null;
				const sections = await getOutline(course.id);
				const states = await lessonStates(
					course.id,
					sections,
					await progressByActivity(enrollment.id),
				);
				const progress = totals(states);
				const next = nextLesson(
					sections.flatMap((section) => section.lessons),
					states,
				);
				return {
					course: courseCard(course, enrollment.status),
					progress,
					nextHref: next ? `/courses/${course.slug}/${next.id}` : null,
					started: progress.done > 0,
					completedOn: enrollment.completedAt ? longDate(enrollment.completedAt) : null,
					certificateHref: `/courses/${course.slug}/complete`,
				};
			}),
		)
	).filter((item) => item !== null);

	return page({
		inProgress: items.filter((item) => item.course.enrolled !== "completed"),
		completed: items.filter((item) => item.course.enrolled === "completed"),
	});
}

// --- Completion and certificates --------------------------------------------

export interface CompletePage {
	course: { title: string; href: string };
	learnerName: string;
	/** Null until the course is completed. */
	certificate: { code: string; issuedOn: string; verifyPath: string; verifyUrl: string } | null;
}

export async function completePage(context: PageContext): Promise<PageResult<CompletePage>> {
	const { user } = context.locals;
	const course = await getPublishedCourse(context.params.slug ?? "");
	if (!course) return notFound(context);
	const coursePath = `/courses/${course.slug}`;
	if (!user) return respond(context.redirect(signInUrl(`${coursePath}/complete`)));

	const enrollment = await findEnrollment(user.learnerId, course.id);
	if (!enrollment) return respond(context.redirect(coursePath));

	// Monopane issues a credential only for a completed enrollment, and returns
	// the same one each time it is asked.
	const credential: Credential | null =
		enrollment.status === "completed" ? await issueCredential(enrollment.id) : null;
	const verifyPath = credential ? `/credentials/${credential.code}` : "";

	return page({
		course: { title: course.title, href: coursePath },
		learnerName: user.name,
		certificate: credential
			? {
					code: credential.code,
					issuedOn: longDate(credential.issuedAt),
					verifyPath,
					verifyUrl: new URL(verifyPath, context.url).href,
				}
			: null,
	});
}

export interface CredentialPage {
	/** Null when no valid credential has this code. */
	credential: {
		code: string;
		courseTitle: string;
		learnerName: string;
		issuedBy: string;
		issuedOn: string;
	} | null;
}

/** Public: anyone with a credential's code can check it. Not found is a 404. */
export async function credentialPage(context: PageContext): Promise<PageResult<CredentialPage>> {
	const code = (context.params.code ?? "").toUpperCase();
	const wellFormed = /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(code);
	const result = wellFormed ? await verify(code) : null;
	const credential = result?.valid ? result.credential : null;
	return page({
		credential:
			credential && result
				? {
						code: credential.code,
						courseTitle: result.courseTitle ?? "",
						learnerName: result.learnerName ?? "A learner (no name on record)",
						issuedBy: result.tenantName ?? "",
						issuedOn: longDate(credential.issuedAt),
					}
				: null,
	});
}

// --- Signing in and out -----------------------------------------------------

export interface SignInPage {
	mode: "demo" | "magic-link";
	/** True once a sign-in link has been sent (or would have been). */
	linkSent: boolean;
	error: string;
	/** What the visitor typed, to put back in the form after an error. */
	name: string;
	email: string;
}

export async function signInPage(context: PageContext): Promise<PageResult<SignInPage>> {
	const { config, user } = context.locals;
	const adapter = getAuthAdapter(config, env.MAGIC_LINKS);
	const next = safeNext(context.url.searchParams.get("next"));
	if (user) return respond(context.redirect(next));

	const data: SignInPage = { mode: adapter.mode, linkSent: false, error: "", name: "", email: "" };
	if (context.request.method === "POST") {
		const form = await context.request.formData();
		data.name = String(form.get("name") ?? "");
		data.email = String(form.get("email") ?? "");
		const result = await adapter.start({
			name: data.name,
			email: data.email,
			origin: context.url.origin,
			next,
		});
		if (result.kind === "signed-in") {
			await signIn(result.identity, adapter, config, context.cookies, context.url);
			return respond(context.redirect(next, 303));
		}
		if (result.kind === "link-sent") data.linkSent = true;
		else data.error = result.message;
	}
	return page(data);
}

export interface VerifyLinkPage {
	/** The token to put in the confirmation form; empty when the link is no good. */
	token: string;
	failed: boolean;
}

/**
 * Where an emailed sign-in link lands. Opening the link only shows a button;
 * the link is used up when the button is pressed, so email scanners that open
 * links ahead of the reader cannot spend it.
 */
export async function verifyLinkPage(context: PageContext): Promise<PageResult<VerifyLinkPage>> {
	const { config } = context.locals;
	const adapter = getAuthAdapter(config, env.MAGIC_LINKS);
	let token = context.url.searchParams.get("token") ?? "";

	if (context.request.method === "POST") {
		const form = await context.request.formData();
		token = String(form.get("token") ?? "");
		const result = await adapter.finish(token);
		if (result) {
			await signIn(result.identity, adapter, config, context.cookies, context.url);
			return respond(context.redirect(result.next, 303));
		}
		return page({ token: "", failed: true });
	}
	return page({ token, failed: token === "" });
}

export function signOutResponse(context: Pick<APIContext, "cookies" | "redirect">): Response {
	signOut(context.cookies);
	return context.redirect("/", 303);
}
