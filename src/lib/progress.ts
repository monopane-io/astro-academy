import { type OutlineSection, type Progress, listLessonActivities } from "./monopane";

export interface LessonState {
	total: number;
	done: number;
}

export function isDone(record: Progress | undefined): boolean {
	return record?.status === "completed";
}

/**
 * How far the learner is through each lesson of a course: activities done out
 * of activities published. One request per lesson the first time; lesson
 * content is cached for a minute after that (see monopane.ts).
 */
export async function lessonStates(
	courseId: string,
	sections: OutlineSection[],
	progress: Map<string, Progress>,
): Promise<Map<string, LessonState>> {
	const lessons = sections.flatMap((section) => section.lessons);
	const states = await Promise.all(
		lessons.map(async (lesson) => {
			const activities = await listLessonActivities(courseId, lesson.id);
			const done = activities.filter((activity) => isDone(progress.get(activity.id))).length;
			return [lesson.id, { total: activities.length, done }] as const;
		}),
	);
	return new Map(states);
}

export function totals(states: Map<string, LessonState>): LessonState {
	let total = 0;
	let done = 0;
	for (const state of states.values()) {
		total += state.total;
		done += state.done;
	}
	return { total, done };
}
