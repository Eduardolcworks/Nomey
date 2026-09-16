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
export { convert, convertWithinRange } from './money/convert';
export { INT64_MAX, INT64_MIN, isInt64 } from './money/int64';

export { MAX_RATE_SCALE, sourceDecimalToRate } from './fx/source-decimal';
export { DERIVED_RATE_SCALE, PIVOT_QUOTE, deriveRate } from './fx/derive-rate';
export type { FxEffectiveDateClass, IsoDate } from './fx/effective-date';
export { assertIsoDate, classifyFxEffectiveDate, isIsoDate } from './fx/effective-date';
export type {
  CoverageInterval,
  CurrencyCoverage,
  DayRateInput,
  DayRateSelection,
  InsufficientReason,
  NotCoveredReason,
  ObservedPublication,
} from './fx/day-rate';
export { selectDayRate } from './fx/day-rate';

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
