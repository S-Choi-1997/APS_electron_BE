# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**APS Admin** is an Electron desktop application for managing customer consultation inquiries. The app runs on Windows/Linux and connects to a Node.js backend API running on an OMV NAS PC.

**Architecture Pattern**: Hybrid Cloud-Local
- **Frontend**: Electron + React (desktop app)
- **Backend**: Node.js REST API on local NAS (port 3001)
- **Cloud Services**: GCP Firestore (database), GCP Storage (attachments), Google OAuth (authentication via Google Identity Services)
- **Customer Entry Point**: GCP Cloud Run (public endpoint, still hosted)

## Development Commands

### Setup
```bash
npm install                  # Install dependencies
```

### Development
```bash
npm run electron:dev         # Run in dev mode (Vite dev server + Electron)
                            # - Vite runs on http://localhost:5173
                            # - Opens Electron window with DevTools
                            # - Hot reload enabled
```

### Production Build
```bash
npm run electron:build       # Build and package for distribution
                            # Output: dist/APS Admin Setup 1.0.0.exe (Windows)
                            #         dist/APS-Admin-1.0.0.AppImage (Linux)
```

### Individual Commands
```bash
npm run dev                  # Vite dev server only (for web testing)
npm run build                # Vite production build (creates dist/)
npm run electron             # Launch Electron with current dist/
```

## Architecture Deep Dive

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Electron + React (Frontend)                       │
│  - React 18 UI components (src/components/)                 │
│  - Vite for bundling and HMR                                │
│  - Electron main process (electron/main.js)                 │
│  - IPC bridge (electron/preload.js)                         │
│  - Google Identity Services (OAuth, no Firebase)            │
└─────────────────────┬───────────────────────────────────────┘
                      │ REST API (HTTP/HTTPS)
                      │ + IPC (OAuth popup handling)
┌─────────────────────▼───────────────────────────────────────┐
│  Layer 2: Backend API Server (OMV NAS)                      │
│  - Node.js Express server (port 3001)                       │
│  - GCP Firestore Admin SDK                                  │
│  - Token verification (Google OAuth)                        │
│  - SMS relay service                                        │
└─────────────────────┬───────────────────────────────────────┘
                      │ GCP SDK
┌─────────────────────▼───────────────────────────────────────┐
│  Layer 3: GCP Cloud Services                                │
│  - Firestore: Consultation data, admin users                │
│  - Storage: Attachments (images, files)                     │
│  - Google Identity: OAuth authentication                    │
└─────────────────────────────────────────────────────────────┘
```

### Authentication Flow (Critical Pattern)

**Dual OAuth System**: Google + Naver

**Important**: This app uses **pure Google Identity Services** (no Firebase Auth). The `firebase` package in package.json is not actively used - authentication is handled by Google's OAuth 2.0 directly.

#### Google OAuth (Pure Google Identity Services)
1. User clicks "Google 로그인" button
2. `googleAuth.js` uses Google Identity Services (accounts.google.com/gsi/client)
3. User authorizes in browser popup
4. Google returns ID token (JWT)
5. Token stored in localStorage + `authManager.js` currentUser state
6. All API calls include `Authorization: Bearer <token>` header
7. Backend verifies token with Google (not Firebase)

#### Naver OAuth (Electron-Specific IPC Flow)
1. User clicks "Naver 로그인" button
2. `naverAuth.js` detects Electron environment via `window.electron.isElectron`
3. **Calls IPC**: `window.electron.openOAuthWindow(authUrl)`
4. **Electron main process** (`main.js`) receives IPC message
5. Opens BrowserWindow popup (500x700, modal)
6. Monitors URL changes via `will-redirect` and `did-navigate` events
7. Detects redirect URL with `code=` and `state=` parameters
8. **Returns via IPC**: `{ code, state }`
9. Frontend calls backend API `/auth/naver/token` to exchange code for token
10. Token stored in authManager state

**Key Pattern**: OAuth in Electron requires IPC because renderer process cannot directly access Node.js APIs for popup management.

### API Request Pattern (src/config/api.js)

All backend API calls use the `apiRequest()` wrapper:

```javascript
apiRequest(endpoint, options, auth)
```

**Critical behaviors**:
- Automatically adds `Authorization: Bearer <token>` header
- Adds `X-Provider: google|naver` header for multi-provider token verification
- Logs performance metrics (fetch time, total time)
- Throws errors for unauthenticated requests
- Environment-aware API base URL:
  - Development: `https://inquiryapi-mbi34yrklq-uc.a.run.app` (GCP Cloud Run)
  - Production: `http://192.168.0.100:3001` (OMV NAS)

