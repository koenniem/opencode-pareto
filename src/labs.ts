/**
 * Which lab made each model, for colouring the chart.
 *
 * Kept as an explicit map rather than parsed from the name: "Muse Spark" and
 * "Gemini" tell you nothing about the creator, and a heuristic that guesses
 * would colour a model wrong without anyone noticing. A test asserts every
 * model in the roster has a lab, so a new model cannot quietly go grey.
 */
export const LAB_NAMES = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  xai: 'xAI',
  meta: 'Meta',
  deepseek: 'DeepSeek',
  alibaba: 'Alibaba',
  zhipu: 'Zhipu',
  moonshot: 'Moonshot',
  xiaomi: 'Xiaomi',
  minimax: 'MiniMax',
  longcat: 'LongCat',
  tencent: 'Tencent',
  stepfun: 'StepFun',
  other: 'Other',
} as const;

export type Lab = keyof typeof LAB_NAMES;

export const LAB_BY_GO_ID: Record<string, Lab> = {
  'claude-haiku-5-5': 'anthropic',

  'gpt-6-luna': 'openai',
  'gpt-5.6-luna': 'openai',

  'gemini-4-argon-contributor': 'google',

  'grok-4.7': 'xai',

  'muse-spark-1.3-contributor': 'meta',
  'muse-spark-1.2-contributor': 'meta',

  'deepseek-v4.1-flash': 'deepseek',
  'deepseek-v4-pro': 'deepseek',

  'qwen3.8-max': 'alibaba',
  'qwen3.8-flash': 'alibaba',
  'qwen3.7-plus': 'alibaba',

  'glm-5.3-flash': 'zhipu',
  'glm-5.3': 'zhipu',
  'glm-5.2': 'zhipu',

  'kimi-k3': 'moonshot',
  'kimi-k2.7-code': 'moonshot',

  'mimo-v2.6-flash': 'xiaomi',
  'mimo-v2.6-pro': 'xiaomi',
  'mimo-v2.5': 'xiaomi',
  'mimo-v2.5-pro': 'xiaomi',

  'minimax-m3': 'minimax',
  'minimax-m3.1-flash-free': 'minimax',

  'longcat-2.0': 'longcat',
  'longcat-2.5-preview-free': 'longcat',

  hy3: 'tencent',
  'hy4-preview': 'tencent',

  'step-5-preview': 'stepfun',

  'beam-free': 'other',
};

export function labOf(goId: string): Lab {
  return LAB_BY_GO_ID[goId] ?? 'other';
}

/** CSS class for a lab's colour. */
export function labClass(goId: string): string {
  return `lab-${labOf(goId)}`;
}
