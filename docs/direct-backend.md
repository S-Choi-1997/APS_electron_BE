# Direct Backend Connection

The Electron app can connect directly to the backend instead of routing normal app traffic through the GCP relay. If Cloudflare Tunnel is used, point the tunnel ingress at the backend host and port.

## App Runtime Configuration

Release builds use these inputs:

```env
VITE_API_URL=https://api.example.com
VITE_WS_URL=wss://api.example.com
VITE_BACKEND_ENVIRONMENT=production
```

`VITE_API_URL` is required for release builds. `VITE_WS_URL` is optional. If it is omitted, the packaged AppConfig derives the WebSocket URL from the API URL:

```text
https://api.example.com -> wss://api.example.com
http://192.168.0.100:3001 -> ws://192.168.0.100:3001
```

During `npm run electron:build`, `app/scripts/generate-app-config.js` writes `app/electron/app-config.default.json`. That generated file is ignored by git but included in the packaged Electron app. The main process reads it as the packaged default before a user-specific config exists.

The same values can be supplied as runtime environment variables for local or operational overrides:

```env
APS_API_URL=https://api.example.com
APS_WS_URL=wss://api.example.com
APS_BACKEND_ENVIRONMENT=production
```

`VITE_RELAY_ENVIRONMENT` remains a compatibility fallback for older release setups, but direct backend releases should use `VITE_BACKEND_ENVIRONMENT`.

The app no longer falls back to the old relay address for direct app traffic. If no saved or bundled AppConfig exists, development fallback remains localhost-oriented.

## Backend Runtime

The backend accepts the existing HTTP API and Socket.IO connections on the same server port.

For direct app operation without relay-managed app traffic, set:

```env
RELAY_ENABLED=false
BACKEND_ENVIRONMENT=production
```

On the NAS, create `nas-deploy/.env` from `nas-deploy/.env.example` only if `.env` does not already exist, then fill the real values before running Docker Compose. After startup, `GET /` should report `relayEnabled: false` and `directWebSocket.enabled: true`.

Customer web consultation intake remains outside this direct app path. SMS also remains relay-backed because the SMS provider depends on the fixed-IP server path. In this structure, the app talks directly to the backend for app features, while web intake and SMS keep their existing server/API dependencies.
