import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { registerAppServiceWorker } from "../lib/pwa.js";

export function ServiceWorkerUpdatePrompt() {
  const { t } = useTranslation();
  const [activateUpdate, setActivateUpdate] = useState<(() => Promise<void> | void) | null>(null);
  const [activating, setActivating] = useState(false);
  const [failed, setFailed] = useState(false);

  // Wrap the callback so React stores it instead of invoking it.
  // Passing setActivateUpdate directly would make React treat the function
  // argument as a state updater and call it, activating the update early.
  useEffect(
    () =>
      registerAppServiceWorker((update) => {
        setFailed(false);
        setActivateUpdate(() => update);
      }),
    [],
  );

  const applyUpdate = useCallback(async () => {
    if (!activateUpdate || activating) return;
    setActivating(true);
    setFailed(false);
    try {
      await activateUpdate();
    } catch {
      setFailed(true);
    } finally {
      setActivating(false);
    }
  }, [activateUpdate, activating]);

  if (!activateUpdate) return null;

  const message = activating
    ? t("pwa.applying")
    : failed
      ? t("pwa.update_failed")
      : t("pwa.ready");

  const buttonLabel = activating
    ? t("pwa.updating")
    : failed
      ? t("pwa.retry")
      : t("pwa.update");

  return (
    <aside
      className="fixed bottom-4 left-4 right-4 z-50 flex items-center justify-between gap-3 rounded-lg bg-gray-900 px-4 py-3 text-sm text-white shadow-lg sm:left-auto sm:right-6 sm:max-w-md"
      role={failed ? "alert" : "status"}
      aria-live={failed ? "assertive" : "polite"}
    >
      <span>{message}</span>
      <button
        type="button"
        className="shrink-0 rounded-md bg-white px-3 py-1.5 font-semibold text-gray-900 disabled:opacity-60"
        onClick={() => void applyUpdate()}
        disabled={activating}
      >
        {buttonLabel}
      </button>
    </aside>
  );
}