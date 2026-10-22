/*
 * Square Share storefront embed: the loader a seller pastes into their site.
 *
 *   <div data-squareshare-storefront="EMBED KEY"></div>
 *   <script async src="https://<embed host>/widget.js"></script>
 *
 * IT DOES ONE THING: puts a frame showing the seller's storefront where the
 * div is, and keeps the frame as tall as its content. It reads nothing from
 * the page it runs on but the hosts of that page and of the pages it sits
 * inside, stores nothing, sets no cookie, loads nothing else and exposes no
 * global.
 *
 * WHAT THE FRAME MAY DO is fixed here, by the sandbox: run its own script and
 * open a link in a new tab. It cannot navigate this page, open a dialog or
 * reach anything on the page around it.
 *
 * WHO MAY SHOW A STOREFRONT is not decided here. The frame's address names
 * this page's host and the host of every page above it (a site builder that
 * puts pasted code in a frame of its own adds one or two); our server only
 * answers when every one is the seller's site or a builder's frame for it, and
 * tells the browser to draw the answer only under those. A page that names
 * hosts it is not under gets a frame its own browser refuses to draw.
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
  var SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms";
  var MAX_SITES = 4;
  var MAX_HEIGHT = 20000;
  var TITLE_MAX = 120;
  var SILENCE_MS = 10000;
  var KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var WEB = /^https?:\/\//i;

  // An anchor takes an address apart in every browser there is.
  function parse(address) {
    var link = document.createElement("a");
    link.href = address;
    return /^https?:$/.test(link.protocol) && link.host ? link : null;
  }

  // Where this file came from is where the frame is served from. An async
  // script still has currentScript while it runs; the fallback covers a page
  // that injected the tag in a way that leaves it empty.
  var script = document.currentScript || document.querySelector('script[src$="/widget.js"]');
  var own = script && script.src && WEB.test(script.src) ? parse(script.src) : null;
  if (!own) return;
  var origin = own.protocol + "//" + own.host;

  // This page's host, then the host of every page above it, nearest first:
  // the browser draws the frame only if each of them is named. A page in a
  // srcdoc or blank frame has no host of its own and takes its parent's,
  // which is the next one up. Old browsers without ancestorOrigins get the
  // parent alone, from the referrer, which covers one builder frame.
  function sites() {
    var hosts = [];
    function add(address) {
      if (!address || !WEB.test(address)) return;
      var link = parse(address);
      if (link && hosts.indexOf(link.host) === -1) hosts.push(link.host);
    }
    add(location.href);
    var above = location.ancestorOrigins;
    if (above && above.length) {
      for (var i = 0; i < above.length; i++) add(above[i]);
    } else if (window.top !== window) {
      add(document.referrer);
    }
    return hosts;
  }

  var here = sites();

  // An https frame under a plain-http page: the browser refuses to draw it
  // (frame-ancestors names bare hosts, and on an https frame a bare host
  // matches https only), so this says so out loud instead: no frame, and the
  // reason in the console. The same rule as the browser's, so a frame served
  // over http (development, the e2e stand-in sites) is unaffected. Loopback
  // hosts are a site on its owner's own machine and are left alone.
  function plain(address) {
    var link = address && WEB.test(address) ? parse(address) : null;
    return (
      !!link &&
      link.protocol === "http:" &&
      !/^(localhost|127\.0\.0\.1)$|\.localhost$/.test(link.hostname)
    );
  }
  var insecure = false;
  if (own.protocol === "https:") {
    insecure = plain(location.href);
    var chain = location.ancestorOrigins;
    if (chain) for (var c = 0; c < chain.length; c++) insecure = insecure || plain(chain[c]);
  }

  // For the person setting it up, who sees nothing when it does not work.
  function explain() {
    if (!window.console) return;
    console.info(
      "[Square Share] The storefront is not showing on " +
        (here[here.length - 1] || "this page") +
        ". Check that this site's address is in the storefront's allowed domains, that embedding is switched on, and that the site uses https. Pasted code shows on the published site, not in a site builder's editor or preview, unless that preview address is listed too.",
    );
  }

  function mount(node) {
    if (node.hasAttribute(READY)) return;
    var key = node.getAttribute(ATTRIBUTE) || "";
    // Shape-checked before it is put in an address. Anything else is left
    // alone, and left unmarked so a corrected key is picked up later.
    if (!KEY.test(key)) return;
    node.setAttribute(READY, "");
    // Nested deeper than any builder goes: no frame could be drawn here.
    if (!here.length || here.length > MAX_SITES || insecure) return explain();

    var frame = document.createElement("iframe");
    // The hosts go in as they are, never percent-encoded: the server matches
    // the path as written.
    frame.src = origin + FRAME_PREFIX + key + "/" + here.join("/");
    frame.title = "Shop";
    frame.setAttribute("sandbox", SANDBOX);
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

    setTimeout(function () {
      if (!heard) explain();
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

  // Slots that arrive LATER: a page a site builder or a single-page app draws
  // after load puts the div in well after this has run. Watched for as long as
  // the page lives, and only ever to run the same scan, which skips every slot
  // it has already made a frame for, so a busy page costs one cheap pass per
  // burst of changes and not one per change.
  if (typeof MutationObserver === "function") {
    var queued = false;
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      setTimeout(function () {
        queued = false;
        scan();
      }, 100);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
