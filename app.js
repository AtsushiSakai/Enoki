import './license-viewer.js';
const $ = (id) => document.getElementById(id);
const editor = $('editor');
const searchInput = $('emoji-search');
const fields = [editor, searchInput];
const composition = $('composition');
const candidates = $('candidates');
const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
let ready = false;
let japanese = true;
let current = null;
let controllers = [];
let worker;
let toastTimer;
let emojiData;
let category = 'all';
let editorSelection = [0, 0];
const url = (path) => new URL(path, import.meta.url).href;
const graphemes = (text) => [...segmenter.segment(text)];

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').classList.remove('visible'); $('toast').hidden = true; }, 3500);
}
function updateCount() {
  $('char-count').textContent = graphemes(editor.value).length.toLocaleString('en-US');
  const empty = !editor.value;
  $('copy-button').disabled = empty;
  $('search-button').disabled = empty;
  $('clear-button').disabled = empty;
  $('undo-button').disabled = !controllers[0]?.canUndo();
}
function renderComposition(controller, segments) {
  if (current !== controller) return;
  composition.replaceChildren();
  candidates.replaceChildren();
  const label = $('composition-label');
  if (label) label.textContent = segments.length ? (controller.el === editor ? 'Converting your text' : 'Converting emoji search') : 'Conversion candidates';
  const panel = composition.closest('.conversion-panel');
  if (panel) panel.hidden = !segments.length;
  const focused = segments.find((s) => s.kind === 'focus');
  segments.forEach((segment, i) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `segment ${segment.kind === 'focus' ? 'active' : ''}`;
    el.textContent = segment.text;
    el.title = 'Show candidates for this segment';
    el.addEventListener('pointerdown', (event) => event.preventDefault());
    el.addEventListener('click', () => {
      if (!focused) return;
      const from = controller.segments.findIndex((s) => s.kind === 'focus');
      for (let n = 0; n < Math.abs(i - from); n++) controller.fep.feed({ key: i > from ? 'ArrowRight' : 'ArrowLeft', code: i > from ? 'ArrowRight' : 'ArrowLeft' });
      controller.el.focus();
    });
    composition.append(el);
  });
  if (!focused) {
    if (segments.length) {
      const hint = document.createElement('span');
      hint.lang = 'en';
      hint.className = 'conversion-hint';
      hint.textContent = 'Press Space to convert to kanji';
      candidates.append(hint);
    }
    return;
  }
  const selected = focused.candidateIndex ?? 0;
  const start = Math.floor(selected / 9) * 9;
  controller.candidateStart = start;
  (focused.candidates || []).slice(start, start + 9).forEach((text, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `candidate ${selected === start + i && focused.additionalIndex === undefined ? 'selected' : ''}`;
    button.setAttribute('aria-pressed', String(selected === start + i && focused.additionalIndex === undefined));
    const number = document.createElement('span');
    number.className = 'candidate-number';
    number.textContent = String(i + 1);
    const value = document.createElement('span');
    value.textContent = text;
    button.append(number, value);
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', () => { controller.fep.selectCandidate(start + i); controller.el.focus(); });
    candidates.append(button);
  });
  const note = document.createElement('p');
  note.lang = 'en';
  note.className = 'candidate-note';
  note.textContent = focused.additionalIndex !== undefined ? 'Hiragana / katakana candidate · Enter to confirm' : `${selected + 1} / ${focused.candidates?.length || 1} candidates · ↑ ↓ choose · ← → segment · Enter confirm`;
  candidates.append(note);
}

async function boundedConversion(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(null), 8000); })]); }
  finally { clearTimeout(timer); }
}

