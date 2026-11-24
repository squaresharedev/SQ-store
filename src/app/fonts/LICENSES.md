# Font licenses

Every typeface in this folder is self-hosted: served from this app's own
origin, never from a font CDN, and never requested at runtime from anywhere
else. This file records where each FONT PAIRING face (`pairings/`, declared in
`pairing-faces.ts`, chosen in `lib/theme/font-pairings.ts`) came from and under
which license.

## How the files were obtained

- Source: the Fontsource packages on the npm registry, used as a DOWNLOAD
  source only (`npm pack <package>@<version>`, then the files copied out of
  the tarball). None of them is a dependency of this app.
- Fontsource republishes the Google Fonts subsets of each family, which Google
  builds from the upstream release in `github.com/google/fonts` (the `ofl/`
  directory of each family, which carries its `OFL.txt` and lists
  `license: "OFL"` in `METADATA.pb`). The upstream designer repository of each
  family is named below.
- Every file here is BYTE-IDENTICAL to the one in the named tarball (SHA-256
  below). Nothing was subset, renamed, re-encoded or otherwise modified here.
  That matters for three families whose license names a Reserved Font Name
  (Playfair Display, Source Sans 3, DM Serif Display): the OFL forbids a
  Modified Version from using that name, and these files are redistributed
  exactly as published, not modified.
- Format and coverage: WOFF2 only. Two files per face: the `latin` subset and
  the `latin-ext` subset (Czech, Polish, Slovak and the rest of Latin
  Extended), which the browser fetches only for words that need it (its
  `@font-face` carries the upstream `unicode-range`). The ten locales this app
  ships are all covered by the two.
- Existing files: `Inter.woff2` and `SpaceGrotesk.woff2` predate this work;
  they are byte-identical to `inter-latin-wght-normal.woff2` from
  `@fontsource-variable/inter@5.3.0` and `space-grotesk-latin-wght-normal.woff2`
  from `@fontsource-variable/space-grotesk@5.3.0`. Only their `latin-ext`
  halves were added.

## The families

All are licensed under the **SIL Open Font License, Version 1.1** (OFL-1.1),
reproduced in full at the end of this file.

