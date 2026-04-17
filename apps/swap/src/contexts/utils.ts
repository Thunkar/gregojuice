/**
 * Reducer Utilities
 * Helper functions for creating type-safe reducers with bound actions
 */

import { useMemo, useReducer } from "react";

/**
 * Generic type for action creator objects
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ActionCreators = Record<string, (...args: any[]) => { type: string }>;

/**
 * Extracts the return type union from an action creators object
 */
export type ActionsFrom<T extends ActionCreators> = ReturnType<T[keyof T]>;

/**
 * Creates bound action dispatchers from action creators
 *
 * @example
 * const actions = bindActions(swapActions, dispatch);
 * actions.setFromAmount('100'); // Dispatches { type: 'SET_FROM_AMOUNT', amount: '100' }
 */
export function bindActions<T extends ActionCreators>(
  actionCreators: T,
  dispatch: React.Dispatch<ReturnType<T[keyof T]>>,
): { [K in keyof T]: (...args: Parameters<T[K]>) => void } {
  const bound = {} as { [K in keyof T]: (...args: Parameters<T[K]>) => void };

  for (const key in actionCreators) {
    bound[key] = ((...args: Parameters<T[typeof key]>) =>
      dispatch(
        actionCreators[key](...args) as ReturnType<T[keyof T]>,
      )) as (typeof bound)[typeof key];
  }

  return bound;
}

/**
 * Creates a useReducer hook pre-configured with a specific reducer, actions, and initial state.
 * Returns a hook that provides [state, boundActions] tuple.
 *
 * @example
 * // In reducer file:
 * export const useContractsReducer = createReducerHook(contractsReducer, contractsActions, initialContractsState);
 *
 * // In context:
 * const [state, actions] = useContractsReducer();
 * actions.registerStart(); // Type-safe!
 */
export function createReducerHook<S, T extends ActionCreators>(
  reducer: (state: S, action: ReturnType<T[keyof T]>) => S,
  actionCreators: T,
  initialState: S,
): () => [S, { [K in keyof T]: (...args: Parameters<T[K]>) => void }] {
  return function useReducerWithActions() {
    const [state, dispatch] = useReducer(reducer, initialState);
    const actions = useMemo(() => bindActions(actionCreators, dispatch), [dispatch]);
    return [state, actions];
  };
}
