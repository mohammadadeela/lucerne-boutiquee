import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/i18n";
import { useLocation } from "wouter";

export type WishlistItem = { id: number; userId: number; productId: number; createdAt: string | null };

export function useWishlist() {
  const { data: user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [, navigate] = useLocation();

  const query = useQuery<WishlistItem[]>({
    queryKey: ["/api/wishlist"],
    enabled: !!user,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const wishlistItems = query.data ?? [];

  const isWishlisted = (productId: number) =>
    wishlistItems.some((item) => item.productId === productId);

  const getItemId = (productId: number) =>
    wishlistItems.find((item) => item.productId === productId)?.id;

  const addMutation = useMutation({
    mutationFn: (productId: number) =>
      apiRequest("POST", "/api/wishlist", { productId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist/products"] });
      toast({ title: t.wishlist.addedToWishlist, onClick: () => navigate("/wishlist") } as any);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/wishlist/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist/products"] });
      toast({ title: t.wishlist.removedFromWishlist });
    },
  });

  const toggle = (productId: number) => {
    if (!user) return false;
    const itemId = getItemId(productId);
    if (itemId !== undefined) {
      removeMutation.mutate(itemId);
    } else {
      addMutation.mutate(productId);
    }
    return true;
  };

  return {
    wishlistItems,
    isWishlisted,
    getItemId,
    toggle,
    isLoading: query.isLoading,
    isPending: addMutation.isPending || removeMutation.isPending,
  };
}
