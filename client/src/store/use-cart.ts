import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import type { Product } from "@shared/schema";

export interface CartItem {
  product: Product;
  quantity: number;
  size?: string;
  color?: string;
}

interface GuestCartStore {
  items: CartItem[];
  addToCart: (product: Product, quantity?: number, size?: string, color?: string) => void;
  removeFromCart: (productId: number, size?: string, color?: string) => void;
  updateQuantity: (productId: number, quantity: number, size?: string, color?: string) => void;
  clearCart: () => void;
}

export const useGuestCart = create<GuestCartStore>()(
  persist(
    (set) => ({
      items: [],
      addToCart: (product, quantity = 1, size, color) => {
        set((state) => {
          const existing = state.items.find(
            (i) => i.product.id === product.id && i.size === size && i.color === color
          );
          if (existing) {
            return {
              items: state.items.map((i) =>
                i === existing ? { ...i, quantity: i.quantity + quantity } : i
              ),
            };
          }
          return { items: [...state.items, { product, quantity, size, color }] };
        });
      },
      removeFromCart: (productId, size, color) => {
        set((state) => ({
          items: state.items.filter(
            (i) => !(i.product.id === productId && i.size === size && i.color === color)
          ),
        }));
      },
      updateQuantity: (productId, quantity, size, color) => {
        set((state) => ({
          items: state.items.map((i) =>
            i.product.id === productId && i.size === size && i.color === color
              ? { ...i, quantity: Math.max(1, quantity) }
              : i
          ),
        }));
      },
      clearCart: () => set({ items: [] }),
    }),
    { name: "fashion-cart" }
  )
);

export interface CartStore {
  items: CartItem[];
  addToCart: (product: Product, quantity?: number, size?: string, color?: string) => void;
  removeFromCart: (productId: number, size?: string, color?: string) => void;
  updateQuantity: (productId: number, quantity: number, size?: string, color?: string) => void;
  clearCart: () => void;
  cartTotal: () => number;
  isLoading?: boolean;
}

function computeTotal(items: CartItem[]): number {
  return items.reduce((total, item) => {
    const price = item.product.discountPrice
      ? parseFloat(item.product.discountPrice)
      : parseFloat(item.product.price);
    return total + price * item.quantity;
  }, 0);
}

type ServerCartItem = {
  product: Product;
  quantity: number;
  size?: string | null;
  color?: string | null;
};

function toCartItem(s: ServerCartItem): CartItem {
  return {
    product: s.product,
    quantity: s.quantity,
    size: s.size ?? undefined,
    color: s.color ?? undefined,
  };
}

export function useCart(): CartStore {
  const { data: user } = useAuth();
  const queryClient = useQueryClient();

  const guestItems = useGuestCart((s) => s.items);
  const guestAdd = useGuestCart((s) => s.addToCart);
  const guestRemove = useGuestCart((s) => s.removeFromCart);
  const guestUpdate = useGuestCart((s) => s.updateQuantity);
  const guestClear = useGuestCart((s) => s.clearCart);

  const serverQuery = useQuery<ServerCartItem[]>({
    queryKey: ["/api/cart"],
    enabled: !!user,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/cart"] });

  const addMutation = useMutation({
    mutationFn: (vars: { productId: number; quantity: number; size?: string; color?: string }) =>
      apiRequest("POST", "/api/cart", vars),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { productId: number; quantity: number; size?: string; color?: string }) =>
      apiRequest("PUT", "/api/cart/item", vars),
    onSuccess: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: (vars: { productId: number; size?: string; color?: string }) =>
      apiRequest("DELETE", "/api/cart/item", vars),
    onSuccess: invalidate,
  });

  const clearMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/cart"),
    onSuccess: invalidate,
  });

  if (!user) {
    return {
      items: guestItems,
      addToCart: guestAdd,
      removeFromCart: guestRemove,
      updateQuantity: (productId, quantity, size, color) => {
        if (quantity < 1) {
          guestRemove(productId, size, color);
        } else {
          guestUpdate(productId, quantity, size, color);
        }
      },
      clearCart: guestClear,
      cartTotal: () => computeTotal(guestItems),
      isLoading: false,
    };
  }

  const serverItems: CartItem[] = (serverQuery.data ?? []).map(toCartItem);

  return {
    items: serverItems,
    addToCart: (product, quantity = 1, size, color) =>
      addMutation.mutate({ productId: product.id, quantity, size, color }),
    removeFromCart: (productId, size, color) =>
      removeMutation.mutate({ productId, size: size ?? undefined, color: color ?? undefined }),
    updateQuantity: (productId, quantity, size, color) => {
      if (quantity < 1) {
        removeMutation.mutate({ productId, size: size ?? undefined, color: color ?? undefined });
      } else {
        updateMutation.mutate({ productId, quantity, size: size ?? undefined, color: color ?? undefined });
      }
    },
    clearCart: () => clearMutation.mutate(),
    cartTotal: () => computeTotal(serverItems),
    isLoading: serverQuery.isLoading,
  };
}
