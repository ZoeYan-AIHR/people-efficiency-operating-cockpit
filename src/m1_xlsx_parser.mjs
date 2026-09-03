/*
  M1 离线 XLSX / CSV 解析与人效聚合核心
  设计目标：仅依赖浏览器原生 Web API（File / ArrayBuffer / DecompressionStream），
  解析标准模板所需的单元格值；不上传文件、不请求外部资源。
*/

const M1_REQUIRED_SHEETS = [
  '02_组织维度',
  '03_人力投入_月度',
  '04_业务产出_月度'
];

const M1_HEADER_CONFIG = {
  org: ['org_code', 'org_name'],
  workforce: ['period', 'org_code', 'average_fte'],
  output: ['period', 'org_code', 'recognized_revenue', 'operating_profit'],
  process: ['period', 'org_code', 'metric_code', 'metric_value'],
  config: ['scenario_id', 'primary_output_metric', 'fte_rule', 'labor_cost_scope'],
  target: ['period', 'scope_code', 'metric_code']
};

function m1XmlDecode(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
}

function m1XmlText(fragment) {
  return m1XmlDecode(String(fragment ?? '').replace(/<[^>]*>/g, ''));
}

function m1Attr(text, name) {
  const m = String(text || '').match(new RegExp(`(?:^|\\s)${name.replace(':', '\\:')}=["']([^"']*)["']`));
  return m ? m1XmlDecode(m[1]) : '';
}

function m1ColumnIndex(ref) {
  const letters = String(ref || '').match(/[A-Z]+/i)?.[0] || '';
  let n = 0;
  for (const char of letters.toUpperCase()) n = n * 26 + char.charCodeAt(0) - 64;
  return Math.max(0, n - 1);
}

function m1NormalizeHeader(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^\ufeff/, '');
}

function m1ToNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!text || text[0] === '=') return null;
  if (/^-?[\d.]+%$/.test(text)) return Number(text.slice(0, -1)) / 100;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function m1PathResolve(baseFile, target) {
  if (target.startsWith('/')) return target.replace(/^\//, '');
  const base = baseFile.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  return base.join('/');
}

async function m1InflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持离线 XLSX 解压。请使用最新版 Chrome / Edge，或改用 CSV 导入。');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function m1UnzipEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const min = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('无法识别 XLSX 压缩包目录。请确认文件未损坏且为标准 .xlsx 文件。');
  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder('utf-8');
  const entries = new Map();
  let pos = centralOffset;

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) throw new Error('XLSX 压缩目录格式异常。');
    const compression = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.slice(pos + 46, pos + 46 + nameLen));

    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`XLSX 条目「${name}」的本地文件头异常。`);
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let data;
    if (compression === 0) data = compressed;
    else if (compression === 8) data = await m1InflateRaw(compressed);
    else throw new Error(`XLSX 条目「${name}」使用了暂不支持的压缩方式（${compression}）。`);
    entries.set(name, decoder.decode(data));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function m1ParseSharedStrings(xml = '') {
  const values = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const text = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x => m1XmlText(x[1])).join('');
    values.push(text);
  }
  return values;
}

function m1TagText(xml, tag) {
  const m = String(xml || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m1XmlText(m[1]) : '';
}

function m1ParseWorksheet(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of String(xml || '').matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNo = Number(m1Attr(rowMatch[1], 'r')) || rows.length + 1;
    const values = [];
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const cellXml = cellMatch[2];
      const col = m1ColumnIndex(m1Attr(attrs, 'r'));
      const type = m1Attr(attrs, 't');
      const raw = m1TagText(cellXml, 'v');
      const formula = m1TagText(cellXml, 'f');
      let value = '';
      if (type === 's') value = sharedStrings[Number(raw)] ?? '';
      else if (type === 'inlineStr' || type === 'str') value = m1TagText(cellXml, 't') || raw;
      else if (type === 'b') value = raw === '1';
      else if (raw !== '') value = m1ToNumber(raw) ?? raw;
      else if (formula) value = `=${formula}`;
      values[col] = value;
    }
    rows.push({ rowNo, values });
  }
  return rows;
}

