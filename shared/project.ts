// The one place that knows where this project lives. Forks change package.json, nothing else.
import pkg from '../package.json';

const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(pkg.repository.url);
if (!match) throw new Error('package.json repository.url must point at a GitHub repository');
/** "owner/name" on GitHub. */
export const repository = match[1];
export const repositoryURL = `https://github.com/${repository}`;
export const releasesURL = `${repositoryURL}/releases`;
/** The project site, published by GitHub Pages from the repository. */
export const siteURL = `https://${repository.split('/')[0]}.github.io/${repository.split('/')[1]}/`;
export const releasesAPI = `https://api.github.com/repos/${repository}/releases`;
export const productName = pkg.productName;
export const version = pkg.version;
