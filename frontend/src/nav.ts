export type NavSlot = "main" | "create" | "settings";

export interface NavItem {
  to: string;
  label: string;
  shortLabel: string;
  page: string;
  slot: NavSlot;
  detail?: string;
}

export const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", shortLabel: "Dashboard", page: "dashboard", slot: "main" },
  { to: "/orders", label: "Order Summary", shortLabel: "Orders", page: "orders", slot: "main" },
  { to: "/cynergy-forms", label: "Cynergy Forms", shortLabel: "Cynergy", page: "cynergy-forms", slot: "main" },
  { to: "/upload", label: "Upload PO", shortLabel: "Upload", page: "upload", slot: "create" },
  {
    to: "/items",
    label: "Item Summary",
    shortLabel: "Items",
    page: "items",
    slot: "settings",
    detail: "Catalogue of parts, sizes, and colours.",
  },
  {
    to: "/pricing",
    label: "Pricing Table",
    shortLabel: "Pricing",
    page: "pricing",
    slot: "settings",
    detail: "Live and past price lists.",
  },
  {
    to: "/master",
    label: "Master Data",
    shortLabel: "Master",
    page: "master",
    slot: "settings",
    detail: "Ports, colours, carriers, and locations.",
  },
  {
    to: "/users",
    label: "Users",
    shortLabel: "Users",
    page: "users",
    slot: "settings",
    detail: "People who can sign in, and what they can open.",
  },
];
