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
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Overview");
	await expect(page.locator("[data-stat='Published courses'] dd").first()).toHaveText(/^\d+$/);
	await expect(page.locator("[data-stat='Users']")).toContainText("active this week");
	await page.getByRole("link", { name: "Courses", exact: true }).first().click();
	await expect(page).toHaveURL(/\/admin\/courses$/);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Courses");
	await expect(page.locator("[data-admin-summary]")).toHaveText(/^\d+ published, \d+ in draft$/);
	const published = page.locator("[data-admin-course=academy-tour]");
	await expect(published.locator("[data-state]")).toHaveText("Published");
	const draft = page.locator("[data-admin-course=unpublished-course]");
	await expect(draft.locator("[data-state]")).toHaveText("Draft");
	await expect(page.locator("aside [data-admin-time-left]")).toContainText("more minutes");
	// The sidebar says who is signed in.
	await expect(page.locator("aside [data-admin-account]")).toContainText(EMAIL);

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
	await page.goto("/admin");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Overview");
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

test("an admin builds a course in the editor, and a user takes it", async ({ page, browser }) => {
	test.skip(!EMAIL || !PASSWORD, "MONOPANE_ADMIN_EMAIL and MONOPANE_ADMIN_PASSWORD are not set");
	const title = `Onboarding ${Date.now()}`;
	const slug = title.toLowerCase().replace(/ /g, "-");
	const done = page.locator("[data-admin-done]");
	const heading = page.getByRole("heading", { level: 1 });
	/** Open the "Add activity" menu and choose a kind. */
	const addActivity = async (kind: string) => {
		await page.getByText("Add activity", { exact: true }).click();
		await page.getByRole("link", { name: kind, exact: true }).click();
	};
	/** Open the menu of a row and press one of its actions. */
	const rowAction = async (row: string, action: string) => {
		await page.getByLabel(`Actions for ${row}`, { exact: true }).click();
		await page.getByRole("button", { name: action, exact: true }).click();
	};

	await signInAsAdmin(page);

	// --- A new course starts as a draft ---------------------------------------
	await page.getByRole("link", { name: "Create course" }).first().click();
	await expect(heading).toHaveText("New course");
	await page.getByLabel("Course title").fill(title);
	await page.getByLabel("What it covers").fill("Your first week.");
	await page.getByRole("button", { name: "Create course" }).click();
	await expect(page).toHaveURL(/\/admin\/courses\/crs_/);
	await expect(heading).toHaveText(title);
	await expect(page.locator("[data-course-state]")).toHaveText("Draft");
	const courseUrl = page.url().split("?")[0] ?? "";

	// --- Its details, on their own page ---------------------------------------
	await page.getByRole("link", { name: "Details", exact: true }).click();
	await expect(page.getByLabel("Address")).toHaveValue(slug);
	await page.getByLabel("Topics").fill("Onboarding, Basics");
	await page.getByLabel("How long it takes, in minutes").fill("15");
	await page.getByRole("button", { name: "Save course" }).click();
	await expect(done).toHaveText("Course saved");
	await expect(page.getByLabel("Topics")).toHaveValue("Onboarding, Basics");
	// What Monopane refuses is said, and what was typed is still there.
	await page.getByLabel("Cover picture").evaluate((input: HTMLInputElement) => {
		input.removeAttribute("pattern");
		input.type = "text";
		input.value = "http://example.com/not-https.png";
	});
	await page.getByLabel("Title").fill(`${title}!`);
	await page.getByRole("button", { name: "Save course" }).click();
	await expect(page.locator("[data-admin-error]")).toBeVisible();
	await expect(page.getByLabel("Title")).toHaveValue(`${title}!`);
	await expect(page.getByLabel("Cover picture")).toHaveValue("http://example.com/not-https.png");

	// --- A module and a lesson -------------------------------------------------
	await page.getByRole("link", { name: "Lessons", exact: true }).click();
	await expect(heading).toHaveText(title);
	await page.getByLabel("New module").fill("Week one");
	await page.getByRole("button", { name: "Add module" }).click();
	await expect(done).toHaveText("Module added");
	await page.getByLabel("New lesson in Week one").fill("Day one");
	await page.getByRole("button", { name: "Add lesson" }).last().click();
	await expect(page).toHaveURL(/\/lessons\/lsn_/);
	await expect(heading).toHaveText("Day one");
	const lessonUrl = page.url().split("?")[0] ?? "";
	const lessonId = lessonUrl.split("/").pop() ?? "";

	// --- Activities, each made on a page of its own ---------------------------
	// An empty lesson offers the four kinds outright.
	await page.getByRole("link", { name: "Add reading", exact: true }).click();
	await expect(heading).toHaveText("New reading");
	await page.getByLabel("Title").fill("Welcome aboard");
	await page.getByLabel("Text").fill("# Hello\n\nThis is **your** first day.");
	await page.getByRole("button", { name: "Add reading" }).click();
	await expect(done).toHaveText("Reading added as a draft");
	await expect(page).toHaveURL(new RegExp(`${lessonId}\\?done=`));

	await addActivity("Link");
	await page.getByLabel("Title").fill("The handbook");
	await page.getByLabel("Address of the link").fill("https://example.com/handbook");
	await page.getByRole("button", { name: "Add link" }).click();
	await expect(done).toHaveText("Link added as a draft");

	await addActivity("Quiz");
	await page.getByLabel("Title").fill("Check in");
	await page.getByLabel("Score needed to pass, in percent").fill("100");
	await page.getByLabel("First question", { exact: true }).fill("Which day is this?");
	await page.getByLabel("Choices, one per line").fill("Day one\nDay two");
	// A right answer that is not one of the choices is refused, with the reason,
	// and nothing typed is lost.
	await page.getByLabel("Right answers, one per line").fill("Day three");
	await page.getByRole("button", { name: "Add quiz" }).click();
	await expect(page.locator("[data-admin-error]")).toContainText("is not one of the choices");
	await expect(page.getByLabel("Title")).toHaveValue("Check in");
	await expect(page.getByLabel("Choices, one per line")).toHaveValue("Day one\nDay two");
	await page.getByLabel("Right answers, one per line").fill("Day one");
	await page.getByRole("button", { name: "Add quiz" }).click();
	await expect(done).toHaveText("Quiz added as a draft");
	// A new quiz stays open, for its other questions.
	await expect(heading).toHaveText("Check in");
	await expect(page.locator("[data-admin-question]")).toHaveCount(1);

	await page.getByRole("link", { name: "Add question" }).click();
	await expect(heading).toHaveText("New question");
	await page.getByLabel("Kind of question").selectOption("fill_in_blank");
	await page.getByLabel("Question", { exact: true }).fill("A course is made of ___.");
	await page.getByLabel("Right answers, one per line").fill("lessons\nlesson");
	await page.getByRole("button", { name: "Add question" }).click();
	await expect(done).toHaveText("Question added");
	await expect(page.locator("[data-admin-question]")).toHaveCount(2);

	// Edit the reading, and move the link above it.
	await page.getByRole("link", { name: "Day one" }).click();
	await expect(page.locator("[data-admin-activity]")).toHaveCount(3);
	await page.getByRole("link", { name: "Welcome aboard" }).click();
	await expect(page.getByLabel("Text")).toHaveValue("# Hello\n\nThis is **your** first day.");
	await page.getByLabel("Title").fill("Welcome");
	await page.getByRole("button", { name: "Save reading" }).click();
	await expect(done).toHaveText("Reading saved");
	await rowAction("The handbook", "Move up");
	await expect(done).toHaveText("Activity moved");
	await expect(page.locator("[data-admin-activity]").first()).toHaveAttribute(
		"data-admin-activity",
		"Link",
	);

	// --- Nothing is visible to a user yet -------------------------------------
	const userContext = await browser.newContext();
	const user = await userContext.newPage();
	expect((await user.goto(`/courses/${slug}`))?.status()).toBe(404);

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

	// --- A user takes it ------------------------------------------------------
	// Publishing made the site forget what it remembered about courses, so the
	// user sees the course at once (it was "not found" a moment ago).
	await user.goto(`/sign-in?next=${encodeURIComponent(`/courses/${slug}`)}`);
	await user.getByLabel("Your name").fill("Grace Hopper");
	await user.getByLabel("Email address").fill(`grace-${Date.now()}@example.com`);
	await user.getByRole("button", { name: "Sign in" }).click();
	await expect(user.getByRole("heading", { level: 1 })).toHaveText(title);
	await expect(user.getByText("Week one", { exact: true })).toBeVisible();
	await user.getByRole("button", { name: "Enrol in this course" }).click();
	await expect(user.locator("[data-course-progress]")).toContainText("0 of 3 activities done");
	await user.getByRole("link", { name: "Start the course" }).click();
	await expect(user).toHaveURL(new RegExp(`/courses/${slug}/${lessonId}$`));
	// In the order the admin left them: the link, then the reading, then the quiz.
	const types = await user
		.locator("[data-activity]")
		.evaluateAll((items) => items.map((item) => item.getAttribute("data-activity")));
	expect(types).toEqual(["external_link", "reading", "quiz"]);
	await expect(user.locator("[data-activity=reading]")).toContainText("your first day");
	await expect(user.locator("[data-activity=reading] strong")).toHaveText("your");
	const userQuiz = user.locator("[data-activity=quiz]");
	await userQuiz.getByLabel("Day one").check();
	await userQuiz.getByRole("textbox", { name: /A course is made of/ }).fill("Lessons");
	await userQuiz.getByRole("button", { name: "Submit answers" }).click();
	await expect(userQuiz.locator("[data-quiz-result=passed]")).toContainText("You scored 100%");
	// The answer keys the admin typed never reach the user's page.
	expect(await user.content()).not.toMatch(/correctAnswer|acceptedAnswers/);
	// A user is offered nothing of the admin's.
	await expect(user.locator("[data-admin-edit]")).toHaveCount(0);
	expect((await userContext.request.get("/admin/users", { maxRedirects: 0 })).status()).toBe(302);
	await userContext.close();

	// --- The admin sees the user and how they are doing -----------------------
	await page.getByRole("link", { name: "Users", exact: true }).click();
	await expect(heading).toHaveText("Users");
	// Search finds the user by part of their name; a search for nobody says so.
	await page.getByLabel("Search users").fill("no such person");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(page.getByText('Nobody matches "no such person"')).toBeVisible();
	await page.getByLabel("Search users").fill("hopper");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(page).toHaveURL(/\/admin\/users\?q=hopper/);
	await expect(page.locator("[data-admin-user]").first()).toContainText("Grace Hopper");
	// A heading orders the list, and keeps the search.
	await page.getByRole("link", { name: "User", exact: true }).click();
	await expect(page).toHaveURL(/q=hopper&sort=displayName/);
	await expect(page.getByRole("columnheader", { name: "User" })).toHaveAttribute(
		"aria-sort",
		"ascending",
	);
	// Back to newest first, where the user who just signed in is at the top.
	await page.getByRole("link", { name: "Joined", exact: true }).click();
	await expect(page.getByRole("columnheader", { name: "Joined" })).toHaveAttribute(
		"aria-sort",
		"descending",
	);
	await page.getByRole("link", { name: "Grace Hopper" }).first().click();
	await expect(heading).toHaveText("Grace Hopper");
	const enrollment = page.locator(`[data-admin-enrollment="${title}"]`);
	await expect(enrollment.locator("[data-state]")).toHaveText("In progress");
	await expect(enrollment).toContainText("1 activity done");
	await expect(page.locator("[data-admin-activity-feed]")).toContainText(`Enrolled in ${title}`);
	// Reading only: nothing on the page can be sent.
	await expect(page.locator("main form")).toHaveCount(0);

	// --- From the user pages, an admin can go straight to editing --------------
	await page.goto(`/courses/${slug}`);
	await page.getByRole("link", { name: "Edit this course" }).click();
	await expect(page).toHaveURL(courseUrl);
	await expect(page.locator("[data-course-numbers]")).toHaveAttribute(
		"data-course-numbers",
		"1 enrolled, 0 completed",
	);

	// --- Take it down, then delete it -----------------------------------------
	await page.getByRole("button", { name: "Move back to draft" }).click();
	await expect(done).toHaveText("Course moved back to draft");
	await expect(page.locator("[data-course-state]")).toHaveText("Draft");
	await page.getByRole("link", { name: "Details", exact: true }).click();
	// The page is swapped in place; the menu to press is the new page's.
	await expect(page).toHaveURL(`${courseUrl}/details`);
	// Deleting is the last line of the course's menu. It asks once more, and
	// Cancel leaves everything as it was.
	const confirm = page.getByRole("alertdialog", { name: `Delete ${title}?` });
	const openDelete = async () => {
		await page.getByLabel(`More actions for ${title}`, { exact: true }).click();
		await page.getByRole("button", { name: "Delete course", exact: true }).click();
	};
	await openDelete();
	await confirm.getByRole("button", { name: "Cancel" }).click();
	await expect(confirm).toBeHidden();
	await expect(page).toHaveURL(`${courseUrl}/details`);
	await openDelete();
	await confirm.getByRole("button", { name: "Delete", exact: true }).click();
	await expect(page).toHaveURL(/\/admin\/courses\?done=/);
	await expect(done).toHaveText("Course deleted");
	await expect(page.locator(`[data-admin-course="${slug}"]`)).toHaveCount(0);
	await page.getByRole("button", { name: "Leave admin" }).click();
});
