import type { Component } from "solid-js"

/** Get the icon component for a given role (falls back to a generic moose).
 *  Uses a lazy getter to avoid referencing functions before they're defined. */
export function getMooseIcon(role?: string): Component<{ size?: number; color?: string }> {
  switch (role) {
    case "orchestrator": return BullMooseIcon
    case "sub_orchestrator": return JuniorMooseIcon
    case "coder": return DeerIcon
    case "researcher": return SmartMooseIcon
    case "debugger": return DebugMooseIcon
    case "general": return TrailMooseIcon
    case "explorer": return ScoutMooseIcon
    default: return GenericMooseIcon
  }
}

/** Bull Moose — Full antler silhouette (orchestrator crown) */
export function BullMooseIcon(props: { size?: number; color?: string }) {
  const s = () => props.size ?? 32
  return (
    <svg width={s()} height={s()} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Antlers */}
      <path
        d="M32 20 C32 20, 24 8, 16 4 C14 3, 10 5, 12 8 C14 11, 18 12, 20 14 C16 12, 10 10, 8 12 C6 14, 8 16, 12 16 C15 16, 19 17, 22 19"
        stroke={props.color ?? "#8B4513"}
        stroke-width="2.5"
        stroke-linecap="round"
        fill="none"
      />
      <path
        d="M32 20 C32 20, 40 8, 48 4 C50 3, 54 5, 52 8 C50 11, 46 12, 44 14 C48 12, 54 10, 56 12 C58 14, 56 16, 52 16 C49 16, 45 17, 42 19"
        stroke={props.color ?? "#8B4513"}
        stroke-width="2.5"
        stroke-linecap="round"
        fill="none"
      />
      {/* Head */}
      <ellipse cx="32" cy="34" rx="14" ry="16" fill={props.color ?? "#8B4513"} opacity="0.15" />
      <ellipse cx="32" cy="34" rx="14" ry="16" stroke={props.color ?? "#8B4513"} stroke-width="2" fill="none" />
      {/* Snout */}
      <ellipse cx="32" cy="42" rx="7" ry="5" fill={props.color ?? "#8B4513"} opacity="0.25" />
      {/* Eyes */}
      <circle cx="26" cy="30" r="2" fill={props.color ?? "#8B4513"} />
      <circle cx="38" cy="30" r="2" fill={props.color ?? "#8B4513"} />
      {/* Nostrils */}
      <circle cx="29" cy="43" r="1.2" fill={props.color ?? "#8B4513"} opacity="0.6" />
      <circle cx="35" cy="43" r="1.2" fill={props.color ?? "#8B4513"} opacity="0.6" />
    </svg>
  )
}

/** Junior Moose — Smaller antlers, youthful look */
export function JuniorMooseIcon(props: { size?: number; color?: string }) {
  const s = () => props.size ?? 32
  return (
    <svg width={s()} height={s()} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Small antlers */}
      <path
        d="M28 22 C26 16, 20 12, 18 14 C16 16, 20 18, 24 20"
        stroke={props.color ?? "#FF6B35"}
        stroke-width="2"
        stroke-linecap="round"
        fill="none"
      />
      <path
        d="M36 22 C38 16, 44 12, 46 14 C48 16, 44 18, 40 20"
        stroke={props.color ?? "#FF6B35"}
        stroke-width="2"
        stroke-linecap="round"
        fill="none"
      />
      {/* Head */}
      <ellipse cx="32" cy="36" rx="12" ry="14" fill={props.color ?? "#FF6B35"} opacity="0.15" />
      <ellipse cx="32" cy="36" rx="12" ry="14" stroke={props.color ?? "#FF6B35"} stroke-width="2" fill="none" />
      {/* Eyes */}
      <circle cx="27" cy="33" r="2" fill={props.color ?? "#FF6B35"} />
      <circle cx="37" cy="33" r="2" fill={props.color ?? "#FF6B35"} />
      {/* Snout */}
      <ellipse cx="32" cy="42" rx="6" ry="4" fill={props.color ?? "#FF6B35"} opacity="0.2" />
      <circle cx="30" cy="42.5" r="1" fill={props.color ?? "#FF6B35"} opacity="0.5" />
      <circle cx="34" cy="42.5" r="1" fill={props.color ?? "#FF6B35"} opacity="0.5" />
    </svg>
  )
}

