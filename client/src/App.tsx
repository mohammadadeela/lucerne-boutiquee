import { Switch, Route, useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAbandonedCartReminder } from "@/hooks/use-abandoned-cart-reminder";
import NotFound from "@/pages/not-found";
import { SiInstagram } from "react-icons/si";

import Home from "@/pages/Home";
import ProductDetails from "@/pages/ProductDetails";
import Cart from "@/pages/Cart";
import Checkout from "@/pages/Checkout";
import Auth from "@/pages/Auth";
import Profile from "@/pages/Profile";
import DressesPage from "@/pages/DressesPage";
import ShoesPage from "@/pages/ShoesPage";
import ClothesPage from "@/pages/ClothesPage";
import SalesPage from "@/pages/SalesPage";
import Shop from "@/pages/Shop";

import OurLocation from "@/pages/OurLocation";
import FAQ from "@/pages/FAQ";
import ShippingReturns from "@/pages/ShippingReturns";
import Contact from "@/pages/Contact";
import CheckoutSuccess from "@/pages/CheckoutSuccess";
import OrderConfirmation from "@/pages/OrderConfirmation";
import Wishlist from "@/pages/Wishlist";

import AdminDashboard from "@/pages/admin/Dashboard";
import AdminProducts from "@/pages/admin/Products";
import AdminOrders from "@/pages/admin/Orders";
import AdminUsers from "@/pages/admin/Users";
import AdminSiteContent from "@/pages/admin/SiteContent";
import AdminPOS from "@/pages/admin/POS";
import AdminDiscountCodes from "@/pages/admin/DiscountCodes";
import AdminCategories from "@/pages/admin/Categories";
import AdminAnalytics from "@/pages/admin/Analytics";
import DynamicCategoryPage from "@/pages/DynamicCategoryPage";

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location]);
  return null;
}

function InstagramButton() {
  const [location] = useLocation();
  if (location.startsWith("/admin")) return null;

  const href = "https://ig.me/m/lucerne.boutique";

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="تواصلي معنا على انستغرام"
      data-testid="button-instagram"
      className="fixed bottom-6 start-6 z-50 flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-tr from-[#F58529] via-[#DD2A7B] to-[#8134AF] shadow-lg hover:scale-110 active:scale-95 transition-all duration-200 group"
    >
      <SiInstagram className="w-7 h-7 text-white" />
      <span className="absolute start-full ms-3 whitespace-nowrap bg-gradient-to-r from-[#DD2A7B] to-[#8134AF] text-white text-xs font-medium px-3 py-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none shadow-md">
        راسلينا على انستغرام
      </span>
    </a>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/shop" component={Shop} />
      <Route path="/dresses" component={DressesPage} />
      <Route path="/shoes" component={ShoesPage} />
      <Route path="/clothes" component={ClothesPage} />
      <Route path="/sales" component={SalesPage} />
      <Route path="/product/:id" component={ProductDetails} />
      <Route path="/cart" component={Cart} />
      <Route path="/checkout" component={Checkout} />
      <Route path="/checkout/success" component={CheckoutSuccess} />
      <Route path="/order-confirmation/:id" component={OrderConfirmation} />
      <Route path="/auth" component={Auth} />
      <Route path="/profile" component={Profile} />
      <Route path="/wishlist" component={Wishlist} />
      <Route path="/our-location" component={OurLocation} />
      <Route path="/faq" component={FAQ} />
      <Route path="/shipping-returns" component={ShippingReturns} />
      <Route path="/contact" component={Contact} />
      
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/products" component={AdminProducts} />
      <Route path="/admin/orders" component={AdminOrders} />
      <Route path="/admin/users" component={AdminUsers} />
      <Route path="/admin/site-content" component={AdminSiteContent} />
      <Route path="/admin/pos" component={AdminPOS} />
      <Route path="/admin/discount-codes" component={AdminDiscountCodes} />
      <Route path="/admin/categories" component={AdminCategories} />
      <Route path="/admin/analytics" component={AdminAnalytics} />

      <Route path="/category/:slug" component={DynamicCategoryPage} />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function AbandonedCartReminder() {
  useAbandonedCartReminder();
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ScrollToTop />
        <AbandonedCartReminder />
        <Router />
        <InstagramButton />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
