# NXS Docs

Documentation site for the Aliensense NXS sensor co-processor.
Built with [Astro Starlight](https://starlight.astro.build/).

## Layout

- `src/content/docs/` — the site content: the landing page,
  getting-started, and the FAQ are authored in this repository.
- `src/content/docs/reference/` — **machine-managed**: the released
  specification set, mirrored from the firmware repository on every
  release. Do not edit these files here; fixes go to the firmware
  repository's `docs/specs/` and arrive with the next release.
- The product pages (`hardware/product-description`, `hardware/datasheet`,
  `hub/*`) and their images under `src/assets/` — **machine-managed**:
  rewritten from the marketing repository's sources by its
  `marketing-mirror` workflow on every merge. Do not edit these files
  here; fixes go to `als-docs` `marketing/` and arrive on push.
- `src/content/docs/guides/` — **machine-managed**: the released
  guide set, mirrored from the firmware repository on every release.
  Do not edit these files here; fixes go to the firmware repository's
  `docs/guides/` and arrive with the next release.
- The product pages (`hardware/product-description`, `hardware/datasheet`,
  `hub/*`) and their images under `src/assets/` — **machine-managed**:
  rewritten from the marketing repository's sources by its
  `marketing-mirror` workflow on every merge. Do not edit these files
  here; fixes go to `als-docs` `marketing/` and arrive on push.
- `versions.json` + `src/content/docs/<tag>/` + `src/content/versions/`
  — **machine-managed**: one frozen site version per published release,
  appended by the firmware repository's release-export workflow. The
  version picker comes from the `starlight-versions` plugin.

## Authoring rules

- Images live under `src/assets/`, never inside `src/content/docs/` —
  the version snapshotter parses every file in the content tree as
  Markdown/MDX and dies on binary data.
- No HTML comments (`<!-- -->`) and no `<https://…>` angle-bracket
  autolinks in content — the snapshotter's parser is MDX-flavored and
  rejects both. Use `[text](url)` links; use `≤` / `≥` in prose, not
  `<=` / `>=`.

## Windows setup and usage (beginner-friendly)

This section is written for technical writers who are new to command line tools.
Follow the steps in order.

## What you are going to do

1. Install required tools (one time).
2. Open the project folder in a terminal.
3. Run the docs site locally.
4. Build the production version.
5. Preview and verify before sharing changes.

## 1) Install required tools (one time)

### Install Node.js (required)

1. Go to [https://nodejs.org/](https://nodejs.org/).
2. Download the **LTS** version for Windows.
3. Run the installer and keep default options.
4. Restart your computer after install (recommended).

### Install Git (optional but recommended)

If you update from GitHub regularly, install Git for Windows:

1. Go to [https://git-scm.com/download/win](https://git-scm.com/download/win).
2. Install with default options.

If someone already gave you the project folder as a ZIP, Git is optional.

### Install VS Code (optional but helpful)

1. Go to [https://code.visualstudio.com/](https://code.visualstudio.com/).
2. Install with default options.

You can edit files in any editor, but VS Code is easiest for Markdown docs.

## 2) Open the project folder on Windows

If you already have the `nxs-docs` folder, continue.

If not, either:

- Clone it from GitHub, or
- Download ZIP and extract it.

Then open a terminal in that folder:

1. Open File Explorer.
2. Open the `nxs-docs` folder.
3. Click the address bar at the top.
4. Type `cmd` and press Enter.

A Command Prompt opens already in the correct folder.

## 3) Verify Node is installed

In Command Prompt, run:

```bat
node -v
npm -v
```

You should see version numbers for both commands.

If you get "not recognized", see Troubleshooting.

## 4) Install project dependencies

Run this once (or after pulling changes):

```bat
npm install
```

The reference and guide pages carry their diagrams as D2 fences, which the build renders with the D2 binary. Install it once: `brew install d2` on macOS, or the installer at https://d2lang.com/tour/install for Windows and Linux.

This may take a few minutes the first time.

## 5) Run the docs locally (editing mode)

Start the development server:

```bat
npm run dev
```

Then open:

- [http://localhost:4321](http://localhost:4321)

What to expect:

- The docs site opens in your browser.
- Changes you save in Markdown files update automatically.

To stop the server:

- Press `Ctrl + C` in Command Prompt.

## 6) Build the production version

This checks that the site can build successfully for deployment:

```bat
npm run build
```

Success looks like:

- Command finishes without errors.
- Final lines include `build` complete.
- A `dist` folder is created/updated.

## 7) Test the production build locally

After a successful build, run:

```bat
npm run preview
```

Then open the URL printed in terminal (commonly `http://localhost:4321` or `http://localhost:4322`).

This preview is closer to what users will see in production.

Stop preview with `Ctrl + C`.

## 8) Suggested testing checklist before you commit

1. Run `npm run build` with no errors.
2. Open the homepage and at least one page in each section.
3. Verify links you edited open correctly.
4. Verify any images you added render correctly.
5. Test search for a unique term from your new content.
6. Run `npm run preview` and spot-check formatting one more time.

## 9) Where to edit content

- Docs pages: `src/content/docs/`
- Diagrams/images: `src/assets/diagrams/`
- Sidebar navigation: `astro.config.mjs`
- Theme/style: `src/styles/global.css`

Markdown/MDX pages use frontmatter like:

```md
---
title: Your Page Title
description: Brief summary shown in metadata.
---
```

Image example:

```md
![Alt text](../../assets/diagrams/filename.png)
```

## 10) Troubleshooting on Windows

### `node` or `npm` is not recognized

1. Close all Command Prompt windows.
2. Reopen Command Prompt and try again.
3. If still failing, reinstall Node.js LTS and restart Windows.

### Port `4321` is already in use

Run dev on another port:

```bat
npm run dev -- --port 4325
```

Then open [http://localhost:4325](http://localhost:4325).

### Theme or content changes do not appear

Stop the server (`Ctrl + C`), then run:

```bat
rmdir /s /q .astro
rmdir /s /q dist
npm run dev -- --force
```

### `npm install` fails with network or permission errors

1. Confirm internet/VPN connection.
2. Close terminal and open a new Command Prompt.
3. Try again.
4. If your company uses a proxy, ask IT for npm proxy settings.

## Deployment

The site is a pure function of two branches:

- `main` builds to the site root.
- `staging` (when it exists) builds under `/staging/` on the same site.

The firmware repository's release-export workflow pushes **rc releases
to `staging`** and **full releases to `main`** (deleting `staging`), so
publishing an rc stages the future site at
`https://aliensense.github.io/nxs-docs/staging/` and publishing the full
release makes it live. Pull requests build only (downloadable
`pr-preview-dist` artifact) and never deploy.

## Project structure

```text
src/content/docs/     -> Documentation pages (Markdown / MDX)
src/assets/           -> Images and diagrams
src/styles/global.css -> Theme customizations
astro.config.mjs      -> Starlight + site configuration
public/               -> Static assets (favicon, robots.txt)
```
