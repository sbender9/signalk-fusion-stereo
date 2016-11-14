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
  "next": "%s,6,126720,%s,%s,6,a3,99,03,00,0b,04",
  "prev": "%s,6,126720,%s,%s,6,a3,99,03,00,0b,06",
  "play": "%s,6,126720,%s,%s,6,a3,99,03,00,0b,01",
  "pause": "%s,6,126720,%s,%s,6,a3,99,03,00,0b,02",
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
    sendCommand(app, props.deviceid, { "action": "status"})
    debug("started")
  };

  plugin.stop = function() {
    debug("stopping")
    if (unsubscribe) {
      unsubscribe()
    }
    debug("stopped")
  }

  plugin.executeCommand = function(json) {
    sendCommand(app, deviceid, json)
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

  return plugin;
}

function padd(n, p, c)
{
  var pad_char = typeof c !== 'undefined' ? c : '0';
  var pad = new Array(1 + p).join(pad_char);
  return (pad + n).slice(-pad.length);
}

function isoDate()
{
  return (new Date()).toISOString()
}

function sendCommand(app, deviceid, command_json)
{
  var n2k_msg = null
  var action = command_json["action"]
  debug("action: " + action)

  var format = fusion_commands[action]
  if ( action in ['setSource', 'setAllVolume'] )
  {
    n2k_msg = util.format(format, isoDate(), default_src, deviceid,
                          padd(dict['value'].toString(16)),
                          padd(dict['value'].toString(16)),
                          padd(dict['value'].toString(16)),
                          padd(dict['value'].toString(16)))
  }
  else if ( action == 'setVolume' )
  {
    n2k_msg = util.format(format, isoDate(), default_src, deviceid,
                          padd(dict['zone'].toString(16)),
                          padd(dict['value'].toString(16)))
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

