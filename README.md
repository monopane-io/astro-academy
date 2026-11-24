# Astro academy

A customer academy you own: a small [Astro](https://astro.build) site that runs on Cloudflare Workers and gets its courses from [Monopane](https://monopane.io). Learners browse courses, sign in, enrol, read lessons, take quizzes, and earn a credential anyone can verify.

Your content, learners and progress live in Monopane. This site is the part your customers see, and it is yours to restyle and change.

What is in it:

- A catalogue of course tiles with cover images, topics and durations, and a filter by topic
- Course pages with progress, a lesson player with the curriculum alongside, readings, videos, links and quizzes
- A "My learning" page, a printable certificate and a public page for checking one
- Sign-in that works on the first deploy (demo mode), and email magic links for real use
- A demo course, so there is something to click through straight away
- No JavaScript sent to the browser; every page is plain HTML rendered on the server

## What you need

- A Monopane account. Registration is by invite: ask for access at [monopane.io](https://monopane.io) and use the link you are emailed.
- [Node.js](https://nodejs.org) 22.12 or newer.
- A [Cloudflare](https://dash.cloudflare.com/sign-up) account. The free plan is enough.

## Hosting with Monopane

Monopane can host the academy for you. Connect GitHub in the Monopane console and create a site from your copy of this repository. From then on, every push builds and goes live:

- A push to the repository's default branch is deployed at your site's address, `<name>.monopane.dev`.
- A push to any other branch becomes a preview with an address of its own. If the branch has an open pull request, Monopane comments the address on it.
- Each commit gets a **Monopane** status that links to its deployment.

The build runs in your repository with GitHub Actions (`.github/workflows/monopane.yml`), so Actions must be enabled for it (**Settings → Actions → General**). The workflow proves which repository and commit it builds with a token GitHub gives the job; no key or secret is stored in the repository. If the repository is not connected to a Monopane site, the workflow ends with a notice and deploys nothing. To turn it off, delete `.github/workflows/monopane.yml`.

To host the academy yourself instead, on your own Cloudflare account, follow the steps below.

## From an invite to a deployed academy

About 15 minutes. Steps 1 to 4 get it running on your machine; step 5 puts it online.

### 1. Get the code

Create your own copy of this repository (on GitHub: **Use this template**), clone it, and install:

```sh
npm install
```

### 2. Create a project and a key in Monopane

1. Open the link in your invite email and register. You are asked for an organization name and a project name; any names will do.
2. In the console, open **Settings** and copy the **Project ID**. It starts with `tnt_`.
3. Open **API Keys**, create a key, and copy it. It is shown once.

Put both in a file called `.dev.vars`:

```sh
cp .dev.vars.example .dev.vars
```

```ini
MONOPANE_TENANT_ID=tnt_...
MONOPANE_SETUP_API_KEY=mpk_live_...
```

The key from the console can do anything in your project. It stays on your machine and is used only by the next two commands. The site itself runs on a second, limited key, which the next step creates.

### 3. Set up and add the demo course

```sh
npm run setup
npm run seed
```

`npm run setup` creates the academy's own API key, limited to the [seven scopes](#the-academys-api-key) the site uses, and generates the secret that signs the sign-in cookie. It adds both to `.dev.vars` and writes `.prod.vars` for step 5.

`npm run seed` creates the demo course, "A tour of this academy". Both commands are safe to run again.

### 4. Run it

```sh
npm run dev
```

Open http://localhost:4321. Sign in with any name and email address, enrol in the tour, and finish it: three readings, a video, a link and a quiz. You get a certificate at the end, and "My learning" shows where you are.

The yellow bar at the top says demo sign-in is on. That is expected for now; see [Before you invite learners](#before-you-invite-learners).

### 5. Deploy

```sh
npx wrangler login
npm run deploy
npx wrangler secret bulk .prod.vars
```

`npm run deploy` builds the site and creates a Worker called `astro-academy`. It prints the address, which looks like `https://astro-academy.<your-subdomain>.workers.dev`. The second command gives the Worker its three secrets.

Open the address. If you open it before the secrets are set, the page lists what is missing; set them and reload.

To rename the Worker, change `name` in `wrangler.jsonc`. To use your own domain, add it under the Worker's **Settings → Domains & Routes** in the Cloudflare dashboard.

## Before you invite learners

Demo sign-in lets anyone sign in as anyone. It is there so the first deploy needs no email provider. Switch to email magic links before real people use the academy:

1. Create a [Resend](https://resend.com) account, verify a domain you send from, and create an API key.
2. Give the Worker the key:

   ```sh
   npx wrangler secret put RESEND_API_KEY
   ```

3. In `wrangler.jsonc`, change `AUTH_MODE` and add the sender:

   ```jsonc
   "vars": {
   	"AUTH_MODE": "magic-link",
   	"EMAIL_FROM": "Acme Academy <academy@your-domain.example>",
   	"SITE_NAME": "Acme Academy"
   }
   ```

4. `npm run deploy`

A learner now enters their email address and gets a link. The link signs in that address only, works once, and expires after 15 minutes. The storage for pending links (a Cloudflare KV namespace called `MAGIC_LINKS`) is created by the deploy.

People who signed in during demo mode do not carry over: a demo identity is never treated as a verified email address, so each learner starts fresh on their first magic-link sign-in.

Sign-in is open to anyone with an email address. If the academy is for a known list of people, put [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) in front of it or write your own adapter (below). The sign-in form has no rate limit of its own; add a [rate limiting rule](https://developers.cloudflare.com/waf/rate-limiting-rules/) for `/sign-in` if you see abuse.

## Settings

Secrets are set with `npx wrangler secret put NAME` (or `secret bulk`), and locally in `.dev.vars`. The others can go in `vars` in `wrangler.jsonc`.

| Name | Required | What it is |
|---|---|---|
| `MONOPANE_API_KEY` | yes, secret | The academy's key. Created by `npm run setup`. |
| `MONOPANE_TENANT_ID` | yes | Your project's ID (`tnt_...`). |
| `SESSION_SECRET` | yes, secret | At least 32 random characters. Changing it signs everyone out. |
| `MONOPANE_ENVIRONMENT` | no | The Monopane environment to read from. Default `production`. |
| `AUTH_MODE` | no | `demo` (default) or `magic-link`. |
| `SITE_NAME` | no | Shown in the header, page titles, certificates and emails. Default `Academy`. |
| `SITE_TAGLINE` | no | One line under the name on the home page. |
| `RESEND_API_KEY` | for magic links, secret | Your Resend API key. |
| `EMAIL_FROM` | for magic links | The sender, on a domain verified in Resend. |
| `MONOPANE_API_URL` | no | Default `https://api.monopane.io`. |

If a required setting is missing or wrong, every page says which one instead of failing later.

### The academy's API key

The site needs a key with exactly these scopes, and checks for them when it starts:

| Scope | Used for |
|---|---|
| `content:read` | Courses, modules, lessons and activities |
| `learners:read` | Finding the learner for a signed-in person |
| `learners:write` | Creating that learner on their first visit |
| `enrollments:read` | Whether a learner is enrolled, and whether they have finished |
| `enrollments:write` | Enrolling, and issuing the credential |
| `progress:write` | Marking activities done and submitting quizzes |
| `analytics:read` | Reading a learner's progress |

If the key lacks one, the site names it: "MONOPANE_API_KEY is missing the scope progress:write."

## Adding your own courses

Anything you publish in Monopane shows up on the site within a minute. Three ways to add content:

- **Ask Claude.** Monopane has a connector at `https://mcp.monopane.io`. Add it as a custom connector in Claude, sign in, and describe the course you want. [`seed/connector-prompt.md`](seed/connector-prompt.md) is a prompt that creates the demo course this way; use it as a pattern.
- **The API or an SDK.** [`seed/seed.mjs`](seed/seed.mjs) is a complete example using `@monopane/sdk`. API reference: https://api.monopane.io/docs
- **The Monopane console**, for looking at what is there.

A course can have a cover image (`imageUrl`), topics (`tags`, which become the filter on the home page) and a length (`estimatedMinutes`). A `video` activity takes an `https` address: YouTube, Vimeo, Loom and Wistia links are embedded, a link to a video file plays in the browser's own player, and anything else is shown as a link.

Only published content appears: a course, lesson or activity must be published, and so must the module a lesson sits in. Drafts are not listed and their addresses return "Page not found".

## How it works

Every request is handled on the server, in a Cloudflare Worker. The Worker calls Monopane with the academy's key; the browser never talks to Monopane and never receives the key.

```
src/
  middleware.ts          checks the settings and the key, works out who is signed in
  lib/pages.ts           what each page does: one function per page, no markup
  lib/monopane.ts        every call to Monopane, in one file
  lib/auth/              sign-in adapters: demo.ts, magic-link.ts, and the interface
  lib/session.ts         the signed session cookie
  lib/quiz.ts            reading a submitted quiz form
  lib/text.ts            turning a reading's text into HTML
  lib/video.ts           working out how to show a video's address
  pages/                 one file per page: the markup only
  components/            the course tile
  layouts/Base.astro     the frame around every page
  styles/global.css      the whole look; start with the variables at the top
seed/                    the demo course
tests/                   unit tests, an end-to-end test, a check of the built site
```

Things worth knowing before you change it:

- **Quiz answers never reach the site.** Activities are requested with `answers=omit`, so Monopane leaves the answer keys out. Quizzes are marked by Monopane, which says which questions were right and nothing more.
- **Course content is cached for 60 seconds** in the Worker's memory, because it is the same for every learner. Progress is never cached. Change `CONTENT_CACHE_SECONDS` in `lib/monopane.ts`.
- **A course page makes one request per lesson** the first time it is shown, to count activities. Cloudflare's free plan allows 50 outgoing requests per page view, so a course with more than about 40 lessons needs a paid plan or a change to how progress is counted.
- **Forms are protected against cross-site requests** by Astro's origin check, which is on by default. Leave it on.
- **Readings** understand a small, safe subset of Markdown (see `lib/text.ts`). All text is escaped.

### Using your own sign-in

Sign-in is one interface, `AuthAdapter` in [`src/lib/auth/types.ts`](src/lib/auth/types.ts). An adapter turns a submitted form, or a token from a link, into an identity: a stable ID, a name and an email address. The ID becomes the learner's `externalId` in Monopane. Everything after that (creating the learner, the session cookie, signing out) is shared.

To use your identity provider, write an adapter and return it from `getAuthAdapter` in `src/lib/auth/index.ts`. No page needs to change.

To send email through something other than Resend, write a function that returns an `EmailSender` (one method, `send`) and pass it to `createMagicLinkAdapter`.

## Clients without a server: learner tokens

This site keeps its API key on a server. A mobile app or a single-page app has no server of its own to keep a key on, and must never be shipped one. For those, Monopane issues learner tokens.

Your backend asks for a token for one learner, with its API key:

```ts
import { createLearnerToken } from "@monopane/sdk";

const { data } = await createLearnerToken({
	path: { tenantId, learnerId },
	body: { expiresIn: 3600 }, // seconds; 60 to 86400
});
// data.token goes to the app. It expires at data.expiresAt.
```

The app sends that token as its bearer token. With it, the app can read published course content, read that learner's own enrollments, and read and write that learner's own progress and quiz submissions. It cannot see drafts or quiz answers, and cannot touch anyone else's data.

Two things still go through your backend, with the API key: enrolling a learner and issuing a credential. A token cannot do either.

This starter does not use learner tokens; it has a server, so it does not need them.

## Tests

```sh
npm test            # unit tests: settings, session cookie, sign-in adapters, quizzes, videos, deploy script
npm run check       # type check
npm run build && npm run test:build   # no key and no JavaScript in what is built
npm run test:e2e    # the whole learner journey in a browser
```

The end-to-end test needs the site running (`npm run dev`) in demo mode against a project that has been seeded, and Playwright's browser (`npx playwright install chromium`). It signs in as a new learner each time and completes the demo course, so it leaves one learner and one credential behind per run.

## Making it yours

- **Look:** `src/styles/global.css`. Every colour, font and radius is a variable at the top of the file; change those first. Hand the file to an AI assistant with your brand colours and it can do the rest.
- **Name and tagline:** `SITE_NAME` and `SITE_TAGLINE`.
- **Pages:** each is one `.astro` file under `src/pages`, and is almost all HTML. What a page does (who may see it, what a form does, what it shows) is a function in `src/lib/pages.ts`; the page calls it and draws the result. So you can rewrite every page's HTML, or rebuild the site on a UI library, without touching how it behaves.
- **Words:** all the text learners see is in those page files and in `layouts/Base.astro`.
- **Course tiles:** a course with an `imageUrl` shows that image; one without gets a cover drawn in CSS (`.tile-cover` in `global.css`).

## Licence

MIT. See [LICENSE](LICENSE).
