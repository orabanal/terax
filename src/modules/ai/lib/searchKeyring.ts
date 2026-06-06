import { invoke } from "@tauri-apps/api/core";

const SEARCH_SERVICE = "terax-websearch";

export type SearchProviderId = "tavily" | "exa" | "bocha" | "zhipu" | "searxng";

const ACCOUNTS: Record<SearchProviderId, string> = {
  tavily: "tavily-api-key",
  exa: "exa-api-key",
  bocha: "bocha-api-key",
  zhipu: "zhipu-api-key",
  searxng: "",
};

export async function getSearchKey(
  provider: SearchProviderId,
): Promise<string | null> {
  const account = ACCOUNTS[provider];
  if (!account) return null;
  try {
    const v = await invoke<string | null>("secrets_get", {
      service: SEARCH_SERVICE,
      account,
    });
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function setSearchKey(
  provider: SearchProviderId,
  key: string,
): Promise<void> {
  const account = ACCOUNTS[provider];
  if (!account) throw new Error(`${provider} does not use an API key`);
  const trimmed = key.trim();
  if (!trimmed) throw new Error("API key is empty");
  await invoke("secrets_set", {
    service: SEARCH_SERVICE,
    account,
    password: trimmed,
  });
}

export async function clearSearchKey(
  provider: SearchProviderId,
): Promise<void> {
  const account = ACCOUNTS[provider];
  if (!account) return;
  try {
    await invoke("secrets_delete", { service: SEARCH_SERVICE, account });
  } catch {
    // already absent
  }
}
