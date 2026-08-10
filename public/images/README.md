# Hero image

`header.avif` — the hero photograph, referenced by
`src/components/sections/Hero.astro`.

It must keep the deep-teal backdrop baked in: the hero section paints
`--color-teal-700` (#0b4a46) behind it, and at 1920px and above the header goes
transparent so the photograph runs unbroken behind the logo and nav. Both rely
on the image's own background matching the section colour.

Guidance for replacements: around 2400px wide, subject in the right-hand
two-thirds, left third kept clear for the headline.
