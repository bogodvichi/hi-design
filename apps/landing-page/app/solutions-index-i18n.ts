/*
 * Copy for the `/solutions/` index (overview) page — the hub that links to
 * every Solution sub-page (Use cases + Roles). Only the page's own chrome
 * lives here (label / heading / lead); each card's text is pulled from that
 * sub-page's own `getSolutionPageCopy` breadcrumb + description, and the two
 * group headings reuse the header nav labels (`nav.useCases` / `nav.roles`),
 * so there is a single source of truth per string.
 *
 * Keyed by every `LandingLocaleCode`; the `Record` type makes a missing
 * locale a typecheck error, matching the 18-locale guarantee the rest of the
 * landing i18n relies on.
 */
import type { LandingLocaleCode } from './i18n';

export interface SolutionsIndexCopy {
  /** Small kicker label above the H1. */
  label: string;
  /** Page H1. */
  heading: string;
  /** One-sentence intro under the H1. */
  lead: string;
}

const COPY: Record<LandingLocaleCode, SolutionsIndexCopy> = {
  en: {
    label: 'SOLUTION',
    heading: 'HiDesign solutions',
    lead: "Find the right way to use HiDesign — by what you're making, and by the role you play.",
  },
  zh: {
    label: '解决方案',
    heading: 'HiDesign 解决方案',
    lead: '找到最适合你的 HiDesign 使用方式——既可按你要构建的内容（使用场景）查找，也可按你的角色查找。',
  },
  'zh-tw': {
    label: '解決方案',
    heading: 'HiDesign 解決方案',
    lead: '依你要打造的內容、依你扮演的角色，找到最適合運用 HiDesign 的方式。',
  },
  ja: {
    label: 'ソリューション',
    heading: 'HiDesign のソリューション',
    lead: '作りたいもの（ユースケース）と、あなたの役割の両方から、HiDesign を活用する最適な方法を見つけましょう。',
  },
  ko: {
    label: '솔루션',
    heading: 'HiDesign 솔루션',
    lead: '만들려는 것과 맡은 역할에 따라 정리된, HiDesign를 활용하는 가장 알맞은 방법을 찾아보세요.',
  },
  de: {
    label: 'Lösung',
    heading: 'HiDesign Lösungen',
    lead: 'Finden Sie den passenden Weg, HiDesign zu nutzen – sortiert danach, was Sie entwickeln, und nach Ihrer Rolle.',
  },
  fr: {
    label: 'SOLUTION',
    heading: 'Solutions HiDesign',
    lead: "Trouvez la meilleure façon d'utiliser HiDesign — selon ce que vous créez et selon votre rôle.",
  },
  ru: {
    label: 'Решение',
    heading: 'Решения HiDesign',
    lead: 'Найдите подходящий способ использовать HiDesign — по тому, что вы создаёте, и по вашей роли.',
  },
  es: {
    label: 'SOLUCIÓN',
    heading: 'Soluciones de HiDesign',
    lead: 'Encuentra la mejor manera de usar HiDesign: según lo que estás creando y según tu rol.',
  },
  'pt-br': {
    label: 'Solução',
    heading: 'Soluções do HiDesign',
    lead: 'Encontre a maneira certa de usar o HiDesign — pelo que você está criando e pela função que você desempenha.',
  },
  it: {
    label: 'Soluzione',
    heading: 'Le soluzioni di HiDesign',
    lead: 'Trova il modo giusto di usare HiDesign, organizzato in base a ciò che stai creando e al ruolo che ricopri.',
  },
  vi: {
    label: 'Giải pháp',
    heading: 'Giải pháp HiDesign',
    lead: 'Tìm cách phù hợp để sử dụng HiDesign — theo những gì bạn đang xây dựng, và theo vai trò của bạn.',
  },
  pl: {
    label: 'Rozwiązanie',
    heading: 'Rozwiązania HiDesign',
    lead: 'Znajdź właściwy sposób korzystania z HiDesign — według tego, co tworzysz, i według roli, jaką pełnisz.',
  },
  id: {
    label: 'Solusi',
    heading: 'Solusi HiDesign',
    lead: 'Temukan cara yang tepat untuk menggunakan HiDesign — berdasarkan apa yang Anda buat, dan berdasarkan peran yang Anda jalankan.',
  },
  nl: {
    label: 'OPLOSSING',
    heading: 'HiDesign-oplossingen',
    lead: 'Vind de juiste manier om HiDesign te gebruiken — op basis van wat je maakt en van de rol die je vervult.',
  },
  ar: {
    label: 'حل',
    heading: 'حلول HiDesign',
    lead: 'اعثر على الطريقة المناسبة لاستخدام HiDesign — حسب ما تبنيه، وحسب الدور الذي تؤديه.',
  },
  tr: {
    label: 'Çözüm',
    heading: 'HiDesign çözümleri',
    lead: "HiDesign'ı kullanmanın doğru yolunu bulun — ne ürettiğinize ve hangi rolü üstlendiğinize göre.",
  },
  uk: {
    label: 'Рішення',
    heading: 'Рішення HiDesign',
    lead: 'Знайдіть свій спосіб використання HiDesign — за тим, що ви створюєте, і за вашою роллю.',
  },
};

export function getSolutionsIndexCopy(locale: LandingLocaleCode): SolutionsIndexCopy {
  return COPY[locale] ?? COPY.en;
}
