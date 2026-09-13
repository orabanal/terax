import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_LITE } from "../config";
import { buildWebSearchTools } from "./websearch";

describe("web_search tool registration", () => {
  it("registers no tool when web search is disabled", () => {
    expect(buildWebSearchTools(() => null)).toEqual({});
  });

  it("registers web_search for a searxng host config", () => {
    const tools = buildWebSearchTools(() => ({
      provider: "searxng",
      maxResults: 5,
      host: "https://busca.qubits.pe/",
    }));
    expect(Object.keys(tools)).toEqual(["web_search"]);
  });
});

describe("system prompt web_search guidance", () => {
  it("full prompt names web_search and prefers it over shell fetching", () => {
    expect(SYSTEM_PROMPT).toContain("web_search");
    expect(SYSTEM_PROMPT).toContain("temperature");
  });

  it("lite prompt names web_search", () => {
    expect(SYSTEM_PROMPT_LITE).toContain("web_search");
  });
});
