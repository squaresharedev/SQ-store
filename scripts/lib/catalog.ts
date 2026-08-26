// The seed catalogue: store collections, each a SINGLE design language.
//
// A "collection" is not the same as a category. Furniture ships as TWO
// collections — brutalist concrete and cozy cabin oak — because they are
// alternative shops, not two halves of one. A seeded store draws from exactly
// one, so it never sells a concrete slab bench beside a sheepskin rocker.
//
// WHY THIS IS HAND-AUTHORED. Earlier versions pulled products from an open
// fake-store dataset. Every product was real and every photo matched its own
// name, but a category was still a jumble: an ornate carved bed sat next to a
// red mid-century office chair next to a kitsch photo frame. Coherent
// BACKGROUNDS cannot fix an incoherent DESIGN LANGUAGE, and no public dataset
// carries ten pieces that look like one collection.
//
// So each category here is one collection with one material palette, and the
// product photography was generated to match it (Recraft, prompts recorded in
// each theme's `photoStyle.prompt` so the set can be regenerated or extended
// without drifting). A store seeds from exactly ONE collection, so it never
// mixes brutalist concrete with cottage oak.
//
// Adding a second collection to a category (say a "cabin oak" furniture set
// alongside the brutalist one) means adding another entry to CATALOG with its
// own key, prompt and products — the seeder already treats each entry as a
// self-contained shop.
//
// IMAGE URLS point at our own Supabase Storage, not at the generator: see
// scripts/mirror-catalog-images.ts for why, and re-run it after adding rows.

import type { ProductTheme } from "./fake-data.ts";

