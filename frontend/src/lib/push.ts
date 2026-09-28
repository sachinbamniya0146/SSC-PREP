import { api } from "@/lib/api";

// Public VAPID key — safe to ship to the client (it's the "public" half of
// the key pair). Set NEXT_PUBLIC_VAPID_PUBLIC_KEY at build time to the same
// value as the backend's VAPID_PUBLIC_KEY env var (see backend/src/push).
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    !!VAPID_PUBLIC_KEY
  );
}

export async function getNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/**
 * Registers the service worker (idempotent — safe to call on every page
 * load) and, if the user has already granted permission, makes sure the
 * push subscription is (re-)synced with the backend.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    return registration;
  } catch (err) {
    console.error("Service worker registration failed", err);
    return null;
  }
}

/**
 * Asks the browser for notification permission and, if granted, subscribes
 * to push and saves the subscription on the backend against the logged-in
 * user. Call this from a user gesture (button click) — browsers ignore
 * permission requests that aren't triggered by one.
 */
export async function subscribeToPush(): Promise<"subscribed" | "denied" | "unsupported"> {
  if (!pushSupported()) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  // NOTE: subscription.toJSON() also includes `expirationTime`, which the
  // backend's SubscribeDto doesn't declare — and the API rejects any
  // unknown field on the whole request (ValidationPipe's
  // forbidNonWhitelisted, see push.dto.ts), not just that one field. Send
  // only what the DTO actually expects.
  const { endpoint, keys } = subscription.toJSON();
  await api("/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint, keys }),
  });

  return "subscribed";
}

export async function unsubscribeFromPush(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  await api("/push/unsubscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);

  await subscription.unsubscribe();
}
