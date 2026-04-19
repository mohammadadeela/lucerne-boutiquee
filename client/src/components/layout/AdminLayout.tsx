import { Link, useLocation } from "wouter";
import { LayoutDashboard, Package, ShoppingCart, Users, LogOut, ArrowLeft, ArrowRight, ImageIcon, Receipt, TicketPercent, FolderTree, BarChart2, ExternalLink } from "lucide-react";
import { useAuth, useLogout } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n";

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: user, isLoading } = useAuth();
  const logout = useLogout();
  const { t, language } = useLanguage();
  const BackArrow = language === "ar" ? ArrowRight : ArrowLeft;

  if (isLoading) return <div className="h-screen flex items-center justify-center"><div className="w-8 h-8 rounded-full border-2 border-foreground/20 border-t-foreground animate-spin" /></div>;

  const isEmployee = user?.role === "employee";
  const isAdmin = user?.role === "admin";

  if (!user || (!isAdmin && !isEmployee)) {
    window.location.href = "/";
    return null;
  }

  if (isEmployee && !location.startsWith("/admin/pos")) {
    window.location.href = "/admin/pos";
    return null;
  }

  const adminNavItems = [
    { label: t.admin.dashboard, href: "/admin", icon: LayoutDashboard },
    { label: t.admin.products, href: "/admin/products", icon: Package },
    { label: t.admin.orders, href: "/admin/orders", icon: ShoppingCart },
    { label: t.admin.users, href: "/admin/users", icon: Users },
    { label: language === "ar" ? "محتوى الصفحات" : "Site Content", href: "/admin/site-content", icon: ImageIcon },
    { label: language === "ar" ? "نقطة البيع" : "POS", href: "/admin/pos", icon: Receipt },
    { label: language === "ar" ? "أكواد الخصم" : "Discount Codes", href: "/admin/discount-codes", icon: TicketPercent },
    { label: language === "ar" ? "الفئات" : "Categories", href: "/admin/categories", icon: FolderTree },
    { label: language === "ar" ? "تقرير المبيعات" : "Sales Analytics", href: "/admin/analytics", icon: BarChart2 },
  ];

  const employeeNavItems = [
    { label: language === "ar" ? "نقطة البيع" : "POS", href: "/admin/pos", icon: Receipt },
  ];

  const navItems = isEmployee ? employeeNavItems : adminNavItems;

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col md:flex-row">
      <aside className="w-64 bg-card border-e border-border hidden md:flex flex-col">
        <div className="h-20 flex flex-col justify-center px-6 border-b border-border gap-1">
          <h2 className="font-display text-xl tracking-widest font-semibold uppercase" data-testid="text-admin-title">{t.admin.admin}</h2>
          {isEmployee && (
            <span className="text-[10px] font-semibold tracking-widest uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400 w-fit">
              {language === "ar" ? "موظف" : "Employee"}
            </span>
          )}
        </div>
        <nav className="flex-1 py-6 px-4 space-y-2">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <div className={`flex items-center gap-3 px-4 py-3 rounded-md transition-colors ${
                location === item.href ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`} data-testid={`link-admin-nav-${item.href.replace(/\//g, '-')}`}>
                <item.icon className="w-5 h-5" />
                <span className="font-medium">{item.label}</span>
              </div>
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-border space-y-2">
          <Link href="/">
            <Button variant="outline" className="w-full justify-start border-none shadow-none text-muted-foreground" data-testid="link-back-to-store">
              <BackArrow className="w-4 h-4 me-2" /> {t.admin.backToStore}
            </Button>
          </Link>
          <Button variant="ghost" className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => logout.mutate()} data-testid="button-admin-logout">
            <LogOut className="w-4 h-4 me-2" /> {t.admin.logout}
          </Button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <div className="h-14 bg-card border-b border-border flex items-center px-4 justify-between">
          <h2 className="font-display text-lg tracking-widest font-semibold uppercase md:hidden">{t.admin.admin}</h2>
          <div className="hidden md:block" />
          <div className="flex items-center gap-2 md:ms-auto">
            <Link href="/">
              <Button variant="outline" size="sm" className="gap-2" data-testid="link-goto-website">
                <ExternalLink className="w-4 h-4" />
                <span className="hidden sm:inline">{language === "ar" ? "الموقع" : "Website"}</span>
              </Button>
            </Link>
            <Button variant="ghost" size="sm" className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => logout.mutate()} data-testid="button-admin-signout-top">
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">{t.admin.logout}</span>
            </Button>
          </div>
        </div>

        <nav className="md:hidden flex border-b border-border bg-card overflow-x-auto">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <div className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                location === item.href
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground"
              }`} data-testid={`link-admin-mobile-nav-${item.href.replace(/\//g, '-')}`}>
                <item.icon className="w-4 h-4" />
                <span>{item.label}</span>
              </div>
            </Link>
          ))}
        </nav>

        <div className="flex-1 p-4 sm:p-6 md:p-8 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
