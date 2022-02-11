const stream = require('stream')

exports.parseKLVfile = function (binaryData, options = {
  removeUndefinedKeys: true,
  logKeyValues: false,
  logErrors: false,
}) {
  return parseKLVdata(binaryData, options);
}

exports.createParseStream = (options = {
  removeUndefinedKeys: true,
  logKeyValues: false,
  logErrors: false,
}) => {
  // Some bookkeeping to make sure we don't clip KLV packets
  let clippedChunk = undefined;
  const LDSkey = Buffer.from('060E2B34020B01010E01030101000000', 'hex');

  let parser = new stream.Transform({
    objectMode: true,
    transform(chunk, encoding, done) {
      if (!clippedChunk) { clippedChunk = chunk; }
      else {
        let packetBegin = chunk.indexOf(LDSkey);
        let unclippedChunk = Buffer.concat([clippedChunk, chunk.slice(0, packetBegin)]);
        this.push(JSON.stringify(parseKLVdata(unclippedChunk, options)));
        clippedChunk = chunk.slice(packetBegin);
      }
      done();
    },
    flush(done) {
      this.push(JSON.stringify(parseKLVdata(clippedChunk, options)));
      done();
    }
  });
  return parser;
};

function logKeyValue(key, valueName, value) {
  console.log(`Key: ${key}, ${valueName}:`, value);
}

function parseBytesAsString(length, buffer, bufferPtr) {
  let stringParser = '';
  for (let i = 0; i < length; i++) {
    stringParser += String.fromCharCode(buffer.readUInt8(bufferPtr + i));
  }
  return stringParser;
}

function RIMAPB(min, max, byteLength, KLVvalue) {
  let bPow = Math.ceil(Math.log2(max - min));
  let dPow = 8 * byteLength - 1;
  let sF = Math.pow(2, dPow - bPow); // For forward mapping (float -> int)
  let sR = Math.pow(2, bPow - dPow); // For reverse mapping (int -> float)
  let zOffset = min < 0 && max > 0 ? sF * min - Math.abs(sF * min) : 0;
  return sR * (KLVvalue - zOffset) + min;
}

const two8limit = (2 ** 8) - 1;
const two16limit = (2 ** 16) - 1;
const two32limit = (2 ** 32) - 1;

function parseKLVdata(buffer, options) {
  const LDSkey = Buffer.from('060E2B34020B01010E01030101000000', 'hex');
  let KLVpackets = Array();
  var nDroppedPackets = 0;

  let bufferPtr = 0;
  while (bufferPtr < buffer.length) {
    let packetBegin = bufferPtr = buffer.indexOf(LDSkey, bufferPtr);
    if (packetBegin === -1) { break }

    let firstBERByte = buffer.readUInt8(bufferPtr + 16);
    bufferPtr += 16

    let payloadSize = -1;
    if (firstBERByte >> 7) { // Long form BER
      let BERlength = firstBERByte & 0x10F447; // Clear msb (leftmost) bit in 1 byte int

      payloadSize = buffer.readUInt8(bufferPtr + BERlength);
      bufferPtr += 1 + BERlength;
    } else {
      payloadSize = firstBERByte;
      bufferPtr++;
    }
    let tmpPacket = parsePacket(buffer, bufferPtr, packetBegin, payloadSize, options);
    tmpPacket ? KLVpackets.push(tmpPacket) : nDroppedPackets++;
  }
  if (options.removeUndefinedKeys) {
    KLVpackets.forEach(packet => Object.keys(packet).forEach(key => packet[key] === undefined && delete packet[key]));
  }
  return { packets: KLVpackets, nDropped: nDroppedPackets };
};

