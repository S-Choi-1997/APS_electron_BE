# Firestore Pagination Read Optimization

- Use cursor-based pagination: `orderBy('createdAt', 'desc').limit(PAGE_SIZE)` and store each page's `lastDoc` so `startAfter(lastDoc)` loads only the next slice without rereading previous pages.
- Push filters into the query to shrink read volume: e.g., `where('responded', '==', false)` for 미열람 보기, and `where('type', '==', selectedType)` when a 태그가 선택됨.
- Keep lightweight list fields (`name`, `phone`, `email`, `type`, `createdAt`, `responded`) in the consultations collection; load heavy fields (long `message`, attachments) only when opening the modal (second `getDoc` or a separate `consultationDetails` collection) so list pagination is cheap.
- Cache visited pages in state (or local cache) so navigating back/forward reuses existing docs instead of refetching.
- Prefer `getDocs(query, { source: 'cache' })` when the data is already in memory/on-disk cache to avoid extra billed reads.
- If real-time updates are not required, use `getDocs` instead of `onSnapshot` for paginated lists; if live updates are needed, debounce re-queries and keep PAGE_SIZE small (10?20) to cap reads per refresh.