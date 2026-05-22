import { useCallback, useMemo, useReducer } from 'react';

const INITIAL_EMAIL_PAGE_STATE = {
  mailbox: 'inbox',
  selectedId: null,
  selectedDraftId: null,
  selectedScheduledId: null,
  searchTerm: '',
  readState: 'all',
  responseState: 'all',
  labelId: '',
  hasAttachments: false,
  starred: false,
  page: 0,
  composer: null,
  composerDirty: false,
  actionError: '',
  restoreFolderId: '',
  lastSyncMessage: '',
  showTranslation: false,
  translatedEmailOverride: null,
  filtersOpen: false,
};

function emailPageStateReducer(state, action) {
  switch (action.type) {
    case 'set': {
      const nextValue = typeof action.value === 'function'
        ? action.value(state[action.key])
        : action.value;
      if (Object.is(state[action.key], nextValue)) return state;
      return { ...state, [action.key]: nextValue };
    }
    default:
      return state;
  }
}

export function useEmailPageState() {
  const [state, dispatch] = useReducer(emailPageStateReducer, INITIAL_EMAIL_PAGE_STATE);

  const setStateKey = useCallback((key) => (value) => {
    dispatch({ type: 'set', key, value });
  }, []);

  const setters = useMemo(() => ({
    setMailbox: setStateKey('mailbox'),
    setSelectedId: setStateKey('selectedId'),
    setSelectedDraftId: setStateKey('selectedDraftId'),
    setSelectedScheduledId: setStateKey('selectedScheduledId'),
    setSearchTerm: setStateKey('searchTerm'),
    setReadState: setStateKey('readState'),
    setResponseState: setStateKey('responseState'),
    setLabelId: setStateKey('labelId'),
    setHasAttachments: setStateKey('hasAttachments'),
    setStarred: setStateKey('starred'),
    setPage: setStateKey('page'),
    setComposer: setStateKey('composer'),
    setComposerDirty: setStateKey('composerDirty'),
    setActionError: setStateKey('actionError'),
    setRestoreFolderId: setStateKey('restoreFolderId'),
    setLastSyncMessage: setStateKey('lastSyncMessage'),
    setShowTranslation: setStateKey('showTranslation'),
    setTranslatedEmailOverride: setStateKey('translatedEmailOverride'),
    setFiltersOpen: setStateKey('filtersOpen'),
  }), [setStateKey]);

  return {
    ...state,
    ...setters,
  };
}

export default useEmailPageState;
