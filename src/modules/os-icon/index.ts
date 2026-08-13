export { OsIcon } from "./components/OsIcon";
export {
  DISTRO_COLORS,
  DISTRO_LOGOS,
  localOsId,
  normalizeDistroId,
  parseOsReleaseId,
} from "./lib/osIcons";
export {
  clearDetectedDistro,
  detectedDistroForHost,
  probeRemoteOs,
  useDetectedDistro,
} from "./lib/osDetectionStore";
