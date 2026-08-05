// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'nxs-docs';
const repositoryOwner = process.env.GITHUB_REPOSITORY_OWNER ?? 'aliensense';
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

export default defineConfig({
	site: `https://${repositoryOwner}.github.io`,
	base: isGitHubActions ? `/${repositoryName}` : '/',
	integrations: [
		starlight({
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
				{ label: 'Hardware', autogenerate: { directory: 'hardware' } },
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
				Header: './src/components/Header.astro',
				ThemeProvider: './src/components/ThemeProvider.astro',
			},
			lastUpdated: true,
		}),
	],
});