async function m1ParseXlsxBuffer(buffer) {
  const entries = await m1UnzipEntries(buffer);
  const workbook = entries.get('xl/workbook.xml');
  const rels = entries.get('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) throw new Error('文件不是可识别的 Excel 工作簿，缺少工作簿描述。');
  const relMap = new Map();
  for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g)) {
    const id = m1Attr(match[1], 'Id');
    const target = m1Attr(match[1], 'Target');
    if (id && target) relMap.set(id, m1PathResolve('xl/workbook.xml', target));
  }
  const sharedStrings = m1ParseSharedStrings(entries.get('xl/sharedStrings.xml') || '');
  const sheets = {};
  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?>(?:<\/sheet>)?/g)) {
    const name = m1Attr(match[1], 'name');
    const rid = m1Attr(match[1], 'r:id') || m1Attr(match[1], 'id');
    const path = relMap.get(rid);
    if (name && path && entries.has(path)) sheets[name] = m1ParseWorksheet(entries.get(path), sharedStrings);
  }
  return { format: 'xlsx', sheets };
}

function m1ParseCsvText(text) {
  const rows = [];
  let cell = '', row = [], quoted = false;
  const pushCell = () => { row.push(cell); cell = ''; };
  const pushRow = () => { pushCell(); rows.push({ rowNo: rows.length + 1, values: row }); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"' && quoted && next === '"') { cell += '"'; i++; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === ',' && !quoted) { pushCell(); continue; }
    if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i++;
      pushRow(); continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) pushRow();
  return { format: 'csv', sheets: { 'CSV_数据': rows } };
}

function m1FindHeader(sheetRows = [], expected = []) {
  let best = null;
  for (const row of sheetRows) {
    const headers = row.values.map(m1NormalizeHeader);
    const hits = expected.filter(h => headers.includes(m1NormalizeHeader(h))).length;
    if (!best || hits > best.hits) best = { rowNo: row.rowNo, values: row.values, headers, hits };
  }
  return best && best.hits ? best : null;
}

function m1TableFromSheet(sheetRows, expectedHeaders) {
  const header = m1FindHeader(sheetRows, expectedHeaders);
  if (!header) return { header: null, rows: [] };
  const index = {};
  header.headers.forEach((h, i) => { if (h) index[h] = i; });
  const rows = sheetRows.filter(r => r.rowNo > header.rowNo).map(r => {
    const obj = { __rowNo: r.rowNo };
    Object.entries(index).forEach(([key, i]) => { obj[key] = r.values[i] ?? ''; });
    return obj;
  }).filter(row => Object.values(row).some((v, i) => i > 0 && String(v ?? '').trim() !== ''));
  return { header: { ...header, index }, rows };
}

function m1Sum(values) { return values.reduce((total, v) => total + (m1ToNumber(v) ?? 0), 0); }
function m1Unique(values) { return [...new Set(values.filter(v => String(v ?? '').trim() !== ''))]; }
function m1PeriodSort(periods) { return [...periods].sort((a, b) => String(a).localeCompare(String(b), 'zh-CN', { numeric: true })); }

