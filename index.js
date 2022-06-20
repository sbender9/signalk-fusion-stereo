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

const getBTDevices =  [
  "%s,7,126720,1,%s,11,a3,99,09,00,0b,00,00,00,00,01,02",
  "%s,7,126720,1,%s,11,a3,99,09,00,0b,00,00,00,00,01,02",
  "%s,7,126720,1,%s,14,a3,99,0b,00,0b,00,00,00,00,05,00,00,00,02"
]

const endMenu = "%s,7,126720,1,%s,11,a3,99,09,00,0b,00,00,00,00,04,02"

const Bacon = require('baconjs');
const _ = require('lodash')
const child_process = require('child_process')
const path = require('path')
const os = require('os')
const util = require('util')
const { getN2KCommand, zoneIdToNum, sourceidToNum } = require('./n2k_commands')

const default_device = 'entertainment.device.fusion1'
const ZONES = [ 'zone1', 'zone2', 'zone3', 'zone4' ]

module.exports = function(app) {
  var unsubscribes = []
  var last_states = new Map();
  var plugin = {}
  var playing_sound = false
  var last_power_state = null
  var last_source = null
  var last_volumes = null
  var last_muted = null
  var deviceid
  var plugin_props
  var statusInterval, discoverIntervsl
  var discovered
  var lastBtDevices
  var availableZones = []
  var availableSources = []

  function setProviderStatus(msg) {
    app.debug(msg)
    app.setProviderStatus(msg)
  }

  function setProviderError(msg) {
    app.error(msg)
    app.setProviderError(msg)
  }
  plugin.start = function(props) {
    plugin_props = props

    if ( (typeof props.autoDiscover !== 'undefined' && props.autoDiscover)
         || (typeof props.autoDiscover === 'undefined' && typeof props.deviceid === 'undefined') ) {
      discoverIntervsl = setInterval(() => {
        setProviderStatus('looking for a stereo')
        discovered = discoverStereo()
        if ( discovered ) {
          setProviderStatus(`Found a ${discovered.productName} with src ${discovered.src}`)
          deviceid = discovered.src
          clearInterval(discoverIntervsl)
          discoverIntervsl = null
        }
      }, 5000)
    } else {
      app.debug(`using deviceid ${props.deviceid}`)
      deviceid = props.deviceid
    }
    
    app.on('nmea2000OutAvailable', () => {
      if ( deviceid ) {
        sendCommand(deviceid, { "action": "status"})
      }
    });

    statusInterval = setInterval(() => {
      if ( deviceid ) {
        sendCommand(deviceid, { "action": "status"})
      }
    }, 10000)

    if ( props.enableAlarms )
    {
      subscribeToAlarms()
    }

    sendAlarmSettingDelta(props.enableAlarms)

    let localSubscription = {
      context: 'vessels.self',
      subscribe: [{
        path: 'entertainment.device.fusion1.avsource.*',
        period: 1000
      },{
        path: 'entertainment.device.fusion1.output.*',
        period: 1000
      }]
    };

    app.subscriptionmanager.subscribe(
    localSubscription,
      unsubscribes,
      subscriptionError => {
        app.error('Error:' + subscriptionError);
      },
      handleDelta
    )

    registerForPuts('entertainment.device.fusion1')
  }

  function registerForPuts(prefix) {
    const self = 'vessels.self'
    const error = {
      state: 'COMPLETED',
      statusCode: 500,
    }
    const completed = {
      state: 'COMPLETED',
      statusCode: 200
    }
    
    ZONES.forEach(zone => {
      app.registerPutHandler(
        self,
        prefix + `.output.${zone}.volume.master`,
        (context, path, value, cb) => {
      	  if (typeof(value) != "number" || (value < 0 || value > 24)) {
            error.message =  `value out of range. received '${value}', expected 0 <= value <= 24`
      	    app.error(error.message)
            return error
      	  } else {
      	    app.debug(`setting volume for zone '${zone}' to value '${value}'`)	  
            sendCommand(deviceid, {
              action: 'setVolume',
              device: prefix,
              zone,
              value})
          }
          return completed
        }
      )

      app.registerPutHandler(
        self,
        prefix + `.output.${zone}.isMuted`,
        (context, path, value, cb) => {
          sendCommand(deviceid,{
            action: value === true ? 'mute' : 'unmute',
            device: prefix
          })
          return completed
        }
      )

      app.registerPutHandler(
        self,
        prefix + `.output.${zone}.source`,
        (context, path, value, cb) => {
          sendCommand(deviceid,{
            action: 'setSource',
            device: prefix,
            value
          })
          return completed
        }
      )
    })
    
    app.registerPutHandler(
      self,
      prefix + '.state',
      (context, path, value, cb) => {
        sendCommand(deviceid,{
          action: value === 'on' ? 'poweron' : 'poweroff',
          device: prefix
        })
        return completed
      }
    )

    app.registerPutHandler(
      self,
      prefix + '.play',
      (context, path, value, cb) => {
        sendCommand(deviceid,{
          action: 'play',
          device: prefix
        })
        return completed
      }
    )

    app.registerPutHandler(
      self,
      prefix + '.pause',
      (context, path, value, cb) => {
        sendCommand(deviceid,{
          action: 'pause',
          device: prefix
        })
        return completed
      }
    )

    app.registerPutHandler(
      self,
      prefix + '.prev',
      (context, path, value, cb) => {
        sendCommand(deviceid,{
          action: 'prev',
          device: prefix
        })
        return completed
      }
    )

    app.registerPutHandler(
      self,
      prefix + '.next',
      (context, path, value, cb) => {
        sendCommand(deviceid,{
          action: 'next',
          device: prefix
        })
        return completed
      }
    )
  }

  function sendEnabled(props, pv) {
    var enabled = props ? props[pv.value] : true
    let delta = {
      updates: [
        {
          values: [
            {
              path: pv.path.substring(0, pv.path.length-4) + 'enabled',
              value: _.isUndefined(enabled) || enabled
            }
          ]
        }
      ]
    }
    app.handleMessage(plugin.id, delta)
  }

  function handleDelta(delta) {
    delta.updates.forEach(update => {
      update.values.forEach(pv => {
        if(pv.path.startsWith('entertainment.device.fusion1.output.zone')) {
          if ( pv.path.endsWith('name') ) {
            if ( availableZones.indexOf(pv.value) === -1 ) {
              availableZones.push(pv.value)
            }
            sendEnabled(plugin_props.availableZones, pv)
          }
        } else if ( pv.path.startsWith('entertainment.device.fusion1.avsource') ) {
          if ( pv.path.endsWith('name') && !pv.path.endsWith('track.name') ) {
            if ( availableSources.indexOf(pv.value) === -1 ) {
              availableSources.push(pv.value)
            }
            sendEnabled(plugin_props.availableSources, pv)
          }
        }
      })
    })
  }
  
  plugin.stop = function() {
    unsubscribes.forEach(function(func) { func() })
    unsubscribes = []
    deviceid = null
    discovered = null
    if ( statusInterval ) {
      clearInterval(statusInterval)
    }
    if ( discoverIntervsl ) {
      clearInterval(discoverIntervsl)
    }
  }

  function discoverStereo() {
    const sources = app.getPath('/sources')
    if ( sources ) {
      const fusions = []
      _.values(sources).forEach(v => {
        if ( typeof v === 'object' ) {
          _.keys(v).forEach(id => {
            if ( v[id] && v[id].n2k && v[id].n2k.hardwareVersion && v[id].n2k.hardwareVersion.startsWith('FUSION-LINK') ) {
              fusions.push(v[id].n2k)
            }
          })
        }
      })
      if ( fusions.length ) {
        return fusions[0]
      }
    }
  }

  plugin.registerWithRouter = function(router) {
    router.post("/command", (req, res) => {
      sendCommand(deviceid, req.body)
      res.send("Executed command for plugin " + plugin.id)
    })

    router.get("/btDevices", (req, res) => {
      let devices = []
      let id = 0
      let found = false
      const menu_items = (msg) => {
        const fields = msg['fields']
        if ( msg.pgn === 130820 &&
             fields['Manufacturer Code'] === 'Fusion' &&
             fields['Message ID'] === 'Menu Item' ) {
          const name = fields['Text']

          app.debug(`menu item: ${name}`)
          if ( name === 'Discoverable' ) {
            app.debug('found the devices')
            end_menu()
            app.removeListener('N2KAnalyzerOut', menu_items)
            found = true
            lastBtDevices = devices
            res.json(devices)
          } else {
            devices.push({id: id, name: name})
            id = id + 1
          }
        }
      }
      app.on('N2KAnalyzerOut', menu_items)
      get_bt_devices()
      setTimeout(() => {
        if ( !found ) {
          app.debug('timed out waiting for devices')
          end_menu()
          app.removeListener('N2KAnalyzerOut', menu_items)
          if ( lastBtDevices ) {
            res.json(lastBtDevices)
          } else {
            res.status(500).send("didn't get devices")
          }
        }
      }, 3000)
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

            last_power_state = app.getSelfPath(default_device + ".state.value") == 'on'
            power(true)

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
    if ( last_states.size === 0 && playing_sound ) {
      stop_playing()

      setTimeout(function() {
        power(last_power_state)
      }, 1000)
    }
  }

  function sendAlarmSettingDelta(enabled)
  {
    app.handleMessage(plugin.id, {
      updates: [
        {
          values: [
            {
              path: "entertainment.device.fusion1.outputAlarms",
              value: enabled ? 1 : 0
            }
          ]
        }
      ]
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
        let volumes = []
        for ( var i = 1; i < 5; i++ ) {
          let setting =  plugin_props['alarmZone'+ i]
          volumes.push(typeof setting === 'undefined' || setting ? plugin_props.alarmVolume : 0)
        }
        set_volumes(volumes)
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
    app.debug('stop playing')
    playing_sound = false

    var cur_source_id = app.getSelfPath(
      default_device + ".output.zone1.source.value")
    
    if ( typeof cur_source_id == 'undefined' )
      return

    if ( plugin_props.alarmSetVolume && last_volumes )
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
    app.debug('setting volumes to %j', volumes)
    sendCommand(deviceid, { "action": 'setAllVolume',
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
    sendCommand(deviceid, { "action": action, "device": default_device })
  }

  function power(state) 
  {
    app.debug("setting power to " + state)
    action = state ? "poweron" : "poweroff"
    sendCommand(deviceid,{ "action": action, "device": default_device })
  }
  
  function switch_to_source(id)
  {
    if ( id != null )
    {
      sendCommand(deviceid, { "action": 'setSource', 'value': id,
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
      if ( key && sources[key].name && sources[key].name.value == input )
        return key
    }

    app.debug("unknown input: " + input)
    
    return null;
  }

  function play_sound(state)
  {
    app.debug("play")
    playing_sound = true

    command = plugin_props.alarmAudioPlayer
    app.debug("sound_player: " + command)

    sound_file = plugin_props.alarmAudioFile
    if ( sound_file.charAt(0) != '/' )
    {
      sound_file = path.join(__dirname, sound_file)
    }
    let args = [ sound_file ]
    if ( plugin_props.alarmAudioPlayerArguments && plugin_props.alarmAudioPlayerArguments.length > 0 ) {
      args = [ ...plugin_props.alarmAudioPlayerArguments.split(' '), ...args ]
    }

    app.debug("sound command: %s %j", command, args)
    
    play = child_process.spawn(command, args)

    play.on('error', (err) => {
      stop_playing()
      app.error("failed to play sound " + err)
    });

    play.on('close', (code) => {
      if ( code == 0 )
      {
        if ( last_states.size > 0 )
          play_sound(state)
        //else
          //stop_playing()
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

  plugin.uiSchema = function() {
    let uiSchema = {
      "ui:order": [
        "autoDiscover",
        "deviceid",
        "enableAlarms",
        "alarmInput",
        "alarmAudioFile",
        "alarmUnMute",
        "alarmSetVolume",
        "alarmVolume",
        "alarmZone1",
        "alarmZone2",
        "alarmZone3",
        "alarmZone4",
        "alarmAudioPlayer",
        'alarmAudioPlayerArguments'
      ]
    }
    if ( availableSources.length > 0 ) {
      uiSchema['ui:order'].push('availableSources')
    }
    if ( availableZones.length > 0 ) {
      uiSchema['ui:order'].push('availableZones')
    }
    
    return uiSchema
  }
  plugin.schema = function() {
    let defaultId = '10'
    let description = 'No Fusion Stereo Found'

    if ( !discovered ) {
      discovered = discoverStereo()
    }

    if ( discovered ) {
      defaultId = discovered.src
      description = `Found a ${discovered.productName} with src ${discovered.src}`
    }


    let defaultAudioPlayer = 'omxplayer'
    if ( os.platform() == 'darwin' )
       defaultAudioPlayer = 'afplay'


    let schema = {
      title: "Fusion Stereo Control",
      type: "object",
      required: [
        "deviceid",
        'alarmInput'
      ],
      properties: {
        autoDiscover: {
          type: 'boolean',
          title: 'Auto Discover Stereo',
          description,
          default: true
        },
        deviceid: {
          type: "string",
          title: "Stereo N2K Device ID ",
          description,
          default: defaultId
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
        },
        alarmZone1: {
          type: "boolean",
          title: "Alarms to Zone 1",
          default: true
        },
        alarmZone2: {
          type: "boolean",
          title: "Alarms to Zone 2",
          default: true
        },
        alarmZone3: {
          type: "boolean",
          title: "Alarms to Zone 3",
          default: true
        },
        alarmZone4: {
          type: "boolean",
          title: "Alarms to Zone 4",
          default: true
        },
        alarmAudioPlayer: {
          title: "Audio Player",
          description: "Select command line audio player",
          type: "string",
          default: defaultAudioPlayer,
          "enum": ["afplay", "omxplayer", "mpg321"]
        },
        alarmAudioPlayerArguments: {
          title: "Audio Player Arguments",
          description: "Arguments to add to the audio player command",
          type: "string"
        }
      }
    }
    
    if ( availableSources.length ) {
      let as = {
        title: "Enabled Sources",
        type: "object",
        properties: {
        }
      }
      schema.properties.availableSources = as
      availableSources.forEach(source => {
        as.properties[source] = {
          type: 'boolean',
          title: source,
          default: true
        }
      })
    }

    if ( availableZones.length ) {
      let az = {
        title: "Enabled Zones",
        type: "object",
        properties: {
        }
      }
      schema.properties.availableZones = az

      availableZones.forEach(zone => {
        az.properties[zone] = {
          type: 'boolean',
          title: zone,
          default: true
        }
      })
    }
    return schema
  }

  function isoDate()
  {
    return (new Date()).toISOString()
  }

  function get_bt_devices()
  {
    getBTDevices.forEach(format => {
      let msg = util.format(format, isoDate(), deviceid)
      app.debug("n2k_msg: " + msg)
      app.emit('nmea2000out', msg);
    })
  }

  function end_menu()
  {
    let msg = util.format(endMenu, isoDate(), deviceid)
    app.debug("n2k_msg: " + msg)
    app.emit('nmea2000out', msg);
  }

  function subscribeToAlarms()
  {
    const command = {
      context: "vessels.self",
      subscribe: [{
        path: "notifications.*",
        policy: 'instant'
      }]
    } 
    app.subscriptionmanager.subscribe(command, unsubscribes, subscription_error, got_delta)
  }

  function setAlarmsEnabled(enabled)
  {
    if ( plugin_props.enableAlarms != enabled )
    {
      if ( enabled )
      {
        subscribeToAlarms()
      }
      else
      {
        unsubscribes.forEach(function(func) { func() })
        unsubscribes = []
      }
      sendAlarmSettingDelta(enabled)
      plugin_props.enableAlarms = enabled
      app.debug('Saving props with enableAlarms = ' + enabled)
      app.savePluginOptions(plugin_props, err => {
        if ( err ) {
          app.error(err.toString())
        }
      })
    }
  }

  function sendCommand(deviceid, command_json)
  {
    var n2k_msg = null
    var action = command_json["action"]
    var path = command_json["device"]
    
    app.debug("path: %s deviceid: %s command: %j", path, deviceid, command_json)

    if ( action === 'playAlarms' )
    {
      setAlarmsEnabled(command_json['value'])
    }
    else
    {
      let currentSource
      let cur_source_id
      
      if ( action == 'next' || action == 'prev' || action == 'play'
           || action == 'pause' )
      {
        const sidPath = path + ".output.zone1.source.value"
        cur_source_id = app.getSelfPath(sidPath)
        
        app.debug('sidPath: %s cur_source_id %s', sidPath, cur_source_id)
        
        cur_source_id = cur_source_id.substring((path + '.avsource.').length)
        var sources = app.getSelfPath(path + ".avsource")
        app.debug("sources: %j cur_source_id: %s", sources, cur_source_id)
        if (typeof cur_source_id != "undefined" && typeof sources != "undefined")
        {
          currentSource = sources[cur_source_id]["name"]["value"]
        }
      }      
      
      n2k_msg = getN2KCommand(deviceid, command_json, currentSource, cur_source_id)
      
      if ( n2k_msg )
      {
        app.debug("n2k_msg: " + n2k_msg)
        app.emit('nmea2000out', n2k_msg);
      }
    }
  }

  return plugin;
}




/*
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

*/
