// مفردات مرتب — HR Letter engine (pure string/logic helpers, no deps).
// Fills Hassan's exact Word template. Read-only with respect to his data.

export type Sector = 'bank' | 'consumer' | 'installment' | 'gov';
export type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

export interface LetterFields {
  entity: string;       // الجهة الموجه لها الخطاب
  name: string;
  nid: string;          // الرقم القومي
  job: string;          // الوظيفة (مرتبات أو تأمينات حسب القطاع)
  startIso: string;     // تاريخ بداية الفترة (تاريخ التعيين) yyyy-mm-dd
  amount: number;       // المبلغ بالأرقام
  printDate: string;    // تاريخ التحرير بصيغة «dd / mm / yyyy»
  governorate: string;
  region: string;
  department: string;
  accountName: string;  // اسم الأكونت (غاز مصر / مودرن جاز)
}

const ONES = ['','واحد','اثنان','ثلاثة','أربعة','خمسة','ستة','سبعة','ثمانية','تسعة','عشرة',
  'أحد عشر','اثنا عشر','ثلاثة عشر','أربعة عشر','خمسة عشر','ستة عشر','سبعة عشر','ثمانية عشر','تسعة عشر'];
const TENS = ['','عشرة','عشرون','ثلاثون','أربعون','خمسون','ستون','سبعون','ثمانون','تسعون'];
const HUNDREDS = ['','مائه','مائتان','ثلاثمائه','ربعمائه','خمسمائه','ستمائه','سبعمائه','ثمانمائه','تسعمائه'];

function two(n: number): string {
  if (n < 20) return ONES[n];
  const o = n % 10, t = Math.floor(n / 10);
  return o ? ONES[o] + ' و ' + TENS[t] : TENS[t];
}

export function tafqeet(n: number): string {
  n = Math.round(n);
  if (n === 0) return 'صفر';
  const parts: string[] = [];
  const thousands = Math.floor(n / 1000), rest = n % 1000;
  if (thousands) {
    if (thousands === 1) parts.push('الف');
    else if (thousands === 2) parts.push('الفان');
    else if (thousands <= 10) parts.push(ONES[thousands] + ' آلاف');
    else parts.push(two(thousands) + ' الف');
  }
  const h = Math.floor(rest / 100), rem = rest % 100;
  const seg: string[] = [];
  if (h) seg.push(HUNDREDS[h]);
  if (rem) seg.push(two(rem));
  parts.push(seg.join(' و '));
  return parts.filter(Boolean).join(' و ');
}

