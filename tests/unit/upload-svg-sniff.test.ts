// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sniffImage, sniffSvg } from "@/lib/uploads/sniff";

/**
 * SVG is the ONE upload in this product that is markup, so this sniffer is the
 * gate that decides whether a seller's artwork can carry anything active. It
 * rejects rather than sanitizes, which makes the contract testable: every entry
 * below is a document that must not reach storage.
 *
 * Elements also only ever render through `<img src>`, where SVG runs in the
 * spec's secure static mode. These tests cover the other layer — the one that
 * still holds if a stored object is ever fetched some other way.
 */

const encode = (text: string) => new TextEncoder().encode(text);

/** A clean, realistic icon: the shape every "accepts" case is a variation of. */
const CLEAN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="#171717"/></svg>`;

const SVG_MIME = { mime: "image/svg+xml", ext: "svg" };

describe("sniffSvg - accepts honest artwork", () => {
  it("identifies a plain SVG", () => {
    expect(sniffSvg(encode(CLEAN))).toEqual(SVG_MIME);
  });

  it("accepts an XML declaration before the root element", () => {
    const withDecl = `<?xml version="1.0" encoding="UTF-8"?>${CLEAN}`;
    expect(sniffSvg(encode(withDecl))).toEqual(SVG_MIME);
  });

  it("accepts leading comments — exporters stamp a licence there", () => {
    const withComment = `<!-- Generator: SomeApp 1.0 --><!-- CC-BY -->${CLEAN}`;
    expect(sniffSvg(encode(withComment))).toEqual(SVG_MIME);
  });

  it("accepts a declaration, comments and whitespace together", () => {
    const messy = `<?xml version="1.0"?>\n  <!-- note -->\n\n  ${CLEAN}`;
    expect(sniffSvg(encode(messy))).toEqual(SVG_MIME);
  });

  it("accepts a UTF-8 BOM (the decoder strips it)", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...encode(CLEAN)]);
    expect(sniffSvg(bom)).toEqual(SVG_MIME);
  });

  it("accepts a same-document <use> reference", () => {
    // The legitimate use of href, and the reason the external-reference rule
    // keys on the scheme rather than banning href outright.
    const useRef = `<svg xmlns="http://www.w3.org/2000/svg"><defs><path id="a" d="M0 0h8v8H0z"/></defs><use href="#a" fill="#000"/></svg>`;
    expect(sniffSvg(encode(useRef))).toEqual(SVG_MIME);
  });

  it("accepts an inline <style> block that imports nothing", () => {
    const styled = `<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:#f00}</style><path class="a" d="M0 0h8v8H0z"/></svg>`;
    expect(sniffSvg(encode(styled))).toEqual(SVG_MIME);
  });

  it("accepts uppercase markup", () => {
    const shouty = `<SVG XMLNS="http://www.w3.org/2000/svg"><PATH D="M0 0h8v8H0z"/></SVG>`;
    expect(sniffSvg(encode(shouty))).toEqual(SVG_MIME);
  });
});

