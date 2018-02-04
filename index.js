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

const Bacon = require('baconjs');
const _ = require('lodash')
const child_process = require('child_process')
const path = require('path')
const os = require('os')
const util = require('util')


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

const default_device = 'entertainment.device.fusion1'

module.exports = function(app) {
  var unsubscribes = []
  var last_states = new Map();
  var plugin = {}
  var playing_sound = false
  var last_source = null
  var last_volumes = null
  var last_muted = null
  var deviceid
  var plugin_props
  
  plugin.start = function(props) {
    deviceid = props.deviceid
    plugin_props = props

    //app.on("pipedProvidersStarted", get_startup_status)
    app.on('nmea2000OutAvailable', () => {
      sendCommand(app, deviceid, { "action": "status"})
    });

    if ( props.enableAlarms )
    {
      command = {
        context: "vessels.self",
        subscribe: [{
          path: "notifications.*",
          policy: 'instant'
        }]
      }

      app.subscriptionmanager.subscribe(command, unsubscribes, subscription_error, got_delta)
    }
   
  };

  plugin.stop = function() {
    unsubscribes.forEach(function(func) { func() })
    unsubscribes = []
  }

  plugin.registerWithRouter = function(router) {
    router.post("/command", (req, res) => {
      sendCommand(app, deviceid, req.body)
      res.send("Executed command for plugin " + plugin.id)
    })
  }

  function subscription_error(err)
  {
    console.log("error: " + err)
  }
  
  function got_delta(notification)
  {
    //app.debug("notification: %o", notification)
    
    notification.updates.forEach(function(update) {
      update.values.forEach(function(value) {
        if ( value.value != null
             && typeof value.value.state != 'undefined' 
             && ['alarm', 'emergency'].indexOf(value.value.state) != -1
             && typeof value.value.method != 'undefined'
             && value.value.method.indexOf('sound') != -1 )
        {
          last_states.set(value.path, value.value.state)
          if ( playing_sound == false )
          {
            setup_for_alarm()
            play_sound(value.value.state)
          }
        }
        else if ( last_states.has(value.path) )
        {
          last_states.delete(value.path)
        }
      })
    })
  }

  function setup_for_alarm()
  {
    var cur_source_id = app.getSelfPath(default_device + ".output.zone1.source.value")

    if ( typeof cur_source_id == 'undefined' )
      return
    
    last_source = cur_source_id.substring((default_device + '.avsource.').length)

    zones = app.getSelfPath(default_device + ".output")

    last_muted = app.getSelfPath(default_device + ".output.zone1.isMuted.value")

    last_volumes = [ zones.zone1.volume.master.value, zones.zone2.volume.master.value, zones.zone3.volume.master.value, zones.zone4.volume.master.value]

    switch_to_source(get_source_id_for_input(plugin_props.alarmInput))

    setTimeout(function() {
      if ( plugin_props.alarmSetVolume )
      {
        set_volumes([plugin_props.alarmVolume, plugin_props.alarmVolume, plugin_props.alarmVolume, plugin_props.alarmVolume])
      }

      setTimeout(function() {
        if ( plugin_props.alarmUnMute && last_muted )
        {
          set_muted(true)
        }
      }, 1000)
    }, 1000)
  }

  function stop_playing()
  {
    playing_sound = false

    var cur_source_id = app.getSelfPath(
      default_device + ".output.zone1.source.value")
    
    if ( typeof cur_source_id == 'undefined' )
      return

    if ( plugin_props.alarmSetVolume )
    {
      set_volumes(last_volumes)
    }

    setTimeout(function() {
      if ( plugin_props.alarmUnMute && last_muted  )
      {
        set_muted(false)
      }

      setTimeout(function() {
        switch_to_source(last_source)
      }, 1000)
    }, 1000)
  }

  function set_volumes(volumes)
  {
    sendCommand(app, deviceid, { "action": 'setAllVolume',
                                 "device": default_device,
                                 "value": {
                                   "zone1": volumes[0],
                                   "zone2": volumes[1],
                                   "zone3": volumes[2],
                                   "zone4": volumes[3] }
                               })
  }

  function set_muted(muted)
  {
    action = muted ? "mute" : "unmute"
    sendCommand(app, deviceid, { "action": action, "device": default_device })
  }
  
  function switch_to_source(id)
  {
    if ( id != null )
    {
      sendCommand(app, deviceid, { "action": 'setSource', 'value': id,
                                   "device": default_device })
    }
  }
  
  function get_source_id_for_input(input)
  {
    var sources = app.getSelfPath(default_device + ".avsource")
    if ( typeof sources == 'undefined' )
    {
      console.log("No Source information")
      return null;
    }
    
    for ( var key in sources )
    {
      if ( sources[key].name.value == input )
        return key
    }

    app.debug("unknown input: " + input)
    
    return null;
  }

  function play_sound(state)
  {
    app.debug("play")
    playing_sound = true

    if ( os.platform() == 'darwin' )
      command = 'afplay'
    else
      command = 'omxplayer'

    sound_file = plugin_props.alarmAudioFile
    if ( sound_file.charAt(0) != '/' )
    {
      sound_file = path.join(__dirname, sound_file)
    }
    app.debug("sound_file: " + sound_file)
    play = child_process.spawn(command, [ sound_file ])

    play.on('error', (err) => {
      stop_playing()
      console.log("failed to play sound")
    });

    play.on('close', (code) => {
      if ( code == 0 )
      {
        if ( last_states.size > 0 )
          play_sound(state)
        else
          stop_playing()
      }
      else
      {
        app.debug("error")
        stop_playing()
      }
    });
  }
  
  plugin.id = "fusionstereo"
  plugin.name = "Fusion Stereo"
  plugin.description = "Plugin that controls a Fusion stereo"

  plugin.uiSchema = {
    "ui:order": [
      "deviceid",
      "enableAlarms",
      "alarmInput",
      "alarmAudioFile",
      "alarmUnMute",
      "alarmSetVolume",
      "alarmVolume"
    ]
  }  
  plugin.schema = {
    title: "Fusion Stereo Control",
    type: "object",
    required: [
      "deviceid",
      'alarmInput'
    ],
    properties: {
      deviceid: {
        type: "string",
        title: "Stereo N2K Device ID ",
        default: "10"
      },
      enableAlarms: {
        type: "boolean",
        title: "Output Alarms To Stereo",
        default: false
      },
      alarmInput: {
        type: "string",
        title: "Input Name",
        default: "Aux1"
      },
      alarmAudioFile: {
        type: "string",
        title: "Path to audio file for alarms",
        default: "builtin_alarm.mp3"
      },
      alarmUnMute: {
        type: "boolean",
        title: "Unmute on alarm",
        default: true
      },
      alarmSetVolume: {
        type: "boolean",
        title: "Set the volume on alarm",
        default: false
      },
      alarmVolume: {
        type: "number",
        title: "Alarm Volume (0-24)",
        default: 12
      }
    }
  }

  function get_startup_status(config) 
  {
    config.pipeElements.forEach(function(element) {
      var sendit = false
      if ( typeof element.options != 'undefined' ) {
        if ( typeof element.options.toChildProcess != 'undefined'
             && element.options.toChildProcess == 'nmea2000out' )
        {
          sendit = true
        }
        else if ( element.type == 'providers/simple'
                  && _.get(element, 'options.type') === 'NMEA2000' ) {
          sendit = true
        }
      }
      if ( sendit ) {
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
  
  app.debug("command: %j", command_json)

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
    var cur_source_id = app.getSelfPath(
	  device + ".output.zone1.source.value")

    cur_source_id = cur_source_id.substring((device + '.avsource.').length)
    var sources = app.getSelfPath(device + ".avsource")
    app.debug("sources: %j cur_source_id: %s", sources, cur_source_id)
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
    app.debug("n2k_msg: " + n2k_msg)
    app.emit('nmea2000out', n2k_msg);
  }
}

