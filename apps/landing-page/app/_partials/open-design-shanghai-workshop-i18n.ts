import en from './open-design-shanghai-workshop-main.html?raw';
import zh from './open-design-shanghai-workshop-main.zh.html?raw';
import ja from './open-design-shanghai-workshop-main.ja.html?raw';
import ko from './open-design-shanghai-workshop-main.ko.html?raw';
import de from './open-design-shanghai-workshop-main.de.html?raw';
import fr from './open-design-shanghai-workshop-main.fr.html?raw';
import ru from './open-design-shanghai-workshop-main.ru.html?raw';
import es from './open-design-shanghai-workshop-main.es.html?raw';
import ptbr from './open-design-shanghai-workshop-main.pt-br.html?raw';
import it from './open-design-shanghai-workshop-main.it.html?raw';
import tr from './open-design-shanghai-workshop-main.tr.html?raw';

export const EVENT_BODY: Record<string, string> = { en, zh, ja, ko, de, fr, ru, es, 'pt-br': ptbr, it, tr };

export interface EventMeta { title: string; description: string }
export const EVENT_META: Record<string, EventMeta> = {
  en: { title: 'HiDesign Shanghai Workshop Recap', description: 'A hands-on HiDesign workshop in Shanghai where developers, designers, product managers, students, and creators turned their own ideas into editable artifacts.' },
  zh: { title: 'HiDesign 上海工作坊回顾', description: '一场在上海举办的 HiDesign 动手工作坊：开发者、设计师、产品经理、学生与创作者，把自己的想法变成可编辑的作品。' },
  ja: { title: 'HiDesign 上海ワークショップ レポート', description: '上海で行われた HiDesign の実践型ワークショップ。開発者、デザイナー、プロダクトマネージャー、学生、クリエイターが自分のアイデアを編集可能な成果物にしました。' },
  ko: { title: 'HiDesign 상하이 워크숍 후기', description: '상하이에서 열린 HiDesign 실습 워크숍에서 개발자, 디자이너, 프로덕트 매니저, 학생과 크리에이터가 자신의 아이디어를 편집 가능한 결과물로 만들었습니다.' },
  de: { title: 'Rückblick auf den HiDesign-Workshop in Shanghai', description: 'Ein praxisnaher HiDesign-Workshop in Shanghai, bei dem Entwickler, Designer, Produktmanager, Studierende und Kreative ihre Ideen in bearbeitbare Ergebnisse verwandelten.' },
  fr: { title: 'Retour sur l’atelier HiDesign à Shanghai', description: 'Un atelier pratique HiDesign à Shanghai où développeurs, designers, product managers, étudiants et créateurs ont transformé leurs idées en réalisations modifiables.' },
  ru: { title: 'Итоги воркшопа HiDesign в Шанхае', description: 'Практический воркшоп HiDesign в Шанхае, где разработчики, дизайнеры, продакт-менеджеры, студенты и авторы превратили свои идеи в редактируемые материалы.' },
  es: { title: 'Resumen del taller HiDesign de Shanghái', description: 'Un taller práctico de HiDesign en Shanghái donde desarrolladores, diseñadores, product managers, estudiantes y creadores convirtieron sus ideas en piezas editables.' },
  'pt-br': { title: 'Retrospectiva do workshop HiDesign em Xangai', description: 'Um workshop prático do HiDesign em Xangai, no qual desenvolvedores, designers, product managers, estudantes e criadores transformaram ideias em materiais editáveis.' },
  it: { title: 'Riepilogo del workshop HiDesign di Shanghai', description: 'Un workshop pratico di HiDesign a Shanghai, dove sviluppatori, designer, product manager, studenti e creator hanno trasformato le proprie idee in risultati modificabili.' },
  tr: { title: 'HiDesign Şanghay Atölyesi Özeti', description: "Şanghay'daki uygulamalı HiDesign atölyesinde geliştiriciler, tasarımcılar, ürün yöneticileri, öğrenciler ve üreticiler fikirlerini düzenlenebilir çalışmalara dönüştürdü." },
};