/** Deer — Sleek, no antlers, focused look */
export function DeerIcon(props: { size?: number; color?: string }) {
  const s = () => props.size ?? 32
  return (
    <svg width={s()} height={s()} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Ears */}
      <path
        d="M22 24 C20 16, 16 14, 18 20"
        stroke={props.color ?? "#4CAF50"}
        stroke-width="2"
        stroke-linecap="round"
        fill="none"
      />
      <path
        d="M42 24 C44 16, 48 14, 46 20"
        stroke={props.color ?? "#4CAF50"}
        stroke-width="2"
        stroke-linecap="round"
        fill="none"
      />
      {/* Head — more elongated */}
      <ellipse cx="32" cy="36" rx="11" ry="15" fill={props.color ?? "#4CAF50"} opacity="0.12" />
      <ellipse cx="32" cy="36" rx="11" ry="15" stroke={props.color ?? "#4CAF50"} stroke-width="2" fill="none" />
      {/* Eyes */}
      <circle cx="27" cy="32" r="1.8" fill={props.color ?? "#4CAF50"} />
      <circle cx="37" cy="32" r="1.8" fill={props.color ?? "#4CAF50"} />
      {/* Snout */}
      <ellipse cx="32" cy="43" rx="5" ry="3.5" fill={props.color ?? "#4CAF50"} opacity="0.2" />
      <circle cx="30.5" cy="43" r="0.8" fill={props.color ?? "#4CAF50"} opacity="0.5" />
      <circle cx="33.5" cy="43" r="0.8" fill={props.color ?? "#4CAF50"} opacity="0.5" />
    </svg>
  )
}

/** Smart Moose — Glasses/spectacle marks for the researcher */
export function SmartMooseIcon(props: { size?: number; color?: string }) {
  const s = () => props.size ?? 32
  return (
    <svg width={s()} height={s()} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Small antlers */}
      <path
        d="M26 22 C24 16, 20 14, 22 18"
        stroke={props.color ?? "#2196F3"}
        stroke-width="2"
        stroke-linecap="round"
        fill="none"
      />
      <path
        d="M38 22 C40 16, 44 14, 42 18"
        stroke={props.color ?? "#2196F3"}
        stroke-width="2"
        stroke-linecap="round"
        fill="none"
      />
      {/* Head */}
      <ellipse cx="32" cy="36" rx="13" ry="15" fill={props.color ?? "#2196F3"} opacity="0.12" />
      <ellipse cx="32" cy="36" rx="13" ry="15" stroke={props.color ?? "#2196F3"} stroke-width="2" fill="none" />
      {/* Glasses */}
      <circle cx="26" cy="32" r="5" stroke={props.color ?? "#2196F3"} stroke-width="1.5" fill="none" />
      <circle cx="38" cy="32" r="5" stroke={props.color ?? "#2196F3"} stroke-width="1.5" fill="none" />
      <line x1="31" y1="32" x2="33" y2="32" stroke={props.color ?? "#2196F3"} stroke-width="1.5" />
      {/* Eyes behind glasses */}
      <circle cx="26" cy="32" r="1.5" fill={props.color ?? "#2196F3"} />
      <circle cx="38" cy="32" r="1.5" fill={props.color ?? "#2196F3"} />
      {/* Snout */}
      <ellipse cx="32" cy="43" rx="5" ry="3.5" fill={props.color ?? "#2196F3"} opacity="0.2" />
    </svg>
  )
}

/** Debug Moose — Magnifying glass motif */
export function DebugMooseIcon(props: { size?: number; color?: string }) {
  const s = () => props.size ?? 32
  return (
    <svg width={s()} height={s()} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Small antlers */}
      <path
        d="M26 22 C24 16, 20 14, 22 18"
        stroke={props.color ?? "#E91E63"}
        stroke-width="2"
        stroke-linecap="round"
        fill="none"
      />
      <path
        d="M38 22 C40 16, 44 14, 42 18"
        stroke={props.color ?? "#E91E63"}
        stroke-width="2"
        stroke-linecap="round"
        fill="none"
      />
      {/* Head */}
      <ellipse cx="32" cy="36" rx="13" ry="15" fill={props.color ?? "#E91E63"} opacity="0.12" />
      <ellipse cx="32" cy="36" rx="13" ry="15" stroke={props.color ?? "#E91E63"} stroke-width="2" fill="none" />
      {/* Eyes — one squinting (debug focus) */}
      <circle cx="26" cy="32" r="2" fill={props.color ?? "#E91E63"} />
      <line x1="35" y1="31" x2="41" y2="33" stroke={props.color ?? "#E91E63"} stroke-width="2" stroke-linecap="round" />
      {/* Magnifying glass near eye */}
      <circle cx="46" cy="26" r="5" stroke={props.color ?? "#E91E63"} stroke-width="1.5" fill="none" opacity="0.5" />
      <line x1="49.5" y1="29.5" x2="53" y2="33" stroke={props.color ?? "#E91E63"} stroke-width="1.5" stroke-linecap="round" opacity="0.5" />
      {/* Snout */}
      <ellipse cx="32" cy="43" rx="5" ry="3.5" fill={props.color ?? "#E91E63"} opacity="0.2" />
    </svg>
  )
}

