#!/usr/bin/env node
/**
 * Creates the demo course in your Monopane tenant, through the SDK.
 *
 *   npm run seed
 *
 * Safe to run twice: it finds what already exists by slug and title and only
 * adds what is missing, then makes sure the right things are published.
 *
 * It needs a key that can write content, which the site's own key cannot:
 *   MONOPANE_SETUP_API_KEY  the key you created in the console
 *   MONOPANE_TENANT_ID      the project to seed
 *   MONOPANE_API_URL       optional, defaults to https://api.monopane.io
 *   MONOPANE_ENVIRONMENT   optional, defaults to production
 * Values in .dev.vars are picked up automatically.
 */
import {
	client,
	createActivity,
	createCourse,
	createLesson,
	createModule,
	listActivities,
	listCourses,
	listLessons,
	listModules,
	updateActivity,
	updateCourse,
	updateLesson,
	updateModule,
} from "@monopane/sdk";
import { courses } from "./demo-course.mjs";

const apiKey = process.env.MONOPANE_SETUP_API_KEY;
const tenantId = process.env.MONOPANE_TENANT_ID;
const baseUrl = (process.env.MONOPANE_API_URL || "https://api.monopane.io").replace(/\/+$/, "");
const environment = process.env.MONOPANE_ENVIRONMENT || "production";

if (!apiKey || !tenantId) {
	console.error("Set MONOPANE_SETUP_API_KEY and MONOPANE_TENANT_ID (for example in .dev.vars).");
	process.exit(1);
}

client.setConfig({ baseUrl, auth: () => apiKey, headers: { "X-Environment": environment } });

let created = 0;

/** Read a paginated list to the end. */
async function all(list, path) {
	const items = [];
	let cursor;
	do {
		const { data } = await list({ throwOnError: true, path, query: { limit: 100, cursor } });
		items.push(...data.data);
		cursor = data.hasMore ? data.nextCursor : undefined;
	} while (cursor);
	return items;
}

/** Explain a failed call in words, then stop. */
function fail(what, error) {
	const message = error?.error?.message ?? error?.message ?? String(error);
	console.error(`Could not ${what}: ${message}`);
	if (/scope/i.test(message)) {
		console.error("The seed needs a key that can write content. Set MONOPANE_SETUP_API_KEY.");
	}
	process.exit(1);
}

async function ensureStatus(item, draft, update, path) {
	const wanted = draft ? "draft" : "published";
	if (item.status === wanted) return;
	await update({ throwOnError: true, path, body: { status: wanted } });
}

async function seedLessons(courseId, moduleId, lessons, existingLessons, startAt) {
	let position = startAt;
	for (const spec of lessons) {
		const path = { tenantId, courseId };
		let lesson = existingLessons.find((l) => l.title === spec.title && l.moduleId === moduleId);
		if (!lesson) {
			({ data: lesson } = await createLesson({
				throwOnError: true,
				path,
				body: { title: spec.title, description: spec.description, moduleId, position },
			}));
			created++;
		}
		position++;
		await ensureStatus(lesson, spec.draft, updateLesson, { ...path, lessonId: lesson.id });

		const activityPath = { ...path, lessonId: lesson.id };
		const existing = await all(listActivities, activityPath);
		for (const [index, activitySpec] of spec.activities.entries()) {
			let activity = existing.find((a) => a.title === activitySpec.title);
			if (!activity) {
				({ data: activity } = await createActivity({
					throwOnError: true,
					path: activityPath,
					body: {
						title: activitySpec.title,
						type: activitySpec.type,
						config: activitySpec.config,
						position: index,
					},
				}));
				created++;
			}
			// An activity added to the demo later goes where the demo puts it.
			if (activity.position !== index) {
				await updateActivity({
					throwOnError: true,
					path: { ...activityPath, activityId: activity.id },
					body: { position: index },
				});
			}
			await ensureStatus(activity, spec.draft || activitySpec.draft, updateActivity, {
				...activityPath,
				activityId: activity.id,
			});
		}
	}
	return position;
}

async function seedCourse(spec) {
	const found = await listCourses({
		throwOnError: true,
		path: { tenantId },
		query: { slug: spec.slug, limit: 1 },
	});
	let course = found.data.data[0];
	if (!course) {
		({ data: course } = await createCourse({
			throwOnError: true,
			path: { tenantId },
			body: { title: spec.title, slug: spec.slug, description: spec.description },
		}));
		created++;
	}
	// Tags, duration and picture are kept as the demo describes them.
	const fields = {
		tags: spec.tags ?? [],
		estimatedMinutes: spec.estimatedMinutes ?? null,
		imageUrl: spec.imageUrl ?? null,
	};
	if (
		JSON.stringify(course.tags) !== JSON.stringify(fields.tags) ||
		course.estimatedMinutes !== fields.estimatedMinutes ||
		course.imageUrl !== fields.imageUrl
	) {
		({ data: course } = await updateCourse({
			throwOnError: true,
			path: { tenantId, courseId: course.id },
			body: fields,
		}));
	}
	const path = { tenantId, courseId: course.id };
	const existingLessons = await all(listLessons, path);
	const existingModules = await all(listModules, path);

	// Lessons are numbered across the whole course: loose lessons first.
	let position = await seedLessons(course.id, null, spec.lessons, existingLessons, 0);
	for (const [index, moduleSpec] of spec.modules.entries()) {
		let module = existingModules.find((m) => m.title === moduleSpec.title);
		if (!module) {
			({ data: module } = await createModule({
				throwOnError: true,
				path,
				body: { title: moduleSpec.title, description: moduleSpec.description, position: index },
			}));
			created++;
		}
		await ensureStatus(module, moduleSpec.draft, updateModule, { ...path, moduleId: module.id });
		position = await seedLessons(
			course.id,
			module.id,
			moduleSpec.lessons,
			existingLessons,
			position,
		);
	}

	// Published last, so a half-seeded course is never on the site.
	await ensureStatus(course, spec.draft, updateCourse, path);
	console.log(`  ${spec.draft ? "draft    " : "published"}  /courses/${spec.slug}  ${spec.title}`);
}

console.log(`Seeding tenant ${tenantId} (${environment}) at ${baseUrl}`);
try {
	for (const spec of courses) await seedCourse(spec);
} catch (error) {
	fail("seed the demo course", error);
}
console.log(
	created === 0
		? "Nothing to add: the demo content was already there."
		: `Done: ${created} item${created === 1 ? "" : "s"} created.`,
);
