/**
 * Icon set — Lucide glyphs at a consistent 1.5px stroke, inheriting `currentColor`.
 * Usage: <Icon name="home" className="text-muted" />. Keep the doc's text glyphs (¶, H1, {})
 * as literals where the design intends them; use these for chrome (nav, chevrons, actions).
 */
import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  CornerDownLeft,
  FileText,
  Hash,
  Home,
  LayoutGrid,
  ListChecks,
  type LucideIcon,
  MoreHorizontal,
  PanelLeft,
  PencilLine,
  Plus,
  Search,
  Settings2,
  Share2,
  Table2,
  Tag,
  Timer,
  X,
} from "lucide-react";

const ICONS = {
  home: Home,
  "daily-note": PencilLine,
  settings: Settings2,
  search: Search,
  "chevron-right": ChevronRight,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  back: ArrowLeft,
  plus: Plus,
  more: MoreHorizontal,
  check: Check,
  close: X,
  enter: CornerDownLeft,
  calendar: Calendar,
  focus: Timer,
  share: Share2,
  copy: Copy,
  sidebar: PanelLeft,
  page: FileText,
  board: LayoutGrid,
  table: Table2,
  list: ListChecks,
  tag: Tag,
  hash: Hash,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  title?: string;
}

export function Icon({ name, size = 16, strokeWidth = 1.5, className, title }: IconProps) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    />
  );
}
