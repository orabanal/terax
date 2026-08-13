import { cn } from "@/lib/utils";
import { DISTRO_COLORS, DISTRO_LOGOS } from "../lib/osIcons";

type Props = {
  distroId: string;
  className?: string;
};

/** Small OS/distro logo on a brand-colored rounded box, Netcatty tab style. */
export function OsIcon({ distroId, className }: Props) {
  const logo = DISTRO_LOGOS[distroId];
  if (!logo) return null;
  const bg = DISTRO_COLORS[distroId] ?? DISTRO_COLORS.default;
  return (
    <div
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded",
        className,
      )}
      style={{ backgroundColor: bg }}
    >
      <img
        src={logo}
        alt={distroId}
        className="h-2.5 w-2.5 object-contain brightness-0 invert"
        draggable={false}
      />
    </div>
  );
}
