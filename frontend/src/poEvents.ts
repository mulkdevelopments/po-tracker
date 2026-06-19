export function notifyPoUpdated() {
  window.dispatchEvent(new Event("po-updated"));
}
