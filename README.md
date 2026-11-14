# Team Updates

A self-contained, single-page HTML tool for creating and sharing team updates. Uses Supabase Auth (email/password) for editor access and Supabase for persistence.

## Features

- Write and publish updates with Markdown support
- Embed interactive HTML pages as collapsible live previews
- Save to Supabase (with localStorage fallback)
- Share read-only presentation links via hash URLs
- Viewer mode: shared links auto-enter presentation mode
- Editor mode: email/password authentication required (`?edit=1`)

## Supabase Setup

### 1. Enable Email Auth

In your Supabase project dashboard:
- Go to **Authentication → Settings**
- Enable **Email** provider
- Set **Site URL** to your Vercel domain (e.g., `https://team-update.vercel.app`)
- Add redirect URLs: `https://team-update.vercel.app` and `https://team-update.vercel.app?edit=1`

### 2. Create the `updates` table

In **Table Editor → New Table**:
- **Name:** `updates`
- **Columns:** `id` (text, primary key), `raw` (text), `type` (text), `custom` (text, nullable), `title` (text, nullable), `at` (timestamptz), `updatedAt` (timestamptz)
- Add index: `CREATE INDEX IF NOT EXISTS idx_updates_at ON updates (at DESC);`

### 3. Enable Row Level Security (RLS)

In the SQL Editor, run:

```sql
-- Enable RLS
ALTER TABLE updates ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read (for shared presentation links)
CREATE POLICY "Public read access" ON updates
  FOR SELECT USING (true);

-- Only authenticated users can insert
CREATE POLICY "Authenticated insert" ON updates
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Only authenticated users can update
CREATE POLICY "Authenticated update" ON updates
  FOR UPDATE USING (auth.role() = 'authenticated');

-- Only authenticated users can delete
CREATE POLICY "Authenticated delete" ON updates
  FOR DELETE USING (auth.role() = 'authenticated');
```

## Deployment on Vercel

1. Push this repository to GitHub
2. Go to [Vercel](https://vercel.com) and click **"Add New Project"**
3. Import your `team-update` repository
4. Click **Deploy** — no build command needed (static HTML)

Your app will be live at `https://team-update.vercel.app` (or your custom domain).

## Usage

- **Editor:** Open `https://your-domain.vercel.app?edit=1` — sign in or create an account to unlock editing
- **Viewer:** Open a shared link like `https://your-domain.vercel.app#u-xxx` for read-only presentation (no login required)
- **Publish:** Click "Publish" to save to Supabase; updates persist across reloads
- **Logout:** Click the "Logout" button in the editor toolbar

### HTML previews

Updates can include full interactive HTML pages. They are rendered in an isolated iframe and stay collapsed until clicked.

- **Fenced block:** wrap a snippet or complete page in a fenced `html` block to show it as a live preview alongside normal Markdown:

  ````
  ## Weekly update

  Some notes...

  ```html
  <h1>Live report</h1>
  <canvas id="chart"></canvas>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  ```
  ````

- **Full page:** paste a complete HTML page (starting with `<!DOCTYPE html>` or `<html>`) as the entire update. The whole update becomes that page and the sidebar title is taken from its `<title>` or `<h1>`.
- **Collapsed by default:** every preview starts collapsed on shared links and in the editor. Click its header to open it. The iframe is only created when opened, so collapsed previews don't load external scripts or assets.
- **Sandboxed:** embedded pages can run their own scripts (charts, buttons, animations) but cannot access the app, its login session, or local storage. Use CDN or inline assets; local file references won't work.

### Authentication

- Editor access requires email/password via Supabase Auth
- Sign up for a new account or sign in with existing credentials
- Auth session persists in the browser until you log out
- Shared links (`#u-xxx`) always open in read-only presentation mode — viewers cannot edit or delete

## Tech

- HTML + CSS + vanilla JavaScript
- Supabase (@supabase/supabase-js) for backend + Auth
- marked.js + DOMPurify for Markdown rendering
