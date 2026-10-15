// When does the pointer leaving close the expanded island? Port of AutoCollapsePolicy (macOS):
// - opened with Ctrl+Alt+N ("sticky"): not until the pointer has been inside once;
// - a native list (<select>, e.g. the currency pickers) is open: never — its popup can
//   extend past the panel while the person is still choosing;
// - after such a list closes: sticky again until the pointer comes back in;
// - a native dialog or a system drag in progress ("modal"): never.
// Clicking outside (window blur) is handled separately and still closes it.
export interface CollapseState { sticky: boolean; entered: boolean; listOpen: boolean; modal: boolean; }
export const INITIAL: CollapseState = { sticky: false, entered: false, listOpen: false, modal: false };

export const onEnter = (s: CollapseState): CollapseState => ({ ...s, entered: true });

/** A press on a <select>: opens its list, or closes it if it was already open. */
export const onListMouseDown = (s: CollapseState): CollapseState =>
  s.listOpen ? onListClosed(s) : { ...s, listOpen: true };

export const onListClosed = (s: CollapseState): CollapseState =>
  s.listOpen ? { ...s, listOpen: false, sticky: true, entered: false } : s;

export function leaveCollapses(s: CollapseState): boolean {
  if (s.modal || s.listOpen) return false;
  if (s.sticky && !s.entered) return false;
  return true;
}
