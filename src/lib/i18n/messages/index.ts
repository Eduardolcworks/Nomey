import type { Locale } from '../locales';
import { en } from './en';
import { esES, type MessageKey } from './es-ES';

export type { MessageKey };

export const CATALOGUES: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = {
  'es-ES': esES,
  en,
};
