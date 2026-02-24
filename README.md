# RedBrain Docs

Public documentation for the RedBrain robotics computing platform.
Built with [Astro Starlight](https://starlight.astro.build/).

## Local development

```bash
# Install dependencies
npm install

# Start dev server (http://localhost:4321)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Adding content

Pages live in `src/content/docs/`. Create `.md` or `.mdx` files with frontmatter:

```md
---
title: Your Page Title
description: Brief description for SEO and link previews.
---
```

Sidebar navigation is configured in `astro.config.mjs`.

Images go in `src/assets/diagrams/` and are referenced as:

```md
![Alt text](../../assets/diagrams/filename.png)
```

## Deployment

Pushes to `main` trigger a GitHub Actions workflow that builds the site and deploys to GitHub Pages.

## Project structure

```text
src/content/docs/     -> Documentation pages (Markdown / MDX)
src/assets/           -> Images and diagrams
src/styles/custom.css -> Theme customizations
astro.config.mjs      -> Starlight + site configuration
public/               -> Static assets (favicon, robots.txt)
```
