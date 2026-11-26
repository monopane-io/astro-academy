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
	"outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * A box to tick and a dot to choose, drawn the same in every browser: 16px,
 * a light shadow, filled with the brand colour when chosen.
 */
const choice =
	"grid size-4 shrink-0 cursor-pointer appearance-none place-content-center border border-border bg-card shadow-xs outline-none transition-shadow before:scale-0 before:content-[''] checked:before:scale-100 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20";
export const checkbox = `${choice} rounded-[4px] checked:border-brand checked:bg-brand before:size-3 before:bg-brand-foreground before:[clip-path:polygon(14%_44%,0_65%,50%_100%,100%_16%,80%_0%,43%_62%)]`;
export const radio = `${choice} rounded-full before:size-2 before:rounded-full before:bg-brand`;

/** The one recipe for a surface that holds something: a card, a list, a tile. */
export const surface = "rounded-xl border border-border bg-card shadow-sm";

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
