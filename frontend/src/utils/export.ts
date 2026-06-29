import { Document, Packer, Paragraph, TextRun, AlignmentType, LineRuleType } from 'docx'
import * as XLSX from 'xlsx'

// ── 公文格式 constants ──
const PT = 20 // twips per point
const HALF_PT = 2 // half-points per point
const CM_TO_TWIPS = (cm: number) => Math.round(cm / 2.54 * 1440)

const TITLE_SIZE = 22 * HALF_PT       // 22pt → 44 half-pts
const HEADING_SIZE = 16 * HALF_PT     // 16pt → 32 half-pts
const BODY_SIZE = 16 * HALF_PT
const LINE_SPACING = 28 * PT          // 28pt → 560 twips
const INDENT_2CHAR = 32 * PT          // 2 chars at 16pt → 640 twips

const FONT_TITLE = '方正小标宋简体'
const FONT_H1 = '黑体'
const FONT_H2 = '楷体_GB2312'
const FONT_BODY = '仿宋_GB2312'

// Regex for Chinese official document numbered headings
const RE_H1_NUM = /^[一二三四五六七八九十]、/
const RE_H2_NUM = /^（[一二三四五六七八九十]）/
const RE_H3_NUM = /^\d+\./
const RE_H4_NUM = /^（\d+）/

/** Parse markdown tables from content. Returns [{ headers, rows }] for each table found. */
export function parseMarkdownTables(content: string): { headers: string[]; rows: string[][] }[] {
  const tables: { headers: string[]; rows: string[][] }[] = []
  const lines = content.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trim()
    if (line.startsWith('|') && line.endsWith('|') && lines[i + 1]?.trim().match(/^\|[\s\-:|]+\|$/)) {
      const headers = line
        .split('|')
        .slice(1, -1)
        .map(h => h.trim())
      const rows: string[][] = []
      i += 2

      while (i < lines.length) {
        const rowLine = lines[i].trim()
        if (rowLine.startsWith('|') && rowLine.endsWith('|')) {
          const cells = rowLine
            .split('|')
            .slice(1, -1)
            .map(c => c.trim())
          rows.push(cells)
          i++
        } else {
          break
        }
      }

      if (rows.length > 0) {
        tables.push({ headers, rows })
      }
    } else {
      i++
    }
  }

  return tables
}

