import { SaxesParser } from 'saxes'
import { readArchive } from './history/zipReader.js'

export type OfficeFormat = 'docx' | 'pptx' | 'xlsx'

const MAX_XML_BYTES = 48 * 1024 * 1024
const MAX_TEXT_LENGTH = 32 * 1024 * 1024
const PART_ORIGIN = 'https://office-package.invalid'
const pathPrefix: Record<OfficeFormat, string> = { docx: 'word/', pptx: 'ppt/', xlsx: 'xl/' }

type Xml = {
  name: string
  attributes: Map<string, string>
  relationshipId?: string
  children: Xml[]
  text: string
}

const xmlError = (): never => {
  throw new Error('Invalid Office XML package')
}

const parseXml = (content: string, discard?: (node: Xml, parent: Xml) => boolean): Xml => {
  const parser = new SaxesParser({ xmlns: true })
  const stack: Xml[] = []
  let root: Xml | undefined
  parser.on('doctype', xmlError)
  parser.on('opentag', ({ local, attributes }) => {
    const node: Xml = { name: local, attributes: new Map(), children: [], text: '' }
    for (const attr of Object.values(attributes)) {
      if (attr.local === 'id' && attr.uri.endsWith('/relationships')) {
        node.relationshipId = attr.value
      } else if (!attr.uri || attr.local === 'id' || attr.local === 'type') {
        node.attributes.set(attr.local, attr.value)
      }
    }
    const parent = stack.at(-1)
    if (stack.length >= 128) {
      xmlError()
    }
    if (parent) {
      parent.children.push(node)
    } else {
      root = node
    }
    stack.push(node)
  })
  const append = (text: string) => {
    const node = stack.at(-1)
    if (node && (text.trim() || node.name === 't')) {
      node.text += text
    }
  }
  parser.on('text', append)
  parser.on('cdata', append)
  parser.on('closetag', () => {
    const node = stack.pop()
    const parent = stack.at(-1)
    if (node && parent && discard?.(node, parent)) {
      parent.children.pop()
    }
  })
  parser.write(content).close()
  return root ?? xmlError()
}

const child = (node: Xml | undefined, name: string) =>
  node?.children.find((entry) => entry.name === name)

const children = (node: Xml | undefined, name: string) =>
  node?.children.filter((entry) => entry.name === name) ?? []

const runText = (node: Xml): string => {
  switch (node.name) {
    case 't':
      return node.text
    case 'tab':
      return '\t'
    case 'br':
    case 'cr':
      return '\n'
    case 'del':
    case 'moveFrom':
      return ''
    case 'footnoteReference':
      return '[脚注 ' + (node.attributes.get('id') ?? '') + ']'
    case 'endnoteReference':
      return '[尾注 ' + (node.attributes.get('id') ?? '') + ']'
    default:
      return node.children.map(runText).join('')
  }
}

/** Word 正文按段落/表格行提取，幻灯片中的 DrawingML 文本使用相同的段落结构。 */
function* paragraphs(node: Xml): Generator<string> {
  for (const item of node.children) {
    if (item.name === 'p') {
      const text = runText(item).trim()
      if (text) {
        yield text
      }
    } else if (item.name === 'tr') {
      const cells = children(item, 'tc').map((cell) =>
        [...paragraphs(cell)].join(' ').replaceAll('\t', ' ')
      )
      if (cells.some(Boolean)) {
        yield cells.join('\t')
      }
    } else if (item.name !== 'del' && item.name !== 'moveFrom') {
      yield* paragraphs(item)
    }
  }
}

const partRelationships = (part: string) => {
  const slash = part.lastIndexOf('/')
  return part.slice(0, slash + 1) + '_rels/' + part.slice(slash + 1) + '.rels'
}

const relationships = (parts: Map<string, string>, part: string) => {
  const data = parts.get(partRelationships(part))
  return children(data ? parseXml(data) : undefined, 'Relationship').flatMap((item) => {
    const id = item.attributes.get('Id')
    const target = item.attributes.get('Target')
    const type = item.attributes.get('Type')
    if (!id || !type || !target || item.attributes.get('TargetMode') === 'External') {
      return []
    }
    const url = new URL(target, PART_ORIGIN + '/' + part)
    return url.origin === PART_ORIGIN
      ? [{ id, type, path: decodeURIComponent(url.pathname.slice(1)) }]
      : []
  })
}

const requiredPart = (parts: Map<string, string>, path: string) =>
  parseXml(parts.get(path) ?? xmlError())

function* wordText(parts: Map<string, string>, path: string): Generator<string> {
  const body = child(requiredPart(parts, path), 'body') ?? xmlError()
  yield* paragraphs(body)
  const labels = new Map([
    ['footnotes', '脚注'],
    ['endnotes', '尾注'],
    ['header', '页眉'],
    ['footer', '页脚'],
  ])
  for (const relation of relationships(parts, path)) {
    const part = labels.get(relation.type.split('/').at(-1) ?? '')
    if (part && parts.has(relation.path)) {
      const root = requiredPart(parts, relation.path)
      const notes = root.name === 'footnotes' || root.name === 'endnotes' ? root.children : [root]
      for (const note of notes) {
        if (!note.attributes.has('type')) {
          const id = note.attributes.get('id')
          for (const line of paragraphs(note)) {
            yield '[' + part + (id ? ' ' + id : '') + '] ' + line
          }
        }
      }
    }
  }
}

