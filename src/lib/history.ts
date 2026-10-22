/**
 * Undo/redo history with "live" updates: sliders change `present` many times
 * per second, but only a commit (e.g. on slider release) creates an undo step.
 */
export interface History<T> {
  past: T[];
  present: T;
  /** Last committed value; `present` differs from it while a live edit is in progress. */
  anchor: T;
  future: T[];
}

export type HistoryAction<T> =
  | { type: "set"; value: T; commit: boolean }
  | { type: "commit" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; value: T };

export const HISTORY_LIMIT = 40;

export function createHistory<T>(value: T): History<T> {
  return { past: [], present: value, anchor: value, future: [] };
}

function commitPending<T>(h: History<T>, limit: number): History<T> {
  if (h.present === h.anchor) return h;
  return { past: [...h.past, h.anchor].slice(-limit), present: h.present, anchor: h.present, future: [] };
}

export function historyReducer<T>(h: History<T>, action: HistoryAction<T>, limit = HISTORY_LIMIT): History<T> {
  switch (action.type) {
    case "set": {
      const live = { ...h, present: action.value };
      return action.commit ? commitPending(live, limit) : live;
    }
    case "commit":
      return commitPending(h, limit);
    case "undo": {
      const c = commitPending(h, limit);
      if (c.past.length === 0) return c;
      const previous = c.past[c.past.length - 1];
      return { past: c.past.slice(0, -1), present: previous, anchor: previous, future: [c.present, ...c.future] };
    }
    case "redo": {
      if (h.future.length === 0) return h;
      const c = commitPending(h, limit);
      if (c !== h) return c; // a pending live edit discards the redo branch
      const [nextValue, ...rest] = h.future;
      return { past: [...h.past, h.present].slice(-limit), present: nextValue, anchor: nextValue, future: rest };
    }
    case "reset":
      return createHistory(action.value);
  }
}
