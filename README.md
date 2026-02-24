# RedBrain Docs

Documentation website source for the RedBrain robotics compute platform.

## Stack

- **Current framework:** Astro Starlight
- **Target deployment:** GitHub Pages via GitHub Actions
- **Migration posture:** Content is kept framework-neutral enough to move to Mintlify with minimal rewrite.

## Run locally

```bash
npm install
npm run dev
```

Build production output:

```bash
npm run build
npm run preview
```

## Repository layout

```text
.
├── .github/workflows/         # CI/CD (build, PR status, deploy)
├── src/
│   ├── assets/diagrams/       # Board and connection diagrams
│   ├── components/            # Small Starlight overrides (theme behavior)
│   ├── content/docs/          # All documentation pages
│   │   ├── getting-started/
│   │   ├── hardware/
│   │   ├── guides/
│   │   ├── reference/
│   │   ├── faq.md
│   │   └── index.mdx
│   └── styles/global.css      # Tailwind + shared visual tokens
├── astro.config.mjs
└── package.json
```

## Content conventions

- One topic per file.
- Use relative links, for example: `../reference/connectors/`.
- Keep connector pinouts and consolidated tables in `reference/`; hardware pages should link instead of duplicating.
- Prefer practical instructions over internal design details.
- Use `<details>` for large tables and long pin maps.
- Image paths should point to `src/assets/diagrams/` using relative Markdown paths.

## Edit workflow

1. Add or update pages in `src/content/docs`.
2. Keep sidebar entries in `astro.config.mjs` in sync with page slugs.
3. Run `npm run build` before pushing.

## Deployment

- Pushes to `main` run build + deploy to GitHub Pages.
- Pull requests run preview build checks and get a status comment on the PR.

## Mintlify vs Starlight migration

| Area | Starlight today | Mintlify migration impact |
| --- | --- | --- |
| Content files | Markdown/MDX in `src/content/docs` | Reuse most Markdown with frontmatter and component syntax adjustments |
| Navigation | `astro.config.mjs` sidebar object | Move structure to `docs.json` |
| Components | Starlight components (`Card`, `Tabs`, `Aside`) | Replace with Mintlify MDX components or plain Markdown patterns |
| Search | Built-in Pagefind | Mintlify hosted search (no local index job) |
| Build/Deploy | Astro build + GitHub Pages workflow | Mintlify deploy flow or static export pipeline |

