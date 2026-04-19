import { useState, useMemo } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { ProductCard } from "@/components/ui/ProductCard";
import { PageHero } from "@/components/ui/PageHero";
import { useProducts } from "@/hooks/use-products";
import { useLanguage } from "@/i18n";
import { useSiteSettings, getSetting } from "@/hooks/use-site-settings";
import type { ColorVariant } from "@shared/schema";

export default function SalesPage() {
  const { data: products, isLoading } = useProducts();
  const { t, language } = useLanguage();
  const { data: siteSettings } = useSiteSettings();

  const salesHeroImage = getSetting(siteSettings, "sales_hero_image");
  const salesHeroImagePosition = getSetting(siteSettings, "sales_hero_image_position") || "center";
  const salesHeroVideo = getSetting(siteSettings, "sales_hero_video");
  const salesSubtitle = language === "ar"
    ? getSetting(siteSettings, "sales_hero_subtitle_ar")
    : getSetting(siteSettings, "sales_hero_subtitle_en");
  const [search, setSearch] = useState("");
  const [selectedColor, setSelectedColor] = useState("");
  const [sortBy, setSortBy] = useState("newest");

  const saleProducts = useMemo(() => {
    if (!products) return [];
    return products.filter(p => p.discountPrice && parseFloat(p.discountPrice.toString()) > 0);
  }, [products]);

  const allColors = useMemo(() => {
    const colorSet = new Set<string>();
    saleProducts.forEach(p => {
      const cv = (p as any).colorVariants as ColorVariant[] | undefined;
      if (cv && cv.length > 0) {
        cv.forEach(v => colorSet.add(v.name));
      } else {
        (p.colors || []).forEach(c => colorSet.add(c));
      }
    });
    return Array.from(colorSet).sort();
  }, [saleProducts]);

  const filtered = useMemo(() => {
    let result = saleProducts;
    if (search) {
      result = result.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
    }
    if (selectedColor) {
      result = result.filter(p => {
        const cv = (p as any).colorVariants as ColorVariant[] | undefined;
        const colors = cv && cv.length > 0 ? cv.map(v => v.name) : (p.colors || []);
        return colors.some(c => c.toLowerCase() === selectedColor.toLowerCase());
      });
    }
    if (sortBy === "price-low") {
      result = [...result].sort((a, b) => parseFloat(a.discountPrice!.toString()) - parseFloat(b.discountPrice!.toString()));
    } else if (sortBy === "price-high") {
      result = [...result].sort((a, b) => parseFloat(b.discountPrice!.toString()) - parseFloat(a.discountPrice!.toString()));
    } else if (sortBy === "discount") {
      result = [...result].sort((a, b) => {
        const discA = (parseFloat(a.price.toString()) - parseFloat(a.discountPrice!.toString())) / parseFloat(a.price.toString());
        const discB = (parseFloat(b.price.toString()) - parseFloat(b.discountPrice!.toString())) / parseFloat(b.price.toString());
        return discB - discA;
      });
    }
    return result;
  }, [saleProducts, search, selectedColor, sortBy]);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <PageHero
        image={salesHeroImage}
        imagePosition={salesHeroImagePosition}
        video={salesHeroVideo}
        title={t.nav.sales}
        subtitle={salesSubtitle}
        titleTestId="text-sales-page-title"
        subtitleTestId="text-sales-page-subtitle"
      />

      <main className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 mb-6 sm:mb-10">
          <p className="text-muted-foreground text-sm" data-testid="text-product-count">
            {filtered.length} {t.shop.allProducts}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <input
              type="text"
              placeholder={t.shop.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-b border-border bg-transparent px-2 py-2 focus:outline-none focus:border-primary transition-colors text-sm w-full sm:w-52"
              data-testid="input-sales-search"
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="border-b border-border bg-transparent px-2 py-2 focus:outline-none text-sm w-full sm:w-40"
              data-testid="select-sort"
            >
              <option value="newest">{t.shop.sortNewest}</option>
              <option value="discount">{t.shop.sortDiscount}</option>
              <option value="price-low">{t.shop.sortPriceLow}</option>
              <option value="price-high">{t.shop.sortPriceHigh}</option>
            </select>
          </div>
        </div>

        {allColors.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8">
            <button
              onClick={() => setSelectedColor("")}
              className={`text-xs px-3 py-1.5 border transition-colors ${!selectedColor ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground'}`}
              data-testid="button-all-colors"
            >
              {t.shop.allColors}
            </button>
            {allColors.map(color => (
              <button
                key={color}
                onClick={() => setSelectedColor(color)}
                className={`text-xs px-3 py-1.5 border transition-colors ${selectedColor === color ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground'}`}
                data-testid={`button-filter-color-${color}`}
              >
                {color}
              </button>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-5">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="bg-muted aspect-[3/4] mb-4"></div>
                <div className="h-4 bg-muted w-2/3 mb-2"></div>
                <div className="h-4 bg-muted w-1/4"></div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 sm:py-24 text-muted-foreground">
            <p data-testid="text-no-products">{t.shop.noProducts}</p>
            <button onClick={() => { setSearch(""); setSelectedColor(""); }} className="mt-4 text-primary uppercase tracking-widest text-sm font-semibold underline" data-testid="button-clear-filters">{t.shop.clearFilters}</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-5">
            {filtered.map(product => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
