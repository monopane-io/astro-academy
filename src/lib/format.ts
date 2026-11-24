/** "45 min", "1 h", "1 h 30 min". */
export function formatMinutes(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (hours === 0) return `${rest} min`;
	return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "6 min", "1 h 2 min": a video's length, rounded up to whole minutes. */
export function formatSeconds(seconds: number): string {
	return formatMinutes(Math.max(1, Math.ceil(seconds / 60)));
}
