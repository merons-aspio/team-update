# Team Updates

A self-contained, single-page HTML tool for creating and sharing team updates. Uses Supabase for persistence and localStorage as a fallback.

## Features

- Write and publish updates with Markdown support
- Save to Supabase (with localStorage fallback)
- Share read-only presentation links via hash URLs
- Viewer mode: shared links auto-enter presentation mode
- Editor mode: open with `?edit=1` to edit

## Deployment on Vercel

1. Push this repository to GitHub
2. Go to [Vercel](https://vercel.com) and click **"Add New Project"**
3. Import your `team-update` repository
4. Click **Deploy** — no build command needed (static HTML)

Your app will be live at `https://team-update.vercel.app` (or your custom domain).

## Usage

- **Editor:** Open `https://your-domain.vercel.app?edit=1` and enter the admin password to create/edit updates
- **Viewer:** Open a shared link like `https://your-domain.vercel.app#u-xxx` for read-only presentation
- **Publish:** Click "Publish" to save to Supabase; updates persist across reloads

### Authentication

Editor access is password-protected. Open `?edit=1` to unlock:

- **Password:** `admin123` (change the `ADMIN_PASSWORD` constant in `index.html`)
- Auth lasts for the browser session (sessionStorage)
- Shared links (`#u-xxx`) always open in read-only presentation mode — viewers cannot edit or delete


## Tech

- HTML + CSS + vanilla JavaScript
- Supabase (@supabase/supabase-js) for backend
- marked.js + DOMPurify for Markdown rendering
