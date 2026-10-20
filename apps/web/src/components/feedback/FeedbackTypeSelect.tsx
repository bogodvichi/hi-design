import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon';
import styles from './FeedbackTypeSelect.module.css';

export interface FeedbackTypeOption {
  value: string;
  label: string;
}

interface FeedbackTypeSelectProps {
  id: string;
  value: string;
  options: FeedbackTypeOption[];
  loading: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/** Feedback type picker aligned with the invite-members PersonPicker. */
export function FeedbackTypeSelect({
  id,
  value,
  options,
  loading,
  disabled = false,
  onChange,
}: FeedbackTypeSelectProps) {
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedLabel = options.find((option) => option.value === value)?.label;

  function updateMenuPosition() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setMenuPosition({ top: rect.bottom + 2, left: rect.left, width: rect.width });
  }

  function openMenu() {
    if (loading || disabled || !options.length) return;
    setActiveIndex(selectedIndex);
    setOpen(true);
  }

  function selectOption(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }
    updateMenuPosition();
    const frame = window.requestAnimationFrame(() => menuRef.current?.focus());
    const handleViewportChange = () => updateMenuPosition();
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        disabled={disabled || loading}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <span className={loading ? styles.loadingLabel : styles.triggerLabel}>
          {loading ? '加载中…' : selectedLabel || '请选择反馈类型'}
        </span>
        {loading ? (
          <span className={styles.spinner} aria-hidden />
        ) : (
          <Icon name="chevron-down" size={16} aria-hidden />
        )}
      </button>

      {open && menuPosition && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              id={listboxId}
              className={styles.menu}
              role="listbox"
              aria-label="反馈类型"
              tabIndex={-1}
              style={menuPosition}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActiveIndex((index) => Math.min(index + 1, options.length - 1));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveIndex((index) => Math.max(index - 1, 0));
                } else if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  selectOption(activeIndex);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setOpen(false);
                  triggerRef.current?.focus();
                }
              }}
            >
              {options.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={`${styles.option}${index === activeIndex ? ` ${styles.optionActive}` : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOption(index)}
                >
                  <span>{option.label}</span>
                  {option.value === value ? <Icon name="check" size={16} aria-hidden /> : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
