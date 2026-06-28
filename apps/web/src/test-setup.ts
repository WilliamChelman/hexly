/**
 * Global unit-test setup. jsdom implements `<dialog>` markup but not its imperative
 * API (`showModal`/`close`), which the {@link Dialog} primitive (ADR-0007) relies on.
 * Polyfill the gap once so dialog-driven components are testable; real browsers and
 * the e2e suite use the native implementation untouched.
 */
const dialogProto = HTMLDialogElement.prototype;

if (typeof dialogProto.showModal !== 'function') {
  dialogProto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
}

if (typeof dialogProto.close !== 'function') {
  dialogProto.close = function (this: HTMLDialogElement, returnValue?: string) {
    if (!this.open) return;
    this.removeAttribute('open');
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.dispatchEvent(new Event('close'));
  };
}
