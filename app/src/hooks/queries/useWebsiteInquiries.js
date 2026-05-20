import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { auth } from '../../auth/authManager';
import { apiRequest } from '../../config/api';
import {
  deleteInquiry,
  fetchAttachmentUrls,
  fetchAllInquiries,
  fetchInquiryPage,
  fetchInquiries,
  fetchInquiryById,
  updateInquiry,
} from '../../services/inquiryService';
import { sendInquirySMSResponse } from '../../services/smsService';
import { inquiryQueryKeys } from './inquiryQueryKeys';
import {
  defaultRealtimeQueryOptions,
  findInCachedCollections,
  invalidateInactive,
  removeItemById,
  replaceItemById,
  updateCollectionData,
} from './queryUtils';

function updateAllInquiryCollectionCaches(queryClient, updater) {
  queryClient.setQueriesData({ queryKey: inquiryQueryKeys.lists() }, (oldData) =>
    updateCollectionData(oldData, updater)
  );
  queryClient.setQueriesData({ queryKey: inquiryQueryKeys.allLists() }, (oldData) =>
    updateCollectionData(oldData, updater)
  );
  queryClient.setQueriesData({ queryKey: inquiryQueryKeys.pages() }, (oldData) =>
    updateCollectionData(oldData, updater)
  );
}

function resolveInquiryStatus(item = {}) {
  return item.status || (item.check ? 'responded' : 'unread');
}

function normalizeInquiryPatch(updates = {}) {
  const patch = { ...updates };

  if (patch.status !== undefined && patch.check === undefined) {
    patch.check = patch.status !== 'unread';
  } else if (patch.check !== undefined && patch.status === undefined) {
    patch.status = patch.check ? 'responded' : 'unread';
  }

  return patch;
}

function decrementStatusCount(stats, status) {
  if (status === 'unread') stats.unread = Math.max(0, (stats.unread || 0) - 1);
  else if (status === 'read') stats.read = Math.max(0, (stats.read || 0) - 1);
  else if (status === 'responded') stats.responded = Math.max(0, (stats.responded || 0) - 1);
}

function incrementStatusCount(stats, status) {
  if (status === 'unread') stats.unread = (stats.unread || 0) + 1;
  else if (status === 'read') stats.read = (stats.read || 0) + 1;
  else if (status === 'responded') stats.responded = (stats.responded || 0) + 1;
}

export function useWebsiteInquiries(filters = {}, options = {}) {
  return useQuery({
    queryKey: inquiryQueryKeys.list(filters),
    queryFn: () => fetchInquiries(auth, filters),
    ...defaultRealtimeQueryOptions(options),
  });
}

export function useAllWebsiteInquiries(filters = {}, options = {}) {
  return useQuery({
    queryKey: inquiryQueryKeys.allList(filters),
    queryFn: () => fetchAllInquiries(auth, filters),
    ...defaultRealtimeQueryOptions(options),
  });
}

export function useWebsiteInquiryPage(filters = {}, options = {}) {
  return useQuery({
    queryKey: inquiryQueryKeys.page(filters),
    queryFn: () => fetchInquiryPage(auth, filters),
    ...defaultRealtimeQueryOptions(options),
  });
}

export function useWebsiteInquiry(id, options = {}) {
  return useQuery({
    queryKey: inquiryQueryKeys.detail(id),
    queryFn: () => fetchInquiryById(id, auth),
    enabled: Boolean(id) && (options.enabled ?? true),
    ...defaultRealtimeQueryOptions({
      refetchInterval: false,
      ...options,
    }),
  });
}

export function useWebsiteStats(options = {}) {
  return useQuery({
    queryKey: inquiryQueryKeys.stats(),
    queryFn: async () => {
      const response = await apiRequest('/inquiries/stats', { method: 'GET' }, auth);
      return response.data || response;
    },
    ...defaultRealtimeQueryOptions(options),
  });
}

export function useInquiryAttachments(id, options = {}) {
  return useQuery({
    queryKey: inquiryQueryKeys.attachments(id),
    queryFn: () => fetchAttachmentUrls(id, auth),
    enabled: Boolean(id) && (options.enabled ?? true),
    ...defaultRealtimeQueryOptions({
      refetchInterval: false,
      ...options,
    }),
  });
}

