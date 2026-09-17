/* HiDesign plugin page — complete Japanese localization. */
import type { OpenDesignPluginCopy } from '../open-design-plugin-i18n';

const ja: OpenDesignPluginCopy = {
  metadata: {
    title: 'Codex/ChatGPT 向け HiDesign | HiDesign Cloud プラグインをインストール',
    description:
      'HiDesign Cloud を Codex/ChatGPT にインストールし、同じタスクの中で Web サイト、スライド、プロトタイプ、デザインシステムを制作できます。',
    keywords:
      'HiDesign Codex プラグイン, ChatGPT デスクトッププラグイン, Codex プラグイン インストール, HiDesign Cloud, Codex デザインプラグイン, Codex MCP',
  },
  hero: {
    title: 'Codex/ChatGPT 向け HiDesign プラグイン',
    leadBefore: '以下の指示を、お使いの',
    chatgptLabel: 'ChatGPT デスクトップアプリの任意のタスクに入力してください',
    installAria: 'HiDesign Cloud を Codex/ChatGPT にインストール',
    copy: 'コピー',
    github: 'GitHub でインストールガイドを見る ↗',
  },
  demo: {
    title: '一度インストールすれば、Codex/ChatGPT からそのまま制作。',
    lead:
      'まず Codex と HiDesign のワークスペース全体を確認し、実際のインストールから完成までの流れを順番にたどれます。',
    overviewAlt:
      'HiDesign プラグインを使う実際の Codex タスクと、完成した Goodfield カフェの Web サイト',
    overviewLabel: '実際の Codex タスク',
    overviewCaption:
      'プロンプト、HiDesign への引き継ぎ、生成ファイル、完成した Web サイトを、ひとつのワークスペースで確認できます。',
    stepListAria: '実際の Codex プラグイン実行を構成する 5 つのステップ',
    installPhase: 'インストール',
    installTitle: 'Codex にインストールを頼む',
    installBody:
      'この指示を Codex のタスクに貼り付けます。Codex が正規の Git マーケットプレイスソースを追加し、プラグインが未インストールの場合にのみインストールして、公開カタログへの掲載を必要とせずにローカル MCP の設定を完了します。',
    installNote: 'Codex に一度貼り付けるだけで、インストールの詳細は自動で処理されます。',
    steps: [
      {
        phase: '使う',
        title: '新しい Codex タスクを始める',
        body:
          'インストールが完了したら、新しいタスクでインストール済みの HiDesign プラグインを開き、「Try now」を選んで始めます。',
        alt: '「Try now」ボタンが表示された、Codex の実際の HiDesign プラグイン詳細画面',
      },
      {
        phase: '制作',
        title: 'デザインブリーフを書く',
        body:
          'HiDesign をメンションし、作りたい成果物、必要な内容、ビジュアルの方向性、レスポンシブ対応の要件を伝えます。',
        alt: 'HiDesign に温かみのある街のカフェの Web サイト制作を依頼する、実際の Codex プロンプト',
      },
      {
        phase: '制作',
        title: 'リアルタイムの引き継ぎを確認する',
        body:
          'Codex が方向性を確認してプロジェクトを作成し、HiDesign へ作業を引き継ぎます。生成されたファイルもその場で表示されます。',
        alt:
          '街のカフェの Web サイトを生成中の、実際の Codex と HiDesign のワークスペース',
      },
      {
        phase: '制作',
        title: '完成した成果物を確認する',
        body:
          '同じタスク内に、レスポンシブな Goodfield カフェのランディングページ、生成画像、編集可能なファイルが返ってきます。',
        alt:
          'Codex の HiDesign プラグインで生成された、完成版 Goodfield 街のカフェのランディングページ',
      },
    ],
  },
  use: {
    title: 'そのまま使えるプロンプトから始める。',
    lead:
      'Codex のプラグインメニューから HiDesign を選び、作りたい成果物を説明します。同じタスクの中で、続けて調整を重ねられます。プラグインへのメンションは、Codex 上で HiDesign のチップとして表示されます。',
    promptLabel: '実際の Codex タスクで使用したプロンプト',
    copyPrompt: 'Codex プロンプトをコピー',
    galleryAria: 'HiDesign で制作した事例',
    templates: [
      {
        alt: '手触りのあるカッティングマットとコルクのオブジェを配した Oryzo の商品ランディングページ',
        label: 'プロダクトローンチ',
      },
      {
        alt: 'タイポグラフィで地図を表現した HiDesign Osaka のイベントランディングページ',
        label: 'イベントページ',
      },
      {
        alt: 'ダークトーンのエディトリアルデザインによる Fable 5 のプロダクト Web サイト',
        label: 'エディトリアルサイト',
      },
      {
        alt: '明るいキャンバス上に展開する HiDesign のモデルタイムライン画面',
        label: 'インタラクティブストーリー',
      },
    ],
    promptListAria: 'HiDesign Cloud のプロンプト例',
    prompts: [
      { title: 'Web サイト' },
      { title: 'スライド' },
      { title: 'プロトタイプ' },
      { title: 'デザインシステム' },
    ],
  },
  faq: {
    title: 'インストール前によくある質問',
    lead: 'タスクの進行は Codex が担い、HiDesign がビジュアル制作のワークフローを担当します。',
    items: [
      {
        q: 'このプラグインを入れると、Codex で何ができるようになりますか？',
        a:
          'Web サイト、スライド、プロトタイプ、デザインシステムを作るための HiDesign ワークフローが Codex に加わります。プラグインはローカルの HiDesign MCP に接続し、ブリーフ作成、プロジェクト管理、成果物の生成を行います。',
      },
      {
        q: 'どの Codex 製品に対応していますか？',
        a:
          '現在のパッケージは Codex Desktop と Codex CLI に対応しています。最初に対応するホストは Codex です。',
      },
      {
        q: 'インストール前に何が必要ですか？',
        a:
          'Codex CLI 0.144.6 以降と HiDesign 0.17.0 以降が必要です。ローカル MCP を登録する前に HiDesign をインストールしてください。',
      },
      {
        q: 'なぜ新しい Codex タスクを始める必要がありますか？',
        a:
          'Codex はタスクの開始時にプラグインと MCP の機能を読み込みます。新しいタスクを始めることで、インストールした HiDesign Cloud プラグインが利用できるようになります。',
      },
      {
        q: 'HiDesign のウィンドウは開いたままにする必要がありますか？',
        a:
          'いいえ。登録済みのローカル MCP が必要に応じて、署名済みの HiDesign ランタイムをバックグラウンドで起動できます。',
      },
    ],
  },
  final: {
    aria: 'HiDesign Cloud を Codex/ChatGPT にインストール',
    title: '次の Codex/ChatGPT タスクに HiDesign を。',
    bodyBeforeMention: 'プラグインをインストールしてローカル MCP を接続し、',
    bodyAfterMention: 'を呼び出します。',
    copy: 'コピー',
    download: 'HiDesign をダウンロード',
    source: 'ソースを見る',
  },
  clipboard: {
    copying: 'コピー中…',
    copied: 'コピーしました',
    failed: '選択してコピー',
  },
  schema: {
    pageName: 'Codex/ChatGPT 向け HiDesign Cloud プラグイン',
    applicationName: 'Codex/ChatGPT 向け HiDesign Cloud プラグイン',
  },
};

export default ja;
