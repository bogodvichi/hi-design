import styles from './TeamSpaceView.module.css';

export function FolderSelectionCheck({ selected }: { selected: boolean }) {
  return (
    <span
      className={`${styles.folderSelectCheck}${selected ? ` ${styles.folderSelectCheckSelected}` : ''}`}
      aria-hidden="true"
    >
      {selected ? (
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M9.9997 15.1709L19.1921 5.97852L20.6063 7.39273L9.9997 17.9993L3.63574 11.6354L5.04996 10.2212L9.9997 15.1709Z" />
        </svg>
      ) : null}
    </span>
  );
}
