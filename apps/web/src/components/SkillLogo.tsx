import { Icon, type IconName } from './Icon';

export const SKILL_LOGO_KEYS = [
  'craft',
  'code',
  'flow',
  'research',
  'design',
  'data',
  'automate',
  'docs',
  'think',
  'agent',
] as const;

export type SkillLogoKey = (typeof SKILL_LOGO_KEYS)[number];

export const SKILL_LOGO_LABELS: Record<SkillLogoKey, { zh: string; en: string }> = {
  craft: { zh: '构建', en: 'Craft' },
  code: { zh: '代码', en: 'Code' },
  flow: { zh: '流程', en: 'Flow' },
  research: { zh: '研究', en: 'Research' },
  design: { zh: '设计', en: 'Design' },
  data: { zh: '数据', en: 'Data' },
  automate: { zh: '自动化', en: 'Automate' },
  docs: { zh: '文档', en: 'Docs' },
  think: { zh: '思考', en: 'Think' },
  agent: { zh: '智能体', en: 'Agent' },
};

const SKILL_LOGO_META: Record<SkillLogoKey, { icon: IconName; bg: string; fg: string }> = {
  craft: { icon: 'hammer', bg: '#FFF0E8', fg: '#C75D2C' },
  code: { icon: 'file-code', bg: '#EAF0FF', fg: '#3D5DCE' },
  flow: { icon: 'fork', bg: '#E9F7F1', fg: '#258265' },
  research: { icon: 'search', bg: '#FFF5D9', fg: '#A56D00' },
  design: { icon: 'palette', bg: '#F5EAFF', fg: '#8150B9' },
  data: { icon: 'bar-chart-box', bg: '#E8F5FF', fg: '#2778A9' },
  automate: { icon: 'sparkles', bg: '#FFEAF2', fg: '#B94870' },
  docs: { icon: 'file-text', bg: '#EEF0F3', fg: '#586574' },
  think: { icon: 'brain', bg: '#EFEAFF', fg: '#6650B6' },
  agent: { icon: 'robot', bg: '#E7F6F6', fg: '#227C7A' },
};

export function isSkillLogoKey(value: unknown): value is SkillLogoKey {
  return typeof value === 'string' && (SKILL_LOGO_KEYS as readonly string[]).includes(value);
}

export function SkillLogo({
  logoKey,
  size = 48,
  className,
}: {
  logoKey: SkillLogoKey;
  size?: number;
  className?: string;
}) {
  const meta = SKILL_LOGO_META[logoKey];
  return (
    <span
      className={className}
      aria-hidden
      style={{
        width: size,
        height: size,
        flex: '0 0 auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        borderRadius: Math.max(8, Math.round(size * 0.22)),
        background: meta.bg,
        color: meta.fg,
        border: '1px solid rgba(0, 0, 0, 0.05)',
      }}
    >
      <Icon name={meta.icon} size={Math.round(size * 0.5)} />
    </span>
  );
}
