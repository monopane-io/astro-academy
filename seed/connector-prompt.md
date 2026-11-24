# The demo course, as a prompt

Monopane has a connector for Claude at `https://mcp.monopane.io`. Add it as a custom connector, sign in to your project, and you can create content by describing it.

The prompt below creates the same demo course as `npm run seed`. Paste it into Claude with the connector on, or change it to describe a course of your own.

```text
In my Monopane project, create a course with the slug "academy-tour", titled
"A tour of this academy". Description: "Ten minutes on how courses, lessons,
quizzes and credentials work here. Finish it to earn your first credential."

If a course with that slug already exists, add only what is missing.

Lesson 1, directly under the course (no module): "Welcome"
- A reading, "How a course is put together", about 2 minutes: explain that the
  site holds courses, a course is a list of lessons, lessons can be grouped
  into modules, and a lesson is a list of activities of three kinds: readings,
  links and quizzes. Say that finishing every activity completes the course
  and earns a credential.
- An external link, "Where the content comes from", to https://monopane.io,
  opening in a new tab.

Then a module, "Proving what you know", with two lessons.

Lesson 2: "Quizzes"
- A reading, "Before you start", about 1 minute: quizzes are marked on
  submission, you see your score and which questions were right but not the
  answers, you pass at 75%, and you can retry.
- A quiz, "Check what you have learned", passing threshold 0.75, with one
  question of each type:
  1. multiple_choice: "What is a lesson made of?" Options: Activities,
     Modules, Courses. Correct: Activities.
  2. multi_select: "Which of these are kinds of activity?" Options: Reading,
     Quiz, Link, Webinar. Correct: Reading, Quiz, Link.
  3. fill_in_blank: "A course is complete when every ___ in it is done. (One
     word.)" Accept: activity, activities.
  4. short_answer: "In a few words: what do you get when you complete a
     course?" Accept answers containing: credential.

Lesson 3: "Your credential"
- A reading, "Credentials and how to check one", about 1 minute: a credential
  is issued when the last activity is done, it has a code, and anyone with the
  code can check it without signing in.

Publish every activity, every lesson, the module, and then the course.
```

Nothing appears on the site until it is published, and a lesson inside a module needs the module published too. If the course does not show up, ask Claude to list what is still a draft.