function* presentationText(parts: Map<string, string>, path: string): Generator<string> {
  const presentation = requiredPart(parts, path)
  const slides = children(child(presentation, 'sldIdLst'), 'sldId')
  const relations = new Map(relationships(parts, path).map((item) => [item.id, item.path]))
  for (const [index, slide] of slides.entries()) {
    const slidePath = relations.get(slide.relationshipId ?? '') ?? xmlError()
    const prefix = '[幻灯片 ' + (index + 1) + '] '
    for (const line of paragraphs(requiredPart(parts, slidePath))) {
      yield prefix + line
    }
    const notes = relationships(parts, slidePath).find(({ type }) => type.endsWith('/notesSlide'))
    if (notes) {
      for (const line of paragraphs(requiredPart(parts, notes.path))) {
        yield prefix + '备注 ' + line
      }
    }
  }
}

const cellText = (cell: Xml, shared: string[]) => {
  const reference = cell.attributes.get('r')
  const type = cell.attributes.get('t')
  const raw = child(cell, 'v')?.text ?? ''
  const inline = child(cell, 'is')
  let value = raw
  if (type === 's' && raw !== '') {
    value = shared[Number(raw)] ?? xmlError()
  } else if (type === 'inlineStr' && inline) {
    value = runText(inline)
  } else if (type === 'b') {
    value = raw === '1' ? 'TRUE' : 'FALSE'
  }
  const formula = child(cell, 'f')?.text
  const result = formula ? '=' + formula + (value ? ' [缓存值 ' + value + ']' : '') : value
  return result ? (reference ? reference + ' ' : '') + JSON.stringify(result) : ''
}

function* spreadsheetText(parts: Map<string, string>, path: string): Generator<string> {
  const workbook = requiredPart(parts, path)
  const related = relationships(parts, path)
  const sheets = children(child(workbook, 'sheets'), 'sheet')
  const stringsPart = related.find(({ type }) => type.endsWith('/sharedStrings'))?.path
  const shared = stringsPart ? children(requiredPart(parts, stringsPart), 'si').map(runText) : []
  const worksheets = new Map(
    related.filter(({ type }) => type.endsWith('/worksheet')).map(({ id, path }) => [id, path])
  )
  for (const sheet of sheets) {
    const sheetPath = worksheets.get(sheet.relationshipId ?? '')
    if (!sheetPath) {
      continue
    }
    const name = sheet.attributes.get('name') ?? sheetPath
    const lines: string[] = []
    let index = 0
    let sheetLength = 0
    // 工作表可能包含大量空行/小单元格，逐行处理后释放节点。
    parseXml(parts.get(sheetPath) ?? xmlError(), (row, parent) => {
      if (row.name !== 'row' || parent.name !== 'sheetData') {
        return false
      }
      index++
      const cells: string[] = []
      let length = 0
      for (const cell of children(row, 'c')) {
        const text = cellText(cell, shared)
        length += text.length + 1
        if (length > MAX_TEXT_LENGTH) {
          xmlError()
        }
        if (text) {
          cells.push(text)
        }
      }
      if (cells.length) {
        const line =
          '[工作表 ' +
          name +
          ' 第 ' +
          (row.attributes.get('r') ?? index) +
          ' 行] ' +
          cells.join('\t')
        sheetLength += line.length + 1
        if (sheetLength > MAX_TEXT_LENGTH) {
          xmlError()
        }
        lines.push(line)
      }
      return true
    })
    yield* lines
  }
}

export const readOfficeText = async (format: OfficeFormat, blob: Blob, signal: AbortSignal) => {
  const prefix = pathPrefix[format]
  const select = (path: string) =>
    path === '_rels/.rels' || (path.startsWith(prefix) && /\.(?:xml|rels)$/i.test(path))
  const parts = new Map<string, string>()
  let size = 0
  for await (const entry of readArchive(blob, undefined, select)) {
    signal.throwIfAborted()
    size += entry.size
    if (size > MAX_XML_BYTES) {
      xmlError()
    }
    const data = new Uint8Array(entry.size)
    let offset = 0
    for await (const chunk of entry.stream) {
      signal.throwIfAborted()
      data.set(chunk, offset)
      offset += chunk.byteLength
    }
    const encoding =
      data[0] === 0xff && data[1] === 0xfe
        ? 'utf-16le'
        : data[0] === 0xfe && data[1] === 0xff
          ? 'utf-16be'
          : 'utf-8'
    parts.set(entry.path, new TextDecoder(encoding, { fatal: true }).decode(data))
  }
  const main =
    relationships(parts, '').find(({ type }) => type.endsWith('/officeDocument'))?.path ??
    xmlError()
  const sections =
    format === 'docx'
      ? wordText(parts, main)
      : format === 'pptx'
        ? presentationText(parts, main)
        : spreadsheetText(parts, main)
  const text: string[] = []
  let length = 0
  for (const section of sections) {
    signal.throwIfAborted()
    length += section.length + 1
    if (length > MAX_TEXT_LENGTH) {
      xmlError()
    }
    text.push(section)
  }
  return text.join('\n')
}
