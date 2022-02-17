[![Buymeacoffee](https://badgen.net/badge/icon/buymeacoffee?icon=buymeacoffee&label)](https://https://www.buymeacoffee.com/)

This package can be used to parse binary data following the [MISB0601.17 standard](https://www.gwg.nga.mil/misb/docs/standards/ST0601.17.pdf).
Usage:

```javascript
const KLV = require('klv-parser-misb');
const fs = require('fs');

// Configs useful for debugging
const options = {
  removeUndefinedKeys: true,
  logKeyValues: false,
  logErrors: false,
}

// Parse a whole file
fs.readFile('klv-file.klv', (err, file) => {
    let KLVdata = KLV.parseKLVfile(file, options);
    let packets = KLVdata.packets;
    let nDropped = KLVdata.nDropped;
    
    // Do something with the data...
}

// Or use streams
let filestream = fs.createReadStream('klv-file.klv');
let parseStream = KLV.createParseStream(options);
filestream.pipe(parseStream);
parseStream.pipe(/* Somewhere else */);

```
You can either use `KLV.parseKLVfile` to parse a binary file or `KLV.createParseStream` to setup a streaming chain. The binary KLV file's packets are parsed into easily manageable JS objects.

This package focuses mostly on the geographic values. As a consequence, some fields are not supported, mostly consisting of sets and weird data structures.
The unsupported fields are:
* Tag 48: Security Local Metadata Set
* Tag 60: Weapon Load
* Tag 61: Weapon Fired
* Tag 66: Target Location Covariance Matrix (Deprecated in standard)
* Tag 73: RVT Local Data Set
* Tag 74: VMTI Local Data Set
* Tag 81: Image Horizon Pixel Pack
* Tag 94: MIIS Core Identifier
* Tag 95: SAR Motion Imagery Local Set
* Tag 97: Range Image Local Set
* Tag 98: Geo-Registration Local Set
* Tag 99: Composite Imaging Local Set
* Tag 100: Segment Local Set
* Tag 101: Amend Local Set
* Tag 102: SDCC-FLP
* Tag 115: Control Command
* Tag 116: Control Command Verification List
* Tag 121: Active Wavelength List
* Tag 122: Country Codes
* Tag 127: Sensor Frame Rate Pack
* Tag 128: Wavelengths List
* Tag 130: Airbase Locations
* Tag 138: Payload List
* Tag 139: Active Payloads
* Tag 140: Weapons Stores
* Tag 141: Waypoint List
* Tag 142: View Domain

If you're in the business of using these fields your programming is probably advanced enough to implement them yourself. The cases are already defined in the source code, albeit without functionality. If you do implement these I would appreciate a pull request on github :)

Some fields are untested for _real_ _life_ _situations_ as I don't have any data to test them on. If you come across any wrongly parsed values, please raise an issue or create a pull request on github.