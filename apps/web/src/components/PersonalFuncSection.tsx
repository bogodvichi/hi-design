import { Icon, type IconName } from './Icon';
import { navigate, useRoute } from '../router';
import { useT } from '../i18n';
import type { Dict } from '../i18n/types';

interface PersonalItem {
  id: 'personal-all' | 'shared-with-me';
  icon: IconName;
  labelKey: keyof Dict;
}

const ITEMS: PersonalItem[] = [
  { id: 'personal-all', icon: 'file', labelKey: 'personalFunc.all' },
  { id: 'shared-with-me', icon: 'share', labelKey: 'personalFunc.shared' },
];

export function PersonalFuncSection() {
  const t = useT();
  const route = useRoute();
  const activeView = route.kind === 'home' ? route.view : null;

  return (
    <div data-testid="personal-func-section" className="entry-nav-rail__team-section">
      {ITEMS.map((item) => {
        const isActive = activeView === item.id
          || (item.id === 'personal-all' && activeView === 'personal-folder');
        return (
          <button
            key={item.id}
            type="button"
            className={`entry-nav-rail__btn${isActive ? ' is-active' : ''}`}
            onClick={() => navigate({ kind: 'home', view: item.id })}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="entry-nav-rail__btn-icon" aria-hidden>
              <Icon name={item.icon} size={18} />
            </span>
            <span className="entry-nav-rail__btn-label">{t(item.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
