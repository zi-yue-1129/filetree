/**
 * Small presentational building blocks shared by the native Settings sections.
 */
import React from 'react';
import { cn } from '../../lib/utils';

/** Props of {@link SettingsSection}. */
interface SettingsSectionProps {
  /** Section icon. */
  icon: React.ElementType;
  /** Section title (zh-TW). */
  title: string;
  /** Section body. */
  children: React.ReactNode;
}

/**
 * Glass card with an icon heading.
 *
 * @param props - Section props.
 * @returns The section element.
 */
export const SettingsSection: React.FC<SettingsSectionProps> = ({ icon: Icon, title, children }) => (
  <section className="glass-card p-6 space-y-4">
    <h2 className="text-lg font-bold text-gray-900 dark:text-white/90 flex items-center gap-2">
      <Icon className="w-5 h-5 text-quantum-cyan" />
      {title}
    </h2>
    {children}
  </section>
);

/** Props of {@link ActionButton}. */
interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. */
  variant?: 'primary' | 'secondary' | 'danger';
}

/**
 * Accessible button styled like the rest of the app.
 *
 * @param props - Button props.
 * @returns The button element.
 */
export const ActionButton: React.FC<ActionButtonProps> = ({ variant = 'secondary', className, ...rest }) => (
  <button
    type="button"
    {...rest}
    className={cn(
      'px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-quantum-cyan',
      variant === 'primary' && 'bg-quantum-cyan/20 text-cyan-700 dark:text-quantum-cyan border border-quantum-cyan/40 hover:bg-quantum-cyan/30',
      variant === 'secondary' && 'border border-gray-200 dark:border-white/10 text-gray-700 dark:text-white/70 hover:bg-gray-100 dark:hover:bg-white/5',
      variant === 'danger' && 'border border-red-400/40 text-red-600 dark:text-red-400 hover:bg-red-500/10',
      className,
    )}
  />
);

/** Props of {@link TextField}. */
interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Visible label (zh-TW). */
  label: string;
}

/**
 * Labelled text input.
 *
 * @param props - Input props.
 * @returns The labelled input.
 */
export const TextField: React.FC<TextFieldProps> = ({ label, id, className, ...rest }) => (
  <label htmlFor={id} className="block space-y-1">
    <span className="text-xs font-semibold text-gray-500 dark:text-white/50">{label}</span>
    <input
      id={id}
      {...rest}
      className={cn(
        'w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10',
        'text-sm text-gray-900 dark:text-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-quantum-cyan',
        className,
      )}
    />
  </label>
);

/** Props of {@link Toggle}. */
interface ToggleProps {
  /** Label (zh-TW). */
  label: string;
  /** Current value. */
  checked: boolean;
  /** Disabled state. */
  disabled?: boolean;
  /** Change handler. */
  onChange: (checked: boolean) => void;
}

/**
 * Switch-style checkbox row.
 *
 * @param props - Toggle props.
 * @returns The toggle row.
 */
export const Toggle: React.FC<ToggleProps> = ({ label, checked, disabled, onChange }) => (
  <label className={cn('flex items-center justify-between gap-4 py-1', disabled && 'opacity-50')}>
    <span className="text-sm text-gray-700 dark:text-white/70">{label}</span>
    <input
      type="checkbox"
      role="switch"
      aria-checked={checked}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      className="w-5 h-5 accent-cyan-500"
    />
  </label>
);

/** Props of {@link Message}. */
interface MessageProps {
  /** Tone. */
  tone: 'info' | 'error' | 'success';
  /** Text. */
  children: React.ReactNode;
}

/**
 * Inline status message.
 *
 * @param props - Message props.
 * @returns The message element.
 */
export const Message: React.FC<MessageProps> = ({ tone, children }) => (
  <p
    role={tone === 'error' ? 'alert' : 'status'}
    className={cn(
      'text-sm rounded-lg px-3 py-2',
      tone === 'info' && 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-white/60',
      tone === 'error' && 'bg-red-500/10 text-red-600 dark:text-red-400',
      tone === 'success' && 'bg-green-500/10 text-green-700 dark:text-green-400',
    )}
  >
    {children}
  </p>
);
