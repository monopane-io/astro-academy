import { describe, expect, it } from "vitest";
import { openSession, safeNext, sealSession } from "../../src/lib/session";

const secret = "a".repeat(32);
const user = {
	id: "demo:ada@example.com",
	name: "Ada",
	email: "ada@example.com",
	userId: "usr_1",
};

describe("the session cookie", () => {
	it("round-trips a user", async () => {
		expect(await openSession(await sealSession(user, secret), secret)).toEqual(user);
	});

	it("opens a cookie set before userId had that name", async () => {
		const { userId, ...rest } = user;
		const old = await sealSession({ ...rest, learnerId: userId } as unknown as typeof user, secret);
		expect(await openSession(old, secret)).toEqual(user);
	});

	it("is rejected when signed with another secret", async () => {
		expect(await openSession(await sealSession(user, secret), "b".repeat(32))).toBeNull();
	});

	it("is rejected when its contents are changed", async () => {
		const [payload, signature] = (await sealSession(user, secret)).split(".");
		const forged = btoa(
			JSON.stringify({ user: { ...user, userId: "usr_someone_else" }, exp: 9999999999 }),
		).replace(/=+$/, "");
		expect(await openSession(`${forged}.${signature}`, secret)).toBeNull();
		expect(await openSession(`${payload}.${signature}x`, secret)).toBeNull();
	});

	it("expires", async () => {
		const now = Date.UTC(2026, 0, 1);
		const value = await sealSession(user, secret, now, 60);
		expect(await openSession(value, secret, now + 59_000)).toEqual(user);
		expect(await openSession(value, secret, now + 61_000)).toBeNull();
	});

	it("treats missing and malformed values as signed out", async () => {
		for (const value of [undefined, "", "abc", "a.b.c", "!!.??"]) {
			expect(await openSession(value, secret)).toBeNull();
		}
	});
});

describe("safeNext", () => {
	it("keeps paths on this site", () => {
		expect(safeNext("/courses/intro")).toBe("/courses/intro");
		expect(safeNext("/courses/intro?x=1#a")).toBe("/courses/intro?x=1#a");
	});

	it("never sends anyone to another site", () => {
		for (const next of [
			null,
			"",
			"https://evil.example",
			"//evil.example",
			"/\\evil.example",
			"javascript:alert(1)",
		]) {
			expect(safeNext(next)).toBe("/");
		}
	});
});
