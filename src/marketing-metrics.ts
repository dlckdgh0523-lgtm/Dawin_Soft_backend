/**
 * Standalone research prototype. No Site imports, persistence, network or side effects.
 * Database money should remain numeric/decimal strings. Provider windows retain their
 * native time zone. A missing report is not a zero-valued report.
 */


export type DataState = 'COMPLETE' | 'PARTIAL' | 'MISSING' | 'NOT_CONNECTED' | 'UNSUPPORTED' | 'FAILED' | 'INCOMPARABLE';
export type Method = 'API' | 'IMPORT' | 'MANUAL';
export type Grain = 'DAILY' | 'PERIOD' | 'CUMULATIVE';
export interface MetricDefinition {
  id: string;
  kind: 'SUM' | 'RATIO' | 'PERIOD_UNIQUE' | 'CUMULATIVE_LAST' | 'WEIGHTED_AVERAGE';
  unit: 'COUNT' | 'MONEY' | 'PERCENT' | 'POSITION';
  decimals?: number;
  ratioScale?: number;
}
export interface Scope {
  provider: string;
  accountId: string;
  report: string;
  dimensionsKey: string; // Canonical, sorted dimension values; __total__ is distinct.
  queryVersion: string;
  timeZone: string;
}
export interface Period {
  start: string; // Inclusive YYYY-MM-DD in timeZone, never a UTC-converted provider date.
  end: string;
  timeZone: string;
  includesIncompleteToday: boolean;
}
export interface MetricRow extends Scope {
  metricId: string;
  start: string;
  end: string;
  grain: Grain;
  state: Exclude<DataState, 'INCOMPARABLE'>;
  value: number | string | null;
  numerator?: number | null;
  denominator?: number | null;
  weight?: number | null;
  currency?: string;
  observedAt: string;
  method: Method;
}
export interface Aggregate {
  value: number | string | null;
  state: DataState;
  reason: string;
  basis: string;
  rowCount: number;
  warnings: string[];
  scopeKey: string;
  currency?: string;
}
const DAY = 86_400_000;
const scopeKeys: (keyof Scope)[] = ['provider', 'accountId', 'report', 'dimensionsKey', 'queryVersion', 'timeZone'];
const stateOrder: DataState[] = ['FAILED', 'NOT_CONNECTED', 'UNSUPPORTED', 'MISSING', 'PARTIAL'];
const fail = (reason: string): never => { throw new Error(reason); };
function requireValue(condition: unknown, reason: string): asserts condition { if (!condition) fail(reason); }
function finiteNonnegative(value: unknown, reason = 'INVALID_METRIC_NUMBER'): number {
  requireValue(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER, reason);
  return value;
}
export function validDate(value: string): string {
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(value), 'INVALID_DATE');
  const parsed = new Date(value + 'T00:00:00Z');
  requireValue(Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value, 'INVALID_DATE');
  return value;
}
export function validTimeZone(value: string): string {
  try { new Intl.DateTimeFormat('en', {timeZone: value}).format(); } catch { fail('INVALID_TIME_ZONE'); }
  return value;
}
const dateMs = (date: string) => +new Date(validDate(date) + 'T00:00:00Z');
export const shiftDate = (date: string, days: number) => {
  requireValue(Number.isInteger(days), 'INVALID_DAY_SHIFT');
  return new Date(dateMs(date) + days * DAY).toISOString().slice(0, 10);
};
export function dateInZone(now: Date, timeZone: string): string {
  requireValue(Number.isFinite(+now), 'INVALID_NOW');
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: validTimeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(now);
  const read = (kind: string) => parts.find(p => p.type === kind)!.value;
  return `${read('year')}-${read('month')}-${read('day')}`;
}
export function periodDays(period: Period): number {
  validTimeZone(period.timeZone);
  requireValue(period.start <= period.end, 'INVERTED_PERIOD');
  return (dateMs(period.end) - dateMs(period.start)) / DAY + 1;
}
export function buildPeriod(preset: '7d' | '28d' | 'month' | 'custom', input: {now: Date; timeZone: string; start?: string; end?: string}): {current: Period | null; previous: Period | null; comparisonEnabled: boolean; reason: string} {
  const timeZone = validTimeZone(input.timeZone), today = dateInZone(input.now, timeZone), yesterday = shiftDate(today, -1);
  let start: string, end: string;
  if (preset === 'custom') {
    requireValue(input.start && input.end, 'CUSTOM_PERIOD_REQUIRED');
    start = validDate(input.start); end = validDate(input.end);
    requireValue(start <= end && end <= today, 'INVALID_CUSTOM_PERIOD');
  } else {
    end = yesterday;
    start = preset === 'month' ? today.slice(0, 7) + '-01' : shiftDate(end, preset === '7d' ? -6 : -27);
    if (start > end) return {current: null, previous: null, comparisonEnabled: false, reason: 'NO_COMPLETE_DAY_THIS_MONTH'};
  }
  const current: Period = {start, end, timeZone, includesIncompleteToday: end === today};
  const length = periodDays(current), previous: Period = {start: shiftDate(start, -length), end: shiftDate(start, -1), timeZone, includesIncompleteToday: false};
  return {current, previous, comparisonEnabled: !current.includesIncompleteToday, reason: current.includesIncompleteToday ? 'TODAY_IS_INCOMPLETE' : ''};
}

