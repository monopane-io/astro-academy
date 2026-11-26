/**
 * How the components in src/components/ui build their class lists.
 *
 * A component has a base look, then variants (what kind it is), sizes, and
 * whatever the page adds last. `variants` puts those together in that order,
 * so every button, badge or field on the site is made the same way and a
 * page never has to repeat a list of classes.
 */

type ClassValue = string | false | null | undefined;

/** Join class names, skipping anything empty. */
export function cx(...parts: ClassValue[]): string {
	return parts.filter(Boolean).join(" ");
}

type Options = Record<string, Record<string, string>>;
type Choice<O extends Options> = { [K in keyof O]?: keyof O[K] & string };

/**
 * Describe a component once: its base classes, each thing that can vary, and
 * what it is when nothing is said. Returns a function from choices to classes.
 *
 *   const button = variants("inline-flex ...", {
 *     variant: { primary: "bg-brand ...", outline: "border ..." },
 *     size: { sm: "h-8 px-3", md: "h-10 px-4" },
 *   }, { variant: "primary", size: "md" });
 *
 *   button({ variant: "outline" }, "w-full")
 */
export function variants<O extends Options>(
	base: string,
	options: O,
	defaults: Required<Choice<O>>,
) {
	return (choice: Choice<O> = {}, extra?: ClassValue): string =>
		cx(
			base,
			...Object.keys(options).map((name) => {
				const picked = choice[name as keyof O] ?? defaults[name as keyof O];
				return options[name]?.[picked as string];
			}),
			extra,
		);
}

/** The ring every control shows when it is reached by keyboard. */
export const focusRing =
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** A stable id for a field made from its name, so a label can point at it. */
export function fieldId(name: string, suffix = ""): string {
	return `f-${name}${suffix ? `-${suffix}` : ""}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

/** The pages a visitor can go to from the top bar and the foot, by who they are. */
export function sitePages(path: string, signedIn: boolean, admin: boolean) {
	return [
		{ href: "/", label: "Courses", current: path === "/" },
		...(signedIn
			? [{ href: "/my-learning", label: "My learning", current: path === "/my-learning" }]
			: []),
		...(admin ? [{ href: "/admin", label: "Admin", current: false }] : []),
	];
}
