// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewBrandModal } from '../../src/components/NewBrandModal';

const { run, reset } = vi.hoisted(() => ({ run: vi.fn(), reset: vi.fn() }));

vi.mock('../../src/runtime/useBrandExtract', () => ({
  useBrandExtract: () => ({ state: { phase: 'idle' }, run, reset }),
}));
vi.mock('../../src/collab/useWorkspaceContext', () => ({
  useWorkspaceContext: () => ({ context: null }),
}));
vi.mock('../../src/components/BrandReferencePicker', () => ({
  BrandReferencePicker: () => <input type="search" aria-label="Search brands" />,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('NewBrandModal form association', () => {
  it('submits the URL from the fixed footer while keeping brand search outside that form', () => {
    render(<NewBrandModal open onClose={vi.fn()} onCreated={vi.fn()} />);
    const url = screen.getByTestId('new-brand-url') as HTMLInputElement;
    const extract = screen.getByTestId('new-brand-extract') as HTMLButtonElement;
    const search = screen.getByRole('searchbox', { name: 'Search brands' }) as HTMLInputElement;
    expect(url.form).not.toBeNull();
    expect(extract.form).toBe(url.form);
    expect(search.form).toBeNull();
    fireEvent.change(url, { target: { value: 'https://example.com' } });
    fireEvent.click(extract);
    expect(run).toHaveBeenCalledWith('https://example.com', { workspaceContext: null });
  });
});