/** Money is exact decimal text; never a floating point amount from an untrusted CSV. */
export function decimalUnits(text: string, decimals: number): bigint {
  requireValue(Number.isInteger(decimals) && decimals >= 0 && decimals <= 8, 'INVALID_MONEY_SCALE');
  requireValue(typeof text === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) && text.length <= 30, 'INVALID_DECIMAL');
  const [whole, fraction = ''] = text.split('.');
  requireValue(fraction.length <= decimals, 'MONEY_PRECISION_EXCEEDED');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
}
export function unitsDecimal(units: bigint, decimals: number): string {
  requireValue(units >= 0n, 'NEGATIVE_MONEY');
  if (!decimals) return units.toString();
  const digits = units.toString().padStart(decimals + 1, '0');
  return digits.slice(0, -decimals) + '.' + digits.slice(-decimals);
}
export function metricNaturalKey(row: MetricRow): string {
  return JSON.stringify([...scopeKeys.map(k => row[k]), row.metricId, row.grain, row.start, row.end]);
}
export function resolveRows(rows: MetricRow[], priority: Record<Method, number> = {API: 3, IMPORT: 2, MANUAL: 1}): {rows: MetricRow[]; warnings: string[]} {
  const byKey = new Map<string, MetricRow>(), warnings = new Set<string>();
  for (const row of rows) {
    validDate(row.start); validDate(row.end); validTimeZone(row.timeZone);
    requireValue(row.start <= row.end && Number.isFinite(+new Date(row.observedAt)), 'INVALID_METRIC_WINDOW');
    requireValue(['API', 'IMPORT', 'MANUAL'].includes(row.method), 'INVALID_METHOD');
    requireValue(['DAILY', 'PERIOD', 'CUMULATIVE'].includes(row.grain), 'INVALID_GRAIN');
    requireValue(row.grain !== 'DAILY' || row.start === row.end, 'DAILY_WINDOW_MUST_BE_ONE_DAY');
    requireValue(['COMPLETE', 'PARTIAL', 'MISSING', 'NOT_CONNECTED', 'UNSUPPORTED', 'FAILED'].includes(row.state), 'INVALID_DATA_STATE');
    const key = metricNaturalKey(row), old = byKey.get(key);
    if (old && old.method !== row.method) warnings.add('OVERLAPPING_METHODS_RESOLVED_BY_EXPLICIT_PRIORITY');
    if (old && old.method === row.method && old.observedAt === row.observedAt) requireValue(JSON.stringify([old.value, old.numerator, old.denominator, old.weight, old.currency, old.state]) === JSON.stringify([row.value, row.numerator, row.denominator, row.weight, row.currency, row.state]), 'CONFLICTING_FACTS_REQUIRE_REVIEW');
    if (!old || priority[row.method] > priority[old.method] || priority[row.method] === priority[old.method] && +new Date(row.observedAt) > +new Date(old.observedAt)) byKey.set(key, row);
  }
  return {rows: [...byKey.values()], warnings: [...warnings]};
}
export function aggregateMetric(definition: MetricDefinition, inputRows: MetricRow[], selection: Scope & Period, options: {allowPartial?: boolean; emptyState?: DataState; priority?: Record<Method, number>} = {}): Aggregate {
  periodDays(selection);
  const scopeKey = JSON.stringify([definition.id, definition.kind, definition.unit, ...scopeKeys.map(k => selection[k])]);
  const empty = (state: DataState, reason: string, rowCount = 0, warnings: string[] = []): Aggregate => ({value: null, state, reason, basis: definition.kind, rowCount, warnings, scopeKey});
  if (inputRows.some(r => r.metricId !== definition.id || scopeKeys.some(k => r[k] !== selection[k]))) return empty('INCOMPARABLE', 'SCOPE_MISMATCH');
  const resolved = resolveRows(inputRows, options.priority), warnings = resolved.warnings;
  const rows = resolved.rows.filter(r => r.start >= selection.start && r.end <= selection.end);
  if (!rows.length) return empty(options.emptyState ?? 'MISSING', 'NO_REPORT_FOR_WINDOW', 0, warnings);
  if (definition.unit === 'MONEY') {
    const currencies = new Set(rows.map(r => r.currency));
    if (currencies.size !== 1 || !rows[0].currency || !/^[A-Z]{3}$/.test(rows[0].currency)) return empty('INCOMPARABLE', 'CURRENCY_MISMATCH', rows.length, warnings);
  }
  let dataState: DataState = stateOrder.find(s => rows.some(r => r.state === s)) ?? 'COMPLETE';
  if (rows.some(r => r.value === null && r.state === 'COMPLETE' && !['RATIO'].includes(definition.kind))) dataState = 'MISSING';
  if (rows.every(r => r.grain === 'DAILY') && new Set(rows.map(r => r.start)).size !== periodDays(selection)) {
    if (dataState === 'COMPLETE') dataState = 'PARTIAL';
    warnings.push('MISSING_DAYS_ARE_NOT_ZERO');
  }
  if (selection.includesIncompleteToday && dataState === 'COMPLETE') dataState = 'PARTIAL';
  if (dataState !== 'COMPLETE' && !options.allowPartial) return empty(dataState, 'REPORT_IS_NOT_COMPLETE', rows.length, warnings);
  const known = rows.filter(r => ['COMPLETE', 'PARTIAL'].includes(r.state) && (r.value !== null || definition.kind === 'RATIO'));
  if (!known.length) return empty(dataState === 'COMPLETE' ? 'MISSING' : dataState, 'NO_KNOWN_VALUES', rows.length, warnings);
  if (['SUM', 'RATIO', 'WEIGHTED_AVERAGE'].includes(definition.kind)) {
    if (known.some(r => r.grain === 'CUMULATIVE') || new Set(known.map(r => r.grain)).size > 1) return empty('INCOMPARABLE', 'AGGREGATION_GRAIN_MISMATCH', rows.length, warnings);
    if (known[0].grain === 'PERIOD' && (known.length !== 1 || known[0].start !== selection.start || known[0].end !== selection.end)) return empty('INCOMPARABLE', 'PERIOD_TOTAL_REQUIRED', rows.length, warnings);
  }
  if (definition.unit === 'COUNT') known.forEach(r => requireValue(Number.isSafeInteger(r.value), 'INTEGER_COUNT_REQUIRED'));
  let value: number | string | null = null, reason = '';
  if (definition.kind === 'PERIOD_UNIQUE') {
    if (known.length !== 1 || known[0].grain !== 'PERIOD' || known[0].start !== selection.start || known[0].end !== selection.end) return empty('INCOMPARABLE', 'PERIOD_UNIQUE_REPORT_REQUIRED', rows.length, warnings);
    value = finiteNonnegative(known[0].value);
  } else if (definition.kind === 'CUMULATIVE_LAST') {
    if (known.some(r => r.grain !== 'CUMULATIVE')) return empty('INCOMPARABLE', 'CUMULATIVE_SNAPSHOT_REQUIRED', rows.length, warnings);
    const last = [...known].sort((a, b) => +new Date(b.observedAt) - +new Date(a.observedAt))[0];
    value = finiteNonnegative(last.value);
    warnings.push('LATEST_SNAPSHOT_IS_NOT_PERIOD_TOTAL');
  } else if (definition.kind === 'RATIO') {
    if (known.some(r => r.grain === 'CUMULATIVE')) return empty('INCOMPARABLE', 'RATIO_WINDOW_MISMATCH', rows.length, warnings);
    const numerator = known.reduce((sum, r) => sum + finiteNonnegative(r.numerator, 'RATIO_COMPONENTS_REQUIRED'), 0);
    const denominator = known.reduce((sum, r) => sum + finiteNonnegative(r.denominator, 'RATIO_COMPONENTS_REQUIRED'), 0);
    if (!denominator) reason = 'ZERO_DENOMINATOR';
    else value = numerator / denominator * (definition.ratioScale ?? 100);
  } else if (definition.kind === 'WEIGHTED_AVERAGE') {
    const weighted = known.reduce((sum, r) => sum + finiteNonnegative(r.value) * finiteNonnegative(r.weight, 'WEIGHT_REQUIRED'), 0);
    const weight = known.reduce((sum, r) => sum + finiteNonnegative(r.weight, 'WEIGHT_REQUIRED'), 0);
    if (!weight) reason = 'ZERO_DENOMINATOR'; else value = weighted / weight;
  } else {
    if (known.some(r => r.grain === 'CUMULATIVE') || new Set(known.map(r => r.grain)).size > 1) return empty('INCOMPARABLE', 'ADDITIVE_GRAIN_MISMATCH', rows.length, warnings);
    // A full PERIOD report must not be summed alongside overlapping PERIOD reports.
    if (known[0].grain === 'PERIOD' && (known.length !== 1 || known[0].start !== selection.start || known[0].end !== selection.end)) return empty('INCOMPARABLE', 'PERIOD_TOTAL_REQUIRED', rows.length, warnings);
    if (definition.unit === 'MONEY') {
      const decimals = definition.decimals ?? 6;
      value = unitsDecimal(known.reduce((sum, r) => {
        requireValue(typeof r.value === 'string', 'MONEY_MUST_BE_DECIMAL_TEXT');
        return sum + decimalUnits(r.value, decimals);
      }, 0n), decimals);
    } else value = known.reduce((sum, r) => sum + finiteNonnegative(r.value), 0);
  }
  requireValue(typeof value !== 'number' || Number.isFinite(value) && value <= Number.MAX_SAFE_INTEGER, 'AGGREGATE_OVERFLOW');
  return {value, state: dataState, reason, basis: definition.kind, rowCount: rows.length, warnings, scopeKey, ...(definition.unit === 'MONEY' ? {currency: known[0].currency} : {})};
}
export function compareMetric(current: Aggregate, previous: Aggregate, currentPeriod: Period, previousPeriod: Period): {absolute: number | null; percent: number | null; reason: string} {
  if (current.scopeKey !== previous.scopeKey || current.currency !== previous.currency) return {absolute: null, percent: null, reason: 'SCOPE_MISMATCH'};
  if (currentPeriod.timeZone !== previousPeriod.timeZone || periodDays(currentPeriod) !== periodDays(previousPeriod)) return {absolute: null, percent: null, reason: 'PERIOD_MISMATCH'};
  if (previousPeriod.end !== shiftDate(currentPeriod.start, -1)) return {absolute: null, percent: null, reason: 'PREVIOUS_PERIOD_MUST_BE_ADJACENT'};
  if (currentPeriod.includesIncompleteToday || previousPeriod.includesIncompleteToday) return {absolute: null, percent: null, reason: 'TODAY_IS_INCOMPLETE'};
  if (current.state !== 'COMPLETE' || previous.state !== 'COMPLETE') return {absolute: null, percent: null, reason: 'INCOMPLETE_REPORT'};
  if (typeof current.value !== 'number' || typeof previous.value !== 'number') return {absolute: null, percent: null, reason: 'NUMERIC_COMPARISON_REQUIRED'};
  const absolute = current.value - previous.value;
  return {absolute, percent: previous.value === 0 ? null : absolute / previous.value * 100, reason: previous.value === 0 ? 'ZERO_BASELINE' : ''};
}

