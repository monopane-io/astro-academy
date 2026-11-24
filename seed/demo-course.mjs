/**
 * The demo content, as plain data. seed.mjs creates it through the Monopane
 * SDK; connector-prompt.md describes the same content for the MCP connector.
 *
 * Everything is published except what is marked `draft: true`. The drafts are
 * here on purpose: they show that unpublished content never appears on the
 * site, and the end-to-end test checks exactly that.
 */

export const courses = [
	{
		slug: "academy-tour",
		title: "A tour of this academy",
		description:
			"Ten minutes on how courses, lessons, quizzes and credentials work here. Finish it to earn your first credential.",
		tags: ["Getting started"],
		estimatedMinutes: 10,
		lessons: [
			{
				title: "Welcome",
				description: "What you are looking at, and how to get around.",
				activities: [
					{
						title: "How a course is put together",
						type: "reading",
						config: {
							estimatedMinutes: 2,
							content: [
								"This site is an academy. It holds **courses**, and you are in the first one.",
								"A course is a list of lessons. Some lessons are grouped into modules, like chapters in a book; others, like this one, stand on their own.",
								"A lesson is a list of activities. There are four kinds:",
								"- a reading, like this page\n- a video\n- a link to something elsewhere\n- a quiz",
								"When you finish an activity, the track on the course page fills in. When every activity is done, the course is complete and you get a credential.",
								"Press *Mark as read* below to finish this reading.",
							].join("\n\n"),
						},
					},
					{
						title: "A video, to show how one looks",
						type: "video",
						config: {
							// Big Buck Bunny, from the Blender Foundation's own channel.
							url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
							durationSeconds: 635,
							description:
								"Videos live wherever you host them: YouTube, Vimeo, Loom, Wistia or a file of your own. This one is a stand-in. Press Mark as watched when you are done.",
						},
					},
					{
						title: "Where the content comes from",
						type: "external_link",
						config: {
							url: "https://monopane.io",
							openInNewTab: true,
							description:
								"The courses on this site live in Monopane. The site reads them through the Monopane API and writes your progress back.",
						},
					},
				],
			},
		],
		modules: [
			{
				title: "Proving what you know",
				description: "Quizzes, completion and credentials.",
				lessons: [
					{
						title: "Quizzes",
						description: "One quiz, with one question of each kind.",
						activities: [
							{
								title: "Before you start",
								type: "reading",
								config: {
									estimatedMinutes: 1,
									content: [
										"## How quizzes are marked",
										"A quiz is marked as soon as you submit it. You see your score and which questions you got right, but not the answers.",
										"You pass at 75% or more. If you do not pass, change your answers and submit again; you can try as often as you like.",
									].join("\n\n"),
								},
							},
							{
								title: "Check what you have learned",
								type: "quiz",
								config: {
									passingThreshold: 0.75,
									questions: [
										{
											id: "lesson-parts",
											type: "multiple_choice",
											text: "What is a lesson made of?",
											options: ["Activities", "Modules", "Courses"],
											correctAnswer: "Activities",
										},
										{
											id: "activity-kinds",
											type: "multi_select",
											text: "Which of these are kinds of activity?",
											options: ["Reading", "Quiz", "Link", "Webinar"],
											correctAnswers: ["Reading", "Quiz", "Link"],
										},
										{
											id: "completion",
											type: "fill_in_blank",
											text: "A course is complete when every ___ in it is done. (One word.)",
											acceptedAnswers: ["activity", "activities"],
										},
										{
											id: "reward",
											type: "short_answer",
											text: "In a few words: what do you get when you complete a course?",
											acceptedPatterns: ["credential"],
										},
									],
								},
							},
						],
					},
					{
						title: "Your credential",
						description: "What happens when you finish.",
						activities: [
							{
								title: "Credentials and how to check one",
								type: "reading",
								config: {
									estimatedMinutes: 1,
									content: [
										"When the last activity is done, the course is complete and a credential is issued in your name.",
										"A credential has a code. Anyone you give the code to can check it on this site, without signing in. They see the course, your name and the date, and nothing else about you.",
										"This is the last activity. Mark it as read to complete the course.",
									].join("\n\n"),
								},
							},
						],
					},
					{
						title: "Unpublished lesson (you should never see this)",
						draft: true,
						activities: [
							{
								title: "Unpublished reading",
								type: "reading",
								config: { content: "This lesson is a draft, so the site leaves it out." },
							},
						],
					},
				],
			},
		],
	},
	{
		slug: "unpublished-course",
		title: "Unpublished course (you should never see this)",
		description: "A draft. It is not in the catalogue and its address returns Not found.",
		draft: true,
		lessons: [],
		modules: [],
	},
];