describe("sniffSvg - refuses anything that could execute", () => {
  it("rejects an inline script", () => {
    const bad = CLEAN.replace("<path", "<script>alert(1)</script><path");
    expect(sniffSvg(encode(bad))).toBeNull();
  });

  it("rejects a script whose case is varied to dodge a naive filter", () => {
    const bad = CLEAN.replace("<path", "<ScRiPt>alert(1)</ScRiPt><path");
    expect(sniffSvg(encode(bad))).toBeNull();
  });

  it("rejects a script tag padded with whitespace after the bracket", () => {
    const bad = CLEAN.replace("<path", "< script>alert(1)</script ><path");
    expect(sniffSvg(encode(bad))).toBeNull();
  });

  it.each([
    ["onload", `<svg xmlns="http://www.w3.org/2000/svg" onload="evil()"><path d="M0 0h8v8H0z"/></svg>`],
    ["onclick", `<svg xmlns="http://www.w3.org/2000/svg"><path onclick="evil()" d="M0 0h8v8H0z"/></svg>`],
    ["uppercase ONLOAD", `<svg xmlns="http://www.w3.org/2000/svg" ONLOAD="evil()"><path d="M0 0h8v8H0z"/></svg>`],
    ["spaced onload =", `<svg xmlns="http://www.w3.org/2000/svg" onload = "evil()"><path d="M0 0h8v8H0z"/></svg>`],
    ["onmouseover", `<svg xmlns="http://www.w3.org/2000/svg"><rect onmouseover="evil()" width="8" height="8"/></svg>`],
  ])("rejects an %s event handler", (_label, source) => {
    expect(sniffSvg(encode(source))).toBeNull();
  });

  it("rejects a javascript: URL", () => {
    const bad = `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><path d="M0 0h8v8H0z"/></a></svg>`;
    expect(sniffSvg(encode(bad))).toBeNull();
  });

  it("rejects foreignObject — it escapes SVG into arbitrary HTML", () => {
    const bad = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="8" height="8"><p>hi</p></foreignObject></svg>`;
    expect(sniffSvg(encode(bad))).toBeNull();
  });

  it.each([["iframe"], ["embed"], ["object"]])(
    "rejects a nested %s browsing context",
    (tag) => {
      const bad = `<svg xmlns="http://www.w3.org/2000/svg"><${tag} src="https://evil.example/x"></${tag}></svg>`;
      expect(sniffSvg(encode(bad))).toBeNull();
    },
  );
});

describe("sniffSvg - refuses anything that reaches off the document", () => {
  it("rejects an external https reference", () => {
    const bad = `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/tracker.png" width="8" height="8"/></svg>`;
    expect(sniffSvg(encode(bad))).toBeNull();
  });

  it("rejects an external xlink:href", () => {
    const bad = `<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="http://evil.example/s.svg#icon"/></svg>`;
    expect(sniffSvg(encode(bad))).toBeNull();
  });

  it("rejects a protocol-relative reference", () => {
    const bad = `<svg xmlns="http://www.w3.org/2000/svg"><image href="//evil.example/x.png" width="8" height="8"/></svg>`;
    expect(sniffSvg(encode(bad))).toBeNull();
  });

  it("rejects an embedded data: payload — that is a second format to sniff", () => {
    const bad = `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,iVBORw0KGgo=" width="8" height="8"/></svg>`;
    expect(sniffSvg(encode(bad))).toBeNull();
  });

  it("rejects a remote url() in a presentation attribute", () => {
    const bad = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8" fill="url(https://evil.example/p.svg#g)"/></svg>`;
    expect(sniffSvg(encode(bad))).toBeNull();
  });

  it("rejects a CSS @import", () => {
    const bad = `<svg xmlns="http://www.w3.org/2000/svg"><style>@import url("//evil.example/s.css");</style><path d="M0 0h8v8H0z"/></svg>`;
    expect(sniffSvg(encode(bad))).toBeNull();
  });
});

describe("sniffSvg - refuses entity and parser tricks", () => {
  it("rejects a DOCTYPE carrying an external entity (XXE)", () => {
    const bad = `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>`;
    expect(sniffSvg(encode(bad))).toBeNull();
  });

  it("rejects nested entity definitions (billion laughs)", () => {
    const bad = `<!DOCTYPE svg [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg"><text>&b;</text></svg>`;
    expect(sniffSvg(encode(bad))).toBeNull();
  });

  it("rejects a bare DOCTYPE even with no entities in it", () => {
    const bad = `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h8v8H0z"/></svg>`;
    expect(sniffSvg(encode(bad))).toBeNull();
  });

  it("rejects a CDATA section", () => {
    const bad = `<svg xmlns="http://www.w3.org/2000/svg"><style><![CDATA[.a{fill:red}]]></style><path class="a" d="M0 0h8v8H0z"/></svg>`;
    expect(sniffSvg(encode(bad))).toBeNull();
  });
});

describe("sniffSvg - refuses anything that is not an SVG document", () => {
  it("rejects markup whose root element is not <svg>", () => {
    const bad = `<html><body><svg xmlns="http://www.w3.org/2000/svg"></svg></body></html>`;
    expect(sniffSvg(encode(bad))).toBeNull();
  });

  it("rejects an element merely named like svg", () => {
    // `<svgx ...>` must not satisfy a "starts with <svg" test.
    const bad = `<svgx xmlns="http://www.w3.org/2000/svg" width="24" height="24"></svgx>`;
    expect(sniffSvg(encode(bad))).toBeNull();
  });

  it("rejects plain text", () => {
    expect(sniffSvg(encode("just a note, nothing structural here at all"))).toBeNull();
  });

  it("rejects a raster image", () => {
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    expect(sniffSvg(png)).toBeNull();
  });

  it("rejects invalid UTF-8 rather than decoding it lossily", () => {
    // A lone continuation byte: no valid sequence starts with 0x80.
    const broken = new Uint8Array([...encode(`<svg xmlns="x"><path/></svg>`), 0x80]);
    expect(sniffSvg(broken)).toBeNull();
  });

  it("rejects an unterminated XML declaration", () => {
    expect(sniffSvg(encode(`<?xml version="1.0" <svg></svg>`))).toBeNull();
  });

  it("rejects an unterminated comment", () => {
    expect(sniffSvg(encode(`<!-- never closed <svg xmlns="x"></svg>`))).toBeNull();
  });

  it("rejects a truncated file rather than guessing", () => {
    expect(sniffSvg(encode("<svg"))).toBeNull();
    expect(sniffSvg(new Uint8Array())).toBeNull();
  });
});

describe("sniffSvg and sniffImage stay disjoint", () => {
  it("the raster sniffer still refuses SVG", () => {
    // The existing invariant: SVG is admitted by its OWN sniffer, for its own
    // upload kind, and never slips into the product-image allowlist.
    expect(sniffImage(encode(CLEAN))).toBeNull();
  });

  it("the SVG sniffer refuses every raster signature", () => {
    const jpeg = new Uint8Array(64);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0], 0);
    expect(sniffSvg(jpeg)).toBeNull();
  });
});
