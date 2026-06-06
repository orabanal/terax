import { emit, listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { loadSkills, newSkillId, saveSkills, type Skill } from "../lib/skills";

const CHANGED_EVENT = "terax://ai-skills-changed";

type State = {
  hydrated: boolean;
  skills: Skill[];
  hydrate: () => Promise<void>;
  upsert: (skill: Skill) => void;
  remove: (id: string) => void;
};

let initialized = false;

export const useSkillsStore = create<State>((set, get) => ({
  hydrated: false,
  skills: [],
  hydrate: async () => {
    if (initialized) return;
    initialized = true;
    set({ skills: await loadSkills(), hydrated: true });
    void listen(CHANGED_EVENT, async () => {
      set({ skills: await loadSkills() });
    });
  },
  upsert: (skill) => {
    const list = get().skills;
    const idx = list.findIndex((s) => s.id === skill.id);
    const next =
      idx === -1
        ? [...list, skill]
        : list.map((s) => (s.id === skill.id ? skill : s));
    set({ skills: next });
    void saveSkills(next).then(() => emit(CHANGED_EVENT));
  },
  remove: (id) => {
    const next = get().skills.filter((s) => s.id !== id);
    set({ skills: next });
    void saveSkills(next).then(() => emit(CHANGED_EVENT));
  },
}));

export { newSkillId };
