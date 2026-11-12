bartulem.github.io
========

Source of [bartulem.github.io](https://bartulem.github.io), the personal site of Bartul Mimica. It is a single page, built by Jekyll and hosted on GitHub Pages.

## What is on the page

* **Landing screen:** a slowly drifting globe that marks Split, Trondheim and Princeton, an animated brain emblem, the name with three rotating field words, profile icons, and a looping video of two vocalizing mice.
* **About:** a short biography beside a line portrait.
* **Publications:** selected papers with links and citation badges.

## Where things live

| To change | Edit |
| --- | --- |
| Text, links, publications, city notes | `index.html` |
| The pool of rotating field words | the `#keywords` list in `index.html` |
| Colours, spacing, type, the brain and hair animations | `css/site.css` |
| The globe, the travelling light, the word rotation | `js/landing.js` |
| City positions and colours | `CITIES` in `js/landing.js` (colours also in `css/site.css`) |
| Coastline data for the globe | `js/land.js` |
| Brain emblem, portrait, profile icons | `_includes/brain.svg`, `_includes/portrait.svg`, `_includes/icon-*.svg` |
| Video of the mice | `files/mice_usv_dark.mp4` |
| Papers, citation files | `files/` |

`publications/index.html` only redirects old links to the publications section of the main page.

## Previewing locally

```
jekyll serve
```

Then open http://127.0.0.1:4000/.

## The retired blog

The site used to include a blog ("chronicles"). Its posts (`_posts/`), pages (`chronicles/`), layouts (`_layouts/`), older includes, Bootstrap files and images are still in the repository, but they are excluded from the build in `_config.yml` and are not part of the published site. The comment in `_config.yml` says how to bring the blog back.

## Credits

* Coastlines: [Natural Earth](https://www.naturalearthdata.com/) 1:110m land data (public domain), via the `world-atlas` package.
* Profile icons: [Simple Icons](https://simpleicons.org/) and [Material Design Icons](https://pictogrammers.com/library/mdi/), via [Iconify](https://iconify.design/).
* Brain emblem: traced from an illustration.
* Citation badges: [Dimensions](https://badge.dimensions.ai/) and [Altmetric](https://www.altmetric.com/).

## If you fork or re-use this project

Edit `_includes/analytics.html` and either replace the Google Analytics tracking code with your own or remove it. Otherwise I will receive analytics data from your website.

The code is under the MIT License (see `LICENSE`). The portrait, the video and the texts are personal content; please replace them with your own.
