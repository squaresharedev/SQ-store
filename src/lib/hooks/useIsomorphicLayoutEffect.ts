import { useEffect, useLayoutEffect } from "react";

/**
 * `useLayoutEffect` on the client, `useEffect` on the server.
 *
 * Client components still render on the server, where layout effects can't run
 * and React warns about them. Use this for effects that MUST land before the
 * first paint — measuring a box, rewinding an animated value — so the user
 * never sees the pre-effect state flash.
 */
export const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
