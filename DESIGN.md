---
name: academy-design
description: Use when adding or changing a page, a block or a component in this academy. It says who the pages are for, how to decide what a page shows, which pieces exist to build it from, and which habits to refuse. Covers the user pages, the lesson player and the admin area, in light and dark.
---

# Build pages for this academy

You are working as the academy's designer and its engineer at once. A page here
is finished when a person can do the one thing they came for without reading
anything twice, and when it could not be told apart from the pages already in
the site. Decide what the page is for before you decide what goes on it.

This file holds judgement. The mechanics (colours, sizes, spacing, states) are
already in the components; use them and do not restate them in a page.

## Who reads these pages

- **A user** is taking a course, usually in a spare ten minutes, often on a
  phone. They want to know where they are, what is next, and how much is left.
  User pages are calm and roomy, with one thing to do next.
- **An admin** runs the academy: writes courses, checks who is enrolled, looks
  at progress. They come back daily and scan. Admin pages are dense, plain and
  the same shape every time.

The voice is the same for both: precise, calm, direct. Say what a thing is and
what will happen. No exclamation marks, no praise for ordinary actions, no
"simply" or "just". Labels are short and carry no article ("Add lesson",
"Delete course"). A button says what it does; a confirmation says what is
lost.

## Use this priority order

When two of these pull against each other, the earlier one wins.

1. **Keep what is true.** Titles, counts, progress, dates and states come from
   the data. Never round, invent, or fill a gap with sample text.
2. **Keep the structure of the project.** Four layers, each using the one
   below; what a page does lives in `src/lib`, and a page file is markup.
3. **Make the next step obvious.** One primary action on a page. Everything
   else is quieter.
4. **Look like the rest of the site.** Same shell, same type sizes, same
   surface, same place for the same thing.
5. **Choose the shape that fits the content**, from the shapes below.
6. **Then refine**: narrow screens, dark mode, the empty and the error case.

Ask a question only when a wrong guess would lose someone's work, show one
person's data to another, or change what a customer is promised. Otherwise
decide, and say what you decided.

## How the project is laid out

Four layers. A page uses the layer above it and never reaches past it.

1. **Tokens**, `src/styles/global.css`. Four values at the top are the whole
   identity: `--brand`, `--brand-font`, `--brand-radius`, `--brand-tint`.
   Every colour, light and dark, is worked out from them.
2. **Components**, `src/components/ui`. Small things with a base look,
   variants and sizes, each described once with `variants()` from
   `src/lib/ui.ts`.
3. **Blocks**, `src/components/blocks`. A piece of a screen made of
   components.
4. **Layouts**, `src/layouts`. The shell around a page.

Rules that follow from this:

- A page file holds no `class="..."` that restyles a button, badge, field,
  alert, link or card. If a component cannot do what the page needs, change
  the component, or add a variant, and show it on `/design`.
- A page lays nothing out itself. If two pages need the same arrangement, it
  is a block.
- Colours are theme colours only (`bg-card`, `text-muted-foreground`,
  `border-border`, `bg-brand`, `text-destructive`). Never a fixed colour, and
  never an arbitrary value where a token exists.
- Icons come from `Icon`. Add a name to its list; never write an `<svg>` in a
  page or a block.
- Add no dependency, font, script or stylesheet from another host for the
  sake of a page.
- `npm run dev`, then `/design`, shows every component and block. Anything
  new goes there too.

## Work in four passes

### 1. Say what the page is for

Write one sentence: who is here, and what they do next. If the sentence needs
"and", it is probably two pages. An admin page is one list or one form. A user
page has one thing it asks for.

List the states before drawing any of them: nothing yet, one, many, too many
to show at once, refused, done. The empty state is a design, not an
afterthought: it says what will appear here and offers the action that makes
the first one.

### 2. Choose the shape

Pick from these. Do not invent a new one until none fits.

| The page is about | Use |
| --- | --- |
| Things to open and act on, in an order (lessons, activities) | `Section` holding an `ItemList` of `ItemRow`s |
| Rows to compare by column (users, courses) | `Table`, with search in its toolbar and a `Pager` when long |
| Creating or editing one thing | `FormCard`, fields no wider than `max-w-form` |
| One thing with facts beside it (a course, a user) | `Split`: content in two thirds, `Facts` in one third |
| How things stand at a glance | `Stats`, then the tables people open next |
| Saying one thing (not found, signed out, finished) | `Message` |
| A course's lessons, for a user | `CourseOutline` on the track |
| Reading and doing a lesson | the `Lesson` layout: contents beside one reading column |

