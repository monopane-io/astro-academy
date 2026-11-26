import { describe, expect, it } from "vitest";
import { AdminRequestFailed } from "../../src/lib/admin/api";
import { moved, questionFromForm, slugFrom } from "../../src/lib/admin/content";

const form = (fields: Record<string, string>) => {
	const data = new FormData();
	for (const [name, value] of Object.entries(fields)) data.set(name, value);
	return data;
};

describe("a course's address, from its title", () => {
	it("is small letters, numbers and hyphens", () => {
		expect(slugFrom("Getting started!")).toBe("getting-started");
		expect(slugFrom("  Week 1: the  basics ")).toBe("week-1-the-basics");
		expect(slugFrom("Café & crème")).toBe("cafe-creme");
		expect(slugFrom("???")).toBe("");
		expect(slugFrom("x".repeat(200)).length).toBe(80);
	});
});

describe("moving something up or down a list", () => {
	it("swaps it with its neighbour, and leaves the ends alone", () => {
		expect(moved(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
		expect(moved(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
		expect(moved(["a", "b", "c"], "a", "up")).toEqual(["a", "b", "c"]);
		expect(moved(["a", "b", "c"], "c", "down")).toEqual(["a", "b", "c"]);
		expect(moved(["a", "b", "c"], "missing", "up")).toEqual(["a", "b", "c"]);
	});
});

describe("a quiz question, from the editor's form", () => {
	it("is stored in the shape of its kind", () => {
		const fields = { text: " Which? ", options: "One\n\n Two \r\nThree", answers: "Two\nThree" };
		expect(questionFromForm(form(fields), "q1", "multiple_choice")).toEqual({
			id: "q1",
			type: "multiple_choice",
			text: "Which?",
			options: ["One", "Two", "Three"],
			correctAnswer: "Two",
		});
		expect(questionFromForm(form(fields), "q1", "multi_select")).toMatchObject({
			type: "multi_select",
			correctAnswers: ["Two", "Three"],
		});
		expect(questionFromForm(form(fields), "q1", "fill_in_blank")).toEqual({
			id: "q1",
			type: "fill_in_blank",
			text: "Which?",
			acceptedAnswers: ["Two", "Three"],
		});
		expect(questionFromForm(form(fields), "q1", "short_answer")).toMatchObject({
			acceptedPatterns: ["Two", "Three"],
		});
	});

	it("refuses a kind it does not know", () => {
		expect(() => questionFromForm(form({ text: "x" }), "q1", "essay")).toThrow(AdminRequestFailed);
	});
});
