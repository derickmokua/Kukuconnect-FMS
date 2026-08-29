export type NavItem = {
  href: string;
  label: string;
  icon: string;
  match?: "exact" | "prefix";
};

export const MAIN_NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "dashboard", match: "exact" },
  { href: "/orders", label: "Orders", icon: "shopping_bag" },
  { href: "/sales", label: "Sales", icon: "payments" },
  { href: "/customers", label: "Customers", icon: "group" },
  { href: "/inventory", label: "Inventory", icon: "inventory_2" },
  { href: "/brooder", label: "Active Flocks", icon: "house" },
  { href: "/incubation", label: "Incubation", icon: "egg" },
  { href: "/expenses", label: "Expenses", icon: "account_balance_wallet" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function pageTitle(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  if (pathname.startsWith("/orders")) return "Orders";
  if (pathname.startsWith("/sales")) return "Sales & Receipts";
  if (pathname.startsWith("/customers")) return "Customer CRM & Follow-ups";
  if (pathname.startsWith("/inventory")) return "Inventory";
  if (pathname.startsWith("/brooder")) return "Active Flocks";
  if (pathname.startsWith("/incubation")) return "Incubation";
  if (pathname.startsWith("/expenses")) return "Expenses";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/login")) return "Staff login";
  if (pathname.startsWith("/order")) return "Order chicks";
  return "KukuConnect";
}

export function isNavActive(pathname: string, item: NavItem): boolean {
  if (item.match === "exact" || item.href === "/") {
    return pathname === item.href;
  }
  return pathname.startsWith(item.href);
}