### Electron IPC Bridge (electron/preload.js)

Exposes safe APIs to renderer process via context isolation:

```javascript
window.electron = {
  platform: 'win32' | 'darwin' | 'linux',
  version: '28.0.0',
  isElectron: true,
  openOAuthWindow: (url) => Promise<{code, state}>,
  clearSession: () => Promise<{success: boolean}>
}
```

**Security**: Uses `contextIsolation: true` to prevent direct Node.js access from renderer.

### State Management Pattern

**No Redux/Zustand** - Uses React built-in state management:
- `authManager.js`: Global auth state via module-level variable + listener pattern
- Components: `useState` + `useEffect` for local state
- Auth listeners: Subscribe pattern for auth state changes across components

## Critical Files for Modifications

### Authentication Changes
- `src/auth/authManager.js` - Unified auth interface, currentUser state
- `src/auth/googleAuth.js` - Pure Google Identity Services (NO Firebase)
- `src/auth/naverAuth.js` - Naver OAuth with Electron IPC detection
- `electron/main.js` - OAuth popup window handling (lines 34-99)
- `electron/preload.js` - IPC API exposure
- `src/firebase/config.js` - **Placeholder only** (exports null, not used)

### API Integration Changes
- `src/config/api.js` - API endpoints, base URL, authenticated request wrapper
- `src/services/inquiryService.js` - Consultation CRUD operations
- `src/services/smsService.js` - SMS sending

### UI Component Changes
- `src/components/LoginPage.jsx` - Login interface, OAuth button handlers
- `src/components/ConsultationTable.jsx` - Main data table, bulk operations
- `src/components/ConsultationModal.jsx` - Detail modal, edit form
- `src/components/SearchBar.jsx` - Filtering and search logic

### Build Configuration
- `package.json` - Electron builder config (lines 36-54)
- `vite.config.js` - Vite bundler settings
- `electron/main.js` - Window creation, dev vs production loading (lines 7-30)

## Environment Configuration

### Development (.env.development)
```env
VITE_API_URL=https://inquiryapi-mbi34yrklq-uc.a.run.app  # GCP API for testing
VITE_GOOGLE_CLIENT_ID=...
VITE_NAVER_CLIENT_ID=...
VITE_NAVER_CLIENT_SECRET=...
VITE_NAVER_REDIRECT_URI=http://localhost:5173/naver-callback.html
```

### Production (.env.production)
```env
VITE_API_URL=http://192.168.0.100:3001  # Local NAS API
VITE_GOOGLE_CLIENT_ID=...
VITE_NAVER_CLIENT_ID=...
VITE_NAVER_CLIENT_SECRET=...
VITE_NAVER_REDIRECT_URI=app://aps-admin/naver-callback  # Electron custom protocol
```

**Important**: Vite env vars must be prefixed with `VITE_` to be exposed to frontend.

## Backend API Server (Separate Deployment)

**Not in this repository** - Backend runs separately on OMV NAS PC:

- **Location**: `/opt/aps-backend/` on NAS
- **Source**: `APSmanager/GCP2/index.js` (legacy reference in this repo)
- **Port**: 3001
- **Setup**: See [ELECTRON_MIGRATION.md](ELECTRON_MIGRATION.md) sections 2.2-2.5
- **Service**: Runs as systemd service (`aps-backend.service`)

**When making API changes**: Coordinate with backend developer to ensure endpoint compatibility.

## Migration Context

This app was migrated from GCP Cloud Run (web app on GitHub Pages) to Electron desktop app with local NAS backend. Key decisions:

1. **Why Electron**: Need desktop app for internal admin users, avoid browser tab management
2. **Why Local Backend**: Cost savings, reduce GCP Cloud Run costs for admin API
3. **Why Keep GCP Firestore**: Robust cloud database, Storage handles attachments, no migration needed
4. **Why Keep GCP Customer Entry**: Public endpoint needs to stay accessible for customer form submissions

