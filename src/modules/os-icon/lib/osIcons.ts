import { IS_LINUX, IS_MAC, IS_WINDOWS } from "@/lib/platform";

export const DISTRO_LOGOS: Record<string, string> = {
  ubuntu: "/distro/ubuntu.svg",
  debian: "/distro/debian.svg",
  centos: "/distro/centos.svg",
  rocky: "/distro/rocky.svg",
  fedora: "/distro/fedora.svg",
  arch: "/distro/arch.svg",
  alpine: "/distro/alpine.svg",
  amazon: "/distro/amazon.svg",
  opensuse: "/distro/opensuse.svg",
  redhat: "/distro/redhat.svg",
  oracle: "/distro/oracle.svg",
  kali: "/distro/kali.svg",
  almalinux: "/distro/almalinux.svg",
  macos: "/distro/macos.svg",
  windows: "/distro/windows.svg",
  linux: "/distro/linux.svg",
};

export const DISTRO_COLORS: Record<string, string> = {
  ubuntu: "#E95420",
  debian: "#A81D33",
  centos: "#9C27B0",
  rocky: "#0B9B69",
  fedora: "#3C6EB4",
  arch: "#1793D1",
  alpine: "#0D597F",
  amazon: "#FF9900",
  opensuse: "#73BA25",
  redhat: "#EE0000",
  oracle: "#C74634",
  kali: "#0F6DB3",
  almalinux: "#173B66",
  macos: "#333333",
  windows: "#0078D4",
  linux: "#333333",
  default: "#475569",
};

/** Normalize a raw /etc/os-release ID (or any OS string) to a known distro id. */
export function normalizeDistroId(value?: string | null): string {
  const v = (value || "").toLowerCase().trim();
  if (!v) return "";
  if (v.includes("ubuntu")) return "ubuntu";
  if (v.includes("debian")) return "debian";
  if (v.includes("centos")) return "centos";
  if (v.includes("rocky")) return "rocky";
  if (v.includes("fedora")) return "fedora";
  if (v.includes("arch") || v.includes("manjaro")) return "arch";
  if (v.includes("alpine")) return "alpine";
  if (v.includes("amzn") || v.includes("amazon") || v.includes("aws"))
    return "amazon";
  if (v.includes("opensuse") || v.includes("suse") || v.includes("sles"))
    return "opensuse";
  if (v.includes("red hat") || v.includes("redhat") || v.includes("rhel"))
    return "redhat";
  if (v.includes("almalinux")) return "almalinux";
  if (v.includes("oracle")) return "oracle";
  if (v.includes("kali")) return "kali";
  if (v.includes("darwin") || v.includes("macos")) return "macos";
  if (v.includes("windows")) return "windows";
  if (v.includes("linux")) return "linux";
  return "";
}

/** Parse the ID= field out of /etc/os-release content. */
export function parseOsReleaseId(content: string): string {
  const match = /^ID="?([\w-]+)"?$/im.exec(content);
  if (match) return match[1];
  return (content.split(/\s+/)[0] || "").toLowerCase();
}

/** OS id for the local machine, for local terminal tab icons. */
export function localOsId(): string {
  if (IS_MAC) return "macos";
  if (IS_WINDOWS) return "windows";
  if (IS_LINUX) return "linux";
  return "";
}
