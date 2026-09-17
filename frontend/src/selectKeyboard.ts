/**
 * Open a dropdown's list on the down arrow.
 *
 * Tabbing into a <select> and pressing the down arrow moves the selection one
 * option at a time without showing the list, so an operator working through a
 * form on the keyboard can change a value they never saw. Showing the list
 * instead keeps the arrow keys for choosing and leaves Tab to move on.
 *
 * One capturing listener covers every dropdown in the app, including those in
 * drawers and dialogs mounted later.
 */
export function installSelectKeyboard(): void {
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "ArrowDown" || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.defaultPrevented) return;
      const select = e.target;
      if (!(select instanceof HTMLSelectElement) || select.disabled) return;
      // A multi-line select is already a visible list — arrows navigate it.
      if (select.multiple || select.size > 1) return;
      if (typeof select.showPicker !== "function") return;
      try {
        select.showPicker();
      } catch {
        // Browser declined to open it; let its own handling stand.
        return;
      }
      e.preventDefault();
    },
    true,
  );
}
