This package can be used to parse binary data following the [https://www.gwg.nga.mil/misb/docs/standards/ST0601.17.pdf](MISB0601.17 standard).
The KLV file is parsed into a handy javascript object for each packet.
If your KLV data is stored in a mpegts file I recommend using ffmpeg to extract the KLV stream.

Usage:
```javascript

const klv = require('klv-parser-misb');
const fs = require('fs');

// You can also use fs.readFileSync
fs.readFile('klv-file.klv', (err, buffer) => {
    let KLVdata = KLV.parseKLVdata(buffer, {
      removeUndefinedKeys: false,
      logKeyValues: false,
      logErrors: false,
    })
    let packets = KLVdata.packets;
    let nDropped = KLVdata.nDropped;
    
    // Do something with the data...
```
The API is simple, simply call
`KLV.parseKLVdata(file, options)`
where options is a JS object whose parameters (seen above) can be helpful while debugging your application.

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

If you're in the business of using these fields you're programming is probably advanced enough to implement them yourself. The cases are already defined in the source code, albeit without functionality. If you do implement these I would appreciate a pull request on github :)

Some fields are untested for _real_ _life_ _situations_ as I don't have any data to test them on. If you come across any wrongly parsed values, please raise an issue on github.

TODO: Support file streams.