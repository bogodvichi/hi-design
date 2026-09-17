/*
 * `/codex-plugin/` — localized product-page copy.
 *
 * English is the authoritative source. Every active non-English landing
 * locale provides a complete, structurally identical copy object in
 * `open-design-plugin-locales/`; product names, URLs, command lines, prompts,
 * asset paths and numeric facts remain in the page component.
 */
import type { LandingLocaleCode } from './i18n';
import { OPEN_DESIGN_PLUGIN_TRANSLATIONS } from './open-design-plugin-locales';

type StepCopy = {
  phase: string;
  title: string;
  body: string;
  alt: string;
};

type PromptExampleCopy = {
  title: string;
};

type TemplateExampleCopy = {
  alt: string;
  label: string;
};

type FaqCopy = {
  q: string;
  a: string;
};

export type OpenDesignPluginCopy = {
  metadata: {
    title: string;
    description: string;
    keywords: string;
  };
  hero: {
    title: string;
    leadBefore: string;
    chatgptLabel: string;
    installAria: string;
    copy: string;
    github: string;
  };
  demo: {
    title: string;
    lead: string;
    overviewAlt: string;
    overviewLabel: string;
    overviewCaption: string;
    stepListAria: string;
    installPhase: string;
    installTitle: string;
    installBody: string;
    installNote: string;
    steps: [StepCopy, StepCopy, StepCopy, StepCopy];
  };
  use: {
    title: string;
    lead: string;
    promptLabel: string;
    copyPrompt: string;
    galleryAria: string;
    templates: [
      TemplateExampleCopy,
      TemplateExampleCopy,
      TemplateExampleCopy,
      TemplateExampleCopy,
    ];
    promptListAria: string;
    prompts: [
      PromptExampleCopy,
      PromptExampleCopy,
      PromptExampleCopy,
      PromptExampleCopy,
    ];
  };
  faq: {
    title: string;
    lead: string;
    items: [FaqCopy, FaqCopy, FaqCopy, FaqCopy, FaqCopy];
  };
  final: {
    aria: string;
    title: string;
    bodyBeforeMention: string;
    bodyAfterMention: string;
    copy: string;
    download: string;
    source: string;
  };
  clipboard: {
    copying: string;
    copied: string;
    failed: string;
  };
  schema: {
    pageName: string;
    applicationName: string;
  };
};

