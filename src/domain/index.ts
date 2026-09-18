export { DomainError, DOMAIN_ERROR_CODES, isDomainError } from './errors';
export type { DomainErrorCode } from './errors';
export type { ParticipantId, ScopeId } from './ids';
export { participantId, scopeId } from './ids';

export type { CurrencyDefinition } from './money/currency-definition';
export { currencyDefinition, sameCurrencyDefinition } from './money/currency-definition';
export type { Money } from './money/money';
export {
  absMoney,
  addMoney,
  compareMoney,
  isNegativeMoney,
  isZeroMoney,
  money,
  moneyEquals,
  moneyFromMinorString,
  moneyToMinorString,
  negateMoney,
  subtractMoney,
  sumMoney,
  zeroMoney,
} from './money/money';
export { divideRoundHalfAwayFromZero } from './money/rounding';
export { fromMinorUnits, toMinorUnits } from './money/parse';
export type { ExchangeRate } from './money/exchange-rate';
export { exchangeRate, exchangeRateFromStrings } from './money/exchange-rate';
export { convert } from './money/convert';

export type { Share, SplitInput, SplitMethod } from './split/split';
export { sharesTotal, splitExpense } from './split/split';
export { allocateByLargestRemainder } from './split/largest-remainder';

export type { AccountingClass, DebtImpact, EconomicImpact, Effect } from './effects/effect';
export {
  deriveAdjustment,
  deriveDebtSettlement,
  deriveExternalTransfer,
  deriveGroupExpense,
  deriveInternalTransfer,
  derivePersonalExpense,
  derivePersonalIncome,
  deriveSettlementByTransfer,
} from './effects/derive';
export type { DebtSettlementInput, GroupExpenseInput, PayerCashMovement } from './effects/derive';
export { deriveBalance, deriveEconomicTotal, deriveParticipantExpense } from './effects/balance';
export type { Debt } from './effects/debt';
export { deriveDebts, netDebtPosition } from './effects/debt';

export type { HandleValidation, UsernameProblem } from './username/handle';
export {
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  HANDLE_SHAPE,
  normalizeHandle,
  validateHandle,
} from './username/handle';
export { RESERVED_HANDLE_PREFIXES, RESERVED_HANDLES, isReservedHandle } from './username/reserved';
