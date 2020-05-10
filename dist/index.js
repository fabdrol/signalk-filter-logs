"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const debug_1 = __importDefault(require("debug"));
const line_reader_1 = __importDefault(require("line-reader"));
const minimist_1 = __importDefault(require("minimist"));
const path_1 = require("path");
const fs_1 = require("fs");
const bluebird_1 = require("bluebird");
const eachLine = bluebird_1.Promise.promisify(line_reader_1.default.eachLine);
const types = new Set(['csv', 'json']);
const globalPathStarts = new Set(['/', '~']);
const debug = debug_1.default('signalk-filter-logs');
const argv = minimist_1.default(process.argv.slice(2));
let { logs, l, output, o, type, t, context, c, filter, f, extension } = argv;
if (typeof logs !== 'string' && typeof l !== 'string') {
    console.error(`Please provide a logs file location`);
    process.exit(1);
}
if (typeof output !== 'string' && typeof o !== 'string') {
    output = process.cwd();
}
if (typeof type !== 'string' && typeof t !== 'string') {
    type = 'csv';
}
extension =
    typeof extension === 'string' && extension.startsWith('.') && extension.length > 1
        ? extension
        : '.log';
logs = logs || l;
filter = filter || f || [];
context = context || c || null;
output = output || o;
type = types.has(type || t) ? type || t : 'csv';
if (!globalPathStarts.has(output.charAt(0))) {
    output = path_1.join(process.cwd(), output);
}
if (!globalPathStarts.has(logs.charAt(0))) {
    logs = path_1.join(process.cwd(), logs);
}
if (typeof filter === 'string' && filter.trim().length > 0) {
    filter = filter.split(',');
}
console.log('Starting...');
debug(`Logs: ${logs}`);
debug(`Output: ${output}`);
debug(`Type: ${type}`);
debug(`Filter: ${JSON.stringify(filter)}`);
debug(`Context: ${context}`);
function createCSV(deltas) {
    let csv = '';
    const headers = new Set();
    deltas.forEach((delta) => {
        Object.keys(delta).forEach((header) => {
            if (!headers.has(header)) {
                headers.add(header);
            }
        });
    });
    csv += Array.from(headers.values()).join(';');
    deltas.forEach((delta) => {
        const line = [];
        headers.forEach((header, index) => {
            line.push(delta.hasOwnProperty(header) ? delta[header] : '');
        });
        csv += '\n';
        csv += line.join(';');
    });
    csv += '\n';
    return csv;
}
function shouldIncludeLine(line, _filter) {
    let include = false;
    line.updates.forEach((update) => {
        update.values.forEach((mutation) => {
            const { path } = mutation;
            _filter.forEach((term) => {
                if (path.includes(term)) {
                    include = true;
                }
            });
        });
    });
    return include;
}
// {"updates":[{"source":{"label":"can1","type":"NMEA2000","pgn":127250,"src":"204"},"timestamp":"2020-04-12T11:27:21.475Z","values":[{"path":"navigation.headingMagnetic","value":1.7406}],"$source":"can1.204"}],"context":"vessels.urn:mrn:imo:mmsi:244016949"}
function readFileFiltered(lines, file, _filter, _context) {
    let linecount = 0;
    return eachLine(file, (line) => {
        if (_context && !line.includes(`"context":"${_context}"`)) {
            return;
        }
        try {
            const _line = JSON.parse(line);
            if (_filter.length === 0 || shouldIncludeLine(_line, _filter)) {
                linecount += 1;
                lines.push(_line);
            }
        }
        catch (e) {
            debug(`Error parsing line: ${line}`);
        }
    }).then(() => linecount);
}
function parseValue(value) {
    if (typeof value === 'string' || typeof value === 'number') {
        return value;
    }
    if (value && typeof value === 'object') {
        let out = '';
        Object.values(value).forEach((val) => {
            out += out === '' ? val : `,${val}`;
        });
        return out;
    }
    return null;
}
function parseToJSON(lines, _filter = []) {
    const list = [];
    lines.forEach((line) => {
        const delta = typeof line === 'string' ? JSON.parse(line) : line;
        const output = {
            context: delta.context || context || 'vessels.self',
            pgn: '',
            timestamp: '',
            source: '',
        };
        delta.updates.forEach((update) => {
            output.timestamp = update.timestamp;
            output.pgn = update.source && typeof update.source === 'object' ? update.source.pgn || '' : '';
            output.source =
                update.source && typeof update.source === 'object'
                    ? `${update.source.label || 'unknown'}.${update.source.src || '0'}`
                    : String(update.source || 'unknown.0');
            update.values.forEach((mutation) => {
                if (_filter.length === 0) {
                    output[mutation.path] = parseValue(mutation.value);
                }
                else {
                    _filter.forEach((path) => {
                        if (mutation.path.includes(path)) {
                            output[mutation.path] = parseValue(mutation.value);
                        }
                    });
                }
            });
        });
        list.push(output);
    });
    return list;
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const path = logs;
        const files = yield fs_1.promises.readdir(path);
        const lines = [];
        const timer = `... Filtering of ${files.length} log files took`;
        let count = 0;
        console.time(timer);
        for (const fn of files) {
            count += 1;
            if (!fn.endsWith(extension)) {
                continue;
            }
            try {
                const linecount = yield readFileFiltered(lines, path_1.join(path, fn), filter, context);
                console.log(`... (${count}/${files.length}) ${linecount} lines matched in ${fn} (cumulative: ${lines.length})`);
            }
            catch (e) {
                console.error(`Fatal error: ${e.message}`);
                process.exit(1);
            }
        }
        const outfilename = path_1.join(output, `filtered_${new Date().toISOString()}`);
        const intermediate = parseToJSON(lines, filter);
        debug(`Got ${intermediate.length} JSON items`);
        if (type === 'json') {
            yield fs_1.promises.writeFile(`${outfilename}.${type}`, JSON.stringify(intermediate, null, 2), 'utf-8');
            console.log(`... Written file: ${outfilename}.${type}`);
        }
        if (type === 'csv') {
            yield fs_1.promises.writeFile(`${outfilename}.${type}`, createCSV(intermediate), 'utf-8');
            console.log(`... Written file: ${outfilename}.${type}`);
        }
        console.timeEnd(timer);
        console.log(`Done.`);
        process.exit(0);
    });
}
exports.default = main;
//# sourceMappingURL=index.js.map