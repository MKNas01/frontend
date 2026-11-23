import { registerSW } from "virtual:pwa-register";

export type ServiceWorkerUpdateHandler = (update: () => Promise<void>) => void;

/**
 * Register the PWA without taking control during the current session.
 * vite-plugin-pwa leaves the new worker waiting; the caller decides when the
 * user has accepted the update and this helper activates it during idle time.
 */
export function registerAppServiceWorker(onUpdateAvailable: ServiceWorkerUpdateHandler): () => void {
  let idleHandle: number | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const cancelScheduledActivation = () => {
    if (idleHandle !== undefined && "cancelIdleCallback" in window) {
      window.cancelIdleCallback(idleHandle);
      idleHandle = undefined;
    }
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
      timeoutHandle = undefined;
    }
  };

  const updateSW = registerSW({
    immediate: false,
    onNeedRefresh() {
      onUpdateAvailable(
        () =>
          new Promise<void>((resolve, reject) => {
            cancelScheduledActivation();
            const activate = () => {
              idleHandle = undefined;
              timeoutHandle = undefined;
              Promise.resolve()
                .then(() => updateSW(true))
                .then(() => resolve())
                .catch((err) => reject(err));
            };
            if ("requestIdleCallback" in window) {
              idleHandle = window.requestIdleCallback(activate, { timeout: 30_000 });
            } else {
              timeoutHandle = globalThis.setTimeout(activate, 1_000);
            }
          }),
      );
    },
  });
  // vite-plugin-pwa does not expose an unregister operation from registerSW;
  // the worker lifecycle is managed by the browser after registration.  The
  // cleanup below cancels any scheduled activation that the user accepted but
  // that has not yet fired, so an unmounted component does not trigger an
  // update.
  return cancelScheduledActivation;
}