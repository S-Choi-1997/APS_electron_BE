# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Install dependencies
npm install

# Start development server (runs on http://localhost:5173 or next available port)
npm run dev

# Build for production (outputs to dist/)
npm run build

# Preview production build
npm run preview
```

## Architecture Overview

### Data Flow

This app has two modes of operation:

1. **Dummy Data Mode (Current)**: `src/App.jsx` imports from `src/data/dummyData.js` for UI testing
2. **Firestore Mode**: Commented code in `src/App.jsx` lines 24-55 contains real-time Firestore integration

To switch to Firestore mode:
- Uncomment lines 5-7 (Firestore imports) in `src/App.jsx`
- Uncomment lines 24-55 (Firestore query logic) in `src/App.jsx`
- Delete/comment lines 18-22 (dummy data logic) in `src/App.jsx`

### Component Architecture

The app uses a Gmail-style two-pane layout:

- **App.jsx**: Root component managing state for consultations list and selected consultation
- **Header**: Displays title and unread count badge
- **ConsultationList**: Left pane showing all consultations
  - **ConsultationListItem**: Individual consultation row with unread indicator
- **ConsultationDetail**: Right pane showing full consultation details

State flows down from App.jsx. Selection events bubble up via callbacks.

### Firestore Data Model

Collection: `consultations`

Required fields:
- `name`: string
- `createdAt`: Firestore Timestamp or Date object

Optional fields:
- `email`, `phone`, `company`, `subject`, `type`: strings
- `message` or `content`: string (both are supported for message body)
- `read`: boolean (defaults to false)

The app uses real-time listeners (`onSnapshot`) when in Firestore mode, so data updates automatically.

### Firebase Configuration

`src/firebase/config.js` contains placeholder Firebase credentials. Must be replaced with actual project credentials from Firebase Console.

For production, use environment variables (`.env` file with `VITE_` prefix) instead of hardcoded values.

### Styling Approach

Each component has a co-located CSS file (e.g., `Header.jsx` + `Header.css`). No CSS framework is used - all styles are custom CSS3 with responsive design via media queries.

Breakpoint: `@media (max-width: 768px)` switches from side-by-side to stacked layout.

## Deployment

This is a static SPA (no backend server needed). Build output in `dist/` can be deployed to:
- Firebase Hosting (recommended since already using Firebase)
- Vercel, Netlify, GitHub Pages, or any static host

The Firebase SDK connects directly from browser to Firestore, so no server-side code is required.
