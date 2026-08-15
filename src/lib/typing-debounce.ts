/**
 * How long a field waits after the last keystroke before it asks the server.
 *
 * ONE number, in one place, because every field that looks something up while
 * you type is spending the same budget: a request per keystroke turns a
 * ten-character search into ten round trips, ten Postgres queries and ten
 * rate-limit takes, of which only the last one's answer is ever shown.
 *
 * 300ms is the value the whole product uses. It is long enough that ordinary
 * typing (which lands well inside it) collapses to a single request, and short
 * enough that a deliberate pause still feels like the results arrive as you
 * type. The interval had drifted to three different numbers across four
 * fields; this module exists so it cannot drift again.
 *
 * A debounce is a COURTESY, not a defence. It cuts the requests an honest
 * seller makes; it does nothing about one that is trying to make many. The
 * server-side sliding-window limiter (lib/rate-limit) is what actually bounds
 * the traffic, and every one of these paths goes through it.
 */
export const TYPING_DEBOUNCE_MS = 300;
