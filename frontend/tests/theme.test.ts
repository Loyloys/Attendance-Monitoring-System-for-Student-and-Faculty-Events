import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyTheme, nextTheme, readTheme, THEME_STORAGE_KEY } from '../src/utils/theme.ts';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function createRoot() {
  const classes = new Set<string>();
  return {
    classList: {
      toggle: (name: string, enabled: boolean) => {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains: (name: string) => classes.has(name),
    },
    style: { colorScheme: 'light' },
  };
}

test('initial theme uses the saved value and defaults safely to light', () => {
  const storage = createStorage();
  assert.equal(readTheme(storage), 'light');
  storage.setItem(THEME_STORAGE_KEY, 'dark');
  assert.equal(readTheme(storage), 'dark');
  storage.setItem(THEME_STORAGE_KEY, 'unknown');
  assert.equal(readTheme(storage), 'light');
});

test('theme control switches immediately and applies document appearance', () => {
  const storage = createStorage();
  const root = createRoot();
  const next = nextTheme(readTheme(storage));
  assert.equal(next, 'dark');
  applyTheme(next, root, storage);
  assert.equal(root.classList.contains('dark'), true);
  assert.equal(root.style.colorScheme, 'dark');
  assert.equal(storage.getItem(THEME_STORAGE_KEY), 'dark');

  const light = nextTheme(next);
  applyTheme(light, root, storage);
  assert.equal(root.classList.contains('dark'), false);
  assert.equal(root.style.colorScheme, 'light');
  assert.equal(storage.getItem(THEME_STORAGE_KEY), 'light');
});

test('stored theme is restored after reload and bootstrap runs before the app module', () => {
  const storage = createStorage();
  const root = createRoot();
  applyTheme('dark', root, storage);

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../public/theme-init.js', import.meta.url), 'utf8');
  assert.equal(readTheme(storage), 'dark');
  assert.match(html, /<script src="\/theme-init\.js"><\/script>/);
  assert.match(bootstrap, /cot-attendance-theme/);
  assert.ok(bootstrap.indexOf('classList.toggle') < bootstrap.indexOf('colorScheme'));
});

test('dark styles cover workspace, authentication, dialogs, forms, tables, and feedback states', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(css, /html\.dark \.app-workspace/);
  assert.match(css, /html\.dark \.app-workspace \.dashboard-welcome/);
  assert.match(css, /dashboard-welcome h1\s*\{\s*color:\s*#f1f5f9/);
  assert.match(css, /dashboard-welcome p:not\(\[class~="text-\[#C2410C\]"\]\)\s*\{\s*color:\s*#cbd5e1/);
  assert.match(css, /html\.dark \.auth-light/);
  assert.match(css, /html\.dark \.app-card/);
  assert.match(css, /html\.dark \.app-input/);
  assert.match(css, /html\.dark \.app-table/);
  assert.match(css, /html\.dark \.app-workspace \[class~="bg-sky-50"\]/);
  assert.match(css, /html\.dark \.app-workspace \[class~="bg-rose-50"\]/);
  assert.match(app, /aria-pressed=\{theme === 'dark'\}/);
  assert.match(app, /Switch to light mode/);
  assert.match(app, /Switch to dark mode/);
});
