export function getLoginDestination(next?: string): string {
  if (!next?.startsWith("/")) return "/";
  try {
    const url = new URL(next, window.location.origin);
    if (
      url.origin === window.location.origin &&
      !url.pathname.startsWith("//")
    ) {
      return url.pathname + url.search + url.hash;
    }
  } catch {
    // Ignore a malformed redirect target.
  }
  return "/";
}
