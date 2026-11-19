<script lang="ts">
  // Brandbook button language (§04): pill shape, one decisive accent action, the
  // rest quiet. Colours are semantic tokens only, so both themes are covered.
  import type { Snippet } from 'svelte';

  type Variant = 'primary' | 'secondary' | 'ghost' | 'icon';
  type Size = 'md' | 'sm';

  let {
    variant = 'secondary',
    size = 'md',
    type = 'button',
    disabled = false,
    title,
    onclick,
    children
  }: {
    variant?: Variant;
    size?: Size;
    type?: 'button' | 'submit';
    disabled?: boolean;
    title?: string;
    onclick?: (event: MouseEvent) => void;
    children: Snippet;
  } = $props();

  const base =
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium transition ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ' +
    'disabled:cursor-not-allowed disabled:opacity-50';

  const variants: Record<Variant, string> = {
    primary: 'bg-accent text-accent-fg hover:opacity-90 active:scale-[0.98]',
    secondary: 'border border-strong text-fg hover:bg-accent hover:text-accent-fg',
    ghost: 'text-muted hover:bg-surface-inset hover:text-fg',
    icon: 'text-muted hover:bg-surface-inset hover:text-fg'
  };

  const sizes: Record<Size, Record<Variant, string>> = {
    md: {
      primary: 'h-9 px-5 text-sm',
      secondary: 'h-9 px-5 text-sm',
      ghost: 'h-9 px-4 text-sm',
      icon: 'h-9 w-9 text-sm'
    },
    sm: {
      primary: 'h-8 px-4 text-xs',
      secondary: 'h-8 px-4 text-xs',
      ghost: 'h-8 px-3 text-xs',
      icon: 'h-8 w-8 text-xs'
    }
  };
</script>

<button {type} {title} {disabled} {onclick} aria-label={title} class="{base} {variants[variant]} {sizes[size][variant]}">
  {@render children()}
</button>
