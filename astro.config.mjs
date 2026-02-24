// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'redbrain-docs';
const repositoryOwner = process.env.GITHUB_REPOSITORY_OWNER ?? 'redbrain';
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

export default defineConfig({
	site: `https://${repositoryOwner}.github.io`,
	base: isGitHubActions ? `/${repositoryName}` : '/',
	integrations: [
		starlight({
			title: 'RedBrain Docs',
			description: 'Public documentation for the RedBrain robotics computing platform.',
			tagline: 'Modular compute and perception for field robotics',
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
				{ label: 'Guides', autogenerate: { directory: 'guides' } },
				{ label: 'API Reference', autogenerate: { directory: 'reference' } },
				{ label: 'FAQ', slug: 'faq' },
			],
			customCss: ['/src/styles/custom.css'],
			head: [
				{ tag: 'meta', attrs: { name: 'theme-color', content: '#0b1220' } },
				{ tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
				{ tag: 'meta', attrs: { property: 'og:site_name', content: 'RedBrain Docs' } },
				{ tag: 'meta', attrs: { property: 'og:title', content: 'RedBrain Docs' } },
				{
					tag: 'meta',
					attrs: {
						property: 'og:description',
						content: 'Get cameras streaming, sensors publishing, and robots moving with RedBrain.',
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
