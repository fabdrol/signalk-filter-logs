import Debug from 'debug'
import linereader from 'line-reader'
import minimist, { ParsedArgs } from 'minimist'
import { join } from 'path'
import { promises as fs } from 'fs'
import { Promise as Bluebird } from 'bluebird'

const eachLine = Bluebird.promisify(linereader.eachLine)
const types = new Set(['csv', 'json'])
const globalPathStarts = new Set(['/', '~'])
const debug = Debug('signalk-filter-logs')
const argv: ParsedArgs = minimist(process.argv.slice(2))

let { logs, l, output, o, type, t, context, c, filter, f, extension } = argv

if (typeof logs !== 'string' && typeof l !== 'string') {
  console.error(`Please provide a logs file location`)
  process.exit(1)
}

if (typeof output !== 'string' && typeof o !== 'string') {
  output = process.cwd()
}

if (typeof type !== 'string' && typeof t !== 'string') {
  type = 'csv'
}

extension =
  typeof extension === 'string' && extension.startsWith('.') && extension.length > 1
    ? extension
    : '.log'
logs = logs || l
filter = filter || f || []
context = context || c || null
output = output || o
type = types.has(type || t) ? type || t : 'csv'

if (!globalPathStarts.has(output.charAt(0))) {
  output = join(process.cwd(), output)
}

if (!globalPathStarts.has(logs.charAt(0))) {
  logs = join(process.cwd(), logs)
}

if (typeof filter === 'string' && filter.trim().length > 0) {
  filter = filter.split(',')
}

console.log('Starting...')

debug(`Logs: ${logs}`)
debug(`Output: ${output}`)
debug(`Type: ${type}`)
debug(`Filter: ${JSON.stringify(filter)}`)
debug(`Context: ${context}`)

interface GenericObject<T> {
  [key: string]: T
}

interface SignalKValue {
  path: string
  value: number | string | null
  $source: string
}

interface SignalKUpdate {
  source: string | GenericObject<string>
  timestamp: string
  values: SignalKValue[]
}

interface SignalKDelta {
  updates: SignalKUpdate[]
  context?: string
}

interface FilteredOutput {
  context: string
  timestamp: string
  source: string
  pgn: string
  [path: string]: number | string | null
}

function createCSV(deltas: FilteredOutput[]): string {
  let csv = ''
  const headers = new Set()

  deltas.forEach((delta: FilteredOutput) => {
    Object.keys(delta).forEach((header: string) => {
      if (!headers.has(header)) {
        headers.add(header)
      }
    })
  })

  csv += Array.from(headers.values()).join(';')

  deltas.forEach((delta: FilteredOutput) => {
    const line = []
    headers.forEach((header: string, index: number) => {
      line.push(delta.hasOwnProperty(header) ? delta[header] : '')
    })

    csv += '\n'
    csv += line.join(';')
  })

  csv += '\n'
  return csv
}

function shouldIncludeLine(line: SignalKDelta, _filter: string[]): boolean {
  let include: boolean = false

  line.updates.forEach((update: SignalKUpdate) => {
    update.values.forEach((mutation: SignalKValue) => {
      const { path } = mutation

      _filter.forEach((term: string) => {
        if (path.includes(term)) {
          include = true
        }
      })
    })
  })

  return include
}

// {"updates":[{"source":{"label":"can1","type":"NMEA2000","pgn":127250,"src":"204"},"timestamp":"2020-04-12T11:27:21.475Z","values":[{"path":"navigation.headingMagnetic","value":1.7406}],"$source":"can1.204"}],"context":"vessels.urn:mrn:imo:mmsi:244016949"}
function readFileFiltered(lines: any[], file: string, _filter: string[], _context: string | null) {
  let linecount = 0

  return eachLine(file, (line: string) => {
    if (_context && !line.includes(`"context":"${_context}"`)) {
      return
    }

    try {
      const _line = JSON.parse(line)

      if (_filter.length === 0 || shouldIncludeLine(_line, _filter)) {
        linecount += 1
        lines.push(_line)
      }
    } catch (e) {
      debug(`Error parsing line: ${line}`)
    }
  }).then(() => linecount)
}

function parseValue(value: any) {
  if (typeof value === 'string' || typeof value === 'number') {
    return value
  }

  if (value && typeof value === 'object') {
    let out = ''
    Object.values(value).forEach((val: any) => {
      out += out === '' ? val : `,${val}`
    })
    return out
  }

  return null
}

function parseToJSON(lines: string[] | SignalKDelta[], _filter: string[] = []): FilteredOutput[] {
  const list: FilteredOutput[] = []

  lines.forEach((line: string | SignalKDelta) => {
    const delta: SignalKDelta = typeof line === 'string' ? JSON.parse(line) : (line as SignalKDelta)

    const output: FilteredOutput = {
      context: delta.context || context || 'vessels.self',
      pgn: '',
      timestamp: '',
      source: '',
    }

    delta.updates.forEach((update: SignalKUpdate) => {
      output.timestamp = update.timestamp
      output.pgn = update.source && typeof update.source === 'object' ? update.source.pgn || '' : ''
      output.source =
        update.source && typeof update.source === 'object'
          ? `${update.source.label || 'unknown'}.${update.source.src || '0'}`
          : String(update.source || 'unknown.0')

      update.values.forEach((mutation: SignalKValue) => {
        if (_filter.length === 0) {
          output[mutation.path] = parseValue(mutation.value)
        } else {
          _filter.forEach((path: string) => {
            if (mutation.path.includes(path)) {
              output[mutation.path] = parseValue(mutation.value)
            }
          })
        }
      })
    })

    list.push(output)
  })

  return list
}

async function main() {
  const path = logs
  const files = await fs.readdir(path)
  const lines: any[] = []
  const timer = `... Filtering of ${files.length} log files took`
  let count = 0

  console.time(timer)

  for (const fn of files) {
    count += 1

    if (!fn.endsWith(extension)) {
      continue
    }

    try {
      const linecount: number = await readFileFiltered(lines, join(path, fn), filter, context)
      console.log(
        `... (${count}/${files.length}) ${linecount} lines matched in ${fn} (cumulative: ${lines.length})`
      )
    } catch (e) {
      console.error(`Fatal error: ${e.message}`)
      process.exit(1)
    }
  }

  const outfilename = join(output, `filtered_${new Date().toISOString()}`)
  const intermediate: FilteredOutput[] = parseToJSON(lines, filter)
  debug(`Got ${intermediate.length} JSON items`)

  if (type === 'json') {
    await fs.writeFile(`${outfilename}.${type}`, JSON.stringify(intermediate, null, 2), 'utf-8')
    console.log(`... Written file: ${outfilename}.${type}`)
  }

  if (type === 'csv') {
    await fs.writeFile(`${outfilename}.${type}`, createCSV(intermediate), 'utf-8')
    console.log(`... Written file: ${outfilename}.${type}`)
  }

  console.timeEnd(timer)
  console.log(`Done.`)
  process.exit(0)
}

export default main
