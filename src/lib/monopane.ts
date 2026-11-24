/**
 * Everything the academy asks of Monopane, in one file. Pages call these
 * functions and never the SDK directly, so this is the only place that holds
 * the API key, and the only file to read to see what the site depends on.
 *
 * All of it runs on the server. The browser never calls Monopane.
 */
import {
	type Activity,
	type Course,
	type Credential,
	type CredentialVerification,
	type Enrollment,
	type Learner,
	type Lesson,
	type Module,
	type Progress,
	type Submission,
	type SubmissionAnswer,
	client,
	createCredential,
	createEnrollment,
	createLearner,
	createProgress,
	createSubmission,
	getCurrentApiKey,
	getEnrollment,
	listActivities,
	listCourses,
	listLearnerEnrollments,
	listLearners,
	listLessons,
	listModules,
	listProgress,
	updateLearner,
	updateProgress,
	verifyCredential,
} from "@monopane/sdk";
import type { Identity } from "./auth/types";
import { type Config, SetupError } from "./config";

/** The scopes the academy's API key needs. Listed in the README. */
export const REQUIRED_SCOPES = [
	"content:read",
	"learners:read",
	"learners:write",
	"enrollments:read",
	"enrollments:write",
	"progress:write",
	"analytics:read",
] as const;

/** Course content is the same for every learner, so it is kept this long. */
const CONTENT_CACHE_SECONDS = 60;

let configured: Config | null = null;
let keyChecked: Promise<void> | null = null;
const cache = new Map<string, { expires: number; value: Promise<unknown> }>();

/** Point the SDK at this deployment's tenant. Called once per request by the middleware. */
export function configure(config: Config): void {
	if (configured === config) return;
	if (
		configured &&
		(configured.apiKey !== config.apiKey ||
			configured.tenantId !== config.tenantId ||
			configured.apiUrl !== config.apiUrl ||
			configured.environment !== config.environment)
	) {
		keyChecked = null;
		cache.clear();
	}
	configured = config;
	client.setConfig({
		baseUrl: config.apiUrl,
		auth: () => config.apiKey,
		headers: { "X-Environment": config.environment },
	});
}

function tenant(): string {
	if (!configured) throw new Error("configure() has not been called");
	return configured.tenantId;
}

/** Remember the answer to a content question for a short while. */
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
	const scope = `${tenant()}|${configured?.environment}|${key}`;
	const hit = cache.get(scope);
	if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
	const value = load();
	cache.set(scope, { expires: Date.now() + CONTENT_CACHE_SECONDS * 1000, value });
	// A failed request is not worth remembering.
	value.catch(() => cache.delete(scope));
	return value;
}

interface Page<T> {
	data: T[];
	nextCursor: string | null;
	hasMore: boolean;
}

/** Follow `nextCursor` until a list has been read to the end. */
async function all<T>(fetchPage: (cursor: string | undefined) => Promise<Page<T>>): Promise<T[]> {
	const items: T[] = [];
	let cursor: string | undefined;
	do {
		const page = await fetchPage(cursor);
		items.push(...page.data);
		cursor = page.hasMore && page.nextCursor ? page.nextCursor : undefined;
	} while (cursor);
	return items;
}

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

// --- Start-up check ---------------------------------------------------------

/**
 * Confirm, once, that the API key works for this tenant and has every scope
 * the academy uses. Throws a SetupError that names what is missing.
 */
export function checkApiKey(): Promise<void> {
	if (!keyChecked) {
		keyChecked = runKeyCheck();
		keyChecked.catch(() => {
			keyChecked = null;
		});
	}
	return keyChecked;
}

async function runKeyCheck(): Promise<void> {
	const unreachable = new SetupError([
		`The Monopane API at ${configured?.apiUrl} could not be reached.`,
	]);
	let result: Awaited<ReturnType<typeof getCurrentApiKey>>;
	try {
		result = await getCurrentApiKey({ path: { tenantId: tenant() } });
	} catch {
		throw unreachable;
	}
	// The SDK reports a network failure as an error with no response.
	if (!result.response) throw unreachable;
	const status = result.response.status;
	if (status === 401) throw new SetupError(["Monopane rejected MONOPANE_API_KEY (401)."]);
	if (status === 403 || status === 404) {
		throw new SetupError([
			"MONOPANE_API_KEY does not belong to MONOPANE_TENANT_ID, or is not an admin or scoped key.",
		]);
	}
	if (!result.data) {
		throw new SetupError([`Monopane answered ${status} to the API key check.`]);
	}
	const scopes: readonly string[] = result.data.scopes ?? ["*"];
	if (scopes.includes("*")) return;
	const missing = REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));
	if (missing.length > 0) {
		throw new SetupError(missing.map((scope) => `MONOPANE_API_KEY is missing the scope ${scope}.`));
	}
}

