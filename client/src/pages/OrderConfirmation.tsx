import { useRoute, Link } from "wouter";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useOrder } from "@/hooks/use-orders";
import { useLanguage } from "@/i18n";
import { CheckCircle, Package, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function OrderConfirmation() {
  const [, params] = useRoute("/order-confirmation/:id");
  const orderId = params?.id ? Number(params.id) : 0;
  const { data: orderDetails, isLoading } = useOrder(orderId);
  const { t } = useLanguage();

  const statusKey = (orderDetails?.order?.status || "Pending") as keyof typeof t.orderStatus;
  const statusLabel = t.orderStatus[statusKey] || orderDetails?.order?.status;

  const statusColor = {
    Pending: "bg-amber-100 text-amber-800",
    OnTheWay: "bg-blue-100 text-blue-800",
    Delivered: "bg-green-100 text-green-800",
    Cancelled: "bg-red-100 text-red-800",
  }[statusKey] || "bg-primary/10 text-primary";

  return (
    <div className="min-h-screen flex flex-col pt-navbar">
      <Navbar />
      <main className="flex-1 max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20 w-full">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : orderDetails ? (
          <div className="text-center">
            <div className="flex justify-center mb-6">
              <CheckCircle className="w-20 h-20 text-green-500" />
            </div>

            <h1 className="font-display text-3xl sm:text-4xl mb-3" data-testid="text-confirmation-title">
              {t.orderConfirmation.title}
            </h1>

            <p className="text-muted-foreground mb-8 text-sm">{t.orderConfirmation.emailSent}</p>

            <div className="bg-secondary p-6 sm:p-8 mb-8 text-start">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-6 pb-6 border-b border-border">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">{t.orderConfirmation.orderNumber}</p>
                  <p className="text-2xl font-display font-bold" data-testid="text-order-number">
                    #{orderDetails.order.id.toString().padStart(6, '0')}
                  </p>
                </div>
                <div className="mt-3 sm:mt-0">
                  <p className="text-sm text-muted-foreground mb-1">{t.orderConfirmation.status}</p>
                  <span className={`inline-block px-4 py-1.5 text-xs uppercase tracking-widest font-semibold ${statusColor}`} data-testid="text-order-status">
                    {statusLabel}
                  </span>
                </div>
              </div>

              <div className="space-y-3 mb-6">
                {orderDetails.items.map(item => (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3">
                      {item.product?.mainImage && (
                        <img src={item.product.mainImage} alt="" className="w-10 h-14 object-cover bg-muted flex-shrink-0" />
                      )}
                      <div>
                        <p className="font-medium">{item.product?.name}</p>
                        <p className="text-xs text-muted-foreground">{item.size} {item.color} × {item.quantity}</p>
                      </div>
                    </div>
                    <span className="font-medium">₪{(parseFloat(item.price) * item.quantity).toFixed(2)}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-border pt-4 space-y-2 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>{t.checkout.subtotal}</span>
                  <span>₪{(parseFloat(orderDetails.order.totalAmount) - parseFloat(orderDetails.order.shippingCost || "0")).toFixed(2)}</span>
                </div>
                {orderDetails.order.shippingCost && parseFloat(orderDetails.order.shippingCost) > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{t.checkout.shipping}</span>
                    <span>₪{parseFloat(orderDetails.order.shippingCost).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold pt-2 border-t border-border">
                  <span>{t.checkout.total}</span>
                  <span>₪{parseFloat(orderDetails.order.totalAmount).toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/profile">
                <Button variant="outline" className="rounded-md uppercase tracking-widest text-sm px-8 py-5" data-testid="button-track-order">
                  <Package className="w-4 h-4 me-2" />
                  {t.orderConfirmation.trackOrder}
                </Button>
              </Link>
              <Link href="/shop">
                <Button className="rounded-md uppercase tracking-widest text-sm px-8 py-5" data-testid="button-continue-shopping">
                  <ShoppingBag className="w-4 h-4 me-2" />
                  {t.orderConfirmation.continueShopping}
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="text-center py-20">
            <p className="text-muted-foreground">Order not found</p>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
