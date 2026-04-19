import { useLanguage } from "@/i18n";
import { SiInstagram, SiFacebook } from "react-icons/si";
import { Link } from "wouter";

export function Footer() {
  const { t, language } = useLanguage();

  return (
    <footer className="bg-secondary text-secondary-foreground pt-10 sm:pt-16 pb-6 sm:pb-8 border-t border-border">
      <div className="w-full px-4 sm:px-6 lg:px-8">

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 md:gap-12 mb-6 md:mb-12">

          <div className="col-span-1 md:col-span-2">
            <h2 className="font-display text-xl sm:text-2xl tracking-widest font-semibold uppercase mb-3 sm:mb-6" data-testid="text-footer-logo">
              Lucerne Boutique
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-4 sm:mb-6 max-w-sm" data-testid="text-footer-description">
              {t.footer.description}
            </p>
            <div className="flex items-center gap-4">
              <span className="text-sm font-semibold uppercase tracking-widest">{t.footer.followUs}</span>
              <a href="https://www.instagram.com/lucerne.boutique/" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Instagram" data-testid="link-instagram">
                <SiInstagram className="w-5 h-5" />
              </a>
              <a href="https://www.facebook.com/Lucerne.Boutique" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Facebook" data-testid="link-facebook">
                <SiFacebook className="w-5 h-5" />
              </a>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 col-span-1 md:col-span-2 md:grid-cols-2">
            <div>
              <h3 className="font-display font-semibold uppercase tracking-widest mb-3 md:mb-6 text-sm">{t.footer.shop}</h3>
              <ul className="space-y-2 sm:space-y-4 text-sm text-muted-foreground">
                <li><Link href="/shop" className="hover:text-foreground transition-colors">{t.footer.allProducts}</Link></li>
                <li><Link href="/sales" className="hover:text-foreground transition-colors">{t.footer.sale}</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="font-display font-semibold uppercase tracking-widest mb-3 md:mb-6 text-sm">{t.footer.support}</h3>
              <ul className="space-y-2 sm:space-y-4 text-sm text-muted-foreground">
                <li><Link href="/faq" className="hover:text-foreground transition-colors" data-testid="link-footer-faq">{t.footer.faq}</Link></li>
                <li><Link href="/shipping-returns" className="hover:text-foreground transition-colors" data-testid="link-footer-shipping">{t.footer.shippingReturns}</Link></li>
                <li><Link href="/contact" className="hover:text-foreground transition-colors" data-testid="link-footer-contact">{t.footer.contactUs}</Link></li>
                <li><Link href="/our-location" className="hover:text-foreground transition-colors" data-testid="link-footer-location">{t.footer.ourLocation}</Link></li>
              </ul>
            </div>
          </div>

        </div>

        <div className="border-t border-border pt-5 sm:pt-8 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} Lucerne Boutique. {t.footer.allRights}</p>
          <div className="flex gap-4 sm:gap-6">
            <a href="#" className="hover:text-foreground transition-colors">{t.footer.privacyPolicy}</a>
            <a href="#" className="hover:text-foreground transition-colors">{t.footer.termsOfService}</a>
          </div>
        </div>

        <div className="mt-4 text-center text-xs text-muted-foreground/60">
          <p>
            {language === "ar"
              ? <>هل تريد موقعاً مثل هذا؟ تواصل معنا على{" "}<a href="mailto:mohammad.adeela@gmail.com" className="underline hover:text-foreground transition-colors">mohammad.adeela@gmail.com</a></>
              : <>Want a website like this? Contact{" "}<a href="mailto:mohammad.adeela@gmail.com" className="underline hover:text-foreground transition-colors">mohammad.adeela@gmail.com</a></>
            }
          </p>
        </div>

      </div>
    </footer>
  );
}
