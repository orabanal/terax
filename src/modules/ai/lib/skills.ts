import { LazyStore } from "@tauri-apps/plugin-store";

export type Skill = {
  id: string;
  name: string;
  description: string;
  prompt: string;
};

const STORE_PATH = "terax-ai-skills.json";
const KEY_LIST = "skills";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export async function loadSkills(): Promise<Skill[]> {
  return (await store.get<Skill[]>(KEY_LIST)) ?? [];
}

export async function saveSkills(list: Skill[]): Promise<void> {
  await store.set(KEY_LIST, list);
  await store.save();
}

export function newSkillId(): string {
  return `sk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function normalizeName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isValidSkillName(n: string): boolean {
  return NAME_RE.test(n);
}

export function expandSkillTemplate(prompt: string, selection?: string): string {
  if (!selection) return prompt;
  return prompt.replace(/\{\{selection\}\}/g, selection);
}
