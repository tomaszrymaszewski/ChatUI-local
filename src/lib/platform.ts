const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
const isMacOS = /Macintosh|Mac OS X/i.test(userAgent);
const isWindows = /Windows/i.test(userAgent);
const isLinux = /Linux/i.test(userAgent) && !isWindows;
const isWeb = !isTauri;

export { isTauri, isMacOS, isWindows, isLinux, isWeb };