**Reference**: [ELECTRON_MIGRATION.md](ELECTRON_MIGRATION.md) for full migration architecture

## Key Architectural Constraints

### OAuth Redirect URIs
- **Development**: Must use `http://localhost:5173` for redirect URI
- **Production**: Must use `app://aps-admin` custom protocol (registered in Electron)
- **Naver OAuth Console**: Both URIs must be registered in Naver Developer Center

### Network Requirements
- **Development**: Internet required (GCP Cloud Run API + Google OAuth)
- **Production**: Local network access to NAS (192.168.0.x) + internet for GCP Firestore/Storage

### Electron Context Isolation
- **Renderer process cannot directly use Node.js APIs**
- All Node.js operations must go through IPC (preload.js bridge)
- Example: File system access, child processes, native dialogs

### Firebase Package Note
- **Frontend (this app)**: `firebase@11.10.0` is in package.json but **NOT USED**
- **Backend (NAS)**: Uses `@google-cloud/firestore` and `@google-cloud/storage` (GCP SDKs)
- **Authentication**: Pure Google Identity Services (accounts.google.com), not Firebase Auth
- The `src/firebase/config.js` file exports null - it's a placeholder only

## Common Patterns

### Adding a New API Endpoint

1. **Add endpoint to src/config/api.js**:
```javascript
export const API_ENDPOINTS = {
  // ... existing endpoints
  NEW_FEATURE: '/new-feature',
};
```

2. **Create service function in src/services/**:
```javascript
import { apiRequest, API_ENDPOINTS } from '../config/api.js';

export async function callNewFeature(data, auth) {
  return apiRequest(API_ENDPOINTS.NEW_FEATURE, {
    method: 'POST',
    body: JSON.stringify(data),
  }, auth);
}
```

3. **Use in component**:
```javascript
import { callNewFeature } from '../services/yourService.js';
import { getCurrentUser } from '../auth/authManager.js';

const auth = { currentUser: getCurrentUser() };
const result = await callNewFeature(data, auth);
```

### Adding a New Electron IPC Handler

1. **Add IPC handler in electron/main.js**:
```javascript
ipcMain.handle('your-channel', async (event, arg) => {
  // Your Node.js logic here
  return result;
});
```

2. **Expose in electron/preload.js**:
```javascript
contextBridge.exposeInMainWorld('electron', {
  // ... existing APIs
  yourNewApi: (arg) => ipcMain.invoke('your-channel', arg),
});
```

3. **Call from React**:
```javascript
if (window.electron) {
  const result = await window.electron.yourNewApi(arg);
}
```

### Adding a New React Component

1. Create `src/components/YourComponent.jsx` and `YourComponent.css`
2. Import and use in parent component
3. Follow existing CSS module pattern (scoped styles)
4. Use existing modal components (`AlertModal`, `ConfirmModal`) for dialogs

## Testing Notes

**No automated tests configured** - This project currently relies on manual testing.

When testing:
- Test both Google and Naver OAuth flows
- Test both development (Vite dev server) and production (built app) modes
- Test Electron-specific features (OAuth popups, IPC)
- Verify API calls work with both GCP (dev) and NAS (production) backends
- Check console for performance logs (API request timing)

## Deployment

**Desktop App Distribution**:
1. Update version in `package.json`
2. Run `npm run electron:build`
3. Distribute installers from `dist/`:
   - Windows: `APS Admin Setup 1.0.0.exe`
   - Linux: `APS-Admin-1.0.0.AppImage`

**Backend Deployment**:
- See [ELECTRON_MIGRATION.md](ELECTRON_MIGRATION.md) Section 2 for NAS server setup
- Backend updates require SSH to NAS and `systemctl restart aps-backend`
- Backend uses GCP service account JSON for Firestore/Storage access

## Legacy Reference Code

`APSmanager/` directory contains the original GCP-based system:
- `GCP/` - Customer inquiry form (Cloud Run)
- `GCP2/` - Admin API server (Cloud Run) - **source for current NAS backend**
- `GCP3/` - SMS relay service (Cloud Run/VM)
- `GCP-cleanup/` - Auto-delete function (Cloud Function)

**Do not modify** - This is reference code only. Current app is in `src/` and `electron/`.
