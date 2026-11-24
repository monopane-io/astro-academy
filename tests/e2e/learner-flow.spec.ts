import { type Page, expect, test } from "@playwright/test";

/**
 * The whole learner journey against a real Monopane API, in demo mode:
 * catalogue, sign in, enrol, reading, quiz, completion, credential.
 *
 * The API key (if the test is told it) and the quiz answers must never reach
 * the browser, and the browser must never call the Monopane API. Both are
 * checked on every page the journey visits.
 */

const API_KEY = process.env.MONOPANE_API_KEY ?? "";
const API_URL = process.env.MONOPANE_API_URL ?? "https://api.monopane.io";
const COURSE = "/courses/academy-tour";

/** Text that only exists in the quiz's answer keys (see seed/demo-course.mjs). */
const ANSWER_KEY_FIELDS = [
	"correctAnswer",
	"correctAnswers",
	"acceptedAnswers",
	"acceptedPatterns",
];

const requests: string[] = [];
const pagesSeen: { url: string; html: string }[] = [];

function watch(page: Page) {
	page.on("request", (request) => requests.push(request.url()));
	page.on("load", async () => {
		pagesSeen.push({ url: page.url(), html: await page.content() });
	});
}

test.describe.configure({ mode: "serial" });

test("a signed-out visitor can browse, and is asked to sign in for a lesson", async ({ page }) => {
	watch(page);
	await page.goto("/");
	await expect(page.getByRole("heading", { level: 2, name: "Courses" })).toBeVisible();
	// "My learning" is for signed-in learners.
	await expect(page.getByRole("link", { name: "My learning" })).toHaveCount(0);
	await expect(page.getByRole("link", { name: "A tour of this academy" })).toBeVisible();
	// Drafts are not listed.
	await expect(page.getByText("Unpublished")).toHaveCount(0);
	// The tile shows the course's topic and how long it takes.
	const tile = page.locator("[data-course-tile]").filter({ hasText: "A tour of this academy" });
	await expect(tile.locator("[data-course-duration]")).toHaveText("10 min");
	await expect(tile.getByRole("link", { name: "Getting started" })).toBeVisible();
	// The catalogue can be narrowed to a topic; an unknown topic shows everything.
	await page
		.getByRole("navigation", { name: "Filter courses by topic" })
		.getByRole("link", { name: "Getting started" })
		.click();
	await expect(page).toHaveURL(/\?tag=Getting(%20|\+)started/);
	await expect(page.getByRole("heading", { level: 2 })).toHaveText("Courses: Getting started");
	await expect(page.locator("[data-course-tile]")).toHaveCount(1);
	await page.goto("/?tag=No-such-topic");
	await expect(page.getByRole("heading", { level: 2 })).toHaveText("Courses");
	await page.goto("/");
	// Demo mode says so on every page.
	await expect(page.locator("[data-demo-notice]")).toContainText("Not for production");

	await page.getByRole("link", { name: "A tour of this academy" }).click();
	await expect(page).toHaveURL(COURSE);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("A tour of this academy");
	await expect(page.getByText("Welcome", { exact: true })).toBeVisible();
	await expect(page.getByText("Quizzes", { exact: true })).toBeVisible();
	await expect(page.getByText("Unpublished")).toHaveCount(0);
	await expect(page.locator("[data-demo-notice]")).toBeVisible();

	// Enrolling needs an account: the visitor is sent to sign in and brought back.
	await page.getByRole("button", { name: "Enrol in this course" }).click();
	await expect(page).toHaveURL(/\/sign-in\?next=/);
});

test("drafts are not reachable by address", async ({ page }) => {
	const course = await page.goto("/courses/unpublished-course");
	expect(course?.status()).toBe(404);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");

	const lesson = await page.goto(`${COURSE}/lsn_doesnotexist000000000000`);
	expect(lesson?.status()).toBe(404);
});

