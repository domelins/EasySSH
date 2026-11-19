<script lang="ts">
  // Auto SSH-key setup progress panel (tech-gui.md §4.2). Renders the active run from
  // the keySetup store: a stepped progress bar while running, then the terminal
  // outcome (full or partial success / failure / rollback), each saying what happened
  // to the server's password login. On the first 'complete', or a failure that may
  // have left password login off, it reloads the host list once — the backend already
  // wrote hosts.toml, so the card must refresh to reflect the new hasKey /
  // passwordAuthDisabled, and "Open terminal" must use the saved key. Mounted globally
  // (AppShell) so it survives navigating away from the Dashboard mid-run.
  import Modal from '$lib/components/Modal.svelte';
  import { Button, Icon, StatusDot } from '$lib/theme';
  import { keySetup, dismissKeySetup } from '$lib/stores/keySetup';
  import { reloadHosts } from '$lib/ipc/commands';
  import { spawnSession } from '$lib/stores/navigation';
  import { lastError } from '$lib/stores/notifications';
  import { maskText } from '$lib/stores/streamer';

  const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  // The core's six fixed step names (key_setup.rs KeySetupStep.description()) arrive in
  // English; the GUI shows them in Chinese by the stable step index. Display layer only —
  // the store keeps the raw step, and an unknown index falls back to the raw description
  // so nothing is swallowed.
  const STEP_LABELS: Record<number, string> = {
    1: '正在生成 Ed25519 密钥对',
    2: '正在复制公钥到服务器',
    3: '正在验证密钥认证',
    4: '正在关闭密码认证',
    5: '正在重新加载 SSH 服务',
    6: '正在进行最终验证'
  };

  // Reload hosts once per run that may have saved a key. Cleared while a run has not, so
  // re-running setup on the same host reloads again.
  let reloadedFor = $state<string | null>(null);
  // The terminal waits for it, so it connects with the key the backend just saved.
  let reloaded: Promise<unknown> = Promise.resolve();
  const BACKUP = '/etc/ssh/sshd_config.omnyssh_backup.*';

  async function openTerminal(hostName: string): Promise<void> {
    await reloaded;
    spawnSession('terminal', hostName);
    dismissKeySetup();
  }

  $effect(() => {
    const run = $keySetup;
    if (!run) return;
    const phase = run.phase;
    if (phase.kind === 'complete' || (phase.kind === 'failed' && phase.passwordMayBeOff)) {
      if (reloadedFor !== run.hostName) {
        reloadedFor = run.hostName;
        reloaded = reloadHosts().catch((e) => lastError.set(message(e)));
      }
    } else if (reloadedFor === run.hostName) {
      reloadedFor = null;
    }
  });
</script>

{#if $keySetup}
  {@const run = $keySetup}
  {@const phase = run.phase}
  <Modal label="密钥设置" onClose={dismissKeySetup}>
    <div class="space-y-4 px-5 py-4">
      <div class="flex items-center gap-2.5">
        <Icon name="key" size={16} />
        <h2 class="min-w-0 truncate text-sm font-semibold">SSH 密钥设置 — {run.hostName}</h2>
      </div>

      {#if phase.kind === 'running'}
        {@const index = phase.step?.index ?? 0}
        {@const total = phase.step?.total ?? 6}
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-3 text-xs">
            <span class="min-w-0 truncate text-muted"
              >{phase.step ? (STEP_LABELS[phase.step.index] ?? phase.step.description) : '正在连接…'}</span
            >
            <span class="shrink-0 tabular-nums text-faint">{index}/{total}</span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-surface-inset">
            <div
              class="h-full rounded-full bg-accent transition-[width] duration-300"
              style="width: {total ? Math.round((index / total) * 100) : 0}%"
            ></div>
          </div>
        </div>
        <p class="text-xs text-faint">
          正在生成密钥、在服务器上授权，并在具备 sudo 权限时关闭密码认证。
          在密钥认证验证通过之前，绝不会关闭密码认证。
        </p>
      {:else if phase.kind === 'complete'}
        <div class="flex items-start gap-2.5">
          <span class="mt-0.5 shrink-0"><StatusDot status={phase.passwordOff ? 'ok' : 'warn'} size={9} /></span>
          <div class="min-w-0 space-y-1">
            {#if phase.passwordOff}
              <p class="text-sm font-medium">密钥登录已设置，密码登录已关闭</p>
              <p class="break-all font-mono text-xs text-muted">{phase.keyPath}</p>
              <p class="text-xs text-faint">
                服务器的 SSH 设置已更改；备份保存在
                <span class="break-all font-mono">{BACKUP}</span>。
              </p>
              <p class="text-xs text-faint">OmnySSH 中保存的密码已删除。</p>
            {:else}
              <p class="text-sm font-medium">
                密钥登录已可用。密码登录仍开启——OmnySSH 需要免密 sudo
                才能更改服务器设置。
              </p>
              <p class="break-all font-mono text-xs text-muted">{phase.keyPath}</p>
              <p class="text-xs text-faint">已保存的密码被保留。</p>
            {/if}
          </div>
        </div>
        <div class="flex justify-end">
          <Button variant="primary" onclick={dismissKeySetup}>完成</Button>
        </div>
      {:else if phase.kind === 'failed'}
        <div class="flex items-start gap-2.5">
          <span class="mt-0.5 shrink-0"><StatusDot status="crit" size={9} /></span>
          <div class="min-w-0 space-y-1">
            {#if phase.passwordMayBeOff}
              <p class="text-sm font-medium">密钥设置失败——密码登录可能已关闭</p>
              <p class="text-xs text-muted">
                服务器的 SSH 设置可能已被更改。密码登录可能现在已关闭，
                或在 SSH 服务下次重启后关闭。新密钥已为该主机保存。
              </p>
              <p class="text-xs text-muted">
                要确认状态，请打开终端并运行
                <span class="break-all font-mono">sudo sshd -T | grep -i passwordauthentication</span>。
              </p>
              <p class="text-xs text-muted">
                要重新开启密码登录，请用最新的
                <span class="break-all font-mono">{BACKUP}</span> 恢复
                <span class="font-mono">/etc/ssh/sshd_config</span> 并重新加载 sshd。
                若无法登录，请使用主机服务商的控制台。
              </p>
            {:else}
              <p class="text-sm font-medium">密钥设置失败</p>
            {/if}
            <p class="break-words text-xs text-muted">{$maskText(phase.error)}</p>
            {#if !phase.passwordMayBeOff}
              <p class="text-xs text-faint">密码登录未被更改。</p>
            {/if}
          </div>
        </div>
        <div class="flex justify-end gap-2">
          {#if phase.passwordMayBeOff}
            <Button variant="secondary" onclick={() => openTerminal(run.hostName)}>打开终端</Button>
          {/if}
          <Button variant="ghost" onclick={dismissKeySetup}>关闭</Button>
        </div>
      {:else}
        <div class="flex items-start gap-2.5">
          <span class="mt-0.5 shrink-0"><StatusDot status="warn" size={9} /></span>
          <div class="min-w-0 space-y-1">
            <p class="text-sm font-medium">密码登录已重新开启</p>
            <p class="text-xs text-muted">
              关闭密码登录之后的某个步骤失败，OmnySSH 已从备份恢复服务器的
              SSH 设置。密码登录与之前一样可用。
            </p>
            <p class="break-words text-xs text-faint">原因：{$maskText(phase.result)}</p>
          </div>
        </div>
        <div class="flex justify-end">
          <Button variant="ghost" onclick={dismissKeySetup}>关闭</Button>
        </div>
      {/if}
    </div>
  </Modal>
{/if}
