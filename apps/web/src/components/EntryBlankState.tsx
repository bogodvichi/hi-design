import { Icon } from './Icon';

interface Props {
  heading: string;
  description: string;
  actionLabel: string;
  onCreate: () => void;
}

/**
 * The finalized HiDesign connected-node mark. Keeping the artwork as SVG
 * preserves its exact geometry and clean double outline at both empty-state
 * sizes while the shared component keeps every existing display condition.
 */
export function BlankMark() {
  return (
    <img
      className="entry-blank__mark"
      src="/hidesign-empty-mark.svg"
      width="168"
      height="168"
      alt=""
      aria-hidden
      draggable={false}
    />
  );
}

export function EntryBlankState({
  heading,
  description,
  actionLabel,
  onCreate,
}: Props) {
  return (
    <div className="entry-section">
      <header className="entry-section__head">
        <h1 className="entry-section__title">{heading}</h1>
      </header>
      <div className="entry-blank">
        <BlankMark />
        <p className="entry-blank__desc">{description}</p>
        <button type="button" className="entry-blank__cta" onClick={onCreate}>
          <Icon name="plus" size={15} /> {actionLabel}
        </button>
      </div>
    </div>
  );
}
