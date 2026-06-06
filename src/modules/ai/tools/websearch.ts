import { tool } from "ai";
import { z } from "zod";
import { getSearchKey } from "../lib/searchKeyring";
import { proxyFetch } from "../lib/proxyFetch";

export type WebSearchConfig = {
  provider: "tavily" | "exa" | "bocha" | "zhipu" | "searxng";
  maxResults: number;
  host: string | null;
};

type ResolvedSearchConfig = WebSearchConfig & { apiKey: string | null };

function buildTavilyRequest(query: string, maxResults: number, apiKey: string) {
  return {
    url: "https://api.tavily.com/search",
    body: JSON.stringify({ query, max_results: maxResults, api_key: apiKey }),
  };
}

function buildExaRequest(query: string, maxResults: number, apiKey: string) {
  return {
    url: "https://api.exa.ai/search",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, numResults: maxResults, contents: { text: { maxCharacters: 500 } } }),
  };
}

function buildBochaRequest(query: string, maxResults: number, apiKey: string) {
  return {
    url: "https://api.bochaai.com/v1/web-search",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, count: maxResults }),
  };
}

function buildZhipuRequest(query: string, _maxResults: number, apiKey: string) {
  return {
    url: "https://open.bigmodel.cn/api/paas/v4/tools",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      tool: "web-search-pro",
      messages: [{ role: "user", content: query }],
      stream: false,
    }),
  };
}

function buildSearxngRequest(query: string, _maxResults: number, host: string) {
  const url = new URL("/search", host);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("pageno", "1");
  return { url: url.toString(), body: undefined as string | undefined, headers: {} as Record<string, string> };
}

type SearchResult = { title: string; url: string; snippet: string };

async function parseResults(
  provider: WebSearchConfig["provider"],
  json: unknown,
): Promise<SearchResult[]> {
  if (!json || typeof json !== "object") return [];

  if (provider === "tavily") {
    const r = json as { results?: Array<{ title: string; url: string; content: string }> };
    return (r.results ?? []).map((x) => ({
      title: x.title ?? "",
      url: x.url ?? "",
      snippet: x.content ?? "",
    }));
  }
  if (provider === "exa") {
    const r = json as { results?: Array<{ title: string; url: string; text?: string }> };
    return (r.results ?? []).map((x) => ({
      title: x.title ?? "",
      url: x.url ?? "",
      snippet: x.text ?? "",
    }));
  }
  if (provider === "bocha") {
    const r = json as { data?: { webPages?: { value?: Array<{ name: string; url: string; snippet: string }> } } };
    return (r.data?.webPages?.value ?? []).map((x) => ({
      title: x.name ?? "",
      url: x.url ?? "",
      snippet: x.snippet ?? "",
    }));
  }
  if (provider === "zhipu") {
    const r = json as { choices?: Array<{ message?: { tool_calls?: Array<{ search_result?: Array<{ title: string; link: string; content: string }> }> } }> };
    const results = r.choices?.[0]?.message?.tool_calls?.[0]?.search_result ?? [];
    return results.map((x) => ({ title: x.title ?? "", url: x.link ?? "", snippet: x.content ?? "" }));
  }
  if (provider === "searxng") {
    const r = json as { results?: Array<{ title: string; url: string; content: string }> };
    return (r.results ?? []).map((x) => ({
      title: x.title ?? "",
      url: x.url ?? "",
      snippet: x.content ?? "",
    }));
  }
  return [];
}

async function runSearch(
  query: string,
  config: ResolvedSearchConfig,
): Promise<SearchResult[]> {
  const { provider, apiKey, maxResults, host } = config;

  let url: string;
  let body: string | undefined;
  let extraHeaders: Record<string, string> = {};

  if (provider === "tavily") {
    if (!apiKey) throw new Error("Tavily API key not configured.");
    const r = buildTavilyRequest(query, maxResults, apiKey);
    url = r.url;
    body = r.body;
  } else if (provider === "exa") {
    if (!apiKey) throw new Error("Exa API key not configured.");
    const r = buildExaRequest(query, maxResults, apiKey);
    url = r.url;
    body = r.body;
    extraHeaders = r.headers;
  } else if (provider === "bocha") {
    if (!apiKey) throw new Error("Bocha API key not configured.");
    const r = buildBochaRequest(query, maxResults, apiKey);
    url = r.url;
    body = r.body;
    extraHeaders = r.headers;
  } else if (provider === "zhipu") {
    if (!apiKey) throw new Error("Zhipu API key not configured.");
    const r = buildZhipuRequest(query, maxResults, apiKey);
    url = r.url;
    body = r.body;
    extraHeaders = r.headers;
  } else if (provider === "searxng") {
    const h = host ?? "";
    if (!h) throw new Error("SearXNG host not configured.");
    const r = buildSearxngRequest(query, maxResults, h);
    url = r.url;
    body = r.body;
  } else {
    throw new Error(`Unknown web search provider: ${String(provider)}`);
  }

  const res = await proxyFetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    ...(body ? { body } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Web search request failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  return parseResults(provider, json);
}

export function buildWebSearchTools(getConfig: () => WebSearchConfig | null): Record<string, unknown> {
  const config = getConfig();
  if (!config) return {};

  return {
    web_search: tool({
      description:
        "Search the web for current information. Use when the user asks about recent events, documentation, packages, or anything requiring up-to-date knowledge beyond your training data. Returns a list of results with title, URL, and snippet.",
      inputSchema: z.object({
        query: z.string().describe("Search query. Be specific and concise."),
      }),
      execute: async ({ query }) => {
        const cfg = getConfig();
        if (!cfg) return { error: "Web search is not configured." };
        const apiKey = cfg.provider !== "searxng"
          ? await getSearchKey(cfg.provider).catch(() => null)
          : null;
        try {
          const results = await runSearch(query, { ...cfg, apiKey });
          if (results.length === 0) {
            return { results: [], message: "No results found for this query." };
          }
          return { results };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),
  } as const;
}
