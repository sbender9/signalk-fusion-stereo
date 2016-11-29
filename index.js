/*
 * Copyright 2016 Scott Bender <scott@scottbender.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const debug = require('debug')('fusion-stereo')

const Bacon = require('baconjs');

const util = require('util')

const _ = require('lodash')

const fusion_commands = {
  "next": "%s,6,126720,%s,%s,6,a3,99,03,00,%s,04",
  "prev": "%s,6,126720,%s,%s,6,a3,99,03,00,%s,06",
  "SiriusXM_next": "%s,7,126720,%s,%s,8,a3,99,1e,00,%s,01,00,00",
  "SiriusXM_prev": "%s,7,126720,%s,%s,8,a3,99,1e,00,%s,02,00,00",
  "play": "%s,6,126720,%s,%s,6,a3,99,03,00,%s,01",
  "pause": "%s,6,126720,%s,%s,6,a3,99,03,00,%s,02",
  "status": "%s,6,126720,%s,%s,4,a3,99,01,00",
  "mute": "%s,6,126720,%s,%s,5,a3,99,11,00,01",
  "unmute": "%s,6,126720,2,10,5,a3,99,11,00,02",
  "setSource": "%s,6,126720,%s,%s,5,a3,99,02,00,%s",
  "setVolume": "%s,6,126720,%s,%s,6,a3,99,18,00,%s,%s",
  "setAllVolume": "%s,6,126720,%s,%s,8,a3,99,19,00,%s,%s,%s,%s",
  "poweron": "%s,6,126720,%s,%s,5,a3,99,1c,00,01"
}

const default_src = '1'
const everyone_dst = '255'

const target_heading_path = "steering.autopilot.target.headingMagnetic.value"
const target_wind_path = "steering.autopilot.target.windAngleApparent.value"
const state_path = "steering.autopilot.state.value"

module.exports = function(app) {
  var unsubscribe = undefined
  var plugin = {}
  var deviceid
  
  plugin.start = function(props) {
    debug("starting: %s", util.inspect(props, {showHidden: false, depth: null}) )
    deviceid = props.deviceid

    app.on("pipedProvidersStarted", get_startup_status)
    debug("started")
  };

  plugin.stop = function() {
    debug("stopping")
    if (unsubscribe) {
      unsubscribe()
    }
    debug("stopped")
  }

  plugin.registerWithRouter = function(router) {
    router.post("/command", (req, res) => {
      sendCommand(app, deviceid, req.body)
      res.send("Executed command for plugin " + plugin.id)
    })
  }
  
  plugin.id = "fusionstereo"
  plugin.name = "Fusion Stereo"
  plugin.description = "Plugin that controls a Fusion stereo"

  plugin.schema = {
    title: "Fusion Stereo Control",
    type: "object",
    required: [
      "deviceid"
    ],
    properties: {
      deviceid: {
        type: "string",
        title: "Stereo N2K Device ID ",
        default: "10"
      }
    }
  }

  function get_startup_status(config) 
  {
    config.pipeElements.forEach(function(element) {
      if ( typeof element.options != 'undefined'
           && typeof element.options.toChildProcess != 'undefined'
           && element.options.toChildProcess == 'nmea2000out' )
      {
        debug("sending status");
        sendCommand(app, deviceid, { "action": "status"})
      }
    })
  }

  return plugin;
}

function padd(n, p, c)
{
  var pad_count = typeof p !== 'undefined' ? p : 2
  var pad_char = typeof c !== 'undefined' ? c : '0';
  var pad = new Array(1 + pad_count).join(pad_char);
  return (pad + n).slice(-pad.length);
}

function isoDate()
{
  return (new Date()).toISOString()
}

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

function sendCommand(app, deviceid, command_json)
{
  var n2k_msg = null
  var action = command_json["action"]
  var device = command_json["device"]
  
  debug("command: " + util.inspect(command_json, {showHidden: false, depth: null}))

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
    var cur_source_id = _.get(app.signalk.self,
			      device + ".output.zone1.source.value")

    cur_source_id = cur_source_id.substring((device + '.avsource.').length)
    var sources = _.get(app.signalk.self, device + ".avsource")
    debug("sources: " + util.inspect(sources, {showHidden: false, depth: null}) + " cur_source_id: " + cur_source_id)
    if (typeof cur_source_id != "undefined" && typeof sources != "undefined")
    {
      var source_name = sources[cur_source_id]["name"]["value"]

      if ( source_name == 'SiriusXM' )
      {
	format = fusion_commands["SiriusXM_"+action]
      }

      if ( format )
      {
	n2k_msg = util.format(format,
			      isoDate(), default_src, deviceid,
			      sourceidToNum(cur_source_id))
      }
    }
  }
  else
  {
    n2k_msg = util.format(format, isoDate(), default_src, deviceid)
  }

  if ( n2k_msg )
  {
    debug("n2k_msg: " + n2k_msg)
    app.emit('nmea2000out', n2k_msg);
  }
}

