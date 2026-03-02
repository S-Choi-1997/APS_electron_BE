# Repository Guidelines

## Project Structure & Module Organization
- Vite React app; entry `src/main.jsx`, root layout in `src/App.jsx`.
- UI components in `src/components` (tables, modal, auth screens) with matching `.css` files.
- Shared hooks live in `src/hooks`; dummy seed data sits in `src/data/dummyData.js` until Firestore is wired.
- Firebase setup is centralized in `src/firebase/config.js`; move secrets to `.env` before shipping.
- Static HTML sits at `index.html`; tooling config is in `package.json` and `vite.config.js`.

## Build, Test, and Development Commands
- `npm install` installs dependencies.
- `npm run dev` starts the Vite dev server (default http://localhost:5173) with hot reload.
- `npm run build` outputs production assets to `dist/`.
- `npm run preview` serves the built assets locally for smoke checks.
- No automated tests yet; run the flows manually after changes.

## Coding Style & Naming Conventions
- Use React functional components and hooks; keep side effects inside `useEffect`.
- Components and their CSS use PascalCase filenames (`ConsultationTable.jsx`/`.css`); functions and variables use camelCase.
- Prefer 2-space indentation, single quotes, and ES modules; keep JSX props on separate lines when long.
- Keep Firebase usage in dedicated helpers; do not sprinkle config or secrets in components.
- When adding data models, align with the Firestore shape in `FIREBASE_SETUP.md` (e.g., `name`, `email`, `phone`, `createdAt`, `read`).

## Testing Guidelines
- Name future tests after components or hooks (e.g., `ConsultationTable.test.jsx`).
- Target coverage: critical views (auth, list, detail, pagination) and Firestore interactions.
- Include minimal fixtures and prefer mocking Firebase.

## Commit & Pull Request Guidelines
- Use concise, present-tense commits; Conventional Commit style is welcome (e.g., `feat: add modal pagination controls`).
- PRs should include: a summary of changes, testing notes (`npm run dev`/`npm run preview`), screenshots for UI updates, and any Firebase rule changes.
- Confirm no secrets or `.env` values are committed; mention any migration steps for reviewers.

## Security & Configuration Tips
- Replace the checked-in Firebase keys with environment vars (`VITE_FIREBASE_*`) and keep `.env` untracked.
- Ensure Firestore rules remain read-only for untrusted users unless auth is enforced.
- Avoid storing PII in dummy data; sanitize before sharing logs or screenshots.