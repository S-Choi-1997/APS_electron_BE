import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { auth } from '../../auth/authManager';
import {
  createSchedule,
  deleteSchedule,
  fetchSchedulePage,
  fetchSchedules,
  updateSchedule,
} from '../../services/scheduleService';
import { getDisplayName } from '../../utils/displayName';
import { scheduleQueryKeys } from './scheduleQueryKeys';
import {
  defaultRealtimeQueryOptions,
  findInCachedCollections,
  invalidateInactive,
  removeItemById,
  replaceItemById,
  updateCollectionData,
} from './queryUtils';

function normalizeScheduleTypeLabel(type) {
  if (type === 'company' || type === '회사') return '회사';
  if (type === 'personal' || type === '개인') return '개인';
  return type || '회사';
}

export function normalizeSchedule(schedule) {
  const startDate = schedule.start_date || schedule.startDate;
  const endDate = schedule.end_date || schedule.endDate || startDate;

  return {
    id: schedule.id,
    title: schedule.title,
    time: schedule.time,
    start_date: startDate ? new Date(startDate) : null,
    end_date: endDate ? new Date(endDate) : null,
    type: normalizeScheduleTypeLabel(schedule.type),
    author: schedule.author,
    author_name: schedule.author_name,
    authorDisplayName: getDisplayName([schedule.author_name, schedule.author]),
  };
}

function updateAllScheduleCollectionCaches(queryClient, updater) {
  queryClient.setQueriesData({ queryKey: scheduleQueryKeys.lists() }, (oldData) =>
    updateCollectionData(oldData, updater)
  );
  queryClient.setQueriesData({ queryKey: scheduleQueryKeys.pages() }, (oldData) =>
    updateCollectionData(oldData, updater)
  );
}

export function useSchedules(filters = {}, options = {}) {
  return useQuery({
    queryKey: scheduleQueryKeys.list(filters),
    queryFn: async () => {
      const data = await fetchSchedules(auth, filters);
      return data.map(normalizeSchedule);
    },
    ...defaultRealtimeQueryOptions(options),
  });
}

export function useSchedulePage(filters = {}, options = {}) {
  return useQuery({
    queryKey: scheduleQueryKeys.page(filters),
    queryFn: async () => {
      const page = await fetchSchedulePage(auth, filters);
      return {
        ...page,
        items: page.items.map(normalizeSchedule),
      };
    },
    ...defaultRealtimeQueryOptions(options),
  });
}

export function useCreateSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (scheduleData) => createSchedule(scheduleData, auth),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scheduleQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: scheduleQueryKeys.pages() });
    },
  });
}

export function useUpdateSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }) => updateSchedule(id, updates, auth),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: scheduleQueryKeys.all });

      const previousLists = queryClient.getQueriesData({ queryKey: scheduleQueryKeys.lists() });
      const previousPages = queryClient.getQueriesData({ queryKey: scheduleQueryKeys.pages() });
      const previousDetail = queryClient.getQueryData(scheduleQueryKeys.detail(id));
      const cachedSchedule = findInCachedCollections([...previousLists, ...previousPages], id) || previousDetail;
      const patch = normalizeSchedule({ ...cachedSchedule, ...updates, id });

      updateAllScheduleCollectionCaches(queryClient, (items) => replaceItemById(items, id, patch));
      queryClient.setQueryData(scheduleQueryKeys.detail(id), (oldData) => (oldData ? { ...oldData, ...patch } : oldData));

      return { previousLists, previousPages, previousDetail };
    },
    onError: (err, { id }, context) => {
      context?.previousLists?.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
      context?.previousPages?.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
      if (context?.previousDetail) queryClient.setQueryData(scheduleQueryKeys.detail(id), context.previousDetail);
      console.error('[Mutation Error] Failed to update schedule:', err);
    },
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: scheduleQueryKeys.lists(), refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: scheduleQueryKeys.pages(), refetchType: 'active' });
      invalidateInactive(queryClient, scheduleQueryKeys.all);
      queryClient.invalidateQueries({ queryKey: scheduleQueryKeys.detail(id) });
    },
  });
}

export function useDeleteSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => deleteSchedule(id, auth),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: scheduleQueryKeys.all });

      const previousLists = queryClient.getQueriesData({ queryKey: scheduleQueryKeys.lists() });
      const previousPages = queryClient.getQueriesData({ queryKey: scheduleQueryKeys.pages() });
      updateAllScheduleCollectionCaches(queryClient, (items) => removeItemById(items, id));
      queryClient.removeQueries({ queryKey: scheduleQueryKeys.detail(id) });

      return { previousLists, previousPages };
    },
    onError: (err, _id, context) => {
      context?.previousLists?.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
      context?.previousPages?.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
      console.error('[Mutation Error] Failed to delete schedule:', err);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scheduleQueryKeys.lists(), refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: scheduleQueryKeys.pages(), refetchType: 'active' });
      invalidateInactive(queryClient, scheduleQueryKeys.all);
    },
  });
}
