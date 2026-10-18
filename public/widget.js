/*
 * Square Share storefront embed: the loader a seller pastes into their site.
 *
 *   <div data-squareshare-storefront="EMBED KEY"></div>
 *   <script async src="https://<embed host>/widget.js"></script>
 *
 * IT DOES ONE THING: puts a frame showing the seller's storefront where the
 * div is, and keeps the frame as tall as its content. It reads nothing from
 * the page it runs on but that page's hostname, stores nothing, sets no
 * cookie, loads nothing else and exposes no global.
 *
 * WHAT THE FRAME MAY DO is fixed here, by the sandbox: run its own script and
 * open a link in a new tab. It cannot navigate this page, submit a form, open
 * a dialog or reach anything on the page around it.
 *
 * WHO MAY SHOW A STOREFRONT is not decided here. The frame's address names
 * this page's host; our server only answers for a host the seller listed, and
 * tells the browser to draw the answer on that host alone. A page that names
 * a host it is not gets a frame its own browser refuses to draw.
 *
 * A frame that was refused says nothing, so it is never given a height: the
 * page looks as if the embed were not there, rather than showing an error.
 *
 * Plain ES5 on purpose: it runs on other people's websites, in whatever
 * browser their visitors have, and is never bundled or transpiled. The values
 * it shares with the app live in src/lib/storefront/embed-frame.ts, and
 * tests/unit/embed-widget.test.ts holds the two together.
 */
(function () {
  "use strict";

  var ATTRIBUTE = "data-squareshare-storefront";
  var READY = "data-squareshare-ready";
  var MESSAGE_SOURCE = "squareshare-embed";
  var FRAME_PREFIX = "/e/";
  var MAX_HEIGHT = 20000;
  var TITLE_MAX = 120;
  var SILENCE_MS = 10000;
  var KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  // Where this file came from is where the frame is served from. An async
  // script still has currentScript while it runs; the fallback covers a page
  // that injected the tag in a way that leaves it empty.
  var script = document.currentScript || document.querySelector('script[src$="/widget.js"]');
  if (!script || !script.src) return;
  // An anchor takes an address apart in every browser there is.
  var link = document.createElement("a");
  link.href = script.src;
  if (!/^https?:$/.test(link.protocol) || !link.host) return;
  var origin = link.protocol + "//" + link.host;

  function mount(node) {
    if (node.hasAttribute(READY)) return;
    var key = node.getAttribute(ATTRIBUTE) || "";
    // Shape-checked before it is put in an address. Anything else is left
    // alone, and left unmarked so a corrected key is picked up later.
    if (!KEY.test(key)) return;
    node.setAttribute(READY, "");

    var frame = document.createElement("iframe");
    // The host goes in as it is, never percent-encoded: the server matches
    // the path as written.
    frame.src = origin + FRAME_PREFIX + key + "/" + location.host;
    frame.title = "Shop";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("allow", "");
    frame.style.display = "block";
    frame.style.width = "100%";
    frame.style.height = "0";
    frame.style.border = "0";

    var heard = false;
    window.addEventListener("message", function (event) {
      // Only this frame's own window, from our own origin, saying the one
      // thing it is allowed to say.
      if (event.source !== frame.contentWindow || event.origin !== origin) return;
      var data = event.data;
      if (!data || data.source !== MESSAGE_SOURCE) return;
      var height = data.height;
      if (typeof height !== "number" || !(height > 0)) return;
      heard = true;
      frame.style.height = Math.min(Math.ceil(height), MAX_HEIGHT) + "px";
      // Set as a property, so it can only ever be text.
      if (typeof data.title === "string" && data.title) frame.title = data.title.slice(0, TITLE_MAX);
    });

    node.appendChild(frame);

    // For the person setting it up, who sees nothing when it does not work.
    setTimeout(function () {
      if (heard || !window.console) return;
      console.info(
        "[Square Share] The storefront is not showing on " +
          location.hostname +
          ". Check that this address is in the storefront's allowed domains, that embedding is switched on, and that this site uses https. A site builder that puts custom HTML in a frame of its own is not supported.",
      );
    }, SILENCE_MS);
  }

  function scan() {
    var nodes = document.querySelectorAll("[" + ATTRIBUTE + "]");
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].hasAttribute(READY)) continue;
      watch(nodes[i]);
    }
  }

  // The frame is made when its place on the page is near the screen, so a
  // storefront far down a long page costs nothing until someone scrolls to
  // it, and is not counted as seen by someone who never did.
  var seen = [];
  var observer =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          function (entries) {
            for (var i = 0; i < entries.length; i++) {
              if (!entries[i].isIntersecting) continue;
              observer.unobserve(entries[i].target);
              mount(entries[i].target);
            }
          },
          { rootMargin: "600px" },
        )
      : null;

  function watch(node) {
    if (!observer) return mount(node);
    if (seen.indexOf(node) !== -1) return;
    seen.push(node);
    observer.observe(node);
  }

  scan();
  // The tag is async, so it can run before the div after it has been parsed.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
})();
