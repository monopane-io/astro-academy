import { expect, test } from "@playwright/test";

/**
 * The admin area, against a real Monopane API: someone who runs the project
 * signs in with their Monopane account and sees every course, drafts
 * included. Along the way: the token that lets them never reaches the
 * browser, a form sent from elsewhere is refused, and a visitor who is not
 * signed in sees nothing an admin does.
 *
 * It needs a person to sign in as: MONOPANE_ADMIN_EMAIL and
 * MONOPANE_ADMIN_PASSWORD, someone with access to the project, and the site's
 * address added to the project's sign-in addresses. Without them the test is
 * skipped; everything else still runs.
 */

const EMAIL = process.env.MONOPANE_ADMIN_EMAIL ?? "";
const PASSWORD = process.env.MONOPANE_ADMIN_PASSWORD ?? "";
const API_URL = process.env.MONOPANE_API_URL ?? "https://api.monopane.io";
const DRAFT = "/courses/unpublished-course";

test.describe.configure({ mode: "serial" });

test("nobody reaches the admin area without signing in", async ({ page, request }) => {
	const response = await request.get("/admin", { maxRedirects: 0 });
	expect(response.status()).toBe(302);
	expect(response.headers().location).toBe("/admin/sign-in?next=%2Fadmin");
	expect(response.headers()["cache-control"]).toBe("private, no-store");
	expect(response.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");

	// Signing in is started at Monopane, with PKCE and a state, and this site's own callback.
	const start = await request.get("/admin/sign-in", { maxRedirects: 0 });
	const authorize = new URL(start.headers().location ?? "");
	expect(authorize.origin).toBe(new URL(API_URL).origin);
	expect(authorize.pathname).toBe("/oauth/authorize");
	expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
	expect(authorize.searchParams.get("state")).toBeTruthy();
	expect(authorize.searchParams.get("redirect_uri")).toMatch(/\/admin\/callback$/);

	// A reply nobody asked for signs nobody in.
	await page.goto("/admin/callback?code=made-up&state=made-up");
	await expect(page.locator("[data-admin-sign-in-failed=expired]")).toBeVisible();
	await page.goto("/admin");
	await expect(page).not.toHaveURL(/\/admin$/);

	// A form sent from another site is refused before anything else happens.
	const forged = await request.post("/admin/sign-out", {
		headers: { Origin: "https://evil.example" },
		maxRedirects: 0,
	});
	expect(forged.status()).toBe(403);
});

test("an admin signs in with Monopane and sees every course, drafts included", async ({
	page,
	context,
	browser,
}) => {
	test.skip(!EMAIL || !PASSWORD, "MONOPANE_ADMIN_EMAIL and MONOPANE_ADMIN_PASSWORD are not set");

	const sitePages: string[] = [];
	page.on("response", async (response) => {
		if (new URL(response.url()).origin !== new URL(page.url() || "http://x").origin) return;
		if (!(response.headers()["content-type"] ?? "").includes("text/html")) return;
		const html = await response.text().catch(() => null);
		if (html) sitePages.push(html);
	});

	// --- Sign in at Monopane --------------------------------------------------
	await page.goto("/admin");
	await expect(page).toHaveURL(new RegExp(`^${API_URL.replace(/[.]/g, "\\.")}/oauth/authorize`));
	await page.getByLabel("Email").fill(EMAIL);
	await page.getByLabel("Password").fill(PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	// Monopane says which project and which site, and what the site may do.
	const site = new URL(process.env.SITE_URL ?? "http://127.0.0.1:4321").origin;
	await expect(page.getByText(site)).toBeVisible();
	await expect(page.getByText(/see users and their progress/)).toBeVisible();
	await page.getByRole("button", { name: "Allow" }).click();

	// --- The admin area -------------------------------------------------------
	await expect(page).toHaveURL(/\/admin$/);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Courses");
	await expect(page.locator("[data-admin-summary]")).toHaveText(/^\d+ published, \d+ in draft\.$/);
	const published = page.locator("[data-admin-course=academy-tour]");
	await expect(published.locator("[data-state]")).toHaveText("Published");
	await expect(published.getByRole("link", { name: "View" })).toHaveAttribute(
		"href",
		"/courses/academy-tour",
	);
	const draft = page.locator("[data-admin-course=unpublished-course]");
	await expect(draft.locator("[data-state]")).toHaveText("Draft");
	await expect(draft.getByRole("link", { name: "View" })).toHaveCount(0);
	await expect(page.locator("[data-admin-time-left]")).toContainText("more minutes");

	// --- What the browser holds -----------------------------------------------
	const cookies = await context.cookies();
	const admin = cookies.find((cookie) => /(^|-)admin$/.test(cookie.name));
	expect(admin, "the admin cookie").toBeTruthy();
	expect(admin?.httpOnly).toBe(true);
	expect(admin?.sameSite).toBe("Lax");
	expect(admin?.domain.startsWith(".")).toBe(false);
	// The token is in no cookie as it stands, in no page, and not in the address bar.
	for (const cookie of cookies) expect(cookie.value, cookie.name).not.toMatch(/mpa_/);
	expect(cookies.some((cookie) => cookie.name.includes("admin_start"))).toBe(false);
	await page.reload();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Courses");
	expect(sitePages.length).toBeGreaterThan(0);
	for (const html of sitePages) {
		expect(html).not.toMatch(/mpa_[0-9a-f]{8}/);
		expect(html).not.toMatch(/mpk_(live|test)_/);
	}
	expect(await page.evaluate(() => document.cookie)).not.toContain("admin");

	// --- An admin's view does not leak to anyone else ---------------------------
	// The admin has now read the draft through Monopane. A visitor still cannot.
	const stranger = await browser.newContext();
	const visitor = await stranger.newPage();
	expect((await visitor.goto(DRAFT))?.status()).toBe(404);
	await visitor.goto("/");
	await expect(visitor.getByText("Unpublished")).toHaveCount(0);
	expect((await stranger.request.get("/admin", { maxRedirects: 0 })).status()).toBe(302);
	await stranger.close();
	// Being an admin is not being a user: the user pages still ask for sign-in.
	await page.goto("/my-learning");
	await expect(page).toHaveURL(/\/sign-in\?next=/);

	// --- Leave ----------------------------------------------------------------
	await page.goto("/admin");
	const token = admin?.value ?? "";
	await page.getByRole("button", { name: "Leave admin" }).click();
	await expect(page).toHaveURL(/\/$/);
	expect((await context.cookies()).some((cookie) => /(^|-)admin$/.test(cookie.name))).toBe(false);
	// The old cookie is worth nothing now: the token behind it was ended at Monopane.
	const replay = await browser.newContext();
	await replay.addCookies([
		{ name: admin?.name ?? "admin", value: token, url: site, httpOnly: true, sameSite: "Lax" },
	]);
	const replayed = await replay.newPage();
	await replayed.goto("/admin");
	await expect(replayed).not.toHaveURL(/\/admin$/);
	await replay.close();
});

/** Sign in at Monopane from /admin and land back in the admin area. */
async function signInAsAdmin(page: import("@playwright/test").Page) {
	await page.goto("/admin");
	await page.getByLabel("Email").fill(EMAIL);
	await page.getByLabel("Password").fill(PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.getByRole("button", { name: "Allow" }).click();
	await expect(page).toHaveURL(/\/admin$/);
}

test("an admin builds a course in the editor, and a learner takes it", async ({
	page,
	browser,
}) => {
	test.skip(!EMAIL || !PASSWORD, "MONOPANE_ADMIN_EMAIL and MONOPANE_ADMIN_PASSWORD are not set");
	const title = `Onboarding ${Date.now()}`;
	const slug = title.toLowerCase().replace(/ /g, "-");
	const done = page.locator("[data-admin-done]");

	await signInAsAdmin(page);

	// --- A new course starts as a draft ---------------------------------------
	await page.getByLabel("Course title").fill(title);
	await page.getByLabel("What it covers (optional)").fill("Your first week.");
	await page.getByRole("button", { name: "Create course" }).click();
	await expect(page).toHaveURL(/\/admin\/courses\/crs_/);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
	await expect(page.locator("[data-course-state]")).toHaveText("Draft");
	await expect(page.getByLabel("Address")).toHaveValue(slug);
	const courseUrl = page.url().split("?")[0] ?? "";

	// --- About the course -----------------------------------------------------
	await page.getByLabel("Topics").fill("Onboarding, Basics");
	await page.getByLabel("How long it takes, in minutes").fill("15");
	await page.getByRole("button", { name: "Save course" }).click();
	await expect(done).toHaveText("Course saved");
	await expect(page.getByLabel("Topics")).toHaveValue("Onboarding, Basics");

	// --- A module and two lessons ---------------------------------------------
	await page.getByLabel("Module title").fill("Week one");
	await page.getByRole("button", { name: "Add module" }).click();
	await expect(done).toHaveText("Module added");

	await page.getByLabel("New lesson in Week one").fill("Day one");
	await page.getByRole("button", { name: "Add lesson" }).last().click();
	await expect(page).toHaveURL(/\/lessons\/lsn_/);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Day one");
	const lessonUrl = page.url().split("?")[0] ?? "";
	const lessonId = lessonUrl.split("/").pop() ?? "";

	// --- Activities: a reading, a link, a quiz --------------------------------
	await page.locator("[data-add=reading] summary").click();
	await page.getByLabel("Reading title").fill("Welcome aboard");
	await page.getByLabel("Reading text").fill("# Hello\n\nThis is **your** first day.");
	await page.getByRole("button", { name: "Add reading" }).click();
	await expect(done).toHaveText("Reading added as a draft");

	await page.locator("[data-add=external_link] summary").click();
	await page.getByLabel("Link title").fill("The handbook");
	await page.getByLabel("Link address").fill("https://example.com/handbook");
	await page.getByRole("button", { name: "Add link" }).click();
	await expect(done).toHaveText("Link added as a draft");

	await page.locator("[data-add=quiz] summary").click();
	await page.getByLabel("Quiz title").fill("Check in");
	await page.getByLabel("Score needed to pass, in percent").last().fill("100");
	await page.getByLabel("First question", { exact: true }).fill("Which day is this?");
	await page.getByLabel("First question's choices, one per line").fill("Day one\nDay two");
	// A right answer that is not one of the choices is refused, with the reason.
	await page.getByLabel("First question's right answers, one per line").fill("Day three");
	await page.getByRole("button", { name: "Add quiz" }).click();
	await expect(page.locator("[data-admin-error]")).toContainText("is not one of the choices");
	await expect(page.locator("[data-admin-activity=quiz]")).toHaveCount(0);

	await page.locator("[data-add=quiz] summary").click();
	await page.getByLabel("Quiz title").fill("Check in");
	await page.getByLabel("Score needed to pass, in percent").last().fill("100");
	await page.getByLabel("First question", { exact: true }).fill("Which day is this?");
	await page.getByLabel("First question's choices, one per line").fill("Day one\nDay two");
	await page.getByLabel("First question's right answers, one per line").fill("Day one");
	await page.getByRole("button", { name: "Add quiz" }).click();
	await expect(done).toHaveText("Quiz added as a draft");

	// A second question, of another kind.
	const quiz = page.locator("[data-admin-activity=quiz]");
	await quiz.locator("details summary").click();
	await quiz.getByLabel("Kind of question").selectOption("fill_in_blank");
	await quiz.getByLabel("New question").fill("A course is made of ___.");
	await quiz.getByLabel("Right answers, one per line").fill("lessons\nlesson");
	await quiz.getByRole("button", { name: "Add question" }).click();
	await expect(done).toHaveText("Quiz saved");
	await expect(quiz.locator("[data-admin-question]")).toHaveCount(2);

	// Edit the reading, and move the link above it.
	const reading = page.locator("[data-admin-activity=reading]");
	await reading.getByLabel("Title").fill("Welcome");
	await reading.getByRole("button", { name: "Save reading" }).click();
	await expect(done).toHaveText("Reading saved");
	await page.getByRole("button", { name: "Move up: The handbook" }).click();
	await expect(done).toHaveText("Activity moved");
	await expect(page.locator("[data-admin-activity]").first()).toHaveAttribute(
		"data-admin-activity",
		"external_link",
	);

	// --- Nothing is visible to a learner yet ----------------------------------
	const learnerContext = await browser.newContext();
	const learner = await learnerContext.newPage();
	expect((await learner.goto(`/courses/${slug}`))?.status()).toBe(404);

	// --- Publish everything ---------------------------------------------------
	await page.goto(courseUrl);
	await expect(page.locator("[data-admin-lesson='Day one'] [data-state]")).toHaveText("Draft");
	await page.getByRole("button", { name: "Publish everything" }).click();
	await expect(done).toHaveText("The course and everything in it is published");
	await expect(page.locator("[data-course-state]")).toHaveText("Published");
	await expect(page.locator("[data-admin-lesson='Day one'] [data-state]")).toHaveText("Published");
	await expect(page.getByRole("link", { name: "View as a user" })).toHaveAttribute(
		"href",
		`/courses/${slug}`,
	);

	// --- A learner takes it ---------------------------------------------------
	// Publishing made the site forget what it remembered about courses, so the
	// learner sees the course at once (it was "not found" a moment ago).
	await learner.goto(`/sign-in?next=${encodeURIComponent(`/courses/${slug}`)}`);
	await learner.getByLabel("Your name").fill("Grace Hopper");
	await learner.getByLabel("Email address").fill(`grace-${Date.now()}@example.com`);
	await learner.getByRole("button", { name: "Sign in" }).click();
	await expect(learner.getByRole("heading", { level: 1 })).toHaveText(title);
	await expect(learner.getByText("Week one", { exact: true })).toBeVisible();
	await learner.getByRole("button", { name: "Enrol in this course" }).click();
	await expect(learner.locator("[data-course-progress]")).toContainText("0 of 3 activities done");
	await learner.getByRole("link", { name: "Start the course" }).click();
	await expect(learner).toHaveURL(new RegExp(`/courses/${slug}/${lessonId}$`));
	// In the order the admin left them: the link, then the reading, then the quiz.
	const types = await learner
		.locator("[data-activity]")
		.evaluateAll((items) => items.map((item) => item.getAttribute("data-activity")));
	expect(types).toEqual(["external_link", "reading", "quiz"]);
	await expect(learner.locator("[data-activity=reading]")).toContainText("your first day");
	await expect(learner.locator("[data-activity=reading] strong")).toHaveText("your");
	const learnerQuiz = learner.locator("[data-activity=quiz]");
	await learnerQuiz.getByLabel("Day one").check();
	await learnerQuiz.getByRole("textbox", { name: /A course is made of/ }).fill("Lessons");
	await learnerQuiz.getByRole("button", { name: "Submit answers" }).click();
	await expect(learnerQuiz.locator("[data-quiz-result=passed]")).toContainText("You scored 100%");
	// The answer keys the admin typed never reach the learner's page.
	expect(await learner.content()).not.toMatch(/correctAnswer|acceptedAnswers/);
	// A learner is offered nothing of the admin's.
	await expect(learner.locator("[data-admin-edit]")).toHaveCount(0);
	expect((await learnerContext.request.get("/admin/users", { maxRedirects: 0 })).status()).toBe(
		302,
	);
	await learnerContext.close();

	// --- The admin sees the learner and how they are doing --------------------
	await page.getByRole("link", { name: "Users" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Users");
	await page.getByRole("link", { name: "Grace Hopper" }).first().click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Grace Hopper");
	const enrollment = page.locator(`[data-admin-enrollment="${title}"]`);
	await expect(enrollment.locator("[data-state]")).toHaveText("In progress");
	await expect(enrollment).toContainText("1 activity done");
	// Reading only: the page has no form but the one for leaving the admin area.
	await expect(page.locator("main form")).toHaveCount(1);

	// --- From the learner pages, an admin can go straight to editing ----------
	await page.goto(`/courses/${slug}`);
	await expect(page.getByRole("link", { name: "Edit this course" })).toHaveAttribute(
		"href",
		courseUrl.replace(/^https?:\/\/[^/]+/, ""),
	);

	// --- The admin sees the enrolment, then takes the course down -------------
	await page.goto(courseUrl);
	await expect(page.locator("[data-course-numbers]")).toHaveText("1 enrolled, 0 completed");
	await page.getByRole("button", { name: "Move back to draft" }).click();
	await expect(done).toHaveText("Course moved back to draft");
	await expect(page.locator("[data-course-state]")).toHaveText("Draft");

	// --- Delete it ------------------------------------------------------------
	// Deleting needs the box ticked: the browser will not send the form without it.
	await page.getByRole("button", { name: "Delete course" }).click();
	expect(page.url().startsWith(courseUrl)).toBe(true);
	await page.getByLabel(`Yes, delete ${title}`).check();
	await page.getByRole("button", { name: "Delete course" }).click();
	await expect(page).toHaveURL(/\/admin\?done=/);
	await expect(done).toHaveText("Course deleted");
	await expect(page.locator(`[data-admin-course="${slug}"]`)).toHaveCount(0);
	await page.getByRole("button", { name: "Leave admin" }).click();
});
