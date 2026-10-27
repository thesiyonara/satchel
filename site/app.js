// Fills the download buttons with the latest release's direct links. Without a response the buttons keep
// pointing at the releases page, which always works.
(async () => {
  try {
    const response = await fetch('https://api.github.com/repos/thesiyonara/satchel/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) return;
    const release = await response.json();
    const version = String(release.tag_name || '').replace(/^v/, '');
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const megabytes = bytes => `${Math.round(bytes / 1048576)} MB`;
    for (const link of document.querySelectorAll('a[data-asset]')) {
      const suffix = link.dataset.asset;
      const asset = assets.find(entry => suffix === 'SHA256SUMS' ? /^SHA256SUMS-.*\.txt$/.test(entry.name) : entry.name.startsWith('Satchel-') && entry.name.endsWith(suffix));
      if (!asset || !/^https:\/\/github\.com\//.test(asset.browser_download_url)) continue;
      link.href = asset.browser_download_url;
      if (suffix !== 'SHA256SUMS' && asset.size) link.title = `${asset.name}, ${megabytes(asset.size)}`;
    }
    const line = document.getElementById('release-line');
    if (line && version) line.textContent = `Version ${version}. Free and open source. Windows 10 and later, macOS 13 and later on Apple silicon.`;
  } catch { /* The releases page link stays. */ }
})();
