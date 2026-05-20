import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addEmailLabel,
  archiveEmail,
  createDraft,
  createScheduledEmail,
  deleteDraft,
  deleteEmailInquiry,
  deleteEmailPermanently,
  deleteScheduledEmail,
  downloadEmailAttachment,
  fetchDrafts,
  fetchEmailAttachments,
  fetchEmailContent,
  fetchEmailDetail,
  fetchEmailFolders,
  fetchEmailInquiryPage,
  fetchEmailInquiries,
  fetchEmailLabels,
  fetchEmailMailbox,
  fetchEmailStats,
  fetchEmailThread,
  fetchScheduledEmails,
  removeEmailLabel,
  replyToEmail,
  restoreEmail,
  searchEmails,
  sendDraft,
  sendEmail,
  sendEmailResponse,
  sendScheduledNow,
  setEmailFlag,
  setEmailReadState,
  setEmailResponseState,
  trashEmail,
  translateEmailInquiry,
  unarchiveEmail,
  triggerZohoSync,
  updateDraft,
  updateEmailInquiry,
  updateScheduledEmail,
} from '../../services/emailInquiryService';
import { emailQueryKeys } from './emailQueryKeys';
import { defaultRealtimeQueryOptions, invalidateInactive } from './queryUtils';

const EMAIL_REFRESH_INTERVAL_MS = 30 * 1000;
const EMAIL_THREAD_REFRESH_INTERVAL_MS = 60 * 1000;

function invalidateEmailWorkspace(queryClient) {
  queryClient.invalidateQueries({ queryKey: emailQueryKeys.all, refetchType: 'active' });
  invalidateInactive(queryClient, emailQueryKeys.all);
}

function useEmailMutation(mutationFn, { onSuccess } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (result, variables, context) => {
      invalidateEmailWorkspace(queryClient);
      onSuccess?.(result, variables, context, queryClient);
    },
    onError: (err) => {
      console.error('[Email Mutation] Failed:', err);
    },
  });
}

export function useEmailMailbox(mailbox = 'inbox', filters = {}, page = {}, options = {}) {
  const params = { ...filters, ...page, mailbox };

  return useQuery({
    queryKey: emailQueryKeys.mailbox(mailbox, filters, page),
    queryFn: () => fetchEmailMailbox(params),
    ...defaultRealtimeQueryOptions({
      refetchInterval: EMAIL_REFRESH_INTERVAL_MS,
      ...options,
    }),
  });
}

export function useEmailSearch(params = {}, options = {}) {
  return useQuery({
    queryKey: emailQueryKeys.search(params),
    queryFn: () => searchEmails(params),
    enabled: Boolean(params.query || params.search) && (options.enabled ?? true),
    ...defaultRealtimeQueryOptions({
      refetchInterval: false,
      ...options,
    }),
  });
}

export function useEmailInquiries(options = {}) {
  return useQuery({
    queryKey: emailQueryKeys.list(options),
    queryFn: () => fetchEmailInquiries(options),
    ...defaultRealtimeQueryOptions({
      refetchInterval: EMAIL_REFRESH_INTERVAL_MS,
    }),
  });
}

export function useEmailInquiryPage(options = {}) {
  const mailbox = options.mailbox || 'inbox';

  return useQuery({
    queryKey: emailQueryKeys.page(options),
    queryFn: () => fetchEmailInquiryPage({ ...options, mailbox }),
    ...defaultRealtimeQueryOptions({
      refetchInterval: EMAIL_REFRESH_INTERVAL_MS,
    }),
  });
}

export function useAllEmailsForThread(options = {}) {
  const threadOptions = { ...options, includeOutgoing: true };

  return useQuery({
    queryKey: emailQueryKeys.list(threadOptions),
    queryFn: () => fetchEmailInquiries(threadOptions),
    ...defaultRealtimeQueryOptions({
      refetchInterval: EMAIL_THREAD_REFRESH_INTERVAL_MS,
    }),
  });
}

export function useEmailStats(options = {}) {
  return useQuery({
    queryKey: emailQueryKeys.stats(),
    queryFn: fetchEmailStats,
    ...defaultRealtimeQueryOptions({
      refetchInterval: EMAIL_REFRESH_INTERVAL_MS,
      ...options,
    }),
  });
}

export function useEmailDetail(id, options = {}) {
  return useQuery({
    queryKey: emailQueryKeys.detail(id),
    queryFn: () => fetchEmailDetail(id),
    enabled: Boolean(id) && (options.enabled ?? true),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
    ...options,
  });
}

export function useEmailThread(id, order = 'asc', options = {}) {
  const threadOrder = typeof order === 'string' ? order : 'asc';
  const queryOptions = typeof order === 'string' ? options : order;

  return useQuery({
    queryKey: emailQueryKeys.thread(id, threadOrder),
    queryFn: () => fetchEmailThread(id, { order: threadOrder }),
    enabled: Boolean(id) && (queryOptions.enabled ?? true),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
    ...queryOptions,
  });
}

