// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VisualChoiceGroup, type VisualChoiceOption } from '../src/visual-choice-group';

const options: VisualChoiceOption<'round' | 'square'>[] = [
  { value: 'round', label: 'Round', visual: <span aria-hidden>●</span> },
  { value: 'square', label: 'Square', visual: <span aria-hidden>■</span> },
];

afterEach(cleanup);

it('renders caller labels and visuals, and reports controlled selection changes', () => {
  const onChange = vi.fn();
  const { rerender } = render(<VisualChoiceGroup label="Shape" options={options} value="round" onChange={onChange} />);
  expect(screen.getByRole('group', { name: 'Shape' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Round' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Square' }));
  expect(onChange).toHaveBeenCalledWith('square');
  expect(screen.getByRole('button', { name: 'Square' }).getAttribute('aria-pressed')).toBe('false');
  rerender(<VisualChoiceGroup label="Shape" options={options} value="square" onChange={onChange} />);
  expect(screen.getByRole('button', { name: 'Square' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('■')).toBeTruthy();
});

it('supports per-option and group disabled semantics', () => {
  const onChange = vi.fn();
  const { rerender } = render(<VisualChoiceGroup label="Shape" options={options.map(option => ({ ...option, disabled: option.value === 'square' }))} value="round" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Square' }));
  expect(onChange).not.toHaveBeenCalled();
  rerender(<VisualChoiceGroup label="Shape" options={options} value="round" onChange={onChange} disabled />);
  expect(screen.getByRole('group', { name: 'Shape' }).matches(':disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Round' }).matches(':disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Square' }).matches(':disabled')).toBe(true);
});