export interface CsvRecord {cells: string[]; line: number}
export function parseCsv(text: string, limits: {maxBytes?: number; maxRows?: number; maxColumns?: number; maxCell?: number} = {}): CsvRecord[] {
  const maxBytes = limits.maxBytes ?? 5 * 1024 * 1024, maxRows = limits.maxRows ?? 20_001, maxColumns = limits.maxColumns ?? 50, maxCell = limits.maxCell ?? 2000;
  requireValue(new TextEncoder().encode(text).length <= maxBytes && !text.includes('\0'), 'CSV_INPUT_LIMIT');
  if (text.startsWith('\uFEFF')) text = text.slice(1);
  const rows: CsvRecord[] = []; let cells: string[] = [], cell = '', quoted = false, closed = false, line = 1, startLine = 1, endedWithNewline = false;
  const pushCell = () => { requireValue(cell.length <= maxCell && cells.length < maxColumns, 'CSV_CELL_LIMIT'); cells.push(cell); cell = ''; closed = false; };
  const pushRow = () => { pushCell(); requireValue(rows.length < maxRows, 'CSV_ROW_LIMIT'); rows.push({cells, line: startLine}); cells = []; startLine = line; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]; endedWithNewline = false;
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') {cell += '"'; i++;} else {quoted = false; closed = true;} }
      else {cell += char; if (char === '\n') line++;}
    } else if (char === '"') {
      requireValue(cell === '' && !closed, `CSV_STRAY_QUOTE_LINE_${line}`); quoted = true;
    } else if (char === ',') pushCell();
    else if (char === '\r' || char === '\n') {
      if (char === '\r') {requireValue(text[i + 1] === '\n', `CSV_BARE_CR_LINE_${line}`); i++;}
      pushRow(); line++; startLine = line; endedWithNewline = true;
    } else {requireValue(!closed, `CSV_AFTER_QUOTE_LINE_${line}`); cell += char;}
    requireValue(cell.length <= maxCell, 'CSV_CELL_LIMIT');
  }
  requireValue(!quoted, `CSV_UNCLOSED_QUOTE_LINE_${startLine}`);
  if (text.length && !endedWithNewline) pushRow();
  return rows;
}
export interface CsvMapping extends Scope {
  metric: MetricDefinition;
  columns: {start: string; end?: string; value?: string; numerator?: string; denominator?: string; weight?: string; currency?: string; timeZone?: string; grain?: string};
  grain: Grain;
  currency?: string;
  observedAt: string;
}
export interface ImportPreview {valid: MetricRow[]; failures: {line: number; code: string}[]; warnings: string[]; skippedBlankRows: number}
const numericCsv = (text: string) => {
  requireValue(/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text.trim()), 'INVALID_NUMERIC_CELL');
  return finiteNonnegative(Number(text.trim()));
};
export function previewCsvMapped(text: string, mapping: CsvMapping): ImportPreview {
  const records = parseCsv(text); requireValue(records.length >= 1, 'CSV_HEADER_REQUIRED');
  const headers = records[0].cells.map(h => h.trim());
  requireValue(headers.every(Boolean) && new Set(headers).size === headers.length, 'CSV_DUPLICATE_OR_EMPTY_HEADER');
  const indexes: Partial<Record<keyof CsvMapping['columns'], number>> = {};
  for (const [key, header] of Object.entries(mapping.columns)) {
    const index = headers.indexOf(header!); requireValue(index >= 0, 'CSV_MAPPED_HEADER_NOT_FOUND');
    indexes[key as keyof CsvMapping['columns']] = index;
  }
  requireValue(indexes.start !== undefined, 'CSV_DATE_MAPPING_REQUIRED');
  requireValue(mapping.metric.kind === 'RATIO' ? indexes.numerator !== undefined && indexes.denominator !== undefined : indexes.value !== undefined, 'CSV_VALUE_MAPPING_REQUIRED');
  validTimeZone(mapping.timeZone); requireValue(Number.isFinite(+new Date(mapping.observedAt)), 'INVALID_IMPORT_TIMESTAMP');
  const preview: ImportPreview = {valid: [], failures: [], warnings: [], skippedBlankRows: 0}, keys = new Set<string>();
  for (const record of records.slice(1)) {
    if (record.cells.every(v => v.trim() === '')) {preview.skippedBlankRows++; continue;}
    try {
      requireValue(record.cells.length === headers.length, 'CSV_COLUMN_COUNT_MISMATCH');
      const read = (key: keyof CsvMapping['columns']) => indexes[key] === undefined ? undefined : record.cells[indexes[key]!].trim();
      const start = validDate(read('start')!), end = validDate(read('end') ?? start);
      const timeZone = validTimeZone(read('timeZone') ?? mapping.timeZone); requireValue(timeZone === mapping.timeZone, 'CSV_TIME_ZONE_MISMATCH');
      const grain = read('grain') ?? mapping.grain; requireValue(grain === mapping.grain, 'CSV_GRAIN_MISMATCH');
      const currency = read('currency') ?? mapping.currency;
      if (mapping.metric.unit === 'MONEY') requireValue(currency && /^[A-Z]{3}$/.test(currency), 'CSV_CURRENCY_REQUIRED');
      const valueText = read('value'); let value: number | string | null = null;
      if (valueText !== undefined) {
        if (mapping.metric.unit === 'MONEY') {decimalUnits(valueText, mapping.metric.decimals ?? 6); value = valueText;}
        else value = numericCsv(valueText);
      }
      const row: MetricRow = {provider: mapping.provider, accountId: mapping.accountId, report: mapping.report, dimensionsKey: mapping.dimensionsKey, queryVersion: mapping.queryVersion, metricId: mapping.metric.id, start, end, timeZone, grain: grain as Grain, state: 'COMPLETE', value, currency, method: 'IMPORT', observedAt: mapping.observedAt};
      for (const key of ['numerator', 'denominator', 'weight'] as const) if (indexes[key] !== undefined) row[key] = numericCsv(read(key)!);
      requireValue(start <= end && (grain !== 'DAILY' || start === end), 'CSV_WINDOW_MISMATCH');
      const natural = metricNaturalKey(row); requireValue(!keys.has(natural), 'CSV_DUPLICATE_NATURAL_KEY'); keys.add(natural);
      preview.valid.push(row);
    } catch (error) {preview.failures.push({line: record.line, code: error instanceof Error ? error.message : 'CSV_INVALID_ROW'});}
  }
  // The caller must show this preview and require confirmation before an import tx.
  if (preview.failures.length) preview.warnings.push('PARTIAL_IMPORT_REQUIRES_EXPLICIT_CONFIRMATION');
  return preview;
}
export function formulaSafeCsvField(value: string | number | null): string {
  let text = value === null ? '' : String(value);
  if (typeof value === 'number') requireValue(Number.isFinite(value), 'INVALID_EXPORT_NUMBER');
  else if (/^[=+\-@]/.test(text.replace(/^[\s\uFEFF\u200B]+/u, '')) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function exportCsv(headers: string[], rows: (string | number | null)[][]): string {
  requireValue(headers.length > 0 && headers.length <= 50 && rows.length <= 20_000, 'EXPORT_LIMIT');
  requireValue(rows.every(row => row.length === headers.length), 'EXPORT_COLUMN_COUNT_MISMATCH');
  return [headers, ...rows].map(row => row.map(formulaSafeCsvField).join(',')).join('\r\n') + '\r\n';
}

export type UtmField = 'source' | 'medium' | 'campaign' | 'content' | 'term';
export interface UtmOptions {
  siteOrigin: string;
  publicPaths: ReadonlySet<string>;
  registeredTokens: Partial<Record<UtmField, ReadonlySet<string>>>;
  allowedQueryKeys?: ReadonlySet<string>;
  allowedFragments?: ReadonlySet<string>;
}
const forbidden = /비공개고객|legacy-center|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?82[- ]?)?010[- ]?\d{4}[- ]?\d{4}|(?:password|secret|token|api[_-]?key)\s*[:=]/i;
export function buildUtmUrl(landing: string, params: Partial<Record<UtmField, string>>, options: UtmOptions): string {
  const origin = new URL(options.siteOrigin);
  requireValue(origin.pathname === '/' && !origin.search && !origin.hash && !origin.username && !origin.password, 'INVALID_SITE_ORIGIN');
  const url = new URL(landing, origin);
  requireValue(url.origin === origin.origin && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'UTM_OWN_SITE_REQUIRED');
  requireValue(options.publicPaths.has(url.pathname) && !/^\/(?:admin|api|media|signin)(?:\/|$)/.test(url.pathname), 'UTM_PUBLIC_PATH_REQUIRED');
  const allowedQuery = options.allowedQueryKeys ?? new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (key.startsWith('utm_')) {requireValue(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].includes(key) && !forbidden.test(value), 'UTM_UNAPPROVED_QUERY'); continue;}
    requireValue(!/(?:email|phone|password|token|secret|api[_-]?key|customer|client)/i.test(key) && allowedQuery.has(key) && value.length <= 250 && !value.includes('%') && !forbidden.test(value), 'UTM_UNAPPROVED_QUERY');
  }
  if (url.hash) requireValue(options.allowedFragments?.has(url.hash.slice(1)) && !forbidden.test(url.hash), 'UTM_UNAPPROVED_FRAGMENT');
  for (const required of ['source', 'medium', 'campaign'] as const) requireValue(params[required], 'UTM_REQUIRED_TOKEN');
  for (const key of ['source', 'medium', 'campaign', 'content', 'term'] as const) {
    const token = params[key];
    if (!token) {url.searchParams.delete('utm_' + key); continue;}
    // Derive these from registered channel/campaign IDs, not contacts or search text.
    requireValue(token.length <= 100 && /^[a-z0-9][a-z0-9._~-]*$/.test(token) && !forbidden.test(token), 'UTM_INVALID_TOKEN');
    requireValue(options.registeredTokens[key]?.has(token), 'UTM_UNREGISTERED_TOKEN');
    url.searchParams.set('utm_' + key, token);
  }
  return url.href;
}
export function safeReferrerOrigin(raw: string, approvedOrigins: ReadonlySet<string>): string | null {
  try {const url = new URL(raw); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && approvedOrigins.has(url.origin) ? url.origin : null;} catch {return null;}
}


