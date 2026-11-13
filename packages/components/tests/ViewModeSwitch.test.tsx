// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ViewModeSwitch } from '../src/view-mode-switch';

const options = [
  { value: 'preview', label: 'Preview', icon: <svg data-testid="preview-icon" /> },
  { value: 'code', label: 'Code', icon: <svg /> },
  { value: 'split', label: 'Split', icon: <svg /> },
] as const;
afterEach(cleanup);

it('uses controlled tab selection and renders the caller icons', () => {
  const onChange = vi.fn();
  const { rerender } = render(<ViewModeSwitch label="View mode" value="preview" options={options} onChange={onChange} />);
  expect(screen.getByRole('tablist', { name: 'View mode' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Preview' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByTestId('preview-icon')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
  expect(onChange).toHaveBeenCalledWith('code');
  expect(screen.getByRole('tab', { name: 'Code' }).getAttribute('aria-selected')).toBe('false');
  rerender(<ViewModeSwitch label="View mode" value="code" options={options} onChange={onChange} />);
  expect(screen.getByRole('tab', { name: 'Code' }).getAttribute('aria-selected')).toBe('true');
});

it('moves focus and selection with arrows and Home/End, skipping disabled modes', () => {
  function Example() {
    const [value, setValue] = useState('preview');
    return <ViewModeSwitch label="View mode" value={value} onChange={setValue}
      options={options.map(option => ({ ...option, disabled: option.value === 'code' }))} />;
  }
  render(<Example />);
  const preview = screen.getByRole('tab', { name: 'Preview' });
  const split = screen.getByRole('tab', { name: 'Split' });
  fireEvent.keyDown(preview, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(split);
  expect(split.getAttribute('aria-selected')).toBe('true');
  expect(split.tabIndex).toBe(0);
  expect(preview.tabIndex).toBe(-1);
  fireEvent.keyDown(split, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(preview);
  fireEvent.keyDown(preview, { key: 'End' });
  expect(document.activeElement).toBe(split);
  fireEvent.keyDown(split, { key: 'Home' });
  expect(document.activeElement).toBe(preview);
  fireEvent.keyDown(preview, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(split);
});

it('does not select disabled modes and retains an enabled tab stop', () => {
  const onChange = vi.fn();
  render(<ViewModeSwitch label="View mode" value="code" onChange={onChange}
    options={options.map(option => ({ ...option, disabled: option.value === 'code' }))} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('tab', { name: 'Preview' }).tabIndex).toBe(0);
});
