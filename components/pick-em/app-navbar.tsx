"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
}

interface AppNavbarProps {
  isAdminUser?: boolean;
  className?: string;
}

const PRIMARY_ITEMS: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/join", label: "Join" },
  { href: "/cards", label: "Cards" },
  { href: "/my-games", label: "My Games" },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: "/admin/rosters", label: "Roster Admin" },
  { href: "/admin/bonus-questions", label: "Bonus Pool Admin" },
];

function matchesPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive = matchesPath(pathname, item.href);

  return (
    <Button asChild size="sm" variant={isActive ? "secondary" : "ghost"}>
      <Link href={item.href}>{item.label}</Link>
    </Button>
  );
}

function DropdownLink({ item }: { item: NavItem }) {
  return (
    <DropdownMenuItem asChild>
      <Link href={item.href}>{item.label}</Link>
    </DropdownMenuItem>
  );
}

export function AppNavbar({ isAdminUser = false, className }: AppNavbarProps) {
  const pathname = usePathname();
  const overflowItems = isAdminUser ? ADMIN_ITEMS : [];
  const mobileItems = isAdminUser
    ? [...PRIMARY_ITEMS, ...ADMIN_ITEMS]
    : PRIMARY_ITEMS;

  return (
    <nav
      aria-label="Primary navigation"
      className={cn("flex items-center gap-2", className)}
    >
      <div className="hidden items-center gap-1 sm:flex">
        {PRIMARY_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
        {overflowItems.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Admin</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {overflowItems.map((item) => (
                <DropdownLink key={item.href} item={item} />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild className="sm:hidden">
          <Button size="sm" variant="outline">
            <Menu className="h-4 w-4 mr-1" />
            Menu
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {mobileItems.map((item) => (
            <DropdownLink key={item.href} item={item} />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
