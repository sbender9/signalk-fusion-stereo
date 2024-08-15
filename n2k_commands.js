const util = require('util')

const fusion_commands = {
  next: {
    "Proprietary ID":"Media Control",
    "Command":"Next",
    "Unknown": 0
  },
  prev: {
    "Proprietary ID":"Media Control",
    "Command":"Prev",
    "Unknown": 0
  },
  "SiriusXM_next": "%s,7,126720,%s,%s,8,a3,99,1e,00,%s,01,00,00",
  "SiriusXM_prev": "%s,7,126720,%s,%s,8,a3,99,1e,00,%s,02,00,00",
  play: {
    "Proprietary ID":"Media Control",
    "Command":"Play",
    "Unknown": 0
  },
  pause: {
    "Proprietary ID":"Media Control",
    "Command":"Pause",
    "Unknown": 0
  },
  "status": "%s,6,126720,%s,%s,4,a3,99,01,00",
  //"mute": "%s,6,126720,%s,%s,5,a3,99,11,00,01",
  mute: {
    "Proprietary ID":"Mute",
    "Command":"Mute On",
  },
  "unmute": "%s,6,126720,%s,%s,5,a3,99,11,00,02",
  "setSource": "%s,6,126720,%s,%s,5,a3,99,02,00,%s",
  "setVolume": "%s,6,126720,%s,%s,6,a3,99,18,00,%s,%s",
  "setAllVolume": "%s,6,126720,%s,%s,8,a3,99,19,00,%s,%s,%s,%s",
  "poweron": "%s,6,126720,%s,%s,5,a3,99,1c,00,01",
  "poweroff": "%s,6,126720,%s,%s,5,a3,99,1c,00,02",
  "setBTDevice": "%s,7,126720,%s,%s,11,a3,99,09,00,0b,%s,00,00,00,02,02"
}

const default_src = '1'
const everyone_dst = '255'

function checkVolume(val)
{
  return typeof val !== 'undefined' ? val : 0;
}

function zoneIdToNum(id)
{
  return padd((Number(id.substring("zone".length))-1).toString(16))
}

function sourceidToNum(id)
{
  return padd(Number(id.substring("source".length)).toString(16))
}

function isoDate()
{
  return (new Date()).toISOString()
}

function padd(n, p, c)
{
  var pad_count = typeof p !== 'undefined' ? p : 2
  var pad_char = typeof c !== 'undefined' ? c : '0';
  var pad = new Array(1 + pad_count).join(pad_char);
   return (pad + n).slice(-pad.length);
}

function getN2KCommand(deviceid, command_json, currentSource, cur_source_id)
{
  var n2k_msg = null
  var action = command_json["action"]
  var device = command_json["device"]
  
  var format = fusion_commands[action]
  if ( action == 'setSource' )
  {
    n2k_msg = util.format(format, isoDate(), default_src, deviceid,
			  sourceidToNum(command_json['value']))
  }
  else if ( action == 'setAllVolume' )
  {
    volumes = command_json['value']

    zone1 = checkVolume(volumes['zone1'])
    zone2 = checkVolume(volumes['zone2'])
    zone3 = checkVolume(volumes['zone3'])
    zone4 = checkVolume(volumes['zone4'])
    
    n2k_msg = util.format(format, isoDate(), default_src, deviceid,
                          padd(zone1.toString(16)),
                          padd(zone2.toString(16)),
                          padd(zone3.toString(16)),
                          padd(zone4.toString(16)))
  }
  else if ( action == 'setVolume' )
  {
    n2k_msg = util.format(format, isoDate(), default_src, deviceid,
                          zoneIdToNum(command_json['zone']),
                          padd(command_json['value'].toString(16)))
  }
  else if ( action == 'next' || action == 'prev' || action == 'play'
	    || action == 'pause' )
  {
    if ( currentSource == 'SiriusXM' )
    {
      format = fusion_commands["SiriusXM_"+action]
      
      if ( format )
      {
        n2k_msg = util.format(format,
			      isoDate(), default_src, deviceid,
			      sourceidToNum(cur_source_id))
      }
    } else {
      format["Source ID"] = parseInt(sourceidToNum(cur_source_id), 16)
    }
  }
  else if ( action === 'setBTDevice' )
  {
    n2k_msg = util.format(format, isoDate(), default_src, deviceid,
                          padd(command_json['value']).toString(16))
  }
  else if ( typeof format === 'string' )
  {
    n2k_msg = util.format(format, isoDate(), default_src, deviceid)
  }

  if ( !n2k_msg && format )
  {
    format.pgn = 126720
    format.dst = deviceid
    //format["Manufacturer Code"] = "Fusion Electronics"
    format["Manufacturer Code"] = 419
    format["Industry Code"] = "Marine Industry"
    n2k_msg = format
  }

  return n2k_msg
}

exports.getN2KCommand = getN2KCommand
exports.zoneIdToNum = zoneIdToNum
exports.sourceidToNum = sourceidToNum


