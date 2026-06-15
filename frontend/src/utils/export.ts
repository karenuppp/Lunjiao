import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'
import * as XLSX from 'xlsx'

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

/** Export markdown content to .docx, preserving headings/lists/paragraphs. */
export async function exportToDocx(content: string, filename = '回答整理.docx') {
  const lines = content.split('\n')
  const children: Paragraph[] = []
  let inTable = false
  let inCodeBlock = false

  for (const rawLine of lines) {
    let line = rawLine.trim()

    // Skip empty lines, table rows, and code blocks
    if (!line) continue
    if (line.startsWith('|') && line.endsWith('|')) { inTable = true; continue }
    if (inTable && !line.startsWith('|')) { inTable = false }
    if (inTable) continue
    if (line.startsWith('```')) { inCodeBlock = !inCodeBlock; continue }
    if (inCodeBlock) continue

    // Strip horizontal rules
    if (/^[-*_]{3,}$/.test(line)) continue

    // Strip blockquote marker
    line = line.replace(/^>\s*/, '')

    // Heading: # ## ### ...
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const text = stripInlineMarkdown(headingMatch[2])
      const sizeMap: Record<number, number> = { 1: 36, 2: 32, 3: 28, 4: 26, 5: 24, 6: 24 }
      children.push(new Paragraph({
        children: [new TextRun({ text, size: sizeMap[level] || 24, bold: true })],
        spacing: { before: 240, after: 120 },
        heading: HeadingLevel[`HEADING_${level}` as keyof typeof HeadingLevel] || undefined,
      }))
      continue
    }

    // Numbered list: "1. " "2. " "3. " — preserve numbering
    const numberedMatch = line.match(/^(\d+)\.\s+(.+)/)
    if (numberedMatch) {
      const text = stripInlineMarkdown(numberedMatch[2])
      children.push(new Paragraph({
        children: [new TextRun({ text: `${numberedMatch[1]}. ${text}`, size: 24 })],
        spacing: { after: 80 },
        indent: { left: 480 },
      }))
      continue
    }

    // Bullet list: "- " "* " "+ "
    const bulletMatch = line.match(/^[-*+]\s+(.+)/)
    if (bulletMatch) {
      const text = stripInlineMarkdown(bulletMatch[1])
      children.push(new Paragraph({
        children: [new TextRun({ text: `• ${text}`, size: 24 })],
        spacing: { after: 80 },
        indent: { left: 480 },
      }))
      continue
    }

    // Regular paragraph
    const text = stripInlineMarkdown(line)
    children.push(new Paragraph({
      children: [new TextRun({ text, size: 24 })],
      spacing: { after: 120 },
    }))
  }

  const doc = new Document({ sections: [{ children }] })
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