function m1BuildSnapshot(parsed, sourceName = '本地数据文件') {
  const sheets = parsed.sheets || {};
  const sheetNames = Object.keys(sheets);
  const byPrefix = prefix => sheetNames.find(name => name.startsWith(prefix));
  const orgSheetName = byPrefix('02_组织维度');
  const workforceSheetName = byPrefix('03_人力投入_月度');
  const outputSheetName = byPrefix('04_业务产出_月度');
  const processSheetName = byPrefix('05_过程质量_月度');
  const configSheetName = byPrefix('01_配置_指标映射');
  const targetSheetName = byPrefix('06_目标标杆');

  const orgTable = orgSheetName ? m1TableFromSheet(sheets[orgSheetName], M1_HEADER_CONFIG.org) : { header: null, rows: [] };
  const workforceTable = workforceSheetName ? m1TableFromSheet(sheets[workforceSheetName], M1_HEADER_CONFIG.workforce) : { header: null, rows: [] };
  const outputTable = outputSheetName ? m1TableFromSheet(sheets[outputSheetName], M1_HEADER_CONFIG.output) : { header: null, rows: [] };
  const processTable = processSheetName ? m1TableFromSheet(sheets[processSheetName], M1_HEADER_CONFIG.process) : { header: null, rows: [] };
  const configTable = configSheetName ? m1TableFromSheet(sheets[configSheetName], M1_HEADER_CONFIG.config) : { header: null, rows: [] };
  const targetTable = targetSheetName ? m1TableFromSheet(sheets[targetSheetName], M1_HEADER_CONFIG.target) : { header: null, rows: [] };

  const orgNameMap = Object.fromEntries(orgTable.rows.map(row => [String(row.org_code || '').trim(), String(row.org_name || row.org_code || '').trim()]));
  const periods = m1PeriodSort(m1Unique([
    ...workforceTable.rows.map(r => String(r.period || '').trim()),
    ...outputTable.rows.map(r => String(r.period || '').trim())
  ]));
  const periodSetWorkforce = new Set(workforceTable.rows.map(r => String(r.period || '').trim()));
  const periodSetOutput = new Set(outputTable.rows.map(r => String(r.period || '').trim()));

  const byPeriod = {};
  for (const period of periods) {
    const groups = {};
    const ensure = code => groups[code] ||= {
      code, name: orgNameMap[code] || code || '未匹配组织', fte: 0, revenue: 0, grossProfit: 0, profit: 0,
      labor: 0, salary: 0, insurance: 0, other: 0, productiveHours: 0, availableHours: 0, overtimeHours: 0,
      qualitySum: 0, qualityCount: 0, delay: null, rework: null, rows: { workforce: 0, output: 0 }
    };
    for (const row of workforceTable.rows.filter(r => String(r.period || '').trim() === period)) {
      const code = String(row.org_code || '').trim();
      const g = ensure(code);
      const salary = m1ToNumber(row.salary_cost) ?? 0;
      const bonus = m1ToNumber(row.bonus_cost) ?? 0;
      const employer = m1ToNumber(row.employer_cost) ?? 0;
      const welfare = m1ToNumber(row.welfare_cost) ?? 0;
      const recruitment = m1ToNumber(row.recruitment_cost) ?? 0;
      const training = m1ToNumber(row.training_cost) ?? 0;
      const outsourcing = m1ToNumber(row.outsourcing_cost) ?? 0;
      const severance = m1ToNumber(row.severance_cost) ?? 0;
      const constructed = salary + bonus + employer + welfare + recruitment + training + outsourcing + severance;
      const total = m1ToNumber(row.labor_cost_total);
      g.fte += m1ToNumber(row.average_fte) ?? 0;
      g.salary += salary;
      g.insurance += employer;
      g.other += bonus + welfare + recruitment + training + outsourcing + severance;
      g.labor += total === null ? constructed : total;
      g.productiveHours += m1ToNumber(row.productive_hours) ?? 0;
      g.availableHours += m1ToNumber(row.available_hours) ?? 0;
      g.overtimeHours += m1ToNumber(row.overtime_hours) ?? 0;
      g.rows.workforce++;
    }
    for (const row of outputTable.rows.filter(r => String(r.period || '').trim() === period)) {
      const code = String(row.org_code || '').trim();
      const g = ensure(code);
      g.revenue += m1ToNumber(row.recognized_revenue) ?? m1ToNumber(row.primary_output_value) ?? 0;
      g.grossProfit += m1ToNumber(row.gross_profit) ?? 0;
      g.profit += m1ToNumber(row.operating_profit) ?? 0;
      const q = m1ToNumber(row.quality_score);
      if (q !== null) { g.qualitySum += q; g.qualityCount++; }
      g.rows.output++;
    }
    for (const row of processTable.rows.filter(r => String(r.period || '').trim() === period)) {
      const code = String(row.org_code || '').trim();
      const g = ensure(code);
      const metric = String(row.metric_code || '').toUpperCase();
      const value = m1ToNumber(row.metric_value);
      if (value !== null && /DELAY/.test(metric)) g.delay = value;
      if (value !== null && /REWORK/.test(metric)) g.rework = value;
    }
    const orgs = Object.values(groups).filter(g => g.code);
    const total = orgs.reduce((a, g) => ({
      fte: a.fte + g.fte, revenue: a.revenue + g.revenue, grossProfit: a.grossProfit + g.grossProfit, profit: a.profit + g.profit,
      labor: a.labor + g.labor, salary: a.salary + g.salary, insurance: a.insurance + g.insurance, other: a.other + g.other,
      productiveHours: a.productiveHours + g.productiveHours, availableHours: a.availableHours + g.availableHours, overtimeHours: a.overtimeHours + g.overtimeHours
    }), { fte:0, revenue:0, grossProfit:0, profit:0, labor:0, salary:0, insurance:0, other:0, productiveHours:0, availableHours:0, overtimeHours:0 });
    byPeriod[period] = { period, orgs, total };
  }

  const requiredSheetStatuses = M1_REQUIRED_SHEETS.map(name => ({ name, exists: !!sheetNames.find(x => x.startsWith(name)) }));
  const missingRequiredSheets = requiredSheetStatuses.filter(x => !x.exists).map(x => x.name);
  const missingOrgCodes = m1Unique([
    ...workforceTable.rows.map(r => String(r.org_code || '').trim()),
    ...outputTable.rows.map(r => String(r.org_code || '').trim())
  ].filter(code => code && !orgNameMap[code]));
  const invalidFte = workforceTable.rows.filter(r => (m1ToNumber(r.average_fte) ?? 0) <= 0);
  const differentPeriods = periods.filter(p => !periodSetWorkforce.has(p) || !periodSetOutput.has(p));
  const seenKeys = new Set(), duplicateKeys = [];
  for (const row of workforceTable.rows) {
    const key = ['period', 'org_code', 'job_family', 'job_level', 'employment_type'].map(k => String(row[k] || '').trim()).join('|');
    if (seenKeys.has(key)) duplicateKeys.push({ key, rowNo: row.__rowNo });
    seenKeys.add(key);
  }
  const totalCostChecks = workforceTable.rows.map(row => {
    const components = m1Sum(['salary_cost','bonus_cost','employer_cost','welfare_cost','recruitment_cost','training_cost','outsourcing_cost','severance_cost'].map(k => row[k]));
    const total = m1ToNumber(row.labor_cost_total);
    return { rowNo: row.__rowNo, total, components, diff: total === null ? null : Math.abs(total - components) };
  });
  const failedCostRows = totalCostChecks.filter(x => x.diff !== null && x.diff > Math.max(1, Math.abs(x.components) * .001));
  const formulaCostRows = totalCostChecks.filter(x => x.total === null).length;
  const processCoverage = processTable.rows.length > 0;
  const targetCoverage = targetTable.rows.length > 0;
  const configCoverage = configTable.rows.length > 0;

  const rules = [
    { id:'P0-01', level:'P0', title:'组织编码与有效组织版本', desc:'所有人力与业务事实记录须匹配组织维度。', status: missingRequiredSheets.includes('02_组织维度') || missingOrgCodes.length ? '阻断' : '通过', detail: missingRequiredSheets.includes('02_组织维度') ? '缺少 02_组织维度。' : missingOrgCodes.length ? `未匹配组织：${missingOrgCodes.join('、')}` : `已匹配 ${Object.keys(orgNameMap).length} 个组织编码。` },
    { id:'P0-02', level:'P0', title:'期间与组织边界一致性', desc:'收入、经营利润、FTE、成本必须使用同一统计期间与组织边界。', status: missingRequiredSheets.some(x => ['03_人力投入_月度','04_业务产出_月度'].includes(x)) || differentPeriods.length ? '阻断' : '通过', detail: differentPeriods.length ? `期间覆盖不一致：${differentPeriods.join('、')}` : `共同覆盖 ${periods.length} 个期间：${periods.join('、') || '—'}。` },
    { id:'P0-03', level:'P0', title:'全口径人工成本构成', desc:'工资、奖金、雇主成本、福利、招聘、培训、外包、离职补偿应能与人工成本总额对账。', status: missingRequiredSheets.includes('03_人力投入_月度') || failedCostRows.length ? '阻断' : '通过', detail: failedCostRows.length ? `${failedCostRows.length} 行成本总额与构成不一致。` : formulaCostRows ? `${formulaCostRows} 行总额为公式 / 无缓存，已按成本构成实时重算。` : '所有上传的人工成本总额均与构成相符。' },
    { id:'P0-04', level:'P0', title:'人均指标可回算', desc:'人均收入、人均利润、人均成本均需由对应总额与平均 FTE 回算。', status: invalidFte.length || !periods.length ? '阻断' : '通过', detail: invalidFte.length ? `${invalidFte.length} 行 average_fte 小于或等于 0。` : '所有有产出的组织均具备正值平均 FTE，可执行人均回算。' },
    { id:'P0-05', level:'P0', title:'集团与组织汇总', desc:'集团值须由已发布组织的有效数据加总，或使用配置的共享分摊规则。', status: periods.length && byPeriod[periods.at(-1)]?.orgs.length ? '通过' : '阻断', detail: periods.length ? `最新期间 ${periods.at(-1)} 共聚合 ${byPeriod[periods.at(-1)]?.orgs.length || 0} 个组织单元。` : '未找到可用于汇总的期间。' },
    { id:'P0-06', level:'P0', title:'事实主键重复检查', desc:'月度人力投入的期间 × 组织 × 岗位 × 职级 × 用工类型不得重复。', status: duplicateKeys.length ? '阻断' : '通过', detail: duplicateKeys.length ? `发现 ${duplicateKeys.length} 个重复主键，示例：${duplicateKeys[0].key}` : '未发现人力投入粒度重复。' },
    { id:'P0-07', level:'P0', title:'FTE 与工时合理性', desc:'平均 FTE 必须为正，有效工时不能大于可用工时。', status: invalidFte.length ? '阻断' : '通过', detail: invalidFte.length ? `发现 ${invalidFte.length} 条异常 FTE。` : '平均 FTE 合法；工时字段将用于过程效率指标。' },
    { id:'P0-08', level:'P0', title:'配置与指标版本存在性', desc:'主产出、FTE 规则和人工成本范围须有可追溯配置。', status: configCoverage ? '通过' : '阻断', detail: configCoverage ? '已读取 01_配置_指标映射，将生成 METRIC-M1-V1。' : '缺少 01_配置_指标映射，无法确认核心口径。' },
    { id:'P1-01', level:'P1', title:'过程与质量数据覆盖', desc:'过程、质量数据缺失时，相关归因和预警须降级显示。', status: processCoverage ? '通过' : '告警', detail: processCoverage ? `已读取 ${processTable.rows.length} 条过程 / 质量记录。` : '未检测到过程质量数据；基础经营指标仍可发布。' },
    { id:'P1-02', level:'P1', title:'目标与标杆覆盖', desc:'缺少预算、目标或标杆时，目标差和预警解释能力会受限。', status: targetCoverage ? '通过' : '告警', detail: targetCoverage ? `已读取 ${targetTable.rows.length} 条目标 / 标杆记录。` : '未检测到目标标杆数据；仅可基于趋势与规则进行分析。' }
  ];
  const blockCount = rules.filter(r => r.status === '阻断').length;
  const warningCount = rules.filter(r => r.status === '告警').length;
  const qualityScore = Math.max(0, Math.min(100, 100 - blockCount * 25 - warningCount * 4 - (formulaCostRows ? 1 : 0)));
  const mappingField = (table, field) => table.header && Object.prototype.hasOwnProperty.call(table.header.index, field) ? field : '';
  const mappingRows = [
    ['统计周期 period', mappingField(workforceTable, 'period') || mappingField(outputTable, 'period'), '业务日期 / 月份', '必填'],
    ['组织编码 org_code', mappingField(workforceTable, 'org_code') || mappingField(outputTable, 'org_code'), '组织维度 / 编码', '必填'],
    ['平均 FTE average_fte', mappingField(workforceTable, 'average_fte'), '人力投入 / 月均 FTE', '必填'],
    ['工资总额 salary_cost', mappingField(workforceTable, 'salary_cost'), '人工成本 / 工资', '必填'],
    ['人工成本 labor_cost_total', mappingField(workforceTable, 'labor_cost_total'), '人工成本 / 全口径', '必填'],
    ['确认收入 recognized_revenue', mappingField(outputTable, 'recognized_revenue'), '业务产出 / 确认收入', '必填'],
    ['经营利润 operating_profit', mappingField(outputTable, 'operating_profit'), '业务产出 / 经营利润', '必填'],
    ['毛利 gross_profit', mappingField(outputTable, 'gross_profit'), '业务产出 / 毛利', '推荐'],
    ['有效工时 productive_hours', mappingField(workforceTable, 'productive_hours'), '过程协同 / 有效工时', '推荐'],
    ['返工率 / 质量指标', mappingField(processTable, 'metric_value'), '过程质量 / 长表', '可选']
  ].map(([standard, source, model, required]) => ({ standard, source, model, required, status: source ? '已识别' : required === '必填' ? '缺失' : '未覆盖' }));

  return {
    sourceName, format: parsed.format, sheetNames, requiredSheetStatuses, missingRequiredSheets,
    tables: { org: orgTable, workforce: workforceTable, output: outputTable, process: processTable, config: configTable, target: targetTable },
    periods, byPeriod, orgNameMap, rules, qualityScore, blockCount, warningCount, mappingRows,
    stats: { recordCount: workforceTable.rows.length + outputTable.rows.length + processTable.rows.length, workforceRows: workforceTable.rows.length, outputRows: outputTable.rows.length, processRows: processTable.rows.length, formulaCostRows }
  };
}

async function m1ReadFile(file) {
  const name = String(file?.name || '').toLowerCase();
  if (!file) throw new Error('未找到待导入的文件。');
  if (name.endsWith('.xlsx')) return m1ParseXlsxBuffer(await file.arrayBuffer());
  if (name.endsWith('.csv')) return m1ParseCsvText(await file.text());
  throw new Error('仅支持 .xlsx 或 .csv 文件。M1 多工作表标准导入推荐使用 .xlsx。');
}

async function m1AnalyzeFile(file) {
  const parsed = await m1ReadFile(file);
  return m1BuildSnapshot(parsed, file.name || '本地数据文件');
}

// Node test adapter only; browser integration calls m1AnalyzeFile(file).
export { m1ParseXlsxBuffer, m1BuildSnapshot, m1AnalyzeFile, m1ParseCsvText };
