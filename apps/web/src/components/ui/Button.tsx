import { ParentComponent, splitProps, Show } from 'solid-js';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex items-center justify-center font-mono text-xs uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-green focus-visible:ring-offset-0 disabled:opacity-50 disabled:pointer-events-none border",
  {
    variants: {
      variant: {
        primary: "bg-accent-green text-bg-primary border-accent-green hover:bg-accent-green/80",
        destructive: "bg-accent-red text-bg-primary border-accent-red hover:bg-accent-red/80",
        outline: "border-border bg-bg-secondary text-text-primary hover:bg-bg-tertiary hover:border-accent-green",
        secondary: "bg-bg-tertiary text-text-primary border-border hover:bg-border",
        ghost: "border-transparent bg-transparent text-text-secondary hover:bg-bg-tertiary hover:text-text-primary",
        link: "border-transparent bg-transparent text-accent-green hover:text-accent-green/80",
      },
      size: {
        default: "h-8 px-3 py-1",
        sm: "h-6 px-2 text-[10px]",
        lg: "h-10 px-4 py-2",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
);

export interface ButtonProps extends VariantProps<typeof buttonVariants> {
  loading?: boolean;
  disabled?: boolean;
  onClick?: (event: MouseEvent) => void;
  type?: "button" | "submit" | "reset";
  class?: string;
}

export const Button: ParentComponent<ButtonProps> = (props) => {
  const [local, others] = splitProps(props, [
    'variant', 
    'size', 
    'loading', 
    'disabled', 
    'onClick', 
    'type', 
    'class',
    'children'
  ]);
  
  return (
    <button
      class={cn(buttonVariants({ variant: local.variant, size: local.size }), local.class)}
      disabled={local.disabled || local.loading}
      onClick={local.onClick}
      type={local.type || "button"}
      {...others}
    >
      <Show when={local.loading}>
        <div class="mr-2 text-[10px]">
          [...] 
        </div>
      </Show>
      {local.children}
    </button>
  );
};