// @ts-check
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightVersions from 'starlight-versions';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'nxs-docs';
const repositoryOwner = process.env.GITHUB_REPOSITORY_OWNER ?? 'aliensense';
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

// One entry per published release, appended by the release-export workflow
// (redbrain release-export.yml). A configured version whose directory is
// missing under src/content/docs/ is snapshotted from the current docs at
// the next build.
const versions = JSON.parse(readFileSync(new URL('./versions.json', import.meta.url), 'utf8'));

export default defineConfig({
	site: `https://${repositoryOwner}.github.io`,
	// DOCS_BASE overrides the base path for the staging half of the Pages
	// artifact (deploy.yml builds the staging branch under /staging/).
	base: process.env.DOCS_BASE ?? (isGitHubActions ? `/${repositoryName}` : '/'),
	integrations: [
		starlight({
			plugins: versions.length > 0 ? [starlightVersions({ versions })] : [],
			title: 'NXS Docs',
			description: 'Documentation for the Aliensense NXS sensor co-processor.',
			tagline: 'Any sensor, SI units on the wire',
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: `https://github.com/${repositoryOwner}/${repositoryName}`,
				},
			],
			sidebar: [
				{ label: 'Getting Started', autogenerate: { directory: 'getting-started' } },
				{ label: 'NXS', autogenerate: { directory: 'hardware' } },
				{ label: 'NXS Hub', autogenerate: { directory: 'hub' } },
				{ label: 'Reference', autogenerate: { directory: 'reference' } },
			],
			customCss: ['/src/styles/custom.css'],
			head: [
				{ tag: 'meta', attrs: { name: 'theme-color', content: '#0b1220' } },
				{ tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
				{ tag: 'meta', attrs: { property: 'og:site_name', content: 'NXS Docs' } },
				{ tag: 'meta', attrs: { property: 'og:title', content: 'NXS Docs' } },
				{
					tag: 'meta',
					attrs: {
						property: 'og:description',
						content: 'Plug in a sensor, upload a driver, read SI units — the NXS documentation set.',
					},
				},
				{ tag: 'meta', attrs: { property: 'og:image', content: '/favicon.svg' } },
				{ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary' } },
			],
			components: {
				Head: './src/components/Head.astro',
				Header: './src/components/Header.astro',
				ThemeProvider: './src/components/ThemeProvider.astro',
			},
			lastUpdated: true,
		}),
	],
});
