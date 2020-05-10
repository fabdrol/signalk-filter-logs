# signalk-filter-logs

> Small CLI utility to filter Signal K delta logfiles (produced by logger plugins such as https://www.npmjs.com/package/signalk-data-logger. Outputs a flat JSON or CSV file.

### Installation:

```javascript
$ [sudo] npm install -g signalk-filter-logs
```

### Usage:

```bash
$ signalk-filter-logs --logs ./logs --output . --context vessels.urn:mrn:imo:mmsi:244016949 --filter speedOverGround,position --type csv

## Options:

# --logs, -l: location of the log files (required); e.g. ./logs
# --output, -o: location for the output file. Defaults to process.cwd()
# --type, -t: type of output file: csv or json
# --context, -c: the context to filter on (optional)
# --filter, -f: comma-seperated list of terms to filter paths on; e.g. speedOverGround,environment
# --extension: the extension of the log files. Defautls to .log.
```
