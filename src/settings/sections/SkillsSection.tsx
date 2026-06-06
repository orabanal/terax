import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  isValidSkillName,
  normalizeName,
  newSkillId,
  type Skill,
} from "@/modules/ai/lib/skills";
import { useSkillsStore } from "@/modules/ai/store/skillsStore";
import {
  Add01Icon,
  Delete02Icon,
  Edit02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

export function SkillsSection() {
  const skills = useSkillsStore((s) => s.skills);
  const hydrate = useSkillsStore((s) => s.hydrate);
  const upsert = useSkillsStore((s) => s.upsert);
  const remove = useSkillsStore((s) => s.remove);

  const [editing, setEditing] = useState<Skill | null>(null);
  const [isNew, setIsNew] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const openNew = () => {
    setEditing({ id: newSkillId(), name: "", description: "", prompt: "" });
    setIsNew(true);
  };

  const openEdit = (s: Skill) => {
    setEditing({ ...s });
    setIsNew(false);
  };

  const handleSave = (s: Skill) => {
    upsert(s);
    setEditing(null);
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Skills"
        description="Define reusable prompt templates invoked with /name in the AI sidebar."
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11.5px] font-medium text-foreground">
            Custom skills
          </span>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={openNew}>
            <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={2} />
            Add skill
          </Button>
        </div>

        {skills.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center">
            <p className="text-[11.5px] text-muted-foreground">
              No skills yet. Add one to invoke it with /name in the sidebar.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {skills.map((s) => (
              <div
                key={s.id}
                className="flex items-start gap-3 rounded-lg border border-border/60 bg-card px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      /{s.name}
                    </span>
                    {s.description && (
                      <span className="text-[11px] text-foreground">
                        {s.description}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[10.5px] text-muted-foreground">
                    {s.prompt}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(s)}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <HugeiconsIcon icon={Edit02Icon} size={12} strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(s.id)}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <SkillDialog
          skill={editing}
          isNew={isNew}
          existingNames={skills.filter((s) => s.id !== editing.id).map((s) => s.name)}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SkillDialog({
  skill,
  isNew,
  existingNames,
  onSave,
  onCancel,
}: {
  skill: Skill;
  isNew: boolean;
  existingNames: string[];
  onSave: (s: Skill) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [prompt, setPrompt] = useState(skill.prompt);

  const normalizedName = normalizeName(name);
  const nameError = normalizedName.length > 0 && !isValidSkillName(normalizedName)
    ? "Only lowercase letters, numbers and dashes."
    : existingNames.includes(normalizedName) && normalizedName !== skill.name
    ? "A skill with this name already exists."
    : null;
  const canSave = normalizedName.length > 0 && !nameError && prompt.trim().length > 0;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {isNew ? "New skill" : "Edit skill"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <label className="text-[11.5px] font-medium text-foreground">
              Name <span className="text-muted-foreground font-normal">(used as /name)</span>
            </label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">
                /
              </span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="greet"
                className={cn("pl-5 text-[12px] h-8", nameError && "border-destructive")}
              />
            </div>
            {nameError && (
              <p className="text-[11px] text-destructive">{nameError}</p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-[11.5px] font-medium text-foreground">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Say hello to the user"
              className="text-[12px] h-8"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11.5px] font-medium text-foreground">
              Prompt template
            </label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="You are a helpful assistant. {{selection}}"
              className="min-h-[96px] resize-none text-[12px]"
            />
            <p className="text-[10.5px] text-muted-foreground">
              Use <code className="font-mono">{"{{selection}}"}</code> to insert selected text.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={onCancel} className="text-[12px]">
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSave}
            onClick={() => onSave({ ...skill, name: normalizedName, description, prompt })}
            className="text-[12px]"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
