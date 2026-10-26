// The one place that knows where this project lives. Forks change package.json, nothing else.
import pkg from '../package.json';

const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(pkg.repository.url);
if (!match) throw new Error('package.json repository.url must point at a GitHub repository');
/** "owner/name" on GitHub. */
export const repository = match[1];
export const repositoryURL = `https://github.com/${repository}`;
export const releasesURL = `${repositoryURL}/releases`;
export const releasesAPI = `https://api.github.com/repos/${repository}/releases`;
export const productName = pkg.productName;
export const version = pkg.version;