// --- Content: published only ------------------------------------------------

/** Published courses, newest first. With `tag`, only those carrying that tag. */
export function listPublishedCourses(tag?: string): Promise<Course[]> {
	return cached(`courses:${tag ?? ""}`, () =>
		all(async (cursor) => {
			const { data } = await listCourses({
				throwOnError: true,
				path: { tenantId: tenant() },
				query: { status: "published", tag, limit: 100, cursor },
			});
			return data;
		}),
	);
}

/** Every tag a published course carries, in alphabetical order: the catalogue's filters. */
export async function publishedTags(): Promise<string[]> {
	const tags = new Set((await listPublishedCourses()).flatMap((course) => course.tags));
	return [...tags].sort((a, b) => a.localeCompare(b));
}

/** The published course with this slug, or null. */
export function getPublishedCourse(slug: string): Promise<Course | null> {
	if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) || slug.length > 255) {
		return Promise.resolve(null);
	}
	return cached(`course:${slug}`, async () => {
		const { data } = await listCourses({
			throwOnError: true,
			path: { tenantId: tenant() },
			query: { status: "published", slug, limit: 1 },
		});
		return data.data[0] ?? null;
	});
}

export interface OutlineSection {
	/** Null for lessons that sit directly under the course. */
	module: Module | null;
	lessons: Lesson[];
}

/**
 * A course's published lessons in order: lessons outside any module first,
 * then each published module with its lessons. A published lesson inside an
 * unpublished module is left out, as a learner must not see it.
 */
export function getOutline(courseId: string): Promise<OutlineSection[]> {
	return cached(`outline:${courseId}`, async () => {
		const path = { tenantId: tenant(), courseId };
		const [modules, lessons] = await Promise.all([
			all(async (cursor) => {
				const { data } = await listModules({
					throwOnError: true,
					path,
					query: { status: "published", limit: 100, cursor },
				});
				return data;
			}),
			all(async (cursor) => {
				const { data } = await listLessons({
					throwOnError: true,
					path,
					query: { status: "published", limit: 100, cursor },
				});
				return data;
			}),
		]);
		modules.sort(byPosition);
		lessons.sort(byPosition);

		const sections: OutlineSection[] = [];
		const loose = lessons.filter((lesson) => lesson.moduleId === null);
		if (loose.length > 0) sections.push({ module: null, lessons: loose });
		for (const module of modules) {
			const inModule = lessons.filter((lesson) => lesson.moduleId === module.id);
			if (inModule.length > 0) sections.push({ module, lessons: inModule });
		}
		return sections;
	});
}

/**
 * A lesson's published activities in order. Asked for with `answers=omit`, so
 * quiz answer keys never reach this site's code, let alone its HTML.
 */
export function listLessonActivities(courseId: string, lessonId: string): Promise<Activity[]> {
	return cached(`activities:${courseId}:${lessonId}`, async () => {
		const activities = await all(async (cursor) => {
			const { data } = await listActivities({
				throwOnError: true,
				path: { tenantId: tenant(), courseId, lessonId },
				query: { status: "published", answers: "omit", limit: 100, cursor },
			});
			return data;
		});
		return activities.sort(byPosition);
	});
}

// --- Learners ---------------------------------------------------------------

/**
 * The Monopane learner for a signed-in person: found by `externalId`, created
 * on their first visit. `email` is passed only when the sign-in adapter has
 * verified it.
 */
