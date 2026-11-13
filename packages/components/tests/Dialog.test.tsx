// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';

import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogToolbar,
} from '../src/dialog';

afterEach(() => {
  cleanup();
});

describe('Dialog', () => {
  it('exposes the scroll body while retaining controls outside it', () => {
    const bodyRef = createRef<HTMLDivElement>();
    render(
      <Dialog layout="scrollable" ariaLabel="Edit resource" includeChromeClassName={false}>
        <DialogHeader><DialogTitle>Edit resource</DialogTitle></DialogHeader>
        <DialogToolbar><button type="button">Change type</button></DialogToolbar>
        <DialogBody ref={bodyRef}><input aria-label="Name" defaultValue="Draft" /></DialogBody>
        <DialogFooter><button type="button">Save</button></DialogFooter>
      </Dialog>,
    );
    expect(bodyRef.current?.contains(screen.getByRole('textbox', { name: 'Name' }))).toBe(true);
    expect(bodyRef.current?.contains(screen.getByRole('button', { name: 'Change type' }))).toBe(false);
    expect(bodyRef.current?.contains(screen.getByRole('button', { name: 'Save' }))).toBe(false);
    bodyRef.current!.scrollTop = 200;
    bodyRef.current!.scrollTop = 0;
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Draft');
  });

  it('wires labelled dialogs consistently', () => {
    render(
      <Dialog ariaLabelledBy="dialog-title">
        <h2 id="dialog-title">Rename design</h2>
      </Dialog>,
    );

    expect(screen.getByRole('dialog', { name: 'Rename design' })).toBeTruthy();
  });

  it('closes on backdrop click when enabled', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog onClose={onClose}>
        <h2>Backdrop close</h2>
      </Dialog>,
    );

    fireEvent.click(container.querySelector('.modal-backdrop') as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape when enabled', () => {
    const onClose = vi.fn();
    render(
      <Dialog onClose={onClose} closeOnEscape>
        <h2>Escape close</h2>
      </Dialog>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lets custom panels opt out of the shared modal chrome class', () => {
    const { container } = render(
      <Dialog className="plugin-details-modal" includeChromeClassName={false}>
        <h2>Plugin details</h2>
      </Dialog>,
    );

    const panel = container.querySelector('.plugin-details-modal');

    expect(panel).toBeTruthy();
    expect(panel?.classList.contains('plugin-details-modal')).toBe(true);
    expect(panel?.getAttribute('data-dialog-surface')).toBe('standard');
    expect(panel?.classList.contains('modal')).toBe(false);
  });

  it('keeps footer actions associated with a form across the scroll body', () => {
    const onSubmit = vi.fn(event => event.preventDefault());
    render(
      <Dialog as="form" onSubmit={onSubmit} ariaLabel="Create team">
        <DialogHeader><DialogTitle>Create team</DialogTitle></DialogHeader>
        <DialogBody><label>Name<input name="name" required defaultValue="Design" /></label></DialogBody>
        <DialogFooter><button type="submit">Create</button></DialogFooter>
      </Dialog>,
    );
    const save = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    const input = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(save.form).toBe(input.form);
    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('Design');
  });

  it('keeps caller variant sizing overrides ahead of shared dialog defaults', () => {
    const variantStyles = document.createElement('style');
    variantStyles.textContent = '.modal-rename { width: 420px; gap: 14px; }';
    document.head.insertBefore(variantStyles, document.head.firstChild);

    try {
      const { container } = render(
        <Dialog className="modal-rename">
          <h2>Rename design</h2>
        </Dialog>,
      );

      const panel = container.querySelector('.modal-rename') as HTMLElement;
      const panelStyles = getComputedStyle(panel);

      expect(panelStyles.width).toBe('420px');
      expect(panelStyles.gap).toBe('14px');
    } finally {
      variantStyles.remove();
    }
  });

  it('supports sectioned layouts with shared header/body/footer primitives', () => {
    const { container } = render(
      <Dialog layout="sectioned" ariaLabelledBy="dialog-title">
        <DialogHeader>
          <DialogTitle id="dialog-title">Sketch text</DialogTitle>
          <DialogDescription>Add a note to the canvas.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <label>
            <span>Text</span>
            <input type="text" />
          </label>
        </DialogBody>
        <DialogFooter>
          <button type="button">Cancel</button>
          <button type="button">Save</button>
        </DialogFooter>
      </Dialog>,
    );

    expect(screen.getByRole('dialog', { name: 'Sketch text' })).toBeTruthy();
    expect(container.querySelector('[class*="dialogSectioned"]')).toBeTruthy();
    expect(container.querySelector('[class*="header"]')).toBeTruthy();
    expect(container.querySelector('[class*="body"]')).toBeTruthy();
    expect(container.querySelector('[class*="footer"]')).toBeTruthy();
  });
});
