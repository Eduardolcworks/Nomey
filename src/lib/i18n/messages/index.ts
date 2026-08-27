import type { MessageLocale } from '../locales';
import { en } from './en';
import { esES, type MessageKey } from './es-ES';

export type { MessageKey };

export const CATALOGUES: Readonly<Record<MessageLocale, Readonly<Record<MessageKey, string>>>> = {
  'es-ES': esES,
  en,
};
