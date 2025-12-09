# Deployment Guide

This guide covers the deployment setup for both frontend and backend with Google and Naver OAuth integration.

## Frontend Deployment (GitHub Pages)

### Automated Deployment with GitHub Actions

The project uses GitHub Actions for automatic deployment. Simply push to the `allfiles` branch and GitHub will automatically build and deploy to the `main` branch (GitHub Pages).

**Setup Steps:**

1. Go to your GitHub repository → Settings → Secrets and variables → Actions
2. Add the following secrets:
   - `VITE_API_URL`: `https://inquiryapi-759991718457.us-central1.run.app`
   - `VITE_GOOGLE_CLIENT_ID`: Your Google OAuth Client ID
   - `VITE_NAVER_CLIENT_ID`: Your Naver OAuth Client ID
   - `VITE_NAVER_CLIENT_SECRET`: Your Naver OAuth Client Secret

3. Push to `allfiles` branch:
   ```bash
   git add .
   git commit -m "Your commit message"
   git push origin allfiles
   ```

4. GitHub Actions will automatically:
   - Install dependencies
   - Build the project with production environment variables
   - Deploy to `main` branch
   - GitHub Pages serves from `main` branch

**Manual Deployment (Alternative)**

If you prefer manual deployment, use the PowerShell script:
```powershell
.\scripts\build-and-push.ps1
```

### Environment Files

The project uses different environment files for development and production:

- **Development**: `.env` (localhost)
- **Production**: Environment variables are set via GitHub Secrets (for CI/CD) or `.env.production` (for manual builds)

### Environment Variables

#### Development (`.env`)
```env
VITE_API_URL=https://inquiryapi-759991718457.us-central1.run.app
VITE_GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID
VITE_NAVER_CLIENT_ID=YOUR_NAVER_CLIENT_ID
VITE_NAVER_CLIENT_SECRET=YOUR_NAVER_CLIENT_SECRET
VITE_NAVER_REDIRECT_URI=http://localhost:5173/naver-callback.html
```

#### Production (`.env.production`)
```env
VITE_API_URL=https://inquiryapi-759991718457.us-central1.run.app
VITE_GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID
VITE_NAVER_CLIENT_ID=YOUR_NAVER_CLIENT_ID
VITE_NAVER_CLIENT_SECRET=YOUR_NAVER_CLIENT_SECRET
VITE_NAVER_REDIRECT_URI=https://s-choi-1997.github.io/APSmanager/naver-callback.html
```

### OAuth Provider Setup

#### Google OAuth
1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create OAuth 2.0 Client ID
3. Add authorized JavaScript origins:
   - `http://localhost:5173` (development)
   - `https://s-choi-1997.github.io` (production)
4. No redirect URIs needed (uses popup flow)

#### Naver OAuth
1. Go to [Naver Developers](https://developers.naver.com/apps)
2. Register your application
3. Add callback URLs (both required):
   - `http://localhost:5173/naver-callback.html` (development)
   - `https://s-choi-1997.github.io/APSmanager/naver-callback.html` (production)
4. Copy Client ID and Client Secret to `.env` files

### Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production (uses .env.production if exists, otherwise uses .env)
npm run build

# Preview production build locally
npm run preview
```

## Backend Deployment (GCP Cloud Run)

### Environment Variables

Backend uses `GCP2/.env` for environment variables:

```env
# CORS allowed origins (comma-separated)
ALLOWED_ORIGINS=https://s-choi-1997.github.io,http://localhost:5173

# Whitelist of allowed admin emails (comma-separated)
ALLOWED_EMAILS=email1@gmail.com,email2@gmail.com

# Firebase Storage Bucket
STORAGE_BUCKET=aps-list
```

### Deploy Backend

```powershell
# From GCP2 directory
cd GCP2
.\deploy.ps1
```

Or manually:

```bash
gcloud functions deploy inquiryApi \
  --runtime nodejs20 \
  --region asia-northeast3 \
  --entry-point api \
  --trigger-http \
  --allow-unauthenticated \
  --env-vars-file .env
```

### Adding New Allowed Emails

To allow access for new users:

1. Add their email to `ALLOWED_EMAILS` in `GCP2/.env`
2. Redeploy: `.\deploy.ps1`

**Note**: Both Google and Naver login emails are checked against this whitelist.

## Provider-Based Authentication

The backend automatically detects authentication provider from the `X-Provider` header:

- **Google**: Validates token via Google's tokeninfo API
- **Naver**: Validates token via Naver's user info API

Both providers check against the same `ALLOWED_EMAILS` whitelist.

## Troubleshooting

### Naver Login Fails in Production

1. Check that callback URL is registered in Naver Developers Console
2. Verify `.env.production` has correct production callback URL
3. Ensure build was done with production environment (`npm run build`)
4. Check browser console for redirect URI mismatch errors

### API CORS Errors

1. Add your domain to `ALLOWED_ORIGINS` in `GCP2/.env`
2. Redeploy backend: `cd GCP2 && .\deploy.ps1`

### 403 Forbidden After Login

1. Check that user's email is in `ALLOWED_EMAILS` in `GCP2/.env`
2. Verify email matches exactly (case-sensitive)
3. Redeploy backend if changed

### Session Not Persisting

1. Clear browser localStorage: `localStorage.clear()`
2. Check that provider field is included in user object
3. Verify token is not expired

## Production URLs

- **Frontend**: https://s-choi-1997.github.io/APSmanager/
- **Backend API**: https://inquiryapi-759991718457.us-central1.run.app
- **Naver Callback**: https://s-choi-1997.github.io/APSmanager/naver-callback.html

## Security Notes

⚠️ **Never commit sensitive credentials:**
- `.env` files are in `.gitignore`
- Use environment variables for production secrets
- Rotate credentials regularly
- Review `ALLOWED_EMAILS` periodically
- Keep Naver Client Secret confidential
