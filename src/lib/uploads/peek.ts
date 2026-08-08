/**
 * Read the first bytes of a stream WITHOUT consuming it.
 *
 * WHY THIS EXISTS. The digital-file upload route streams its body straight into
 * R2 and never holds it: files run to 200 MB, and buffering one inside a Worker
 * is not an option. But the bytes still have to be inspected before they are
 * stored, and reading from a ReadableStream is destructive — whatever you read
 * is gone from the stream the caller then forwards.
 *
 * So this reads just enough for a magic-number check and hands back a stream
 * that replays those bytes ahead of the remainder. The forwarded stream is
 * byte-identical to the original, which matters more than it looks: the route
 * sends an explicit Content-Length to R2, and losing or duplicating a single
 * byte would make the upload fail against it.
 */

/**
 * Buffer up to `wanted` bytes from `stream`, returning them alongside a stream
 * that still yields the ENTIRE original content.
 *
 * `head` may be shorter than `wanted` if the stream ended first; callers must
 * treat a short head as "not enough bytes to judge", not as an error.
 */
export async function peekStream(
  stream: ReadableStream<Uint8Array>,
  wanted: number,
): Promise<{ head: Uint8Array; body: ReadableStream<Uint8Array> }> {
  const reader = stream.getReader();
  const buffered: Uint8Array[] = [];
  let buffest = 0;

  while (buffest < wanted) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      buffered.push(value);
      buffest += value.byteLength;
    }
  }

  // Flatten only the prefix we were asked for; the rest stays in its original
  // chunks and is replayed untouched.
  const head = new Uint8Array(Math.min(buffest, wanted));
  let offset = 0;
  for (const chunk of buffered) {
    if (offset >= head.length) break;
    const take = Math.min(chunk.byteLength, head.length - offset);
    head.set(chunk.subarray(0, take), offset);
    offset += take;
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // Everything already pulled off the reader, in order, before anything new.
      for (const chunk of buffered) controller.enqueue(chunk);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      // Propagate cancellation so an aborted upload does not leave the source
      // stream open behind a Worker that has already moved on.
      return reader.cancel(reason);
    },
  });

  return { head, body };
}
