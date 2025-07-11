/* eslint-disable @typescript-eslint/no-explicit-any */
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

const getBTDevices = [
  '%s,7,126720,1,%s,11,a3,99,09,00,0b,00,00,00,00,01,02',
  '%s,7,126720,1,%s,11,a3,99,09,00,0b,00,00,00,00,01,02',
  '%s,7,126720,1,%s,14,a3,99,0b,00,0b,00,00,00,00,05,00,00,00,02'
]

const endMenu = '%s,7,126720,1,%s,11,a3,99,09,00,0b,00,00,00,00,04,02'

import { Plugin, ActionResult } from '@signalk/server-api'
import child_process from 'child_process'
import path from 'path'
import os from 'os'
import util from 'util'
import { getN2KCommand } from './n2k_commands'

const default_device = 'entertainment.device.fusion1'
const ZONES = ['zone1', 'zone2', 'zone3', 'zone4']

module.exports = function (app: any) {
  let unsubscribes: any[] = []
  const last_states = new Map()
  let playing_sound = false
  let last_power_state: boolean | null = null
  let last_source: string | null = null
  let last_volumes: number[] | null = null
  let last_muted: boolean | null = null
  let deviceid: number | null
  let plugin_props: any
  let statusInterval: ReturnType<typeof setInterval>
  let discoverIntervsl: ReturnType<typeof setInterval> | null
  let discovered: any
  let lastBtDevices: any[]
  const availableZones: string[] = []
  const availableSources: string[] = []
  let currentSource: string

  const plugin: Plugin = {
    id: 'fusionstereo',
    name: 'Fusion Stereo',
    description: 'Plugin that controls a Fusion stereo',

    start: (props: any) => {
      plugin_props = props

      if (
        (typeof props.autoDiscover !== 'undefined' && props.autoDiscover) ||
        (typeof props.autoDiscover === 'undefined' &&
          typeof props.deviceid === 'undefined')
      ) {
        discoverIntervsl = setInterval(() => {
          setProviderStatus('looking for a stereo')
          discovered = discoverStereo()
          if (discovered) {
            setProviderStatus(
              `Found a ${discovered.productName} with src ${discovered.src}`
            )
            deviceid = discovered.src
            clearInterval(discoverIntervsl!)
            discoverIntervsl = null
          }
        }, 5000)
      } else {
        app.debug(`using deviceid ${props.deviceid}`)
        deviceid = props.deviceid
      }

      app.on('nmea2000OutAvailable', () => {
        if (deviceid) {
          sendCommand(deviceid, { action: 'status' })
        }
      })

      if (
        props.sendStatusRequests === undefined ||
        props.sendStatusRequests === true
      ) {
        statusInterval = setInterval(() => {
          if (deviceid) {
            sendCommand(deviceid, { action: 'status' })
          }
        }, 10000)
      }

      if (props.enableAlarms) {
        subscribeToAlarms()
      }

      sendAlarmSettingDelta(props.enableAlarms)

      const localSubscription = {
        context: 'vessels.self',
        subscribe: [
          {
            path: 'entertainment.device.fusion1.avsource.*',
            period: 1000
          },
          {
            path: 'entertainment.device.fusion1.output.*',
            period: 1000
          }
        ]
      }

      app.subscriptionmanager.subscribe(
        localSubscription,
        unsubscribes,
        (subscriptionError: any) => {
          app.error('Error:' + subscriptionError)
        },
        handleDelta
      )

      registerForPuts('entertainment.device.fusion1')
    },

    stop: () => {
      unsubscribes.forEach(function (func) {
        func()
      })
      unsubscribes = []
      deviceid = null
      discovered = null
      if (statusInterval) {
        clearInterval(statusInterval)
      }
      if (discoverIntervsl) {
        clearInterval(discoverIntervsl)
      }
    },

    uiSchema: () => {
      const uiSchema = {
        'ui:order': [
          'autoDiscover',
          'deviceid',
          'enableAlarms',
          'playSound',
          'alarmInput',
          'alarmAudioFile',
          'alarmUnMute',
          'alarmSetVolume',
          'alarmVolume',
          'alarmZone1',
          'alarmZone2',
          'alarmZone3',
          'alarmZone4',
          'alarmAudioPlayer',
          'alarmAudioPlayerArguments',
          'sendStatusRequests'
        ]
      }
      if (availableSources.length > 0) {
        uiSchema['ui:order'].push('availableSources')
      }
      if (availableZones.length > 0) {
        uiSchema['ui:order'].push('availableZones')
      }

      return uiSchema
    },

    schema: () => {
      let defaultId = '10'
      let description = 'No Fusion Stereo Found'

      if (!discovered) {
        discovered = discoverStereo()
      }

      if (discovered) {
        defaultId = discovered.src
        description = `Found a ${discovered.productName} with src ${discovered.src}`
      }

      let defaultAudioPlayer = 'omxplayer'
      if (os.platform() == 'darwin') defaultAudioPlayer = 'afplay'

      const schema = {
        title: 'Fusion Stereo Control',
        type: 'object',
        required: ['deviceid', 'alarmInput'],
        properties: {
          autoDiscover: {
            type: 'boolean',
            title: 'Auto Discover Stereo',
            description,
            default: true
          },
          deviceid: {
            type: 'string',
            title: 'Stereo N2K Device ID ',
            description,
            default: defaultId
          },
          enableAlarms: {
            type: 'boolean',
            title: 'Output Alarms To Stereo',
            default: false
          },
          playSound: {
            type: 'boolean',
            title: 'Plays Sound',
            default: true
          },
          alarmInput: {
            type: 'string',
            title: 'Input Name',
            default: 'Aux1'
          },
          alarmAudioFile: {
            type: 'string',
            title: 'Path to audio file for alarms',
            default: 'builtin_alarm.mp3'
          },
          alarmUnMute: {
            type: 'boolean',
            title: 'Unmute on alarm',
            default: true
          },
          alarmSetVolume: {
            type: 'boolean',
            title: 'Set the volume on alarm',
            default: false
          },
          alarmVolume: {
            type: 'number',
            title: 'Alarm Volume (0-24)',
            default: 12
          },
          alarmZone1: {
            type: 'boolean',
            title: 'Alarms to Zone 1',
            default: true
          },
          alarmZone2: {
            type: 'boolean',
            title: 'Alarms to Zone 2',
            default: true
          },
          alarmZone3: {
            type: 'boolean',
            title: 'Alarms to Zone 3',
            default: true
          },
          alarmZone4: {
            type: 'boolean',
            title: 'Alarms to Zone 4',
            default: true
          },
          alarmAudioPlayer: {
            title: 'Audio Player',
            description: 'Select command line audio player',
            type: 'string',
            default: defaultAudioPlayer,
            enum: ['afplay', 'omxplayer', 'mpg321']
          },
          alarmAudioPlayerArguments: {
            title: 'Audio Player Arguments',
            description: 'Arguments to add to the audio player command',
            type: 'string'
          },
          sendStatusRequests: {
            type: 'boolean',
            title: 'Send status request',
            description:
              'Disable this if the plugin is pausing your stereo every ten seconds',
            default: true
          }
        } as any
      }

      if (availableSources.length) {
        const as = {
          title: 'Enabled Sources',
          type: 'object',
          properties: {} as any
        }
        schema.properties.availableSources = as
        availableSources.forEach((source) => {
          as.properties[source] = {
            type: 'boolean',
            title: source,
            default: true
          }
        })
      }

      if (availableZones.length) {
        const az = {
          title: 'Enabled Zones',
          type: 'object',
          properties: {} as any
        }
        schema.properties.availableZones = az

        availableZones.forEach((zone) => {
          az.properties[zone] = {
            type: 'boolean',
            title: zone,
            default: true
          }
        })
      }
      return schema
    }
  }

  function setProviderStatus(msg: string) {
    app.debug(msg)
    app.setPluginStatus(msg)
  }

  /*
  function setProviderError(msg: string) {
    app.error(msg)
    app.setPluginError(msg)
    }
  */

  function registerForPuts(prefix: string) {
    const self = 'vessels.self'
    const error: ActionResult = {
      state: 'COMPLETED',
      statusCode: 500
    }

    const completed: ActionResult = {
      state: 'COMPLETED',
      statusCode: 200
    }

    ZONES.forEach((zone) => {
      app.registerPutHandler(
        self,
        prefix + `.output.${zone}.volume.master`,
        (context: string, path: string, value: any, _cb: any) => {
          if (typeof value != 'number' || value < 0 || value > 24) {
            error.message = `value out of range. received '${value}', expected 0 <= value <= 24`
            app.error(error.message)
            return error
          } else {
            app.debug(`setting volume for zone '${zone}' to value '${value}'`)
            sendCommand(deviceid, {
              action: 'setVolume',
              device: prefix,
              zone,
              value
            })
          }
          return completed
        }
      )

      app.registerPutHandler(
        self,
        prefix + `.output.${zone}.isMuted`,
        (context: string, path: string, value: any, _cb: any) => {
          sendCommand(deviceid, {
            action: value === true ? 'mute' : 'unmute',
            device: prefix
          })
          return completed
        }
      )

      app.registerPutHandler(
        self,
        prefix + `.output.${zone}.source`,
        (context: string, path: string, value: any, _cb: any) => {
          sendCommand(deviceid, {
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
      prefix + '.toggleMute',
      (_context: string, _path: string, _value: any, _cb: any) => {
        const state = app.getSelfPath(`${default_device}.output.zone1.isMuted`)

        if (!state || state.value === undefined)
          return { ...error, message: 'no current mute state' }

        sendCommand(deviceid, {
          action: state.value == true ? 'unmute' : 'mute',
          device: prefix
        })
        return completed
      }
    )

    app.registerPutHandler(
      self,
      prefix + '.state',
      (context: string, path: string, value: any, _cb: any) => {
        sendCommand(deviceid, {
          action:
            value === 'on' || value === 1 || value === true
              ? 'poweron'
              : 'poweroff',
          device: prefix
        })
        return completed
      }
    )

    app.registerPutHandler(
      self,
      prefix + '.play',
      (_context: string, _path: string, _value: any, _cb: any) => {
        sendCommand(deviceid, {
          action: 'play',
          device: prefix
        })
        return completed
      }
    )

    app.registerPutHandler(
      self,
      prefix + '.playPause',
      (_context: string, _path: string, _value: any, _cb: any) => {
        const state = app.getSelfPath(`${default_device}.playbackState`)

        if (!state || state.value === undefined)
          return { ...error, message: 'no current playbackState' }

        sendCommand(deviceid, {
          action: state.value == true ? 'pause' : 'play',
          device: prefix
        })
        return completed
      }
    )

    app.registerPutHandler(
      self,
      prefix + '.togglePower',
      (_context: string, _path: string, _value: any, _cb: any) => {
        const state = app.getSelfPath(`${default_device}.state`)

        if (!state || !state.value)
          return { ...error, message: 'no current power state' }

        sendCommand(deviceid, {
          action: state.value == 'on' ? 'poweroff' : 'poweron',
          device: prefix
        })
        return completed
      }
    )

    app.registerPutHandler(
      self,
      prefix + '.pause',
      (_context: string, _path: string, _value: any, _cb: any) => {
        sendCommand(deviceid, {
          action: 'pause',
          device: prefix
        })
        return completed
      }
    )

    app.registerPutHandler(
      self,
      prefix + '.prev',
      (_context: string, _path: string, _value: any, _cb: any) => {
        sendCommand(deviceid, {
          action: 'prev',
          device: prefix
        })
        return completed
      }
    )

    app.registerPutHandler(
      self,
      prefix + '.next',
      (_context: string, _path: string, _value: any, _cb: any) => {
        sendCommand(deviceid, {
          action: 'next',
          device: prefix
        })
        return completed
      }
    )

    app.registerPutHandler(
      self,
      prefix + '.outputAlarms',
      (_context: string, _path: string, value: any, _cb: any) => {
        sendCommand(deviceid, {
          action: 'playAlarms',
          device: prefix,
          value: value
        })
        return completed
      }
    )

    app.registerPutHandler(
      self,
      prefix + '.toggleOutputAlarms',
      (_context: string, _path: string, _value: any, _cb: any) => {
        const state = app.getSelfPath(`${default_device}.outputAlarms`)

        if (!state || state.value === undefined)
          return { ...error, message: 'no current outputAlarms state' }

        sendCommand(deviceid, {
          action: 'playAlarms',
          device: prefix,
          value: state.value ? false : true
        })
        return completed
      }
    )
  }

  function sendEnabled(props: any, pv: any) {
    const enabled = props ? props[pv.value] : true
    const delta = {
      updates: [
        {
          values: [
            {
              path: pv.path.substring(0, pv.path.length - 4) + 'enabled',
              value: enabled === undefined || enabled
            }
          ]
        }
      ]
    }
    app.handleMessage(plugin.id, delta)
  }

  function sendTrackInfo(pv: any) {
    const parts = pv.path.split('.')
    const key = parts[parts.length - 1]
    const path = `${default_device}.track.${key}`
    sendDelta(path, pv.value)
  }

  function sendSourceInfo(pv: any) {
    if (pv.path.endsWith('.name')) return
    const parts = pv.path.split('.')
    const key = parts[parts.length - 1]
    const path = `${default_device}.${key}`
    let value = pv.value
    switch (key) {
      case 'playbackState':
        value = pv.value == 'Playing' ? true : false
        break
    }
    sendDelta(path, value)
  }

  function sendAvailableSources() {
    const sources = app.getSelfPath(`${default_device}.avsource`) ?? {}
    const res: string[] = []
    Object.keys(sources).forEach((source) => {
      if (sources[source].enabled && sources[source].enabled.value) {
        res.push(sources[source].name.value)
      }
    })
    sendDelta(`${default_device}.sources`, res)
  }

  function getZoneVolume(zone: number) {
    const vol = app.getSelfPath(
      `${default_device}.output.zone${zone}.volume.master`
    )
    return vol !== undefined && vol.value != undefined ? vol.value : 0
  }

  function sendVolume() {
    sendDelta(
      `${default_device}.volume`,
      Math.max(
        getZoneVolume(1),
        getZoneVolume(2),
        getZoneVolume(3),
        getZoneVolume(4)
      )
    )
  }

  function sendDelta(path: string, value: any) {
    const delta = {
      updates: [
        {
          values: [
            {
              path: path,
              value: value
            }
          ]
        }
      ]
    }
    app.handleMessage(plugin.id, delta)
  }

  function handleDelta(delta: any) {
    delta.updates.forEach((update: any) => {
      if (!update.values) return

      update.values.forEach((pv: any) => {
        if (pv.path === `${default_device}.output.zone1.source`) {
          currentSource = pv.value
          sendDelta(
            `${default_device}.source`,
            app.getSelfPath(`${currentSource}.name`).value
          )
        }

        if (pv.path.startsWith(`${default_device}.output.zone`)) {
          if (pv.path.endsWith('name')) {
            if (availableZones.indexOf(pv.value) === -1) {
              availableZones.push(pv.value)
            }
            sendEnabled(plugin_props.availableZones, pv)
          }
          if (pv.path.endsWith('volume.master')) {
            sendVolume()
          }
        } else if (pv.path.startsWith(`${default_device}.avsource`)) {
          if (pv.path.endsWith('name') && !pv.path.endsWith('track.name')) {
            if (availableSources.indexOf(pv.value) === -1) {
              availableSources.push(pv.value)
            }
            sendEnabled(plugin_props.availableSources, pv)
            sendAvailableSources()
          }

          if (currentSource && pv.path.startsWith(currentSource)) {
            if (pv.path.indexOf('.track.') != -1) {
              sendTrackInfo(pv)
            } else {
              sendSourceInfo(pv)
            }
          }
        }
      })
    })
  }

  function discoverStereo() {
    const sources = app.getPath('/sources')
    if (sources) {
      const fusions: any[] = []
      Object.values(sources).forEach((v: any) => {
        if (typeof v === 'object') {
          Object.keys(v).forEach((id: any) => {
            if (
              v[id] &&
              v[id].n2k &&
              v[id].n2k.hardwareVersion &&
              v[id].n2k.hardwareVersion.startsWith('FUSION-LINK')
            ) {
              fusions.push(v[id].n2k)
            }
          })
        }
      })
      if (fusions.length) {
        return fusions[0]
      }
    }
  }

  plugin.registerWithRouter = function (router) {
    router.post('/command', (req: any, res: any) => {
      sendCommand(deviceid, req.body)
      res.send('Executed command for plugin ' + plugin.id)
    })

    router.get('/btDevices', (req: any, res: any) => {
      const devices: any[] = []
      let id = 0
      let found = false
      const menu_items = (msg: any) => {
        const fields = msg['fields']
        if (
          msg.pgn === 130820 &&
          fields['Manufacturer Code'] === 'Fusion' &&
          fields['Message ID'] === 'Menu Item'
        ) {
          const name = fields['Text']

          app.debug(`menu item: ${name}`)
          if (name === 'Discoverable') {
            app.debug('found the devices')
            end_menu()
            app.removeListener('N2KAnalyzerOut', menu_items)
            found = true
            lastBtDevices = devices
            res.json(devices)
          } else {
            devices.push({ id: id, name: name })
            id = id + 1
          }
        }
      }
      app.on('N2KAnalyzerOut', menu_items)
      get_bt_devices()
      setTimeout(() => {
        if (!found) {
          app.debug('timed out waiting for devices')
          end_menu()
          app.removeListener('N2KAnalyzerOut', menu_items)
          if (lastBtDevices) {
            res.json(lastBtDevices)
          } else {
            res.status(500).send("didn't get devices")
          }
        }
      }, 3000)
    })
  }

  function subscription_error(err: any) {
    app.error('error: ' + err)
  }

  function got_delta(notification: any) {
    //app.debug("notification: %o", notification)

    notification.updates.forEach((update: any) => {
      if (update.values === undefined) return

      update.values.forEach((value: any) => {
        if (
          value.value != null &&
          typeof value.value.state != 'undefined' &&
          ['alarm', 'emergency'].indexOf(value.value.state) != -1 &&
          typeof value.value.method != 'undefined' &&
          value.value.method.indexOf('sound') != -1
        ) {
          last_states.set(value.path, value.value.state)
          if (playing_sound == false) {
            last_power_state =
              app.getSelfPath(default_device + '.state.value') == 'on'
            if (!last_power_state) {
              power(true)
            }

            setup_for_alarm()
            play_sound()
          }
        } else if (last_states.has(value.path)) {
          last_states.delete(value.path)
        }
      })
    })
    if (last_states.size === 0 && playing_sound) {
      stop_playing()

      setTimeout(function () {
        power(last_power_state)
      }, 1000)
    }
  }

  function sendAlarmSettingDelta(enabled: any) {
    app.handleMessage(plugin.id, {
      updates: [
        {
          values: [
            {
              path: 'entertainment.device.fusion1.outputAlarms',
              value: enabled ? true : false
            }
          ]
        }
      ]
    })
  }

  function setup_for_alarm() {
    const cur_source_id = app.getSelfPath(
      default_device + '.output.zone1.source.value'
    )

    if (typeof cur_source_id == 'undefined') return

    last_source = cur_source_id.substring(
      (default_device + '.avsource.').length
    )

    const zones = app.getSelfPath(default_device + '.output')

    last_muted = app.getSelfPath(default_device + '.output.zone1.isMuted.value')

    last_volumes = [
      zones.zone1.volume.master.value,
      zones.zone2.volume.master.value,
      zones.zone3.volume.master.value,
      zones.zone4.volume.master.value
    ]

    switch_to_source(get_source_id_for_input(plugin_props.alarmInput))

    setTimeout(function () {
      if (plugin_props.alarmSetVolume) {
        const volumes = []
        for (let i = 1; i < 5; i++) {
          const setting = plugin_props['alarmZone' + i]
          volumes.push(
            typeof setting === 'undefined' || setting
              ? plugin_props.alarmVolume
              : 0
          )
        }
        set_volumes(volumes)
      }

      setTimeout(function () {
        if (plugin_props.alarmUnMute && last_muted) {
          set_muted(true)
        }
      }, 1000)
    }, 1000)
  }

  function stop_playing() {
    app.debug('stop playing')
    playing_sound = false

    const cur_source_id = app.getSelfPath(
      default_device + '.output.zone1.source.value'
    )

    if (typeof cur_source_id == 'undefined') return

    if (plugin_props.alarmSetVolume && last_volumes) {
      set_volumes(last_volumes)
    }

    setTimeout(function () {
      if (plugin_props.alarmUnMute && last_muted) {
        set_muted(false)
      }

      setTimeout(function () {
        switch_to_source(last_source)
      }, 1000)
    }, 1000)
  }

  function set_volumes(volumes: number[]) {
    app.debug('setting volumes to %j', volumes)
    sendCommand(deviceid, {
      action: 'setAllVolume',
      device: default_device,
      value: {
        zone1: volumes[0],
        zone2: volumes[1],
        zone3: volumes[2],
        zone4: volumes[3]
      }
    })
  }

  function set_muted(muted: any) {
    const action = muted ? 'mute' : 'unmute'
    sendCommand(deviceid, { action: action, device: default_device })
  }

  function power(state: any) {
    app.debug('setting power to ' + state)
    const action = state ? 'poweron' : 'poweroff'
    sendCommand(deviceid, { action: action, device: default_device })
  }

  function switch_to_source(id: string | null) {
    if (id != null) {
      sendCommand(deviceid, {
        action: 'setSource',
        value: id,
        device: default_device
      })
    }
  }

  function get_source_id_for_input(input: string) {
    const sources = app.getSelfPath(default_device + '.avsource')
    if (typeof sources == 'undefined') {
      app.debug('No Source information')
      return null
    }

    for (const key in sources) {
      if (key && sources[key].name && sources[key].name.value == input)
        return key
    }

    app.debug('unknown input: ' + input)

    return null
  }

  function play_sound() {
    app.debug('play')

    playing_sound = true

    if (plugin_props.playSound !== undefined && !plugin_props.playSound) {
      return
    }

    const command = plugin_props.alarmAudioPlayer
    app.debug('sound_player: ' + command)

    let sound_file = plugin_props.alarmAudioFile
    if (sound_file.charAt(0) != '/') {
      sound_file = path.join(__dirname, sound_file)
    }
    let args = [sound_file]
    if (
      plugin_props.alarmAudioPlayerArguments &&
      plugin_props.alarmAudioPlayerArguments.length > 0
    ) {
      args = [...plugin_props.alarmAudioPlayerArguments.split(' '), ...args]
    }

    app.debug('sound command: %s %j', command, args)

    const play = child_process.spawn(command, args)

    play.on('error', (err) => {
      //stop_playing()
      app.error('failed to play sound ' + err)
    })

    play.on('close', (code) => {
      if (code == 0) {
        if (last_states.size > 0) play_sound()
        //else
        //stop_playing()
      } else {
        app.debug('error playing sound')
        //stop_playing()
      }
    })
  }

  function isoDate() {
    return new Date().toISOString()
  }

  function get_bt_devices() {
    getBTDevices.forEach((format) => {
      const msg = util.format(format, isoDate(), deviceid)
      app.debug('n2k_msg: ' + msg)
      app.emit('nmea2000out', msg)
      app.reportOutputMessages(1)
    })
  }

  function end_menu() {
    const msg = util.format(endMenu, isoDate(), deviceid)
    app.debug('n2k_msg: ' + msg)
    app.emit('nmea2000out', msg)
    app.reportOutputMessages(1)
  }

  function subscribeToAlarms() {
    const command = {
      context: 'vessels.self',
      subscribe: [
        {
          path: 'notifications.*',
          policy: 'instant'
        }
      ]
    }
    app.subscriptionmanager.subscribe(
      command,
      unsubscribes,
      subscription_error,
      got_delta
    )
  }

  function setAlarmsEnabled(enabled: any) {
    if (plugin_props.enableAlarms != enabled) {
      if (enabled) {
        subscribeToAlarms()
      } else {
        unsubscribes.forEach(function (func) {
          func()
        })
        unsubscribes = []
      }
      sendAlarmSettingDelta(enabled)
      plugin_props.enableAlarms = enabled
      app.debug('Saving props with enableAlarms = ' + enabled)
      app.savePluginOptions(plugin_props, (err: any) => {
        if (err) {
          app.error(err.toString())
        }
      })
    }
  }

  function sendCommand(deviceid: number | null, command_json: any) {
    if (deviceid === null) {
      app.debug('no deviceid')
      return
    }

    let n2k_msg = null
    const action = command_json['action']
    const path = command_json['device']

    app.debug('path: %s deviceid: %s command: %j', path, deviceid, command_json)

    if (action === 'playAlarms') {
      setAlarmsEnabled(command_json['value'])
    } else {
      let currentSource
      let cur_source_id

      if (
        action == 'next' ||
        action == 'prev' ||
        action == 'play' ||
        action == 'pause'
      ) {
        const sidPath = path + '.output.zone1.source.value'
        cur_source_id = app.getSelfPath(sidPath)

        app.debug('sidPath: %s cur_source_id %s', sidPath, cur_source_id)

        cur_source_id = cur_source_id.substring((path + '.avsource.').length)
        const sources = app.getSelfPath(path + '.avsource')
        app.debug('sources: %j cur_source_id: %s', sources, cur_source_id)
        if (
          typeof cur_source_id != 'undefined' &&
          typeof sources != 'undefined'
        ) {
          currentSource = sources[cur_source_id]['name']['value']
        }
      }

      n2k_msg = getN2KCommand(
        deviceid,
        command_json,
        currentSource,
        cur_source_id
      )

      if (typeof n2k_msg === 'string') {
        app.debug('n2k_msg: ' + n2k_msg)
        app.emit('nmea2000out', n2k_msg)
        app.reportOutputMessages(1)
      } else {
        app.debug('n2k_json: ' + JSON.stringify(n2k_msg))
        app.emit('nmea2000JsonOut', n2k_msg)
        app.reportOutputMessages(1)
      }
    }
  }

  return plugin
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
