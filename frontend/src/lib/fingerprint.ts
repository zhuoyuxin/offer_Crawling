import FingerprintJS from "@fingerprintjs/fingerprintjs";

const FALLBACK_KEY = "fallback_device_fingerprint";
let visitorIdPromise: Promise<string> | null = null;

function getFallbackVisitorId(): string {
  const existing = localStorage.getItem(FALLBACK_KEY);
  if (existing) {
    return existing;
  }
  const generated = `fallback-${crypto.randomUUID()}`;
  localStorage.setItem(FALLBACK_KEY, generated);
  return generated;
}

export async function getVisitorId(): Promise<string> {
  if (!visitorIdPromise) {
    visitorIdPromise = FingerprintJS.load()
      .then((fp) => fp.get())
      .then((result) => result.visitorId)
      .catch(() => getFallbackVisitorId());
  }
  return visitorIdPromise!;
}