The order on an admin page is always `PageHeader` (with `Tabs` if the thing
has more than one page), `Notice`, then `Section`s. On a user page it is
`PageIntro` (or `Message`), then blocks. The trail above an admin title is
every page above this one, outermost first, ending with this page.

Where things go, every time:

- The one primary action is in the page header on an admin page, and directly
  under the introduction on a user page.
- Actions on a row are in a `Menu` at the end of the row.
- Deleting is the last line of a menu, in red, and asks once more in a
  `Dialog` that names what will go with it (`DeleteAction`).
- A change that worked is a `Toast`. A change that was refused is an `Alert`
  that stays until the person has dealt with it. `Notice` does both.
- Status is a `Badge`. Progress through steps is the track.

### 3. Build it from the pieces

Use the lists under "The pieces" below. Give every control a label. Keep the
roles, labels and `data-` attributes the browser tests look for; if you move
something, move its attribute with it.

### 4. Look at it, then revise

Build, open the page, and look at it at 1360px and at 390px, in light and in
dark. Check, in this order:

1. Is the one next step the first thing the eye lands on?
2. Do the left edges line up from the header to the last row?
3. Does any heading repeat the one above it, or the browser tab?
4. Is anything clipped, wrapped badly, or wider than the screen?
5. Do menus, dialogs and the drawer open and close, by pointer and by
   keyboard?
6. What does it look like with nothing, and with a hundred?

Fix what you find before you describe the work. Then run `npm run check`,
`npm test` and the browser tests.

## The one look

