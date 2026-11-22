<script lang="ts">
  // Asks before a key setup (tech-gui.md §4.3 note, 2026-10-09): it changes this
  // computer and, with sudo, the server's login for everyone. `rerun` is the "Password
  // on" badge's second try, which reuses the key EasySSH made before.
  import { onMount } from 'svelte';
  import type { HostDto } from '$lib/bindings';
  import Modal from '$lib/components/Modal.svelte';
  import { Button } from '$lib/theme';
  import { keyFilePath } from '$lib/stores/keySetup';
  import { streamerMode, displayHostname } from '$lib/stores/streamer';
  import { isWindows } from '$lib/platform';

  let {
    host,
    rerun,
    onConfirm,
    onCancel
  }: { host: HostDto; rerun: boolean; onConfirm: () => void; onCancel: () => void } = $props();

  const keyPath = $derived(keyFilePath(host.name, isWindows));

  // Cancel is first in `actions`. Focused by hand: Modal sets no initial focus, and
  // `autofocus` is skipped while the opening button still holds focus.
  let actions = $state<HTMLElement>();
  onMount(() => actions?.querySelector('button')?.focus());
</script>

<Modal label={rerun ? '关闭密码登录' : '设置密钥登录'} onClose={onCancel}>
  <div class="space-y-3 px-5 py-4">
    <h2 class="text-sm font-semibold">
      {rerun ? `关闭 ${host.name} 的密码登录？` : `为 ${host.name} 设置密钥登录？`}
    </h2>
    <ul class="list-disc space-y-1.5 pl-5 text-sm text-muted">
      {#if rerun}
        <li>
          复用 EasySSH 之前生成的登录密钥，若已丢失则重新生成：
          <span class="break-all font-mono text-xs">{keyPath}</span>
        </li>
      {:else}
        <li>
          在本机生成登录密钥：
          <span class="break-all font-mono text-xs">{keyPath}</span>（无密钥口令）
        </li>
      {/if}
      <li>
        将其添加到
        <span class="break-all font-mono text-xs">{host.user}@{displayHostname(host.hostname, $streamerMode)}</span>，
        让本机无需密码即可登录
      </li>
      <li>
        若你的账户可以免密使用 sudo，将关闭服务器上所有账户和设备的密码登录。
        服务器 SSH 设置会保留备份。
      </li>
    </ul>
    <p class="text-xs text-faint">
      只有在新密钥测试通过后才会关闭密码登录。请妥善保管密钥文件：一旦丢失，
      需要通过主机服务商的控制台才能重新登录。
    </p>
    <div class="flex justify-end gap-2 pt-1" bind:this={actions}>
      <Button variant="ghost" onclick={onCancel}>取消</Button>
      <Button variant="primary" onclick={onConfirm}>
        {rerun ? '关闭密码登录' : '设置密钥登录'}
      </Button>
    </div>
  </div>
</Modal>
