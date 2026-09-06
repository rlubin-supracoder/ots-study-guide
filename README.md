# OTS Trainer

A static copy of [OTS Trainer](https://otstrainer.vercel.app/), captured September 6, 2026, configured for GitHub Pages. The original study interface, question banks, and study guide are preserved, with red accents and a custom Wolfpack access screen.

Includes SPINS flashcards, Academic MC, Final Test Questions, Concept Cards, Practice Test, and Study Guide. Keyboard shortcuts, answer shuffling, timed tests, scoring, printing, and browser-local progress are retained. The access hint is "AWOOOOOOO + Class"; password matching is case-sensitive. Previously unlocked sessions must enter the updated password after reloading.

## Run locally

With Node.js 20 or newer installed (no package installation needed):

```sh
npm start
```

Open `http://127.0.0.1:8000/`. Use an HTTP server instead of opening `index.html` directly, so the study guide can load.

```sh
npm run check
npm run build
```

The check validates all question banks, answer keys, script syntax and load order, and relative asset paths. The build copies only the seven public site files to `dist/` without changing their content.

## GitHub Pages

The repository publishes from `main` and `/ (root)`. In **Settings → Pages**, select **Deploy from a branch**, choose **main** and **/ (root)**, and save. `.nojekyll` makes GitHub serve the existing static files directly. Future pushes to `main` update the site automatically.

All local script and study guide links are relative, so the site works under a project URL such as `https://USERNAME.github.io/ots-study-guide/`.

## Files and original behavior

- `index.html`: interface, red accent styles, custom access screen, and application logic.
- `questions.js`: SPINS cards.
- `academic.js`: Academic MC bank.
- `academic_shuffled.js`: independent Final Test Questions bank.
- `concepts.js`: Concept Cards bank.
- `StudyGuide.md`: study guide loaded by the viewer.

Typography uses the original Google Fonts links. Progress is stored locally in each browser and does not automatically transfer from the original domain. The original password gate is client-side only; it is preserved for parity and does not make the publicly served files private.

This copy retains the source site's study content and attribution; no claim of authorship or new license is added to that content.
