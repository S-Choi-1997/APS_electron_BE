import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { auth } from '../../auth/authManager';
import {
  createMemo,
  deleteMemo,
  fetchMemo,
  fetchMemoPage,
  fetchMemos,
  updateMemo,
} from '../../services/memoService';
import { getDisplayName } from '../../utils/displayName';
import { memoQueryKeys } from './memoQueryKeys';
import {
  defaultRealtimeQueryOptions,
  findInCachedCollections,
  invalidateInactive,
  removeItemById,
  replaceItemById,
  updateCollectionData,
} from './queryUtils';

export function normalizeMemo(memo) {
  const createdAt = memo.created_at || memo.createdAt;

  return {
    id: memo.id,
    title: memo.title,
    content: memo.content,
    important: memo.important,
    createdAt: createdAt ? new Date(createdAt) : new Date(),
    author: memo.author,
    author_name: memo.author_name,
    authorDisplayName: getDisplayName([memo.author_name, memo.author]),
    expire_date: memo.expire_date,
  };
}

export function isMemoActive(memo, now = new Date()) {
  if (!memo.expire_date) return true;

  const expireDate = new Date(memo.expire_date);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  return expireDate >= today;
}

function updateAllMemoCollectionCaches(queryClient, updater) {
  queryClient.setQueriesData({ queryKey: memoQueryKeys.lists() }, (oldData) =>
    updateCollectionData(oldData, updater)
  );
  queryClient.setQueriesData({ queryKey: memoQueryKeys.pages() }, (oldData) =>
    updateCollectionData(oldData, updater)
  );
}

export function useMemos(filters = {}, options = {}) {
  return useQuery({
    queryKey: memoQueryKeys.list(filters),
    queryFn: async () => {
      const data = await fetchMemos(auth, filters);
      return data.map(normalizeMemo);
    },
    ...defaultRealtimeQueryOptions(options),
  });
}

export function useMemoPage(filters = {}, options = {}) {
  return useQuery({
    queryKey: memoQueryKeys.page(filters),
    queryFn: async () => {
      const page = await fetchMemoPage(auth, filters);
      return {
        ...page,
        items: page.items.map(normalizeMemo),
      };
    },
    ...defaultRealtimeQueryOptions(options),
  });
}

export function useActiveMemos(filters = {}, options = {}) {
  const activeFilters = { ...filters, active: true };

  return useQuery({
    queryKey: memoQueryKeys.activeList(activeFilters),
    queryFn: async () => {
      const data = await fetchMemos(auth, activeFilters);
      return data.map(normalizeMemo);
    },
    ...defaultRealtimeQueryOptions(options),
  });
}

export function useMemoDetail(id, options = {}) {
  return useQuery({
    queryKey: memoQueryKeys.detail(id),
    queryFn: async () => {
      const data = await fetchMemo(id, auth);
      return normalizeMemo(data);
    },
    enabled: Boolean(id),
    ...options,
  });
}

export function useCreateMemo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memoData) => createMemo(memoData, auth),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: memoQueryKeys.pages() });
    },
  });
}

export function useUpdateMemo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }) => updateMemo(id, updates, auth),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: memoQueryKeys.all });

      const previousLists = queryClient.getQueriesData({ queryKey: memoQueryKeys.lists() });
      const previousPages = queryClient.getQueriesData({ queryKey: memoQueryKeys.pages() });
      const previousDetail = queryClient.getQueryData(memoQueryKeys.detail(id));
      const cachedMemo = findInCachedCollections([...previousLists, ...previousPages], id) || previousDetail;
      const patch = normalizeMemo({ ...cachedMemo, ...updates, id });

      updateAllMemoCollectionCaches(queryClient, (items) => replaceItemById(items, id, patch));
      queryClient.setQueryData(memoQueryKeys.detail(id), (oldData) => (oldData ? { ...oldData, ...patch } : oldData));

      return { previousLists, previousPages, previousDetail };
    },
    onError: (err, { id }, context) => {
      context?.previousLists?.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
      context?.previousPages?.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
      if (context?.previousDetail) queryClient.setQueryData(memoQueryKeys.detail(id), context.previousDetail);
      console.error('[Mutation Error] Failed to update memo:', err);
    },
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: memoQueryKeys.lists(), refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: memoQueryKeys.pages(), refetchType: 'active' });
      invalidateInactive(queryClient, memoQueryKeys.all);
      queryClient.invalidateQueries({ queryKey: memoQueryKeys.detail(id) });
    },
  });
}

export function useDeleteMemo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => deleteMemo(id, auth),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: memoQueryKeys.all });

      const previousLists = queryClient.getQueriesData({ queryKey: memoQueryKeys.lists() });
      const previousPages = queryClient.getQueriesData({ queryKey: memoQueryKeys.pages() });
      updateAllMemoCollectionCaches(queryClient, (items) => removeItemById(items, id));
      queryClient.removeQueries({ queryKey: memoQueryKeys.detail(id) });

      return { previousLists, previousPages };
    },
    onError: (err, _id, context) => {
      context?.previousLists?.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
      context?.previousPages?.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
      console.error('[Mutation Error] Failed to delete memo:', err);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoQueryKeys.lists(), refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: memoQueryKeys.pages(), refetchType: 'active' });
      invalidateInactive(queryClient, memoQueryKeys.all);
    },
  });
}