export async function findOrCreateLearner(
	identity: Identity,
	options: { emailVerified: boolean },
): Promise<Learner> {
	const path = { tenantId: tenant() };
	const find = async () => {
		const { data } = await listLearners({
			throwOnError: true,
			path,
			query: { externalId: identity.id, limit: 1 },
		});
		return data.data[0] ?? null;
	};

	const existing = await find();
	if (existing) {
		if (existing.displayName === identity.name) return existing;
		const { data } = await updateLearner({
			throwOnError: true,
			path: { ...path, learnerId: existing.id },
			body: { displayName: identity.name },
		});
		return data;
	}

	const created = await createLearner({
		path,
		body: {
			externalId: identity.id,
			displayName: identity.name,
			...(options.emailVerified ? { email: identity.email } : {}),
		},
	});
	if (created.data) return created.data;
	// Two first visits at once: the other request created the learner.
	if (created.response?.status === 409) {
		const raced = await find();
		if (raced) return raced;
	}
	throw new Error(`Could not create the learner (${created.response?.status}).`);
}

// --- Enrollment and progress ------------------------------------------------

/** Everything the learner is enrolled in, newest first. Dropped enrollments are left out. */
export async function listEnrollments(learnerId: string): Promise<Enrollment[]> {
	const enrollments = await all(async (cursor) => {
		const { data } = await listLearnerEnrollments({
			throwOnError: true,
			path: { tenantId: tenant(), learnerId },
			query: { limit: 100, cursor },
		});
		return data;
	});
	return enrollments.filter((enrollment) => enrollment.status !== "dropped");
}

/** The learner's enrollment in a course, or null. Dropped enrollments do not count. */
export async function findEnrollment(
	learnerId: string,
	courseId: string,
): Promise<Enrollment | null> {
	return (await listEnrollments(learnerId)).find((e) => e.courseId === courseId) ?? null;
}

/** Enrol the learner. Enrolling twice returns the enrollment that already exists. */
export async function enrol(learnerId: string, courseId: string): Promise<Enrollment> {
	const existing = await findEnrollment(learnerId, courseId);
	if (existing) return existing;
	const created = await createEnrollment({
		path: { tenantId: tenant(), courseId },
		body: { learnerId },
	});
	if (created.data) return created.data;
	if (created.response?.status === 409) {
		const raced = await findEnrollment(learnerId, courseId);
		if (raced) return raced;
	}
	throw new Error(`Could not enrol (${created.response?.status}).`);
}

export async function readEnrollment(enrollmentId: string): Promise<Enrollment> {
	const { data } = await getEnrollment({
		throwOnError: true,
		path: { tenantId: tenant(), enrollmentId },
	});
	return data;
}

/** Progress records of an enrollment, keyed by activity ID. */
export async function progressByActivity(enrollmentId: string): Promise<Map<string, Progress>> {
	const { data } = await listProgress({
		throwOnError: true,
		path: { tenantId: tenant(), enrollmentId },
	});
	return new Map(data.data.map((record) => [record.activityId, record]));
}

/** Mark a reading or link as done. Monopane completes the course when all are. */
export async function completeActivity(enrollmentId: string, activityId: string): Promise<void> {
	const path = { tenantId: tenant(), enrollmentId };
	let record = (await progressByActivity(enrollmentId)).get(activityId);
	if (record?.status === "completed") return;
	if (!record) {
		const created = await createProgress({ path, body: { activityId } });
		record = created.data;
		if (!record && created.response?.status === 409) {
			record = (await progressByActivity(enrollmentId)).get(activityId);
		}
		if (!record) throw new Error(`Could not record progress (${created.response?.status}).`);
	}
	await updateProgress({
		throwOnError: true,
		path: { ...path, progressId: record.id },
		body: { status: "completed" },
	});
}

/** Submit quiz answers. Monopane grades them; the answers never come back. */
export async function submitQuiz(
	enrollmentId: string,
	activityId: string,
	answers: SubmissionAnswer[],
): Promise<Submission> {
	const { data } = await createSubmission({
		throwOnError: true,
		path: { tenantId: tenant(), enrollmentId },
		body: { activityId, answers },
	});
	return data;
}

// --- Credentials ------------------------------------------------------------

/** The credential for a completed enrollment. Asking again returns the same one. */
export async function issueCredential(enrollmentId: string): Promise<Credential | null> {
	const result = await createCredential({ path: { tenantId: tenant(), enrollmentId } });
	return result.data ?? null;
}

/** What anyone may know about a credential code. Needs no API key. */
export async function verify(code: string): Promise<CredentialVerification> {
	const { data } = await verifyCredential({ throwOnError: true, path: { code } });
	return data;
}

export type { Activity, Course, Credential, Enrollment, Lesson, Module, Progress, Submission };
