// Yomii Reader Client Logic
// High precision reading position memory, bookmarks management, shortcuts, and dialog controllers.

export interface ReaderPreferencesApi {
  defaults: {
    theme: string;
    size: number;
    line: number;
    width: number;
    font: string;
    focus: boolean;
  };
  read: <T = any>(key: string) => T | null;
  write: (key: string, value: any) => boolean;
  normalize: (v?: any) => any;
  apply: (v?: any) => any;
  current: any;
}

declare global {
  interface Window {
    ReaderPreferences?: ReaderPreferencesApi;
  }
}

interface Position {
  chapter: number;
  paragraph: number;
  title?: string;
  offset?: number;
  ratio?: number;
  atStart?: boolean;
  beforeStory?: number | null;
  percent?: number;
  timestamp?: number;
}

interface Bookmark extends Position {
  id: string;
  excerpt: string;
}

(() => {
  'use strict';

  if (!window.ReaderPreferences) return;
  const api: ReaderPreferencesApi = window.ReaderPreferences;

  const total = Number(document.body.dataset.totalChapters) || 1;
  const bookId = document.body.dataset.bookId || 'default';
  const progressKey = `yomii-progress-v1-${bookId}`;
  const legacyBookmarkKey = `yomii-bookmark-v1-${bookId}`;
  const bookmarksKey = `yomii-bookmarks-v2-${bookId}`;
  const chapter = Number(document.body.dataset.chapter) || 0;
  const chapterTitle = document.body.dataset.chapterTitle || '';
  const basePath = document.body.dataset.basePath || '';

  const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T | null;
  const clamp = (value: number, low: number, high: number) =>
    Math.max(low, Math.min(high, value));

  let prefs = api.current;
  let reader: {
    capture: () => Position;
    place: (p: Position) => void;
    update: () => void;
  } | null = null;
  let toastTimer: any = null;
  let undoAction: (() => void) | null = null;
  const dialogAnchors = new WeakMap<HTMLDialogElement, Position>();

  const validPosition = (p: any): p is Position =>
    Boolean(
      p &&
        Number.isInteger(p.chapter) &&
        p.chapter >= 1 &&
        p.chapter <= total &&
        Number.isInteger(p.paragraph) &&
        p.paragraph >= 0 &&
        p.paragraph < 10000
    );

  const chapterURL = (n: number) =>
    `${basePath}/c/${String(n).padStart(3, '0')}/`;

  // Toast notification
  function notify(message: string, undo: (() => void) | null = null) {
    const toast = $('toast');
    if (!toast) return;

    const host =
      (document.querySelector('dialog[open]') as HTMLElement | null) ||
      document.body;
    host.appendChild(toast);
    toast.hidden = false;
    toast.classList.toggle('in-dialog', host.tagName === 'DIALOG');

    const toastText = $('toast-text');
    if (toastText) toastText.textContent = message;

    undoAction = undo;
    const undoButton = $('undo-bookmark');
    if (undoButton) undoButton.hidden = !undo;

    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => {
        toast.classList.remove('show', 'in-dialog');
        document.body.appendChild(toast);
        toast.hidden = true;
        if (undoButton) undoButton.hidden = true;
        undoAction = null;
      },
      undo ? 8000 : 2600
    );
  }

  $('undo-bookmark')?.addEventListener('click', () => {
    const action = undoAction;
    undoAction = null;
    if (action) action();
    clearTimeout(toastTimer);
    const toast = $('toast');
    if (toast) {
      toast.classList.remove('show', 'in-dialog');
      document.body.appendChild(toast);
      toast.hidden = true;
    }
    const undoButton = $('undo-bookmark');
    if (undoButton) undoButton.hidden = true;
  });

  // Settings sync
  function syncSettings() {
    if (!$('settings')) return;
    const sizeInput = $('font-size') as HTMLInputElement | null;
    const lineInput = $('line-height') as HTMLInputElement | null;
    const widthInput = $('reading-width') as HTMLInputElement | null;

    if (sizeInput) sizeInput.value = String(prefs.size);
    if (lineInput) lineInput.value = String(prefs.line);
    if (widthInput) widthInput.value = String(prefs.width);

    const fontValue = $('font-value');
    if (fontValue) fontValue.textContent = `${prefs.size} px`;
    const lineValue = $('line-value');
    if (lineValue) lineValue.textContent = prefs.line.toFixed(1);
    const widthValue = $('width-value');
    if (widthValue) widthValue.textContent = `${prefs.width} px`;

    document.querySelectorAll('[data-theme-choice]').forEach((el) => {
      const btn = el as HTMLElement;
      btn.setAttribute(
        'aria-pressed',
        String(btn.dataset.themeChoice === prefs.theme)
      );
    });

    document.querySelectorAll('[data-font]').forEach((el) => {
      const btn = el as HTMLElement;
      btn.setAttribute('aria-pressed', String(btn.dataset.font === prefs.font));
    });

    $('focus-toggle')?.setAttribute('aria-pressed', String(prefs.focus));
  }

  function setPrefs(value: any) {
    const settingsDialog = $('settings') as HTMLDialogElement | null;
    const anchor =
      (settingsDialog && dialogAnchors.get(settingsDialog)) ||
      reader?.capture();
    prefs = api.apply(value);
    api.current = prefs;
    api.write('yomii-preferences-v1', prefs);
    syncSettings();
    if (anchor && reader) {
      requestAnimationFrame(() => {
        reader?.place(anchor);
        reader?.update();
      });
    }
  }

  syncSettings();

  document.querySelectorAll('[data-theme-choice]').forEach((el) => {
    el.addEventListener('click', () => {
      const btn = el as HTMLElement;
      setPrefs({ ...prefs, theme: btn.dataset.themeChoice });
    });
  });

  document.querySelectorAll('[data-font]').forEach((el) => {
    el.addEventListener('click', () => {
      const btn = el as HTMLElement;
      setPrefs({ ...prefs, font: btn.dataset.font });
    });
  });

  (['font-size', 'line-height', 'reading-width'] as const).forEach((id) => {
    const key =
      id === 'font-size' ? 'size' : id === 'line-height' ? 'line' : 'width';
    $(id)?.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      setPrefs({ ...prefs, [key]: Number(target.value) });
    });
  });

  $('reset-settings')?.addEventListener('click', () => {
    setPrefs({ ...api.defaults, focus: prefs.focus });
    notify('已恢复默认阅读设置');
  });

  // Bookmarks
  let rawBookmarks = api.read(bookmarksKey);
  let bookmarks: Bookmark[] = [];
  if (!Array.isArray(rawBookmarks)) {
    const old = api.read(legacyBookmarkKey);
    bookmarks = validPosition(old)
      ? [{ ...old, id: 'legacy', excerpt: '', timestamp: Date.now() }]
      : [];
    if (bookmarks.length) api.write(bookmarksKey, bookmarks);
  } else {
    bookmarks = rawBookmarks
      .filter(validPosition)
      .slice(0, 1000)
      .map((b: any, i: number) => ({
        ...b,
        id: typeof b.id === 'string' ? b.id.slice(0, 100) : `saved-${i}`,
      }));
  }

  function renderBookmarks() {
    const list = $('bookmark-list');
    if (!list) return;

    const countSpan = $('bookmark-count');
    if (countSpan)
      countSpan.textContent = bookmarks.length ? String(bookmarks.length) : '';

    const homeBookmarks = $('home-bookmarks');
    if (homeBookmarks) {
      homeBookmarks.hidden = !bookmarks.length;
      homeBookmarks.textContent = `书签 (${bookmarks.length})`;
    }

    list.replaceChildren();
    if (!bookmarks.length) {
      const p = document.createElement('p');
      p.className = 'empty-note';
      p.textContent = '暂无书签';
      list.appendChild(p);
      return;
    }

    [...bookmarks]
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .forEach((b) => {
        const row = document.createElement('div');
        row.className = 'bookmark-row';

        const link = document.createElement('a');
        link.href = `${chapterURL(b.chapter)}#p-${b.paragraph}`;

        const title = document.createElement('span');
        title.className = 'bookmark-title';
        title.textContent =
          typeof b.title === 'string'
            ? b.title.slice(0, 120)
            : `第 ${b.chapter} 话`;

        const excerpt = document.createElement('span');
        excerpt.className = 'bookmark-excerpt';
        excerpt.textContent =
          typeof b.excerpt === 'string' && b.excerpt
            ? b.excerpt.slice(0, 90)
            : '回到保存的位置';

        link.append(title, excerpt);

        if (typeof b.timestamp === 'number' && Number.isFinite(b.timestamp)) {
          const time = document.createElement('span');
          time.className = 'bookmark-time';
          time.textContent = new Date(b.timestamp).toLocaleDateString('zh-CN', {
            month: 'long',
            day: 'numeric',
          });
          link.appendChild(time);
        }

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '删除';
        remove.setAttribute('aria-label', `删除书签：${title.textContent}`);
        remove.addEventListener('click', () => {
          const remaining = bookmarks.filter((x) => x.id !== b.id);
          if (!api.write(bookmarksKey, remaining)) {
            notify('无法保存书签');
            return;
          }
          bookmarks = remaining;
          renderBookmarks();
          notify('书签已删除', () => {
            const restored = [...bookmarks, b];
            if (api.write(bookmarksKey, restored)) {
              bookmarks = restored;
              renderBookmarks();
            }
          });
        });

        row.append(link, remove);
        list.appendChild(row);
      });
  }

  renderBookmarks();

  // Tab switching
  function switchTab(name: string) {
    const selected = name === 'bookmarks' ? 'bookmarks' : 'chapters';
    document.querySelectorAll('[data-library-tab]').forEach((el) => {
      const btn = el as HTMLElement;
      const active = btn.dataset.libraryTab === selected;
      btn.setAttribute('aria-selected', String(active));
      btn.tabIndex = active ? 0 : -1;
    });
    const chaptersPanel = $('panel-chapters');
    if (chaptersPanel) chaptersPanel.hidden = selected !== 'chapters';
    const bookmarksPanel = $('panel-bookmarks');
    if (bookmarksPanel) bookmarksPanel.hidden = selected !== 'bookmarks';
    if (selected === 'bookmarks') renderBookmarks();
  }

  document.querySelectorAll('[data-library-tab]').forEach((el) => {
    const btn = el as HTMLElement;
    btn.addEventListener('click', () => switchTab(btn.dataset.libraryTab || ''));
    btn.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const name =
        e.key === 'Home'
          ? 'chapters'
          : e.key === 'End'
            ? 'bookmarks'
            : btn.dataset.libraryTab === 'chapters'
              ? 'bookmarks'
              : 'chapters';
      switchTab(name);
      $(`tab-${name}`)?.focus();
    });
  });

  // Chapter search
  $('chapter-search')?.addEventListener('input', (e) => {
    const q = (e.target as HTMLInputElement).value.trim().toLocaleLowerCase();
    let matched = 0;
    const chaptersPanel = $('panel-chapters');
    if (!chaptersPanel) return;

    chaptersPanel
      .querySelectorAll('[data-chapter-link]')
      .forEach((linkEl) => {
        const link = linkEl as HTMLElement;
        const visible =
          !q || (link.dataset.search || link.textContent || '').toLocaleLowerCase().includes(q);
        const li = link.closest('li');
        if (li) li.hidden = !visible;
        if (visible) matched++;
      });

    chaptersPanel.querySelectorAll('.track').forEach((groupEl) => {
      const group = groupEl as HTMLDetailsElement;
      group.hidden = ![...group.querySelectorAll('li')].some((li) => !li.hidden);
      if (q) group.open = true;
    });

    const noChapters = $('no-chapters');
    if (noChapters) noChapters.hidden = matched > 0;
  });

  // Dialog triggers
  document.querySelectorAll('[data-open]').forEach((buttonEl) => {
    buttonEl.addEventListener('click', () => {
      const button = buttonEl as HTMLElement;
      const targetId = button.dataset.open;
      if (!targetId) return;
      const d = $(targetId) as HTMLDialogElement | null;
      if (!d) return;

      if (targetId === 'chapter-menu') {
        switchTab(button.dataset.panel || 'chapters');
        const searchInput = $('chapter-search') as HTMLInputElement | null;
        if (searchInput) {
          searchInput.value = '';
          searchInput.dispatchEvent(new Event('input'));
        }
      }

      if (!d.open) {
        if (reader) dialogAnchors.set(d, reader.capture());
        d.showModal();
      }

      if (targetId === 'chapter-menu' && button.dataset.panel !== 'bookmarks') {
        requestAnimationFrame(() =>
          d.querySelector('[aria-current=page]')?.scrollIntoView({ block: 'nearest' })
        );
      }
    });
  });

  document.querySelectorAll('[data-close]').forEach((buttonEl) => {
    buttonEl.addEventListener('click', () => {
      const button = buttonEl as HTMLElement;
      const targetId = button.dataset.close;
      if (targetId) ($(targetId) as HTMLDialogElement | null)?.close();
    });
  });

  document.querySelectorAll('dialog').forEach((d) => {
    d.addEventListener('close', () => {
      const toast = $('toast');
      if (toast && toast.parentElement === d) {
        document.body.appendChild(toast);
        toast.classList.remove('in-dialog');
      }
      const anchor = dialogAnchors.get(d);
      dialogAnchors.delete(d);
      if (anchor && reader) {
        requestAnimationFrame(() => {
          reader?.place(anchor);
          reader?.update();
        });
      }
    });

    d.addEventListener('click', (e) => {
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      ) {
        d.close();
      }
    });
  });

  // Home page progress restore
  const saved = api.read<Position>(progressKey);
  if (!chapter) {
    const continueBtn = $('continue-reading') as HTMLAnchorElement | null;
    if (continueBtn && validPosition(saved)) {
      continueBtn.href = chapterURL(saved.chapter);
      continueBtn.textContent = '继续阅读';
      const resumeNote = $('resume-note');
      if (resumeNote) {
        resumeNote.hidden = false;
        const name =
          typeof saved.title === 'string'
            ? saved.title.slice(0, 100)
            : `第 ${saved.chapter} 话`;
        const suffix =
          typeof saved.percent === 'number'
            ? ` · 本话 ${Math.round(clamp(saved.percent, 0, 100))}%`
            : '';
        resumeNote.textContent = `上次读到：${name}${suffix}`;
      }
      const startOver = $('start-over');
      if (startOver) startOver.hidden = false;
    }
    return;
  }

  // Reader page reading progress tracker
  const story = $('story');
  if (!story) return;
  const storyEl = story;
  const paragraphs = [
    ...storyEl.querySelectorAll<HTMLElement>('[data-paragraph]'),
  ];
  if (!paragraphs.length) return;

  let ready = false;
  let saveTimer: any = null;
  let frame = false;
  let currentPercent = 0;

  const line = () =>
    prefs.focus
      ? 34
      : ((document.querySelector('.reader-toolbar') as HTMLElement | null)
          ?.offsetHeight || 62) + 24;

  function capture(): Position {
    const target = line();
    let low = 0;
    let high = paragraphs.length - 1;
    let index = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (paragraphs[mid].getBoundingClientRect().top <= target) {
        index = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const r = paragraphs[index].getBoundingClientRect();
    const offset = target - r.top;
    return {
      chapter,
      paragraph: index,
      title: chapterTitle,
      offset,
      ratio: clamp(offset / Math.max(1, r.height), 0, 1),
      atStart: window.scrollY < 8,
      beforeStory: index === 0 && offset < 0 ? window.scrollY : null,
      percent: Math.round(currentPercent),
      timestamp: Date.now(),
    };
  }

  function place(p: Position) {
    if (p.atStart) {
      window.scrollTo(0, 0);
      return;
    }
    if (typeof p.beforeStory === 'number' && Number.isFinite(p.beforeStory)) {
      window.scrollTo(0, Math.max(0, p.beforeStory));
      return;
    }
    const element = paragraphs[p.paragraph];
    if (!element) return;
    const r = element.getBoundingClientRect();
    const offset =
      typeof p.ratio === 'number' && Number.isFinite(p.ratio)
        ? clamp(p.ratio, 0, 1) * r.height
        : typeof p.offset === 'number' && Number.isFinite(p.offset)
          ? clamp(p.offset, -500, r.height)
          : 0;
    window.scrollTo(0, Math.max(0, window.scrollY + r.top - line() + offset));
  }

  function persist() {
    if (!ready || document.querySelector('dialog[open]')) return;
    api.write(progressKey, capture());
  }

  function update() {
    frame = false;
    const r = storyEl.getBoundingClientRect();
    const target = line();
    currentPercent =
      clamp(
        (target - r.top) /
          Math.max(1, r.height - (window.innerHeight - target - 24)),
        0,
        1
      ) * 100;
    const percent = Math.round(currentPercent);
    const progressBar = $('progress-bar');
    if (progressBar) progressBar.style.width = `${currentPercent}%`;

    document
      .querySelector('.scroll-progress')
      ?.setAttribute('aria-valuenow', String(percent));
    const chapterProgress = $('chapter-progress');
    if (chapterProgress) {
      chapterProgress.textContent = `${chapter} / ${total} · ${percent}%`;
    }

    const backTop = $('back-top');
    if (backTop) backTop.hidden = window.scrollY < window.innerHeight * 0.65;

    if (ready) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 300);
    }
  }

  reader = { capture, place, update };

  function restore() {
    if (location.hash === '#start') {
      window.scrollTo(0, 0);
    } else if (
      !location.hash &&
      validPosition(saved) &&
      saved.chapter === chapter
    ) {
      place(saved);
    }
    ready = true;
    update();
  }

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (document.readyState === 'complete') {
    requestAnimationFrame(restore);
  } else {
    window.addEventListener(
      'load',
      () => requestAnimationFrame(() => requestAnimationFrame(restore)),
      { once: true }
    );
  }

  window.addEventListener(
    'scroll',
    () => {
      if (!frame) {
        frame = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true }
  );

  window.addEventListener('resize', update, { passive: true });
  window.addEventListener('pagehide', persist);
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) update();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) persist();
  });

  // Focus mode
  function toggleFocus(force?: boolean) {
    const next = typeof force === 'boolean' ? force : !prefs.focus;
    setPrefs({ ...prefs, focus: next });
    requestAnimationFrame(() =>
      $(next ? 'exit-focus' : 'focus-toggle')?.focus({ preventScroll: true })
    );
  }

  $('focus-toggle')?.addEventListener('click', () => toggleFocus());
  $('exit-focus')?.addEventListener('click', () => toggleFocus(false));
  $('back-top')?.addEventListener('click', () =>
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    })
  );

  $('bookmark')?.addEventListener('click', () => {
    const p = capture();
    const existing = bookmarks.find(
      (b) => b.chapter === chapter && b.paragraph === p.paragraph
    );
    const item: Bookmark = {
      ...p,
      id:
        existing?.id ||
        window.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      excerpt: paragraphs[p.paragraph].textContent?.trim().slice(0, 75) || '',
    };
    const next = [item, ...bookmarks.filter((b) => b.id !== item.id)];
    if (!api.write(bookmarksKey, next)) {
      notify('无法保存书签');
      return;
    }
    bookmarks = next;
    renderBookmarks();
    notify(existing ? '书签已更新' : '已添加书签');
  });

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (
      e.altKey ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      document.querySelector('dialog[open]')
    )
      return;
    const target = e.target as HTMLElement | null;
    const interactive = target?.closest?.(
      'input,textarea,select,button,a,summary,[contenteditable=true]'
    );
    if (e.key === 'Escape' && prefs.focus) {
      e.preventDefault();
      toggleFocus(false);
      return;
    }
    if (interactive) return;
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      toggleFocus();
    }
    if (e.key === 'ArrowLeft' && chapter > 1) {
      e.preventDefault();
      persist();
      location.href = chapterURL(chapter - 1);
    }
    if (e.key === 'ArrowRight' && chapter < total) {
      e.preventDefault();
      persist();
      location.href = chapterURL(chapter + 1);
    }
  });
})();
