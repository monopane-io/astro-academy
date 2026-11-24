/**
 * Quizzes as the site shows them. Questions arrive from Monopane without
 * their answer keys (see listLessonActivities), are drawn as a plain HTML
 * form, and the answers are posted back to Monopane to be graded.
 */
import type { SubmissionAnswer } from "@monopane/sdk";

export type QuestionType = "multiple_choice" | "multi_select" | "fill_in_blank" | "short_answer";

export interface Question {
	id: string;
	type: QuestionType;
	text: string;
	/** Choices, for multiple_choice and multi_select. */
	options: string[];
}

const TYPES: readonly string[] = [
	"multiple_choice",
	"multi_select",
	"fill_in_blank",
	"short_answer",
];

/** The questions of a quiz activity's config. Anything unrecognised is skipped. */
export function readQuestions(config: Record<string, unknown>): Question[] {
	const raw = config.questions;
	if (!Array.isArray(raw)) return [];
	const questions: Question[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const q = item as Record<string, unknown>;
		if (typeof q.id !== "string" || typeof q.text !== "string") continue;
		if (typeof q.type !== "string" || !TYPES.includes(q.type)) continue;
		questions.push({
			id: q.id,
			type: q.type as QuestionType,
			text: q.text,
			options: Array.isArray(q.options) ? q.options.filter((o) => typeof o === "string") : [],
		});
	}
	return questions;
}

export function passingThreshold(config: Record<string, unknown>): number {
	return typeof config.passingThreshold === "number" ? config.passingThreshold : 0.7;
}

/** The name of the form field that holds the answer to a question. */
export function fieldName(questionId: string): string {
	return `answer:${questionId}`;
}

/**
 * Read a submitted quiz form into the answers Monopane expects. Every question
 * gets an answer; one left blank is sent blank, and is marked wrong.
 */
export function answersFromForm(questions: Question[], form: FormData): SubmissionAnswer[] {
	return questions.map((question): SubmissionAnswer => {
		const values = form
			.getAll(fieldName(question.id))
			.filter((value): value is string => typeof value === "string");
		if (question.type === "multi_select") {
			// Only choices the question offers count.
			const chosen = values.filter((value) => question.options.includes(value)).slice(0, 10);
			return { questionId: question.id, type: "multi_select", answers: chosen };
		}
		const first = (values[0] ?? "").trim();
		if (question.type === "multiple_choice") {
			return {
				questionId: question.id,
				type: "multiple_choice",
				answer: question.options.includes(first) ? first : "",
			};
		}
		if (question.type === "fill_in_blank") {
			return { questionId: question.id, type: "fill_in_blank", answer: first.slice(0, 500) };
		}
		return { questionId: question.id, type: "short_answer", answer: first.slice(0, 2000) };
	});
}
