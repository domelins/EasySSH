import type { Store } from '@tauri-apps/plugin-store';

// Every UI preference shares one store file. Its location is resolved once through
// the backend: the profile's AppData directory while it accepts writes, otherwise the
// portable `easyssh-data` beside the executable — the same fallback `hosts.toml` uses
// when a security product protects AppData. A relative 'settings.json' would always
// land in AppData, where such a machine refuses the save silently and the next launch
// hydrates the stale file (the theme "resetting" on restart).
let resolved: Promise<string> | undefined;
// One shared import: concurrent callers (two prefs saved back-to-back) must not each
// start their own dynamic import of the plugin.
let plugin: Promise<typeof import('@tauri-apps/plugin-store')> | undefined;

function storePath(): Promise<string> {
  if (!resolved) {
    resolved = (async () => {
      const { settingsStorePath } = await import('$lib/ipc/commands');
      return settingsStorePath();
    })().catch((err) => {
      // Unresolved (no Tauri, or an older backend): retry on the next call rather than
      // pinning every store to the relative path for the whole session.
      resolved = undefined;
      throw err;
    });
  }
  return resolved;
}

/** Load the shared settings store. Outside Tauri (tests, vite preview) the command
 *  is unreachable and the relative path keeps the plugin's own default. */
export async function loadSettingsStore(): Promise<Store> {
  if (!plugin) plugin = import('@tauri-apps/plugin-store');
  const { load } = await plugin;
  let path = 'settings.json';
  try {
    path = await storePath();
  } catch {
    // Keep the relative default.
  }
  return load(path);
}