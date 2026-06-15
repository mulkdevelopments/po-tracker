import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ClipboardList,
  Upload,
  Package,
  Tag,
  Database,
  Users,
  Factory,
  MoreHorizontal,
  Menu,
} from "lucide-react";

export const NAV_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  orders: ClipboardList,
  production: Factory,
  upload: Upload,
  items: Package,
  pricing: Tag,
  master: Database,
  users: Users,
  more: MoreHorizontal,
  menu: Menu,
};

export function NavIcon({
  page,
  active,
  size = 18,
  className = "sidebar-link-icon",
}: {
  page: string;
  active?: boolean;
  size?: number;
  className?: string;
}) {
  const Icon = NAV_ICONS[page];
  if (!Icon) return null;
  return (
    <Icon
      size={size}
      strokeWidth={active ? 2.25 : 1.75}
      className={className}
      aria-hidden
    />
  );
}
