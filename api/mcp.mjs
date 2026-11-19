import { timingSafeEqual } from "node:crypto";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createClient } from "@supabase/supabase-js";
import * as z from "zod/v4";

const DEFAULT_SUPABASE_URL = "https://ozbnducbpvbdewyerbkn.supabase.co";
const SERVER_NAME = "team-updates";
const SERVER_VERSION = "1.0.0";
const UPDATE_TYPES = ["Weekly", "Daily"];
const MAX_CONTENT_CHARS = 1_000_000;

// The service-role key is server-only. It is never sent to the browser.
const SUPABASE_URL = (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

let adminClient = null;
function admin() {
  if (!SERVICE_KEY) {
    throw new Error("MCP server is missing SUPABASE_SERVICE_ROLE_KEY in Vercel.");
  }
  if (!adminClient) {
    adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function firstHeader(value) {
  if (Array.isArray(value)) return value[0] || "";
  return typeof value === "string" ? value : "";
}

function secretFromRequest(req) {
  const url = new URL(req.url || "/", "https://placeholder.local");
  const fromQuery = url.searchParams.get("key") || url.searchParams.get("token") || "";
  if (fromQuery.trim()) return fromQuery.trim();

  const auth = firstHeader(req.headers.authorization).trim();
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function secretIsValid(secret) {
  const { data, error } = await admin()
    .from("mcp_config")
    .select("token")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("MCP config lookup failed:", error.message);
    throw new Error("MCP config is unavailable. Run supabase/mcp.sql in the Supabase SQL Editor.");
  }
  return !!data?.token && safeEqual(String(data.token), secret);
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function cleanTitle(value) {
  return decodeEntities(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function deriveTitle(raw) {
  const text = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (/^<!doctype\s+html/i.test(text) || /^<html[\s>]/i.test(text)) {
    const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const heading = text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
    return cleanTitle(title || heading) || "HTML update";
  }

  const first = text.split("\n").map((line) => line.trim()).find(Boolean) || "";
  if (/^```(?:html|htm)\b/i.test(first)) {
    const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const heading = text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
    return cleanTitle(title || heading) || "HTML update";
  }

  return cleanTitle(first.replace(/^#+\s*/, "")) || "Untitled";
}

function displayTitle(row) {
  return cleanTitle(row?.custom) || cleanTitle(row?.title) || deriveTitle(row?.raw) || "Untitled";
}

function parseDate(value) {
  if (typeof value === "number") return new Date(value);
  const text = String(value || "").trim();
  if (!text) return null;
  // The app stores epoch milliseconds as numbers. Older docs called these
  // timestamptz, so accept numeric strings and ISO strings too.
  const date = /^\d+$/.test(text) ? new Date(Number(text)) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value) {
  const date = parseDate(value);
  return date ? date.toISOString() : "";
}

function formatDate(value) {
  const date = parseDate(value);
  return date ? date.toISOString().slice(0, 10) : "unknown date";
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || "" : String(value || "");
}

function appBaseUrl(requestInfo) {
  let configured = (process.env.PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  if (configured) {
    if (!/^https?:\/\//i.test(configured)) configured = `https://${configured}`;
    return configured;
  }
  try {
    const url = new URL(requestInfo.url);
    // The Node adapter builds requestInfo with an http:// URL, so trust
    // Vercel's forwarded headers and default to https outside localhost.
    const host =
      headerValue(requestInfo.headers, "x-forwarded-host") ||
      headerValue(requestInfo.headers, "host") ||
      url.host;
    const forwardedProto = headerValue(requestInfo.headers, "x-forwarded-proto")
      .split(",")[0]
      .trim();
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
    const proto = forwardedProto || (isLocal ? "http" : "https");
    return `${proto}://${host}`;
  } catch (_) {
    return "https://team-update.vercel.app";
  }
}

function shareUrl(baseUrl, id) {
  return `${baseUrl}/#${id}`;
}

function publicUpdate(row, baseUrl) {
  return {
    id: String(row.id),
    title: displayTitle(row),
    type: UPDATE_TYPES.includes(row.type) ? row.type : "Weekly",
    at: toIso(row.at),
    updatedAt: toIso(row.updatedAt),
    url: shareUrl(baseUrl, row.id),
  };
}

async function fetchUpdate(id) {
  const { data, error } = await admin()
    .from("updates")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read update: ${error.message}`);
  return data;
}

function buildServer(ctx) {
  const baseUrl = appBaseUrl(ctx.requestInfo);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "list_team_updates",
    {
      title: "List team updates",
      description:
        "List published team updates, newest first. Returns each update's id, title, type, date, and share link. Use get_team_update to read the full content.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum number of updates to return. Defaults to 10."),
        type: z
          .enum(UPDATE_TYPES)
          .optional()
          .describe("Only return updates of this type (Weekly or Daily)."),
      }),
      outputSchema: z.object({
        count: z.number(),
        updates: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            type: z.enum(UPDATE_TYPES),
            at: z.string(),
            updatedAt: z.string(),
            url: z.string(),
          })
        ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit, type }) => {
      let query = admin()
        .from("updates")
        .select("*")
        .order("at", { ascending: false })
        .limit(limit ?? 10);
      if (type) query = query.eq("type", type);

      const { data, error } = await query;
      if (error) throw new Error(`Could not list updates: ${error.message}`);

      const updates = (data || []).map((row) => publicUpdate(row, baseUrl));
      const lines = updates.length
        ? updates
            .map(
              (update) =>
                `- ${update.title} (${update.type}, ${formatDate(update.at)})\n  id: ${update.id}\n  link: ${update.url}`
            )
            .join("\n")
        : "No updates found.";

      return {
        content: [{ type: "text", text: `Found ${updates.length} update(s):\n\n${lines}` }],
        structuredContent: { count: updates.length, updates },
      };
    }
  );

  server.registerTool(
    "get_team_update",
    {
      title: "Get a team update",
      description:
        "Read one published team update by id. Returns its full source (Markdown or HTML), metadata, and share link.",
      inputSchema: z.object({
        id: z.string().min(1).max(200).describe("The update id, for example u-mabc123."),
      }),
      outputSchema: z.object({
        update: z.object({
          id: z.string(),
          title: z.string(),
          type: z.enum(UPDATE_TYPES),
          at: z.string(),
          updatedAt: z.string(),
          url: z.string(),
          content: z.string(),
        }),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const row = await fetchUpdate(id);
      if (!row) throw new Error(`No team update found with id "${id}".`);

      const update = { ...publicUpdate(row, baseUrl), content: String(row.raw || "") };
      const text = [
        `# ${update.title}`,
        "",
        `Type: ${update.type}`,
        `Date: ${formatDate(update.at)}`,
        `ID: ${update.id}`,
        `Share link: ${update.url}`,
        "",
        "---",
        "",
        update.content,
      ].join("\n");

      return {
        content: [{ type: "text", text }],
        structuredContent: { update },
      };
    }
  );

  server.registerTool(
    "create_team_update",
    {
      title: "Create a team update",
      description:
        "Publish a new team update immediately. Content can be Markdown (auto-formatted by the app) or a complete HTML page. Fenced ```html blocks become live previews. Returns the new id and share link.",
      inputSchema: z.object({
        content: z
          .string()
          .min(1)
          .max(MAX_CONTENT_CHARS)
          .describe("The full update source: Markdown text or a complete HTML document."),
        title: z
          .string()
          .max(200)
          .optional()
          .describe("Optional title. When omitted, a title is derived from the content."),
        type: z
          .enum(UPDATE_TYPES)
          .optional()
          .describe("Update type. Defaults to Weekly."),
      }),
      outputSchema: z.object({
        update: z.object({
          id: z.string(),
          title: z.string(),
          type: z.enum(UPDATE_TYPES),
          at: z.string(),
          updatedAt: z.string(),
          url: z.string(),
        }),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ content, title, type }) => {
      const now = Date.now();
      const id = `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const custom = cleanTitle(title);
      const record = {
        id,
        raw: content,
        type: type || "Weekly",
        custom,
        title: custom || deriveTitle(content),
        at: now,
        updatedAt: now,
      };

      const { data, error } = await admin().from("updates").insert(record).select("*").single();
      if (error) throw new Error(`Could not publish update: ${error.message}`);

      const update = publicUpdate(data, baseUrl);
      return {
        content: [
          {
            type: "text",
            text: `Published "${update.title}" (${update.type}).\nID: ${update.id}\nShare link: ${update.url}`,
          },
        ],
        structuredContent: { update },
      };
    }
  );

  server.registerTool(
    "update_team_update",
    {
      title: "Update a team update",
      description:
        "Edit an existing team update. Only supplied fields change; the original publish date is preserved. Use get_team_update first to read the current source.",
      inputSchema: z
        .object({
          id: z.string().min(1).max(200).describe("The update id to edit."),
          content: z
            .string()
            .min(1)
            .max(MAX_CONTENT_CHARS)
            .optional()
            .describe("New full source: Markdown text or a complete HTML document."),
          title: z
            .string()
            .max(200)
            .optional()
            .describe("New title. Send an empty string to clear it and derive from content."),
          type: z.enum(UPDATE_TYPES).optional().describe("New update type."),
        })
        .refine(
          (value) =>
            value.content !== undefined || value.title !== undefined || value.type !== undefined,
          { message: "Provide at least one of content, title, or type." }
        ),
      outputSchema: z.object({
        update: z.object({
          id: z.string(),
          title: z.string(),
          type: z.enum(UPDATE_TYPES),
          at: z.string(),
          updatedAt: z.string(),
          url: z.string(),
        }),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ id, content, title, type }) => {
      const existing = await fetchUpdate(id);
      if (!existing) throw new Error(`No team update found with id "${id}".`);

      const patch = { updatedAt: Date.now() };
      if (content !== undefined) patch.raw = content;
      if (type !== undefined) patch.type = type;

      if (title !== undefined) {
        patch.custom = cleanTitle(title);
        patch.title = patch.custom || deriveTitle(content !== undefined ? content : existing.raw);
      } else if (content !== undefined && !cleanTitle(existing.custom)) {
        patch.title = deriveTitle(content);
      }

      const { data, error } = await admin()
        .from("updates")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(`Could not update the update: ${error.message}`);

      const update = publicUpdate(data, baseUrl);
      return {
        content: [
          {
            type: "text",
            text: `Updated "${update.title}" (${update.type}).\nID: ${update.id}\nShare link: ${update.url}`,
          },
        ],
        structuredContent: { update },
      };
    }
  );

  return server;
}

const mcpHandler = createMcpHandler(buildServer, {
  legacy: "stateless",
  onerror: (error) => console.error("MCP handler error:", error?.message || error),
});

const nodeHandler = toNodeHandler(mcpHandler, {
  onerror: (error) => console.error("MCP node adapter error:", error?.message || error),
});

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID"
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Mcp-Session-Id, Mcp-Protocol-Version"
  );
  res.setHeader("Cache-Control", "no-store");
}

function sendJson(res, status, body) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export { buildServer, mcpHandler };

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    if (!SERVICE_KEY) {
      sendJson(res, 500, {
        error: "not_configured",
        message:
          "MCP server is missing SUPABASE_SERVICE_ROLE_KEY in Vercel. Add it under Settings → Environment Variables and redeploy.",
      });
      return;
    }

    const secret = secretFromRequest(req);
    if (!secret) {
      sendJson(res, 403, {
        error: "invalid_secret",
        message: "Invalid or missing MCP secret. Use the URL from the app's MCP dialog.",
      });
      return;
    }

    let valid = false;
    try {
      valid = await secretIsValid(secret);
    } catch (configError) {
      console.error("MCP config error:", configError?.message || configError);
      sendJson(res, 500, { error: "mcp_unavailable", message: configError.message });
      return;
    }
    if (!valid) {
      sendJson(res, 403, {
        error: "invalid_secret",
        message: "Invalid or missing MCP secret. Use the URL from the app's MCP dialog.",
      });
      return;
    }

    // Pass-through auth info for MCP tool handlers.
    req.auth = {
      token: secret,
      clientId: "team-updates",
      scopes: ["updates:read", "updates:write"],
    };

    const parsedBody = req.method === "POST" ? req.body : undefined;
    await nodeHandler(req, res, parsedBody);
  } catch (error) {
    console.error("MCP endpoint error:", error?.message || error);
    sendJson(res, 500, {
      error: "server_error",
      message: "The MCP server could not complete the request. Check the Vercel function logs.",
    });
  }
}