export const OPEN_DESIGN_PLUGIN_EN: OpenDesignPluginCopy = {
  metadata: {
    title: 'HiDesign for Codex/ChatGPT | Install the HiDesign Cloud Plugin',
    description:
      'Install HiDesign Cloud in Codex/ChatGPT and create websites, slides, prototypes and design systems from the same task.',
    keywords:
      'HiDesign Codex plugin, ChatGPT desktop plugin, Codex plugin install, HiDesign Cloud, Codex design plugin, Codex MCP',
  },
  hero: {
    title: 'HiDesign plugin for Codex/ChatGPT',
    leadBefore: 'Enter the instruction below into any task in your',
    chatgptLabel: 'ChatGPT desktop app',
    installAria: 'Install HiDesign Cloud in Codex/ChatGPT',
    copy: 'Copy',
    github: 'View installation guide on GitHub ↗',
  },
  demo: {
    title: 'Install once. Create from Codex/ChatGPT.',
    lead:
      'See the complete Codex and HiDesign workspace first, then follow the real install-to-result sequence.',
    overviewAlt:
      'A real Codex task using the HiDesign plugin alongside the finished Goodfield cafe website',
    overviewLabel: 'Real Codex task',
    overviewCaption:
      'The prompt, HiDesign handoff, generated files and finished website stay visible in one workspace.',
    stepListAria: 'The five stages in the real Codex plugin run',
    installPhase: 'Install',
    installTitle: 'Ask Codex to install it',
    installBody:
      'Paste this instruction into a Codex task. Codex adds the canonical Git marketplace source, installs the plugin only if it is missing and completes the local MCP setup without requiring a public catalog listing.',
    installNote: 'Paste into Codex once—the installation details are handled for you.',
    steps: [
      {
        phase: 'Use',
        title: 'Start a fresh Codex task',
        body:
          'After Codex finishes the installation, open the installed HiDesign plugin in the new task and choose “Try now” to begin.',
        alt: 'The real HiDesign plugin detail screen in Codex with a Try now button',
      },
      {
        phase: 'Create',
        title: 'Write the design brief',
        body:
          'Mention HiDesign, then describe the artifact, content, visual direction and responsive requirements.',
        alt: 'A real Codex prompt asking HiDesign to create a warm neighborhood cafe website',
      },
      {
        phase: 'Create',
        title: 'Follow the live handoff',
        body:
          'Codex confirms the direction, creates the project and hands the work into HiDesign while files appear live.',
        alt:
          'A real Codex and HiDesign workspace while the neighborhood cafe website is being generated',
      },
      {
        phase: 'Create',
        title: 'Review the result',
        body:
          'The same task returns the responsive Goodfield café landing page, its generated images and editable files.',
        alt:
          'The finished Goodfield neighborhood cafe landing page generated through the HiDesign plugin in Codex',
      },
    ],
  },
  use: {
    title: 'Start with the exact prompt.',
    lead:
      'Select HiDesign from Codex’s plugin menu, describe the artifact and keep refining from the same task. Codex renders the plugin mention as an HiDesign chip.',
    promptLabel: 'Prompt used in the recorded Codex task',
    copyPrompt: 'Copy Codex prompt',
    galleryAria: 'Examples created with HiDesign',
    templates: [
      {
        alt: 'Oryzo product landing page with a tactile cutting mat and cork object',
        label: 'Product launch',
      },
      {
        alt: 'HiDesign Osaka event landing page with a typographic map',
        label: 'Event page',
      },
      {
        alt: 'Fable 5 dark editorial product website',
        label: 'Editorial site',
      },
      {
        alt: 'HiDesign model timeline interface on a bright canvas',
        label: 'Interactive story',
      },
    ],
    promptListAria: 'HiDesign Cloud prompt examples',
    prompts: [
      { title: 'Website' },
      { title: 'Slides' },
      { title: 'Prototype' },
      { title: 'Design system' },
    ],
  },
  faq: {
    title: 'Questions before you install',
    lead: 'Codex stays in control of the task. HiDesign handles the visual workflow.',
    items: [
      {
        q: 'What does the plugin add to Codex?',
        a:
          'It gives Codex an HiDesign workflow for websites, slides, prototypes and design systems. The plugin connects to the local HiDesign MCP for briefs, projects and artifact generation.',
      },
      {
        q: 'Which Codex products are supported?',
        a:
          'The current package supports Codex Desktop and Codex CLI. Codex is the first supported host.',
      },
      {
        q: 'What do I need before installing?',
        a:
          'Use Codex CLI 0.144.6 or newer and HiDesign 0.17.0 or newer. Install HiDesign before registering its local MCP.',
      },
      {
        q: 'Why do I need a new Codex task?',
        a:
          'Codex loads plugin and MCP capabilities when a task starts. A fresh task picks up the newly installed HiDesign Cloud plugin.',
      },
      {
        q: 'Does the HiDesign window need to stay open?',
        a:
          'No. The registered local MCP can start the signed HiDesign runtime headlessly when it is needed.',
      },
    ],
  },
  final: {
    aria: 'Install HiDesign Cloud in Codex/ChatGPT',
    title: 'Bring HiDesign into your next Codex/ChatGPT task.',
    bodyBeforeMention: 'Install the plugin, connect the local MCP and invoke',
    bodyAfterMention: '.',
    copy: 'Copy',
    download: 'Download HiDesign',
    source: 'View source',
  },
  clipboard: {
    copying: 'Copying…',
    copied: 'Copied',
    failed: 'Select and copy',
  },
  schema: {
    pageName: 'HiDesign Cloud Plugin for Codex/ChatGPT',
    applicationName: 'HiDesign Cloud Plugin for Codex/ChatGPT',
  },
};

export function getHiDesignPluginCopy(locale: LandingLocaleCode): OpenDesignPluginCopy {
  if (locale === 'en') return OPEN_DESIGN_PLUGIN_EN;
  return OPEN_DESIGN_PLUGIN_TRANSLATIONS[locale] ?? OPEN_DESIGN_PLUGIN_EN;
}