export const CATALOG: readonly ProductTheme[] = [
  {
    key: "furniture-brutalist",
    label: "Brutalist Furniture",
    photoStyle: {
      name: "Studio white",
      aesthetic: "Brutalist concrete and blackened steel",
      prompt:
        "Product photograph of modern brutalist furniture made of raw board-formed concrete with visible timber grain and blackened steel. Centered on a seamless pure white studio backdrop, soft even diffused studio lighting, subtle grounded contact shadow beneath, no props, no text, furniture catalogue product photography.",
    },
    products: [
      {
        title: "Böden Concrete Lounge Chair",
        description:
          "A monolithic board-formed concrete shell on blackened steel legs, with a single charcoal wool cushion. Sealed for indoor use.",
        priceCents: 129_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/furniture/b-den-concrete-lounge-chair.jpg",
      },
      {
        title: "Formwork Dining Table",
        description:
          "A thick cast concrete slab carrying the grain of its timber formwork, on heavy blackened steel plate legs. Seats six.",
        priceCents: 245_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/furniture/formwork-dining-table.jpg",
      },
      {
        title: "Rampart Shelving Unit",
        description:
          "Nine open bays of cast concrete shelving held in a welded blackened steel frame. Wall-anchored; ships flat.",
        priceCents: 189_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/furniture/rampart-shelving-unit.jpg",
      },
      {
        title: "Pilaster Floor Lamp",
        description:
          "A cast concrete cylinder anchors a blackened steel stem and a charcoal linen drum shade. Inline dimmer on the cord.",
        priceCents: 42_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/furniture/pilaster-floor-lamp.jpg",
      },
      {
        title: "Monolith Coffee Table",
        description:
          "A single low block of board-formed concrete with a recessed steel base, so it reads as floating on the floor.",
        priceCents: 98_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/furniture/monolith-coffee-table.jpg",
      },
      {
        title: "Causeway Bench",
        description:
          "A long concrete seat slab on squat steel plate supports. Rated for outdoor use with the exterior sealer option.",
        priceCents: 76_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/furniture/causeway-bench.jpg",
      },
      {
        title: "Bastion Sideboard",
        description:
          "A cast concrete carcass with flat blackened steel doors on a recessed steel plinth. Soft-close hinges throughout.",
        priceCents: 219_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/furniture/bastion-sideboard.jpg",
      },
      {
        title: "Plinth Stool",
        description:
          "A cylindrical concrete seat on three slim blackened steel legs. Stacks two high; felt pads fitted.",
        priceCents: 29_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/furniture/plinth-stool.jpg",
      },
      {
        title: "Bulwark Writing Desk",
        description:
          "A board-formed concrete top over a welded steel frame with one flat steel drawer and a rear cable channel.",
        priceCents: 154_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/furniture/bulwark-writing-desk.jpg",
      },
    ],
  },
  {
    // Same category and same backdrop as furniture-brutalist, deliberately
    // opposite material palette. Two collections may share a shooting style;
    // what they must never share is a store, which is why they are separate
    // themes rather than one pooled "furniture" list.
    key: "furniture-cozy",
    label: "Cozy Furniture",
    photoStyle: {
      name: "Studio white, warm",
      aesthetic: "Cabin oak, sheepskin and chunky knit wool",
      prompt:
        "Product photograph of cozy cabin furniture in warm honey-toned oak with cream sheepskin, chunky cream knit wool and soft oatmeal linen. Centered on a seamless pure white studio backdrop, soft even diffused studio lighting, subtle grounded contact shadow beneath, no props, no text, furniture catalogue product photography.",
    },
    products: [
      {
        title: "Hearth Linen Sofa",
        description:
          "A deep three-seater in soft oatmeal linen with feather-wrapped cushions and turned oak feet. Covers come off for washing.",
        priceCents: 189_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/furniture-cozy/hearth-linen-sofa.jpg",
      },
      {
        title: "Alder Rocking Chair",
        description:
          "A steam-bent honey oak frame with a full cream sheepskin laid over the seat and back. Rocks on flat runners.",
        priceCents: 74_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/furniture-cozy/alder-rocking-chair.jpg",
      },
      {
        title: "Braid Knit Pouffe",
        description:
          "A round footstool hand-knitted in chunky cream wool over a firm core, on stubby turned oak feet.",
        priceCents: 21_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/furniture-cozy/braid-knit-pouffe.jpg",
      },
      {
        title: "Roundhouse Coffee Table",
        description:
          "A circular solid oak top with a softly eased edge on a chunky turned pedestal. Finished in hardwax oil.",
        priceCents: 89_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/furniture-cozy/roundhouse-coffee-table.jpg",
      },
      {
        title: "Nook Reading Armchair",
        description:
          "A rounded armchair in oatmeal linen built for long sitting, with a chunky knit throw and solid oak legs.",
        priceCents: 98_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/furniture-cozy/nook-reading-armchair.jpg",
      },
      {
        title: "Larder Oak Sideboard",
        description:
          "Solid honey oak with rounded corners, hand-turned knobs and two deep soft-close drawers on tapered legs.",
        priceCents: 145_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/furniture-cozy/larder-oak-sideboard.jpg",
      },
      {
        title: "Candlestick Floor Lamp",
        description:
          "A hand-turned oak column on a round base under a natural linen drum shade. Dimmable, warm 2700K bulb included.",
        priceCents: 38_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/furniture-cozy/candlestick-floor-lamp.jpg",
      },
      {
        title: "Loft Oak Bookshelf",
        description:
          "Four generous shelves in solid oak with softly rounded uprights. Wall-anchored; arrives fully assembled.",
        priceCents: 112_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/furniture-cozy/loft-oak-bookshelf.jpg",
      },
    ],
  },
  {
    key: "tech",
    label: "Tech & Gadgets",
    photoStyle: {
      name: "Low-key charcoal",
      aesthetic: "Matte black sandblasted aluminium",
      prompt:
        "Product photograph of minimalist matte black consumer electronics in sandblasted anodised aluminium, unbranded, no logos or text. Low-key studio lighting on a dark charcoal seamless background, soft rim light along the edges, deep soft shadow, premium electronics catalogue product photography.",
    },
    products: [
      {
        title: "Obsidian 14 Laptop",
        description:
          "A 14-inch machined aluminium body in sandblasted matte black. 32GB unified memory, 1TB storage, 18-hour battery.",
        priceCents: 189_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/tech/obsidian-14-laptop.jpg",
      },
      {
        title: "Obsidian Studio Headphones",
        description:
          "Closed-back over-ears in matte aluminium and black fabric. Adaptive noise cancelling, 40-hour battery, USB-C.",
        priceCents: 34_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/tech/obsidian-studio-headphones.jpg",
      },
      {
        title: "Obsidian Compact Keyboard",
        description:
          "A 65% mechanical board in a milled aluminium case with blank black keycaps and hot-swappable tactile switches.",
        priceCents: 18_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/tech/obsidian-compact-keyboard.jpg",
      },
      {
        title: "Obsidian Room Speaker",
        description:
          "A cylindrical speaker wrapped in black acoustic fabric with a machined aluminium top plate. Room-corrects on setup.",
        priceCents: 24_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/tech/obsidian-room-speaker.jpg",
      },
      {
        title: "Obsidian Wireless Earbuds",
        description:
          "Matte black buds in a pebble-shaped aluminium case. Eight hours per charge, thirty-two in the case.",
        priceCents: 17_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/tech/obsidian-wireless-earbuds.jpg",
      },
      {
        title: "Obsidian Smartwatch",
        description:
          "A sandblasted aluminium case on a black woven strap. Always-on display, GPS, seven-day battery, 50m water rating.",
        priceCents: 39_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/tech/obsidian-smartwatch.jpg",
      },
      {
        title: "Obsidian Portable SSD",
        description:
          "A flat aluminium slab holding 2TB of NVMe storage. 1,050MB/s over USB-C, shock rated to two metres.",
        priceCents: 15_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/tech/obsidian-portable-ssd.jpg",
      },
      {
        title: "Obsidian Handset",
        description:
          "A 6.1-inch phone in a matte aluminium frame with a ceramic back. Titanium-grade drop rating, 5G, USB-C.",
        priceCents: 89_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/tech/obsidian-handset.jpg",
      },
      {
        title: "Obsidian Charging Dock",
        description:
          "A low machined aluminium pad delivering 15W wireless charging, weighted so it stays put one-handed.",
        priceCents: 7_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/tech/obsidian-charging-dock.jpg",
      },
    ],
  },
  {
    key: "fashion",
    label: "Fashion",
    photoStyle: {
      name: "Warm editorial",
      aesthetic: "Undyed natural-fibre workwear",
      prompt:
        "Product photograph of undyed natural-fibre workwear in ecru, oatmeal, clay and olive — heavyweight cotton canvas, washed linen, waxed canvas and vegetable-tanned leather, no logos or text. Warm beige paper backdrop, soft directional daylight, gentle warm shadow, muted earth-tone minimalist workwear lookbook photography.",
    },
    products: [
      {
        title: "Undyed Canvas Chore Jacket",
        description:
          "Cut from 12oz undyed cotton canvas with horn buttons and three patch pockets. Softens with every wash.",
        priceCents: 18_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/fashion/undyed-canvas-chore-jacket.jpg",
      },
      {
        title: "Oatmeal Work Trouser",
        description:
          "A straight-leg trouser in undyed heavyweight cotton, with a gusseted seat and reinforced knee seams.",
        priceCents: 12_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/fashion/oatmeal-work-trouser.jpg",
      },
      {
        title: "Clay Linen Overshirt",
        description:
          "Washed European linen in a clay ground, cut boxy to layer over a crewneck. Horn buttons, single chest pocket.",
        priceCents: 14_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/fashion/clay-linen-overshirt.jpg",
      },
      {
        title: "Olive Waxed Canvas Tote",
        description:
          "Olive waxed canvas with vegetable-tanned leather handles and a flat base. Rewaxable; wears in, not out.",
        priceCents: 11_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/fashion/olive-waxed-canvas-tote.jpg",
      },
      {
        title: "Vegetable-Tanned Work Boot",
        description:
          "Undyed vegetable-tanned leather on a cream crepe sole, Goodyear welted so it can be resoled for years.",
        priceCents: 27_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/fashion/vegetable-tanned-work-boot.jpg",
      },
      {
        title: "Undyed Wool Crewneck",
        description:
          "Undyed lambswool spun in Yorkshire and knitted to a heavy gauge, with ribbed collar, cuffs and hem.",
        priceCents: 16_500,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/fashion/undyed-wool-crewneck.jpg",
      },
      {
        title: "Sand Canvas Five-Panel Cap",
        description:
          "Undyed cotton canvas with a soft unstructured crown and a cotton webbing adjuster at the back.",
        priceCents: 5_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/fashion/sand-canvas-five-panel-cap.jpg",
      },
      {
        title: "Waxed Cross-Back Apron",
        description:
          "Clay waxed canvas with vegetable-tanned leather cross-back straps that keep the weight off the neck.",
        priceCents: 9_500,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/fashion/waxed-cross-back-apron.jpg",
      },
      {
        title: "Handwoven Wool Scarf",
        description:
          "Handwoven undyed wool with hand-knotted fringing. Loosely woven so it breathes rather than smothers.",
        priceCents: 7_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/fashion/handwoven-wool-scarf.jpg",
      },
    ],
  },
  {
    key: "drones",
    label: "Drones",
    photoStyle: {
      name: "In flight",
      aesthetic: "Matte grey professional airframes",
      prompt:
        "Photograph of a matte grey professional drone in flight, banking at a dynamic angle, motion-blurred propellers, unbranded, no text. Clear pale blue sky with soft high cloud, bright natural daylight, sharp subject, aerial equipment catalogue photography.",
    },
    products: [
      {
        title: "Corvid Camera Quadcopter",
        description:
          "A 4K/60 gimbal camera on a folding grey airframe. 34-minute flight time and obstacle sensing on six sides.",
        priceCents: 149_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/drones/corvid-camera-quadcopter.jpg",
      },
      {
        title: "Corvid Mapping Drone",
        description:
          "RTK-corrected survey platform with a mechanical shutter, flown from a tablet for repeatable photogrammetry grids.",
        priceCents: 229_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/drones/corvid-mapping-drone.jpg",
      },
      {
        title: "Corvid FPV Racer",
        description:
          "A 5-inch carbon freestyle build with a digital video link and 6S power. Sold bind-and-fly, goggles separate.",
        priceCents: 44_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/drones/corvid-fpv-racer.jpg",
      },
      {
        title: "Corvid Fold Compact",
        description:
          "Folds to the size of a water bottle and still carries a 1-inch sensor. Sub-900g, 6km transmission link.",
        priceCents: 89_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/drones/corvid-fold-compact.jpg",
      },
      {
        title: "Corvid Hexalift Cargo",
        description:
          "A six-rotor lift platform rated to 5kg with redundant motors and a hot-swap battery bay for continuous sorties.",
        priceCents: 499_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/drones/corvid-hexalift-cargo.jpg",
      },
      {
        title: "Corvid Thermal Inspector",
        description:
          "Paired radiometric thermal and 4K visual sensors on one turret, for roof, solar and substation inspection.",
        priceCents: 345_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/drones/corvid-thermal-inspector.jpg",
      },
      {
        title: "Corvid VTOL Long-Range",
        description:
          "A fixed-wing airframe with tilt rotors: hovers to take off, then cruises for 90 minutes on a single pack.",
        priceCents: 690_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/drones/corvid-vtol-long-range.jpg",
      },
      {
        title: "Corvid Cinema Platform",
        description:
          "Carries a full-frame cinema body on a three-axis gimbal, with dual operator control for camera and pilot.",
        priceCents: 540_000,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/drones/corvid-cinema-platform.jpg",
      },
      {
        title: "Corvid Mini",
        description:
          "Sub-250g so it needs no registration in most countries. Prop guards fitted, 2.7K video, folds to palm size.",
        priceCents: 34_900,
        imageUrl:
          "https://vnyfndqpdllwhvhinjoi.supabase.co/storage/v1/object/public/seed-assets/c1/drones/corvid-mini.jpg",
      },
    ],
  },
];
