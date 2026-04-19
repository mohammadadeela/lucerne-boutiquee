import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";

export function useCategories() {
  return useQuery({
    queryKey: [api.categories.list.path],
    queryFn: async () => {
      const res = await fetch(api.categories.list.path);
      if (!res.ok) throw new Error("Failed to fetch categories");
      const data = await res.json();
      return api.categories.list.responses[200].parse(data);
    },
  });
}
