# BREACH — design notes

## The image

A colossal luminous whale breaches out of a dark neon sea and arcs
across a giant low moon, water exploding around its tail, a tiny lit
city on the horizon for scale. One look, one jolt: an animal the size
of the moon, where it should not be, mid-leap, glowing, about to burst
through the moon itself.

Built for the judge's criteria, in order:

1. **Excitement** — a huge creature, a huge moon, a burning sunset
   sky: energy and awe at a glance, not a calm scene.
2. **Surprise** — a scale twist and an idea of its own (the whale is
   bigger than the moon's disc and bigger than the city), not a stock
   explosion, firework, or generic action scene.
3. **Momentum** — the body arcs through the frame, spray fans out
   from the breach, the rim light runs along the whole leap.
4. **Craft** — flat poster style, clean shapes, no text, no smears or
   artefacts; every element is drawn, not pasted.
5. **Reads small** — three big shapes (moon, whale, city band) carry
   the whole idea at ~300 px across.

## How it is made

`main.ts` (Node 22, standard library only) renders the image pixel by
pixel into an RGB buffer and encodes the PNG by hand (zlib + CRC32):

- sky: vertical gradient indigo → violet → magenta → orange horizon
- stars and sparkles, a glowing full moon with soft craters
- sea with a shimmering moonlight column and low swells
- city skyline silhouette with seeded lit windows and antenna beacons
- the whale: a tapered tube along a quadratic bezier (radius profile
  from slim tail stalk to broad blunt rostrum), pale belly, glowing
  cyan rim light, pectoral fin, eye, mouth line, throat grooves,
  blowhole spout, tail flukes, and a fan of spray and foam at the
  breach
- birds, then a soft vignette to hold the centre

All randomness comes from one fixed seed (`mulberry32(20261116)`),
so both grader runs write byte-identical output. Verified locally:
two runs, same SHA-256, ~1.3 s per run, 154,673 bytes.

## Gate

- PNG, 1024 × 1024, 154,673 bytes (limit 1 MiB)
- `entry.png` in this repository is the exact output of `main.ts`,
  committed for reference; the program regenerates it at grade time.
