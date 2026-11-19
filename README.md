# Team Updates

A self-contained, single-page HTML tool for creating and sharing team updates. Uses Supabase Auth (email/password) for editor access and Supabase for persistence.

## Features

- Write and publish updates with Markdown support
- Embed interactive HTML pages as collapsible live previews
- Save to Supabase (with localStorage fallback)
- Share read-only presentation links via hash URLs
- Viewer mode: shared links auto-enter presentation mode
- Editor mode: email/password authentication required (`?edit=1`)
- MCP helper: connect Claude Desktop or ChatGPT to read, create, and edit updates

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
- **Columns:** `id` (text, primary key), `raw` (text), `type` (text), `custom` (text, nullable), `title` (text, nullable), `at` (bigint, epoch milliseconds), `updatedAt` (bigint, epoch milliseconds)
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
- **Open by default:** in the editor, tick **Open HTML previews by default** to make every HTML preview in that update open automatically, including on shared links. The choice is saved inside the update source as a small `<!-- tu-html-open -->` comment; untick it to return to collapsed.
- **Full-width viewing:** shared links and presentation mode use the full viewport width instead of a narrow centered column.
- **Sandboxed:** embedded pages can run their own scripts (charts, buttons, animations) but cannot access the app, its login session, or local storage. Use CDN or inline assets; local file references won't work.

### Authentication

- Editor access requires email/password via Supabase Auth
- Sign up for a new account or sign in with existing credentials
- Auth session persists in the browser until you log out
- Shared links (`#u-xxx`) always open in read-only presentation mode — viewers cannot edit or delete

## MCP helper (Claude Desktop / ChatGPT)

The app exposes a remote MCP endpoint at `/api/mcp`. AI clients can list and read updates, publish new updates, and edit existing ones. Delete is intentionally not exposed.

```
Claude Desktop / ChatGPT
          │  Streamable HTTP + secret URL
          ▼
https://your-domain.vercel.app/api/mcp?key=<token>
          │  token checked against Supabase
          ▼
Supabase (service role) → updates table
```

### 1. Create the token table in Supabase

1. Open your project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Go to **SQL Editor → New query**.
3. Paste the contents of [`supabase/mcp.sql`](supabase/mcp.sql) and click **Run**.
4. Go to **Table Editor → `mcp_config`** and confirm there is one row with a UUID in `token`.

The SQL creates a single-row `mcp_config` table, enables Row Level Security, and allows only signed-in users to read or rotate the token.

### 2. Add the server-only key in Vercel

1. In Supabase, go to **Project Settings → API Keys** and reveal the **secret** key (`service_role` or `sb_secret_…`). Do not use the publishable/anon key here.
2. In Vercel, open your project and go to **Settings → Environment Variables**.
3. Add:
   - `SUPABASE_SERVICE_ROLE_KEY` = the secret key from step 1
   - `PUBLIC_APP_URL` = your production URL, for example `https://team-update.vercel.app` (optional, used for share links)
   - `SUPABASE_URL` = your project URL (optional; defaults to the project already used by the app)
4. Select **Production**, **Preview**, and **Development** for the variables.
5. Redeploy: **Deployments → … → Redeploy**. A new deployment is required before the endpoint can use the variables.

Never put the service-role key in `app.js`, `index.html`, or any other browser file. It bypasses RLS and must stay on the server.

### 3. Copy the secret URL from the app

1. Open `https://your-domain.vercel.app?edit=1` and sign in.
2. Click **MCP** in the toolbar.
3. Copy the **Secret MCP URL**.
4. Click **Test connection**. It should say `Connected to team-updates ✓`.

If the dialog says MCP is not configured, step 1 was not run or the SQL failed.

### 4. Connect Claude Desktop

Use a custom connector:

1. Open **Settings → Connectors → Add custom connector**.
2. Name it **Team Updates**.
3. Paste the secret URL.
4. Choose **No authentication**. The secret is part of the URL.
5. Save, then ask Claude to list team updates.

If custom connectors are not available on your plan, add the bridge to `claude_desktop_config.json` instead:

```json
{
  "mcpServers": {
    "team-updates": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://your-domain.vercel.app/api/mcp?key=YOUR-SECRET-TOKEN"
      ]
    }
  }
}
```

Config file locations:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Restart Claude Desktop after editing the file. The app dialog has a **Copy Claude config** button that fills in the URL for you.

### 5. Connect ChatGPT

1. Open **Settings → Connectors → Advanced** and enable **Developer mode**.
2. Create a custom connector.
3. Paste the secret URL.
4. Choose **No authentication**. The secret is already in the URL.
5. Create the connector and ask ChatGPT to list team updates.

Menu names and plan availability can change. The endpoint must be reachable over public HTTPS; `localhost` will not work with ChatGPT.

### 6. Available tools

| Tool | What it does |
| --- | --- |
| `list_team_updates` | Lists updates with ID, title, type, date, and share link. Optional `limit` and `type`. |
| `get_team_update` | Reads one update's full Markdown/HTML source. |
| `create_team_update` | Publishes a new update immediately. Supports Markdown and full HTML pages. |
| `update_team_update` | Edits content, title, or type while preserving the original publish date. |

Example prompts:

- "List the latest team updates."
- "Read update `u-abc123` and summarize the blockers."
- "Create a Weekly update titled 'Payments - 24 Nov' with these bullets: …"
- "Update `u-abc123`: mark the migration item as completed."

### 7. Security and rotation

- The secret URL grants read and publish access. Treat it like a password.
- Click **Regenerate secret** in the MCP dialog to revoke the old URL immediately. Paste the new URL into Claude/ChatGPT afterwards.
- The token is sent in the query string, so it can appear in server or proxy logs. Rotate it if it leaks.
- The service-role key is used only inside `api/mcp.mjs` and never reaches the browser.
- Token rotation is protected by RLS: only signed-in users can read or change it.

### 8. Local testing

```bash
npm install
npx vercel dev
```

Then open `http://localhost:3000?edit=1`, sign in, and open the MCP dialog. Add `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` to `.env.local` first (see `.env.example`).

You can also test with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
```

Choose **Streamable HTTP** and use `http://localhost:3000/api/mcp?key=YOUR-TOKEN`.

## Tech

- HTML + CSS + vanilla JavaScript
- Supabase (@supabase/supabase-js) for backend + Auth
- marked.js + DOMPurify for Markdown rendering
- MCP TypeScript SDK v2 (`@modelcontextprotocol/server` and `@modelcontextprotocol/node`) for the AI helper
- Vercel Node function at `api/mcp.mjs`
