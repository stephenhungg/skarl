import AsyncStorage from '@react-native-async-storage/async-storage';

export type CaptureContext = {
  mount: 'handheld' | 'chest' | 'head'; dominantHand: 'left' | 'right';
  environment: 'kitchen' | 'desk' | 'workshop' | 'other'; lighting: 'bright' | 'dim';
};
export const contextChoices = {
  mount: ['handheld', 'chest', 'head'], dominantHand: ['left', 'right'],
  environment: ['kitchen', 'desk', 'workshop', 'other'], lighting: ['bright', 'dim'],
} as const;
export const defaultContext: CaptureContext = { mount: 'handheld', dominantHand: 'right', environment: 'other', lighting: 'bright' };
const KEY = 'skarl.capture-context.v1';
export async function loadCaptureContext(): Promise<CaptureContext> {
  const value: unknown = JSON.parse(await AsyncStorage.getItem(KEY) ?? 'null');
  if (!value || typeof value !== 'object') return { ...defaultContext };
  const candidate = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(contextChoices).map(([key, choices]) =>
    [key, choices.some(choice => choice === candidate[key]) ? candidate[key] : defaultContext[key as keyof CaptureContext]])) as CaptureContext;
}
export const saveCaptureContext = (context: CaptureContext) => AsyncStorage.setItem(KEY, JSON.stringify(context));