- **Type.** Seven sizes and no others: `text-display` (the hero),
  `text-title` (a user page's title; a bare `h1` gets it), `text-title-sm`
  (an admin page's title, a lesson's), `text-heading` (a part of a user
  page), `text-heading-sm` (a heading inside a reading), `text-subheading`
  (a part of an admin page, a row's name), `text-label` (the quiet name of a
  group). Body text is 14px in the admin area and in controls, 16px in a
  reading.
- **Corners, by role.** Controls `rounded-md`. Lines of a menu `rounded-sm`.
  Things that float or sit inside a surface (alerts, dialogs, toasts, empty
  states) `rounded-lg`. Surfaces (cards, tables, tiles) `rounded-xl`. Badges,
  tags and avatars `rounded-full`.
- **Surfaces.** One recipe, `surface` in `src/lib/ui.ts`: a border, the card
  colour, a small shadow, 24px inside. Controls carry `shadow-xs`, menus
  `shadow-md`, dialogs and toasts `shadow-lg`. Nothing else has a shadow.
- **Sizes.** Controls are 36px high, small ones 32px, large ones 40px. `sm`
  in rows, `md` in forms and headers, `lg` for the one thing a user page asks
  for.
- **Focus.** A 3px ring at half strength, on everything, drawn by the
  components. Never remove it and never replace it with an outline.
- **Where you are.** The current page in any navigation is `bg-muted
  text-foreground`. Tabs use a line in `primary`.
- **Colour means something.** `brand` is the one main action. `primary` is
  progress, links and the current thing. `success` and `destructive` are
  outcomes only. `mark` is the demo notice and a certificate's code.
  Everything else is the greys.
- **The track.** The site's one picture: steps joined by a line that fills in
  as they are done. Lessons in a course, courses in a path, set-up steps, and
  the ring and bar in the same colour. Anything that shows progress through
  steps uses it. Nothing borrows it as decoration.
- **Motion.** A page swaps in place with a thin bar across the top. The
  drawer slides, a toast fades. Nothing else moves, and everything stops for
  a person who asks for reduced motion.

## Refuse these habits

Each of these is what a page looks like when nobody decided anything. If you
catch one, go back to pass 1.

- A small all-capitals line above a heading.
- A gradient, a glow, a blurred blob, or a decorative shape behind content.
- A card inside a card, or a border round something already on a surface.
- A grid of three equal cards with an icon, a title and a sentence each.
- A badge that is not a state. A pill used as a heading.
- Two filled buttons side by side. A filled button for "Cancel".
- An icon beside every label, or an emoji anywhere.
- Centred body text. Centring is for `Message`, `Empty` and the sign-in card.
- A heading that says what the tab or the breadcrumb already says.
- A new size, radius, shadow or grey because it "looked better here".
- Help text that restates the label. A placeholder used as the label.
- A spinner where a busy button or a `Skeleton` would do.
- A stock photograph or a generated illustration. A course's own cover is the
  only picture.
- A tooltip that carries something the person needs. A tooltip is for the eye
  only; the control has its own label.
- A dash used to join two thoughts in a label or a sentence. Write two
  sentences.

## The pieces

Use these names. A piece not listed here does not exist yet; build it in its
layer and add it here and on `/design`.

### Layouts

- `Base`: the user pages. Top bar, a centred column (`wide` for the
  catalogue), a `band` slot across the page under the bar, footer.
- `Lesson`: a lesson. The course's contents beside one reading column; on a
  phone the contents fold away above it.
- `Auth`: one card in the middle, for signing in.
- `Admin`: the admin area. Sidebar, one column; below a wide screen the
  sidebar becomes a drawer.
- `Document`: the page itself, the skip link and the scripts every page
  shares. The other four sit in it; a page never uses it directly.

### Components (`src/components/ui`)

- **Actions:** `Button` (`variant`: `primary`, `secondary`, `ghost`,
  `destructive`; `size`: `sm`, `md`, `lg`; `href` makes it a link; `icon` for
  an icon alone, which then needs a label), `TextLink`, `Menu` with
  `MenuItem`s (`align="start"` for a button near the left edge), `Tag` (a
  topic to filter by; `current` for the one in use).
- **Forms:** `Field` (label, hint, error and the control together; use it for
  every control), `FieldGroup`, `Input` (bare; needs an `aria-label`),
  `Checkbox`, `RadioGroup`, `Toggle`.
- **Showing things:** `Card` (`title`, `description`, an `actions` slot, a
  `footer` slot; `flush` when what it holds brings its own edges), `Badge`
  (a state), `Avatar` and `AvatarLabel`, `Icon`, `Progress`, `ProgressRing`,
  `Skeleton`.
- **Telling people things:** `Alert` (stays on the page), `Toast` (a change
  that worked), `Tooltip`.
- **Over the page:** `Dialog` (`alert` for a confirmation), `Drawer` (the
  navigation on a narrow screen).

### Blocks for any page (`src/components/blocks`)

- `Section`: a named part of a page, with room for an action beside its
  heading.
- `ItemList`, `ItemRow`: things to open, in an order. A row with `href` is a
  link as a whole; its actions sit above the link.
- `Table`, `Pager`: rows to compare. Columns can sort (`sortHref`, `sorted`)
  and hide on a narrow screen; `toolbar`, `footer` and `empty` slots.
- `Empty`: nothing here yet, and the action that makes the first.
- `Message`: a page that says one thing.
- `Notice`: the result of the last change, from `done` or `error`.
- `Facts`: names and values. `Feed`: what happened, newest first.
- `Split`: two thirds and one third. `Stats`: a row of numbers.
- `Banner`: one line across the top of the site. `DemoNotice` is the one for
  demo sign-in.

### Blocks for the admin area

`AdminNav` (with `AdminNavBody`), `PageHeader` (with `Breadcrumbs`), `Tabs`,
`FormCard`, `DeleteAction`, `Checklist`, `CourseHeader`, `LessonHeader`,
`QuestionFields`.

### Blocks for the user pages

`SiteHeader`, `SiteFooter`, `Hero`, `PageIntro`, `CoursePath`, `Continue`,
`FeaturedCourse`, `CourseGrid`, `CourseTile`, `CourseAction`,
`CourseOutline`, `LearningList`, `LearningRow`, `LessonOutline` (with
`LessonOutlineList`), `LessonNav`, `Activity` (with `ActivityHeader`,
`VideoPlayer`, `Quiz`, `QuizResult`), `Certificate`.

### Colours

`background` (the page), `card` (surfaces and fields), `foreground`,
`muted` and `muted-foreground`, `border`, `ring`, `brand` and
`brand-foreground`, `primary` and `primary-soft`, `success` and
`success-soft`, `destructive`, `destructive-soft` and
`destructive-foreground`, `mark` and `mark-foreground`. Each has a dark
value; write the name once and both themes follow.

### Widths

`max-w-page` (the catalogue and the lesson player), `max-w-prose` (a column
of text), `max-w-form` (a form's fields).

## Everyone can use it

- One `h1` on a page. Headings go down one level at a time.
- Every page starts with a link that skips to the content, and keeps the
  landmarks the layouts give it: header, navigation, main, footer.
- Every control has a name a screen reader can say. An icon alone is not a
  name.
- Everything works from the keyboard, in an order that follows the page, and
  shows where the keyboard is.
- Colour never carries a meaning alone: a state has a word, an error has a
  sentence beside the field it is about.
- Text and controls meet WCAG AA contrast in both themes. The colours worked
  out from `--brand` do; a fixed colour might not.
- A page works before its scripts load: links are links, changes are forms,
  menus and the drawer open without script. Only a dialog needs script to
  open.
- On a narrow screen, let things stack and wrap before you make them smaller.
  Nothing scrolls sideways except a wide table inside its own frame.
- A target for a finger is at least 32px, and 40px for the one thing a user
  page asks for.
