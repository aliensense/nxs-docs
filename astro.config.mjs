// @ts-check
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightVersions from 'starlight-versions';
import d2 from 'astro-d2';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'nxs-docs';
const repositoryOwner = process.env.GITHUB_REPOSITORY_OWNER ?? 'aliensense';
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

// One entry per published release, appended by the release-export workflow
// (redbrain release-export.yml). A configured version whose directory is
// missing under src/content/docs/ is snapshotted from the current docs at
// the next build.
const versions = JSON.parse(readFileSync(new URL('./versions.json', import.meta.url), 'utf8'));

// DOCS_BASE overrides the base path for the staging half of the Pages
// artifact (deploy.yml builds the staging branch under /staging/).
const base = process.env.DOCS_BASE ?? (isGitHubActions ? `/${repositoryName}` : '');

export default defineConfig({
	site: `https://${repositoryOwner}.github.io`,
	base: base || '/',
	// Two reference documents were renamed when the sensor add-on noun
	// became "patch"; the old addresses keep resolving.
	redirects: {
		'/reference/nxs-driver-development/': '/reference/nxs-patch-authoring/',
		'/reference/nxs-cam-descriptors/': '/reference/nxs-camera-patches/',
	},
	integrations: [
		// The released documents carry their diagrams as D2 fences (the mirror
		// expands each source in place); the build renders them with the D2
		// binary (`brew install d2` locally; deploy.yml installs it).
		d2({ layout: 'elk', pad: 16, theme: { dark: false } }),
		starlight({
			plugins: versions.length > 0 ? [starlightVersions({ versions })] : [],
			title: 'NXS',
			description: 'Documentation for the Aliensense NXS sensor co-processor.',
			tagline: 'Any sensor, SI units on the wire',
			favicon: '/favicon-32x32.png',
			// Code blocks: one light theme, flat frames, the mono face.
			expressiveCode: {
				themes: ['github-light'],
				useStarlightDarkModeSwitch: false,
				styleOverrides: {
					borderRadius: '0',
					borderColor: '#e3e3de',
					codeBackground: '#ffffff',
					codeFontFamily: "'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
					codeFontSize: '0.8125rem',
					codeLineHeight: '1.6',
					uiFontFamily: "'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
					frames: {
						shadowColor: 'transparent',
						editorTabBarBackground: '#f7f7f4',
						editorActiveTabBackground: '#ffffff',
						editorActiveTabIndicatorTopColor: '#17171a',
						editorActiveTabIndicatorBottomColor: 'transparent',
						terminalTitlebarBackground: '#f7f7f4',
						terminalTitlebarDotsForeground: '#d6d7da',
						terminalBackground: '#ffffff',
					},
				},
			},
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: `https://github.com/${repositoryOwner}/${repositoryName}`,
				},
			],
			sidebar: [
				{ label: 'Getting Started', autogenerate: { directory: 'getting-started' } },
				{ label: 'Guides', autogenerate: { directory: 'guides' } },
				{ label: 'NXS', autogenerate: { directory: 'hardware' } },
				{ label: 'NXS Hub', autogenerate: { directory: 'hub' } },
				{ label: 'Reference', autogenerate: { directory: 'reference' } },
			],
			customCss: ['/src/styles/custom.css'],
			head: [
				{ tag: 'meta', attrs: { name: 'theme-color', content: '#f1f1ee' } },
				{ tag: 'link', attrs: { rel: 'apple-touch-icon', href: `${base}/apple-touch-icon.png` } },
				{ tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
				{ tag: 'meta', attrs: { property: 'og:site_name', content: 'NXS' } },
				{ tag: 'meta', attrs: { property: 'og:title', content: 'NXS' } },
				{
					tag: 'meta',
					attrs: {
						property: 'og:description',
						content: 'Plug in a sensor, upload a patch, read SI units: the NXS documentation set.',
					},
				},
				{ tag: 'meta', attrs: { property: 'og:image', content: `${base}/apple-touch-icon.png` } },
				{ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary' } },
			],
			components: {
				Head: './src/components/Head.astro',
				Header: './src/components/Header.astro',
				Hero: './src/components/Hero.astro',
				Footer: './src/components/Footer.astro',
				// The eyebrow title; with versions published it also carries the
				// plugin's version notice, which the plugin hangs on the default title.
				PageTitle:
					versions.length > 0
						? './src/components/PageTitleVersioned.astro'
						: './src/components/PageTitle.astro',
				ThemeProvider: './src/components/ThemeProvider.astro',
			},
			lastUpdated: true,
		}),
	],
});