export function useEmailContent(id, options = {}) {
  return useQuery({
    queryKey: emailQueryKeys.content(id),
    queryFn: () => fetchEmailContent(id),
    enabled: Boolean(id) && (options.enabled ?? true),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
    ...options,
  });
}

export function useEmailAttachments(id, options = {}) {
  return useQuery({
    queryKey: emailQueryKeys.attachments(id),
    queryFn: () => fetchEmailAttachments(id),
    enabled: Boolean(id) && (options.enabled ?? true),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
    ...options,
  });
}

export function useEmailFolders(options = {}) {
  return useQuery({
    queryKey: emailQueryKeys.folders(),
    queryFn: fetchEmailFolders,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    ...options,
  });
}

export function useEmailLabels(options = {}) {
  return useQuery({
    queryKey: emailQueryKeys.labels(),
    queryFn: fetchEmailLabels,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    ...options,
  });
}

export function useEmailDrafts(filters = {}, options = {}) {
  return useQuery({
    queryKey: emailQueryKeys.drafts(filters),
    queryFn: () => fetchDrafts(filters),
    ...defaultRealtimeQueryOptions({
      refetchInterval: EMAIL_REFRESH_INTERVAL_MS,
      ...options,
    }),
  });
}

export function useScheduledEmails(filters = {}, options = {}) {
  return useQuery({
    queryKey: emailQueryKeys.scheduled(filters),
    queryFn: () => fetchScheduledEmails(filters),
    ...defaultRealtimeQueryOptions({
      refetchInterval: EMAIL_REFRESH_INTERVAL_MS,
      ...options,
    }),
  });
}

export function useDownloadEmailAttachment() {
  return useMutation({
    mutationFn: ({ emailId, attachmentId, filename }) => downloadEmailAttachment(emailId, attachmentId, filename),
  });
}

export function useTranslateEmailInquiry() {
  return useEmailMutation((id) => translateEmailInquiry(id));
}

export function useUpdateEmailInquiry() {
  return useEmailMutation(({ id, updates }) => updateEmailInquiry(id, updates));
}

export function useDeleteEmailInquiry() {
  return useEmailMutation((id) => deleteEmailInquiry(id));
}

export function useSetEmailReadState() {
  return useEmailMutation(({ id, readState }) => setEmailReadState(id, readState));
}

export function useSetEmailResponseState() {
  return useEmailMutation(({ id, responseState }) => setEmailResponseState(id, responseState));
}

export function useArchiveEmail() {
  return useEmailMutation((id) => archiveEmail(id));
}

export function useUnarchiveEmail() {
  return useEmailMutation((id) => unarchiveEmail(id));
}

export function useTrashEmail() {
  return useEmailMutation((id) => trashEmail(id));
}

export function useRestoreEmail() {
  return useEmailMutation(({ id, folderId, ...extra }) => restoreEmail(id, folderId, extra));
}

export function useDeleteEmailPermanently() {
  return useEmailMutation((id) => deleteEmailPermanently(id));
}

export function useSetEmailFlag() {
  return useEmailMutation(({ id, starred }) => setEmailFlag(id, starred));
}

export function useAddEmailLabel() {
  return useEmailMutation(({ id, labelId }) => addEmailLabel(id, labelId));
}

export function useRemoveEmailLabel() {
  return useEmailMutation(({ id, labelId }) => removeEmailLabel(id, labelId));
}

export function useSendEmail() {
  return useEmailMutation((payload) => sendEmail(payload));
}

export function useReplyToEmail() {
  return useEmailMutation(({ emailId, ...payload }) => replyToEmail(emailId, payload));
}

export function useSaveEmailDraft() {
  return useEmailMutation(({ id, ...payload }) => (id ? updateDraft(id, payload) : createDraft(payload)));
}

export function useDeleteEmailDraft() {
  return useEmailMutation((id) => deleteDraft(id));
}

export function useSendEmailDraft() {
  return useEmailMutation((id) => sendDraft(id));
}

export function useScheduleEmail() {
  return useEmailMutation(({ id, ...payload }) => (
    id ? updateScheduledEmail(id, payload) : createScheduledEmail(payload)
  ));
}

export function useDeleteScheduledEmail() {
  return useEmailMutation((id) => deleteScheduledEmail(id));
}

export function useSendScheduledNow() {
  return useEmailMutation((id) => sendScheduledNow(id));
}

export function useTriggerZohoSync() {
  return useEmailMutation(triggerZohoSync, {
    onSuccess: (result) => {
      console.log(`[ZOHO Sync] new: ${result?.new || 0}, skipped: ${result?.skipped || 0}`);
    },
  });
}

export function useSendEmailResponse() {
  return useEmailMutation(({ emailId, responseText, attachments = [] }) =>
    sendEmailResponse(emailId, responseText, attachments)
  );
}