// yyyy-mm-dd -> «dd / mm / yyyy» (اليوم يمين، الشهر في النص، السنة شمال)
export function egDate(iso: string): string {
  const m = String(iso || '').trim().match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]} / ${m[2]} / ${m[1]}`;
}

export function quarterMonths(q: Quarter): number[] {
  return q === 'Q1' ? [1,2,3] : q === 'Q2' ? [4,5,6] : q === 'Q3' ? [7,8,9] : [10,11,12];
}

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

const RPR = '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" /><w:b /><w:bCs /><w:sz w:val="28" /><w:szCs w:val="28" /><w:rtl /><w:lang w:bidi="ar-EG" /></w:rPr>';

function collapsePara(p: string, newText: string): string {
  const m = p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const ppr = m ? m[0] : '';
  const openTag = p.slice(0, p.indexOf('>') + 1);
  return openTag + ppr + '<w:r>' + RPR + '<w:t xml:space="preserve">' + esc(newText) + '</w:t></w:r></w:p>';
}

const BODY = (f: LetterFields, words: string) =>
  'بهذا نفيد سيادتكم بأن السيد/ ' + f.name + ' , يعمل لدي شركة/ المؤسسة العربية للتوريدات والمقاولات العمومية ، ' +
  'ويحمل بطاقة رقم قومى/  ' + f.nid + ' بوظيفة/ ' + f.job + ' عن الفترة من ' + egDate(f.startIso) +
  ' حتى الان مع العلم ان صافى الدخل الشهرى الخاص به هو (' + Math.round(f.amount) + ' ) فقط ' + words + ' جنيها مصري لا غير.';

// Front page: replace entity line, body paragraph, print-date line. Returns {xml, words}.
export function fillFront(xml: string, f: LetterFields): { xml: string; words: string } {
  const words = tafqeet(f.amount);
  const paras = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
  for (const p of paras) {
    if (p.includes('السادة/')) xml = xml.replace(p, collapsePara(p, 'السادة/ ' + f.entity));
    else if (p.includes('بهذا نفيد')) xml = xml.replace(p, collapsePara(p, BODY(f, words)));
    else if (p.includes('تحريرا في')) xml = xml.replace(p, collapsePara(p, 'تحريرا في :  ' + f.printDate + ' '));
  }
  return { xml, words };
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function lightCell(text: string, bold: boolean): string {
  const b = bold ? '<w:b /><w:bCs />' : '';
  const rpr = '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" />' + b +
    '<w:color w:val="D9D9D9" /><w:sz w:val="18" /><w:szCs w:val="18" /><w:rtl /><w:lang w:bidi="ar-EG" /></w:rPr>';
  return '<w:tc><w:tcPr><w:tcW w:w="2018" w:type="dxa" /></w:tcPr>' +
    '<w:p><w:pPr><w:jc w:val="center" />' + rpr + '</w:pPr><w:r>' + rpr +
    '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r></w:p></w:tc>';
}

export function backFooterXml(f: LetterFields): string {
  const nb = ['top','left','bottom','right','insideH','insideV']
    .map(s => `<w:${s} w:val="none" w:sz="0" w:space="0" w:color="auto" />`).join('');
  const labels = ['المحافظة', 'المنطقة', 'الإدارة', 'تاريخ الطباعة', 'الأكونت'];
  const values = [f.governorate, f.region, f.department, f.printDate, f.accountName];
  const row1 = '<w:tr>' + labels.map(t => lightCell(t, true)).join('') + '</w:tr>';
  const row2 = '<w:tr>' + values.map(v => lightCell(v, false)).join('') + '</w:tr>';
  const tbl = '<w:tbl><w:tblPr><w:tblW w:w="10092" w:type="dxa" /><w:bidiVisual />' +
    '<w:tblBorders>' + nb + '</w:tblBorders></w:tblPr>' +
    '<w:tblGrid>' + '<w:gridCol w:w="2018" />'.repeat(5) + '</w:tblGrid>' + row1 + row2 + '</w:tbl>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ' + NS + '>' + tbl +
    '<w:p><w:pPr><w:rPr><w:sz w:val="2" /></w:rPr></w:pPr></w:p></w:ftr>';
}

export const BLANK_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr ' + NS + '><w:p /></w:hdr>';

// Back page: own section, no border, blank header, very light bottom line. Returns {xml, extras}.
export function addBackSection(xml: string, f: LetterFields): { xml: string; extras: Record<string, string> } {
  const i = xml.lastIndexOf('<w:sectPr');
  const j = xml.lastIndexOf('</w:sectPr>') + '</w:sectPr>'.length;
  const sect = xml.slice(i, j);
  let backSect = sect.replace(/<w:pgBorders[\s\S]*?<\/w:pgBorders>/, '');
  backSect = backSect.replace('r:id="rId8"', 'r:id="rId100"').replace('r:id="rId9"', 'r:id="rId101"');
  const bodyEnd = xml.lastIndexOf('</w:body>');
  const out = xml.slice(0, i)
    + '<w:p><w:pPr>' + sect + '</w:pPr></w:p>'
    + '<w:p />'
    + backSect
    + xml.slice(bodyEnd);
  return { xml: out, extras: { 'word/header2.xml': BLANK_HEADER, 'word/footer2.xml': backFooterXml(f) } };
}

export function patchRels(rels: string): string {
  const add = '<Relationship Id="rId100" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml" />' +
    '<Relationship Id="rId101" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml" />';
  return rels.replace('</Relationships>', add + '</Relationships>');
}

export function patchContentTypes(ct: string): string {
  const add = '<Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml" />' +
    '<Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml" />';
  return ct.replace('</Types>', add + '</Types>');
}

// Governorate from free-text address: last segment after a dash («جهينة - سوهاج» -> سوهاج)
export function governorateFromAddress(address: string): string {
  const parts = String(address || '').split(/[-–—]/).map(s => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

export function accountDisplay(companyAccount: string): string {
  const c = String(companyAccount || '').toUpperCase();
  if (c === 'E.G' || c === 'EG') return 'غاز مصر';
  if (c === 'M.G' || c === 'MG') return 'مودرن جاز';
  return companyAccount || '';
}
