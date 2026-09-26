import { useMemo } from 'react';
import { useAuth } from '../auth/LoginGate';

interface UserAvatarIconProps {
  size?: number;
}

// 预定义的深色背景色板（确保对比度足够，白色文字可读）
const DARK_COLORS = [
  '#1e3a5f', // 深海蓝 - 沉稳专业
  '#0f766e', // 深青绿 - 自然清新
  '#5b21b6', // 深紫 - 优雅神秘
  '#991b1b', // 深红 - 热情有力
  '#9a3412', // 深橙 - 温暖稳重
  '#14532d', // 深绿 - 生机
  '#86198f', // 深玫红 - 时尚
  '#1e40af', // 宝石蓝 - 深邃
  '#115e59', // 深teal - 现代
  '#701a75', // 深紫红 - 独特
];

function getColorFromDisplayName(displayName: string) {
  let hash = 0;
  for (let i = 0; i < displayName.length; i++) {
    hash = displayName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % DARK_COLORS.length;
  return DARK_COLORS[index];
}

function getInitial(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0).toUpperCase();
}

/**
 * 用户头像图标组件
 * 显示用户名首字母大写，圆形，随机深色背景，白色文字
 */
export function UserAvatarIcon({ size = 24 }: UserAvatarIconProps) {
  const { userInfo } = useAuth();
  const displayName = userInfo?.displayName;

  const { initial, bgColor } = useMemo(() => {
    if (!displayName) {
      return { initial: '?', bgColor: '#37474f' };
    }
    return {
      initial: getInitial(displayName),
      bgColor: 'rgb(51, 111, 255)',
    };
  }, [displayName]);

  return (
    <div
      className="user-avatar-icon"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: bgColor,
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: `${size * 0.5}px`,
        fontWeight: 600,
        lineHeight: 1,
        userSelect: 'none',
        flexShrink: 0,
      }}
      aria-label={`用户 ${displayName || '未知'}`}
      title={displayName || '未知用户'}
    >
      {initial}
    </div>
  );
}
