import type { Locale } from '../i18n';

export interface GoPlanCampaignCopy {
  eyebrow: string;
  headline: string;
  description: string;
  benefit: string;
  status: string;
  cta: string;
  renewal: string;
  boundary: string;
  newBadge: string;
  closeAria: string;
  providersAria: string;
  workbenchBadge: string;
  workbenchBadgeAria: string;
}

const english: GoPlanCampaignCopy = {
  eyebrow: 'NEW PLAN · LAUNCH OFFER',
  headline: 'Low-cost design plan for everyone',
  description: 'Professional design intelligence at a lower cost—so every idea moves faster from prompt to finished work.',
  benefit: 'Go first month $5 · unlimited use',
  status: 'UNLIMITED',
  cta: 'View Go plan · Limited-time 50% off',
  renewal: 'Then $10 / month',
  boundary: 'Allowance details and offer terms are shown on Pricing.',
  newBadge: 'NEW',
  closeAria: 'Close dialog',
  providersAria: 'Model providers available on Go',
  workbenchBadge: 'The new Go Plan · ¥5 for the first month · Unlimited model usage',
  workbenchBadgeAria: 'The new Go Plan, ¥5 for the first month, unlimited model usage — view Pricing',
};

const localized: Record<Locale, GoPlanCampaignCopy> = {
  en: english,
  'zh-CN': {
    eyebrow: '全新套餐 · 首发特惠',
    headline: '人人可用的低成本设计方案',
    description: '以更低成本使用专业设计模型，让每一个想法更快成为作品。',
    benefit: 'Go 首月 $5 · 无限用',
    status: '无限使用',
    cta: '查看 Go 套餐 · 限时 5 折',
    renewal: '之后 $10 / 月',
    boundary: '具体额度与活动规则以 Pricing 页面为准。',
    newBadge: 'NEW',
    closeAria: '关闭弹窗',
    providersAria: 'Go 套餐可用模型厂商',
    workbenchBadge: '全新 Go 套餐 · 首月 ¥5 · 模型无限用',
    workbenchBadgeAria: '全新 Go 套餐，首月 ¥5，模型无限用，查看 Pricing',
  },
};

export function getGoPlanCampaignCopy(locale: Locale): GoPlanCampaignCopy {
  return localized[locale];
}