export const exportSafeCsv=exportCsv;
export function previewMetricCsv(csv:string,mapping:Record<string,any>,options:{timezone:string;currency?:string}){
 const name=String(mapping.metric??'clicks');
 const known=['page_views','sessions','users','impressions','clicks','reach','views','likes','replies','reposts','quotes','followers','cost','cta_clicks','inquiries'];
 requireValue(known.includes(name),'INVALID_METRIC');
 const grain=({day:'DAILY',period:'PERIOD',lifetime:'CUMULATIVE'} as Record<string,Grain>)[mapping.grain??'day'];requireValue(grain,'INVALID_GRAIN');
 const result=previewCsvMapped(csv,{provider:mapping.provider??'MANUAL',accountId:mapping.accountId??'manual',report:mapping.report??'manual-import',dimensionsKey:mapping.dimensionKey??'',queryVersion:'mapping-1',timeZone:options.timezone,metric:{id:name,kind:name==='cost'?'SUM':name==='users'||name==='reach'?'PERIOD_UNIQUE':name==='views'||name==='followers'?'CUMULATIVE_LAST':'SUM',unit:name==='cost'?'MONEY':'COUNT',decimals:4},columns:{start:mapping.start??'date',...(mapping.end?{end:mapping.end}:{}),value:mapping.value??'value'},grain,currency:options.currency,observedAt:new Date().toISOString()});
 return {rows:result.valid.map(r=>({start:r.start,end:r.end,metric:r.metricId,value:r.value,grain:({DAILY:'day',PERIOD:'period',CUMULATIVE:'lifetime'} as Record<string,string>)[r.grain],timezone:r.timeZone,currency:r.currency,dimensionKey:r.dimensionsKey,report:r.report})),errors:result.failures,warnings:result.warnings};
}