export function useUpdateInquiry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }) => updateInquiry(id, updates, auth),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: inquiryQueryKeys.all });

      const previousLists = queryClient.getQueriesData({ queryKey: inquiryQueryKeys.lists() });
      const previousAllLists = queryClient.getQueriesData({ queryKey: inquiryQueryKeys.allLists() });
      const previousPages = queryClient.getQueriesData({ queryKey: inquiryQueryKeys.pages() });
      const previousStats = queryClient.getQueryData(inquiryQueryKeys.stats());
      const previousDetail = queryClient.getQueryData(inquiryQueryKeys.detail(id));
      const cachedItem = findInCachedCollections([...previousLists, ...previousAllLists, ...previousPages], id) || previousDetail;
      const patch = normalizeInquiryPatch(updates);

      updateAllInquiryCollectionCaches(queryClient, (items) => replaceItemById(items, id, patch));
      queryClient.setQueryData(inquiryQueryKeys.detail(id), (oldData) => (oldData ? { ...oldData, ...patch } : oldData));

      const oldStatus = resolveInquiryStatus(cachedItem);
      const nextStatus = resolveInquiryStatus({ ...cachedItem, ...patch });
      if (previousStats && cachedItem && oldStatus !== nextStatus) {
        queryClient.setQueryData(inquiryQueryKeys.stats(), (oldStats) => {
          if (!oldStats) return oldStats;
          const nextStats = { ...oldStats };
          decrementStatusCount(nextStats, oldStatus);
          incrementStatusCount(nextStats, nextStatus);
          nextStats.website = nextStats.unread || 0;
          return nextStats;
        });
      }

      return { previousLists, previousAllLists, previousPages, previousStats, previousDetail };
    },
    onError: (err, { id }, context) => {
      context?.previousLists?.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
      context?.previousAllLists?.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
      context?.previousPages?.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
      if (context?.previousStats) queryClient.setQueryData(inquiryQueryKeys.stats(), context.previousStats);
      if (context?.previousDetail) queryClient.setQueryData(inquiryQueryKeys.detail(id), context.previousDetail);
      console.error('[Mutation Error] Failed to update website inquiry:', err);
    },
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: inquiryQueryKeys.lists(), refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: inquiryQueryKeys.allLists(), refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: inquiryQueryKeys.pages(), refetchType: 'active' });
      invalidateInactive(queryClient, inquiryQueryKeys.all);
      queryClient.invalidateQueries({ queryKey: inquiryQueryKeys.detail(id) });
    },
  });
}

export function useDeleteInquiry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => deleteInquiry(id, auth),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: inquiryQueryKeys.all });

      const previousLists = queryClient.getQueriesData({ queryKey: inquiryQueryKeys.lists() });
      const previousAllLists = queryClient.getQueriesData({ queryKey: inquiryQueryKeys.allLists() });
      const previousPages = queryClient.getQueriesData({ queryKey: inquiryQueryKeys.pages() });
      const previousStats = queryClient.getQueryData(inquiryQueryKeys.stats());
      const deleted = findInCachedCollections([...previousLists, ...previousAllLists, ...previousPages], id);

      updateAllInquiryCollectionCaches(queryClient, (items) => removeItemById(items, id));
      queryClient.removeQueries({ queryKey: inquiryQueryKeys.detail(id) });

      if (deleted && previousStats) {
        queryClient.setQueryData(inquiryQueryKeys.stats(), (oldStats) => {
          if (!oldStats) return oldStats;
          const nextStats = {
            ...oldStats,
            total: Math.max(0, (oldStats.total || 0) - 1),
          };
          decrementStatusCount(nextStats, resolveInquiryStatus(deleted));
          nextStats.website = nextStats.unread || 0;
          return nextStats;
        });
      }

      return { previousLists, previousAllLists, previousPages, previousStats };
    },
    onError: (err, _id, context) => {
      context?.previousLists?.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
      context?.previousAllLists?.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
      context?.previousPages?.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
      if (context?.previousStats) queryClient.setQueryData(inquiryQueryKeys.stats(), context.previousStats);
      console.error('[Mutation Error] Failed to delete website inquiry:', err);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inquiryQueryKeys.lists(), refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: inquiryQueryKeys.allLists(), refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: inquiryQueryKeys.pages(), refetchType: 'active' });
      invalidateInactive(queryClient, inquiryQueryKeys.all);
    },
  });
}

export function useSendSmsResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ inquiryId, phone, message }) => sendInquirySMSResponse({ inquiryId, phone, message }, auth),
    onSettled: (_result, _error, variables) => {
      invalidateInactive(queryClient, inquiryQueryKeys.all);
      if (variables?.inquiryId) {
        queryClient.invalidateQueries({ queryKey: inquiryQueryKeys.detail(variables.inquiryId) });
      }
    },
  });
}
