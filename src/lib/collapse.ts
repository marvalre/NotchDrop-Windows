// When does the pointer leaving close the expanded island? Port of AutoCollapsePolicy (macOS):
// - opened with Ctrl+Alt+N ("sticky"): not until the pointer has been inside once;
// - a native dialog or a system drag in progress ("modal"): never.
// Lists (currency, formats, cookies) are drawn inside the island, so choosing from one never
// takes the pointer outside. Clicking outside (window blur) is handled separately.
export interface CollapseState { sticky: boolean; entered: boolean; modal: boolean; }
export const INITIAL: CollapseState = { sticky: false, entered: false, modal: false };

export const onEnter = (s: CollapseState): CollapseState => ({ ...s, entered: true });

export function leaveCollapses(s: CollapseState): boolean {
  if (s.modal) return false;
  if (s.sticky && !s.entered) return false;
  return true;
}
