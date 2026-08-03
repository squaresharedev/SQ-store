/** Every nav icon takes the same props: size and color come from the row. */
export type NavIconProps = {
  className?: string;
  /**
   * How many times the row this icon sits in has been hovered or focused.
   *
   * Most icons ignore it and animate purely from the variant labels the row
   * propagates. It exists for the icons whose story is a one-shot that plays
   * out and stays put rather than rewinding when the pointer leaves, which a
   * whileHover variant cannot express.
   *
   * It counts rather than reporting a boolean on purpose. A boolean has to be
   * cleared to arm the next hover, so a single missed pointer-leave (the
   * pointer going straight out of the window, a scroll under the cursor)
   * leaves it stuck on and the icon never fires again. A counter only ever
   * goes up, so every hover starts a run no matter what came before.
   *
   * Ordinary component state, never persisted anywhere.
   */
  hoverCount?: number;
};
