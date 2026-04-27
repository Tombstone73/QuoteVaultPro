import {
  Package,
  FileText,
  Receipt,
  ShoppingBag,
  ImageIcon,
  MapPin,
  User,
  LayoutDashboard,
  Shield,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";

interface NavItem {
  title: string;
  url: string;
  icon: React.ElementType;
  enabled: boolean;
}

const navItems: NavItem[] = [
  { title: "Orders", url: "/orders", icon: Package, enabled: true },
  { title: "Quotes", url: "/quotes", icon: FileText, enabled: true },
  { title: "Invoices", url: "/invoices", icon: Receipt, enabled: true },
  { title: "Proofs", url: "/proofs", icon: Shield, enabled: false },
  { title: "Products", url: "/products", icon: ShoppingBag, enabled: false },
  { title: "Artwork", url: "/artwork", icon: ImageIcon, enabled: false },
  { title: "Addresses", url: "/addresses", icon: MapPin, enabled: false },
];

const accountItems: NavItem[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, enabled: true },
  { title: "Account", url: "/account", icon: User, enabled: true },
];

export function PortalSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { user } = useAuth();

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        {/* Brand */}
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          {!collapsed && (
            <span className="text-lg font-bold tracking-tight text-sidebar-foreground">
              TitanOS
            </span>
          )}
          {collapsed && (
            <span className="text-lg font-bold text-sidebar-foreground">T</span>
          )}
        </div>

        <SidebarGroup>
          <SidebarGroupLabel>Portal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild disabled={!item.enabled}>
                    {item.enabled ? (
                      <NavLink
                        to={item.url}
                        end
                        className="hover:bg-sidebar-accent"
                        activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                      >
                        <item.icon className="mr-2 h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    ) : (
                      <span className="flex items-center opacity-40 cursor-not-allowed">
                        <item.icon className="mr-2 h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </span>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {accountItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild disabled={!item.enabled}>
                    {item.enabled ? (
                      <NavLink
                        to={item.url}
                        end
                        className="hover:bg-sidebar-accent"
                        activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                      >
                        <item.icon className="mr-2 h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    ) : (
                      <span className="flex items-center opacity-40 cursor-not-allowed">
                        <item.icon className="mr-2 h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </span>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {!collapsed && user && (
          <div className="px-4 py-3 border-t border-sidebar-border">
            <p className="text-sm font-medium text-sidebar-foreground truncate">
              {user.firstName} {user.lastName}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {user.customerName}
            </p>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
