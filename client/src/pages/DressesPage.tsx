import CategoryPage from "./CategoryPage";
import { useLanguage } from "@/i18n";
import { useSiteSettings, getSetting } from "@/hooks/use-site-settings";

export default function DressesPage() {
  const { t, language } = useLanguage();
  const { data: siteSettings } = useSiteSettings();

  const heroImage = getSetting(siteSettings, "dresses_hero_image");
  const heroImagePosition = getSetting(siteSettings, "dresses_hero_image_position") || "center";
  const heroVideo = getSetting(siteSettings, "dresses_hero_video");
  const subtitle = language === "ar"
    ? getSetting(siteSettings, "dresses_hero_subtitle_ar")
    : getSetting(siteSettings, "dresses_hero_subtitle_en");

  return (
    <CategoryPage
      title={t.nav.dresses}
      subtitle={subtitle}
      categoryIds={[1]}
      heroImage={heroImage}
      heroImagePosition={heroImagePosition}
      heroVideo={heroVideo}
    />
  );
}