/** Check if content has a markdown table with more than minRows data rows. */
export function hasLargeTable(content: string, minRows = 10): boolean {
  return parseMarkdownTables(content).some(t => t.rows.length > minRows)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Strip inline markdown formatting: bold, italic, links, code, strikethrough. */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\!\[.*?\]\(.*?\)/g, '')         // images → remove
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // links → text
    .replace(/\*\*(.+?)\*\*/g, '$1')            // bold
    .replace(/\*(.+?)\*/g, '$1')                // italic
    .replace(/`{1,3}[^`]*`{1,3}/g, '')         // inline code → remove
    .replace(/~~(.+?)~~/g, '$1')                // strikethrough
}

function makeRun(text: string, font: string, size: number, bold = false): TextRun {
  return new TextRun({ text, font, size, bold })
}

function makePara(
  run: TextRun,
  alignment: typeof AlignmentType[keyof typeof AlignmentType] = AlignmentType.JUSTIFIED,
  firstLineIndent = 0,
  leftIndent = 0,
  spacingBefore = 0,
): Paragraph {
  return new Paragraph({
    children: [run],
    alignment,
    spacing: {
      line: LINE_SPACING,
      lineRule: LineRuleType.EXACTLY,
      before: spacingBefore * PT,
      after: 0,
    },
    indent: firstLineIndent
      ? { firstLine: firstLineIndent }
      : leftIndent
        ? { left: leftIndent }
        : undefined,
  })
}

/** Classify a line without markdown heading prefix into a 公文 heading level. */
function classifyNumberedHeading(line: string): 0 | 1 | 2 | 3 | 4 {
  if (RE_H1_NUM.test(line)) return 1
  if (RE_H2_NUM.test(line)) return 2
  if (RE_H3_NUM.test(line)) return 3
  if (RE_H4_NUM.test(line)) return 4
  return 0
}

/** Export markdown content to .docx with 公文格式 (Chinese official document formatting). */
export async function exportToDocx(content: string, filename = '公文格式.docx') {
  const lines = content.split('\n')
  const paragraphs: Paragraph[] = []
  let inTable = false
  let inCodeBlock = false
  let titleDone = false

  for (const rawLine of lines) {
    let line = rawLine.trim()

    if (!line) continue
    if (line.startsWith('|') && line.endsWith('|')) { inTable = true; continue }
    if (inTable && !line.startsWith('|')) { inTable = false }
    if (inTable) continue
    if (line.startsWith('```')) { inCodeBlock = !inCodeBlock; continue }
    if (inCodeBlock) continue
    if (/^[-*_]{3,}$/.test(line)) continue

    // Strip blockquote marker
    line = line.replace(/^>\s*/, '')

    const text = stripInlineMarkdown(line)

    // Markdown headings
    const h1m = line.match(/^#\s+(.+)/)
    const h2m = line.match(/^##\s+(.+)/)
    const h3m = line.match(/^###\s+(.+)/)
    const h4m = line.match(/^####\s+(.+)/)
    const h5m = line.match(/^#####\s+(.+)/)

    if (h1m && !titleDone) {
      paragraphs.push(makePara(
        makeRun(stripInlineMarkdown(h1m[1]), FONT_TITLE, TITLE_SIZE),
        AlignmentType.CENTER,
      ))
      titleDone = true
      continue
    }

    if (h2m) {
      paragraphs.push(makePara(
        makeRun(stripInlineMarkdown(h2m[1]), FONT_H1, HEADING_SIZE),
        AlignmentType.JUSTIFIED, 0, INDENT_2CHAR,
      ))
      continue
    }

    if (h3m) {
      paragraphs.push(makePara(
        makeRun(stripInlineMarkdown(h3m[1]), FONT_H2, HEADING_SIZE),
        AlignmentType.JUSTIFIED, 0, INDENT_2CHAR,
      ))
      continue
    }

    if (h4m) {
      paragraphs.push(makePara(
        makeRun(stripInlineMarkdown(h4m[1]), FONT_BODY, HEADING_SIZE),
        AlignmentType.JUSTIFIED, 0, INDENT_2CHAR,
      ))
      continue
    }

    if (h5m) {
      paragraphs.push(makePara(
        makeRun(stripInlineMarkdown(h5m[1]), FONT_BODY, HEADING_SIZE),
        AlignmentType.JUSTIFIED, 0, 0, 6,
      ))
      continue
    }

    // Numbered Chinese headings (without # prefix)
    const level = classifyNumberedHeading(line)
    if (level === 1) {
      paragraphs.push(makePara(
        makeRun(text, FONT_H1, HEADING_SIZE),
        AlignmentType.JUSTIFIED, 0, INDENT_2CHAR,
      ))
      continue
    }
    if (level === 2) {
      paragraphs.push(makePara(
        makeRun(text, FONT_H2, HEADING_SIZE),
        AlignmentType.JUSTIFIED, 0, INDENT_2CHAR,
      ))
      continue
    }
    if (level === 3 || level === 4) {
      paragraphs.push(makePara(
        makeRun(text, FONT_BODY, HEADING_SIZE),
        AlignmentType.JUSTIFIED, 0, INDENT_2CHAR,
      ))
      continue
    }

    // Bullet list — keep bullet, no indent
    const bulletMatch = line.match(/^[-*+]\s+(.+)/)
    if (bulletMatch) {
      paragraphs.push(makePara(
        makeRun('\u2022 ' + stripInlineMarkdown(bulletMatch[1]), FONT_BODY, BODY_SIZE),
        AlignmentType.JUSTIFIED, INDENT_2CHAR,
      ))
      continue
    }

    // Body paragraph — 仿宋, first-line indent
    paragraphs.push(makePara(
      makeRun(text, FONT_BODY, BODY_SIZE),
      AlignmentType.JUSTIFIED, INDENT_2CHAR,
    ))
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: CM_TO_TWIPS(2.54),
            bottom: CM_TO_TWIPS(2.54),
            left: CM_TO_TWIPS(3.17),
            right: CM_TO_TWIPS(3.17),
          },
        },
      },
      children: paragraphs,
    }],
  })

  const blob = await Packer.toBlob(doc)
  downloadBlob(blob, filename)
}

/** Export all markdown tables in content to .xlsx (one sheet per table). */
export function exportToXlsx(content: string, filename = '表格数据.xlsx') {
  const tables = parseMarkdownTables(content)

  if (tables.length === 0) return

  const wb = XLSX.utils.book_new()

  tables.forEach((table, idx) => {
    const sheetData = [table.headers, ...table.rows]
    const ws = XLSX.utils.aoa_to_sheet(sheetData)
    const sheetName = tables.length > 1 ? `表格${idx + 1}` : 'Sheet1'
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)) // Excel sheet name limit
  })

  XLSX.writeFile(wb, filename)
}

/** Sanitize a string for use as a filename. */
export function sanitizeFilename(name: string, fallback = 'download'): string {
  const sanitized = name
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 100)
  return sanitized || fallback
}