/** Trail Moose — Compass/path motif (general-purpose) */
export function TrailMooseIcon(props: { size?: number; color?: string }) {
  const s = () => props.size ?? 32
  return (
    <svg width={s()} height={s()} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Small antlers */}
      <path
        d="M26 22 C24 16, 20 14, 22 18"
        stroke={props.color ?? "#9C27B0"}
        stroke-width="2"
        stroke-linecap="round"
        fill="none"
      />
      <path
        d="M38 22 C40 16, 44 14, 42 18"
        stroke={props.color ?? "#9C27B0"}
        stroke-width="2"
        stroke-linecap="round"
        fill="none"
      />
      {/* Head */}
      <ellipse cx="32" cy="36" rx="13" ry="15" fill={props.color ?? "#9C27B0"} opacity="0.12" />
      <ellipse cx="32" cy="36" rx="13" ry="15" stroke={props.color ?? "#9C27B0"} stroke-width="2" fill="none" />
      {/* Eyes */}
      <circle cx="27" cy="32" r="2" fill={props.color ?? "#9C27B0"} />
      <circle cx="37" cy="32" r="2" fill={props.color ?? "#9C27B0"} />
      {/* Compass on forehead */}
      <circle cx="32" cy="26" r="3" stroke={props.color ?? "#9C27B0"} stroke-width="1" fill="none" opacity="0.5" />
      <line x1="32" y1="23.5" x2="32" y2="25" stroke={props.color ?? "#9C27B0"} stroke-width="1" opacity="0.6" />
      <line x1="32" y1="27" x2="32" y2="28.5" stroke={props.color ?? "#9C27B0"} stroke-width="1" opacity="0.6" />
      {/* Snout */}
      <ellipse cx="32" cy="43" rx="5" ry="3.5" fill={props.color ?? "#9C27B0"} opacity="0.2" />
    </svg>
  )
}

/** Scout Moose — Binocular marks (explorer) */
export function ScoutMooseIcon(props: { size?: number; color?: string }) {
  const s = () => props.size ?? 32
  return (
    <svg width={s()} height={s()} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Small antlers */}
      <path
        d="M26 22 C24 16, 20 14, 22 18"
        stroke={props.color ?? "#00BCD4"}
        stroke-width="2"
        stroke-linecap="round"
        fill="none"
      />
      <path
        d="M38 22 C40 16, 44 14, 42 18"
        stroke={props.color ?? "#00BCD4"}
        stroke-width="2"
        stroke-linecap="round"
        fill="none"
      />
      {/* Head */}
      <ellipse cx="32" cy="36" rx="13" ry="15" fill={props.color ?? "#00BCD4"} opacity="0.12" />
      <ellipse cx="32" cy="36" rx="13" ry="15" stroke={props.color ?? "#00BCD4"} stroke-width="2" fill="none" />
      {/* Binoculars over eyes */}
      <rect x="21" y="28" width="9" height="7" rx="3.5" stroke={props.color ?? "#00BCD4"} stroke-width="1.5" fill="none" />
      <rect x="34" y="28" width="9" height="7" rx="3.5" stroke={props.color ?? "#00BCD4"} stroke-width="1.5" fill="none" />
      <line x1="30" y1="31.5" x2="34" y2="31.5" stroke={props.color ?? "#00BCD4"} stroke-width="1.5" />
      {/* Eyes behind binoculars */}
      <circle cx="25.5" cy="31.5" r="1.2" fill={props.color ?? "#00BCD4"} />
      <circle cx="38.5" cy="31.5" r="1.2" fill={props.color ?? "#00BCD4"} />
      {/* Snout */}
      <ellipse cx="32" cy="43" rx="5" ry="3.5" fill={props.color ?? "#00BCD4"} opacity="0.2" />
    </svg>
  )
}

/** Generic Moose — Fallback for unknown roles */
export function GenericMooseIcon(props: { size?: number; color?: string }) {
  const s = () => props.size ?? 32
  return (
    <svg width={s()} height={s()} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Small antlers */}
      <path
        d="M26 24 C24 18, 22 16, 23 20"
        stroke={props.color ?? "#888"}
        stroke-width="2"
        stroke-linecap="round"
        fill="none"
      />
      <path
        d="M38 24 C40 18, 42 16, 41 20"
        stroke={props.color ?? "#888"}
        stroke-width="2"
        stroke-linecap="round"
        fill="none"
      />
      {/* Head */}
      <ellipse cx="32" cy="36" rx="12" ry="14" fill={props.color ?? "#888"} opacity="0.12" />
      <ellipse cx="32" cy="36" rx="12" ry="14" stroke={props.color ?? "#888"} stroke-width="2" fill="none" />
      {/* Eyes */}
      <circle cx="27" cy="33" r="2" fill={props.color ?? "#888"} />
      <circle cx="37" cy="33" r="2" fill={props.color ?? "#888"} />
      {/* Snout */}
      <ellipse cx="32" cy="42" rx="5" ry="3.5" fill={props.color ?? "#888"} opacity="0.2" />
    </svg>
  )
}