function createController(el, conn, keymap) {
  const c = { el, fep: null, preedit: null, segments: [], candidateStart: 0, history: [], future: [], stable: el.value, native: false };
  const snapshot = () => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd });
  const changed = () => {
    if (el === editor) { editorSelection = [el.selectionStart, el.selectionEnd]; updateCount(); }
    else renderEmoji();
  };
  c.remember = (state) => {
    if (c.history.at(-1)?.value !== state.value) c.history.push(state);
    if (c.history.length > 100) c.history.shift();
    c.future = [];
  };
  c.canUndo = () => !!(c.preedit || c.history.length);
  c.clearPanel = () => { c.segments = []; renderComposition(c, []); };
  c.finalize = () => {
    if (c.preedit) c.fep.feed({ key: 'Enter', code: 'Enter' });
  };
  c.cancel = () => {
    const previous = c.preedit;
    c.fep.reset();
    if (previous) {
      el.value = previous.value;
      el.setSelectionRange(previous.start, previous.end);
    }
    c.preedit = null;
    c.stable = el.value;
    c.clearPanel();
    changed();
  };
  c.replace = (text, start = el.selectionStart, end = el.selectionEnd) => {
    c.finalize();
    c.remember(snapshot());
    el.setRangeText(text, start, end, 'end');
    c.stable = el.value;
    changed();
  };
  c.undo = (redo = false) => {
    if (c.preedit) { c.cancel(); changed(); return; }
    const source = redo ? c.future : c.history;
    if (!source.length) return;
    (redo ? c.history : c.future).push(snapshot());
    const state = source.pop();
    el.value = state.value;
    el.setSelectionRange(state.start, state.end);
    c.stable = el.value;
    changed();
  };
  c.fep = Hechima.createFep({
    convert: async (reading) => {
      const result = await boundedConversion(conn.convert(reading));
      if (!result) toast('Conversion failed. Try a shorter phrase.');
      return result;
    },
    resize: (index, offset) => boundedConversion(conn.resize(index, offset)),
    show(segments) {
      if (!segments.length) return;
      if (!c.preedit) c.preedit = snapshot();
      c.segments = segments;
      const text = segments.map((s) => s.text).join('');
      const p = c.preedit;
      const top = el.scrollTop;
      el.value = p.value.slice(0, p.start) + text + p.value.slice(p.end);
      let focusStart = p.start;
      const focused = segments.find((s) => s.kind === 'focus');
      if (focused) {
        for (const s of segments) { if (s === focused) break; focusStart += s.text.length; }
        el.setSelectionRange(focusStart, focusStart + focused.text.length);
      } else el.setSelectionRange(p.start + text.length, p.start + text.length);
      el.scrollTop = top;
      renderComposition(c, segments);
      changed();
    },
    hide() {
      if (c.preedit) {
        const p = c.preedit;
        el.value = p.value;
        el.setSelectionRange(p.start, p.end);
        c.preedit = null;
      }
      c.clearPanel();
      changed();
    },
    commit(text) {
      const p = c.preedit || snapshot();
      c.remember(p);
      el.value = p.value.slice(0, p.start) + text + p.value.slice(p.end);
      el.setSelectionRange(p.start + text.length, p.start + text.length);
      c.preedit = null;
      c.stable = el.value;
      c.clearPanel();
      changed();
    },
    hostKey(name) {
      const start = el.selectionStart, end = el.selectionEnd;
      if (name === 'Backspace') {
        const before = graphemes(el.value.slice(0, start));
        c.replace('', start === end ? (before.at(-1)?.index ?? start) : start, end);
      } else if (name === 'ArrowLeft') el.setSelectionRange(Math.max(0, start - 1), Math.max(0, start - 1));
      else if (name === 'ArrowRight') el.setSelectionRange(Math.min(el.value.length, end + 1), Math.min(el.value.length, end + 1));
    },
  });
  const engine = new KeymapEngine.InputEngine(KeymapEngine.decodeKeymap({ ...keymap, modeKeys: {} }));
  engine.onStateChange = () => c.fep.pumpEngine();
  c.fep.setEngine(engine, (tap) => KeymapEngine.keyEventFromBrowser(tap));
  c.fep.setActive(true);

  el.addEventListener('focus', () => {
    if (current && current !== c) current.finalize();
    current = c;
    renderComposition(c, c.segments);
  });
  el.addEventListener('pointerdown', () => c.finalize());
  el.addEventListener('compositionstart', () => { c.finalize(); c.native = true; });
  el.addEventListener('compositionend', () => { c.native = false; c.stable = el.value; changed(); });
  el.addEventListener('beforeinput', () => {
    if (c.preedit) c.finalize();
    c.remember(snapshot());
  });
  el.addEventListener('input', () => { c.stable = el.value; changed(); });
  el.addEventListener('paste', () => c.finalize());
  el.addEventListener('cut', () => c.finalize());
  el.addEventListener('select', () => { if (el === editor && !c.preedit) editorSelection = [el.selectionStart, el.selectionEnd]; });
  el.addEventListener('keyup', (event) => {
    if (ready && japanese && !event.isComposing && !c.native) c.fep.feedUp(event);
  });
  el.addEventListener('keydown', (event) => {
    if (event.isComposing || c.native || event.keyCode === 229) return;
    const command = event.ctrlKey || event.metaKey;
    if (event.ctrlKey && event.code === 'Space') { event.preventDefault(); toggleMode(); return; }
    if (command && !event.altKey && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
      event.preventDefault(); c.undo(event.shiftKey || event.key.toLowerCase() === 'y'); return;
    }
    if (command || event.altKey) { c.finalize(); return; }
    if (event.key === 'Tab') { c.finalize(); return; }
    if (!japanese || !ready) return;
    if ((event.key === 'F6' || event.key === 'F7') && c.preedit) {
      event.preventDefault();
      while (c.segments.some((s) => s.kind === 'focus')) c.fep.feed({ key: 'Escape', code: 'Escape' });
      const start = c.preedit.start;
      c.finalize();
      const end = el.selectionStart;
      const text = el.value.slice(start, end);
      const transformed = event.key === 'F7' ? text.replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60)) : text.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
      c.replace(transformed, start, end);
      return;
    }
    if (c.segments.some((s) => s.kind === 'focus') && /^[1-9]$/.test(event.key)) {
      event.preventDefault(); c.fep.selectCandidate(c.candidateStart + Number(event.key) - 1); return;
    }
    // Repeats remain native for document navigation; composition consumes them safely.
    if (!c.preedit && ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'].includes(event.key)) return;
    if (c.fep.feed(event)) event.preventDefault();
  });
  return c;
}
function toggleMode() {
  current?.finalize();
  japanese = !japanese;
  for (const c of controllers) { c.fep.reset(); c.fep.setActive(japanese); }
  const toggle = $('ime-toggle');
  toggle.setAttribute('aria-pressed', String(japanese));
  toggle.innerHTML = japanese ? '<span class="mode-glyph">JP</span><span>Japanese input</span><span class="mode-switch">ON</span>' : '<span class="mode-glyph">EN</span><span>English input</span><span class="mode-switch">OFF</span>';
  (current?.el || editor).focus();
}
$('ime-toggle').addEventListener('click', toggleMode);
$('copy-button').addEventListener('click', async () => {
  controllers[0]?.finalize();
  try { await navigator.clipboard.writeText(editor.value); toast('Copied to clipboard'); }
  catch { editor.focus(); editor.select(); toast('Text selected. Press Ctrl+C (or Command+C) to copy.'); }
});
$('search-button').addEventListener('click', () => {
  controllers[0]?.finalize();
  const text = editor.value.trim();
  if (text) window.open(`https://www.google.com/search?q=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
});
$('clear-button').addEventListener('click', () => {
  const c = controllers[0];
  c?.finalize();
  c?.replace('', 0, editor.value.length);
  editor.focus();
  toast('Text cleared. Choose Undo to restore it.');
});
$('undo-button').addEventListener('click', () => { controllers[0]?.undo(); editor.focus(); });
$('help-button').addEventListener('click', () => {
  const panel = $('help-panel');
  panel.hidden = !panel.hidden;
  $('help-button').setAttribute('aria-expanded', String(!panel.hidden));
});
// Resolve compositions before toolbar actions and field switches without stealing candidate clicks.
document.addEventListener('pointerdown', (event) => {
  if (!current?.preedit) return;
  if (event.target.closest('#candidates, #composition') || event.target === current.el) return;
  current.finalize();
}, true);

const normalize = (text) => text.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).trim();
function renderEmoji() {
  if (!emojiData) return;
  const query = normalize(searchInput.value);
  const terms = query.split(/\s+/).filter(Boolean);
  const results = emojiData.emoji.filter((item) => (category === 'all' || item.group === category) && terms.every((term) => item.searchText.includes(term)));
  $('emoji-count').textContent = `${results.length.toLocaleString('en-US')} results`;
  const container = $('emoji-results');
  container.replaceChildren();
  // Keep a scrollable picker small enough to remain responsive on older Ubuntu machines.
  let shown = 0;
  const append = () => {
    const chunk = results.slice(shown, shown + 120);
    shown += chunk.length;
    for (const item of chunk) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'emoji-button';
      button.textContent = item.emoji;
      button.title = item.name;
      button.setAttribute('aria-label', item.name);
      button.addEventListener('pointerdown', (event) => event.preventDefault());
      button.addEventListener('click', () => {
        current?.finalize();
        const [start, end] = editorSelection;
        const c = controllers[0];
        if (!c) return;
        editor.focus();
        editor.setSelectionRange(start, end);
        c.replace(item.emoji, start, end);
        toast(`${item.emoji} inserted`);
      });
      container.append(button);
    }
    if (shown < results.length) {
      const more = document.createElement('button');
      more.className = 'emoji-more';
      more.type = 'button';
      more.textContent = 'Show more';
      more.addEventListener('click', () => { more.remove(); append(); });
      container.append(more);
    }
  };
  append();
  if (!results.length) {
    const empty = document.createElement('p');
    empty.className = 'emoji-empty';
    empty.textContent = 'No emoji found. Try another keyword.';
    container.append(empty);
  }
}
async function loadEmoji() {
  const response = await fetch(url('data/emoji.json?v=enoki-2'));
  if (!response.ok) throw new Error('Could not load emoji data');
  emojiData = await response.json();
  emojiData.emoji.forEach((item) => { item.searchText = normalize([item.emoji, item.name, ...item.keywords].join(' ')); });
  const groups = [{ id: 'all', label: 'All emoji', icon: '✳' }, ...emojiData.groups];
  const list = $('emoji-categories');
  for (const group of groups) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = group.icon;
    button.title = group.label;
    button.setAttribute('aria-label', group.label);
    button.setAttribute('aria-pressed', String(group.id === category));
    button.className = group.id === category ? 'active' : '';
    button.addEventListener('click', () => {
      current?.finalize();
      category = group.id;
      for (const child of list.children) { child.classList.toggle('active', child === button); child.setAttribute('aria-pressed', String(child === button)); }
      renderEmoji();
    });
    list.append(button);
  }
  renderEmoji();
}

function loading(message, detail) {
  $('loading-panel').hidden = false;
  $('engine-status').textContent = 'Loading…';
  $('loading-label').textContent = message;
  $('engine-detail').textContent = detail;
}
let booting = false;
async function boot() {
  if (booting) return;
  booting = true;
  ready = false;
  fields.forEach((field) => { field.disabled = true; });
  $('ime-toggle').disabled = true;
  $('retry-button').hidden = true;
  loading('Getting Japanese input ready…', 'Downloading dictionaries. Your writing stays on this device.');
  let timeout;
  try {
    worker?.terminate();
    worker = new Worker(url('vendor/hechima/hechima-worker.js'));
    const failure = new Promise((_, reject) => {
      worker.addEventListener('error', () => {
        if (ready) {
          ready = false;
          current?.finalize();
          controllers.forEach((c) => c.cancel());
          $('engine-status').textContent = 'Conversion engine stopped';
          $('engine-detail').textContent = 'Copy your text, then reload the page';
          $('loading-panel').hidden = false;
          $('loading-label').textContent = 'Your text is still here. Reloading will clear it.';
          toast('The conversion engine stopped. Copy your text before reloading.');
        }
        reject(new Error('Could not start the conversion engine'));
      }, { once: true });
      timeout = setTimeout(() => reject(new Error('Loading took too long. Check your connection and try again.')), 90000);
    });
    const conn = Hechima.connectWorker(worker, { maxCands: 40, onProgress(loaded, total) {
      const progress = $('loading-progress');
      if (total) progress.value = Math.min(100, loaded / total * 100);
      else progress.removeAttribute('value');
      $('loading-label').textContent = `Downloading dictionary ${(loaded / 1048576).toFixed(1)} MB${total ? ` / ${(total / 1048576).toFixed(1)} MB` : ''}`;
      if (total && loaded >= total) $('loading-label').textContent = 'Dictionary ready. Starting the conversion engine…';
    } });
    const keymapResponse = await Promise.race([fetch(url('vendor/keymaps/romaji.json')), failure]);
    if (!keymapResponse.ok) throw new Error('Could not load romaji settings');
    const keymap = await Promise.race([keymapResponse.json(), failure]);
    await Promise.race([conn.init({ wasmJs: url('vendor/hechima-wasm/hechima-wasm.js'), dataUrl: url('vendor/hechima-wasm/mozc.data'), learning: false }), failure]);
    clearTimeout(timeout);
    controllers = fields.map((field) => createController(field, conn, keymap));
    current = controllers[0];
    ready = true;
    document.documentElement.dataset.engine = 'ready';
    $('engine-status').textContent = 'Japanese input ready';
    $('engine-detail').textContent = 'Converted entirely on this device';
    $('loading-panel').hidden = true;
    fields.forEach((field) => { field.disabled = false; });
    $('ime-toggle').disabled = false;
    updateCount();
    editor.focus();
    void setupOffline();
  } catch (error) {
    clearTimeout(timeout);
    worker?.terminate();
    document.documentElement.dataset.engine = 'error';
    $('engine-status').textContent = 'Could not load Japanese input';
    console.error('Enoki initialization failed', error);
    $('loading-label').textContent = 'Could not start Japanese input. Check your connection and try again.';
    $('engine-detail').textContent = 'Use Try again to restart loading';
    $('retry-button').hidden = false;
  } finally { booting = false; }
}
$('retry-button').addEventListener('click', boot);
async function setupOffline() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    $('offline-status').textContent = 'Offline access is unavailable';
    return;
  }
  $('offline-status').textContent = 'Saving for offline use…';
  try {
    const registration = await navigator.serviceWorker.register(url('sw.js'), { scope: new URL('./', import.meta.url).pathname });
    const pending = registration.installing || registration.waiting;
    if (pending && pending.state !== 'activated') {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('cache timeout')), 60000);
        const inspect = () => {
          if (pending.state === 'activated') { clearTimeout(timer); resolve(); }
          if (pending.state === 'redundant') { clearTimeout(timer); reject(new Error('cache failed')); }
        };
        pending.addEventListener('statechange', inspect);
        inspect();
      });
    }
    if (!registration.active) throw new Error('No active offline worker');
    const status = await new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(false), 5000);
      channel.port1.onmessage = (event) => { clearTimeout(timer); resolve(event.data.ready && event.data.version === 'enoki-v2'); };
      registration.active.postMessage({ type: 'STATUS' }, [channel.port2]);
    });
    $('offline-status').textContent = status ? 'Ready for offline use' : 'Offline setup incomplete';
    document.documentElement.dataset.offline = status ? 'ready' : 'unavailable';
  } catch {
    $('offline-status').textContent = 'Offline setup incomplete; online use is available';
  }
}
window.addEventListener('offline', () => toast('You are offline. Japanese input and emoji search still work when loaded.'));
updateCount();
loadEmoji().catch(() => { $('emoji-results').textContent = 'Could not load emoji. Please reload the page.'; });
boot();
