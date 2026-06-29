import { describe, expect, it } from "vitest";
import {
  compatModelIdForEndpoint,
  endpointIdFromCompatModel,
  getModelContextLimit,
  indexedLocalModelId,
  isCompatModelId,
  migrateLegacyCompatEndpoint,
  modelKeepsReasoning,
  parseCompatModelId,
  parseIndexedLocalModelId,
  resolveModel,
  type CustomEndpoint,
} from "./config";

const endpoint: CustomEndpoint = {
  id: "ab12cd34",
  name: "My LLM",
  baseURL: "https://api.example.com/v1",
  modelIds: ["llama-3.3-70b", "qwen3-max"],
  contextLimit: 64_000,
};

describe("compat model id helpers", () => {
  it("builds indexed compat model ids", () => {
    const mid0 = compatModelIdForEndpoint(endpoint.id, 0);
    const mid1 = compatModelIdForEndpoint(endpoint.id, 1);
    expect(mid0).toBe("compat-ab12cd34-0");
    expect(mid1).toBe("compat-ab12cd34-1");
    expect(isCompatModelId(mid0)).toBe(true);
    expect(isCompatModelId(mid1)).toBe(true);
  });

  it("parses indexed compat model ids", () => {
    const parsed = parseCompatModelId("compat-ab12cd34-1");
    expect(parsed).toEqual({ endpointId: "ab12cd34", modelIndex: 1 });
  });

  it("parses legacy non-indexed compat model ids as index 0", () => {
    const parsed = parseCompatModelId("compat-ab12cd34");
    expect(parsed).toEqual({ endpointId: "ab12cd34", modelIndex: 0 });
  });

  it("returns null for non-compat ids", () => {
    expect(parseCompatModelId("gpt-5.4-mini")).toBeNull();
    expect(endpointIdFromCompatModel("gpt-5.4-mini")).toBe("");
  });
});

describe("indexed local model id helpers", () => {
  it("builds indexed local model ids", () => {
    expect(indexedLocalModelId("lmstudio", 0)).toBe("lmstudio-local-0");
    expect(indexedLocalModelId("ollama", 2)).toBe("ollama-local-2");
  });

  it("parses indexed local model ids", () => {
    expect(parseIndexedLocalModelId("lmstudio-local-0")).toEqual({
      provider: "lmstudio",
      modelIndex: 0,
    });
    expect(parseIndexedLocalModelId("ollama-local-3")).toEqual({
      provider: "ollama",
      modelIndex: 3,
    });
  });

  it("returns null for non-local ids", () => {
    expect(parseIndexedLocalModelId("gpt-5.4-mini")).toBeNull();
    expect(parseIndexedLocalModelId("lmstudio")).toBeNull();
  });
});

describe("resolveModel", () => {
  it("resolves an indexed compat model id against its endpoint", () => {
    const mid = compatModelIdForEndpoint(endpoint.id, 0);
    const info = resolveModel(mid, [endpoint]);
    expect(info.provider).toBe("openai-compatible");
    expect(info.id).toBe(mid);
    expect(info.label).toBe("llama-3.3-70b");
  });

  it("resolves the second model of an endpoint", () => {
    const mid = compatModelIdForEndpoint(endpoint.id, 1);
    const info = resolveModel(mid, [endpoint]);
    expect(info.label).toBe("qwen3-max");
  });

  it("falls back to a placeholder when the endpoint is gone", () => {
    const info = resolveModel(
      compatModelIdForEndpoint("missing", 0),
      [],
    );
    expect(info.provider).toBe("openai-compatible");
  });

  it("resolves a static model id from the registry", () => {
    expect(resolveModel("gpt-5.4-mini").provider).toBe("openai");
  });

  it("throws on an unknown static model id", () => {
    expect(() => resolveModel("nope-not-real")).toThrow();
  });
});

describe("getModelContextLimit", () => {
  it("uses the per-endpoint override for compat models", () => {
    const mid = compatModelIdForEndpoint(endpoint.id, 0);
    expect(getModelContextLimit(mid, endpoint.contextLimit)).toBe(64_000);
  });

  it("reads the static table for known models", () => {
    expect(getModelContextLimit("claude-opus-4-7")).toBe(200_000);
  });
});

describe("modelKeepsReasoning", () => {
  it("keeps reasoning for compat endpoints (freeform provider)", () => {
    const info = resolveModel(
      compatModelIdForEndpoint(endpoint.id, 0),
      [endpoint],
    );
    expect(modelKeepsReasoning(info)).toBe(true);
  });

  it("drops reasoning for plain non-reasoning models", () => {
    expect(modelKeepsReasoning(resolveModel("gpt-5.4-mini"))).toBe(false);
  });

  it("keeps reasoning for tagged reasoning models", () => {
    expect(modelKeepsReasoning(resolveModel("claude-opus-4-7"))).toBe(true);
  });
});

describe("migrateLegacyCompatEndpoint", () => {
  it("migrates a fully configured legacy endpoint", () => {
    const out = migrateLegacyCompatEndpoint(
      "https://api.example.com/v1",
      "llama-3.3-70b",
      32_000,
      "fixedid1",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "fixedid1",
      baseURL: "https://api.example.com/v1",
      modelIds: ["llama-3.3-70b"],
      contextLimit: 32_000,
    });
  });

  it("skips migration when base URL or model id is missing", () => {
    expect(migrateLegacyCompatEndpoint("", "m", 1, "x")).toEqual([]);
    expect(migrateLegacyCompatEndpoint("u", "  ", 1, "x")).toEqual([]);
  });
});
