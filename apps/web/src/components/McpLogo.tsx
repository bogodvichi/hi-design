export const MCP_LOGO_KEYS = [
  'orbit',
  'nodes',
  'prism',
  'pulse',
  'weave',
  'cube',
  'bridge',
  'spark',
  'compass',
  'stack',
] as const;

export type McpLogoKey = (typeof MCP_LOGO_KEYS)[number];

export const MCP_LOGO_LABELS: Record<McpLogoKey, { zh: string; en: string }> = {
  orbit: { zh: '轨道', en: 'Orbit' },
  nodes: { zh: '节点', en: 'Nodes' },
  prism: { zh: '棱镜', en: 'Prism' },
  pulse: { zh: '脉冲', en: 'Pulse' },
  weave: { zh: '连接', en: 'Weave' },
  cube: { zh: '立方', en: 'Cube' },
  bridge: { zh: '桥接', en: 'Bridge' },
  spark: { zh: '星火', en: 'Spark' },
  compass: { zh: '罗盘', en: 'Compass' },
  stack: { zh: '堆栈', en: 'Stack' },
};

const LOGO_COLORS: Record<McpLogoKey, string> = {
  orbit: '#5B6CFF',
  nodes: '#2F7CF6',
  prism: '#7659F6',
  pulse: '#18A47A',
  weave: '#1687A7',
  cube: '#5367C7',
  bridge: '#DB6B45',
  spark: '#B45BD6',
  compass: '#2777A8',
  stack: '#61708A',
};

export function isMcpLogoKey(value: unknown): value is McpLogoKey {
  return typeof value === 'string' && (MCP_LOGO_KEYS as readonly string[]).includes(value);
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

export function resolveMcpLogoKey(value?: string | null, seed = ''): McpLogoKey {
  if (isMcpLogoKey(value)) return value;
  if (!seed) return 'orbit';
  return MCP_LOGO_KEYS[hashSeed(seed) % MCP_LOGO_KEYS.length]!;
}

function LogoGlyph({ logoKey }: { logoKey: McpLogoKey }) {
  switch (logoKey) {
    case 'orbit':
      return (
        <>
          <circle cx="24" cy="24" r="5" fill="white" />
          <ellipse cx="24" cy="24" rx="14" ry="7.5" fill="none" stroke="white" strokeWidth="2.4" transform="rotate(-24 24 24)" />
          <circle cx="34.5" cy="16.5" r="2.4" fill="white" />
        </>
      );
    case 'nodes':
      return (
        <>
          <path d="M16 17.5 24 24l8-7M24 24v9" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="15" cy="16" r="4" fill="white" />
          <circle cx="33" cy="16" r="4" fill="white" />
          <circle cx="24" cy="34" r="4" fill="white" />
        </>
      );
    case 'prism':
      return (
        <>
          <path d="m24 11 13 24H11L24 11Z" fill="none" stroke="white" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="m17.5 28 6.5-11 6.5 11h-13Z" fill="white" opacity=".95" />
        </>
      );
    case 'pulse':
      return (
        <path d="M10 25h7l3.5-9 6 17 4-12 2.5 4H38" fill="none" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      );
    case 'weave':
      return (
        <>
          <path d="M13 16c7 0 7 16 14 16 4.5 0 6.5-3.4 8-6" fill="none" stroke="white" strokeWidth="2.8" strokeLinecap="round" />
          <path d="M13 32c7 0 7-16 14-16 4.5 0 6.5 3.4 8 6" fill="none" stroke="white" strokeWidth="2.8" strokeLinecap="round" />
        </>
      );
    case 'cube':
      return (
        <>
          <path d="m24 11 12 7v13l-12 7-12-7V18l12-7Z" fill="none" stroke="white" strokeWidth="2.4" strokeLinejoin="round" />
          <path d="m12.5 18.5 11.5 7 11.5-7M24 25.5V38" fill="none" stroke="white" strokeWidth="2.4" strokeLinejoin="round" />
        </>
      );
    case 'bridge':
      return (
        <>
          <circle cx="15" cy="24" r="5" fill="none" stroke="white" strokeWidth="2.6" />
          <circle cx="33" cy="24" r="5" fill="none" stroke="white" strokeWidth="2.6" />
          <path d="M20 24h8" stroke="white" strokeWidth="3" strokeLinecap="round" />
        </>
      );
    case 'spark':
      return (
        <>
          <path d="m24 10 3.2 10.8L38 24l-10.8 3.2L24 38l-3.2-10.8L10 24l10.8-3.2L24 10Z" fill="white" />
          <circle cx="35.5" cy="13.5" r="2.2" fill="white" opacity=".75" />
        </>
      );
    case 'compass':
      return (
        <>
          <circle cx="24" cy="24" r="13" fill="none" stroke="white" strokeWidth="2.4" />
          <path d="m29.5 17.5-3.4 8.6-8.6 3.4 3.4-8.6 8.6-3.4Z" fill="white" />
        </>
      );
    case 'stack':
      return (
        <>
          <path d="m24 12 13 6-13 6-13-6 13-6Z" fill="white" />
          <path d="m13 24 11 5 11-5M13 30l11 5 11-5" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity=".9" />
        </>
      );
  }
}

export function McpLogo({
  logoKey,
  size = 48,
  className,
}: {
  logoKey: McpLogoKey;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden
      focusable="false"
    >
      <rect width="48" height="48" rx="12" fill={LOGO_COLORS[logoKey]} />
      <circle cx="38" cy="10" r="9" fill="white" opacity=".08" />
      <LogoGlyph logoKey={logoKey} />
    </svg>
  );
}
