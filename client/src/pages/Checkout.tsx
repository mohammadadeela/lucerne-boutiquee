import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useCart } from "@/store/use-cart";
import { useAuth } from "@/hooks/use-auth";
import { useCreateOrder } from "@/hooks/use-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/i18n";
import { CreditCard, Banknote, MapPin, Truck, Sparkles, CheckCircle2, Tag, X, Loader2, ArrowRight } from "lucide-react";
import type { ColorVariant } from "@shared/schema";
import { translateColorName } from "@/lib/colorFamilies";
import { useSiteSettings, getShippingZones } from "@/hooks/use-site-settings";

const SAVED_INFO_KEY = "lucerne_checkout_info";

function normalizeArabicDigits(str: string): string {
  return str
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function getItemImage(item: { product: any; color?: string }): string {
  const cv = (item.product.colorVariants as ColorVariant[] | undefined) || [];
  if (cv.length > 0 && item.color) {
    const variant = cv.find((v) => v.name === item.color);
    if (variant?.mainImage) return variant.mainImage;
  }
  return item.product.mainImage;
}

export default function Checkout() {
  const { items, cartTotal, clearCart, removeFromCart, updateQuantity } = useCart();
  const [soldOutItems, setSoldOutItems] = useState<Array<{productId: number; name: string; color?: string | null; size?: string | null}>>([]);
  const { data: user, isLoading: authLoading } = useAuth();
  const { data: siteSettings } = useSiteSettings();
  const shippingZones = getShippingZones(siteSettings);
  const cardPaymentEnabled = siteSettings?.card_payment_enabled !== "false";
  const createOrder = useCreateOrder();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "card">("cod");
  const [stripeLoading, setStripeLoading] = useState(false);
  const [shippingRegion, setShippingRegion] = useState<string>("");
  const [saveInfo, setSaveInfo] = useState(false);

  const [discountInput, setDiscountInput] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<{ code: string; discountPercent: number; categoryIds?: number[] | null; subcategoryIds?: number[] | null } | null>(null);
  const [discountLoading, setDiscountLoading] = useState(false);
  const [discountError, setDiscountError] = useState("");

  const [formData, setFormData] = useState({
    fullName: "",
    phone: "",
    phone2: "",
    address: "",
    city: "",
    notes: "",
  });

  useEffect(() => {
    if (!cardPaymentEnabled && paymentMethod === "card") {
      setPaymentMethod("cod");
    }
  }, [cardPaymentEnabled, paymentMethod]);

  useEffect(() => {
    if (!authLoading && !user) {
      setLocation("/auth");
    }
  }, [authLoading, user, setLocation]);

  /* Load saved info from localStorage on mount */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_INFO_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setFormData(prev => ({
          fullName: parsed.fullName || prev.fullName,
          phone: parsed.phone || prev.phone,
          phone2: parsed.phone2 || prev.phone2,
          address: parsed.address || prev.address,
          city: parsed.city || prev.city,
          notes: parsed.notes || prev.notes,
        }));
        if (parsed.shippingRegion) setShippingRegion(parsed.shippingRegion);
        setSaveInfo(true);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (user) {
      setFormData(prev => ({
        ...prev,
        fullName: prev.fullName || user.fullName || "",
        phone: prev.phone || (user as any).phone || "",
        address: prev.address || (user as any).address || "",
      }));
    }
  }, [user]);

  useEffect(() => {
    if (items.length === 0 && user && soldOutItems.length === 0) {
      setLocation("/shop");
    }
  }, [items.length, user, setLocation, soldOutItems.length]);

  useEffect(() => {
    if (items.length === 0) return;
    const validateStock = async () => {
      try {
        const res = await fetch("/api/cart/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: items.map(i => ({
              productId: i.product.id,
              quantity: i.quantity,
              size: i.size || null,
              color: i.color || null,
            })),
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.outOfStock && data.outOfStock.length > 0) {
          const trulySoldOut = data.outOfStock.filter((oos: any) => oos.reason === "sold_out" || !oos.available || oos.available <= 0);
          const insufficientStock = data.outOfStock.filter((oos: any) => oos.reason === "insufficient_stock" && oos.available > 0);
          if (trulySoldOut.length > 0) {
            setSoldOutItems(trulySoldOut);
            for (const oos of trulySoldOut) {
              removeFromCart(oos.productId, oos.size || undefined, oos.color || undefined);
            }
          }
          for (const oos of insufficientStock) {
            updateQuantity(oos.productId, oos.available, oos.size || undefined, oos.color || undefined);
          }
          if (insufficientStock.length > 0) {
            const ar = language === "ar";
            toast({
              title: ar ? "تم تعديل الكمية" : "Quantity adjusted",
              description: insufficientStock.map((oos: any) =>
                ar
                  ? `${oos.name} — ${oos.size || ""}: متوفر ${oos.available} فقط`
                  : `${oos.name} — ${oos.size || ""}: only ${oos.available} available`
              ).join("\n"),
            });
          }
        }
      } catch {}
    };
    validateStock();
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col pt-navbar">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
        </main>
        <Footer />
      </div>
    );
  }

  if (!user) return null;

  if (items.length === 0 && soldOutItems.length > 0) {
    const ar = language === "ar";
    return (
      <div className="min-h-screen flex flex-col pt-navbar">
        <Navbar />
        <main className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-12">
          <div className="max-w-lg mx-auto">
            <div className="border border-red-200 dark:border-red-800 bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/40 dark:to-rose-950/40 p-6 text-center" data-testid="sold-out-notice">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/60 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <h2 className="text-lg font-bold mb-2">{ar ? "المنتجات نفدت من المخزون" : "Products Sold Out"}</h2>
              <p className="text-sm text-muted-foreground mb-4">
                {ar ? "المنتجات التالية نفدت وتم إزالتها من سلتك:" : "The following products are sold out and have been removed from your cart:"}
              </p>
              <ul className="text-sm space-y-1 mb-6">
                {soldOutItems.map((item, i) => (
                  <li key={i} className="text-red-700 dark:text-red-300 font-medium">
                    {item.name}
                    {item.color ? ` — ${translateColorName(item.color, language === "ar" ? "ar" : "en")}` : ""}
                    {item.size ? ` (${item.size})` : ""}
                  </li>
                ))}
              </ul>
              <Button
                onClick={() => { setSoldOutItems([]); setLocation("/shop"); }}
                className="rounded-md"
                data-testid="button-continue-shopping"
              >
                {ar ? "العودة للتسوق" : "Continue Shopping"}
              </Button>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (items.length === 0) return null;

  const shippingRates: Record<string, number> = {};
  shippingZones.forEach(z => { shippingRates[z.id] = z.price; });

  const shippingCost = shippingRegion ? (shippingRates[shippingRegion] || 0) : 0;
  const subtotal = cartTotal();

  const discountableSubtotal = (() => {
    if (!appliedDiscount) return 0;
    const hasCatFilter = appliedDiscount.categoryIds && appliedDiscount.categoryIds.length > 0;
    const hasSubCatFilter = appliedDiscount.subcategoryIds && appliedDiscount.subcategoryIds.length > 0;
    if (!hasCatFilter && !hasSubCatFilter) return subtotal;
    return items.reduce((acc, item) => {
      const catMatch = hasCatFilter && appliedDiscount.categoryIds!.includes(item.product.categoryId);
      const subCatMatch = hasSubCatFilter && item.product.subcategoryId != null && appliedDiscount.subcategoryIds!.includes(item.product.subcategoryId);
      if (!catMatch && !subCatMatch) return acc;
      const price = item.product.discountPrice ? Number(item.product.discountPrice) : Number(item.product.price);
      return acc + price * item.quantity;
    }, 0);
  })();

  const discountAmount = appliedDiscount ? Math.round(discountableSubtotal * (appliedDiscount.discountPercent / 100) * 100) / 100 : 0;
  const isRestrictedDiscount = appliedDiscount && ((appliedDiscount.categoryIds && appliedDiscount.categoryIds.length > 0) || (appliedDiscount.subcategoryIds && appliedDiscount.subcategoryIds.length > 0));
  const total = subtotal - discountAmount + shippingCost;

  const applyDiscount = async () => {
    const code = discountInput.trim().toUpperCase();
    if (!code) return;
    setDiscountLoading(true);
    setDiscountError("");
    try {
      const res = await fetch("/api/discounts/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        setDiscountError(language === "ar" ? "كود غير صالح أو منتهي الصلاحية" : "Invalid or expired code");
        setDiscountLoading(false);
        return;
      }
      const data = await res.json();
      setAppliedDiscount({ code: data.code, discountPercent: data.discountPercent, categoryIds: data.categoryIds ?? null, subcategoryIds: data.subcategoryIds ?? null });
      setDiscountError("");
      toast({ title: language === "ar" ? `تم تطبيق خصم ${data.discountPercent}%` : `${data.discountPercent}% discount applied` });
    } catch {
      setDiscountError(language === "ar" ? "حدث خطأ" : "Something went wrong");
    }
    setDiscountLoading(false);
  };

  const removeDiscount = () => {
    setAppliedDiscount(null);
    setDiscountInput("");
    setDiscountError("");
  };

  const regionLabels: Record<string, { name: string; price: string }> = {};
  shippingZones.forEach(z => {
    regionLabels[z.id] = {
      name: language === "ar" ? z.nameAr : z.nameEn,
      price: `₪${z.price}`,
    };
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    /* Persist or clear saved info */
    if (saveInfo) {
      localStorage.setItem(SAVED_INFO_KEY, JSON.stringify({ ...formData, shippingRegion }));
    } else {
      localStorage.removeItem(SAVED_INFO_KEY);
    }

    if (!shippingRegion) {
      toast({ title: t.checkout.regionRequired, variant: "destructive" });
      return;
    }

    const phoneDigits = formData.phone.replace(/\D/g, "");
    if (phoneDigits.length !== 10) {
      toast({
        title: language === "ar" ? "رقم الهاتف غير صحيح" : "Invalid phone number",
        description: language === "ar" ? "يجب أن يتكون رقم الهاتف من 10 أرقام بالضبط" : "Phone number must be exactly 10 digits",
        variant: "destructive",
      });
      return;
    }

    const phone2Digits = formData.phone2.replace(/\D/g, "");
    if (formData.phone2.length > 0 && phone2Digits.length !== 10) {
      toast({
        title: language === "ar" ? "الرقم الإضافي غير صحيح" : "Invalid additional phone",
        description: language === "ar" ? "الرقم الإضافي يجب أن يكون 10 أرقام أو اتركه فارغاً" : "Additional phone must be exactly 10 digits or leave it empty",
        variant: "destructive",
      });
      return;
    }

    const orderItems = items.map(item => ({
      productId: item.product.id,
      quantity: item.quantity,
      price: (item.product.discountPrice || item.product.price).toString(),
      size: item.size || null,
      color: item.color || null,
    }));

    if (paymentMethod === "card") {
      setStripeLoading(true);
      try {
        const res = await fetch("/api/lahza/create-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            order: {
              fullName: formData.fullName,
              phone: formData.phone,
              phone2: formData.phone2 || null,
              address: formData.address,
              city: formData.city,
              notes: formData.notes,
              shippingRegion,
              shippingCost: shippingCost.toString(),
              discountCode: appliedDiscount?.code || null,
            },
            items: orderItems,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          if (data.code === "OUT_OF_STOCK" && data.outOfStock?.length > 0) {
            const trulySoldOut = data.outOfStock.filter((oos: any) => oos.reason === "sold_out" || !oos.available || oos.available <= 0);
            const insufficientStock = data.outOfStock.filter((oos: any) => oos.reason === "insufficient_stock" && oos.available > 0);
            if (trulySoldOut.length > 0) {
              setSoldOutItems(trulySoldOut);
              for (const oos of trulySoldOut) {
                removeFromCart(oos.productId, oos.size || undefined, oos.color || undefined);
              }
            }
            for (const oos of insufficientStock) {
              updateQuantity(oos.productId, oos.available, oos.size || undefined, oos.color || undefined);
            }
            if (insufficientStock.length > 0) {
              const ar = language === "ar";
              toast({
                title: ar ? "تم تعديل الكمية" : "Quantity adjusted",
                description: insufficientStock.map((oos: any) =>
                  ar
                    ? `${oos.name} — ${oos.size || ""}: متوفر ${oos.available} فقط`
                    : `${oos.name} — ${oos.size || ""}: only ${oos.available} available`
                ).join("\n"),
              });
            }
            setStripeLoading(false);
            return;
          }
          throw new Error(data.message || "Failed to create checkout session");
        }
        const { url } = await res.json();
        if (url) {
          window.location.href = url;
        }
      } catch (err: any) {
        toast({ title: t.checkout.checkoutFailed, description: err.message, variant: "destructive" });
        setStripeLoading(false);
      }
      setStripeLoading(false);
      return;
    }

    try {
      const order = await createOrder.mutateAsync({
        order: {
          fullName: formData.fullName,
          phone: formData.phone,
          phone2: formData.phone2 || null,
          address: formData.address,
          city: formData.city,
          notes: formData.notes,
          status: "Pending",
          paymentMethod: "Cash on delivery",
          shippingRegion,
          shippingCost: shippingCost.toString(),
          discountCode: appliedDiscount?.code || null,
        },
        items: orderItems,
      });

      clearCart();
      setSoldOutItems([]);
      setLocation(`/order-confirmation/${order.id}`);
    } catch (err: any) {
      if (err.code === "OUT_OF_STOCK" && err.outOfStock?.length > 0) {
        const trulySoldOut = err.outOfStock.filter((oos: any) => oos.reason === "sold_out" || !oos.available || oos.available <= 0);
        const insufficientStock = err.outOfStock.filter((oos: any) => oos.reason === "insufficient_stock" && oos.available > 0);
        if (trulySoldOut.length > 0) {
          setSoldOutItems(trulySoldOut);
          for (const oos of trulySoldOut) {
            removeFromCart(oos.productId, oos.size || undefined, oos.color || undefined);
          }
        }
        for (const oos of insufficientStock) {
          updateQuantity(oos.productId, oos.available, oos.size || undefined, oos.color || undefined);
        }
        if (insufficientStock.length > 0) {
          const ar = language === "ar";
          toast({
            title: ar ? "تم تعديل الكمية" : "Quantity adjusted",
            description: insufficientStock.map((oos: any) =>
              ar
                ? `${oos.name} — ${oos.size || ""}: متوفر ${oos.available} فقط`
                : `${oos.name} — ${oos.size || ""}: only ${oos.available} available`
            ).join("\n"),
          });
        }
        return;
      }
      toast({ title: t.checkout.checkoutFailed, description: err.message, variant: "destructive" });
    }
  };

  const isPending = createOrder.isPending || stripeLoading;

  return (
    <div className="min-h-screen flex flex-col pt-navbar">
      <Navbar />
      <main className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="font-display text-3xl sm:text-4xl mb-8 sm:mb-12" data-testid="text-checkout-title">{t.checkout.title}</h1>

        {soldOutItems.length > 0 && items.length > 0 && (
          <div className="border border-amber-200 dark:border-amber-800 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/40 p-4 mb-8" data-testid="partial-sold-out-notice">
            <p className="font-bold text-sm mb-2">{language === "ar" ? "بعض المنتجات نفدت وتم إزالتها من سلتك:" : "Some items are sold out and were removed from your cart:"}</p>
            <ul className="text-sm space-y-1">
              {soldOutItems.map((item, i) => (
                <li key={i} className="text-amber-700 dark:text-amber-300">
                  {item.name}
                  {item.color ? ` — ${translateColorName(item.color, language === "ar" ? "ar" : "en")}` : ""}
                  {item.size ? ` (${item.size})` : ""}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground mt-2">{language === "ar" ? "يمكنك المتابعة بالمنتجات المتوفرة." : "You can proceed with the remaining items."}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 sm:gap-16">
          <div>
            <h2 className="text-xl font-semibold mb-6 uppercase tracking-widest">{t.checkout.shippingRegion}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
              {shippingZones.map((zone) => (
                <button
                  key={zone.id}
                  type="button"
                  onClick={() => setShippingRegion(zone.id)}
                  className={`flex flex-col items-center gap-2 p-4 border text-sm transition-colors ${
                    shippingRegion === zone.id
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border text-muted-foreground"
                  }`}
                  data-testid={`button-region-${zone.id}`}
                >
                  <MapPin className="w-5 h-5 shrink-0" />
                  <span className="font-medium text-center leading-tight">{language === "ar" ? zone.nameAr : zone.nameEn}</span>
                  <span className="text-xs font-semibold text-primary">₪{zone.price}</span>
                </button>
              ))}
            </div>

            <h2 className="text-xl font-semibold mb-6 uppercase tracking-widest">{t.checkout.deliveryDetails}</h2>
            <form id="checkout-form" onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="fullName">{t.checkout.fullName}</Label>
                <Input id="fullName" required value={formData.fullName} onChange={e => setFormData({...formData, fullName: e.target.value})} className="rounded-md border-border focus-visible:ring-primary" data-testid="input-checkout-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">{t.checkout.phone}</Label>
                <Input
                  id="phone"
                  required
                  inputMode="numeric"
                  maxLength={10}
                  value={formData.phone}
                  onChange={e => {
                    const digits = normalizeArabicDigits(e.target.value).replace(/\D/g, "").slice(0, 10);
                    setFormData({...formData, phone: digits});
                  }}
                  className={`rounded-md border-border focus-visible:ring-primary ${formData.phone.length > 0 && formData.phone.length !== 10 ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                  data-testid="input-checkout-phone"
                />
                {formData.phone.length > 0 && formData.phone.length !== 10 && (
                  <p className="text-xs text-red-500">
                    {language === "ar" ? `${formData.phone.length}/10 أرقام` : `${formData.phone.length}/10 digits`}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone2">
                  {language === "ar" ? "رقم هاتف إضافي (اختياري)" : "Additional Phone (optional)"}
                </Label>
                <Input
                  id="phone2"
                  inputMode="numeric"
                  maxLength={10}
                  value={formData.phone2}
                  onChange={e => {
                    const digits = normalizeArabicDigits(e.target.value).replace(/\D/g, "").slice(0, 10);
                    setFormData({...formData, phone2: digits});
                  }}
                  className={`rounded-md border-border focus-visible:ring-primary ${formData.phone2.length > 0 && formData.phone2.length !== 10 ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                  placeholder={language === "ar" ? "اتركه فارغاً إن لم يكن لديك رقم ثانٍ" : "Leave empty if not needed"}
                  data-testid="input-checkout-phone2"
                />
                {formData.phone2.length > 0 && formData.phone2.length !== 10 && (
                  <p className="text-xs text-red-500">
                    {language === "ar" ? `${formData.phone2.length}/10 أرقام` : `${formData.phone2.length}/10 digits`}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">{t.checkout.city}</Label>
                <Input id="city" required value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} className="rounded-md border-border focus-visible:ring-primary" data-testid="input-checkout-city" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">{t.checkout.address}</Label>
                <Input id="address" required value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="rounded-md border-border focus-visible:ring-primary" data-testid="input-checkout-address" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">{t.checkout.notes}</Label>
                <Textarea id="notes" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="rounded-md border-border focus-visible:ring-primary resize-none" rows={4} data-testid="textarea-checkout-notes" />
              </div>

              {/* Save info toggle card */}
              <input
                id="save-info"
                type="checkbox"
                checked={saveInfo}
                onChange={e => setSaveInfo(e.target.checked)}
                className="sr-only"
                data-testid="checkbox-save-info"
              />
              <label
                htmlFor="save-info"
                data-testid="label-save-info"
                className={`
                  relative flex items-center gap-4 p-4 cursor-pointer select-none
                  border-2 transition-all duration-300 group overflow-hidden
                  ${saveInfo
                    ? "border-primary bg-primary/5"
                    : "border-dashed border-border hover:border-primary/40 hover:bg-secondary/60"}
                `}
              >
                {/* animated shimmer when active */}
                {saveInfo && (
                  <span className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent -translate-x-full animate-[shimmer_2s_infinite] pointer-events-none" />
                )}

                {/* icon circle */}
                <div className={`
                  relative flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300
                  ${saveInfo ? "bg-primary text-primary-foreground scale-110" : "bg-secondary text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"}
                `}>
                  {saveInfo
                    ? <CheckCircle2 className="w-5 h-5" />
                    : <Sparkles className="w-5 h-5" />
                  }
                </div>

                {/* text */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold transition-colors duration-300 ${saveInfo ? "text-primary" : "text-foreground"}`}>
                    {language === "ar"
                      ? (saveInfo ? "✓ تم حفظ معلوماتك" : "احفظ معلوماتي للمرة القادمة")
                      : (saveInfo ? "✓ Info saved!" : "Save my info for next time")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {language === "ar"
                      ? (saveInfo ? "سيتم ملء بياناتك تلقائياً في طلبك القادم" : "وفّري وقتك — بياناتك ستُملأ تلقائياً")
                      : (saveInfo ? "Your details will be pre-filled on your next order" : "Save time — your details will be pre-filled next time")}
                  </p>
                </div>

                {/* pill toggle */}
                <div className={`
                  flex-shrink-0 w-11 h-6 rounded-full relative transition-colors duration-300
                  ${saveInfo ? "bg-primary" : "bg-border"}
                `}>
                  <span className={`
                    absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all duration-300
                    ${saveInfo ? (language === "ar" ? "right-0.5" : "left-0.5 translate-x-5") : (language === "ar" ? "right-5" : "left-0.5")}
                  `} />
                </div>
              </label>
            </form>
          </div>

          <div>
            <div className="bg-secondary p-6 sm:p-8 sticky top-28">
              <h2 className="text-xl font-semibold mb-6 uppercase tracking-widest border-b border-border pb-4">{t.checkout.yourOrder}</h2>

              <div className="space-y-4 mb-6 max-h-64 overflow-y-auto pe-2">
                {items.map((item, idx) => {
                  const price = parseFloat(item.product.discountPrice?.toString() || item.product.price.toString());
                  return (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-16 bg-muted relative">
                          <img src={getItemImage(item)} alt="" className="w-full h-full object-cover" />
                          <span className="absolute -top-2 -end-2 bg-primary text-primary-foreground text-[10px] w-4 h-4 flex justify-center items-center rounded-full">{item.quantity}</span>
                        </div>
                        <div>
                          <p className="font-medium">{item.product.name}</p>
                          <p className="text-muted-foreground text-xs">{item.size} {item.color ? translateColorName(item.color, language === "ar" ? "ar" : "en") : ""}</p>
                        </div>
                      </div>
                      <span className="font-medium">₪{(price * item.quantity).toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-border pt-4 mb-6 space-y-3 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>{t.checkout.subtotal}</span>
                  <span>₪{subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5" />
                    {t.checkout.shipping}
                    {shippingRegion && <span className="text-xs">({regionLabels[shippingRegion]?.name})</span>}
                  </span>
                  <span className={shippingRegion ? "font-medium text-foreground" : ""}>
                    {shippingRegion ? `₪${shippingCost.toFixed(2)}` : t.checkout.selectRegion}
                  </span>
                </div>

                {appliedDiscount ? (
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-green-600 dark:text-green-400">
                      <span className="flex items-center gap-1.5">
                        <Tag className="w-3.5 h-3.5" />
                        <span className="font-medium">{appliedDiscount.code} (-{appliedDiscount.discountPercent}%)</span>
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">-₪{discountAmount.toFixed(2)}</span>
                        <button onClick={removeDiscount} className="text-muted-foreground hover:text-destructive" data-testid="button-remove-discount">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {isRestrictedDiscount && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1" data-testid="text-discount-restriction-notice">
                        <Tag className="w-3 h-3 shrink-0" />
                        {language === "ar"
                          ? `هذا الكود يُطبَّق على المنتجات المحددة فقط (خصم على ₪${discountableSubtotal.toFixed(2)} من أصل ₪${subtotal.toFixed(2)})`
                          : `This code applies to eligible items only (discount on ₪${discountableSubtotal.toFixed(2)} of ₪${subtotal.toFixed(2)})`}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="pt-1" data-testid="discount-code-section">
                    <div className="relative">
                      <Tag className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                      <Input
                        value={discountInput}
                        onChange={e => { setDiscountInput(e.target.value.toUpperCase()); setDiscountError(""); }}
                        placeholder={language === "ar" ? "أدخلي كود الخصم..." : "Enter discount code..."}
                        className="rounded-md h-10 text-xs uppercase ps-9 pe-10 tracking-widest placeholder:normal-case placeholder:tracking-normal"
                        onKeyDown={e => e.key === "Enter" && (e.preventDefault(), applyDiscount())}
                        data-testid="input-discount-code"
                      />
                      <button
                        type="button"
                        onClick={applyDiscount}
                        disabled={discountLoading || !discountInput.trim()}
                        className="absolute end-0 top-0 h-full px-3 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                        data-testid="button-apply-discount"
                      >
                        {discountLoading
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <ArrowRight className={`w-3.5 h-3.5 transition-transform ${discountInput.trim() ? "translate-x-0" : ""} ${language === "ar" ? "rotate-180" : ""}`} />
                        }
                      </button>
                    </div>
                    {discountError && (
                      <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1" data-testid="text-discount-error">
                        <X className="w-3 h-3 shrink-0" />{discountError}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-border pt-4 mb-6">
                <h3 className="text-sm font-semibold uppercase tracking-widest mb-3">{t.checkout.paymentMethod}</h3>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("cod")}
                    className={`flex items-center gap-2 p-3 border text-sm transition-colors ${
                      paymentMethod === "cod"
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border text-muted-foreground"
                    }`}
                    data-testid="button-payment-cod"
                  >
                    <Banknote className="w-4 h-4 shrink-0" />
                    <span>{t.checkout.cod}</span>
                  </button>
                  <button
                    type="button"
                    disabled={!cardPaymentEnabled}
                    onClick={() => cardPaymentEnabled && setPaymentMethod("card")}
                    className={`relative flex flex-col items-center justify-center gap-1 p-3 border text-sm transition-colors ${
                      !cardPaymentEnabled
                        ? "border-border/40 bg-muted/30 text-muted-foreground/40 cursor-not-allowed"
                        : paymentMethod === "card"
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-border text-muted-foreground"
                    }`}
                    data-testid="button-payment-card"
                  >
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 shrink-0" />
                      <span>{t.checkout.card}</span>
                    </div>
                    {!cardPaymentEnabled && (
                      <span className="text-[10px] font-medium text-muted-foreground/50 leading-none">
                        {language === "ar" ? "غير متاح حالياً" : "Unavailable"}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              <div className="border-t border-border pt-4 mb-6 flex justify-between items-center text-xl font-semibold">
                <span>{t.checkout.total}</span>
                <span data-testid="text-checkout-total">₪{total.toFixed(2)}</span>
              </div>

              {/* Delivery promise */}
              <div className="mb-4 flex items-center gap-3 p-3 border border-green-500/25 bg-green-500/5 rounded-md" data-testid="banner-delivery-checkout">
                <div className="relative flex-shrink-0">
                  <div className="w-9 h-9 rounded-full bg-green-500/10 flex items-center justify-center">
                    <Truck className="w-4 h-4 text-green-600" strokeWidth={1.5} />
                  </div>
                  <span className="absolute -top-0.5 -end-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-green-700 dark:text-green-500 uppercase tracking-wider">
                    {language === "ar" ? "التوصيل خلال يومين من أيام العمل" : "Delivery within 2 business days"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {language === "ar" ? "يصلك طلبك سريعاً إلى باب منزلك" : "Your order arrives straight to your door"}
                  </p>
                </div>
                <div className="flex-shrink-0 flex flex-col items-center">
                  <span className="text-2xl font-black text-green-500/30 leading-none select-none">2</span>
                  <span className="text-[8px] text-muted-foreground/60 uppercase tracking-wider">
                    {language === "ar" ? "يوم" : "days"}
                  </span>
                </div>
              </div>

              <Button
                type="submit"
                form="checkout-form"
                disabled={isPending || !shippingRegion}
                className="w-full rounded-md py-6 uppercase tracking-widest text-sm font-semibold"
                data-testid="button-place-order"
              >
                {isPending
                  ? t.checkout.processing
                  : paymentMethod === "card"
                    ? t.checkout.payWithCard
                    : t.checkout.placeOrder}
              </Button>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
