const dialog = document.getElementById('licenses-dialog');
const list = document.getElementById('license-list');
const retry = document.getElementById('licenses-retry');
let loaded = false;
let loading = false;
async function loadNotices() {
  if (loaded || loading) return;
  loading = true;
  retry.hidden = true;
  list.textContent = 'Loading local license notices…';
  try {
    const response = await fetch(new URL('licenses/catalog.json', import.meta.url));
    if (!response.ok) throw new Error(`License file returned ${response.status}`);
    const catalog = await response.json();
    list.replaceChildren();
    const count = document.createElement('p');
    count.className = 'license-count';
    count.textContent = `${catalog.length} software and data notices`;
    list.append(count);
    for (const item of catalog) {
      const entry = document.createElement('details');
      entry.className = 'license-entry';
      const summary = document.createElement('summary');
      summary.append(document.createTextNode(item.name));
      const tag = document.createElement('span');
      tag.textContent = item.license;
      summary.append(tag);
      const body = document.createElement('div');
      body.className = 'license-body';
      for (const text of [item.description, `Source: ${item.source}`]) {
        const line = document.createElement('p');
        line.textContent = text;
        body.append(line);
      }
      const terms = document.createElement('pre');
      terms.textContent = item.text;
      body.append(terms);
      entry.append(summary, body);
      list.append(entry);
    }
    loaded = true;
  } catch (error) {
    console.error('Could not read bundled licenses', error);
    list.textContent = 'Could not load the local notices. Reconnect once to finish saving the app, then try again.';
    list.classList.add('license-error');
    retry.hidden = false;
  } finally { loading = false; }
}
document.getElementById('licenses-button').addEventListener('click', () => {
  dialog.showModal();
  list.classList.remove('license-error');
  void loadNotices();
});
document.getElementById('licenses-close').addEventListener('click', () => dialog.close());
retry.addEventListener('click', () => { list.classList.remove('license-error'); void loadNotices(); });
