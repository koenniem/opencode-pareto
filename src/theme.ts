const STORAGE_KEY = 'opencode-pareto-theme';

export type Theme = 'light' | 'dark';

/** Stored choice wins; otherwise follow the OS. Unknown values are ignored. */
export function preferredTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersDark ? 'dark' : 'light';
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
}

export function wireThemeToggle(button: HTMLButtonElement | null): void {
  if (!button) return;

  const sync = (theme: Theme) => {
    const next = theme === 'dark' ? 'light' : 'dark';
    button.setAttribute('aria-label', `Switch to ${next} theme`);
    button.setAttribute('aria-pressed', String(theme === 'dark'));
  };

  const current = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

  button.hidden = false;
  sync(current());

  button.addEventListener('click', () => {
    const next: Theme = current() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    sync(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode: the theme still applies for this page view.
    }
  });
}