function parsePacket(buffer, bufferPtr, packetBegin, payloadSize, options) {
  let packet = {};
  let checksumReached = false;

  while (!checksumReached && bufferPtr - packetBegin < payloadSize + 16) {
    let tag = buffer.readUInt8(bufferPtr);
    let length = buffer.readUInt8(bufferPtr + 1);
    bufferPtr += 2; // Move ptr past key and length fields

    var LDSvalue = undefined;
    var LDSname = '';

    // WARNING: Elegant code ahead :^)
    switch (tag) {
      default:
        if (tag > 142 || tag < 1) {
          if (options.logErrors) { console.log(`Tag ${tag} not defined in standard, dropping packet`); }
          return undefined; // Packet doesn't follow MISB0601 or is corrupt
        }
        break;
      case 1:
        packet.checksum = LDSvalue = buffer.readUInt16BE(bufferPtr);
        LDSname = 'Checksum';
        checksumReached = true;

        let packetLen = bufferPtr - packetBegin;
        let bcc = 0;
        for (let i = packetBegin; i < packetBegin + packetLen; i++) {
          bcc += buffer[i] << (8 * ((i + 1) % 2));
        }
        bufferPtr += length;
        if ((bcc & 0xFFFF) === packet.checksum) { return packet; }
        else { return packet; }
      case 2:
        let bigTimestamp = buffer.readBigUInt64BE(bufferPtr) / BigInt(1000); // This causes a 1000 microsecond error
        packet.timestamp = LDSvalue = parseInt(bigTimestamp);
        LDSname = 'Date';
        break;
      case 3:
        packet.missionID = LDSvalue = parseBytesAsString(length, buffer, bufferPtr);
        LDSname = 'Mission ID';
        break;
      case 4:
        packet.platformTailNumber = LDSvalue = parseBytesAsString(length, buffer, bufferPtr);
        LDSname = 'Mission Tail Number';
        break;
      case 5:
        packet.platformHeadingAngle = LDSvalue = (360 / two16limit) * buffer.readUInt16BE(bufferPtr);
        LDSname = 'Platform Heading Angle';
        break;
      case 6:
        packet.platformPitchAngle = LDSvalue = (40 / (two16limit - 1)) * buffer.readInt16BE(bufferPtr);
        LDSname = 'Platform Pitch Angle';
        break;
      case 7:
        packet.platformRollAngle = LDSvalue = (100 / (two16limit - 1)) * buffer.readInt16BE(bufferPtr);
        LDSname = 'Platform Roll Angle';
        break;
      case 8:
        packet.platformTrueAirspeed = LDSvalue = buffer.readUInt8(bufferPtr);
        LDSname = 'Platform True Airspeed';
        break;
      case 9:
        packet.platformIndicatedAirspeed = LDSvalue = buffer.readUInt8(bufferPtr);
        LDSname = 'Platform Indicated Airspeed';
        break;
      case 10:
        packet.platformDesignation = LDSvalue = parseBytesAsString(length, buffer, bufferPtr);;
        LDSname = 'Platform Designation';
        break;
      case 11:
        packet.imageSourceSensor = LDSvalue = parseBytesAsString(length, buffer, bufferPtr);;
        LDSname = 'Image Source Sensor';
        break;
      case 12:
        packet.imageCoordinateSystem = LDSvalue = parseBytesAsString(length, buffer, bufferPtr);;
        LDSname = 'Image Coordinate System';
        break;
      case 13:
        packet.sensorLatitude = LDSvalue = (180 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Sensor Latitude';
        break;
      case 14:
        packet.sensorLongitude = LDSvalue = (360 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Sensor Longitude';
        break;
      case 15:
        packet.sensorTrueAltitude = LDSvalue = (19900 / two16limit) * buffer.readUInt16BE(bufferPtr) - 900;
        LDSname = 'Sensor True Altitude';
        break;
      case 16:
        packet.sensorHorizontalFOV = LDSvalue = (180 / two16limit) * buffer.readUInt16BE(bufferPtr);
        LDSname = 'Sensor Horizontal FOV';
        break;
      case 17:
        packet.sensorVerticalFOV = LDSvalue = (180 / two16limit) * buffer.readUInt16BE(bufferPtr);
        LDSname = 'Sensor Vertical FOV';
        break;
      case 18:
        packet.sensorRelativeAzimuthAngle = LDSvalue = (360 / two32limit) * buffer.readUInt32BE(bufferPtr);
        LDSname = 'Sensor Relative Azimuth Angle';
        break;
      case 19:
        packet.sensorRelativeElevationAngle = LDSvalue = (360 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Sensor Relative Elevation Angle';
        break;
      case 20:
        packet.sensorRelativeRollAngle = LDSvalue = (360 / two32limit) * buffer.readUInt32BE(bufferPtr);
        LDSname = 'Sensor Relative Roll Angle';
        break;
      case 21:
        packet.slantRange = LDSvalue = (5000000 / two32limit) * buffer.readUInt32BE(bufferPtr);
        LDSname = 'Slant Range';
        break;
      case 22:
        packet.targetWidth = LDSvalue = (10000 / two16limit) * buffer.readUInt16BE(bufferPtr);
        LDSname = 'Target Width';
        break;
      case 23:
        packet.frameCenterLatitude = LDSvalue = (180 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Frame Center Latitude';
        break;
      case 24:
        packet.frameCenterLongitude = LDSvalue = (360 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Frame Center Longitude';
        break;
      case 25:
        packet.frameCenterElevation = LDSvalue = (19900 / two16limit) * buffer.readUInt16BE(bufferPtr) - 900;
        LDSname = 'Frame Center Elevation';
        break;
      case 26:
        packet.offsetCornerLatitudePoint1 = LDSvalue = (0.15 / 65534) * buffer.readInt16BE(bufferPtr);
        LDSname = 'Offset Corner Latitude Point 1';
        break;
      case 27:
        packet.offsetCornerLongitudePoint1 = LDSvalue = (0.15 / 65534) * buffer.readInt16BE(bufferPtr);
        LDSname = 'Offset Corner Longitude Point 1';
        break;
      case 28:
        packet.offsetCornerLatitudePoint2 = LDSvalue = (0.15 / 65534) * buffer.readInt16BE(bufferPtr);
        LDSname = 'Offset Corner Latitude Point 2';
        break;
      case 29:
        packet.offsetCornerLongitudePoint2 = LDSvalue = (0.15 / 65534) * buffer.readInt16BE(bufferPtr);
        LDSname = 'Offset Corner Longitude Point 2';
        break;
      case 30:
        packet.offsetCornerLatitudePoint3 = LDSvalue = (0.15 / 65534) * buffer.readInt16BE(bufferPtr);
        LDSname = 'Offset Corner Latitude Point 3';
        break;
      case 31:
        packet.offsetCornerLongitudePoint3 = LDSvalue = (0.15 / 65534) * buffer.readInt16BE(bufferPtr);
        LDSname = 'Offset Corner Longitude Point 3';
        break;
      case 32:
        packet.offsetCornerLatitudePoint4 = LDSvalue = (0.15 / 65534) * buffer.readInt16BE(bufferPtr);
        LDSname = 'Offset Corner Latitude Point 4';
        break;
      case 33:
        packet.offsetCornerLongitudePoint4 = LDSvalue = (0.15 / 65534) * buffer.readInt16BE(bufferPtr);
        LDSname = 'Offset Corner Longitude Point 4';
        break;
      case 34:
        packet.icingDetected = LDSvalue = buffer.readUInt8(bufferPtr);
        LDSname = 'Icing Detected';
        break;
      case 35:
        packet.windDirection = LDSvalue = (360 / two16limit) * buffer.readUInt16BE(bufferPtr);
        LDSname = 'Wind Direction';
        break;
      case 36:
        packet.windSpeed = LDSvalue = (100 / two8limit) * buffer.readUInt8(bufferPtr);
        LDSname = 'Wind Speed';
        break;
      case 37:
        packet.staticPressure = LDSvalue = (5000 / two16limit) * buffer.readUInt16BE(bufferPtr);
        LDSname = 'Static Pressure';
        break;
      case 38:
        packet.densityAltitude = LDSvalue = (19900 / two16limit) * buffer.readUInt16BE(bufferPtr) - 900;
        LDSname = 'Density Altitude';
        break;
      case 39:
        packet.outsideAirTemperature = LDSvalue = buffer.readInt8(bufferPtr);
        LDSname = 'Outside Air Temperature';
        break;
      case 40:
        packet.targetLocationLatitude = LDSvalue = (180 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Target Location Latitude';
        break;
      case 41:
        packet.targetLocationLongitude = LDSvalue = (360 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Target Location Longitude';
        break;
      case 42:
        packet.targetLocationElevation = LDSvalue = (19900 / two16limit) * buffer.readUInt16BE(bufferPtr) - 900;
        LDSname = 'Target Location Elevation';
        break;
      case 43:
        packet.targetTrackGateWidth = LDSvalue = 2 * buffer.readUInt8(bufferPtr);
        LDSname = 'Target Track Gate Width';
        break;
      case 44:
        packet.targetTrackGateHeight = LDSvalue = 2 * buffer.readUInt8(bufferPtr);
        LDSname = 'Target Track Gate Height';
        break;
      case 45:
        packet.targetErrorEstimateCE90 = LDSvalue = (4095 / two16limit) * buffer.readUInt16BE(bufferPtr);
        LDSname = 'Target Error Estimate - CE90';
        break;
      case 46:
        packet.targetErrorEstimateLE90 = LDSvalue = (4095 / two16limit) * buffer.readUInt16BE(bufferPtr);
        LDSname = 'Target Error Estimate - LE90';
        break;
      case 47:
        packet.genericFlagData01 = LDSvalue = buffer.readUInt8(bufferPtr);
        LDSname = 'Generic Flag Data 01';
        break;
      case 48: // NOT IMPLEMENTED
        // packet.securityLocalMetadataSet = 
        LDSname = 'Security Local Metadata Set';
        break;
      case 49:
        packet.differentialPressure = LDSvalue = (5000 / two16limit) * buffer.readUInt16BE(bufferPtr);
        LDSname = 'Differential Pressure';
        break;
      case 50:
        packet.platformAngleOfAttack = LDSvalue = (40 / (two16limit - 1)) * buffer.readInt16BE(bufferPtr);
        LDSname = 'Platform Angle Of Attack';
        break;
      case 51:
        packet.platformVerticalSpeed = LDSvalue = (360 / (two16limit - 1)) * buffer.readInt16BE(bufferPtr);
        LDSname = 'Platform Vertical Speed';
        break;
      case 52:
        packet.platformSideslipAngle = LDSvalue = (40 / (two16limit - 1)) * buffer.readInt16BE(bufferPtr);
        LDSname = 'Platform Sideslip Angle';
        break;
      case 53:
        packet.airfieldBarometricPressure = LDSvalue = (5000 / two16limit) * buffer.readUInt16BE(bufferPtr);
        LDSname = 'Airfield Barometric Pressure';
        break;
      case 54:
        packet.airfieldElevation = LDSvalue = (19900 / two16limit) * buffer.readUInt16BE(bufferPtr) - 900;
        LDSname = 'Airfield Elevation';
        break;
      case 55:
        packet.relativeHumidity = LDSvalue = (100 / two8limit) * buffer.readUInt8(bufferPtr);
        LDSname = 'Relative Humidity';
        break;
      case 56:
        packet.platformGroundSpeed = LDSvalue = buffer.readUInt8(bufferPtr);
        LDSname = 'Platform Ground Speed';
        break;
      case 57:
        packet.groundRange = LDSvalue = (5000000 / two32limit) * buffer.readUInt32BE(bufferPtr);
        LDSname = 'Ground Range';
      case 58:
        packet.platformFuelRemaining = LDSvalue = (10000 / two16limit) * buffer.readUInt16BE(bufferPtr);
        LDSname = 'Platform Fuel Remaining';
        break;
      case 59:
        packet.platformCallSign = LDSvalue = parseBytesAsString(length, buffer, bufferPtr);;
        LDSname = 'Platform Call Sign';
        break;
      case 60: // NIBBLE NOT IMPLEMENTED
        packet.weaponLoad = LDSvalue = buffer.readUInt16BE(bufferPtr);
        LDSname = 'Weapon Load';
        break;
      case 61: // NIBBLE NOT IMPLEMENTED
        packet.weaponFired = LDSvalue = buffer.readUInt8(bufferPtr);
        LDSname = 'Weapon Fired';
        break;
      case 62:
        packet.laserPRFcode = LDSvalue = buffer.readUInt16BE(bufferPtr);
        LDSname = 'Laser PRF Code';
        break;
      case 63:
        packet.sensorFOVname = LDSvalue = buffer.readUInt8(bufferPtr);
        LDSname = 'Sensor FOV name';
        break;
      case 64:
        packet.platformMagneticHeading = LDSvalue = (360 / two16limit) * buffer.readUInt16BE(bufferPtr);
        LDSname = 'Platform Magnetic Heading';
        break;
      case 65:
        packet.UAS_LDS_version = LDSvalue = buffer.readUInt8(bufferPtr);
        LDSname = 'UAS LDS Version number';
        break;
      case 66: // DEPRECATED
        // packet.targetLocationCovarianceMatrix = 
        LDSname = 'Target Location Covariance Matrix';
        break;
      case 67:
        packet.alternatePlatformLatitude = LDSvalue = (180 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Alternate Platform Latitude';
        break;
      case 68:
        packet.alternatePlatformLongitude = LDSvalue = (360 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Alternate Platform Longitude';
        break;
      case 69:
        packet.alternatePlatformAltitude = LDSvalue = (19900 / two16limit) * buffer.readUInt16BE(bufferPtr) - 900;
        LDSname = 'Alternate Platform Altitude';
        break;
      case 70:
        packet.alternatePlatformName = LDSvalue = parseBytesAsString(length, buffer, bufferPtr);;
        LDSname = 'Alternate Platform Name';
        break;
      case 71:
        packet.alternatePlatformHeading = LDSvalue = (360 / two16limit) * buffer.readUInt16BE(bufferPtr);
        LDSname = 'Alternate Platform Heading';
        break;
      case 72:
        packet.eventStartTimeUTC = LDSvalue = parseInt(buffer.readBigUInt64BE(bufferPtr) / BigInt(1000));
        LDSname = 'Event Start Time UTC';
        break;
      case 73: // NOT IMPLEMENTED
        // packet.RVTlocalDataSet = LDSvalue =
        LDSname = 'RVT Local Data Set';
        break;
      case 74: // NOT IMPLEMENTED
        // packet.VMTIlocalDataSet = LDSvalue = 
        LDSname = 'VMTI Local Data Set';
        break;
      case 75:
        packet.sensorEllipsoidHeight = LDSvalue = (19900 / two16limit) * buffer.readUInt16BE(bufferPtr) - 900;
        LDSname = 'Sensor Ellipsoid Height';
        break;
      case 76:
        packet.alternatePlatformEllipsoidHeight = LDSvalue = (19900 / two16limit) * buffer.readUInt16BE(bufferPtr) - 900;
        LDSname = 'Alternate Platform Ellipsoid Height';
        break;
      case 77:
        packet.operationalMode = LDSvalue = buffer.readUInt8(bufferPtr);
        LDSname = 'Operational Mode';
        break;
      case 78:
        packet.frameCenterHeightAboveEllipsoid = LDSvalue = (19900 / two16limit) * buffer.readUInt16BE(bufferPtr) - 900;
        LDSname = 'Frame Center Height Above Ellipsoid';
        break;
      case 79:
        packet.sensorNorthVelocity = LDSvalue = (654 / (two16limit - 1)) * buffer.readInt16BE(bufferPtr);
        LDSname = 'Sensor North Velocity';
        break;
      case 80:
        packet.sensorEastVelocity = LDSvalue = (327 / (two16limit - 1)) * buffer.readInt16BE(bufferPtr);
        LDSname = 'Sensor East Velocity';
        break;
      case 81: // Not implemented
        // packet.imageHorizonPixelPack = LDSvalue = 
        LDSname = 'Image Horizon Pixel Pack';
        break;
      case 82:
        packet.cornerLatitudePoint1Full = LDSvalue = (180 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Corner Latitude Point 1 Full';
        break;
      case 83:
        packet.cornerLongitudePoint1Full = LDSvalue = (360 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Corner Longitude Point 1 Full';
        break;
      case 84:
        packet.cornerLatitudePoint2Full = LDSvalue = (180 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Corner Latitude Point 2 Full';
        break;
      case 85:
        packet.cornerLongitudePoint2Full = LDSvalue = (360 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Corner Longitude Point 2 Full';
        break;
      case 86:
        packet.cornerLatitudePoint3Full = LDSvalue = (180 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Corner Latitude Point 3 Full';
        break;
      case 87:
        packet.cornerLongitudePoint3Full = LDSvalue = (360 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Corner Longitude Point 3 Full';
        break;
      case 88:
        packet.cornerLatitudePoint4Full = LDSvalue = (180 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Corner Latitude Point 4 Full';
        break;
      case 89:
        packet.cornerLongitudePoint4Full = LDSvalue = (360 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Corner Longitude Point 4 Full';
        break;
      case 90:
        packet.platformPitchAngleFull = LDSvalue = (180 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Platform Pitch Angle Full';
        break;
      case 91:
        packet.platformPitchRollFull = LDSvalue = (180 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Platform Pitch Roll Full';
        break;
      case 92:
        packet.platformAngleOfAttackFull = LDSvalue = (180 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Platform Angle Of Attack Full';
        break;
      case 93:
        packet.platformSideslipAngleFull = LDSvalue = (360 / (two32limit - 1)) * buffer.readInt32BE(bufferPtr);
        LDSname = 'Platform Sideslip Angle Full';
        break;
      case 94: // NOT IMPLEMENTED
        // packet.MIIScoreIdentifier = 
        LDSname = 'MIIS Core Identifier';
        break;
      case 95: // NOT IMPLEMENTED
        // packet.SARmotionImageryLocalSet = 
        LDSname = 'SAR Motion Imagery Local Set';
        break;
      case 96:
        packet.targetWidthExtended = LDSvalue = RIMAPB(0, 1500000, length, buffer.readUIntBE(bufferPtr, length));
        LDSname = 'Target Width Extended';
        break;
      case 97: // NOT IMPLEMENTED
        // packet.rangeImageLocalSet = 
        LDSname = 'Range Image Local Set';
        break;
      case 98: // NOT IMPLEMENTED
        // packet.geoRegistrationLocalSet = 
        LDSname = 'Geo-Registration Local Set';
        break;
      case 99: // NOT IMPLEMENTED
        // packet.compositeImagingLocalSet = 
        LDSname = 'Composite Imaging Local Set';
        break;
      case 100: // NOT IMPLEMENTED
        // packet.segmentLocalSet = 
        LDSname = 'Segment Local Set';
        break;
      case 101: // NOT IMPLEMENTED
        // packet.amendLocalSet = 
        LDSname = 'Amend Local Set';
        break;
      case 102: // NOT IMPLEMENTED
        // packet.sdccFLP = 
        LDSname = 'SDCC-FLP';
        break;
      case 103:
        packet.densityAltitudeExtended = LDSvalue = RIMAPB(-900, 40000, length, buffer.readUIntBE(bufferPtr, length));
        LDSname = 'Density Altidue Extended';
        break;
      case 104:
        packet.sensorEllipsoidHeightExtended = LDSvalue = RIMAPB(-900, 40000, length, buffer.readUIntBE(bufferPtr, length));
        LDSname = 'Sensor Ellipsoid Height Extended';
        break;
      case 105:
        packet.alternatePlatformEllipsoidHeightExtended = LDSvalue = RIMAPB(-900, 40000, length, buffer.readUIntBE(bufferPtr, length));
        LDSname = 'Alternate Platform Ellipsoid Height Extended';
        break;
      case 106:
        packet.streamDesignator = LDSvalue = parseBytesAsString(length, buffer, bufferPtr);
        LDSname = 'Stream Designator';
        break;
      case 107:
        packet.operationalBase = LDSvalue = parseBytesAsString(length, buffer, bufferPtr);
        LDSname = 'Operational Base';
        break;
      case 108:
        packet.broadcastSource = LDSvalue = parseBytesAsString(length, buffer, bufferPtr);
        LDSname = 'Broadcast Source';
        break;
      case 109:
        packet.rangeToRecoveryLocation = LDSvalue = RIMAPB(0, 21000, length, buffer.readUIntBE(bufferPtr, length));
        LDSname = 'Range To Recovery Location';
        break;
      case 110:
        packet.timeAirborne = LDSvalue = buffer.readUInt32BE(bufferPtr);
        LDSname = 'Time Airborne';
        break;
      case 111:
        packet.propulsionUnitSpeed = LDSvalue = buffer.readUInt32BE(bufferPtr);
        LDSname = 'Propulsion Unit Speed';
        break;
      case 112:
        packet.platformCourseAngle = LDSvalue = RIMAPB(0, 360, length, buffer.readUIntBE(bufferPtr, length));
        LDSname = 'Platform Course Angle';
        break;
      case 113:
        packet.altitudeAGL = LDSvalue = RIMAPB(-900, 40000, length, buffer.readUIntBE(bufferPtr, length));
        LDSname = 'Altitude AGL';
        break;
      case 114:
        packet.radarAltimeter = LDSvalue = RIMAPB(-900, 40000, length, buffer.readUIntBE(bufferPtr, length));
        LDSname = 'Radar Altimeter';
        break;
      case 115: // NOT IMPLEMENTED
        // packet.controlCommand =
        LDSname = 'Control Command';
        break;
      case 116: // NOT IMPLEMENTED
        // packet.controlCommandVerificationList =
        LDSname = 'Control Command Verification List';
        break;
      case 117:
        packet.sensorAzimuthRate = LDSvalue = RIMAPB(-1000, 1000, length, buffer.readUIntBE(bufferPtr, length));
        LDSname = 'Sensor Azimuth Rate';
        break;
      case 118:
        packet.sensorElevationRate = LDSvalue = RIMAPB(-1000, 1000, length, buffer.readUIntBE(bufferPtr, length));
        LDSname = 'Sensor Elevation Rate';
        break;
      case 119:
        packet.sensorRollRate = LDSvalue = RIMAPB(-1000, 1000, length, buffer.readUIntBE(bufferPtr, length));
        LDSname = 'Sensor Roll Rate';
        break;
      case 120:
        packet.onboardMIstoragePercentFull = LDSvalue = buffer.readFloatBE(bufferPtr);
        LDSname = 'On-board MI Storage Percent Full';
        break;
      case 121: // NOT IMPLEMENTED
        // packet.activeWavelengthList =
        LDSname = 'Active Wavelength List';
        break;
      case 122: // NOT IMPLEMENTED
        // packet.countryCodes =
        LDSname = 'Country Codes';
        break;
      case 123:
        packet.numberOfNAVSATSinView = LDSvalue = buffer.readUInt8(bufferPtr);
        LDSname = 'Number of NAVSATs in View';
        break;
      case 124:
        packet.positioningMethodSource = LDSvalue = buffer.readUInt8(bufferPtr);
        LDSname = 'Positioning Method Source';
        break;
      case 125:
        packet.platformStatus = LDSvalue = buffer.readUInt8(bufferPtr);
        LDSname = 'Platform Status';
        break;
      case 126:
        packet.sensorControlMode = LDSvalue = buffer.readUInt8(bufferPtr);
        LDSname = 'Sensor Control Mode';
        break;
      case 127: // NOT IMPLEMENTED
        // packet.sensorFrameRatePack = 
        LDSname = 'Sensor Frame Rate Pack';
        break;
      case 128: // NOT IMPLEMENTED
        // packet.wavelengthsList = 
        LDSname = 'Wavelengths List';
        break;
      case 129:
        // packet.targetID = LDSvalue = parseBytesAsString(length, buffer, bufferPtr);
        LDSname = 'Target ID';
        break;
      case 130: // NOT IMPlEMENTED
        // packet.airbaseLocations =
        LDSname = 'Airbase Locations';
        break;
      case 131:
        let bigTakeOffTime = buffer.readBigUInt64BE(bufferPtr) / BigInt(1000); // This causes a 1000 microsecond error
        packet.takeOffTime = LDSvalue = parseInt(bigTakeOffTime);
        LDSname = 'Take-off Time';
        break;
      case 132:
        packet.transmissionFrequency = LDSvalue = RIMAPB(1, 99999, length, buffer.readUIntBE(bufferPtr, length));
        LDSname = 'Transmission Frequency';
        break;
      case 133:
        packet.onbordMIstorageCapacity = LDSvalue = buffer.readUInt32BE(bufferPtr);
        LDSname = 'On-board MI Storage Capacity';
        break;
      case 134:
        packet.zoomPercentage = LDSvalue = RIMAPB(0, 100, length, buffer.readUIntBE(bufferPtr, length));
        LDSname = 'Zoom Percentage';
        break;
      case 135:
        packet.communicationsMethod = LDSvalue = parseBytesAsString(length, buffer, bufferPtr);
        LDSname = 'Communications Method';
        break;
      case 136:
        packet.leapSeconds = LDSvalue = buffer.readInt32BE(bufferPtr);
        LDSname = 'Leap Seconds';
        break;
      case 137:
        let bigCorrectionOffset = buffer.readBigUInt64BE(bufferPtr) / BigInt(1000); // This causes a 1000 microsecond error
        packet.correctionOffset = LDSvalue = parseInt(bigCorrectionOffset);
        LDSname = 'Correction Offset';
        break;
      case 138: // NOT IMPlEMENTED
        // packet.payloadList =
        LDSname = 'Payload List';
        break;
      case 139: // NOT IMPlEMENTED
        // packet.activePayloads =
        LDSname = 'Active Payloads';
        break;
      case 140: // NOT IMPlEMENTED
        // packet.weaponsStores =
        LDSname = 'Weapons Stores';
        break;
      case 141: // NOT IMPlEMENTED
        // packet.waypointList =
        LDSname = 'Waypoint List';
        break;
      case 142: // NOT IMPlEMENTED
        // packet.viewDomain =
        LDSname = 'View Domain';
        break;
    }

    if (options.logKeyValues) { logKeyValue(tag, LDSname, LDSvalue); }
    bufferPtr += length;
  }
  return undefined; // If this return is reached a checksum was never found and packet is corrupt
}
