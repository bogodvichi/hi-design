/** CSS-only native scrollbar enhancement. Self-contained for opaque preview frames. */
export function installNativeScrollbars(root: HTMLElement): () => void {
  const doc = root.ownerDocument;
  const marker = 'data-od-native-scrollbars';
  const previous = root.getAttribute(marker);
  const stylesheet = doc.createElement('style');
  stylesheet.setAttribute('data-od-native-scrollbars-style', '');
  // Native geometry and interactions follow the platform. Low-specificity
  // defaults preserve deliberate hidden bars and explicit preview author rules.
  stylesheet.textContent = `
:where([data-od-native-scrollbars], [data-od-native-scrollbars] *) {
  scrollbar-width: thin;
  scrollbar-color: var(--od-native-scrollbar-thumb, light-dark(rgb(0 0 0 / 18%), rgb(255 255 255 / 18%))) transparent;
}
@media (forced-colors: active) {
  :where([data-od-native-scrollbars], [data-od-native-scrollbars] *) {
    scrollbar-color: auto;
  }
}`;
  // Install defaults before author styles so explicit native policies win.
  doc.head.prepend(stylesheet);
  root.setAttribute(marker, '');
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    stylesheet.remove();
    if (previous === null) root.removeAttribute(marker);
    else root.setAttribute(marker, previous);
  };
}

/** Preview styles live with the document, including back/forward-cache restores. */
export function buildNativeScrollbarsScript(): string {
  return `(() => {
    const boot = () => {
      if (!document.querySelector('style[data-od-native-scrollbars-style]')) {
        (${installNativeScrollbars.toString()})(document.documentElement);
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  })()`;
}

/** @deprecated Compatibility entry; now installs native CSS without overlays. */
export function installOverlayScrollbars(root: HTMLElement, _documentViewport = false): () => void {
  return installNativeScrollbars(root);
}
/** @deprecated Use buildNativeScrollbarsScript. */
export const buildOverlayScrollbarsScript = buildNativeScrollbarsScript;
