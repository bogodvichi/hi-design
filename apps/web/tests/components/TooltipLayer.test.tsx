// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TooltipLayer } from '../../src/components/TooltipLayer';

afterEach(() => cleanup());

describe('TooltipLayer', () => {
  it('dismisses a hovered icon tooltip when the icon is activated', () => {
    render(
      <>
        <button
          type="button"
          className="od-tooltip"
          data-tooltip="Settings"
          title="Settings"
        >
          Settings
        </button>
        <TooltipLayer />
      </>,
    );

    const button = screen.getByRole('button', { name: 'Settings' });
    fireEvent.pointerOver(button);

    expect(screen.getByRole('tooltip').textContent).toBe('Settings');

    fireEvent.pointerDown(button);
    fireEvent.focusIn(button);

    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('dismisses a tooltip when the trigger expands under the pointer', async () => {
    function ExpandingTrigger() {
      const [open, setOpen] = useState(false);
      return (
        <button
          type="button"
          className="od-tooltip"
          data-tooltip="Design Agent mode"
          title="Design Agent mode"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          Design Agent
        </button>
      );
    }

    render(
      <>
        <ExpandingTrigger />
        <TooltipLayer />
      </>,
    );

    const button = screen.getByRole('button', { name: 'Design Agent' });
    fireEvent.pointerOver(button);
    expect(screen.getByRole('tooltip').textContent).toBe('Design Agent mode');

    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).toBeNull();
    });
  });

  it('aligns a start-aligned tooltip with the trigger left edge', async () => {
    render(
      <>
        <button
          type="button"
          className="od-tooltip"
          data-tooltip="A complete project name"
          data-tooltip-placement="bottom"
          data-tooltip-align="start"
        >
          Project
        </button>
        <TooltipLayer />
      </>,
    );

    const button = screen.getByRole('button', { name: 'Project' });
    button.getBoundingClientRect = () => ({
      x: 120,
      y: 20,
      left: 120,
      right: 240,
      top: 20,
      bottom: 52,
      width: 120,
      height: 32,
      toJSON: () => ({}),
    });

    fireEvent.pointerOver(button);

    const tooltip = screen.getByRole('tooltip');
    tooltip.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      right: 200,
      top: 0,
      bottom: 24,
      width: 200,
      height: 24,
      toJSON: () => ({}),
    });
    fireEvent(window, new Event('resize'));

    await waitFor(() => {
      expect(tooltip.style.transform).toBe('translate3d(120px, 59px, 0)');
    });
  });
});
