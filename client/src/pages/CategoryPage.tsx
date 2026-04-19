import { useState, useMemo, useEffect } from "react";
import { SlidersHorizontal, ImageIcon } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { ProductCard } from "@/components/ui/ProductCard";
import { PageHero } from "@/components/ui/PageHero";
import { useProducts } from "@/hooks/use-products";
import { useQuery } from "@tanstack/react-query";
import { useLanguage } from "@/i18n";
import { useSearch, useLocation } from "wouter";
import type { ColorVariant, Subcategory } from "@shared/schema";
import { FilterPanel, type FilterState, type ColorOption } from "@/components/FilterPanel";
import { COLOR_FAMILIES, groupColorsByFamily, productMatchesColorFamily, normalizeArabic } from "@/lib/colorFamilies";

interface CategoryPageProps {
  title: string;
  subtitle: string;
  categoryIds: number[];
  heroImage: string;
  heroImagePosition?: string;
  heroVideo?: string;
  defaultSizes?: string[];
}

export default function CategoryPage({ title, subtitle, categoryIds, heroImage, heroImagePosition = "center", heroVideo, defaultSizes }: CategoryPageProps) {
  const { data: products, isLoading } = useProducts();
  const { data: allSubcategories } = useQuery<Subcategory[]>({ queryKey: ["/api/subcategories"] });
  const { t, language } = useLanguage();
  const searchString = useSearch();
  const [location, navigate] = useLocation();
  const urlSubId = new URLSearchParams(searchString).get("sub");
  const [activeSubId, setActiveSubId] = useState<number | null>(urlSubId ? Number(urlSubId) : null);

  useEffect(() => {
    const id = urlSubId ? Number(urlSubId) : null;
    setActiveSubId(id);
  }, [urlSubId]);

  const handleSubClick = (subId: number) => {
    if (activeSubId === subId) {
      // deselect → remove ?sub from URL
      navigate(location.split("?")[0], { replace: true });
    } else {
      navigate(`${location.split("?")[0]}?sub=${subId}`, { replace: true });
    }
  };
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    sort: null,
    sizes: [],
    colors: [],
    brands: [],
    priceRange: [0, 99999],
    inStockOnly: false,
    newArrivals: false,
    onSale: false,
  });

  const categoryProducts = useMemo(() => {
    if (!products) return [];
    return products.filter((p) => p.categoryId && categoryIds.includes(p.categoryId));
  }, [products, categoryIds]);

  const allColors = useMemo((): ColorOption[] => {
    const seen = new Map<string, { name: string; colorCode: string }>();
    categoryProducts.forEach((p) => {
      const cv = (p as any).colorVariants as ColorVariant[] | undefined;
      if (cv && cv.length > 0) {
        cv.forEach((v) => {
          const key = normalizeArabic(v.name.trim().toLowerCase());
          if (!seen.has(key)) seen.set(key, { name: v.name.trim(), colorCode: v.colorCode || "#d1d5db" });
          (v.colorTags || []).forEach((tag) => {
            const family = COLOR_FAMILIES.find((f) => f.key === tag);
            if (family && !seen.has(family.key)) seen.set(family.key, { name: family.nameEn, colorCode: family.hex });
          });
        });
      } else {
        (p.colors || []).forEach((c) => {
          const key = normalizeArabic(c.trim().toLowerCase());
          if (!seen.has(key)) seen.set(key, { name: c.trim(), colorCode: "#d1d5db" });
        });
      }
    });
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [categoryProducts]);

  const colorGroups = useMemo(() => groupColorsByFamily(allColors), [allColors]);

  const allSizes = useMemo(() => {
    const set = new Set<string>();
    categoryProducts.forEach((p) => {
      const cv = (p as any).colorVariants as ColorVariant[] | undefined;
      if (cv && cv.length > 0) cv.forEach((v) => (v.sizes || []).forEach((s: string) => set.add(s)));
      else (p.sizes || []).forEach((s) => set.add(s));
    });
    return Array.from(set);
  }, [categoryProducts]);

  const allBrands = useMemo(() => {
    const set = new Set<string>();
    categoryProducts.forEach((p) => { if (p.brand) set.add(p.brand); });
    return Array.from(set).sort();
  }, [categoryProducts]);

  const { minPrice, maxPrice } = useMemo(() => {
    if (categoryProducts.length === 0) return { minPrice: 0, maxPrice: 9999 };
    const prices = categoryProducts.map((p) => parseFloat(p.price.toString()));
    return { minPrice: Math.floor(Math.min(...prices)), maxPrice: Math.ceil(Math.max(...prices)) };
  }, [categoryProducts]);

  useEffect(() => {
    setFilters((prev) => ({ ...prev, priceRange: [minPrice, maxPrice] }));
  }, [minPrice, maxPrice]);

  const filtered = useMemo(() => {
    let result = categoryProducts;
    if (activeSubId !== null) result = result.filter((p: any) => p.subcategoryId === activeSubId);
    if (search) result = result.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
    if (filters.colors.length > 0) {
      result = result.filter((p) => {
        const cv = (p as any).colorVariants as ColorVariant[] | undefined;
        const cols = cv && cv.length > 0 ? cv.map((v) => v.name) : (p.colors || []);
        const allTags = cv && cv.length > 0 ? cv.flatMap((v) => v.colorTags || []) : [];
        return productMatchesColorFamily(cols, filters.colors, colorGroups, allTags);
      });
    }
    if (filters.sizes.length > 0) {
      result = result.filter((p) => {
        const cv = (p as any).colorVariants as ColorVariant[] | undefined;
        const szs: string[] = cv && cv.length > 0 ? cv.flatMap((v) => v.sizes || []) : (p.sizes || []);
        return szs.some((s) => filters.sizes.includes(s));
      });
    }
    if (filters.brands.length > 0) result = result.filter((p) => filters.brands.includes(p.brand || ""));
    result = result.filter((p) => {
      const price = parseFloat(p.price.toString());
      return price >= filters.priceRange[0] && price <= filters.priceRange[1];
    });
    if (filters.inStockOnly) result = result.filter((p) => (p.stockQuantity ?? 0) > 0);
    if (filters.newArrivals) result = result.filter((p) => p.isNewArrival);
    if (filters.onSale) result = result.filter((p) => !!p.discountPrice);
    if (filters.sort === "rising") result = [...result].sort((a, b) => parseFloat(a.price.toString()) - parseFloat(b.price.toString()));
    else if (filters.sort === "decreasing") result = [...result].sort((a, b) => parseFloat(b.price.toString()) - parseFloat(a.price.toString()));
    return result;
  }, [categoryProducts, search, filters, activeSubId]);

  const activeCount =
    (filters.sort ? 1 : 0) +
    filters.sizes.length + filters.colors.length + filters.brands.length +
    (filters.inStockOnly ? 1 : 0) + (filters.newArrivals ? 1 : 0) + (filters.onSale ? 1 : 0) +
    (filters.priceRange[0] > minPrice || filters.priceRange[1] < maxPrice ? 1 : 0);

  const clearAll = () => setFilters({ sort: null, sizes: [], colors: [], brands: [], priceRange: [minPrice, maxPrice], inStockOnly: false, newArrivals: false, onSale: false });

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      {heroImage || heroVideo ? (
        <PageHero
          image={heroImage}
          imagePosition={heroImagePosition}
          video={heroVideo}
          title={title}
          subtitle={subtitle}
          titleTestId="text-category-title"
          subtitleTestId="text-category-subtitle"
        />
      ) : (
        <section className="pt-navbar px-4 sm:px-6 lg:px-8 py-10 sm:py-14 border-b border-border">
          <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-semibold" data-testid="text-category-title">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-2" data-testid="text-category-subtitle">{subtitle}</p>}
        </section>
      )}

      {(() => {
        const subs = (allSubcategories || []).filter(s => categoryIds.some(cid => s.categoryId === cid) && s.isActive);
        if (subs.length === 0) return null;
        return (
          <section className="w-full px-4 sm:px-6 lg:px-8 py-8 bg-background">
            <div className="flex gap-6 sm:gap-10 overflow-x-auto pb-2 justify-center" data-testid="subcategory-circles">
              {subs.map(sub => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => handleSubClick(sub.id)}
                  className={`flex flex-col items-center gap-2 cursor-pointer flex-shrink-0 group transition-opacity ${activeSubId !== null && activeSubId !== sub.id ? 'opacity-50' : 'opacity-100'}`}
                  data-testid={`subcategory-circle-${sub.id}`}
                >
                  <div className={`w-[80px] h-[80px] sm:w-[110px] sm:h-[110px] md:w-[130px] md:h-[130px] rounded-full overflow-hidden border-2 transition-all ${activeSubId === sub.id ? 'border-primary shadow-lg scale-105' : 'border-border group-hover:border-primary/50'}`}>
                    {sub.image ? (
                      <img src={sub.image} alt={sub.nameAr || sub.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-muted/30 flex items-center justify-center">
                        <ImageIcon className="w-8 h-8 text-muted-foreground/30" />
                      </div>
                    )}
                  </div>
                  <span className="text-xs sm:text-sm font-medium text-center leading-tight">
                    {language === "ar" ? (sub.nameAr || sub.name) : sub.name}
                  </span>
                </button>
              ))}
            </div>
          </section>
        );
      })()}

      <main className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 mb-6 sm:mb-10">
          <div className="flex items-center gap-3">
            <p className="text-muted-foreground text-sm" data-testid="text-product-count">
              {filtered.length} {t.shop.itemsCount}
            </p>
            {activeCount > 0 && (
              <button onClick={clearAll} className="text-xs text-muted-foreground underline hover:text-foreground" data-testid="button-clear-filters-top">
                {t.shop.clearFilters}
              </button>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto items-center">
            <input
              type="text"
              placeholder={t.shop.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-b border-border bg-transparent px-2 py-2 focus:outline-none focus:border-primary transition-colors text-sm w-full sm:w-52"
              data-testid="input-category-search"
            />
            <button
              onClick={() => setFilterOpen(true)}
              className={`flex items-center gap-2 text-sm border px-4 py-2 transition-colors whitespace-nowrap ${activeCount > 0 ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-foreground"}`}
              data-testid="button-open-filter"
            >
              <SlidersHorizontal size={14} />
              {t.filter.title}
              {activeCount > 0 && (
                <span className="bg-primary-foreground text-primary text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                  {activeCount}
                </span>
              )}
            </button>
          </div>
        </div>

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
            <button onClick={clearAll} className="mt-4 text-primary uppercase tracking-widest text-sm font-semibold underline" data-testid="button-clear-filters">
              {t.shop.clearFilters}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-5">
            {filtered.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </main>
      <Footer />

      <FilterPanel
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        availableColors={allColors}
        groupedColors={colorGroups}
        availableSizes={allSizes}
        availableBrands={allBrands}
        minPrice={minPrice}
        maxPrice={maxPrice}
        filters={filters}
        onChange={setFilters}
        defaultSizes={defaultSizes}
      />
    </div>
  );
}
