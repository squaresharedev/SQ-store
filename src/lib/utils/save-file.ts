/**
 * Hand the browser a file to save, from data already in the page (a Blob or
 * text), without navigating anywhere. Browser only.
 *
 * Through a temporary `<a download>`: the one way that works in every browser
 * without a popup, and it keeps the page (and any error shown on it) in place.
 */
export function saveFile(data: Blob | string, fileName: string, type = "text/plain;charset=utf-8"): void {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** The file name a response's Content-Disposition names, or null. */
export function attachmentFileName(response: Response): string | null {
  const header = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(header);
  return match ? match[1]! : null;
}
