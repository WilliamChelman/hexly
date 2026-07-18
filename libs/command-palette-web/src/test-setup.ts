/**
 * jsdom implements `<dialog>` markup but not its imperative API (`showModal`/`close`),
 * which the {@link Dialog} primitive relies on. Polyfilled here for unit tests only.
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
