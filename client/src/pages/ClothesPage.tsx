import CategoryPage from "./CategoryPage";
import { useLanguage } from "@/i18n";
import { useSiteSettings, getSetting } from "@/hooks/use-site-settings";

export default function ClothesPage() {
  const { t, language } = useLanguage();
  const { data: siteSettings } = useSiteSettings();

  const heroImage = getSetting(siteSettings, "clothes_hero_image");
  const heroImagePosition = getSetting(siteSettings, "clothes_hero_image_position") || "center";
  const heroVideo = getSetting(siteSettings, "clothes_hero_video");
  const subtitle = language === "ar"
    ? getSetting(siteSettings, "clothes_hero_subtitle_ar")
    : getSetting(siteSettings, "clothes_hero_subtitle_en");

  return (
    <CategoryPage
      title={t.nav.clothes}
      subtitle={subtitle}
      categoryIds={[10]}
      heroImage={heroImage}
      heroImagePosition={heroImagePosition}
      heroVideo={heroVideo}
    />
  );
}
