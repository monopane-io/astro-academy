import { describe, expect, it } from "vitest";
import { answersFromForm, fieldName, passingThreshold, readQuestions } from "../../src/lib/quiz";

const config = {
	passingThreshold: 0.6,
	questions: [
		{ id: "q1", type: "multiple_choice", text: "One?", options: ["a", "b"] },
		{ id: "q2", type: "multi_select", text: "Some?", options: ["x", "y", "z"] },
		{ id: "q3", type: "fill_in_blank", text: "Fill ___" },
		{ id: "q4", type: "short_answer", text: "Explain" },
		{ id: "q5", type: "essay", text: "A kind this site does not know" },
		"not a question",
	],
};

function form(entries: [string, string][]): FormData {
	const data = new FormData();
	for (const [name, value] of entries) data.append(name, value);
	return data;
}

describe("readQuestions", () => {
	it("reads the four kinds and skips what it does not recognise", () => {
		const questions = readQuestions(config);
		expect(questions.map((q) => q.type)).toEqual([
			"multiple_choice",
			"multi_select",
			"fill_in_blank",
			"short_answer",
		]);
		expect(questions[0]?.options).toEqual(["a", "b"]);
		expect(questions[2]?.options).toEqual([]);
	});

	it("copes with a config that has no questions", () => {
		expect(readQuestions({})).toEqual([]);
		expect(passingThreshold({})).toBe(0.7);
		expect(passingThreshold(config)).toBe(0.6);
	});
});

describe("answersFromForm", () => {
	const questions = readQuestions(config);

	it("turns a filled-in form into Monopane answers", () => {
		const answers = answersFromForm(
			questions,
			form([
				[fieldName("q1"), "b"],
				[fieldName("q2"), "x"],
				[fieldName("q2"), "z"],
				[fieldName("q3"), "  blank  "],
				[fieldName("q4"), "because"],
			]),
		);
		expect(answers).toEqual([
			{ questionId: "q1", type: "multiple_choice", answer: "b" },
			{ questionId: "q2", type: "multi_select", answers: ["x", "z"] },
			{ questionId: "q3", type: "fill_in_blank", answer: "blank" },
			{ questionId: "q4", type: "short_answer", answer: "because" },
		]);
	});

	it("answers every question, blank where the user left one out", () => {
		expect(answersFromForm(questions, form([]))).toEqual([
			{ questionId: "q1", type: "multiple_choice", answer: "" },
			{ questionId: "q2", type: "multi_select", answers: [] },
			{ questionId: "q3", type: "fill_in_blank", answer: "" },
			{ questionId: "q4", type: "short_answer", answer: "" },
		]);
	});

	it("ignores choices the question does not offer and trims over-long text", () => {
		const answers = answersFromForm(
			questions,
			form([
				[fieldName("q1"), "made up"],
				[fieldName("q2"), "x"],
				[fieldName("q2"), "made up"],
				[fieldName("q3"), "a".repeat(900)],
				[fieldName("q4"), "b".repeat(5000)],
			]),
		);
		expect(answers[0]).toEqual({ questionId: "q1", type: "multiple_choice", answer: "" });
		expect(answers[1]).toEqual({ questionId: "q2", type: "multi_select", answers: ["x"] });
		expect((answers[2] as { answer: string }).answer).toHaveLength(500);
		expect((answers[3] as { answer: string }).answer).toHaveLength(2000);
	});
});