test("the learner flow, from sign-in to a verified credential", async ({ page, browser }) => {
	watch(page);
	// A new learner each run, so the test can be repeated against one tenant.
	const email = `learner-${Date.now()}@example.com`;

	// --- Sign in (demo mode) -------------------------------------------------
	await page.goto(`/sign-in?next=${encodeURIComponent(COURSE)}`);
	await expect(page.locator("[data-demo-notice]")).toBeVisible();
	await page.getByLabel("Your name").fill("Ada Lovelace");
	await page.getByLabel("Email address").fill(email);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(COURSE);
	await expect(page.locator("[data-signed-in-as]")).toHaveText("Ada Lovelace");

	// --- Enrol, twice --------------------------------------------------------
	await page.getByRole("button", { name: "Enrol in this course" }).click();
	await expect(page).toHaveURL(COURSE);
	await expect(page.locator("[data-course-progress]")).toContainText("0 of 6 activities done");
	// Posting the enrol form again (a double click, a resubmitted form) is harmless.
	const again = await page.request.post(COURSE, {
		headers: { Origin: new URL(page.url()).origin },
		form: {},
	});
	expect(again.ok()).toBe(true);
	await page.reload();
	await expect(page.locator("[data-course-progress]")).toContainText("0 of 6 activities done");

	// --- A reading -----------------------------------------------------------
	await page.getByRole("link", { name: "Start the course" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome");
	const reading = page.locator("[data-activity=reading]").first();
	await expect(reading.locator("[data-state]")).toHaveText("Not done");
	await expect(reading).toContainText("This site is an academy");
	await reading.getByRole("button", { name: "Mark as read" }).click();
	await expect(reading.locator("[data-state]")).toHaveText("Done");
	// It is recorded in Monopane, not in the page: a reload still shows it done.
	await page.reload();
	await expect(reading.locator("[data-state]")).toHaveText("Done");
	await expect(reading.getByRole("button", { name: "Mark as read" })).toHaveCount(0);

	// --- A video -------------------------------------------------------------
	const video = page.locator("[data-activity=video]");
	await expect(video.locator("[data-state]")).toHaveText("Not watched");
	// A YouTube address is shown in YouTube's no-cookie player, on the page.
	await expect(video.locator("iframe")).toHaveAttribute(
		"src",
		"https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ",
	);
	await video.getByRole("button", { name: "Mark as watched" }).click();
	await expect(video.locator("[data-state]")).toHaveText("Watched");

	// --- A link --------------------------------------------------------------
	const link = page.locator("[data-activity=external_link]");
	await expect(link.getByRole("link", { name: "https://monopane.io" })).toBeVisible();
	await link.getByRole("button", { name: "Mark as done" }).click();
	await expect(link.locator("[data-state]")).toHaveText("Done");

	await page.goto(COURSE);
	await expect(page.locator("[data-course-progress]")).toContainText("3 of 6 activities done");
	await expect(page.locator("[data-lesson-state=done]")).toHaveCount(1);

	// --- My learning, part way through ---------------------------------------
	await page.getByRole("link", { name: "My learning" }).click();
	await expect(page).toHaveURL("/my-learning");
	const inProgress = page.locator("[data-in-progress]");
	await expect(inProgress).toContainText("A tour of this academy");
	await expect(inProgress).toContainText("3 of 6 activities done");
	await expect(page.locator("[data-completed]")).toHaveCount(0);
	// "Continue" goes to the first lesson that is not finished.
	await inProgress.getByRole("link", { name: "Continue" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Quizzes");
	// The curriculum beside the lesson shows where the learner is and what is done.
	const curriculum = page.getByRole("complementary", { name: "Course contents" });
	await expect(curriculum.getByRole("link", { name: "Quizzes" })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await expect(curriculum.locator("[data-lesson-state=done]")).toHaveCount(1);
	await page.goto(COURSE);

	// --- The quiz: fail, then pass -------------------------------------------
	await page.getByRole("link", { name: "Quizzes" }).click();
	await page
		.locator("[data-activity=reading]")
		.getByRole("button", { name: "Mark as read" })
		.click();
	const quiz = page.locator("[data-activity=quiz]");
	await expect(quiz.locator("[data-state]")).toHaveText("Not attempted");
	// All four kinds of question are drawn.
	for (const kind of ["multiple_choice", "multi_select", "fill_in_blank", "short_answer"]) {
		await expect(quiz.locator(`[data-question=${kind}]`)).toHaveCount(1);
	}

	// A wrong attempt.
	await quiz.getByLabel("Modules").check();
	await quiz.getByLabel("Webinar").check();
	await quiz.getByRole("textbox", { name: /A course is complete/ }).fill("module");
	await quiz.getByRole("textbox", { name: /In a few words/ }).fill("Nothing at all");
	await quiz.getByRole("button", { name: "Submit answers" }).click();
	await expect(quiz.locator("[data-quiz-result=failed]")).toContainText("You scored 0%");
	await expect(quiz.locator("[data-quiz-result=failed]")).toContainText("You need 75% to pass");
	await expect(quiz.locator("[data-state]").first()).toHaveText("Not passed yet");
	// The attempt is still in the form, ready to be corrected.
	await expect(quiz.getByLabel("Modules")).toBeChecked();
	await expect(quiz.getByLabel("Webinar")).toBeChecked();
	await expect(quiz.getByRole("textbox", { name: /A course is complete/ })).toHaveValue("module");
	await expect(quiz.getByRole("textbox", { name: /In a few words/ })).toHaveValue("Nothing at all");
	await quiz.getByLabel("Webinar").uncheck();

	// It can be taken again.
	await quiz.getByLabel("Activities").check();
	for (const option of ["Reading", "Quiz", "Link"])
		await quiz.getByLabel(option, { exact: true }).check();
	await quiz.getByRole("textbox", { name: /A course is complete/ }).fill("Activity");
	await quiz
		.getByRole("textbox", { name: /In a few words/ })
		.fill("You get a credential with a code");
	await quiz.getByRole("button", { name: "Submit answers again" }).click();
	await expect(quiz.locator("[data-quiz-result=passed]")).toContainText("You scored 100%");
	await expect(quiz.locator("[data-state]").first()).toHaveText("Passed");

	// --- The last activity completes the course ------------------------------
	await page.getByRole("link", { name: "Next: Your credential" }).click();
	await page.getByRole("button", { name: "Mark as read" }).click();
	await expect(page.locator("[data-course-complete]")).toBeVisible();

	// --- Completion and the credential ---------------------------------------
	await page.getByRole("link", { name: "See your certificate" }).click();
	await expect(page).toHaveURL(`${COURSE}/complete`);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"You completed A tour of this academy",
	);
	const code = (await page.locator("[data-credential-code]").innerText()).trim();
	expect(code).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
	// Coming back gives the same credential, not a second one.
	await page.reload();
	await expect(page.locator("[data-credential-code]")).toHaveText(code);

	// The certificate names the learner and the course.
	await expect(page.locator("[data-credential]")).toContainText("Ada Lovelace");
	await expect(page.locator("[data-credential]")).toContainText("A tour of this academy");

	await page.goto(COURSE);
	await expect(page.locator("[data-course-progress]")).toContainText(
		"You have completed this course",
	);
	await expect(page.locator("[data-lesson-state=done]")).toHaveCount(3);

	// --- My learning, finished -----------------------------------------------
	await page.goto("/my-learning");
	await expect(page.locator("[data-in-progress]")).toHaveCount(0);
	const finished = page.locator("[data-completed]");
	await expect(finished).toContainText("A tour of this academy");
	await expect(finished.getByRole("link", { name: "See your certificate" })).toHaveAttribute(
		"href",
		`${COURSE}/complete`,
	);
	// The home page marks it too.
	await page.goto("/");
	await expect(
		page.locator("[data-course-tile]").filter({ hasText: "A tour of this academy" }),
	).toContainText("Completed");

	// --- Anyone can verify it, signed out ------------------------------------
	const stranger = await browser.newContext();
	const verifyPage = await stranger.newPage();
	watch(verifyPage);
	await verifyPage.goto(`/credentials/${code}`);
	const valid = verifyPage.locator("[data-credential-valid]");
	await expect(valid).toContainText("A tour of this academy");
	await expect(valid).toContainText("Ada Lovelace");
	await expect(valid).toContainText(code);
	await expect(verifyPage.getByRole("heading", { level: 1 })).toHaveText(
		"This credential is valid",
	);
	// The stranger learns the name and nothing else.
	expect(await verifyPage.content()).not.toContain(email);

	const unknown = await verifyPage.goto("/credentials/AAAA-BBBB-CCCC-DDDD");
	expect(unknown?.status()).toBe(404);
	await expect(verifyPage.locator("[data-credential-invalid]")).toBeVisible();
	await stranger.close();

	// --- Sign out ------------------------------------------------------------
	await page.getByRole("button", { name: "Sign out" }).click();
	await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
	await page.goto(`${COURSE}/complete`);
	await expect(page).toHaveURL(/\/sign-in\?next=/);
	await page.goto("/my-learning");
	await expect(page).toHaveURL(/\/sign-in\?next=/);
});

test("nothing secret reached the browser", async () => {
	expect(pagesSeen.length).toBeGreaterThan(10);

	// The browser only ever talked to the academy itself.
	const apiHost = new URL(API_URL).host;
	const offSite = requests.filter((url) => new URL(url).host === apiHost);
	expect(offSite, "the browser must never call the Monopane API").toEqual([]);

	for (const { url, html } of pagesSeen) {
		expect(html, `an API key in ${url}`).not.toMatch(/mpk_(live|test)_/);
		if (API_KEY) expect(html, `the API key in ${url}`).not.toContain(API_KEY);
		for (const field of ANSWER_KEY_FIELDS) {
			expect(html, `quiz answer keys in ${url}`).not.toContain(field);
		}
	}
});
