export const DEFAULT_REFRESH_INTERVAL_MS = 60 * 1000;
export const DEFAULT_STALE_TIME_MS = 30 * 1000;

export function normalizeQueryFilters(filters = {}) {
  return Object.fromEntries(
    Object.entries(filters)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

export function defaultRealtimeQueryOptions(options = {}) {
  return {
    staleTime: DEFAULT_STALE_TIME_MS,
    refetchInterval: DEFAULT_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    ...options,
  };
}

export function updateCollectionData(oldData, updater) {
  if (Array.isArray(oldData)) return updater(oldData);
  if (oldData?.items && Array.isArray(oldData.items)) {
    return {
      ...oldData,
      items: updater(oldData.items),
    };
  }
  return oldData;
}

export function getCollectionItems(cachedData) {
  if (Array.isArray(cachedData)) return cachedData;
  if (cachedData?.items && Array.isArray(cachedData.items)) return cachedData.items;
  return [];
}

export function findInCachedCollections(cachedCollections, id) {
  for (const [, data] of cachedCollections) {
    const match = getCollectionItems(data).find((item) => String(item.id) === String(id));
    if (match) return match;
  }
  return null;
}

export function replaceItemById(items, id, patch) {
  return items.map((item) => (String(item.id) === String(id) ? { ...item, ...patch } : item));
}

export function removeItemById(items, id) {
  return items.filter((item) => String(item.id) !== String(id));
}

export function invalidateInactive(queryClient, queryKey) {
  queryClient.invalidateQueries({ queryKey, refetchType: 'inactive' });
}