| Family | Pairing role | Files in `pairings/` | npm package (download source) | Upstream | Copyright notice |
| --- | --- | --- | --- | --- | --- |
| Fraunces | Editorial, headlines | `fraunces-latin-opsz-normal.woff2`, `fraunces-latin-opsz-italic.woff2`, `fraunces-latin-ext-opsz-normal.woff2`, `fraunces-latin-ext-opsz-italic.woff2` | `@fontsource-variable/fraunces@5.3.0` | github.com/undercasetype/Fraunces | Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces) |
| Inter (Latin Extended half) | Editorial and Modern, body | `inter-latin-ext-wght-normal.woff2` | `@fontsource-variable/inter@5.3.0` | github.com/rsms/inter | Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) |
| Playfair Display | Classic, headlines | `playfair-display-latin-wght-normal.woff2`, `playfair-display-latin-wght-italic.woff2`, `playfair-display-latin-ext-wght-normal.woff2`, `playfair-display-latin-ext-wght-italic.woff2` | `@fontsource-variable/playfair-display@5.3.0` | github.com/clauseggers/Playfair-Display | Copyright 2017 The Playfair Display Project Authors (https://github.com/clauseggers/Playfair-Display), with Reserved Font Name "Playfair Display". |
| Source Sans 3 | Classic, body | `source-sans-3-latin-wght-normal.woff2`, `source-sans-3-latin-ext-wght-normal.woff2` | `@fontsource-variable/source-sans-3@5.3.1` | github.com/adobe-fonts/source-sans | Copyright 2010-2020 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'. All Rights Reserved. Source is a trademark of Adobe in the United States and/or other countries. |
| Space Grotesk (Latin Extended half) | Modern, headlines | `space-grotesk-latin-ext-wght-normal.woff2` | `@fontsource-variable/space-grotesk@5.3.0` | github.com/floriankarsten/space-grotesk | Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk) |
| DM Serif Display | Soft, headlines | `dm-serif-display-latin-400-normal.woff2`, `dm-serif-display-latin-400-italic.woff2`, `dm-serif-display-latin-ext-400-normal.woff2`, `dm-serif-display-latin-ext-400-italic.woff2` | `@fontsource/dm-serif-display@5.3.0` | github.com/googlefonts/dm-fonts | Copyright 2014 - 2017 Adobe Systems Incorporated (http://www.adobe.com/), with Reserved Font Name 'Source'. Copyright 2019 Google LLC. |
| DM Sans | Soft, body | `dm-sans-latin-wght-normal.woff2`, `dm-sans-latin-ext-wght-normal.woff2` | `@fontsource-variable/dm-sans@5.3.0` | github.com/googlefonts/dm-fonts | Copyright 2014 The DM Sans Project Authors (https://github.com/googlefonts/dm-fonts) |
| Instrument Serif | Studio, headlines | `instrument-serif-latin-400-normal.woff2`, `instrument-serif-latin-400-italic.woff2`, `instrument-serif-latin-ext-400-normal.woff2`, `instrument-serif-latin-ext-400-italic.woff2` | `@fontsource/instrument-serif@5.3.0` | github.com/Instrument/instrument-serif | Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif) |
| Manrope | Studio, body | `manrope-latin-wght-normal.woff2`, `manrope-latin-ext-wght-normal.woff2` | `@fontsource-variable/manrope@5.3.0` | github.com/sharanda/manrope (Google Fonts: github.com/googlefonts/manrope) | Copyright 2019 The Manrope Project Authors (https://github.com/sharanda/manrope) |

Tarballs: `https://registry.npmjs.org/<package>/-/<name>-<version>.tgz`, for
example `https://registry.npmjs.org/@fontsource-variable/fraunces/-/fraunces-5.3.0.tgz`.

## SHA-256 of every file in `pairings/`

```
a5d38fe99f930275684999b462c7123faa063d9e44e73b4b241723d884aa0f49  dm-sans-latin-ext-wght-normal.woff2
9fea608a947e67020c33cad9a6fe3d60c54119dfb8cff87768a8117a15ed7543  dm-sans-latin-wght-normal.woff2
ed8b291611e32fa2d2900488dd48fc95faf0957b2ef7ddf1527e8d21dd9cf2df  dm-serif-display-latin-400-italic.woff2
fdf61e20fd2c0108e0ea28da4daca0035205b4b7fc031a3974b865b704de160a  dm-serif-display-latin-400-normal.woff2
e026521e59b7b3e5d3257cc76069916111683b97c24e75f0c7a9f07621aa9460  dm-serif-display-latin-ext-400-italic.woff2
3af47815d6183efcee27a5717970acfe31153365e9b842e62d30c04e86c0613a  dm-serif-display-latin-ext-400-normal.woff2
4983926d3a16544eedcd2233448bd8a43f711e7bf1fabaae8431e78e0b798635  fraunces-latin-ext-opsz-italic.woff2
a2930b27d13a228bd9ab6a49269b5f800237892ad560cb9dd7fab01b1620f88e  fraunces-latin-ext-opsz-normal.woff2
066710ce7ed235a339d3d6cdcc8b55c0bea5632232662d83aacea25852108271  fraunces-latin-opsz-italic.woff2
7234ed860a9cc83045413c4faee63c960a8f2d1917adcf728119307d56e0d783  fraunces-latin-opsz-normal.woff2
5a51946dfffa82972bc98745359c46761515641fda557c25116459a9f83da4a7  instrument-serif-latin-400-italic.woff2
5eb09b5ac0e28b67c2f041c8ba6d244604ca0c0980d65912ab2d47fed84ddc31  instrument-serif-latin-400-normal.woff2
d0014821252a8a770bf7551641572f239a8ede83d75652d84fef0c3627751baf  instrument-serif-latin-ext-400-italic.woff2
290e6267dd833bf5f899eba4c29ad0a9b09dbe53f6075b18af38057159e1ff20  instrument-serif-latin-ext-400-normal.woff2
34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956  inter-latin-ext-wght-normal.woff2
3911b66d9f2e005a4b989223405d0e5032619c668597ba467cc76a23c8fffcfb  manrope-latin-ext-wght-normal.woff2
a30ddcd349703aff7464c34bef3fffdff405ee50c113440d7c8693c02d210972  manrope-latin-wght-normal.woff2
b9dff4aec6d8ef27af595330c808c455fcc3ff46881642aa6028ed4e27a96f89  playfair-display-latin-ext-wght-italic.woff2
42898ad49a6b23f32b109243e1df596edf831015ed685f429e4dafbb181d599d  playfair-display-latin-ext-wght-normal.woff2
54af24bd0f911f0fd7399d5445ea2023ff501d6a69f2d728f1213072f977ab14  playfair-display-latin-wght-italic.woff2
e0c764a8e9e1cce92163c55bac4b2ad6cd4cf8c696ce2289ab5c41565e65b7e2  playfair-display-latin-wght-normal.woff2
a85a7459bdb3cdc1136751e151a506bae653fc29ada3ca86237477df6f1b59e6  source-sans-3-latin-ext-wght-normal.woff2
19143dca075972bc84e3fd9eab7416dd40cc565dccb2435a044bdfabe060c7d5  source-sans-3-latin-wght-normal.woff2
952dddb45d2f96f71cbf3b7f510b24379afc3c89ea02fcf89d377b45d62c0166  space-grotesk-latin-ext-wght-normal.woff2
```

## SIL Open Font License, Version 1.1

The copyright notices above apply to their families; the license text is the
same for all of them.

```
-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
